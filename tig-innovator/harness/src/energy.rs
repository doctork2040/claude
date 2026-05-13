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
mod optigrid_v1;

#[path = "../../algorithms/energy_arbitrage/optigrid_v2/mod.rs"]
mod optigrid_v2;

#[path = "../../algorithms/energy_arbitrage/optigrid_v3/mod.rs"]
mod optigrid_v3;

#[path = "../../algorithms/energy_arbitrage/optigrid_v4/mod.rs"]
mod optigrid_v4;

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
        "{:<10} {:>4}  {:>10}  {:>9}  {:>9}  {:>9}  {:>9}    {}",
        "scenario", "seed", "baseline$", "v1", "v2", "v3", "v4", "winner"
    );
    println!("{}", "-".repeat(90));

    let mut sum_q = [0.0f64; 4];
    let mut better_baseline = [0usize; 4];
    let mut top_of_field = [0usize; 4];
    let mut n = 0;

    for (name, scen) in &scenarios {
        let track = Track { s: scen.clone() };
        for seed_byte in 0..n_seeds as u8 {
            let mut seed = [0u8; 32];
            seed[0] = seed_byte;
            let challenge = Challenge::generate_instance(&seed, &track)?;

            reset_optimize_flag();
            let (_, baseline_profit) = challenge.compute_baseline()?;

            let v1 = run_solver(&challenge, |ch, st| optigrid_v1::policy(ch, st)).unwrap_or(0.0);
            let v2 = run_solver(&challenge, |ch, st| optigrid_v2::policy(ch, st)).unwrap_or(0.0);
            let v3 = run_solver(&challenge, |ch, st| optigrid_v3::policy(ch, st)).unwrap_or(0.0);
            let v4 = run_solver(&challenge, |ch, st| optigrid_v4::policy(ch, st)).unwrap_or(0.0);
            let vs = [v1, v2, v3, v4];

            for k in 0..4 {
                if vs[k] > baseline_profit + 1e-6 { better_baseline[k] += 1; }
                let q = if baseline_profit.abs() > 1e-6 {
                    (vs[k] - baseline_profit) / baseline_profit.abs() * 100.0
                } else { 0.0 };
                sum_q[k] += q;
            }
            let max_v = vs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            for k in 0..4 {
                if (vs[k] - max_v).abs() < 1e-6 { top_of_field[k] += 1; }
            }
            n += 1;

            let winner_idx = (0..4).max_by(|&a, &b| vs[a].partial_cmp(&vs[b]).unwrap()).unwrap();
            let winner = ["v1", "v2", "v3", "v4"][winner_idx];

            println!(
                "{:<10}  {:02x}   {:>10.2}   {:>9.2}  {:>9.2}  {:>9.2}  {:>9.2}    {}",
                name, seed_byte, baseline_profit, v1, v2, v3, v4, winner
            );
        }
    }

    println!("{}", "-".repeat(90));
    let names = ["v1", "v2", "v3", "v4"];
    for k in 0..4 {
        println!(
            "{:<3} better-than-baseline {}/{},  top-of-field {}/{},  avg q = {:+.2}%",
            names[k], better_baseline[k], n, top_of_field[k], n, sum_q[k] / n.max(1) as f64
        );
    }
    Ok(())
}
