#!/usr/bin/env bash
# Verifies a live session from the inside: boots the ISO, logs in over serial
# and prints the things a screenshot cannot prove.
#
#   scripts/verify-guest.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CHECKS='id -u
gsettings get org.gnome.desktop.background picture-uri
gsettings get org.gnome.shell.extensions.dash-to-dock dock-position
gsettings get org.gnome.shell enabled-extensions
gsettings get org.gnome.desktop.interface icon-theme
gsettings get org.gnome.desktop.interface cursor-theme
ls /usr/share/winacuxos/
command -v wcx wcx-cursors winacux-mouse winacux-theme winacux-update winacux-rescue
echo liveboot | sudo -S journalctl -b --no-pager 2>/dev/null | grep -c "WinacuxOS: extension enabled"
echo liveboot | sudo -S journalctl -b --no-pager 2>/dev/null | grep -icE "extension error|Failed to load|not compatible"'

"$ROOT/scripts/vm-shell.py" "$CHECKS"
