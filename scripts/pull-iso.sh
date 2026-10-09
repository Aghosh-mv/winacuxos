#!/usr/bin/env bash
# Copies the built ISO out of the build volume and onto the Mac.
#
# The ISO stays inside Colima during builds so a nearly-full Mac disk cannot
# kill a 40-minute build. Run this when you actually want the file (to boot it,
# upload it, or share it).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VOLUME="winacuxos-build"
OUT="$ROOT/build-out"
mkdir -p "$OUT"

names=$(docker run --rm -v "$VOLUME":/build debian:trixie-slim \
        sh -c 'ls -1 /build/*.iso 2>/dev/null' || true)

if [ -z "$names" ]; then
    echo "!! no ISO in the build volume - run scripts/build.sh first" >&2
    exit 1
fi

for name in $names; do
    echo "==> copying $(basename "$name")"
    docker run --rm \
        -v "$VOLUME":/build:ro \
        -v "$OUT":/out \
        debian:trixie-slim \
        cp "/build/$(basename "$name")" "/out/$(basename "$name")"
done

echo "==> verifying the copy"
for name in $names; do
    src_size=$(docker run --rm -v "$VOLUME":/build:ro debian:trixie-slim \
                   stat -c %s "/build/$(basename "$name")" | tr -d '[:space:]')
    dst_size=$(stat -f %z "$OUT/$(basename "$name")" 2>/dev/null || echo 0)
    if [ "$src_size" != "$dst_size" ]; then
        echo "!! truncated copy: source $src_size bytes, destination $dst_size bytes" >&2
        echo "   the ISO is still in the VM volume - retry before stopping Colima" >&2
        exit 1
    fi
    echo "    $(basename "$name"): $dst_size bytes, complete"
done

ls -lh "$OUT"/*.iso