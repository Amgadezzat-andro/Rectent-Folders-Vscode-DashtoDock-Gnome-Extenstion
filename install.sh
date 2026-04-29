#!/usr/bin/env bash
# install.sh — Install the VSCode Recent Folders GNOME Shell extension
set -e

EXTENSION_UUID="vscode-recent-folders@amgad"
INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== VSCode Recent Folders — GNOME Shell Extension Installer ==="
echo ""

# ── 1. Install files ──────────────────────────────────────────────────────────
echo "[1/4] Installing extension files to:"
echo "      $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/extension.js" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/prefs.js"     "$INSTALL_DIR/"
cp "$SCRIPT_DIR/metadata.json" "$INSTALL_DIR/"
echo "      Done."
echo ""

# ── 2. Install and compile GSettings schema ───────────────────────────────────
echo "[2/4] Installing GSettings schema..."
SCHEMA_DIR="$INSTALL_DIR/schemas"
mkdir -p "$SCHEMA_DIR"
cp "$SCRIPT_DIR/schemas/"*.gschema.xml "$SCHEMA_DIR/"
glib-compile-schemas "$SCHEMA_DIR"
echo "      Schema compiled."
echo ""

# ── 2. Verify VS Code storage file exists ────────────────────────────────────
echo "[3/4] Checking for VS Code recent-folders storage..."
FOUND=0
for STORAGE_PATH in \
    "$HOME/.config/Code/User/globalStorage/storage.json" \
    "$HOME/snap/code/common/.config/Code/User/globalStorage/storage.json" \
    "$HOME/.var/app/com.visualstudio.code/config/Code/User/globalStorage/storage.json"
do
    if [[ -f "$STORAGE_PATH" ]]; then
        echo "      Found: $STORAGE_PATH"
        FOUND=1
        break
    fi
done
if [[ $FOUND -eq 0 ]]; then
    echo "      WARNING: VS Code storage file not found."
    echo "      Open VS Code and open some folders first, then the menu items will appear."
fi
echo ""

# ── 3. Enable the extension ───────────────────────────────────────────────────
echo "[4/4] Enabling extension..."

# On Wayland (Ubuntu 24.04 default) GNOME Shell cannot be restarted in-session.
# The extension manager can load new extensions without a full restart IF
# the extension directory was just created.
if gnome-extensions enable "$EXTENSION_UUID" 2>/dev/null; then
    echo "      Extension enabled successfully!"
else
    echo "      Could not enable automatically."
    echo "      Please log out and log back in, then run:"
    echo "        gnome-extensions enable $EXTENSION_UUID"
    echo "      Or open the 'GNOME Extensions' app and enable 'VSCode Recent Folders'."
fi

echo ""
echo "=== Installation complete ==="
echo ""
echo "Right-click the VS Code icon in the dock — you should see a"
echo "'Recent Folders' section at the bottom of the context menu."
echo ""
echo "To uninstall:"
echo "  gnome-extensions disable $EXTENSION_UUID"
echo "  rm -rf \"$INSTALL_DIR\""
