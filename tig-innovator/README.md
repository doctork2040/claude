# TIG Innovator 워크스페이스

TIG (The Innovation Game)에서 **Innovator**로 참여하여 알고리즘을 제출하고 토큰
보상을 받기 위한 로컬 작업 공간입니다.

> 공식 문서: <https://docs.tig.foundation/innovators>
> 업스트림 저장소: <https://github.com/tig-foundation/tig-monorepo>

---

## 1. 개요 — Innovator는 무엇을 하나

TIG는 과학적으로 의미 있는 계산 문제(challenges)에 대한 알고리즘을 제출하면
benchmarker가 그 알고리즘을 proof-of-work로 실행하면서 가장 효율적인 알고리즘이
채택되도록 설계된 프로토콜입니다. 두 가지 제출 방식이 있습니다.

| 제출 종류 | 형태 | 비용 | 보상 경로 |
|----------|------|------|-----------|
| **Code Submission** | Rust(.rs) + 선택적 CUDA(.cu) 소스 | **10 $TIG** | benchmarker가 해당 알고리즘으로 PoW 채택 시 |
| **Advance Submission** | 알고리즘적 진보를 설명하는 문서(Markdown / paper) | **250 $TIG** (deposit) | TIG 토큰 홀더 투표로 advance reward 결정 |

> ⚠️ **Code submission은 한 번 제출하면 수정 불가**입니다. 충분히 테스트한 뒤
> 제출하세요.

---

## 2. 현재 challenge 목록 (8개)

| ID | Challenge | 분류 | 디바이스 |
|----|-----------|------|---------|
| c001 | satisfiability        | Boolean SAT                            | CPU |
| c002 | vehicle_routing       | Capacitated VRP with Time Windows      | CPU |
| c003 | knapsack              | Quadratic Knapsack                     | CPU |
| c004 | vector_search         | Vector Range Search                    | GPU |
| c005 | hypergraph            | Hypergraph Partitioning                | GPU |
| c006 | neuralnet_optimizer   | Neural Network Optimizer               | GPU |
| c007 | job_scheduling        | Flexible Job Shop Scheduling           | CPU |
| c008 | energy_arbitrage      | Energy Market Arbitrage                | CPU |

각 challenge의 상세 설명은
`../tig/tig-challenges/src/<challenge_name>/README.md` 참고.

---

## 3. 사전 준비

1. **지갑** — Ethereum L2 **Base** 체인용 지갑(EOA). 제출/수수료 결제는 `$TIG`
   토큰으로 진행되며 Base 체인에 배포된 ERC-20입니다 (`tig-token` crate 참고).
2. **$TIG 잔고** — Code 제출 10 $TIG, Advance 제출 250 $TIG.
3. **Rust toolchain** — `rustc >= 1.70`. (`rustup install stable`)
4. **Docker** — 공식 dev 이미지를 쓰면 challenge별 의존성/CUDA가 미리 설정되어
   있습니다.
5. **TIG 계정** — <https://play.tig.foundation/dashboard>에서 지갑 연결.
6. **(GPU challenge의 경우)** NVIDIA GPU + 최신 드라이버, 또는 클라우드 GPU.

`.env.example`을 `.env`로 복사하고 필요한 값을 채우세요. `.env`는 git에서 제외됩니다.

---

## 4. 디렉토리 구조

```
/home/user/claude/
├── tig/                        # tig-monorepo 클론 (gitignored, upstream)
│   ├── tig-algorithms/src/<challenge>/  # 여기에 알고리즘 폴더 생성
│   ├── tig-challenges/         # challenge 정의 (Challenge / Solution 타입)
│   └── docs/                   # 가이드, 라이선스, whitepaper
└── tig-innovator/              # 본 워크스페이스 (이 폴더)
    ├── README.md               # ← 이 파일
    ├── .env.example
    └── scripts/
        ├── new_algorithm.sh    # 새 알고리즘 폴더 스캐폴딩
        ├── dev_shell.sh        # 공식 dev 이미지 컨테이너 진입
        └── test_local.sh       # 로컬 테스트 헬퍼
```

---

## 5. Code Submission 워크플로우

### 5.1. 새 알고리즘 스캐폴드

```bash
# 사용법: ./scripts/new_algorithm.sh <challenge> <algorithm_name>
./scripts/new_algorithm.sh knapsack my_first_knap
```

이 스크립트는 다음을 수행합니다:

- `tig/tig-algorithms/src/<challenge>/<algorithm_name>/` 생성
- 같은 challenge의 `template.rs`, `template.md`을 복사 후 이름 치환
- 구현 시작점 `benchmarker_outbound.rs`로 저장 (제출 시 사용되는 파일명)

### 5.2. 알고리즘 시그니처

`benchmarker_outbound.rs`는 다음 형태의 `solve_challenge` 함수를 export합니다.

```rust
use tig_challenges::<challenge_name>::*;

pub fn solve_challenge(
    challenge: &Challenge,
    save_solution: &dyn Fn(&Solution) -> Result<()>,
    hyperparameters: &Option<Map<String, Value>>,
) -> Result<()> {
    // ... save_solution(&Solution { ... })?; ...
    Ok(())
}
```

규칙:

- 결정성(determinism)이 매우 중요합니다 — `runtime_signature` 검증에 사용됨.
  `HashMap`/`HashSet`은 반드시 `seeded_hasher(&challenge.seed)` 사용.
  난수는 `SmallRng::from_seed(challenge.seed)` 사용.
