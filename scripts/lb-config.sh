#!/usr/bin/env bash
# Generates the live-build config/ tree for WinacuxOS.
#
# live-build reads every setting from config/, so this file is the single
# source of truth for the image's identity and boot parameters. It is safe to
# re-run: `lb config` rewrites its own files and leaves our hand-written
# package-lists/, hooks/ and includes.chroot/ untouched.
set -euo pipefail

lb config nointeractive \
    --distribution trixie \
    --architectures amd64 \
    --archive-areas "main contrib non-free non-free-firmware" \
    --binary-images iso-hybrid \
    --bootloaders "grub-efi,syslinux" \
    --debian-installer none \
    --iso-application "WinacuxOS" \
    --iso-publisher "WinacuxOS Project" \
    --iso-volume "WINACUXOS_1.0" \
    --bootappend-live "boot=live components quiet splash username=user hostname=winacuxos locales=en_US.UTF-8 timezone=UTC keyboard-layouts=us" \
    --bootappend-live-failsafe "boot=live components nomodeset noapic noapm nodma nomce nosplash vga=normal"

echo "==> live-build config generated:"
ls -1 config/