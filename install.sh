#!/usr/bin/env bash
set -e

REPO="bloccooo/web-replay"
BIN_NAME="wsr"

# Detect OS and arch
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)  OS_KEY="linux" ;;
  Darwin) OS_KEY="macos" ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64)  ARCH_KEY="x64" ;;
  arm64|aarch64) ARCH_KEY="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

ASSET="wsr-${OS_KEY}-${ARCH_KEY}"

# Install ffmpeg if missing
if ! command -v ffmpeg &>/dev/null; then
  echo "ffmpeg not found — installing..."
  if [ "$OS_KEY" = "macos" ]; then
    if ! command -v brew &>/dev/null; then
      echo "Homebrew is required to install ffmpeg on macOS."
      echo "Install it from https://brew.sh, then re-run this script."
      exit 1
    fi
    brew install ffmpeg
  elif command -v apt-get &>/dev/null; then
    sudo apt-get update -q && sudo apt-get install -y ffmpeg
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y ffmpeg
  elif command -v pacman &>/dev/null; then
    sudo pacman -S --noconfirm ffmpeg
  else
    echo "Could not install ffmpeg automatically. Please install it manually and re-run."
    exit 1
  fi
fi

# Resolve latest release tag
TAG="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"
if [ -z "$TAG" ]; then
  echo "Could not determine latest release tag."
  exit 1
fi

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"

# Pick install dir — prefer /usr/local/bin, fall back to ~/.local/bin
if [ -w /usr/local/bin ]; then
  INSTALL_DIR="/usr/local/bin"
else
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
  # Warn if not in PATH
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *) echo "Note: add $INSTALL_DIR to your PATH to use wsr from anywhere." ;;
  esac
fi

echo "Downloading ${BIN_NAME} ${TAG} (${OS_KEY}/${ARCH_KEY})..."
curl -fsSL "$DOWNLOAD_URL" -o "${INSTALL_DIR}/${BIN_NAME}"
chmod +x "${INSTALL_DIR}/${BIN_NAME}"

echo ""
echo "Installed to ${INSTALL_DIR}/${BIN_NAME}"
echo ""
echo "Chromium will be downloaded automatically on first use."
echo "Run 'wsr --help' to get started."
