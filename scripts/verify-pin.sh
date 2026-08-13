#!/bin/sh
# verify-pin.sh — fails if INSTALL-dashboard-body-block.html's pinned
# dashboard-engine.js SHA doesn't match the working copy of that file.
#
# This guards the one failure mode that is otherwise completely silent:
# editing dashboard-engine.js, committing it, and forgetting to update the
# <script src> pin. The live Ontraport page then keeps loading the OLD
# engine from jsDelivr forever, with no error anywhere.
#
# Why SHA pinning at all (measured 2026-08-13, don't undo this casually):
#   @main  -> Cache-Control: max-age=604800, s-maxage=43200
#             = 12h at the jsDelivr edge, and up to 7 DAYS in each
#               visitor's browser. A jsDelivr purge cannot clear browsers.
#   @<sha> -> Cache-Control: max-age=31536000, immutable
# The stale-content problem this project kept hitting is that contract,
# not a jsDelivr fault, so it will not "resolve itself" on @main.
#
# Comparison is done with git blob hashes rather than md5 of the bytes on
# disk, because core.autocrlf=true means the working copy is CRLF while the
# committed blob is LF -- a raw byte compare reports a false mismatch of
# exactly one byte per line. git hash-object applies the same clean filter
# git uses, so both sides are normalized the same way.

set -e
cd "$(git rev-parse --show-toplevel)"

BLOCK=INSTALL-dashboard-body-block.html
ENGINE=dashboard-engine.js

PIN=$(sed -n 's|.*landmark-new-era@\([0-9a-f]\{40\}\)/dashboard-engine\.js.*|\1|p' "$BLOCK" | head -1)

if [ -z "$PIN" ]; then
  echo "verify-pin: FAIL — no 40-char commit SHA pin found in $BLOCK." >&2
  echo "  If it is on @main or a short SHA, that is the bug — see header comment." >&2
  exit 1
fi

if ! git cat-file -e "${PIN}^{commit}" 2>/dev/null; then
  echo "verify-pin: FAIL — pinned commit $PIN is not in this clone." >&2
  echo "  Try: git fetch --all" >&2
  exit 1
fi

if ! PINNED_BLOB=$(git rev-parse "$PIN:$ENGINE" 2>/dev/null); then
  echo "verify-pin: FAIL — $ENGINE does not exist at commit $PIN." >&2
  exit 1
fi

LOCAL_BLOB=$(git hash-object "$ENGINE")

if [ "$PINNED_BLOB" = "$LOCAL_BLOB" ]; then
  echo "verify-pin: OK — $BLOCK pins $(echo "$PIN" | cut -c1-7), content matches working copy."
  exit 0
fi

echo "verify-pin: FAIL — $ENGINE does not match the SHA it is pinned to." >&2
echo "  pinned commit : $PIN" >&2
echo "  its blob      : $PINNED_BLOB" >&2
echo "  working copy  : $LOCAL_BLOB" >&2
echo "" >&2
echo "  Commit $ENGINE, then run: sh scripts/repin.sh" >&2
exit 1
