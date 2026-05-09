#!/usr/bin/env bash
# Scaffold a new TIG algorithm folder under tig/tig-algorithms/src/<challenge>/<name>/
# from the challenge's template.rs / template.md.
#
# Usage: ./scripts/new_algorithm.sh <challenge> <algorithm_name>

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <challenge> <algorithm_name>" >&2
  echo "Available challenges: satisfiability, vehicle_routing, knapsack, vector_search," >&2
  echo "                     hypergraph, neuralnet_optimizer, job_scheduling, energy_arbitrage" >&2
  exit 1
fi

CHALLENGE="$1"
NAME="$2"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TIG_ROOT="$ROOT/tig"
SRC="$TIG_ROOT/tig-algorithms/src/$CHALLENGE"
DEST="$SRC/$NAME"

if [[ ! -d "$TIG_ROOT" ]]; then
  echo "ERROR: $TIG_ROOT does not exist." >&2
  echo "Clone first: git clone https://github.com/tig-foundation/tig-monorepo.git $TIG_ROOT" >&2
  exit 1
fi

if [[ ! -d "$SRC" ]]; then
  echo "ERROR: challenge '$CHALLENGE' not found at $SRC" >&2
  exit 1
fi

if [[ -e "$DEST" ]]; then
  echo "ERROR: $DEST already exists." >&2
  exit 1
fi

mkdir -p "$DEST"
cp "$SRC/template.rs" "$DEST/benchmarker_outbound.rs"
cp "$SRC/template.md" "$DEST/README.md"

# Replace placeholder algorithm name in README
sed -i "s|\[name of submission\]|$NAME|g" "$DEST/README.md"

cat <<EOF
Scaffolded $DEST/
  - benchmarker_outbound.rs   (implement solve_challenge here)
  - README.md                 (fill in submission metadata)

Next:
  1. Edit benchmarker_outbound.rs
  2. Test in dev container:
       ./scripts/dev_shell.sh $CHALLENGE
       # inside container:
       test_algorithm $NAME <difficulty>
  3. When ready, submit at https://play.tig.foundation (Innovation -> Submission)
EOF
