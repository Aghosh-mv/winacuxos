#!/usr/bin/env bash
# Boots the WinacuxOS ISO in QEMU and captures screenshots at key moments,
# so a build can be verified without a human staring at a VM window.
#
# On Apple Silicon, QEMU has no hardware acceleration for x86 guests, so this
# uses TCG emulation: correct, but slow. Times below assume emulation.
#
# Usage:
#   scripts/boot-test.sh [iso] [--shots "12,180,420"]
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ISO="${1:-$ROOT/build-out/live-image-amd64.hybrid.iso}"
SHOTS="10,150,420"
OUT="$ROOT/artifacts/boot"

if [ ! -f "$ISO" ]; then
    echo "!! ISO not found: $ISO" >&2
    echo "   build one first: scripts/build.sh" >&2
    exit 1
fi

shift || true
while [ $# -gt 0 ]; do
    case "$1" in
        --shots) SHOTS="$2"; shift 2 ;;
        *) shift ;;
    esac
done

mkdir -p "$OUT"
rm -f "$OUT"/*.png

MONITOR_PORT=55556
MEM="${WCX_TEST_MEM:-4096}"
CPUS="${WCX_TEST_CPUS:-2}"

echo "==> ISO:      $ISO"
echo "==> screenshots at t = ${SHOTS//,/, } seconds"
echo "==> writing to $OUT"

qemu-system-x86_64 \
    -accel tcg \
    -m "$MEM" \
    -smp "$CPUS" \
    -cdrom "$ISO" \
    -boot d \
    -display none \
    -vga std \
    -monitor "tcp:127.0.0.1:${MONITOR_PORT},server,nowait" \
    -netdev user,id=net0,hostfwd=tcp::2222-:22 \
    -device virtio-net-pci,netdev=net0 \
    -no-reboot \
    >"$OUT/qemu.log" 2>&1 &
QEMU_PID=$!

cleanup() {
    kill "$QEMU_PID" 2>/dev/null
    wait "$QEMU_PID" 2>/dev/null
}
trap cleanup EXIT

screendump() {
    local name="$1"
    sleep 1
    if printf 'screendump %s/%s.ppm\n' "$OUT" "$name" | nc -w 3 127.0.0.1 "$MONITOR_PORT" 2>/dev/null; then
        if [ -f "$OUT/$name.ppm" ]; then
            magick "$OUT/$name.ppm" -resize 1280x "$OUT/$name.png" 2>/dev/null
            rm -f "$OUT/$name.ppm"
            echo "    captured $name.png"
        fi
    else
        warn="could not reach the QEMU monitor"
        echo "    !! $warn"
    fi
}

IFS=',' read -ra TIMES <<< "$SHOTS"
for t in "${TIMES[@]}"; do
    t="$(printf '%d' "$t")"
    echo "==> waiting ${t}s"
    sleep "$t"
    screendump "t$(printf '%03d' "$t")"
done

echo
echo "==> done. screenshots:"
ls -1sh "$OUT"/*.png 2>/dev/null || echo "   none captured"