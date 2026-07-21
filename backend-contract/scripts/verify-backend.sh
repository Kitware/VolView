#!/usr/bin/env bash
# The ACTUAL cross-repo drift guard. The backend's own tests can only
# self-certify its vendored copy (present, well-formed, internally consistent);
# only the client (the normative source) can prove that copy is CURRENT, and only
# where the backend tree is reachable. Regenerate the client contract, then diff
# the canonical client tree against the backend's vendored copy. A nonzero exit
# means the backend is stale -- someone regenerated the contract without re-running
# sync-backend.sh.
#
#   backend-contract/scripts/verify-backend.sh [--no-generate] <BACKEND_REPO>
# BACKEND_REPO (required): path to the girder_volview checkout to diff against.
#
# --no-generate: skip regeneration and diff the already-checked-in artifacts.
# Use this when running from an INSTALLED npm package (node_modules/volview/
# backend-contract), where the shipped artifacts are guaranteed fresh by the
# client's own CI (the generated-schema vitest spec + `npm test` on every
# commit), so no zod/tsx toolchain is needed at the consumer. Without it, the
# script regenerates first (the in-repo path, where source can be edited).
#
# CI-enforced: the backend repo's `paired-contract` workflow job checks out an
# explicitly pinned VolView revision alongside this backend and runs this script
# (see girder_volview `.github/workflows/ci.yml`), so a stale vendored copy fails
# CI, not only a local pre-push check. It also remains runnable on a dev machine.
# An explicitly supplied backend path is a required gate: a missing contract tree
# is an error, not a skip.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pkg_dir="$(dirname "$here")"
generate=1
if [ "${1:-}" = "--no-generate" ]; then
  generate=
  shift
fi
if [ $# -lt 1 ]; then
  echo "usage: backend-contract/scripts/verify-backend.sh [--no-generate] <BACKEND_REPO>" >&2
  exit 2
fi
backend_repo="$1"
dest="$backend_repo/tests/contract"

if [ ! -d "$dest" ]; then
  echo "verify-backend: backend contract tree not present: $dest" >&2
  exit 1
fi

# Regenerate so we compare against fresh output, never a stale working copy.
# Skipped under --no-generate (installed-package path): the shipped artifacts are
# already the client's freshly-generated, CI-verified output.
if [ -n "$generate" ]; then
  (cd "$pkg_dir/.." && npm run --silent contract:generate)
fi

status=0
for sub in fixtures generated; do
  if ! diff -r "$pkg_dir/$sub" "$dest/$sub"; then
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  echo "" >&2
  echo "BACKEND CONTRACT IS STALE: the vendored copy differs from the client" >&2
  echo "contract above. Run: backend-contract/scripts/sync-backend.sh" >&2
  exit 1
fi
echo "verify-backend: backend vendored contract is in sync."
