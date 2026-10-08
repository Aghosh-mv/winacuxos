# WinacuxOS Brand Identity

Source of truth for all visual decisions. Derived from the WinacuxOS desktop mockup.

## Names

- Distro: **WinacuxOS**
- Version: **1.0**
- Taglines: **"Your OS. Your Way."** (wallpaper) · **"Simple. Fast. Powerful."** (widget card)
- ID (os-release): `winacuxos`
- Repo / extension UUID: `winacux@winacuxos.org`

## Palette

| Role                | Hex       |
|---------------------|-----------|
| Deep navy (bg)      | `#0A1633` |
| Panel / glass dark  | `#0B1220` |
| Blue accent         | `#4DA3FF` |
| Purple accent       | `#A06BFF` |
| Gradient (logo)     | `#4DA3FF → #A06BFF` |
| Pink (icons/highlight) | `#FF5C8A` |
| Green (success)     | `#22C55E` |
| Text primary        | `#F5F7FA` |
| Text secondary      | `#C8D2E0` |

## Typography

- UI font: **Inter** (`fonts-inter` in the image)
- Wordmark: Inter Bold, "Winacux" in white, "OS" in cyan-blue gradient

## Logo

Stylized "W": two thick rounded strokes, left leg blue, right leg violet,
gradient across the letter. `branding/logo.svg` is the master file.

## Desktop identity (mockup decisions)

- Top bar: W logo + "WinacuxOS" left, workspace pills `1 2 3 4`, system tray right
- Left dock: rounded glassy pill, labels, app-grid button
- Right side: floating widget cards (system, weather, usage, calendar)
- Wallpaper: dusk lake + mountains + city skyline + glowing arc, with wordmark baked in
- Icons: Papirus (colorful rounded squares)
- Modes: Light / Dark / Neon (Dark default)

## Placeholder data policy (user decision: KEEP mockup values)

Kept verbatim from the mockup even when technically fake:

- Kernel line: `Winacux Kernel 6.6.0`
- User: `Geethu`
- Weather: `Kochi, India — 28°C, Partly Cloudy, H:31° L:24°`
- Widget tagline: `Simple. Fast. Powerful.`

Live values (real telemetry): clock/date, uptime counter, CPU/Memory/Disk %,
calendar grid, battery. Real system identity: `/etc/os-release`, hostname,
installed kernel (shown in Settings, not the widget).
