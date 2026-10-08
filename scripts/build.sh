#!/usr/bin/env bash
# Builds the WinacuxOS live ISO inside a Debian container.
#
# Why not a plain bind mount: the macOS bind mount is virtiofs, and live-build's
# tar-based package extraction fails on it ("Tried to extract package, but tar
# failed"). So the source is rsynced into the container's own filesystem, and a
# named volume keeps cache/ + chroot/ between runs so rebuilds stay fast.
#
# Usage:
#   scripts/build.sh            # rebuild (reuses cache/chroot)
#   scripts/build.sh --clean    # full rebuild from scratch
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="winacuxos-builder:latest"
VOLUME="winacuxos-build"
OUT="$ROOT/build-out"
CLEAN="${1:-}"

mkdir -p "$OUT"

echo "==> Building the builder image"
docker build -t "$IMAGE" "$ROOT/scripts"

echo "==> Building live image${CLEAN:+ (clean)}"
echo "    first build downloads ~2GB and takes 30-60 minutes"

docker run --rm --privileged \
    -e CLEAN="$CLEAN" \
    -v "$ROOT":/src:ro \
    -v "$VOLUME":/build \
    -v "$OUT":/out \
    "$IMAGE" bash -lc '
        set -euo pipefail
        mkdir -p /build
        rsync -a --delete \
            --exclude "cache/" \
            --exclude "chroot/" \
            --exclude "build-out/" \
            --exclude "*.iso" \
            --exclude "*.log" \
            /src/ /build/
        cd /build

        if [ "$CLEAN" = "--clean" ]; then
            echo "==> lb clean --all"
            lb clean --all || true
            # lb clean keeps the bootstrap cache, which silently restores a
            # chroot from a previous architecture. nuke it explicitly.
            rm -rf /build/cache /build/chroot /build/auto /build/build
        fi

        echo "==> generating config"
        ./scripts/lb-config.sh

        echo "==> lb build"
        lb build

        if ls /build/*.iso >/dev/null 2>&1; then
            cp -v /build/*.iso /out/
        else
            echo "!! no ISO produced - inspect the build log above"
            exit 1
        fi
    '

echo
echo "==> Result:"
ls -lh "$OUT"/*.iso 2>/dev/null || echo "no ISO in $OUT"