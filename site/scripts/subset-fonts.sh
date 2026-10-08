#!/bin/sh
# Writes the page's two fonts, cut from the fontsource files in node_modules
# to the axis ranges and characters the page uses: the full variable files
# put 130 KB on the first visit's critical path, and Lighthouse's first paint
# counts every byte of it.
#
#   sh site/scripts/subset-fonts.sh   (from the repo root, after pnpm install)
#
# Needs uv. The output is checked in (src/fonts); run this again after a font
# upgrade or when the copy needs a character outside the lists below.
set -eu

FONTTOOLS='fonttools[woff]==4.65.0'
site=$(dirname "$0")/..
out=$site/src/fonts
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# ASCII and the punctuation the copy and the quotes use. Latin-1 would add
# 17 KB and cost first paint its full score; a character outside these lists
# is drawn by the next font in the stack, so add it here when the copy needs it.
TEXT='U+0020-007E,U+00A0,U+00B7,U+2013-2014,U+2018-2019,U+201C-201D,U+2026'
# Mono sets code, ids and the frames: ASCII, and the frames' arrows. Their
# other symbols fall back, as they always did.
MONO='U+0020-007E,U+00A0,U+00B7,U+2026,U+2191,U+2193'

cut() { # source axes unicodes output
  uvx --quiet --from "$FONTTOOLS" fonttools varLib.instancer "$1" $2 -o "$tmp/instance.ttf"
  uvx --quiet --from "$FONTTOOLS" pyftsubset "$tmp/instance.ttf" --unicodes="$3" \
    --layout-features='kern,liga,calt' --flavor=woff2 --output-file="$4"
}

mkdir -p "$out"
cut "$site/node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2" \
  'wght=400:700 wdth=100' "$TEXT" "$out/archivo.woff2"
cut "$site/node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2" \
  'wght=400:700' "$MONO" "$out/jetbrains-mono.woff2"
ls -l "$out"
