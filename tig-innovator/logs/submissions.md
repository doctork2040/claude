# Submission Log

매 제출 직후 한 줄씩 추가. 7일 단위로 `./scripts/my_status.sh`로 adoption/reward 갱신.

| 일자 | challenge | algo_name | 상태 | tx hash | 시작 idea | 비고 |
|------|-----------|-----------|------|---------|-----------|------|
| 2026-05-13 | knapsack | ironclad_swap | **검증 완료, 제출 보류** | — | tabu seed pass + steepest-ascent + deterministic kick | 정확성 OK·LOSS 0, but 경쟁자 3종(fast_and_fun, knap_supreme, knap_quality_opt) 대비 평균 quality 약 1/10. 강화 후 재평가 권장 |

### 경쟁 비교 (n=300, budget=50%, 10 seeds)

| 알고리즘 | Δ-avg vs baseline | wins/10 |
|----------|-------------------|---------|
| ironclad_swap | +4.8 | 2 |
| fast_and_fun | +63.0 | 10 |
| knap_supreme | +50.7 | 9 |
| knap_quality_opt | +66.5 | 10 |

→ 80% 인스턴스에서 우리는 baseline tie (quality = 0), 경쟁자는 strictly improve.
→ 현재 상태 제출 시 reward 기대값 ≈ 0. 알고리즘 강화 우선.

## Iteration ideas backlog

- [ ] **knapsack — 2-1 / 1-2 swap** (선택 1↔ 미선택 2 또는 그 반대). 큰 인스턴스에서 가장 흔히 막혀 있는 local optimum 탈출 수단
- [ ] **knapsack — DP backbone** (`fast_and_fun` 패턴): core-fixing으로 변수 일부를 결정하고 작은 subset에 대해서만 DP
- [ ] **knapsack — 다중 시작점** (top-K ratio 그리디 + reverse-greedy + 가중 perturbation)
- [ ] **knapsack — fuel-aware loop** — runtime 예산이 남아있으면 max_kicks 동적으로 늘리기
- [ ] satisfiability — WalkSAT 변형 후보. ironclad_swap 강화 후 두 번째 challenge 진출
- [ ] CUR 활성화 모니터링 — `tig/tig-challenges/src/cur_approximation/` 등장 여부 주간 체크

## Retired / superseded

- _none_
