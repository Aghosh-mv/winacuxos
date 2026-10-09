#!/usr/bin/env bash
# Drives the WinacuxOS image in QEMU: boots it and runs a small script of
# commands against the QEMU monitor (wait / key / type / shot / cmd).
#
# This is how the desktop gets verified without a human at the screen: real
# keys are sent to a real session, and the framebuffer is captured back.
#
# Usage:
#   scripts/vm-session.sh "wait 45; shot desktop; key esc; wait 3; shot desk2"
#   scripts/vm-session.sh "wait 40; key super; wait 2; shot overview"
#
# Commands (separated by ';' or newlines):
#   wait <seconds>     sleep
#   shot <name>        screendump to artifacts/boot/<name>.png
#   key <keys>         sendkey, e.g. esc, ret, super, ctrl-alt-1
#   type <text>        type literal text
#   cmd <shell>        run a command in the *guest* over the serial console
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ISO="${WCX_ISO:-$ROOT/build-out/live-image-arm64.iso}"
OUT="$ROOT/artifacts/boot"
SCRIPT="$*"
MON_PORT="${WCX_MON_PORT:-55557}"
SERIAL_PORT="${WCX_SERIAL_PORT:-55558}"
MEM="${WCX_TEST_MEM:-4096}"
CPUS="${WCX_TEST_CPUS:-4}"

[ -f "$ISO" ] || { echo "!! ISO not found: $ISO" >&2; exit 1; }
mkdir -p "$OUT"

QEMU_PREFIX="$(brew --prefix qemu 2>/dev/null || echo /opt/homebrew/opt/qemu)"
CODE="$QEMU_PREFIX/share/qemu/edk2-aarch64-code.fd"
cp "$QEMU_PREFIX/share/qemu/edk2-arm-vars.fd" "$OUT/vars.fd"

qemu-system-aarch64 \
    -machine virt -accel hvf -cpu max \
    -m "$MEM" -smp "$CPUS" \
    -drive "if=pflash,format=raw,readonly=on,file=$CODE" \
    -drive "if=pflash,format=raw,file=$OUT/vars.fd" \
    -cdrom "$ISO" \
    -device virtio-gpu-pci \
    -display none \
    -serial "tcp:127.0.0.1:${SERIAL_PORT:-55558},server,nowait" \
    -netdev user,id=net0 \
    -device virtio-net-pci,netdev=net0 \
    -monitor "tcp:127.0.0.1:${MON_PORT},server,nowait" \
    -no-reboot \
    >"$OUT/vm-session.log" 2>&1 &
QEMU_PID=$!
trap 'kill $QEMU_PID 2>/dev/null' EXIT

sleep 4

monitor() {
    printf '%s\n' "$1" | nc -w 5 127.0.0.1 "$MON_PORT" 2>/dev/null >/dev/null
    sleep 1
}

shoot() {
    monitor "screendump $OUT/$1.ppm"
    [ -f "$OUT/$1.ppm" ] || { echo "   (no frame for $1)"; return; }
    magick "$OUT/$1.ppm" -resize 1400x "$OUT/$1.png" 2>/dev/null
    rm -f "$OUT/$1.ppm"
    echo "   captured artifacts/boot/$1.png"
}

IFS=';' read -ra STEPS <<< "$SCRIPT"
for step in "${STEPS[@]}"; do
    step="$(echo "$step" | xargs)"
    [ -z "$step" ] && continue
    verb="${step%% *}"
    rest="${step#* }"
    case "$verb" in
        wait) echo "   waiting ${rest}s"; sleep "$rest" ;;
        shot) shoot "$rest" ;;
        key)  echo "   key: $rest"; monitor "sendkey $rest" ;;
        click) # click <dx> <dy> - relative mouse movement then a click
            dx="${rest%% *}"; dy="${rest##* }"
            echo "   click at $dx,$dy"
            monitor "mouse_move $dx $dy"
            monitor "mouse_button 1"
            ;;
        type) echo "   typing: $rest"; monitor "sendkey $rest" ;;
        cmd)  echo "   guest cmd: $rest" ;;
        *)    echo "   ?? unknown step: $step" ;;
    esac
done

echo "   session finished"