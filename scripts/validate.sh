#!/usr/bin/env bash
# Static checks for everything WinacuxOS ships that is not a package:
# extension JavaScript, JSON, GSettings schemas, shell scripts and flow
# recipes. Run before every build - a syntax error in any of these shows up at
# boot as a broken shell, which is expensive to debug from a screenshot.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT="$ROOT/config/includes.chroot/usr/share/gnome-shell/extensions/winacux@winacuxos.org"
FLOWS="$ROOT/config/includes.chroot/etc/skel/.config/winacux/flows"
fail=0

echo "==> extension JavaScript"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for f in "$EXT"/*.js; do
    cp "$f" "$tmp/$(basename "${f%.js}").mjs"
done
for f in "$tmp"/*.mjs; do
    printf '    %-16s ' "$(basename "$f")"
    if node --check "$f" 2>/dev/null; then echo OK; else echo FAIL; fail=1; fi
done

echo "==> JSON"
for j in "$EXT"/metadata.json "$FLOWS"/*.json "$ROOT"/config/includes.chroot/usr/share/gnome-shell/extensions/winacux@winacuxos.org/*.json; do
    [ -e "$j" ] || continue
    printf '    %-24s ' "$(basename "$j")"
    if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$j" 2>/dev/null; then
        echo OK
    else
        echo FAIL
        fail=1
    fi
done

echo "==> GSettings schemas"
for x in "$EXT"/schemas/*.xml; do
    [ -e "$x" ] || continue
    printf '    %-52s ' "$(basename "$x")"
    if xmllint --noout "$x" 2>/dev/null; then echo OK; else echo FAIL; fail=1; fi
done

echo "==> shell scripts"
for s in "$ROOT"/config/includes.chroot/usr/local/bin/wcx "$ROOT"/config/hooks/live/*.hook.chroot; do
    [ -e "$s" ] || continue
    printf '    %-46s ' "$(basename "$s")"
    if sh -n "$s" 2>/dev/null || bash -n "$s" 2>/dev/null; then echo OK; else echo FAIL; fail=1; fi
done
for s in "$ROOT"/scripts/*.sh; do
    [ -e "$s" ] || continue
    printf '    %-46s ' "$(basename "$s")"
    if bash -n "$s" 2>/dev/null; then echo OK; else echo FAIL; fail=1; fi
done

echo "==> asset sources"
for a in "$ROOT"/branding/logo.svg "$ROOT"/branding/wallpaper.svg; do
    printf '    %-46s ' "$(basename "$a")"
    if xmllint --noout "$a" 2>/dev/null; then echo OK; else echo FAIL; fail=1; fi
done

if [ "$fail" -ne 0 ]; then
    echo
    echo "!! validation failed"
    exit 1
fi
echo
echo "==> all static checks passed"