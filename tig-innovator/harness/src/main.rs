// Local harness: run ironclad_swap against tig-challenges baseline.
// Bypasses hide_verification by depending on tig-challenges directly.

use std::cell::RefCell;
use std::env;
use tig_challenges::knapsack::{Challenge, Solution, Track};

#[path = "../../algorithms/knapsack/ironclad_swap/mod.rs"]
mod ironclad;

fn main() -> anyhow::Result<()> {
    // CLI: harness <n_items> <budget_pct> [n_seeds]
    let args: Vec<String> = env::args().collect();
    let n_items: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(50);
    let budget: u32 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(50);
    let n_seeds: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(5);

    let track = Track { n_items, budget };
    println!("Track: n_items={}, budget={}%", n_items, budget);
    println!("Running {} seeds, comparing ironclad_swap vs tabu_search baseline", n_seeds);
    println!();

    let mut wins = 0;
    let mut ties = 0;
    let mut losses = 0;
    let mut sum_quality = 0i64;

    for seed_byte in 0..n_seeds as u8 {
        let mut seed = [0u8; 32];
        seed[0] = seed_byte;
        let challenge = Challenge::generate_instance(&seed, &track)?;

        // Baseline (tabu_search via compute_greedy_baseline)
        let baseline_solution = challenge.compute_greedy_baseline()?;
        let baseline_value = challenge.evaluate_total_value(&baseline_solution)? as i64;

        // Our algorithm
        let solution_cell: RefCell<Solution> = RefCell::new(Solution::new());
        let save = |s: &Solution| -> anyhow::Result<()> {
            *solution_cell.borrow_mut() = s.clone();
            Ok(())
        };
        ironclad::solve_challenge(&challenge, &save, &None)?;
        let our_solution = solution_cell.into_inner();
        let our_value = challenge.evaluate_total_value(&our_solution)? as i64;

        // quality = (mine - baseline) / baseline   (scaled by 1e6 in the protocol)
        let q_pct = if baseline_value > 0 {
            (our_value as f64 - baseline_value as f64) / baseline_value as f64 * 100.0
        } else {
            0.0
        };
        sum_quality += our_value - baseline_value;

        let tag = if our_value > baseline_value { wins += 1; "WIN " }
                  else if our_value == baseline_value { ties += 1; "TIE " }
                  else { losses += 1; "LOSS" };

        println!(
            "seed={:02x}  baseline={:>8}  ironclad={:>8}  Δ={:+8}  q={:+6.2}%  [{}]",
            seed_byte, baseline_value, our_value, our_value - baseline_value, q_pct, tag
        );
    }

    println!();
    println!("Summary: {} wins, {} ties, {} losses out of {}", wins, ties, losses, n_seeds);
    println!("Average Δ value vs baseline = {:.1}", sum_quality as f64 / n_seeds as f64);

    Ok(())
}
