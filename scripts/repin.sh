#!/bin/sh
# repin.sh — points INSTALL-dashboard-body-block.html's <script src> at the
# current HEAD commit and commits that change.
#
# Usage, after editing dashboard-engine.js:
#   git add dashboard-engine.js && git commit -m "..."
#   sh scripts/repin.sh
#   git push
#
# The engine must be committed BEFORE re-pinning: the pin has to name a
# commit that already contains the new engine content, so a commit cannot
# pin to itself. That is why this is two commits (the code, then the pin)
# rather than one -- the same dance done by hand throughout this project.
#
# See scripts/verify-pin.sh for why SHA pinning is used instead of @main.

set -e
cd "$(git rev-parse --show-toplevel)"

BLOCK=INSTALL-dashboard-body-block.html
ENGINE=dashboard-engine.js

if [ -n "$(git status --porcelain -- "$ENGINE")" ]; then
  echo "repin: FAIL — $ENGINE has uncommitted changes." >&2
  echo "  Commit it first, then re-run. The pin must name a commit that" >&2
  echo "  already contains the engine you want served." >&2
  exit 1
fi

SHA=$(git rev-parse HEAD)
HEAD_BLOB=$(git rev-parse "HEAD:$ENGINE")
LOCAL_BLOB=$(git hash-object "$ENGINE")

if [ "$HEAD_BLOB" != "$LOCAL_BLOB" ]; then
  echo "repin: FAIL — working copy of $ENGINE differs from HEAD." >&2
  exit 1
fi

OLD=$(sed -n 's|.*landmark-new-era@\([0-9a-f]\{40\}\)/dashboard-engine\.js.*|\1|p' "$BLOCK" | head -1)

if [ -z "$OLD" ]; then
  echo "repin: FAIL — no existing 40-char SHA pin found in $BLOCK to replace." >&2
  exit 1
fi

if [ "$OLD" = "$SHA" ]; then
  echo "repin: already pinned to $(echo "$SHA" | cut -c1-7) — nothing to do."
  exit 0
fi

sed -i "s|landmark-new-era@${OLD}/dashboard-engine\.js|landmark-new-era@${SHA}/dashboard-engine.js|" "$BLOCK"

if [ -z "$(git status --porcelain -- "$BLOCK")" ]; then
  echo "repin: FAIL — substitution did not change $BLOCK." >&2
  exit 1
fi

git add "$BLOCK"
git commit -q -m "Re-pin dashboard-engine.js CDN URL to $(echo "$SHA" | cut -c1-7)"

echo "repin: $(echo "$OLD" | cut -c1-7) -> $(echo "$SHA" | cut -c1-7), committed."
echo "repin: remember to re-paste $BLOCK into Ontraport after pushing."
sh scripts/verify-pin.sh
