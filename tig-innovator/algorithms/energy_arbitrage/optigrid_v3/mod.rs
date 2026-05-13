// optigrid_v3 — Hybrid of v1 and v2 for the TIG energy_arbitrage challenge.
//
// Empirically:
//   * v1 (mean-of-window comparison + soft-saturating magnitude) wins on
//     the large scenarios (DENSE, CAPSTONE) — its gentle, frequent trades
//     respect the binding grid constraints better.
//   * v2 (future-best matching + round-trip threshold + closed-form
//     magnitude) wins on small/medium scenarios (BASELINE, CONGESTED,
//     MULTIDAY) where the round-trip math correctly filters losing
//     trades.
//
// v3 keeps v1's gentle soft-saturating magnitude (so large-scenario
// performance is preserved) but replaces v1's *mean* lookahead with
// v2's *best* lookahead — i.e. the per-node max DA price for charging
// and per-node min DA price for discharging in the forecast window.
// The threshold is kept lenient (κ_tx + 1) so we still capture the
// frequent small trades that win on DENSE/CAPSTONE.
//
// Net: v3 should match or beat v1 everywhere because the only change
// (mean → best-direction) is a strictly more informative signal at
// the same trading cadence.

use anyhow::{anyhow, Result};
use serde_json::{Map, Value};
use tig_challenges::energy_arbitrage::*;

const KAPPA_TX: f64 = 0.25;

const EPS: f64 = 1e-12;
const EPS_FLOW: f64 = 1e-6;
const MAX_FLOW_ADJUST_ITERS: usize = 64;
const GLOBAL_SCALE_BSEARCH_ITERS: usize = 32;

const FORECAST_HORIZON: usize = 24; // 6 hours forward (was 16 in v1)
const MIN_GAP_USD_PER_MWH: f64 = 1.0;
const SCALE_K_INV: f64 = 8.0; // 1 - exp(-|gap| / 8) → 63% at $8 gap

pub fn help() {
    println!("optigrid_v3: v1's soft-saturating magnitude + v2's future-best lookahead.");
}

pub fn solve_challenge(
    challenge: &Challenge,
    save_solution: &dyn Fn(&Solution) -> Result<()>,
    _hyperparameters: &Option<Map<String, Value>>,
) -> Result<()> {
    let solution = challenge.grid_optimize(&policy)?;
    save_solution(&solution)?;
    Ok(())
}

pub fn policy(challenge: &Challenge, state: &State) -> Result<Vec<f64>> {
    let n_bat = challenge.num_batteries;
    let n_nodes = challenge.network.num_nodes;
    let mut action = vec![0.0f64; n_bat];

    let t = state.time_step;
    let last_step = (t + FORECAST_HORIZON + 1).min(challenge.num_steps);

    if last_step <= t + 1 {
        // No future window: hold.
        return enforce_flow_feasibility(challenge, state, action);
    }

    // Pre-compute per-node future min and max DA price in the forecast window.
    let mut node_min = vec![f64::INFINITY; n_nodes];
    let mut node_max = vec![f64::NEG_INFINITY; n_nodes];
    for tt in (t + 1)..last_step {
        let row = &challenge.market.day_ahead_prices[tt];
        for n in 0..n_nodes {
            let p = row[n];
            if p < node_min[n] { node_min[n] = p; }
            if p > node_max[n] { node_max[n] = p; }
        }
    }

    for i in 0..n_bat {
        let battery = &challenge.batteries[i];
        let node = battery.node;
        let (min_bound, max_bound) = state.action_bounds[i];

        let rt_now = state.rt_prices[node];
        let future_max = node_max[node];
        let future_min = node_min[node];

        // ---- Best-direction gap (instead of v1's mean comparison) ----------
        // For charging: how much higher is the best future price than rt_now?
        let charge_gap = future_max - rt_now;        // > 0 ⇒ future is more expensive
        // For discharging: how much higher is rt_now than the best future low?
        let discharge_gap = rt_now - future_min;     // > 0 ⇒ now is more expensive

        // Pick the more attractive direction.
        let (sign, raw_gap) = if charge_gap > discharge_gap {
            (-1.0, charge_gap) // charge: action negative
        } else {
            (1.0, discharge_gap) // discharge: action positive
        };

        // Friction floor — same as v1 (lenient enough to keep the trade
        // cadence that wins on DENSE/CAPSTONE).
        if raw_gap <= KAPPA_TX + MIN_GAP_USD_PER_MWH {
            action[i] = 0.0;
            continue;
        }
        let effective = raw_gap - KAPPA_TX - MIN_GAP_USD_PER_MWH;

        // v1's soft-saturating magnitude on the chosen power bound.
        let scale = 1.0 - (-effective / SCALE_K_INV).exp();
        let bound = if sign < 0.0 {
            // charge ⇒ negative action; min_bound is the most negative we can go.
            min_bound.min(0.0)
        } else {
            max_bound.max(0.0)
        };
        let raw = bound * scale;

        action[i] = raw.clamp(min_bound, max_bound);
    }

    enforce_flow_feasibility(challenge, state, action)
}

