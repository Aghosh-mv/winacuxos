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
    -e WCX_SLIM="$SLIM" \
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
            --exclude "ai/models/" \
            --exclude "ai/.venv/" \
            --exclude "ai/out/" \
            --exclude "artifacts/" \
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
        # Slim skips the big lists: dev toolchains, the app suite and the
        # non-free firmware blobs. None of it is needed to verify the desktop,
        # the shell extension or the AI in a virtual machine, and skipping them
        # cuts the chroot from ~9GB to ~3GB - which matters a lot on a laptop.
        for list in dev apps firmware; do
            if [ "$SLIM" = "1" ] && [ -f "config/package-lists/$list.list" ]; then
                mv "config/package-lists/$list.list" "config/package-lists/$list.list.skip"
            fi
        done

        # Marker file for hooks, because hook environments are sanitised.
        if [ "${WINACUX_AI:-1}" != "1" ]; then
            mkdir -p config/includes.chroot/etc
            touch config/includes.chroot/etc/winacuxos-skip-ai
        else
            rm -f config/includes.chroot/etc/winacuxos-skip-ai
        fi

        echo "==> generating config"
        ./scripts/lb-config.sh

        # Run the stages separately. This is not cosmetic: the chroot and the
        # package cache coexist on a 19GB VM disk, and purging the cache before
        # image assembly is the difference between a build that fits and one
        # that dies with "no space left on device".
        echo "==> lb bootstrap"
        lb bootstrap

        echo "==> lb chroot (packages + hooks)"
        lb chroot

        echo "==> disk usage after the chroot stage:"
        du -sh /build/chroot /build/cache 2>/dev/null || true

        # Free the downloaded .debs but KEEP the directory itself: live-build
        # bind-mounts the archive dir into the chroot as the apt cache, and lb
        # binary_rootfs installs squashfs-tools through that mount.
        # Deleting the directory (or running out of space inside it) makes that
        # stage fail with a misleading "not enough free space" error.
        echo "==> purging cached .debs (keeping the archive dir)"
        find /build/cache/archives -maxdepth 1 -name "*.deb" -delete 2>/dev/null || true
        du -sh /build/cache /build/chroot 2>/dev/null || true

        echo "==> lb binary (squashfs + ISO)"
        lb binary

        echo "==> build finished, freeing the build cache"
        rm -rf /build/cache /build/auto /build/build
        du -sh /build 2>/dev/null || true

        for list in dev apps firmware; do
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