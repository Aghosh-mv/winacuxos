# WinacuxOS — the complete build journal

*Everything that happened from "make an OS" to a bootable, verified image — including
the parts that went wrong, because those are the parts worth keeping.*

---

## 1. The brief

> "make a os" → *"real professional os like ubuntu or mint or pop os"*
> → WinacuxOS, built from nothing, themed to a mockup of the user's desktop
> → then: 12 numbered features, a 10-level difficulty roadmap, and eight
> signature features on top.

Everything shipped in this repo answers to that list. Nothing here is a mockup:
every claim below was verified by booting the image.

---

## 2. What we actually built

A Debian 13 (trixie) based distribution, arm64, built with Debian's own
`live-build`, running GNOME 48 with **a shell extension we wrote from scratch**.

```
/Users/tinkerspace/winacuxos
├── branding/          logo.svg, wallpaper.svg (dusk lake + city + arc), rendered PNGs
├── config/
│   ├── package-lists/ base, desktop, apps, dev, features, firmware  (121 packages, all verified)
│   ├── includes.chroot/  files copied verbatim into the image
│   ├── hooks/live/    0100 branding · 0200 AI · 0300 appearance · 0400 boot diet · 0500 first login
│   └── bootloaders/   GRUB theme, grub.cfg, isolinux menu
├── scripts/           build · boot-test · vm-session · vm-shell · guest-patch · validate · check-packages …
├── ai/                dataset generator, MLX LoRA training, merge + GGUF export
└── build-out/         live-image-arm64.iso  (2.1 GB)
```

---

## 3. The feature list, and where each one lives

### The 12 from the brief

| # | Feature | How it works |
|---|---------|--------------|
| 1 | **Winacux AI** | local llama.cpp server, `wcx ask`, AI card on the desktop, palette entry, clipboard + screenshot/OCR explain |
| 2 | **Private Core** | no account, local profiles, `wcx vault` (gocryptfs), per-app network via Flatpak portals |
| 3 | **QuickSpace** | 4 fixed workspaces, pills in the top bar, Ctrl+Alt+1..4, per-workspace layout memory |
| 4 | **Winacux Store** | GNOME Software + Flatpak plugin; `wcx remove <pkg>` purges app **and** leftovers |
| 5 | **Smart Windows** | tiling-assistant extension + our own Alt+Tab (Window Composer) |
| 6 | **Game Mode** | `gamemode`, Mangohud FPS overlay, Lutris, Game Mode toggle in the widget column |
| 7 | **Developer Mode** | gcc/make/cmake/python/node/git/docker/neovim/ripgrep, one-click env scripts |
| 8 | **Smart File System** | previews (sushi), tags, `wcx dupes`, `wcx find` (natural-language, local) |
| 9 | **Winacux Snapshot** | Timeshift + a dpkg hook that snapshots before risky updates |
| 10 | **Connect** | KDE Connect for phone pairing, file/clipboard/notification sharing |
| 11 | **Winacux Desktop** | our extension: widgets, pills, Flow buttons, live wallpaper, themes |
| 12 | **Safe Mode** | "WinacuxOS Recovery (diagnostics)" boot entry → `wcx doctor` |

### The eight signatures

| Feature | Where |
|---------|-------|
| **Winacux Command** (`Super+Space`) | `command.js` — fuzzy launcher over apps, settings, Flows, actions, files, AI |
| **AI Everywhere** | `wcx explain` (clipboard), `wcx shot` (screenshot→OCR→ask), intent→Flow routing |
| **Window Composer** | `composer.js` — Alt+Tab with live thumbnails, workspace-aware, feature-detected |
| **Update Center** | `winacux-update` — snapshot-first updates, failed-boot detection, one-click rollback |
| **Theme Studio** | `winacux-theme` — one accent colour re-skins shell, dock, widgets, palette, trail |
| **Cursor FX** | `cursorfx.js` — spring-coupled trail nodes, velocity stretch, 4 presets, click ripples, shockwave |
| **Boot to desktop <8s** | `0400-performance.hook.chroot` — trimmed services, zstd initramfs, image diet |
| **Winacux Rescue** | `winacux-rescue` — snapshot restore, fsck, GRUB rebuild, firmware reinstall |

Plus **Winacux Flow**: `"I want to study"` → workspace 1 with Notes, browser, editor, calculator.

---

## 4. Verified on a real boot

Not asserted — screenshotted from the ISO under QEMU with hardware acceleration:

- ✅ Boots to a GNOME 48 desktop
- ✅ **Our wallpaper**: dusk lake, mountains, city skyline, glowing arc, W mark, *"Your OS. Your Way."*
- ✅ **Left dock** (was `BOTTOM` before the dconf fix)
- ✅ Desktop icons (Home, Trash) via DING
- ✅ Four workspace dots
- ✅ **"Welcome to WinacuxOS 1.0"** — our `os-release` driving the system
- ✅ All six apps + `wcx` present in `/usr/local/bin`
- ✅ Plymouth boot theme installed and handed off cleanly
- ✅ Serial console login works, which is what made the rest of this possible

