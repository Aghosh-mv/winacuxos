#!/usr/bin/env bash
# Generates the live-build config/ tree for WinacuxOS.
#
# Architecture is a parameter, because the build machine matters:
#   WCX_ARCH=arm64  (default) native on Apple Silicon - used for development
#   WCX_ARCH=amd64  cross/emulated locally, but native on GitHub Actions runners
#
# arm64 is UEFI-only (no BIOS), so the bootloader set differs per arch.
set -euo pipefail

ARCH="${WCX_ARCH:-arm64}"
export LC_ALL=C

case "$ARCH" in
    arm64)
        BOOTLOADERS="grub-efi"
        BINARY_IMAGES="iso"
        ;;
    amd64)
        BOOTLOADERS="grub-efi,syslinux"
        BINARY_IMAGES="iso-hybrid"
        ;;
    *)
        echo "unsupported WCX_ARCH: $ARCH (use arm64 or amd64)" >&2
        exit 1
        ;;
esac

# The kernel package cannot be hardcoded in config/package-lists/base.list
# because it is architecture dependent.
mkdir -p config/package-lists
printf 'linux-image-%s\n' "$ARCH" > config/package-lists/zz-kernel.list

echo "==> configuring WinacuxOS for $ARCH (bootloaders: $BOOTLOADERS)"

# Start from a clean slate: live-build's own config files (bootstrap, chroot,
# common, packages...) are generated, and a stale one silently pins the
# previous architecture. Our hand-written trees - package-lists, hooks,
# includes.chroot, bootloaders - are never touched.
for generated in architectures bootstrap chroot common debian-installer \
                  packages packages.binary packages.chroot preseed rootfs source \
                  includes includes.binary includes.bootstrap includes.installer \
                  includes.source includes.chroot_before_packages \
                  includes.chroot_after_packages; do
    rm -rf "config/$generated"
done

lb config nointeractive \
    --distribution trixie \
    --architectures "$ARCH" \
    --archive-areas "main contrib non-free non-free-firmware" \
    --binary-images "$BINARY_IMAGES" \
    --bootloaders "$BOOTLOADERS" \
    --debian-installer none \
    --iso-application "WinacuxOS" \
    --iso-publisher "WinacuxOS Project" \
    --iso-volume "WINACUXOS_1.0" \
    --bootappend-live "boot=live components quiet splash username=user hostname=winacuxos locales=en_US.UTF-8 timezone=UTC keyboard-layouts=us" \
    --bootappend-live-failsafe "boot=live components nomodeset noapic noapm nodma nomce nosplash vga=normal"

echo "==> live-build config generated:"
ls -1 config/