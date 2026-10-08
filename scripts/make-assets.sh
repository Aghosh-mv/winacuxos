#!/usr/bin/env bash
# Renders every brand asset from the SVG masters in branding/.
# Requires: librsvg (rsvg-convert) + ImageMagick (magick).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/branding"
mkdir -p out

echo "==> Logo sizes"
rsvg-convert -w 1024 -h 1024 logo.svg -o out/logo-1024.png
rsvg-convert -w 512  -h 512  logo.svg -o out/logo-512.png
rsvg-convert -w 256  -h 256  logo.svg -o out/logo-256.png
rsvg-convert -w 64   -h 64   logo.svg -o out/logo-64.png

echo "==> Wallpapers"
rsvg-convert -w 3840 -h 2160 wallpaper.svg -o out/wallpaper-3840.png
magick out/wallpaper-3840.png -resize 1920x1080 out/wallpaper-1920.png
magick out/wallpaper-3840.png -modulate 82,72,100 -resize 1920x1080 out/wallpaper-dark-1920.png

echo "==> Boot loader art"
cp out/wallpaper-1920.png out/grub-background.png
magick out/wallpaper-3840.png -resize '853x480^' -gravity center -extent 640x480 out/splash-640x480.png

echo "==> Staging assets into config/includes.chroot"
STAGE="$ROOT/config/includes.chroot/usr/share/winacuxos"
BG="$ROOT/config/includes.chroot/usr/share/backgrounds/winacuxos"
mkdir -p "$STAGE" "$BG"
cp out/logo-1024.png       "$STAGE/logo.png"
cp out/logo-256.png        "$STAGE/logo-256.png"
cp out/logo-256.png        "$STAGE/logo-gdm.png"
cp out/logo-1024.png       "$STAGE/wallpaper.png"
cp out/wallpaper-3840.png  "$BG/winacuxos.png"
cp out/wallpaper-dark-1920.png "$BG/winacuxos-dark.png"

echo "==> Result"
ls -1sh out/