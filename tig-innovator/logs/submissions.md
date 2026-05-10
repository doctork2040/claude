# Submission Log

매 제출 직후 한 줄씩 추가. 7일 단위로 `./scripts/my_status.sh`로 adoption/reward 갱신.

| 일자 | challenge | algo_name | 상태 | tx hash | 시작 idea | 비고 |
|------|-----------|-----------|------|---------|-----------|------|
| 2026-05-10 | knapsack | ironclad_swap | **로컬 검증 완료, 미제출** | — | steepest-ascent 1-1 swap + deterministic kick-restart | n=50/200/500 모두 baseline ≥, 1승 4무 0패 (n=200, seeds 0..4). 결정적, hyperparameters 지원 |

## Iteration ideas backlog

- [ ] knapsack — 2-1 swap (선택 1개 빼고 미선택 2개 넣기) 추가하면 큰 인스턴스에서 더 이김
- [ ] knapsack — 그리디 시작점을 다중화 (top-K ratio + reverse-greedy + random rotate) → 가장 좋은 시작점 채택
- [ ] knapsack — fuel 예산이 허용하면 outer 루프 max_kicks=128로 늘리기
- [ ] satisfiability — WalkSAT 변형 후보. ironclad_swap 제출 후 검토
- [ ] CUR 활성화 모니터링 — `tig/tig-challenges/src/cur_approximation/` 등장 여부 주간 체크

## Retired / superseded

- _none_
