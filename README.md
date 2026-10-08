# WinacuxOS

**Your OS. Your Way.** — a Debian-based Linux distribution with its own desktop
identity, built from scratch with `live-build`.

WinacuxOS is not a wallpaper for GNOME. It ships a GNOME Shell extension that
draws its own right-hand widget cards, workspace pills and live wallpaper, its
own boot splash and boot menu, an intent-based workspace launcher (Winacux Flow),
a fully offline AI assistant, and a `wcx` command that fronts the whole thing.

## Status

| Area | State |
|------|-------|
| Base system (Debian 13 trixie, GNOME 48) | building |
| Boot splash + boot menu branding | pending |
| Desktop widgets / workspace pills / live wallpaper | written, awaiting boot test |
| Winacux Flow (`wcx flow study`) | written, awaiting boot test |
| Feature backends (gamemode, timeshift, kdeconnect, gocryptfs, flatpak) | in image |
| Winacux AI (llama.cpp + local model) | planned |

## Build

Requirements on the build machine: Docker (via Colima on macOS), QEMU for
testing. Everything else runs inside the build container.

```bash
# one-time toolchain (macOS)
brew install colima docker qemu imagemagick librsvg
colima start --cpu 4 --memory 5 --disk 60

# build the ISO (30-60 min the first time)
scripts/build.sh            # incremental
scripts/build.sh --clean    # from scratch

# boot it and capture screenshots
scripts/boot-test.sh
```

The ISO lands in `build-out/`.

> Note: `scripts/build.sh` rsyncs the tree into the container before building.
> live-build's tar extraction fails on macOS virtiofs bind mounts, so the build
> must happen on the container's own filesystem.

## Repository layout

```
branding/            logo + wallpaper SVG masters, rendered PNGs in branding/out
config/              live-build configuration
  package-lists/     what goes into the image (base, desktop, apps, dev, features, firmware)
  includes.chroot/   files copied verbatim into the image (/etc, /usr/share, /usr/local/bin)
  hooks/live/        chroot hook: plymouth theme, locale, dconf, schema compilation
scripts/             build, boot-test and asset pipeline
build-out/           built ISOs
artifacts/boot/      boot-test screenshots
docs/                design notes and roadmap
BRANDING.md          palette, typography, logo and mockup decisions
```

## Brand identity

See [BRANDING.md](BRANDING.md). Palette, the "W" mark, the tagline
*Your OS. Your Way.* and the placeholder-data policy all live there.

## Roadmap

Levels 1-7 ship in v1. See [docs/ROADMAP.md](docs/ROADMAP.md) for levels 8-10.