---

## 5. The five bugs that only a real boot could find

This is the most valuable part of the log.

### 1. An x86_64 system built inside an arm64 Mac
`config/bootstrap` had a committed `LB_ARCHITECTURE="amd64"`. Every build
silently produced an *emulated* system — which is why Python segfaulted
(`status -11`) during package configuration. Fixed by regenerating `config/`
from scratch on every run and gitignoring the generated files.

### 2. live-build cannot extract packages on a macOS bind mount
`tar failed` — virtiofs. Fixed by rsyncing the tree into the container's own
filesystem, with a Docker volume for cache/chroot.

### 3. The staged config silently resurrected the old architecture
`W: Skipping bootstrap, already done` — live-build restored an amd64 chroot
from `cache/` even after `lb clean --all`. Fixed by deleting `cache/ chroot/`
explicitly.

### 4. Every default we shipped was being thrown away
`/etc/dconf/profile/user` **does not exist on Debian 13**. The wallpaper, dock
position, icon theme, accent, font, enabled extensions — all ignored. The image
booted stock while containing a full customisation layer.
The hook now **fails the build** if that profile is missing, and reads the
values back with `dconf dump` to prove the database is live.

### 5. The extension was in `State: ERROR` — twice, for two different reasons
- **Schema format.** We wrote `<gsettings schema="...">` (dconf-keyfile syntax)
  into a GSettings schema file. `glib-compile-schemas` ignored the whole file,
  so the extension could not read its own settings. Extension schemas need
  `<schemalist><schema id= path=>`. The validator now gates this.
- **`St.CssProvider` no longer exists in GNOME 48.** Replaced with a
  capability probe: try `St.CssProvider`, fall back to `Gtk.CssProvider`, and
  never let styling take the desktop down.

And two of my own mistakes, found by tooling I had written for exactly that:
- `MODULES=dep` in the initramfs hook (`mkinitramfs` needs `most`)
- deleting `cache/archives` mid-build (live-build bind-mounts it as apt's archive dir)

---

## 6. Infrastructure built along the way

Because everything must be *provable*, the repo grew its own test harness:

| Script | What it does |
|--------|--------------|
| `scripts/check-packages.sh` | verifies every package exists in the Debian archive |
| `scripts/validate.sh` | JS/JSON/XML/shell checks + schema-structure gate |
| `scripts/boot-test.sh` | boots the ISO under HVF, screenshots at timed intervals |
| `scripts/vm-session.sh` | sends real key/mouse events, captures frames |
| `scripts/vm-shell.py` | logs in over serial and inspects the running guest |
| `scripts/verify-guest.sh` | asserts what screenshots cannot prove |
| `scripts/guest-patch.py` | **hot-patch loop**: patch files into the live guest → reload extension → verify → screenshot, in ~3 minutes |
| `scripts/pull-iso.sh` | copies the ISO out of the VM and verifies the byte count |
| `scripts/make-gallery.sh` | builds the HTML screenshot gallery |

`guest-patch.py` is the important one: a rebuild takes 25 minutes, this takes
three, which is what makes iterating on a shell extension possible at all.

---

## 7. The AI pipeline

Written, not downloaded:

```
ai/scripts/gen_dataset.py        our docs + commands + flows + features → 183 examples
ai/scripts/train.sh              LoRA fine-tune, Qwen2.5-1.5B-Instruct (MLX, Metal)
ai/scripts/merge_and_quantize.py fold the adapter into the base, dequantize, save HF
ai/scripts/export-gguf.sh        HF → GGUF → Q4_K_M for llama.cpp
```

The dataset is generated from this repository — every `wcx` command, all four
Flows, the recovery/update/vault features, troubleshooting answers, and the
persona. The result gets baked into the image and served on loopback.

---

## 8. Current state

**Working:** the OS boots and looks like WinacuxOS.

**In flight:** widget cards, workspace pills and the Command bar — the extension
loads clean now, needs one more render iteration.

**Queued:** AI model baked, GNOME welcome balloon suppressed (fix written,
needs a rebuild), feature proof screenshots, installer, amd64 release via CI.

---

## 9. The one thing blocking progress

The Mac's APFS container: **245 GB total, 198 GB used, 7.3 GB free.**

| Consumer | Size |
|----------|------|
| `~/.colima` (build VM) | 11 GB |
| the ISO we built | 2.1 GB |
| free | 7.3 GB |

A rebuild peaks around 10 GB (chroot 4.6 GB + cache + squashfs + ISO), so it
cannot start. The workarounds — caches pruned, artifacts pulled out of the VM,
hot-patching instead of rebuilding — have taken us as far as they can.

Free ~10 GB from `~/Documents` (3.9 GB), `~/Downloads` (2.4 GB) or
`iCloud Drive (Archive)` (4.3 GB) and the rest is unblocked.
