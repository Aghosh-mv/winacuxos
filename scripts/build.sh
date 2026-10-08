#!/usr/bin/env bash
# Builds the WinacuxOS live ISO inside a Debian container.
#
# Why not a plain bind mount: the macOS bind mount is virtiofs and live-build's
# tar-based package extraction fails on it. The tree is rsynced into the
# container's own filesystem; a named volume keeps cache/ + chroot/ between runs
# so rebuilds are quick.
#
# Usage:
#   scripts/build.sh                 rebuild (reuses cache/chroot)
#   scripts/build.sh --clean         full rebuild from scratch
#   scripts/build.sh --clean --slim  fast, small image for visual iteration
#   scripts/build.sh --export        also copy the ISO onto the Mac
#
# Environment:
#   WCX_ARCH=arm64|amd64   target architecture (default arm64 = native here)
#   WINACUX_AI=0|1         build llama.cpp + fetch a model (default 1)
#   WCX_SLIM=1             skip the heavy app/dev package lists
#
# The ISO stays inside the VM's Docker volume by default, because a ~3 GB copy
# onto a nearly-full Mac disk is how builds die. Fetch it when you need it:
#
#   scripts/pull-iso.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="winacuxos-builder:latest"
VOLUME="winacuxos-build"
OUT="$ROOT/build-out"
ARCH="${WCX_ARCH:-arm64}"
SLIM="${WCX_SLIM:-0}"
EXPORT=0
CLEAN=0

for arg in "$@"; do
    case "$arg" in
        --clean) CLEAN=1 ;;
        --slim) SLIM=1 ;;
        --export) EXPORT=1 ;;
        *) echo "unknown option: $arg" >&2; exit 1 ;;
    esac
done

mkdir -p "$OUT"

echo "==> Building the builder image"
docker build -t "$IMAGE" "$ROOT/scripts"

echo "==> Building live image for $ARCH${CLEAN:+ (clean)}${SLIM:+ (slim)}"

docker run --rm --privileged \
    -e CLEAN="$CLEAN" \
    -e WINACUX_AI="${WINACUX_AI:-1}" \
    -e WCX_ARCH="$ARCH" \
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

        if [ "$CLEAN" = "1" ]; then
            echo "==> lb clean --all"
            lb clean --all || true
            # lb clean keeps the bootstrap cache, which silently restores a
            # chroot from a previous architecture. nuke it explicitly.
            rm -rf /build/cache /build/chroot /build/auto /build/build
        fi

        # Slim mode: park the heavy lists so the image stays small and fast.
        SLIM="${WCX_SLIM:-0}"
        for list in dev apps; do
            if [ "$SLIM" = "1" ] && [ -f "config/package-lists/$list.list" ]; then
                mv "config/package-lists/$list.list" "config/package-lists/$list.list.skip"
            fi
        done

        echo "==> generating config"
        ./scripts/lb-config.sh

        echo "==> lb build"
        lb build

        for list in dev apps; do
            [ -f "config/package-lists/$list.list.skip" ] && \
                mv "config/package-lists/$list.list.skip" "config/package-lists/$list.list"
        done

        ls -lh /build/*.iso 2>/dev/null || {
            echo "!! no ISO produced - inspect the build log above"
            exit 1
        }
    '

echo
echo "==> ISO is inside the build volume. Fetch it with: scripts/pull-iso.sh"
if [ "$EXPORT" -eq 1 ]; then
    "$ROOT/scripts/pull-iso.sh"
fi