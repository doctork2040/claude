// optigrid_v4 — Size-adaptive ensemble policy for the TIG
// energy_arbitrage challenge.
//
// Three deterministic sub-policies (sub_v1, sub_v2, sub_v3) are
// dispatched based on `Challenge::num_batteries`:
//
//   num_batteries ≤ 10 → sub_v3
//   11 ≤ num_batteries ≤ 40 → sub_v2
//   num_batteries > 40 → sub_v1
//
// Each sub-policy targets a different operating regime of the grid;
// the dispatch rule was tuned on 16 seeds × 5 scenarios = 80 instances.
//
// Shared properties:
//   - All deterministic. Same Challenge → byte-identical Solution.
//   - All build on the same RT × DA forecasting + PTDF feasibility
//     machinery.
//   - 0 RNG, 0 HashMap.

use anyhow::{anyhow, Result};
use serde_json::{Map, Value};
use tig_challenges::energy_arbitrage::*;

// ============================================================================
// Constants (mirror tig-challenges/.../constants.rs)
// ============================================================================

const KAPPA_TX: f64 = 0.25;
const KAPPA_DEG: f64 = 1.00;
const BETA_DEG: f64 = 2.0;
const DELTA_T: f64 = 0.25;
const ETA_CHARGE: f64 = 0.95;
const ETA_DISCHARGE: f64 = 0.95;
const ETA_ROUND: f64 = ETA_CHARGE * ETA_DISCHARGE;

const EPS: f64 = 1e-12;
const EPS_FLOW: f64 = 1e-6;
const MAX_FLOW_ADJUST_ITERS: usize = 64;
const GLOBAL_SCALE_BSEARCH_ITERS: usize = 32;

// sub_v1 parameters
const V1_HORIZON: usize = 16;
const V1_MIN_GAP: f64 = 1.0;
const V1_SCALE_K_INV: f64 = 8.0;

// sub_v2 parameters
const V2_MAX_HORIZON: usize = 32;
const V2_MIN_HORIZON: usize = 4;

// sub_v3 parameters
const V3_HORIZON: usize = 24;
const V3_MIN_GAP: f64 = 1.0;
const V3_SCALE_K_INV: f64 = 8.0;

// ============================================================================
// Entry points
// ============================================================================

pub fn help() {
    println!("optigrid_v4: size-adaptive ensemble (v1/v2/v3) for energy_arbitrage.");
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
    match challenge.num_batteries {
        n if n <= 10 => sub_v3(challenge, state),
        n if n <= 40 => sub_v2(challenge, state),
        _ => sub_v1(challenge, state),
    }
}

// ============================================================================
// sub_v1 — mean-of-window comparison, soft-saturating magnitude.
//         Best for many-battery / heavily constrained grids (DENSE, CAPSTONE).
// ============================================================================

fn sub_v1(challenge: &Challenge, state: &State) -> Result<Vec<f64>> {
    let n_bat = challenge.num_batteries;
    let mut action = vec![0.0f64; n_bat];
    let t = state.time_step;
    let last_step = (t + V1_HORIZON).min(challenge.num_steps);

    for i in 0..n_bat {
        let battery = &challenge.batteries[i];
        let node = battery.node;
        let (min_bound, max_bound) = state.action_bounds[i];

        // Forward window mean of DA prices at this node.
        let rt_now = state.rt_prices[node];
        let mut da_sum = 0.0;
        let mut da_count = 0.0;
        for tt in (t + 1)..last_step {
            da_sum += challenge.market.day_ahead_prices[tt][node];
            da_count += 1.0;
        }
        let mu_future = if da_count >= 1.0 { da_sum / da_count } else { rt_now };

        let gap = rt_now - mu_future;
        // Signed effective gap: how much above the friction floor.
        let abs_eff = gap.abs() - KAPPA_TX - V1_MIN_GAP;
        if abs_eff <= 0.0 {
            action[i] = 0.0;
            continue;
        }

        let scale = 1.0 - (-abs_eff / V1_SCALE_K_INV).exp();
        let raw = if gap > 0.0 {
            // now expensive → discharge (positive action)
            max_bound.max(0.0) * scale
        } else {
            // now cheap → charge (negative action)
            min_bound.min(0.0) * scale
        };
        action[i] = raw.clamp(min_bound, max_bound);
    }

    enforce_flow_feasibility(challenge, state, action)
}

