#!/usr/bin/env bash
# Open an interactive shell inside the official TIG dev image for a given
# challenge. The dev image ships rustc, the challenge crate, and helper
# scripts (list_algorithms, download_algorithm, test_algorithm).
#
# Usage: ./scripts/dev_shell.sh <challenge> [extra docker args...]

set -euo pipefail

CHALLENGE="${1:-}"
shift || true

if [[ -z "$CHALLENGE" ]]; then
  echo "Usage: $0 <challenge> [extra docker args]" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TIG_ROOT="$ROOT/tig"

# Load .env if present
if [[ -f "$ROOT/tig-innovator/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/tig-innovator/.env"
  set +a
fi

VERSION="${TIG_IMAGE_VERSION:-0.0.5}"
IMAGE="ghcr.io/tig-foundation/tig-monorepo/${CHALLENGE}/dev:${VERSION}"

# Detect GPU availability for GPU challenges
GPU_FLAGS=()
case "$CHALLENGE" in
  vector_search|hypergraph|neuralnet_optimizer)
    if command -v nvidia-smi >/dev/null 2>&1; then
      GPU_FLAGS=(--gpus all)
    else
      echo "WARN: $CHALLENGE is a GPU challenge but no nvidia-smi found." >&2
    fi
    ;;
esac

echo "Pulling $IMAGE (if needed)..."
docker pull "$IMAGE"

echo "Mounting $TIG_ROOT -> /tig (read-write)"
exec docker run --rm -it \
  "${GPU_FLAGS[@]}" \
  -v "$TIG_ROOT:/tig" \
  -w /tig \
  "$@" \
  "$IMAGE" \
  bash
