#!/usr/bin/env bash
# Quick install: symlinks the `multiverse` command to /usr/local/bin
# Usage: ./install.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Installing Multiverse CLI..."
chmod +x "$SCRIPT_DIR/multiverse"

if [ -w /usr/local/bin ]; then
  ln -sf "$SCRIPT_DIR/multiverse" /usr/local/bin/multiverse
  echo "✓ Installed to /usr/local/bin/multiverse"
elif [ -w "$HOME/.local/bin" ]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$SCRIPT_DIR/multiverse" "$HOME/.local/bin/multiverse"
  echo "✓ Installed to $HOME/.local/bin/multiverse"
else
  echo "! Cannot write to /usr/local/bin or ~/.local/bin"
  echo "  Add this to your PATH or run directly:"
  echo "  export PATH=\"$SCRIPT_DIR:\$PATH\""
  exit 1
fi

echo ""
echo "Try it: multiverse"
echo "Then type /multiverse to activate decision tree mode"
