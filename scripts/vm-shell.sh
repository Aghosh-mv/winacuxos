#!/usr/bin/env python3
"""Drive the WinacuxOS guest over its serial console.

Boots the ISO in QEMU with a serial getty, logs in, runs the commands given on
the command line, prints the output, and powers the machine off. This is how the
image is inspected without a human at the screen - and how failures inside the
desktop are diagnosed.

Usage:
    scripts/vm-shell.sh "gnome-extensions list; gsettings get org.gnome.desktop.background picture-uri"
"""

import re
import socket
import subprocess
import sys
import time

ROOT = subprocess.run(["dirname", __file__], capture_output=True, text=True).stdout.strip()
ROOT = subprocess.run(["realpath", f"{ROOT}/.."], capture_output=True, text=True).stdout.strip()
ISO = f"{ROOT}/build-out/live-image-arm64.iso"
SERIAL_PORT = 55558
MON_PORT = 55559
USER = "user"   # live-build live session user (bootappend username=user)
# live-config picks the password; try the usual defaults before giving up.
PASSWORDS = ["liveboot", "live", "user", "winacuxos", ""]
PROMPT = re.compile(rb"[\w.-]+@[\w.-]+:[^\r\n]*[$#] ")


def qemu_prefix():
    for candidate in ("/opt/homebrew/opt/qemu", "/usr/local/opt/qemu"):
        if subprocess.run(["test", "-d", candidate]).returncode == 0:
            return candidate
    return "/opt/homebrew/opt/qemu"


def main():
    commands = sys.argv[1] if len(sys.argv) > 1 else "cat /etc/os-release"
    commands = [c.strip() for c in commands.split(";") if c.strip()]

    prefix = qemu_prefix()
    qemu = subprocess.Popen([
        "qemu-system-aarch64", "-machine", "virt", "-accel", "hvf", "-cpu", "max",
        "-m", "4096", "-smp", "4",
        "-drive", f"if=pflash,format=raw,readonly=on,file={prefix}/share/qemu/edk2-aarch64-code.fd",
        "-drive", f"if=pflash,format=raw,file={prefix}/share/qemu/edk2-arm-vars.fd",
        "-cdrom", ISO,
        "-device", "virtio-gpu-pci", "-display", "none",
        "-netdev", "user,id=net0", "-device", "virtio-net-pci,netdev=net0",
        "-serial", f"tcp:127.0.0.1:{SERIAL_PORT},server,nowait",
        "-monitor", f"tcp:127.0.0.1:{MON_PORT},server,nowait",
        "-no-reboot",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    time.sleep(4)
    try:
        sock = socket.create_connection(("127.0.0.1", SERIAL_PORT), timeout=10)
    except OSError as exc:
        print(f"!! cannot reach the serial console: {exc}")
        qemu.terminate()
        return 1
    sock.settimeout(0.5)

    buffer = b""

    def pump(seconds):
        nonlocal buffer
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                buffer += chunk
            except socket.timeout:
                continue
        return buffer

    def expect(pattern, timeout=180):
        nonlocal buffer
        deadline = time.time() + timeout
        while time.time() < deadline:
            if re.search(pattern, buffer):
                return True
            pump(2)
        return False

    def send(line):
        sock.sendall((line + "\n").encode())
        time.sleep(0.4)

    print("== waiting for the live session to reach a login prompt ==")
    if not expect(rb"login:", 300):
        print("!! no login prompt appeared on the serial console")
        print(buffer.decode(errors="replace")[-2000:])
        qemu.terminate()
        return 1

    logged_in = False
    for attempt, password in enumerate(PASSWORDS):
        buffer = b""
        send(USER)
        expect(rb"[Pp]assword", 30)
        send(password)
        if expect(PROMPT, 25):
            logged_in = True
            print(f"== logged in as {USER} (password attempt {attempt + 1}) ==")
            break
        # A failed attempt reprints the login prompt; wait for it.
        expect(rb"login:", 20)

    if not logged_in:
        print("!! could not log in on the serial console with any known password")
        print(buffer.decode(errors="replace")[-1500:])
        qemu.terminate()
        return 1

    for command in commands:
        print(f"\n$ {command}")
        buffer = b""
        # Mark the end of the command so we know where its output stops.
        send(f"{command} ; echo __WCX_DONE_$?")
        if expect(rb"__WCX_DONE_(\d+)", 120):
            text = buffer.decode(errors="replace")
            text = re.sub(r"__WCX_DONE_\d+\s*$", "", text.strip())
            text = re.sub(r"^\S+@\S+:[^\r\n]*[$#] ", "", text.strip())
            print(text.strip()[:4000])
        else:
            print("(no output within 120s)")

    print("\n== powering off ==")
    buffer = b""
    send("sudo -S poweroff <<< 'liveboot' 2>/dev/null || poweroff -f")
    pump(20)
    qemu.terminate()
    return 0


if __name__ == "__main__":
    sys.exit(main())