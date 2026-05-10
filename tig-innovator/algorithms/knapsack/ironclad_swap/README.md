# TIG Code Submission — ironclad_swap

## Submission Details

* **Challenge Name:** knapsack
* **Algorithm Name:** ironclad_swap
* **Copyright:** TBD
* **Identity of Submitter:** TBD
* **Identity of Creator of Algorithmic Method:** Original work
* **Unique Algorithm Identifier (UAI):** TBD

## Approach

Deterministic steepest-ascent local search with bounded kick-restart for
the **Quadratic Knapsack** challenge:

1. **Greedy initialisation** by `(value + Σ interaction) / weight` — same
   starting point as the official tabu-search baseline.
2. **Incremental cache** `interaction_sum[x] = values[x] + Σ_{s ∈ selected} V[x][s]`
   updated in O(n) per accepted swap.
3. **Steepest-ascent inner loop** — scan every (selected, unselected)
   pair plus pure additions; take the single best strictly-improving
   move; repeat until locally optimal. Δ for a 1-1 swap is computed in
   O(1) via the cache:
   `Δ = interaction_sum[in] − interaction_sum[out] − V[in][out]`.
4. **Deterministic kick** — when locally optimal, evict the K (=3)
   currently-selected items with the lowest `interaction_sum`, then
   re-fill greedily by `(interaction_sum + value) / weight`. Re-enter
   inner loop. Up to `max_kicks` rounds.
5. **Best-so-far guard** — every accepted local optimum is compared
   against the recorded best; the best is re-saved at the end.

### Determinism

- No randomness, no `HashMap`/`HashSet`.
- Single-threaded.
- Same `(weights, values, interaction_values, max_weight)` always
  produces the same `Solution`. Validated locally against
  `seed = 0..4` for `n_items ∈ {50, 200, 500}`.

### Hyperparameters (optional)

```json
{ "kick_size": 3, "max_kicks": 32 }
```

## Local validation

Reference baseline: `tig_challenges::knapsack::baselines::tabu_search`
(100-iteration tabu local search, `compute_greedy_baseline`).

| n_items | budget | seeds | wins | ties | losses | avg Δ |
|---------|--------|-------|------|------|--------|-------|
| 50      | 50%    | 5     | 1    | 4    | 0      | +2.0  |
| 200     | 50%    | 5     | 1    | 4    | 0      | +5.6  |
| 500     | 50%    | 3     | 1    | 2    | 0      | +44.0 |

Never below baseline; quality ≥ 0 stable. Reproduce with:

```bash
cd tig-innovator/harness
cargo run --release -- 200 50 5
```

## References

1. Pisinger, D. *The quadratic knapsack problem—a survey.* Discrete Applied Mathematics 155.5 (2007).
2. Glover, F., Kochenberger, G. *Critical event tabu search for multidimensional knapsack problems.* (1996).
3. Lourenço, Martin, Stützle. *Iterated local search.* Handbook of Metaheuristics (2003).

## License

Files in this folder are under the following licenses:

* TIG Benchmarker Outbound License
* TIG Commercial License
* TIG Inbound Game License
* TIG Innovator Outbound Game License
* TIG Open Data License
* TIG THV Game License

License texts: <https://github.com/tig-foundation/tig-monorepo/tree/main/docs/licenses>
