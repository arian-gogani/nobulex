#!/bin/bash
echo "=== Bundle sizes ==="
total=0
for pkg in packages/*/dist; do
  name=$(basename $(dirname "$pkg"))
  if [ -d "$pkg" ]; then
    size=$(du -sk "$pkg" | cut -f1)
    total=$((total + size))
    printf "  @nobulex/%-20s %6dKB\n" "$name" "$size"
  fi
done
echo "---"
printf "  %-27s %6dKB\n" "TOTAL" "$total"
