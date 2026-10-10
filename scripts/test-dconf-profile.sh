#!/usr/bin/env bash
# Determines which dconf profile header actually works on this distribution.
#
# This is here because getting it wrong is invisible: without a working
# profile, GNOME never reads /etc/dconf/db/local.d, so every default an image
# ships is silently ignored (that is how an earlier WinacuxOS build booted with
# a stock wallpaper and a bottom dock).
set -euo pipefail

IMAGE="${1:-debian:trixie-slim}"

docker run --rm "$IMAGE" bash -s <<'INNER'
set -e
apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq dconf-cli >/dev/null 2>&1

mkdir -p /etc/dconf/profile /etc/dconf/db/local.d

for variant in "user" "userdb:user" "user-db:user"; do
    printf '%s\nsystem-db:local\n' "$variant" > /etc/dconf/profile/user
    printf "[org/winacuxtest]\nkey='%s'\n" "$variant" > /etc/dconf/db/local.d/00-test
    dconf update 2>/dev/null || true
    output=$(dconf dump /org/winacuxtest/ 2>&1 || true)
    if [ -n "$output" ]; then
        printf 'profile "%s"  -> WORKS (%s)\n' "$variant" "$output"
        WORKING="$variant"
    else
        printf 'profile "%s"  -> empty\n' "$variant"
    fi
    rm -f /etc/dconf/db/local.d/00-test
done
INNER