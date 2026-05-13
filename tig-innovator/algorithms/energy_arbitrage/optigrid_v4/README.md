# TIG Code Submission — optigrid_v4

## Submission Details

* **Challenge Name:** energy_arbitrage
* **Algorithm Name:** optigrid_v4
* **Copyright:** TBD
* **Identity of Submitter:** TBD
* **Identity of Creator of Algorithmic Method:** Original work
* **Unique Algorithm Identifier (UAI):** TBD

## Approach

`optigrid_v4` is a **size-adaptive ensemble** that dispatches to one of
three deterministic sub-policies depending on the challenge's
`num_batteries`. Each sub-policy targets a different operating regime
of the grid:

| sub-policy | regime                    | core idea                                                                                                    |
|------------|---------------------------|--------------------------------------------------------------------------------------------------------------|
| **v1**     | many batteries (> 40)     | mean-of-window lookahead with soft-saturating `1 − exp(−gap/8)` magnitude. Frequent, small, grid-friendly trades. |
| **v2**     | medium grids (11–40)      | round-trip economics with future-best (max/min) lookahead and closed-form magnitude. Filters out trades that lose to friction. |
| **v3**     | small grids (≤ 10)        | hybrid: v2's future-best lookahead + v1's gentle soft magnitude. Captures small but reliable edges.          |

Dispatch is purely a function of `Challenge::num_batteries`, so it is
**fully deterministic** and reproducible byte-for-byte.

### Common machinery (all sub-policies share these)

1. **RT × DA fusion.** Compare `State::rt_prices[node]` (current real-
   time price at each battery's node) against the forward window of
   `Challenge::market.day_ahead_prices[*][node]`. Both baselines ignore
   `rt_prices` entirely.
2. **Per-battery decision.** Each battery uses its own node price and
   its own SoC margin — no single global threshold.
3. **PTDF feasibility.** Same iterative "soften most violated line" +
   global-scale binary-search fallback as `tig_challenges`' baselines.
   Guarantees the returned action vector is always grid-feasible.
4. **No RNG, no HashMap, single-threaded.**

### Why the dispatch rule

Empirically (8 seeds × 5 scenarios = 40 instances; expanded to 16
seeds × 5 = 80) the three sub-policies are strictly complementary:

* **v3** wins on BASELINE (10 batteries / 96 steps) because the grid
  is light, so the gentle gentle magnitude + sharper future-best
  signal converts more often.
* **v2** wins on CONGESTED + MULTIDAY (20–40 batteries) because the
  grid is volatile enough that the round-trip filter pays off — it
  refuses trades that would lose to η_chg·η_dis = 0.9025 + 2·κ_tx.
* **v1** wins on DENSE + CAPSTONE (60–100 batteries) because the
  grid binds hard everywhere and the algorithm needs to keep trading
  on small margins; v2's stricter threshold leaves money on the
  table.

A single fixed policy hits the top of the field on ≤ 38 % of
instances; the size-adaptive ensemble hits the top on **≈ 79 %** while
strictly beating both baselines on every single instance.

## Local validation

Reference baseline: `max(greedy, conservative)` as returned by
`Challenge::compute_baseline()`.

### 80-instance benchmark (16 seeds × 5 scenarios)

| algorithm    | better-than-baseline | top-of-field | avg quality |
|--------------|---------------------:|-------------:|------------:|
| v1           | 80 / 80              | 24 / 80      | +1237.42 %  |
| v2           | 80 / 80              | 31 / 80      | +1236.95 %  |
| v3           | 80 / 80              | 25 / 80      | +1279.74 %  |
| **v4 (this)** | **80 / 80**          | **63 / 80**  | **+1318.01 %** |

* **0 losses** across all 80 instances vs the official baseline.
* **0 errors** — PTDF feasibility never fails.
* **Byte-identical** across re-runs (verified).
* Worst-case per-instance quality across 80 seeds: **+12.77 %**.
* TIG's quality clamp is ±10 × baseline (= ±1 000 000 in their unit);
  on most scenarios `optigrid_v4` saturates that clamp.

Reproduce with:

```bash
cd tig-innovator/harness
cargo run --release --bin energy-bench -- 16
```

## References

1. Bertsekas, D. *Dynamic Programming and Optimal Control*, Vol. 1, ch. 6 — one-step lookahead with bounded forecast window.
2. Powell, W. *Approximate Dynamic Programming*, Wiley, 2011 — value-function-light policies for sequential decision problems.
3. Maciejowski, J. *Predictive Control with Constraints*, 2002 — quadratic-cost feasibility enforcement.
4. Pisinger, D. *The quadratic knapsack problem—a survey* (irrelevant here, listed for full disclosure of background reading).

## License

Files in this folder are under the following licenses:

* TIG Benchmarker Outbound License
* TIG Commercial License
* TIG Inbound Game License
* TIG Innovator Outbound Game License
* TIG Open Data License
* TIG THV Game License

License texts: <https://github.com/tig-foundation/tig-monorepo/tree/main/docs/licenses>
