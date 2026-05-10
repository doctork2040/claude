# Strategy Notes — TIG Whitepaper v2.2.1 + CUR Challenge Spec

첨부된 두 문건(`refs/TIG_WP_2.2.1.pdf`, `refs/cur_approximation.pdf`)에서 Innovator 전략에 직접 영향을 주는 부분만 정리.

---

## 1. OPoW 보상 공식 (Whitepaper §2.1)

Benchmarker `i`가 challenge `x`에 제출한 qualifying solution 수를 `f_x^i`라 하자.

```
f̂_x^i  = f_x^i / Σ_j f_x^j        # (challenge x에 대한 점유율)
⟨f̂⟩^i = (1/n) Σ_y f̂_y^i           # (모든 challenge에 대한 평균 점유율)
σ^i    = sqrt( (1/n) Σ_y (⟨f̂⟩^i − f̂_y^i)^2 )
CV^i   = σ^i / ⟨f̂⟩^i

R^i ∝ ⟨f̂⟩^i · exp( − k · (CV^i)^2 / (n−1) )
```

핵심:

- `⟨f̂⟩^i` (평균 점유율) ↑ → reward ↑
- `CV^i` (challenge간 분산도) ↑ → reward는 **지수적으로 감쇠**
- 즉, **모든 challenge에서 균일하게 잘하는 것이 한 challenge에서만 압도적인 것보다 유리**.
- `k`는 parity 위반에 대한 페널티 강도. n은 challenge 개수.

### Innovator에게 시사하는 것

1. **알고리즘이 채택되려면 benchmarker가 그것을 켜는 게 자기 reward에 도움이 되어야 함.** Benchmarker는 parity를 유지하려고 하므로:
   - 단일 challenge에서 100배 빠른 알고리즘 < 모든 challenge에서 평균적으로 빠른 묶음
   - 신규/덜 경쟁적인 challenge에 진입하면 **그 challenge에서의 점유율 한계 효용이 큼**.
2. 보상 풀은 **모든 challenge가 공유**하므로 challenge 개수가 늘어나면 challenge당 reward가 희석됨 → 토큰 홀더 투표가 challenge 추가/은퇴를 통제. 신규 challenge 초기에 진입하면 경쟁 적음.

### "Rowing boat" 비유 (Whitepaper Figure 3)

n명의 노잡이 중 한 명이 100배 강해도 다른 노잡이들과 박자가 맞아야 하므로 boat 속도 향상은 제한적이다 → super-rower 효과 제한 → monopoly 방지. **Innovator 입장에서는: 약한 challenge들을 노리는 게 reward 한계 기여가 크다.**

---

## 2. CUR Decomposition Challenge (초안 — 2026-01)

> ⚠️ 이 challenge는 아직 활성화되지 않았고 스펙도 초안 (l1, l2, l3, l4, l5 상수 미정).
> 하지만 신규 challenge는 **초기 진입 = 낮은 경쟁**이라는 이점이 있음.

### 문제

`A ∈ R^{m×n}` 입력에 대해 다음 형태의 low-rank approximation을 구한다:

```
A ≈ C · U · R
```

- `C ∈ R^{m×c}` — A의 실제 열들 중 c개
- `R ∈ R^{r×n}` — A의 실제 행들 중 r개
- `U ∈ R^{c×r}` — linking matrix

CUR의 가치: SVD와 달리 **원래 행/열을 보존**하므로 해석가능, sparsity 친화적. 유전체학·이미징·추천 시스템에서 사용.

### 인스턴스 생성 (요약)

1. `G_U ∈ R^{m×k}`, `G_V ∈ R^{n×k}` Gaussian iid N(0,1) sampling, `D = diag(d_j)`로 열을 스케일 (`max d_j = Δ`, `min d_j = 1`, 선형 감쇠 → coherence 제어).
2. QR로 직교화: `G_U·D = U·R`, `G_V·D = V·R`.
3. 특이값:  `σ(j) = exp( −l5 · √j / √k )`. l1번 무작위 permutation.
4. `A_i = U · Σ_i · V^T` (i = 1..l1).

### 평가

- 3개의 target rank: `[k/l2, k/l3, k/l4]` (k = ⌊min(m,n)/2⌋).
- 인스턴스 i, 각 target rank에 대해 점수:

```
       κ · ‖A_i − SVD_i‖_F  −  ‖A_i − CUR_i‖_F
score = ───────────────────────────────────────────
              (κ − 1) · ‖A_i − SVD_i‖_F
```

- (baseline − solution) / (baseline − optimal) 형태. baseline = κ·optimal, optimal = SVD.
- 인스턴스별: 3개 target rank에 대한 **기하평균**.
- 최종 quality: 인스턴스들의 **산술평균**.

