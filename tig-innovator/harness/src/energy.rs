// energy.rs — Local benchmark harness for the TIG energy_arbitrage
// challenge. Compares optigrid_v1 against the official two baselines
// (greedy + conservative) on every Scenario × seed combination.
//
// Note: tig-challenges' grid_optimize() may only be called once per
// Challenge instance (it flips a global atomic). We reset that flag
// between runs via the public CALLED_GRID_OPTIMIZE static.

use std::sync::atomic::Ordering;
use tig_challenges::energy_arbitrage::{
    Challenge, Scenario, Solution, State, Track, CALLED_GRID_OPTIMIZE,
};

#[path = "../../algorithms/energy_arbitrage/optigrid_v1/mod.rs"]
mod optigrid;

fn reset_optimize_flag() {
    CALLED_GRID_OPTIMIZE.store(false, Ordering::SeqCst);
}

fn run_solver<F>(challenge: &Challenge, policy: F) -> anyhow::Result<f64>
where
    F: Fn(&Challenge, &State) -> anyhow::Result<Vec<f64>>,
{
    reset_optimize_flag();
    let sol: Solution = challenge.grid_optimize(&policy)?;
    let profit = challenge.evaluate_total_profit(&sol)?;
    Ok(profit)
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let n_seeds: usize = args
        .get(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(5);

    let scenarios = [
        ("baseline", Scenario::BASELINE),
        ("congested", Scenario::CONGESTED),
        ("multiday", Scenario::MULTIDAY),
        ("dense", Scenario::DENSE),
        ("capstone", Scenario::CAPSTONE),
    ];

    println!(
        "Scenario     seed   baseline$    optigrid$    Δ        q (%)        tag"
    );
    println!("{}", "-".repeat(80));

    let mut total_wins = 0usize;
    let mut total_ties = 0usize;
    let mut total_losses = 0usize;
    let mut total_quality_sum = 0.0;
    let mut n_total = 0usize;

    for (name, scen) in &scenarios {
        let track = Track { s: scen.clone() };
        for seed_byte in 0..n_seeds as u8 {
            let mut seed = [0u8; 32];
            seed[0] = seed_byte;
            let challenge = Challenge::generate_instance(&seed, &track)?;

            // 1. Pre-compute baseline (max of greedy + conservative).
            reset_optimize_flag();
            let (baseline_sol, baseline_profit) = challenge.compute_baseline()?;
            let _ = baseline_sol;

            // 2. Run our algorithm.
            let our_result = run_solver(&challenge, |ch, st| optigrid::policy(ch, st));
            let our_profit = match our_result {
                Ok(p) => p,
                Err(e) => {
                    println!(
                        "{:<10}   {:02x}     {:>10.2}        ERR ({:.60})",
                        name, seed_byte, baseline_profit, e
                    );
                    continue;
                }
            };

            let delta = our_profit - baseline_profit;
            let q_pct = if baseline_profit.abs() > 1e-6 {
                delta / baseline_profit.abs() * 100.0
            } else {
                0.0
            };
            total_quality_sum += q_pct;
            n_total += 1;

            let tag = if our_profit > baseline_profit + 1e-6 {
                total_wins += 1;
                "WIN"
            } else if (our_profit - baseline_profit).abs() <= 1e-6 {
                total_ties += 1;
                "TIE"
            } else {
                total_losses += 1;
                "LOSS"
            };

            println!(
                "{:<10}   {:02x}    {:>10.2}   {:>10.2}   {:>+8.2}   {:>+8.2}%    {}",
                name, seed_byte, baseline_profit, our_profit, delta, q_pct, tag
            );
        }
    }

    println!("{}", "-".repeat(80));
    println!(
        "Summary: {} wins, {} ties, {} losses out of {}   avg q = {:+.2}%",
        total_wins,
        total_ties,
        total_losses,
        n_total,
        total_quality_sum / (n_total.max(1) as f64),
    );

    Ok(())
}
