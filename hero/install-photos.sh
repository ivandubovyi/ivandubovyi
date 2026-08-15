#!/bin/bash
# Installs hero photos for ivandubovyi.com
#
# HOW TO USE
#   1. Save your photos into this folder (hero/) as drop1.jpg, drop2.jpg,
#      drop3.jpg, drop4.jpg. Any size, straight off your phone is fine.
#      HEIC works too, just name them drop1.HEIC etc.
#   2. Run:  bash hero/install-photos.sh
#
# It resizes, compresses and installs them as n1..n4.jpg, which is what
# index.html points at. Anything you don't supply is left untouched, so you
# can replace just one photo if you want.

set -u
cd "$(dirname "$0")" || exit 1

installed=0
for i in 1 2 3 4; do
  src=""
  for ext in jpg JPG jpeg JPEG png PNG heic HEIC; do
    [ -f "drop$i.$ext" ] && { src="drop$i.$ext"; break; }
  done

  if [ -z "$src" ]; then
    echo "skip  n$i.jpg  (no drop$i.* found, keeping the current photo)"
    continue
  fi

  cp "$src" "tmp$i"
  # long edge to 520px, then JPEG at quality 70. sips keeps the EXIF
  # orientation flag, so photos shot in portrait stay upright.
  sips -s format jpeg -Z 520 -s formatOptions 70 "tmp$i" --out "n$i.jpg" >/dev/null 2>&1

  if [ -f "n$i.jpg" ]; then
    rm -f "tmp$i"
    size=$(du -k "n$i.jpg" | cut -f1)
    echo "ok    n$i.jpg  <- $src  (${size}KB)"
    installed=$((installed + 1))
  else
    rm -f "tmp$i"
    echo "FAIL  n$i.jpg  <- $src  (sips could not convert it)"
  fi
done

echo
echo "$installed photo(s) installed. Reload the site to see them."
