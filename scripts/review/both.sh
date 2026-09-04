#!/usr/bin/env bash
# Both reviewers, sequentially. Merge bar: both APPROVE with no P1 or P2.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
BASE="${1:-origin/develop}"
scripts/review/frank.sh "$BASE"
echo
scripts/review/george.sh "$BASE"