- `save_solution(&Solution)`을 여러 번 호출 가능. **마지막** 호출이 평가됩니다.
- 테스트 코드(`#[test]`, `#[cfg(test)]`)를 파일에 포함하면 제출 거부됨.
- 평가 지표는 challenge별로 다르며 6자리 고정소수점 정수(quality)로 표현.

### 5.3. 로컬 테스트 (Docker)

```bash
./scripts/dev_shell.sh knapsack         # ghcr.io/.../tig-monorepo/knapsack/dev 진입
# 컨테이너 내부:
list_algorithms
test_algorithm my_first_knap <difficulty>
```

`dev` 이미지는 컨테이너 안에서 자동으로 `CHALLENGE` 환경변수를 설정합니다.
`--testnet` 플래그를 붙이면 testnet difficulty 분포로 테스트할 수 있습니다.

### 5.4. 제출

1. <https://play.tig.foundation> → **Innovation** 탭 → **Submission** 페이지
2. `<algorithm_name>/` 폴더 내 `.rs` 파일들 + (선택) `.cu` + `README.md` 선택
3. **Submit Algorithm** 클릭 → 지갑 서명 + **10 $TIG** 차감
4. 제출 후 `tig-monorepo`에 `<challenge_name>\<algorithm_name>` 패턴의 브랜치가
   생성되고, 5종 라이선스(commercial / open_data / benchmarker_outbound /
   innovator_outbound / inbound) 변형이 자동 발행됩니다.
5. 제출 직후부터 benchmarker가 채택할 수 있고, 채택률(adoption)에 따라
   block reward의 일부가 innovator pool로 분배됩니다.

> 보상 산식 상세: <https://docs.tig.foundation/rewards/code-reward>

---

## 6. Advance Submission 워크플로우

새로운 알고리즘적 진보(novel method)를 청구하려면 별도의 Advance 제출:

1. 진보 내용을 정리한 `.md`(또는 paper)를 작성.
   템플릿은 `tig/tig-algorithms/advances/<challenge>/template.md` 참고.
2. `advances@tig.foundation`로 메일.
   - **Subject**: `Advance Submission (<ADVANCE>)`
   - 본문에 disclosure, 청구 내용, 코드 링크 포함
3. **250 $TIG**가 Available Fee Balance에서 차감.
4. TIG 토큰 홀더 투표(voting guidelines: `../tig/docs/guides/voting.md`)로
   advance 자격이 결정됨. 자격을 얻으면 advance reward 풀에서 분배.
5. TIG Foundation이 출원 가능한 기술적 효과에 대해 임시 특허 출원할 수 있음
   (이를 원하지 않으면 Advance 제출을 하지 않으면 됨).

---

## 7. 라이선스 요약 (반드시 확인)

`tig-monorepo`에 코드를 제출하면 다음이 동시에 적용됩니다:

- **TIG Inbound Game License** — TIG에 라이선스 부여
- **TIG Open Data License** — 공동 협업용 share-alike
- **TIG Innovator Outbound** — 다른 innovator들이 파생 작업에 사용 가능
- **TIG Benchmarker Outbound** — benchmarker가 PoW용으로 사용 가능
- **TIG Commercial License** — 상업적 사용자에게 유료 라이선스

전체 텍스트는 `../tig/docs/licenses/`에 있고, 해설은
`../tig/docs/guides/anatomy.md` (`Anatomy of TIG Licensing`) 참고.

> 제출하는 코드가 본인 저작이거나, MIT/BSD/Apache 등 호환 라이선스의 코드여야
> 합니다. 비-permissive 라이선스(예: GPL) 코드 사용 시 제출 거부됨.

---

## 8. 토큰 마이닝과의 연결

- TIG의 보상은 **OPoW (Optimisable Proof of Work)** 기반.
- **Benchmarker**가 채택한 알고리즘의 양/지속성에 따라, 해당 알고리즘의
  **Innovator**에게 매 블록마다 토큰이 분배됩니다 (code-reward).
- Advance 제출이 인정되면 별도 advance-reward 풀에서 추가 분배.
- 즉, "토큰 마이닝"을 위해서는:
  1. 빠르고 결정적인 알고리즘 제출 (code reward)
  2. 또는 새로운 알고리즘적 방법론 청구 (advance reward)
  중 한 가지 이상을 수행하면 됩니다.

---

## 9. 다음 단계

1. `cp .env.example .env` 후 값 채우기
2. 어떤 challenge로 시작할지 선택 (CPU만 가능하다면 satisfiability/knapsack/
   vehicle_routing/job_scheduling/energy_arbitrage 추천)
3. `./scripts/new_algorithm.sh <challenge> <name>`으로 스캐폴드
4. `tig/tig-challenges/src/<challenge>/README.md`에서 문제 정의 정독
5. `benchmarker_outbound.rs` 구현 → `./scripts/dev_shell.sh <challenge>`로
   컨테이너 진입 후 `test_algorithm`으로 검증
6. 충분히 결정적이고 baseline 대비 quality > 0이 안정적으로 나오면 제출

---

## 참고 링크

- TIG 문서 홈: <https://docs.tig.foundation/>
- Innovator 가이드: <https://docs.tig.foundation/innovators>
- Code Submission: <https://docs.tig.foundation/innovating/code-submission>
- Developing Your Algorithm: <https://docs.tig.foundation/innovating/code-submission/developing-algorithm>
- Advance Submission: <https://docs.tig.foundation/innovating/advance-submission>
- Code vs Advances: `../tig/docs/guides/advances.md`
- Voting Guidelines: `../tig/docs/guides/voting.md`
- Whitepaper: `../tig/docs/whitepaper.pdf`
- Discord: <https://discord.gg/tigfoundation>
- Dashboard: <https://play.tig.foundation/dashboard>
