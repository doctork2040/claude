// Full-field competitive benchmark for the TIG knapsack challenge.
// Compares ironclad_swap against ALL active competitors on the same
// generated instances.

use std::cell::RefCell;
use std::env;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::Instant;
use tig_challenges::knapsack::{Challenge, Solution, Track};

#[path = "../../algorithms/knapsack/ironclad_swap/mod.rs"]
mod ironclad;

#[path = "../../../tig/tig-algorithms/src/knapsack/fast_and_fun/mod.rs"]
mod fast_and_fun;
#[path = "../../../tig/tig-algorithms/src/knapsack/fast_and_furious/mod.rs"]
mod fast_and_furious;
#[path = "../../../tig/tig-algorithms/src/knapsack/knap_quality_opt/mod.rs"]
mod knap_quality_opt;
#[path = "../../../tig/tig-algorithms/src/knapsack/knap_supreme/mod.rs"]
mod knap_supreme;
#[path = "../../../tig/tig-algorithms/src/knapsack/knapsack_redone/mod.rs"]
mod knapsack_redone;
#[path = "../../../tig/tig-algorithms/src/knapsack/knapsplat_hyper_s/mod.rs"]
mod knapsplat_hyper_s;
#[path = "../../../tig/tig-algorithms/src/knapsack/knapsplatt/mod.rs"]
mod knapsplatt;
#[path = "../../../tig/tig-algorithms/src/knapsack/native_knapsack/mod.rs"]
mod native_knapsack;
#[path = "../../../tig/tig-algorithms/src/knapsack/near_knap/mod.rs"]
mod near_knap;
#[path = "../../../tig/tig-algorithms/src/knapsack/near_knap_v3/mod.rs"]
mod near_knap_v3;
#[path = "../../../tig/tig-algorithms/src/knapsack/near_knap_v4/mod.rs"]
mod near_knap_v4;
#[path = "../../../tig/tig-algorithms/src/knapsack/near_knap_improve_v1/mod.rs"]
mod near_knap_improve_v1;
#[path = "../../../tig/tig-algorithms/src/knapsack/relative_quad_fast/mod.rs"]
mod relative_quad_fast;

type Solver = fn(
    &Challenge,
    &dyn Fn(&Solution) -> anyhow::Result<()>,
    &Option<serde_json::Map<String, serde_json::Value>>,
) -> anyhow::Result<()>;

fn run_algo(ch: &Challenge, solver: Solver) -> Option<(i64, u128)> {
    let cell: RefCell<Solution> = RefCell::new(Solution::new());
    let save: Box<dyn Fn(&Solution) -> anyhow::Result<()>> = Box::new(|s: &Solution| {
        *cell.borrow_mut() = s.clone();
        Ok(())
    });
    // unsafe-ish but ok for harness: we know cell lives until after solver returns
    let cell_ptr: *const RefCell<Solution> = &cell;
    let start = Instant::now();
    let res = catch_unwind(AssertUnwindSafe(|| solver(ch, &*save, &None)));
    let elapsed = start.elapsed().as_micros();
    drop(save);
    match res {
        Ok(Ok(_)) => {
            let sol = unsafe { (*cell_ptr).borrow().clone() };
            match ch.evaluate_total_value(&sol) {
                Ok(v) => Some((v as i64, elapsed)),
                Err(_) => None,
            }
        }
        _ => None,
    }
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().collect();
    let n_items: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(300);
    let budget: u32 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(50);
    let n_seeds: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(10);

    let track = Track { n_items, budget };

    let competitors: Vec<(&str, Solver)> = vec![
        ("ironclad_swap", ironclad::solve_challenge),
        ("fast_and_fun", fast_and_fun::solve_challenge),
        ("fast_and_furious", fast_and_furious::solve_challenge),
        ("knap_quality_opt", knap_quality_opt::solve_challenge),
        ("knap_supreme", knap_supreme::solve_challenge),
        ("knapsack_redone", knapsack_redone::solve_challenge),
        ("knapsplat_hyper_s", knapsplat_hyper_s::solve_challenge),
        ("knapsplatt", knapsplatt::solve_challenge),
        ("native_knapsack", native_knapsack::solve_challenge),
        ("near_knap", near_knap::solve_challenge),
        ("near_knap_v3", near_knap_v3::solve_challenge),
        ("near_knap_v4", near_knap_v4::solve_challenge),
        ("near_knap_improve_v1", near_knap_improve_v1::solve_challenge),
        ("relative_quad_fast", relative_quad_fast::solve_challenge),
    ];

    println!(
        "Full-field benchmark: n_items={}, budget={}%, seeds=0..{}",
        n_items, budget, n_seeds
    );
    println!();

    // Aggregates per-algorithm
    let mut sum_delta: Vec<i64> = vec![0; competitors.len()];
    let mut wins: Vec<usize> = vec![0; competitors.len()];
    let mut top_wins: Vec<usize> = vec![0; competitors.len()];
    let mut runs: Vec<usize> = vec![0; competitors.len()];
    let mut us: Vec<u128> = vec![0; competitors.len()];

    for seed_byte in 0..n_seeds as u8 {
        let mut seed = [0u8; 32];
        seed[0] = seed_byte;
        let challenge = Challenge::generate_instance(&seed, &track)?;

        let baseline_solution = challenge.compute_greedy_baseline()?;
        let baseline_value = challenge.evaluate_total_value(&baseline_solution)? as i64;

        let mut results: Vec<Option<(i64, u128)>> = Vec::with_capacity(competitors.len());
        for (_, solver) in &competitors {
            results.push(run_algo(&challenge, *solver));
        }

        let best_val = results.iter().filter_map(|r| r.as_ref().map(|(v, _)| *v)).max().unwrap_or(baseline_value);

        for (k, r) in results.iter().enumerate() {
            if let Some((v, t)) = r {
                sum_delta[k] += *v - baseline_value;
                if *v > baseline_value { wins[k] += 1; }
                if *v == best_val { top_wins[k] += 1; }
                runs[k] += 1;
                us[k] += *t;
            }
        }
    }

    // Sort competitors by avg Δ descending
    let mut idx: Vec<usize> = (0..competitors.len()).collect();
    idx.sort_by(|&a, &b| sum_delta[b].cmp(&sum_delta[a]));

    println!(
        "{:<24} {:>10} {:>14} {:>10} {:>12}",
        "algorithm", "Δ-avg", "wins-vs-base", "top-of-N", "avg-ms"
    );
    println!("{}", "-".repeat(76));
    for &k in &idx {
        let avg_delta = if runs[k] > 0 { sum_delta[k] as f64 / runs[k] as f64 } else { 0.0 };
        let avg_ms = if runs[k] > 0 { us[k] as f64 / runs[k] as f64 / 1000.0 } else { 0.0 };
        let runs_str = format!("{}/{}", wins[k], runs[k]);
        let top_str = format!("{}/{}", top_wins[k], runs[k]);
        println!(
            "{:<24} {:>10.1} {:>14} {:>10} {:>12.1}",
            competitors[k].0, avg_delta, runs_str, top_str, avg_ms
        );
    }

    Ok(())
}
