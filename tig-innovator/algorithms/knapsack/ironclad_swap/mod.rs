// ironclad_swap — Quadratic Knapsack steepest-ascent local search with
// deterministic kick-restart perturbation.
//
// Strategy:
//   1. Greedy by (value + Σ interaction) / weight, identical to the tabu-
//      search baseline starting point.
//   2. Maintain `interaction_sum[x] = Σ_{s ∈ selected} V[x][s]` for every
//      item x. After each accepted swap (in/out), update incrementally in
//      O(n) instead of O(n²).
//   3. Inner loop: scan ALL (selected, unselected) pairs, take the single
//      best strictly-improving 1-1 swap. Repeat until no improving swap
//      exists. (Steepest-ascent — deterministic, no tabu list.)
//   4. Outer loop: when local optimum reached, do a deterministic kick:
//      remove the K (=3) currently-selected items with the lowest
//      contribution, then re-fill greedily from the unselected items by
//      (current contribution gain) / weight. Re-run inner loop. Repeat
//      until no kick produces an improvement.
//
// Determinism: no randomness, no HashMap/HashSet. Same input -> same
// output, byte-for-byte. Single-threaded.
//
// Correctness:
//   - Selected items kept as Vec<usize> with `is_selected: Vec<bool>` for
//     O(1) membership and O(n) re-construction.
//   - Total weight tracked as u32; never exceeds challenge.max_weight.
//   - Each item index appears at most once.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tig_challenges::knapsack::*;

#[derive(Serialize, Deserialize, Default)]
pub struct Hyperparameters {
    /// Number of items to remove per kick. Default 3.
    pub kick_size: Option<usize>,
    /// Maximum number of kick rounds before giving up. Default 32.
    pub max_kicks: Option<usize>,
}

pub fn help() {
    println!("ironclad_swap: deterministic steepest-ascent + bounded kicks for quadratic knapsack.");
}

