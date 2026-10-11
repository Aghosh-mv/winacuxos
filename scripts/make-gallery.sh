#!/usr/bin/env bash
# Builds a clickable HTML gallery from the boot-test screenshots, so the real
# desktop can be reviewed (and shared) without opening a VM.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIRS=("$ROOT/artifacts/patched" "$ROOT/artifacts/boot")
OUT="$ROOT/artifacts/gallery"

mkdir -p "$OUT/images"
rm -f "$OUT/images"/*.png

pick=()
for dir in "${SRC_DIRS[@]}"; do
    [ -d "$dir" ] || continue
    # newest first, keep the distinct ones
    while IFS= read -r file; do
        pick+=("$file")
    done < <(ls -t "$dir"/*.png 2>/dev/null | head -4)
done

index=1
for file in "${pick[@]}"; do
    name=$(printf '%02d-%s' "$index" "$(basename "$file")")
    cp "$file" "$OUT/images/$name"
    index=$((index + 1))
done

{
    cat <<'HEAD'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>WinacuxOS — live screenshots</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:40px; background:#070c1c; color:#f5f7fa;
         font-family:-apple-system, "Inter", "Helvetica Neue", sans-serif; }
  h1 { font-size:26px; margin:0 0 4px; }
  .sub { color:#8fa3c0; margin-bottom:28px; font-size:14px; }
  .grid { display:grid; gap:24px; grid-template-columns:repeat(auto-fit,minmax(520px,1fr)); }
  figure { margin:0; background:#0b1220; border:1px solid rgba(122,160,255,.22);
           border-radius:16px; overflow:hidden; }
  img { width:100%; display:block; }
  figcaption { padding:10px 14px; font-size:12px; color:#9fb0c8;
               border-top:1px solid rgba(122,160,255,.14); }
  .tag { display:inline-block; margin-right:8px; padding:2px 8px; border-radius:999px;
         background:rgba(123,92,255,.25); color:#cbd8ff; font-size:11px; }
</style>
</head>
<body>
<h1>WinacuxOS</h1>
<div class="sub">Real boot output — captured from the live ISO running under QEMU with hardware acceleration.</div>
<div class="grid">
HEAD

    for file in "$OUT/images"/*.png; do
        [ -e "$file" ] || continue
        base=$(basename "$file")
        printf '  <figure>\n    <img src="images/%s" alt="%s">\n    <figcaption><span class="tag">%s</span>%s</figcaption>\n  </figure>\n' \
            "$base" "$base" \
            "$(printf '%s' "$base" | cut -d- -f1)" \
            "$(printf '%s' "$base" | cut -d- -f2-)"
    done

    cat <<'TAIL'
</div>
</body>
</html>
TAIL
} > "$OUT/index.html"

echo "==> gallery written: $OUT/index.html"
ls -1 "$OUT/images" | sed 's/^/    /'