### Innovator 시그니처 (예상)

`solve_challenge(A, target_rank)` → `(C, U, R)` 반환. 아직 공식 Rust API는 미공개이므로 기존 challenge 패턴(`Challenge`/`Solution`, `save_solution` 콜백)을 따를 가능성이 큼.

### 알고리즘 출발점 후보

1. **Leverage-score sampling** (Mahoney–Drineas) — 각 행/열의 leverage score `ℓ_i = ‖U_i,:‖²`로 가중 샘플링. 이론적으로 최적 보장.
2. **DEIM (Discrete Empirical Interpolation Method)** — 결정적, 빠름.
3. **Pivoted QR / strong RRQR** — 안정적, 결정적.
4. **CountSketch + leverage approx** (Drineas–Magdon-Ismail–Mahoney–Woodruff [4]) — 큰 m,n에 유리.
5. **Cross-Approximation / ACA** — 매우 빠르지만 coherent matrix에서 불안정.

> 채점이 SVD 대비 ratio이고 baseline = κ·optimal 형태이므로, **결정적 + 결과의 분산이 작은 알고리즘이 평균 점수에서 유리**. coherence Δ가 클수록 균일 샘플링은 실패 → **leverage-based** 또는 **rank-revealing factorization** 필요.

### 비대칭성 (§6)

- 인스턴스 생성: U, V 한 번 + l1번 곱셈 → 빠름.
- 검증: `‖A_i − SVD_i‖_F = (Σ_{j>target_rank} σ_j²)^{1/2}` — 이미 알고 있는 σ로 즉시 계산 가능 → 빠름.
- 따라서 알고리즘 풀이 시간이 생성·검증보다 충분히 길어야 함 (asymmetric 조건). 이는 m, n이 충분히 클 것을 시사.

### 미정 상수

| 상수 | 의미 |
|------|------|
| `l1` | 인스턴스당 생성하는 행렬 개수 |
| `l2, l3, l4` | target rank 분모 (`k/l2`, `k/l3`, `k/l4`) |
| `l5` | 특이값 감쇠 계수 |
| `Δ` | coherence 제어 (cur 문서: 고정, 추후 가변 가능) |
| `κ` | baseline = κ·optimal에서의 배수, 채점 정규화 |

l1~l5와 κ는 TIG 측에서 캘리브레이션할 값들. **확정 시 README로 업데이트 필요**.

---

## 3. 라이선스 — Whitepaper §2.2 정리

Whitepaper에서 명확히 한 5종 라이선스:

1. **TIG Inbound Game License** — 제출 시 적용. TIG에 IP 권리 부여.
2. **TIG Open Data License** — share-alike. **Output Data를 배포하면 Relevant Data(입력 데이터+재현 정보)도 공개해야 함**. 일반적인 copyleft가 source 배포 시에만 트리거되는 것과 차별화.
3. **TIG Innovator Outbound** — 다른 innovator 파생작업용 게이트.
4. **TIG Benchmarker Outbound** — benchmarker가 PoW로 사용하는 게이트.
5. **TIG Commercial** — 유료. Open Data License의 데이터 공개 의무 면제. fee는 토큰으로 지불 → **토큰 수요의 원천**.

핵심 차별점: 전통적 dual licensing이 아닌, **데이터 공개 의무**까지 묶은 share-alike. ML/과학 연구 도메인을 의식한 설계.

---

## 4. 운영 전략 체크리스트

- [ ] 진입 challenge 결정. CPU 가능하면 신규성·경쟁도를 고려: **CUR은 곧 추가될 가능성**이 있어 좋은 후보. 현재 활성화된 challenge 중에는 advance reward 풀에 진입한 영역(예: `energy_arbitrage`, `job_scheduling` 등 비교적 새로운 8번대) 검토.
- [ ] benchmarker 시뮬레이터로 자기 알고리즘이 parity 유지에 기여할지 가늠 (다른 challenge들 baseline 시간 대비 자신의 알고리즘 속도).
- [ ] 결정성(determinism) 확보: `seeded_hasher(challenge.seed)`, `SmallRng::from_seed`. Runtime signature 검증 통과 필수.
- [ ] 라이선스 호환성 확인: 본인 저작 또는 MIT/BSD/Apache. GPL/AGPL 등은 거부됨.
- [ ] CUR 활성화 모니터링: tig-monorepo의 `tig-challenges/src/`에 `cur_approximation/` 디렉토리가 추가되는 시점.

---

## 참고 위치

- 전체 PDF: `refs/TIG_WP_2.2.1.pdf`, `refs/cur_approximation.pdf`
- CUR 알고리즘 초안 스켈레톤: `drafts/cur_approximation/` (활성화 전 예열용)
