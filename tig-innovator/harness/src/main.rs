// Local harness: run ironclad_swap against tig-challenges baseline.
// Bypasses hide_verification by depending on tig-challenges directly.

use std::cell::RefCell;
use std::env;
use tig_challenges::knapsack::{Challenge, Solution, Track};

#[path = "../../algorithms/knapsack/ironclad_swap/mod.rs"]
mod ironclad;

#[path = "../../../tig/tig-algorithms/src/knapsack/fast_and_fun/mod.rs"]
mod fast_and_fun;

#[path = "../../../tig/tig-algorithms/src/knapsack/knap_supreme/mod.rs"]
mod knap_supreme;

#[path = "../../../tig/tig-algorithms/src/knapsack/knap_quality_opt/mod.rs"]
mod knap_quality_opt;

fn greedy_only_value(challenge: &Challenge) -> i64 {
    // Replicate the same greedy initial selection that ironclad_swap and
    // tabu_search both start from. Used as a lower-bound floor.
    let n = challenge.num_items;
    let weights = &challenge.weights;
    let values = &challenge.values;
    let interactions = &challenge.interaction_values;

    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|&a, &b| {
        let ta = values[a] as i64 + interactions[a].iter().map(|&v| v as i64).sum::<i64>();
        let tb = values[b] as i64 + interactions[b].iter().map(|&v| v as i64).sum::<i64>();
        let ra = ta as f64 / weights[a] as f64;
        let rb = tb as f64 / weights[b] as f64;
        rb.partial_cmp(&ra).unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut total_weight: u32 = 0;
    let mut selected: Vec<usize> = Vec::new();
    for &i in &order {
        if total_weight + weights[i] <= challenge.max_weight {
            total_weight += weights[i];
            selected.push(i);
        }
    }

    let mut sum: i64 = 0;
    for &i in &selected {
        sum += values[i] as i64;
    }
    for a in 0..selected.len() {
        for b in (a + 1)..selected.len() {
            sum += interactions[selected[a]][selected[b]] as i64;
        }
    }
    sum
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().collect();
    let n_items: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(50);
    let budget: u32 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(50);
    let n_seeds: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(5);
    let trace = args.iter().any(|a| a == "--trace");

    let track = Track { n_items, budget };
    if !trace {
        println!("Track: n_items={}, budget={}%", n_items, budget);
        println!("Running {} seeds, comparing ironclad_swap vs tabu_search baseline", n_seeds);
        println!();
    }

    let mut iron_wins = 0i64;
    let mut iron_total = 0i64;
    let mut comp_wins: [i64; 3] = [0; 3];
    let mut comp_total: [i64; 3] = [0; 3];
    let names = ["fast_and_fun", "knap_supreme", "knap_quality_opt"];

    println!(
        "{:>4}  {:>8}  {:>8}  {:>8}  {:>12}  {:>12}  {:>16}",
        "seed", "greedy", "baseline", "ironclad", names[0], names[1], names[2]
    );

    for seed_byte in 0..n_seeds as u8 {
        let mut seed = [0u8; 32];
        seed[0] = seed_byte;
        let challenge = Challenge::generate_instance(&seed, &track)?;

        let greedy_v = greedy_only_value(&challenge);

        let baseline_solution = challenge.compute_greedy_baseline()?;
        let baseline_value = challenge.evaluate_total_value(&baseline_solution)? as i64;

        let run_algo = |solver: &dyn Fn(&Challenge, &dyn Fn(&Solution) -> anyhow::Result<()>, &Option<serde_json::Map<String, serde_json::Value>>) -> anyhow::Result<()>| -> anyhow::Result<i64> {
            let cell: RefCell<Solution> = RefCell::new(Solution::new());
            let save = |s: &Solution| -> anyhow::Result<()> {
                *cell.borrow_mut() = s.clone();
                Ok(())
            };
            solver(&challenge, &save, &None)?;
            let sol = cell.into_inner();
            Ok(challenge.evaluate_total_value(&sol)? as i64)
        };

        let iron = run_algo(&ironclad::solve_challenge)?;
        let comp_vals = [
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_algo(&fast_and_fun::solve_challenge).unwrap_or(0))).unwrap_or(0),
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_algo(&knap_supreme::solve_challenge).unwrap_or(0))).unwrap_or(0),
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_algo(&knap_quality_opt::solve_challenge).unwrap_or(0))).unwrap_or(0),
        ];

        iron_total += iron - baseline_value;
        if iron > baseline_value { iron_wins += 1; }
        for k in 0..3 {
            comp_total[k] += comp_vals[k] - baseline_value;
            if comp_vals[k] > baseline_value { comp_wins[k] += 1; }
        }

        println!(
            "{:02x}    {:>8}  {:>8}  {:>8}  {:>10}  {:>10}  {:>12}",
            seed_byte, greedy_v, baseline_value, iron,
            comp_vals[0], comp_vals[1], comp_vals[2]
        );
        let _ = trace;
    }

    println!();
    println!(
        "ironclad     Δ-avg={:+8.1}   wins-vs-baseline={}/{}",
        iron_total as f64 / n_seeds as f64, iron_wins, n_seeds
    );
    for k in 0..3 {
        println!(
            "{:12} Δ-avg={:+8.1}   wins-vs-baseline={}/{}",
            names[k], comp_total[k] as f64 / n_seeds as f64, comp_wins[k], n_seeds
        );
    }

    Ok(())
}
