#!/usr/bin/env bash
# One-shot test of an algorithm at a given difficulty inside the dev container.
#
# Usage: ./scripts/test_local.sh <challenge> <algorithm_name> <difficulty>
# Example: ./scripts/test_local.sh knapsack my_first_knap 50

set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <challenge> <algorithm_name> <difficulty>" >&2
  exit 1
fi

CHALLENGE="$1"
NAME="$2"
DIFFICULTY="$3"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TIG_ROOT="$ROOT/tig"

if [[ -f "$ROOT/tig-innovator/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/tig-innovator/.env"
  set +a
fi

VERSION="${TIG_IMAGE_VERSION:-0.0.5}"
IMAGE="ghcr.io/tig-foundation/tig-monorepo/${CHALLENGE}/dev:${VERSION}"

GPU_FLAGS=()
case "$CHALLENGE" in
  vector_search|hypergraph|neuralnet_optimizer)
    if command -v nvidia-smi >/dev/null 2>&1; then
      GPU_FLAGS=(--gpus all)
    fi
    ;;
esac

docker pull "$IMAGE"

exec docker run --rm -it \
  "${GPU_FLAGS[@]}" \
  -v "$TIG_ROOT:/tig" \
  -w /tig \
  "$IMAGE" \
  test_algorithm "$NAME" "$DIFFICULTY"
