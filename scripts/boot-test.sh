#!/usr/bin/env bash
# Boots the WinacuxOS ISO in QEMU and captures screenshots at chosen moments.
#
# On Apple Silicon the arm64 image boots with HVF (hardware virtualization), so
# a full boot to the desktop takes well under a minute instead of the ~10
# minutes the emulated amd64 image needs.
#
# Usage:
#   scripts/boot-test.sh                       # default timings
#   scripts/boot-test.sh --shots "20,45,70"    # custom screenshot times
#   scripts/boot-test.sh --iso path/to.iso
#   scripts/boot-test.sh --interactive         # window you can click into
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ISO="$ROOT/build-out/live-image-arm64.hybrid.iso"
[ -f "$ISO" ] || ISO="$ROOT/build-out/live-image-arm64.iso"
SHOTS="18,40,75"
OUT="$ROOT/artifacts/boot"
INTERACTIVE=0
MEM="${WCX_TEST_MEM:-4096}"
CPUS="${WCX_TEST_CPUS:-4}"

while [ $# -gt 0 ]; do
    case "$1" in
        --shots) SHOTS="$2"; shift 2 ;;
        --iso) ISO="$2"; shift 2 ;;
        --interactive) INTERACTIVE=1; shift ;;
        *) shift ;;
    esac
done

if [ ! -f "$ISO" ]; then
    echo "!! ISO not found: $ISO" >&2
    ls -1 "$ROOT/build-out" 2>/dev/null || true
    exit 1
fi

QEMU_PREFIX="$(brew --prefix qemu 2>/dev/null || echo /opt/homebrew/opt/qemu)"
CODE="$QEMU_PREFIX/share/qemu/edk2-aarch64-code.fd"
VARS_SRC="$QEMU_PREFIX/share/qemu/edk2-arm-vars.fd"
for f in "$CODE" "$VARS_SRC"; do
    [ -f "$f" ] || { echo "!! missing UEFI firmware: $f" >&2; exit 1; }
done

mkdir -p "$OUT"
rm -f "$OUT"/*.png "$OUT"/*.ppm
cp "$VARS_SRC" "$OUT/vars.fd"

MONITOR_PORT=55556

echo "==> ISO:  $ISO"
echo "==> UEFI: $CODE"
echo "==> shots at t = ${SHOTS//,/, }s, output in $OUT"

QEMU_ARGS=(
    -machine virt
    -accel hvf
    -cpu max
    -m "$MEM"
    -smp "$CPUS"
    -drive "if=pflash,format=raw,readonly=on,file=$CODE"
    -drive "if=pflash,format=raw,file=$OUT/vars.fd"
    -cdrom "$ISO"
    -netdev user,id=net0
    -device virtio-net-pci,netdev=net0
    -no-reboot
)

if [ "$INTERACTIVE" -eq 1 ]; then
    qemu-system-aarch64 "${QEMU_ARGS[@]}" &
    echo "==> interactive window open; close it when done"
    wait
    exit 0
fi

qemu-system-aarch64 "${QEMU_ARGS[@]}" \
    -display none \
    -device virtio-gpu-pci \
    -monitor "tcp:127.0.0.1:${MONITOR_PORT},server,nowait" \
    >"$OUT/qemu.log" 2>&1 &
QEMU_PID=$!

cleanup() {
    kill "$QEMU_PID" 2>/dev/null
    wait "$QEMU_PID" 2>/dev/null
}
trap cleanup EXIT

# Give the firmware a moment before the monitor starts accepting commands.
sleep 3

screendump() {
    local name="$1"
    sleep 1
    printf 'screendump %s/%s.ppm\n' "$OUT" "$name" | nc -w 3 127.0.0.1 "$MONITOR_PORT" 2>/dev/null
    sleep 1
    if [ -f "$OUT/$name.ppm" ]; then
        magick "$OUT/$name.ppm" -resize 1400x "$OUT/$name.png" 2>/dev/null
        rm -f "$OUT/$name.ppm"
        echo "    captured $name.png"
    else
        echo "    !! no screendump for $name"
    fi
}

IFS=',' read -ra TIMES <<< "$SHOTS"
elapsed=0
for t in "${TIMES[@]}"; do
    t="$(printf '%d' "$t")"
    step=$((t - elapsed))
    [ "$step" -gt 0 ] && sleep "$step"
    elapsed=$t
    echo "==> t=${t}s"
    screendump "t$(printf '%03d' "$t")"
done

echo
echo "==> screenshots:"
ls -1sh "$OUT"/*.png 2>/dev/null || echo "   none captured"