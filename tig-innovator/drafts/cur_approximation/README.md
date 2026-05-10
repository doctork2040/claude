# DRAFT — CUR Approximation Submission

> ⚠️ This challenge (`cur_approximation`) is **not yet active** in tig-monorepo
> as of the latest sync. Spec source: `../../refs/cur_approximation.pdf`
> (TIG Labs, January 2026). When the challenge ships upstream:
>
> 1. Re-sync `../../tig/` (`git -C ../../tig pull`).
> 2. Replace the placeholder `cur_types` module in
>    `benchmarker_outbound.rs` with `use tig_challenges::cur_approximation::*;`.
> 3. Move this folder under
>    `../../tig/tig-algorithms/src/cur_approximation/<algorithm_name>/`.
> 4. Fill in the metadata below and the official `template.md`.

## Submission Details

* **Challenge Name:** cur_approximation
* **Algorithm Name:** _TBD_
* **Copyright:** [year] [name]
* **Identity of Submitter:** [name or entity]
* **Identity of Creator of Algorithmic Method:** [if applicable]
* **Unique Algorithm Identifier (UAI):** [if applicable]

## Approach (planned)

Default strategy: **column/row pivoted QR** (deterministic, robust under
high coherence Δ). Optional strategies via `hyperparameters.strategy`:

- `leverage` — sample with probability proportional to leverage scores of
  the leading singular vectors. Theoretically near-optimal for incoherent
  matrices, weaker on coherent ones.
- `deim` — Discrete Empirical Interpolation Method. Greedy, deterministic,
  fast.
- `qr_pivoted` — pivoted QR on `A` (columns) and `Aᵀ` (rows). Stable and
  deterministic; good baseline.

The CUR reconstruction error is judged against SVD via

```
score = (κ·‖A − SVD‖_F − ‖A − CUR‖_F) / ((κ−1)·‖A − SVD‖_F)
```

Geometric mean over 3 target ranks, arithmetic mean over `l1` instances.
Because the score is `(baseline − solution) / (baseline − optimal)`, low
variance across instances is rewarded — favour deterministic methods over
random ones unless variance can be controlled.

## References

1. Mahoney & Drineas, "CUR matrix decompositions for improved data analysis", PNAS 2009.
2. Drineas, Magdon-Ismail, Mahoney, Woodruff, "Fast approximation of matrix coherence and statistical leverage", JMLR 2012.
3. Sorensen & Embree, "DEIM induced CUR factorization", SIAM J. Sci. Comput. 2016.
4. Voronin & Martinsson, "Efficient algorithms for CUR and interpolative matrix decompositions", Adv. Comput. Math. 2017.

## License

Will be released under TIG's standard set on submission:

* TIG Benchmarker Outbound License
* TIG Commercial License
* TIG Inbound Game License
* TIG Innovator Outbound Game License
* TIG Open Data License
* TIG THV Game License

License texts: <https://github.com/tig-foundation/tig-monorepo/tree/main/docs/licenses>
