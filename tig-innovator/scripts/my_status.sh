#!/usr/bin/env bash
# my_status.sh — 내 player_id의 알고리즘 + 보상 현황
#
# Usage:
#   ./scripts/my_status.sh [mainnet|testnet]
#
# .env의 TIG_PLAYER_ADDRESS를 사용. 없으면 인자로 player_id 가능:
#   ./scripts/my_status.sh mainnet 0xabc...
#
# Requires: curl, jq

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$ROOT/.env" ]] && { set -a; . "$ROOT/.env"; set +a; }

NET="${1:-mainnet}"
case "$NET" in
  mainnet) API="https://mainnet-api.tig.foundation" ;;
  testnet) API="https://testnet-api.tig.foundation" ;;
  *) echo "Usage: $0 [mainnet|testnet] [player_id]" >&2; exit 1 ;;
esac

PLAYER="${2:-${TIG_PLAYER_ADDRESS:-}}"
if [[ -z "$PLAYER" || "$PLAYER" == "0x0000000000000000000000000000000000000000" ]]; then
  echo "ERR: set TIG_PLAYER_ADDRESS in tig-innovator/.env or pass as 2nd arg" >&2
  exit 1
fi
PLAYER=$(echo "$PLAYER" | tr 'A-Z' 'a-z')

echo "Network : $NET"
echo "Player  : $PLAYER"
echo

BLOCK=$(curl -fsS -H "User-Agent: tig-innovator/0.1" "$API/get-block" | jq -r '.block.id')
echo "block_id = $BLOCK"
echo

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

curl -fsS -H "User-Agent: tig-innovator/0.1" "$API/get-player-data?block_id=$BLOCK&player_id=$PLAYER" >"$TMP/p.json"
curl -fsS -H "User-Agent: tig-innovator/0.1" "$API/get-algorithms?block_id=$BLOCK" >"$TMP/a.json"
curl -fsS -H "User-Agent: tig-innovator/0.1" "$API/get-challenges?block_id=$BLOCK" >"$TMP/c.json"

echo "=== Reward (this block) ==="
jq -r '
  .player.block_data.reward_by_type
  | to_entries
  | map("  \(.key): \(.value)")
  | join("\n")
' "$TMP/p.json" 2>/dev/null || echo "  (no data)"
echo

echo "=== Submitted code algorithms ==="
jq --arg p "$PLAYER" '
  .codes | map(select(.details.player_id == $p))
' "$TMP/a.json" >"$TMP/mine.json"

COUNT=$(jq 'length' "$TMP/mine.json")
echo "Total: $COUNT"
[[ "$COUNT" -eq 0 ]] && { echo "  (none yet — submit at https://play.tig.foundation)"; exit 0; }

# challenge_id -> name lookup
jq -r '.challenges[] | [.id, .details.name] | @tsv' "$TMP/c.json" > "$TMP/cmap.tsv"

jq -r '.[] | [
  .details.challenge_id,
  .details.name,
  (.block_data.adoption // "0"),
  (.block_data.reward // "0")
] | @tsv' "$TMP/mine.json" \
  | while IFS=$'\t' read -r CID NAME ADOPT REWARD; do
      CNAME=$(awk -F'\t' -v id="$CID" '$1==id {print $2}' "$TMP/cmap.tsv")
      printf "  [%s] %-30s adopt=%s reward=%s\n" "${CNAME:-$CID}" "$NAME" "$ADOPT" "$REWARD"
    done

echo
echo "=== Submitted advances ==="
jq --arg p "$PLAYER" '.advances | map(select(.details.player_id == $p)) | length' "$TMP/a.json"