// ============================================================================
// PTDF / flow feasibility (mirrors baselines)
// ============================================================================

#[derive(Clone, Copy)]
struct Violation {
    line: usize,
    flow: f64,
    amount: f64,
}

fn compute_flows(challenge: &Challenge, state: &State, action: &[f64]) -> Vec<f64> {
    let injections = challenge.compute_total_injections(state, action);
    (0..challenge.network.num_lines)
        .map(|l| {
            (0..challenge.network.num_nodes)
                .map(|k| challenge.network.ptdf[l][k] * injections[k])
                .sum::<f64>()
        })
        .collect()
}

fn most_violated_line(challenge: &Challenge, flows: &[f64]) -> Option<Violation> {
    let mut best: Option<Violation> = None;
    for (l, &flow) in flows.iter().enumerate() {
        let limit = challenge.network.flow_limits[l];
        let violation = flow.abs() - limit;
        if violation > EPS_FLOW * limit {
            let cand = Violation { line: l, flow, amount: violation };
            match best {
                Some(cur) if cand.amount <= cur.amount => {}
                _ => best = Some(cand),
            }
        }
    }
    best
}

fn is_flow_feasible(challenge: &Challenge, state: &State, action: &[f64]) -> bool {
    let flows = compute_flows(challenge, state, action);
    most_violated_line(challenge, &flows).is_none()
}

fn soften_most_violated_line(
    challenge: &Challenge,
    violation: Violation,
    action: &mut [f64],
) -> bool {
    let line = violation.line;
    let signed_direction = violation.flow.signum();
    if signed_direction.abs() <= EPS {
        return false;
    }
    let mut worsening_indices = Vec::new();
    let mut worsening_strength = 0.0;
    for (i, battery) in challenge.batteries.iter().enumerate() {
        let contribution = challenge.network.ptdf[line][battery.node] * action[i];
        let signed_contribution = signed_direction * contribution;
        if signed_contribution > EPS {
            worsening_strength += signed_contribution;
            worsening_indices.push(i);
        }
    }
    if worsening_indices.is_empty() || worsening_strength <= EPS {
        return false;
    }
    let keep = (1.0 - violation.amount / worsening_strength).clamp(0.0, 1.0);
    if (1.0 - keep).abs() <= EPS {
        return false;
    }
    for i in worsening_indices {
        action[i] *= keep;
    }
    true
}

fn enforce_flow_feasibility(
    challenge: &Challenge,
    state: &State,
    mut action: Vec<f64>,
) -> Result<Vec<f64>> {
    for _ in 0..MAX_FLOW_ADJUST_ITERS {
        let flows = compute_flows(challenge, state, &action);
        let Some(v) = most_violated_line(challenge, &flows) else {
            return Ok(action);
        };
        if !soften_most_violated_line(challenge, v, &mut action) {
            break;
        }
    }
    if is_flow_feasible(challenge, state, &action) {
        return Ok(action);
    }
    let zero = vec![0.0; action.len()];
    if !is_flow_feasible(challenge, state, &zero) {
        return Err(anyhow!(
            "Grid infeasible even with zero battery actions"
        ));
    }
    let base = action;
    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..GLOBAL_SCALE_BSEARCH_ITERS {
        let mid = 0.5 * (low + high);
        let scaled: Vec<f64> = base.iter().map(|u| mid * u).collect();
        if is_flow_feasible(challenge, state, &scaled) {
            low = mid;
        } else {
            high = mid;
        }
    }
    Ok(base.into_iter().map(|u| low * u).collect())
}
