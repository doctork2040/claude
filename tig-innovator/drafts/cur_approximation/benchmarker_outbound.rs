// DRAFT — TIG CUR Decomposition Challenge skeleton
//
// Spec source: tig-innovator/refs/cur_approximation.pdf (TIG Labs, 2026-01)
// This challenge is NOT yet active in tig-monorepo as of writing. The Rust
// API (Challenge / Solution / save_solution / hyperparameters) below mirrors
// the convention used by existing challenges (see e.g.
//   tig/tig-algorithms/src/knapsack/template.rs
// ) and MUST be reconciled against the official tig-challenges crate once
// `tig-challenges/src/cur_approximation/` ships upstream.

#![allow(dead_code, unused_variables)]

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

// Placeholder until upstream lands. Replace with:
//   use tig_challenges::cur_approximation::*;
mod cur_types {
    use serde::{Deserialize, Serialize};

    #[derive(Serialize, Deserialize)]
    pub struct Challenge {
        pub seed: [u8; 32],
        // m x n input matrix in row-major flat layout
        pub a: Vec<f64>,
        pub m: usize,
        pub n: usize,
        // requested rank for this call (one of [k/l2, k/l3, k/l4])
        pub target_rank: usize,
    }

    #[derive(Serialize, Deserialize)]
    pub struct Solution {
        // Indices into the original columns of A (length == c, c <= target_rank)
        pub col_indices: Vec<usize>,
        // Indices into the original rows of A (length == r, r <= target_rank)
        pub row_indices: Vec<usize>,
        // Linking matrix U in R^{c x r}, row-major flat
        pub u: Vec<f64>,
    }
}
use cur_types::*;

#[derive(Serialize, Deserialize, Default)]
pub struct Hyperparameters {
    /// Oversampling factor over target_rank for column/row selection.
    /// Common practice: 1.5–2.0× for randomised methods.
    pub oversample: Option<f64>,
    /// "leverage" | "deim" | "qr_pivoted"
    pub strategy: Option<String>,
}

pub fn help() {
    println!("CUR Approximation — DRAFT skeleton.");
    println!("Strategies (set via hyperparameters.strategy):");
    println!("  leverage    — leverage-score sampling (Mahoney–Drineas)");
    println!("  deim        — Discrete Empirical Interpolation Method");
    println!("  qr_pivoted  — column/row pivoted QR (default fallback)");
}

pub fn solve_challenge(
    challenge: &Challenge,
    save_solution: &dyn Fn(&Solution) -> Result<()>,
    hyperparameters: &Option<Map<String, Value>>,
) -> Result<()> {
    let hp: Hyperparameters = match hyperparameters {
        Some(h) => serde_json::from_value(Value::Object(h.clone()))
            .map_err(|e| anyhow!("hyperparameters: {e}"))?,
        None => Hyperparameters::default(),
    };
    let strategy = hp.strategy.as_deref().unwrap_or("qr_pivoted");
    let oversample = hp.oversample.unwrap_or(1.5);

    // -----------------------------------------------------------------
    // Plan:
    //   1. Use challenge.seed to seed a deterministic RNG (SmallRng).
    //   2. Compute (or approximate) leverage scores of A:
    //        - Either via partial SVD of A^T A
    //        - Or via Johnson-Lindenstrauss sketching + QR (faster for large m,n)
    //   3. Select c ≤ target_rank columns and r ≤ target_rank rows:
    //        - "leverage": probability ∝ leverage score
    //        - "deim": iteratively pick max-residual index
    //        - "qr_pivoted": column-pivoted QR on A (and on A^T for rows)
    //   4. Form C = A[:, col_indices], R = A[row_indices, :].
    //   5. Solve U = pinv(C) · A · pinv(R) (linking matrix).
    //   6. save_solution(&Solution { col_indices, row_indices, u }).
    //
    // Determinism notes (cf. tig-algorithms templates):
    //   - Use `rand::rngs::SmallRng::from_seed(challenge.seed)` everywhere.
    //   - For HashMap/HashSet: `crate::seeded_hasher(&challenge.seed)`.
    //   - No floating-point reductions whose order depends on threading
    //     unless the spec accepts a tolerance — keep it single-threaded
    //     until the official spec is published.
    // -----------------------------------------------------------------

    Err(anyhow!(
        "CUR draft skeleton: implementation pending official tig-challenges/cur_approximation API"
    ))
}

// IMPORTANT: do not include `#[cfg(test)]` blocks in this file before submission —
// TIG rejects submissions that contain tests.
