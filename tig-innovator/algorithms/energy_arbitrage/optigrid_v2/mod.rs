// optigrid_v2 — v1 with sharper round-trip economics for the TIG
// energy_arbitrage challenge.
//
// Key changes vs v1
// =================
//
// 1. **Round-trip profit accounting** (the big one). v1 trades whenever
//    `|rt_now − mean(future_da)| > κ_tx + 1`. That filter is too loose:
//    it ignores the ~10.8% bid-ask spread imposed by the round-trip
//    efficiency η_chg · η_dis = 0.9025. v2 trades only when the full
//    round-trip is provably profitable in expectation:
//
//        charge now, sell at future_best:
//          requires future_best  >  (rt_now + (1+η_round)·κ_tx) / η_round
//
//        sell now, repurchase at future_worst:
//          requires future_worst <  (rt_now·η_round − (1+η_round)·κ_tx)
//
// 2. **Future-best matching** instead of mean. v1 averages the next H
//    DA prices; v2 takes the **max** (for charge) and **min** (for
//    discharge). This captures the strategic timing of the largest
//    swing in the window, not the average.
//
// 3. **Bidirectional evaluation**. Both charge-then-discharge and
//    discharge-then-recharge edges are computed. If both are positive
//    (rare), we pick the larger.
//
// 4. **Closed-form magnitude**. β = 2 in the degradation cost, so
//    dπ/du = 0 has the closed form |u*| = Ē² · edge / (2 κ_deg Δt).
//    Capped by power and SoC bounds via `action_bounds`.
//
// 5. **Adaptive horizon**. v1 uses fixed H = 16. v2 uses
//    H = min(num_steps − t, 32) — captures up to 8 hours forward,
//    enough to span the daily DA cycle's high/low extremes.
//
// 6. **PTDF feasibility** unchanged: same iterative soften-violated-
//    line + global-scale binary search as v1 and the baselines.
//
// Determinism: no RNG, no HashMap. Same input ⇒ same output.

use anyhow::{anyhow, Result};
use serde_json::{Map, Value};
use tig_challenges::energy_arbitrage::*;

// Physical constants (mirror tig-challenges/.../constants.rs).
const KAPPA_TX: f64 = 0.25;
const KAPPA_DEG: f64 = 1.00;
const BETA_DEG: f64 = 2.0;
const DELTA_T: f64 = 0.25;
const ETA_CHARGE: f64 = 0.95;
const ETA_DISCHARGE: f64 = 0.95;
const ETA_ROUND: f64 = ETA_CHARGE * ETA_DISCHARGE; // 0.9025

const EPS: f64 = 1e-12;
const EPS_FLOW: f64 = 1e-6;
const MAX_FLOW_ADJUST_ITERS: usize = 64;
const GLOBAL_SCALE_BSEARCH_ITERS: usize = 32;

// Forecast horizon cap (steps). 32 × 15 min = 8 h forward.
const MAX_HORIZON: usize = 32;
// Minimum window size to avoid trading at the very tail.
const MIN_HORIZON: usize = 4;

pub fn help() {
    println!("optigrid_v2: round-trip-aware per-battery arbitrage with PTDF feasibility.");
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

// ============================================================================
// Policy
// ============================================================================

pub fn policy(challenge: &Challenge, state: &State) -> Result<Vec<f64>> {
    let n_bat = challenge.num_batteries;
    let mut action = vec![0.0f64; n_bat];

    let t = state.time_step;
    let remaining = challenge.num_steps.saturating_sub(t + 1);
    let horizon = remaining.min(MAX_HORIZON);
    if horizon < MIN_HORIZON {
        // Not enough future to plan a round-trip; safest is to do nothing.
        // (Returns the all-zero action, which is always feasible.)
        return enforce_flow_feasibility(challenge, state, action);
    }
    let last_step = t + 1 + horizon;

    // Pre-compute, for each node, the (min, max) DA price in the forecast window.
    let n_nodes = challenge.network.num_nodes;
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

        // ---- Round-trip profitability tests ---------------------------------
        // Charge now, sell at the highest forecast price.
        //   future_max needed > (rt_now + (1+η)·κ_tx) / η
        let charge_break_even = (rt_now + (1.0 + ETA_ROUND) * KAPPA_TX) / ETA_ROUND;
        let charge_edge = future_max - charge_break_even;

        // Sell now, repurchase at the lowest forecast price.
        //   future_min needed < rt_now·η − (1+η)·κ_tx
        let discharge_break_even = rt_now * ETA_ROUND - (1.0 + ETA_ROUND) * KAPPA_TX;
        let discharge_edge = discharge_break_even - future_min;

        // Pick the more profitable direction (skip if neither is profitable).
        let (sign, edge) = if charge_edge > 0.0 && charge_edge >= discharge_edge {
            (-1.0, charge_edge) // charge: action negative
        } else if discharge_edge > 0.0 {
            (1.0, discharge_edge) // discharge: action positive
        } else {
            // No profitable round-trip: hold.
            action[i] = 0.0;
            continue;
        };

        // ---- Closed-form optimal magnitude ---------------------------------
        // π(u) = u·p·Δt − κ_tx |u| Δt − κ_deg (|u| Δt / Ē)^β    (β = 2)
        // dπ/d|u| = (|p|·Δt) − κ_tx Δt − 2 κ_deg |u| Δt² / Ē²
        // Set to zero: |u*| = Ē² · (|p| − κ_tx) / (2 κ_deg Δt)
        // Here |p| is the *edge*; Δt and the deg-formula are per-step.
        let e_bar = battery.capacity_mwh.max(1e-9);
        let abs_u_star = (e_bar * e_bar) * edge / (BETA_DEG * KAPPA_DEG * DELTA_T);

        // Direction-respecting candidate, then clamp to physical action bounds.
        let raw = sign * abs_u_star;
        action[i] = raw.clamp(min_bound, max_bound);
    }

    // ---- PTDF feasibility -----------------------------------------------
    enforce_flow_feasibility(challenge, state, action)
}

// ============================================================================
// PTDF / flow feasibility (mirrors baselines exactly)
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
            "Grid infeasible even with zero battery actions; nothing the policy can do"
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
