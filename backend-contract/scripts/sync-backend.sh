#!/usr/bin/env bash
# Vendor the backend-contract fixtures + generated JSON Schemas into the
# girder_volview backend so its tests consume the SAME artifacts (one
# normative source in VolView, a synced copy in the backend — never
# hand-edited).
#
# Usage:
#   backend-contract/scripts/sync-backend.sh <BACKEND_REPO>
# BACKEND_REPO (required): path to the girder_volview checkout to vendor into.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pkg_dir="$(dirname "$here")"
if [ $# -lt 1 ]; then
  echo "usage: backend-contract/scripts/sync-backend.sh <BACKEND_REPO>" >&2
  exit 2
fi
backend_repo="$1"
dest="$backend_repo/tests/contract"

if [ ! -d "$backend_repo" ]; then
  echo "backend repo not found: $backend_repo" >&2
  exit 1
fi

# Regenerate the JSON Schemas + the published OpenAPI first so the copy is never
# stale (both land in generated/, both are vendored below). One entry point wraps
# BOTH generators so the pipeline cannot be run half-way.
(cd "$pkg_dir/.." && npm run --silent contract:generate)

# Refuse a dirty sync BEFORE mutating the destination. A dirty contract subtree
# would vendor artifacts that cannot be reconstructed from client_git_sha,
# silently breaking provenance. Checking the CANONICAL subtree here — after
# regeneration, so a stale checked-in generated/ also trips it, and before any
# rm/cp — guarantees a refused sync leaves the backend tree untouched (and lets
# client_git_dirty below be a constant false).
if [ -n "$(git -C "$pkg_dir" status --porcelain -- "$pkg_dir")" ]; then
  echo "backend-contract subtree has uncommitted changes; commit (and regen) before syncing" >&2
  git -C "$pkg_dir" status --porcelain -- "$pkg_dir" >&2
  exit 1
fi

mkdir -p "$dest"
rm -rf "$dest/fixtures" "$dest/generated"
cp -R "$pkg_dir/fixtures" "$dest/fixtures"
cp -R "$pkg_dir/generated" "$dest/generated"

# Write a content-addressed manifest over EVERYTHING copied so the vendored copy
# is tamper-evident: the backend's test_contract_manifest re-hashes
# these files against it, catching a hand-edited fixture AND a stale/partial sync
# (a file present-but-unlisted or listed-but-missing both fail the re-hash). The
# manifest itself is excluded (it lives at the tests/contract root, outside the
# copied subtrees). Sorted for a deterministic, diff-friendly manifest.
(
  cd "$dest"
  LC_ALL=C find fixtures generated -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > MANIFEST.sha256
)

# --- Provenance stamp: make the vendored copy self-describing so a
# reader (and the backend's own test_contract_source) can see WHICH client commit
# / version it was synced from, and self-certify the tree against a single digest.
# This does NOT by itself prove the copy is CURRENT -- that is the client's
# verify-backend.sh step, the only checker that can see both trees. Written OUTSIDE
# the manifested subtrees, so it is not covered by MANIFEST.sha256 (which hashes
# only those subtrees); its own integrity rides tree_sha256 below.
contract_version="$(node -p "require('$dest/generated/openapi.json').info.version")"
spec_version="$(grep -oE 'SPEC_VERSION = [0-9]+' "$pkg_dir/processing/task-spec.ts" | grep -oE '[0-9]+')"
intent_version="$(grep -oE 'INTENT_VOCABULARY_VERSION = [0-9]+' "$pkg_dir/processing/wire.ts" | grep -oE '[0-9]+')"
client_sha="$(git -C "$pkg_dir" rev-parse --short HEAD)"
# Always false: the pre-copy guard above already refused any dirty subtree, so a
# sync that reaches this point is provably clean.
client_dirty=false
# tree_sha256 = sha256 of MANIFEST.sha256, which already provably equals the
# copied tree, so hashing it transitively certifies fixtures/ + generated/.
tree_sha256="$(sha256sum "$dest/MANIFEST.sha256" | cut -d' ' -f1)"

cat > "$dest/SOURCE.txt" <<EOF
# Provenance of the vendored backend-contract copy.
# Written by backend-contract/scripts/sync-backend.sh -- DO NOT hand-edit.
# tree_sha256 = sha256 of MANIFEST.sha256; the backend test re-derives it.
contract_version=$contract_version
spec_version=$spec_version
intent_vocabulary_version=$intent_version
client_git_sha=$client_sha
client_git_dirty=$client_dirty
tree_sha256=$tree_sha256
EOF

echo "synced fixtures + generated schemas (+ MANIFEST.sha256 + SOURCE.txt) -> $dest"
