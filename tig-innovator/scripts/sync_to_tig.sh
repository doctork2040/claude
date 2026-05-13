#!/usr/bin/env bash
# sync_to_tig.sh — Mirror tig-innovator/algorithms/<challenge>/<name>/ into
# tig/tig-algorithms/src/<challenge>/<name>/ (as a symlink), and ensure
# `pub mod <name>;` is registered in tig/tig-algorithms/src/<challenge>/mod.rs.
#
# Run after a fresh `git clone` of tig-monorepo, or whenever you add a new
# algorithm under tig-innovator/algorithms/.
#
# Usage:  ./scripts/sync_to_tig.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_BASE="$ROOT/algorithms"
DST_BASE="$ROOT/../tig/tig-algorithms/src"

if [[ ! -d "$DST_BASE" ]]; then
  echo "ERROR: $DST_BASE not found. Clone tig-monorepo first:" >&2
  echo "  git clone https://github.com/tig-foundation/tig-monorepo.git $ROOT/../tig" >&2
  exit 1
fi

for chdir in "$SRC_BASE"/*/; do
  CH="$(basename "$chdir")"
  for algodir in "$chdir"*/; do
    NAME="$(basename "$algodir")"
    DEST="$DST_BASE/$CH/$NAME"

    # Skip if challenge folder doesn't exist upstream (challenge not active)
    if [[ ! -d "$DST_BASE/$CH" ]]; then
      echo "SKIP  $CH/$NAME — challenge '$CH' not present in upstream"
      continue
    fi

    # Replace any existing copy with a symlink to canonical.
    if [[ -e "$DEST" || -L "$DEST" ]]; then
      rm -rf "$DEST"
    fi
    ln -s "$(realpath --relative-to="$DST_BASE/$CH" "$algodir")" "$DEST"
    echo "LINK  $CH/$NAME -> $(readlink "$DEST")"

    # Ensure mod.rs registration
    MOD_RS="$DST_BASE/$CH/mod.rs"
    if [[ -f "$MOD_RS" ]] && ! grep -q "^pub mod $NAME;" "$MOD_RS"; then
      printf "\npub mod %s;\n" "$NAME" >> "$MOD_RS"
      echo "  + added 'pub mod $NAME;' to $CH/mod.rs"
    fi
  done
done

echo
echo "Done. Build with: (cd ../tig && cargo build -p tig-algorithms)"
