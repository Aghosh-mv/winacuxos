#!/usr/bin/env bash
# Verifies that every package in config/package-lists/*.list exists in the
# Debian archive (trixie, amd64). Run this before every build: apt failing on a
# typo 40 minutes into a build is a bad afternoon.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIRROR="${DEBIAN_MIRROR:-http://deb.debian.org/debian}"
SUITE="${DEBIAN_SUITE:-trixie}"
COMPONENTS="main contrib non-free non-free-firmware"

echo "==> fetching package lists for $SUITE ($COMPONENTS)"
available=$(for component in $COMPONENTS; do
    curl -sL "$MIRROR/dists/$SUITE/$component/binary-amd64/Packages.xz" | xzcat |
        sed -n 's/^Package: //p'
done | sort -u)

wanted=$(cat "$ROOT"/config/package-lists/*.list |
    sed -e 's/#.*$//' -e 's/[[:space:]]*$//' |
    grep -v '^$' | sort -u)

missing=0
while read -r pkg; do
    if ! grep -qx "$pkg" <<< "$available"; then
        echo "  MISSING: $pkg"
        missing=$((missing + 1))
    fi
done <<< "$wanted"

total=$(wc -l <<< "$wanted" | tr -d ' ')
echo "==> checked $total packages, $missing missing"

if [ "$missing" -gt 0 ]; then
    exit 1
fi