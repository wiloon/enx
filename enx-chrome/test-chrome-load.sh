#!/bin/bash

# Test script to verify Chrome extension loading

EXT_DIR="/home/wiloon/workspace/enx/enx-chrome/dist"
URL="${1:-https://www.infoq.com/}"

echo "Extension directory: $EXT_DIR"
echo "Opening URL: $URL"
echo ""
echo "Launching Chrome with extension..."

# Use exact same format as Playwright
google-chrome-stable \
  --disable-extensions-except="$EXT_DIR" \
  --load-extension="$EXT_DIR" \
  --user-data-dir=$(mktemp -d) \
  --no-default-browser-check \
  --no-first-run \
  "$URL" \
  > /tmp/chrome-launch.log 2>&1 &

echo "Chrome launched. Check chrome://extensions/ to verify extension is loaded"
echo "Chrome output logged to: /tmp/chrome-launch.log"
