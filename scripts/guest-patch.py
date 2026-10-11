#!/usr/bin/env python3
"""Patch files inside a running WinacuxOS guest, over the serial console.

Rebuilding the ISO to test a one-line change takes ~20 minutes. This copies a
file straight into the live image, restarts the desktop session, and reports
the extension state - a two-minute loop for iterating on the shell extension.

Usage:
    scripts/guest-patch.py extension.js
    scripts/guest-patch.py extension.js widgets.js pills.js
    scripts/guest-patch.py --dest /usr/local/bin/wcx scripts-path
"""

import base64
import os
import pathlib
import re
import socket
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXT_LOCAL = ROOT / "config/includes.chroot/usr/share/gnome-shell/extensions/winacux@winacuxos.org"
EXT_REMOTE = "/usr/share/gnome-shell/extensions/winacux@winacuxos.org"
VARS = ROOT / "artifacts/boot/vars.fd"
SERIAL_PORT = 55561
MONITOR_PORT = 55562
USER = "user"
PASSWORDS = ["liveboot", "live", "user", "winacuxos", ""]


def qemu_prefix():
    for candidate in ("/opt/homebrew/opt/qemu", "/usr/local/opt/qemu"):
        if pathlib.Path(candidate).is_dir():
            return candidate
    return "/opt/homebrew/opt/qemu"


class Guest:
    def __init__(self, iso):
        prefix = qemu_prefix()
        self.log = open(ROOT / "artifacts" / "guest-patch-qemu.log", "w")
        self.proc = subprocess.Popen([
            "qemu-system-aarch64", "-machine", "virt", "-accel", "hvf", "-cpu", "max",
            "-m", "4096", "-smp", "4",
            "-drive", f"if=pflash,format=raw,readonly=on,file={prefix}/share/qemu/edk2-aarch64-code.fd",
            "-drive", f"if=pflash,format=raw,file={VARS}",
            "-cdrom", iso,
            "-device", "virtio-gpu-pci", "-display", "none",
            "-netdev", "user,id=net0", "-device", "virtio-net-pci,netdev=net0",
            "-serial", f"tcp:127.0.0.1:{SERIAL_PORT},server,nowait",
            "-monitor", f"tcp:127.0.0.1:{MONITOR_PORT},server,nowait",
            "-no-reboot",
        ], stdout=self.log, stderr=subprocess.STDOUT)
        # A missing/corrupt pflash vars file makes QEMU exit instantly.
        VARS.parent.mkdir(parents=True, exist_ok=True)
        if not VARS.exists():
            VARS.write_bytes((pathlib.Path(qemu_prefix()) /
                              "share/qemu/edk2-arm-vars.fd").read_bytes())

        # QEMU needs a moment to bind the serial/monitor sockets.
        self.sock = None
        for attempt in range(40):
            time.sleep(1)
            if self.proc.poll() is not None:
                raise RuntimeError(
                    f"QEMU exited immediately (code {self.proc.returncode})")
            try:
                self.sock = socket.create_connection(("127.0.0.1", SERIAL_PORT), timeout=5)
                break
            except OSError:
                continue
        if self.sock is None:
            raise RuntimeError("QEMU never opened its serial console")
        self.sock.settimeout(0.4)
        self.buffer = b""

    def pump(self, seconds):
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                chunk = self.sock.recv(8192)
                if not chunk:
                    break
                self.buffer += chunk
            except socket.timeout:
                continue

    def expect(self, pattern, timeout):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if re.search(pattern, self.buffer):
                return True
            self.pump(2)
        return False

    def send(self, line):
        self.sock.sendall((line + "\n").encode())
        time.sleep(0.25)

    def login(self):
        if not self.expect(rb"login:", 300):
            raise RuntimeError("no login prompt on the serial console")
        for attempt, password in enumerate(PASSWORDS):
            self.buffer = b""
            self.send(USER)
            self.expect(rb"[Pp]assword", 30)
            self.send(password)
            if self.expect(rb"[\w.-]+@[\w.-]+:[^\r\n]*[$#] ", 25):
                return attempt + 1
            self.expect(rb"login:", 20)
        raise RuntimeError("could not log in")

    def run(self, command, timeout=120):
        """Run a command and return just its output.

        The serial console echoes what we type, which used to end up mixed
        into the results. Echo is disabled for the duration of the command and
        the output is sliced on a unique marker.
        """
        self.buffer = b""
        self.send("stty -echo 2>/dev/null")
        time.sleep(0.3)
        self.buffer = b""
        self.send(f"{command} ; echo __WCXEND__$?")
        if self.expect(rb"__WCXEND__(\d+)", timeout):
            text = self.buffer.decode(errors="replace")
            # Keep only what came after the echoed command line.
            if "\n" in text:
                text = text.split("\n", 1)[1]
            text = re.sub(r"__WCXEND__\d+.*$", "", text, flags=re.S)
            self.send("stty echo 2>/dev/null")
            return text.strip()
        self.send("stty echo 2>/dev/null")
        return "(timed out)"

    def value(self, command, timeout=60):
        """Run a command and return its single line of output, prompt-free."""
        text = self.run(command, timeout)
        for line in text.splitlines():
            line = line.strip()
            if line and not line.startswith("__"):
                return line
        return ""

    def put(self, data: bytes, remote_path: str, mode=0o644):
        """Send a file in base64 chunks, then decode it in the guest."""
        encoded = base64.b64encode(data).decode()
        temp = "/tmp/_patch.b64"
        self.run(f"rm -f {temp}")
        chunk_size = 1024
        for start in range(0, len(encoded), chunk_size):
            piece = encoded[start:start + chunk_size]
            self.run(f"printf '%s' '{piece}' >> {temp}", timeout=60)
        result = self.run(
            f"echo liveboot | sudo -S base64 -d {temp} > {remote_path} 2>/dev/null && "
            f"echo liveboot | sudo -S chmod {mode:o} {remote_path} && rm -f {temp} && echo WROTE")
        return "WROTE" in result

    def screenshot(self, name):
        """Grab the framebuffer through the QEMU monitor."""
        out_dir = ROOT / "artifacts" / "patched"
        out_dir.mkdir(parents=True, exist_ok=True)
        ppm = out_dir / f"{name}.ppm"
        try:
            with socket.create_connection(("127.0.0.1", MONITOR_PORT), timeout=5) as mon:
                mon.sendall(f"screendump {ppm}\n".encode())
                time.sleep(2)
        except OSError as exc:
            print(f"   (screendump failed: {exc})", flush=True)
            return
        if ppm.exists():
            png = out_dir / f"{name}.png"
            subprocess.run(["magick", str(ppm), "-resize", "1400x", str(png)],
                           capture_output=True)
            ppm.unlink(missing_ok=True)
            if png.exists():
                print(f"   captured {png}", flush=True)

    def close(self):
        try:
            self.run("sudo -S poweroff <<< 'liveboot' 2>/dev/null || poweroff -f", timeout=30)
        except Exception:
            pass
        time.sleep(3)
        self.proc.terminate()


