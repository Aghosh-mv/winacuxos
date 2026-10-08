# WinacuxOS roadmap

Ten difficulty levels, from "a settings switch" to "a multi-month product".
v1 targets levels 1-7 plus a modest level 8.

## v1 (levels 1-7 + AI v1)

### Level 1 — settings
- [x] No mandatory online account, local user profiles
- [x] Light/dark mode, accent colours
- [x] Workspace switching (Ctrl+Alt+1..4) and the 1-2-3-4 pills in the top bar
- [x] Split-screen / tiling via the tiling-assistant extension
- [x] Focus mode (Num Lock key toggles tiling)

### Level 2 — packaged software, configured
- [x] Winacux Store (GNOME Software + Flatpak plugin)
- [x] File previews (gnome-sushi), file tags (Nautilus)
- [x] Privacy dashboard (GNOME Settings)
- [x] Per-app network permissions (Flatpak portals)
- [x] Phone file/clipboard/notification sharing (KDE Connect)

### Level 3 — packaged software, branded
- [x] Papirus icon theme + Inter font
- [x] Game Mode core (`gamemode`)
- [x] Game library (Lutris)
- [x] Developer Mode toolchain (gcc, make, python, node, docker, git, neovim, ripgrep)
- [x] Secure vault (gocryptfs, `wcx vault`)
- [x] Duplicate-file finder (`wcx dupes`)

### Level 4 — our own scripts and config
- [x] WinacuxOS shell theme + widget styling
- [x] Flow recipes and the `wcx flow` command
- [x] Snapshot before major updates (dpkg hook + timeshift)
- [ ] Neon theme variant

### Level 5 — custom extension, simple parts
- [x] Workspace pills
- [x] Right-hand widget cards (system, weather, usage, calendar)
- [x] Live wallpaper engine (animated drift + glow)
- [x] W logo identity in the top bar

### Level 6 — custom extension, real coding
- [x] Winacux Flow engine (workspace switch + app launch from recipe)
- [x] Game Mode toggle + performance readout
- [ ] Window layout suggestions while dragging (tiling-assistant integration)

### Level 7 — small standalone tools
- [x] Safe Mode: recovery boot entry + `wcx doctor`
- [x] Snapshot UI: `wcx snapshot create|restore`
- [x] App removal with leftovers (`wcx remove`)
- [ ] One-click dev environments (`wcx dev`)

### Level 8 — own application (weeks)
- [x] Winacux AI v1: offline chat, error explanation, file search, code help
- [ ] Natural-language intent routing ("I want to study" -> Flow)

## v2 (levels 9-10)

### Level 9 — deep system work
- [ ] Snapshot rollback wired into boot (restore from a failed update)
- [ ] Wireless screen sharing and keyboard/mouse sharing
- [ ] Window groups
- [ ] Version history for personal files (built on snapshots)

### Level 10 — research-grade
- [ ] Offline voice commands
- [ ] Natural-language file search across the whole disk
- [ ] Per-app firewall daemon with its own GUI
- [ ] Navigation built from scratch rather than GNOME's