// ============================================================================
// sub_v2 — round-trip economics with future-best lookahead, closed-form
//         magnitude. Best for medium grids (CONGESTED, MULTIDAY).
// ============================================================================

fn sub_v2(challenge: &Challenge, state: &State) -> Result<Vec<f64>> {
    let n_bat = challenge.num_batteries;
    let mut action = vec![0.0f64; n_bat];

    let t = state.time_step;
    let remaining = challenge.num_steps.saturating_sub(t + 1);
    let horizon = remaining.min(V2_MAX_HORIZON);
    if horizon < V2_MIN_HORIZON {
        return enforce_flow_feasibility(challenge, state, action);
    }
    let last_step = t + 1 + horizon;

    // Per-node max + min DA price in the forecast window.
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

        // Charge-then-discharge break-even.
        let charge_break_even = (rt_now + (1.0 + ETA_ROUND) * KAPPA_TX) / ETA_ROUND;
        let charge_edge = future_max - charge_break_even;
        // Discharge-then-recharge break-even.
        let discharge_break_even = rt_now * ETA_ROUND - (1.0 + ETA_ROUND) * KAPPA_TX;
        let discharge_edge = discharge_break_even - future_min;

        let (sign, edge) = if charge_edge > 0.0 && charge_edge >= discharge_edge {
            (-1.0, charge_edge)
        } else if discharge_edge > 0.0 {
            (1.0, discharge_edge)
        } else {
            action[i] = 0.0;
            continue;
        };

        // Closed-form optimal magnitude for β = 2.
        let e_bar = battery.capacity_mwh.max(1e-9);
        let abs_u_star = (e_bar * e_bar) * edge / (BETA_DEG * KAPPA_DEG * DELTA_T);

        let raw = sign * abs_u_star;
        action[i] = raw.clamp(min_bound, max_bound);
    }

    enforce_flow_feasibility(challenge, state, action)
}

// ============================================================================
// sub_v3 — future-best lookahead with soft-saturating magnitude.
//         Best for small grids (BASELINE).
// ============================================================================

fn sub_v3(challenge: &Challenge, state: &State) -> Result<Vec<f64>> {
    let n_bat = challenge.num_batteries;
    let n_nodes = challenge.network.num_nodes;
    let mut action = vec![0.0f64; n_bat];

    let t = state.time_step;
    let last_step = (t + V3_HORIZON + 1).min(challenge.num_steps);
    if last_step <= t + 1 {
        return enforce_flow_feasibility(challenge, state, action);
    }

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

        let charge_gap = future_max - rt_now;
        let discharge_gap = rt_now - future_min;
        let (sign, raw_gap) = if charge_gap > discharge_gap {
            (-1.0, charge_gap)
        } else {
            (1.0, discharge_gap)
        };

        if raw_gap <= KAPPA_TX + V3_MIN_GAP {
            action[i] = 0.0;
            continue;
        }
        let effective = raw_gap - KAPPA_TX - V3_MIN_GAP;
        let scale = 1.0 - (-effective / V3_SCALE_K_INV).exp();
        let bound = if sign < 0.0 { min_bound.min(0.0) } else { max_bound.max(0.0) };
        let raw = bound * scale;
        action[i] = raw.clamp(min_bound, max_bound);
    }

    enforce_flow_feasibility(challenge, state, action)
}

// ============================================================================
// PTDF feasibility (shared, mirrors tig-challenges' baselines)
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
