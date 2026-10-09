# WinacuxOS architecture

Everything in the image is built by `scripts/build.sh` from the files in this
repository. Nothing is downloaded from a third-party image, and no step is
opaque.

## Build pipeline

```
branding/*.svg ──make-assets.sh──▶ branding/out/*.png ─┐
                                                      ├──▶ config/includes.chroot/
config/package-lists/*.list ────────────────▶ apt in the chroot
config/hooks/live/*.hook.chroot ────────────▶ post-install work
config/bootloaders/** ─────────────────────▶ GRUB + isolinux menus
                          │
scripts/Dockerfile ───────┴──▶ live-build ──▶ build-out/*.iso
```

* The build runs in a Debian container because `live-build` needs root and a
  Linux kernel. The source tree is rsynced in rather than bind-mounted: macOS
  mounts are virtiofs, and `live-build`'s tar extraction fails there.
* `scripts/lb-config.sh` regenerates `config/` from scratch every time. A stale
  `LB_ARCHITECTURE` in a committed config file once produced an emulated x86
  chroot on an arm64 Mac, so the generated files are gitignored and deleted
  before each configure.
* Artefacts stay inside the VM volume during a build; `scripts/pull-iso.sh`
  copies the ISO onto the Mac when you actually want it.

## Architecture targets

| Target | Where it is built | Why |
|--------|-------------------|-----|
| arm64 | this Mac, native | fast iteration; boots under QEMU/HVF for testing |
| amd64 | GitHub Actions (`.github/workflows/build-release.yml`) | native x86 runner; emulation on the Mac is slow and unreliable |

## Chroot hooks (run in order)

| Hook | Job |
|------|-----|
| `0100-winacuxos` | validates every shipped dconf key against installed schemas, installs the plymouth theme, generates the locale, compiles extension + system schemas, sets the default cursor, enables services |
| `0200-ai` | builds llama.cpp and fetches a local model (skippable with `WINACUX_AI=0`) |
| `0300-theme` | derives the `Winacux` shell theme from whatever stylesheet GNOME ships, then appends our overrides |
| `0400-performance` | trims boot time: disables services a live session never needs, switches initramfs to zstd |

## The shell extension: `winacux@winacuxos.org`

Installed to `/usr/share/gnome-shell/extensions/winacux@winacuxos.org`.

| Module | Responsibility |
|--------|----------------|
| `extension.js` | lifecycle: loads the stylesheets, wires modules, watches the theme file |
| `widgets.js` | the right-hand cards (AI, system, weather, usage, calendar) with live telemetry |
| `ai.js` | AI card: talks to the local llama.cpp server over loopback |
| `command.js` | **Winacux Command** (Super+Space): fuzzy launcher over apps, settings, flows, actions, files, AI |
| `composer.js` | **Window Composer**: Alt+Tab with workspace-aware live thumbnails, feature-detected |
| `cursorfx.js` | **cursor physics**: spring-coupled trail nodes, velocity stretch, presets (comet/lava/pixel/spark), click ripples and double-click shockwaves |
| `wallpaper.js` | **live wallpaper**: GPU-friendly drift + breathing glow; drop in your own art |
| `flow.js` | **Winacux Flow**: intent → workspace, plus per-workspace layout memory (restore-my-desk) |
| `stylesheet.css` | all shell styling; `~/.config/winacux/theme.css` layers on top |

Keybindings live in the extension's GSettings schema: `win-space` (Command),
`composer-toggle` (Composer).

## Userspace apps we ship

| Binary | What it is |
|--------|------------|
| `wcx` | the CLI: flows, doctor, snapshots, updates, cursors, find, explain, vault, desk |
| `wcx-cursors` | Cursor Studio: converts `.zip/.ani/.cur` packs into animated Xcursor themes |
| `winacux-mouse` | pointer settings: cursor theme/size, trail preset and physics, speed, clicks, handedness |
| `winacux-theme` | Theme Studio: one accent colour for shell, dock, widgets, palette, trail |
| `winacux-update` | Update Center: snapshot-first updates, failed-boot detection, one-click rollback |
| `winacux-rescue` | Rescue: restore snapshots, fsck, rebuild GRUB, reinstall firmware, diagnostics |

Privileged actions elevate through `pkexec`, so a GUI password prompt appears
instead of a terminal prompt. `/usr/local/bin/wcx` declares which subcommands
are privileged.

## Services

| Unit | Job |
|------|-----|
| `winacux-ai.service` | local llama.cpp server on `127.0.0.1:8080` |
| `winacux-boot-attempt.service` | writes `/var/lib/winacux/boot-in-progress` at every boot |
| `winacux-boot-success.service` | clears it after two minutes of a healthy desktop; if it survives to the next boot, the Update Center offers rollback |
| `winacux-recovery.service` | `wcx doctor` on the "WinacuxOS Recovery (diagnostics)" boot entry |

## The AI model

`ai/` holds a complete, reproducible pipeline:

```
ai/scripts/gen_dataset.py      our docs + commands + flows + features -> 183 examples
ai/scripts/train.sh            LoRA fine-tune on Apple Silicon (MLX)
ai/scripts/merge_and_quantize.py   fold the adapter into the base, dequantize, save HF
ai/scripts/export-gguf.sh      HF -> GGUF -> Q4_K_M for llama.cpp
```

The result is baked into the image and served on loopback. Nothing the user
types or copies ever leaves the machine.