def main():
    args = sys.argv[1:]
    iso = str(ROOT / "build-out/live-image-arm64.iso")
    if not pathlib.Path(iso).exists():
        print(f"!! ISO not found: {iso}")
        return 1

    if not args:
        print(__doc__)
        return 1

    guest = Guest(iso)
    try:
        attempt = guest.login()
        print(f"== logged in (password attempt {attempt}) ==", flush=True)

        for name in args:
            source = EXT_LOCAL / name
            if not source.exists():
                # e.g. schemas/org.gnome.shell.extensions.winacux.gschema.xml
                candidate = EXT_LOCAL / "schemas" / name
                if candidate.exists():
                    source, name = candidate, name
            if not source.exists():
                print(f"!! no such file: {EXT_LOCAL / name}", flush=True)
                continue
            remote = (f"{EXT_REMOTE}/schemas/{name}" if name.endswith(".xml")
                      else f"{EXT_REMOTE}/{name}")
            ok = guest.put(source.read_bytes(), remote,
                           0o755 if name.endswith("bin") or name in ("wcx",) else 0o644)
            print(f"   {'patched' if ok else 'FAILED'} {name} ({source.stat().st_size} bytes)", flush=True)

        # Recompile the extension schemas too: they are what the settings need.
        print("   " + guest.run(
            f"echo liveboot | sudo -S glib-compile-schemas {EXT_REMOTE}/schemas "
            f"&& echo liveboot | sudo -S glib-compile-schemas /usr/share/glib-2.0/schemas "
            f"&& echo SCHEMAS_OK").strip()[-120:], flush=True)

        raw = guest.run("date +%s", timeout=30)
        digits = re.findall(r"\b(\d{9,})\b", raw)
        marker = digits[-1] if digits else ""

        print("== reloading the extension in place", flush=True)
        env = ("XDG_RUNTIME_DIR=/run/user/1000 "
               "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus ")
        print("   " + guest.run(env + "gnome-extensions disable winacux@winacuxos.org 2>&1; "
                                   "echo DISABLED").strip()[-40:], flush=True)
        time.sleep(3)
        print("   " + guest.run(env + "gnome-extensions enable winacux@winacuxos.org 2>&1; "
                                   "echo ENABLED").strip()[-40:], flush=True)
        time.sleep(8)

        print("   " + guest.run(
            "XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus "
            "gnome-extensions info winacux@winacuxos.org 2>&1 | grep -E 'Enabled|State'").strip())
        # Errors only from after the patch, and only the first few lines of the
        # stack so the cause is not buried in noise.
        print("== extension log (since the patch)", flush=True)
        for line in guest.run(
            f"XDG_RUNTIME_DIR=/run/user/1000 journalctl --user -b --since '@{marker}' -o cat "
            "--no-pager 2>/dev/null | grep -i 'winacux@' | head -8", timeout=90).splitlines():
            print("   " + line.strip(), flush=True)

        # The patched files live in this VM's RAM, so the proof screenshot has
        # to be taken here, before the machine goes away.
        for label, delay in (("desktop", 12), ("overview", 6)):
            time.sleep(delay)
            guest.screenshot(f"patched-{label}")
    finally:
        guest.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())