pub fn solve_challenge(
    challenge: &Challenge,
    save_solution: &dyn Fn(&Solution) -> Result<()>,
    hyperparameters: &Option<Map<String, Value>>,
) -> Result<()> {
    let n = challenge.num_items;
    let weights = &challenge.weights;
    let values = &challenge.values;
    let interactions = &challenge.interaction_values;
    let max_weight = challenge.max_weight;

    let hp: Hyperparameters = match hyperparameters {
        Some(h) => serde_json::from_value(Value::Object(h.clone())).unwrap_or_default(),
        None => Hyperparameters::default(),
    };
    let kick_size = hp.kick_size.unwrap_or(3).max(1);
    let max_kicks = hp.max_kicks.unwrap_or(32);

    // ---- 1. Greedy initial solution by ratio ----
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|&a, &b| {
        let ta = values[a] as i64 + interactions[a].iter().map(|&v| v as i64).sum::<i64>();
        let tb = values[b] as i64 + interactions[b].iter().map(|&v| v as i64).sum::<i64>();
        let ra = ta as f64 / weights[a] as f64;
        let rb = tb as f64 / weights[b] as f64;
        rb.partial_cmp(&ra).unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut is_selected = vec![false; n];
    let mut total_weight: u32 = 0;
    let mut selected: Vec<usize> = Vec::with_capacity(n);
    for &i in &order {
        if total_weight + weights[i] <= max_weight {
            total_weight += weights[i];
            is_selected[i] = true;
            selected.push(i);
        }
    }

    // ---- 2. Build interaction_sum cache ----
    // interaction_sum[x] = values[x] + Σ_{s ∈ selected} V[x][s]
    let mut interaction_sum: Vec<i64> = (0..n).map(|x| values[x] as i64).collect();
    for &s in &selected {
        for x in 0..n {
            interaction_sum[x] += interactions[x][s] as i64;
        }
    }

    // Save initial solution as a baseline guard.
    let mut best_items = selected.clone();
    save_solution(&Solution { items: best_items.clone() })?;
    let mut best_total = total_value(challenge, &best_items);

    // ---- 3. Steepest-ascent inner loop + outer kick loop ----
    let mut kicks_done = 0usize;
    loop {
        local_search_steepest_ascent(
            n,
            weights,
            interactions,
            max_weight,
            &mut is_selected,
            &mut selected,
            &mut total_weight,
            &mut interaction_sum,
        );

        // Evaluate current solution.
        let cur_total = total_value(challenge, &selected);
        if cur_total > best_total {
            best_total = cur_total;
            best_items = selected.clone();
            save_solution(&Solution { items: best_items.clone() })?;
        }

        if kicks_done >= max_kicks {
            break;
        }

        // ---- 4. Deterministic kick: remove the kick_size weakest by
        //         interaction_sum (lowest marginal value), then re-fill ----
        if !kick(
            n,
            weights,
            interactions,
            values,
            max_weight,
            kick_size,
            &mut is_selected,
            &mut selected,
            &mut total_weight,
            &mut interaction_sum,
        ) {
            // Could not kick (e.g. nothing to remove). Stop.
            break;
        }
        kicks_done += 1;
    }

    // Final save (in case the last accepted local optimum was best).
    save_solution(&Solution { items: best_items })?;
    Ok(())
}

fn total_value(challenge: &Challenge, items: &[usize]) -> i64 {
    let mut sum: i64 = 0;
    for &i in items {
        sum += challenge.values[i] as i64;
    }
    for a in 0..items.len() {
        for b in (a + 1)..items.len() {
            sum += challenge.interaction_values[items[a]][items[b]] as i64;
        }
    }
    sum
}

fn local_search_steepest_ascent(
    n: usize,
    weights: &[u32],
    interactions: &[Vec<i32>],
    max_weight: u32,
    is_selected: &mut [bool],
    selected: &mut Vec<usize>,
    total_weight: &mut u32,
    interaction_sum: &mut [i64],
) {
    loop {
        let mut best_delta: i64 = 0;
        let mut best_in: Option<usize> = None;
        let mut best_out: Option<usize> = None;

        // 1-1 swaps: remove `out`, add `in_item`. Feasible iff
        //   total_weight - w[out] + w[in] <= max_weight  ⇔
        //   w[in] - w[out] <= max_weight - total_weight
        let slack: i64 = max_weight as i64 - *total_weight as i64;

        for &out in selected.iter() {
            for in_item in 0..n {
                if is_selected[in_item] {
                    continue;
                }
                let dw = weights[in_item] as i64 - weights[out] as i64;
                if dw > slack {
                    continue;
                }
                // Δ value = interaction_sum[in] − interaction_sum[out]
                //          − V[in][out]   (cancel double-count)
                let delta = interaction_sum[in_item]
                    - interaction_sum[out]
                    - interactions[in_item][out] as i64;
                if delta > best_delta {
                    best_delta = delta;
                    best_in = Some(in_item);
                    best_out = Some(out);
                }
            }
        }

        // Pure additions: add `in_item` without removing anything.
        for in_item in 0..n {
            if is_selected[in_item] {
                continue;
            }
            if (weights[in_item] as i64) <= slack {
                let delta = interaction_sum[in_item];
                if delta > best_delta {
                    best_delta = delta;
                    best_in = Some(in_item);
                    best_out = None;
                }
            }
        }

        match (best_in, best_out) {
            (Some(in_item), Some(out)) => {
                apply_swap(
                    interactions,
                    weights,
                    in_item,
                    Some(out),
                    is_selected,
                    selected,
                    total_weight,
                    interaction_sum,
                );
            }
            (Some(in_item), None) => {
                apply_swap(
                    interactions,
                    weights,
                    in_item,
                    None,
                    is_selected,
                    selected,
                    total_weight,
                    interaction_sum,
                );
            }
            _ => break,
        }
    }
}

fn apply_swap(
    interactions: &[Vec<i32>],
    weights: &[u32],
    in_item: usize,
    out_opt: Option<usize>,
    is_selected: &mut [bool],
    selected: &mut Vec<usize>,
    total_weight: &mut u32,
    interaction_sum: &mut [i64],
) {
    if let Some(out) = out_opt {
        // Remove `out` from cache.
        let n = interaction_sum.len();
        for x in 0..n {
            interaction_sum[x] -= interactions[x][out] as i64;
        }
        is_selected[out] = false;
        let pos = selected.iter().position(|&i| i == out).unwrap();
        selected.swap_remove(pos);
        *total_weight -= weights[out];
    }
    // Add `in_item`.
    let n = interaction_sum.len();
    for x in 0..n {
        interaction_sum[x] += interactions[x][in_item] as i64;
    }
    is_selected[in_item] = true;
    selected.push(in_item);
    *total_weight += weights[in_item];
}

fn kick(
    n: usize,
    weights: &[u32],
    interactions: &[Vec<i32>],
    values: &[u32],
    max_weight: u32,
    kick_size: usize,
    is_selected: &mut [bool],
    selected: &mut Vec<usize>,
    total_weight: &mut u32,
    interaction_sum: &mut [i64],
) -> bool {
    if selected.is_empty() {
        return false;
    }
    // Sort selected items by interaction_sum ascending (= weakest first).
    // Stable + deterministic.
    let mut order: Vec<usize> = selected.clone();
    order.sort_by_key(|&i| interaction_sum[i]);
    let to_remove = order.into_iter().take(kick_size).collect::<Vec<_>>();
    if to_remove.is_empty() {
        return false;
    }
    for out in to_remove {
        // Remove
        for x in 0..n {
            interaction_sum[x] -= interactions[x][out] as i64;
        }
        is_selected[out] = false;
        let pos = selected.iter().position(|&i| i == out).unwrap();
        selected.swap_remove(pos);
        *total_weight -= weights[out];
    }
    // Re-fill greedily by (interaction_sum / weight) over unselected items.
    let mut candidates: Vec<usize> = (0..n).filter(|&i| !is_selected[i]).collect();
    candidates.sort_by(|&a, &b| {
        let ra = (interaction_sum[a] + values[a] as i64) as f64 / weights[a] as f64;
        let rb = (interaction_sum[b] + values[b] as i64) as f64 / weights[b] as f64;
        rb.partial_cmp(&ra).unwrap_or(std::cmp::Ordering::Equal)
    });
    for &c in &candidates {
        if *total_weight + weights[c] <= max_weight {
            // Add
            for x in 0..n {
                interaction_sum[x] += interactions[x][c] as i64;
            }
            is_selected[c] = true;
            selected.push(c);
            *total_weight += weights[c];
        }
    }
    true
}
