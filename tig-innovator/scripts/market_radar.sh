#!/usr/bin/env bash
# market_radar.sh — TIG 알고리즘 시장 스냅샷
#
# 각 challenge에서 활성 code submission 수와 누적 reward를 집계하여
# "어디에 진입하면 한계 reward가 큰가"를 보여준다.
#
# OPoW 보상 공식 (R_i ∝ ⟨f̂⟩·exp(−k·CV²/(n−1))) 상, benchmarker는 모든
# challenge에서 균일하게 채굴해야 reward가 최대화되므로, 활성 알고리즘이
# 적거나 reward 집중도가 높은 challenge가 신규 Innovator에게 매력적이다.
#
# Usage:
#   ./scripts/market_radar.sh [mainnet|testnet]
#
# Requires: curl, jq

set -euo pipefail

NET="${1:-mainnet}"
case "$NET" in
  mainnet) API="https://mainnet-api.tig.foundation" ;;
  testnet) API="https://testnet-api.tig.foundation" ;;
  *) echo "Usage: $0 [mainnet|testnet]" >&2; exit 1 ;;
esac

echo "Fetching latest block from $API ..."
BLOCK_RAW=$(curl -fsS -H "User-Agent: tig-innovator/0.1" "$API/get-block" 2>&1) || {
  echo "ERR: $API/get-block failed:" >&2
  echo "$BLOCK_RAW" | tail -3 >&2
  echo "Hint: this network may rate-limit or block your IP. Try the other network," >&2
  echo "      or run from a residential network." >&2
  exit 1
}
BLOCK=$(echo "$BLOCK_RAW" | jq -r '.block.id')
[[ -z "$BLOCK" || "$BLOCK" == "null" ]] && { echo "ERR: no block id in response" >&2; exit 1; }
echo "block_id = $BLOCK"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsS -H "User-Agent: tig-innovator/0.1" "$API/get-challenges?block_id=$BLOCK" >"$TMPDIR/challenges.json"
curl -fsS -H "User-Agent: tig-innovator/0.1" "$API/get-algorithms?block_id=$BLOCK" >"$TMPDIR/algos.json"

# challenge_id -> name lookup
jq -r '.challenges[] | [.id, .details.name] | @tsv' "$TMPDIR/challenges.json" \
  | sort > "$TMPDIR/cmap.tsv"

echo
echo "=== Per-challenge market snapshot ==="
printf "%-22s %-6s %-12s %-12s %s\n" "challenge" "codes" "sum_adopt" "sum_reward" "top_player"

# Aggregate codes by challenge_id. PreciseNumber values are large integer
# strings (1e18 scaled), so we keep them as strings and divide for display.
jq -r '
  .codes[]
  | [
      .details.challenge_id,
      .details.player_id,
      (.block_data.adoption // "0"),
      (.block_data.reward // "0")
    ]
  | @tsv
' "$TMPDIR/algos.json" \
  | awk -F'\t' '
      {
        ch=$1; pl=$2; ad=$3; rw=$4
        codes[ch]++
        # Treat first 18 digits trimmed as integer for ranking only
        adopt[ch] = adopt[ch] " " ad
        reward[ch] = reward[ch] " " rw
        # Track top player by adoption per challenge
        gsub(/[^0-9]/,"",ad)
        if (length(ad) > length(top_ad[ch]) || (length(ad)==length(top_ad[ch]) && ad>top_ad[ch])) {
          top_ad[ch]=ad; top_pl[ch]=pl
        }
      }
      END {
        for (ch in codes) printf "%s\t%d\t%s\t%s\n", ch, codes[ch], top_pl[ch], top_ad[ch]
      }
    ' > "$TMPDIR/agg.tsv"

# Join with challenge names
join -t $'\t' -1 1 -2 1 \
  <(sort "$TMPDIR/agg.tsv") \
  <(sort "$TMPDIR/cmap.tsv") 2>/dev/null \
  | awk -F'\t' '
      { printf "%-22s %-6d top=%s\n", $5, $2, ($3=="" ? "-" : $3) }
    ' \
  | sort

echo
echo "=== Empty / unrepresented challenges (opportunity!) ==="
join -t $'\t' -1 1 -2 1 -v 2 \
  <(cut -f1 "$TMPDIR/agg.tsv" | sort -u) \
  <(sort "$TMPDIR/cmap.tsv") 2>/dev/null \
  | awk -F'\t' '{ printf "  - %s (id=%s)\n", $2, $1 }'

echo
TOTAL_CODES=$(jq -r '.codes | length' "$TMPDIR/algos.json")
TOTAL_ADV=$(jq -r '.advances | length' "$TMPDIR/algos.json")
echo "Totals: $TOTAL_CODES code submissions, $TOTAL_ADV advances across all challenges."
echo
echo "Strategy reminder (refs/NOTES.md):"
echo "  - Fewer codes in a challenge => higher marginal adoption gain."
echo "  - Benchmarkers are penalised for parity violation, so they want one"
echo "    fast algorithm in EVERY challenge. Empty/sparse challenges mean a"
echo "    new submission can become 'the' default quickly."
