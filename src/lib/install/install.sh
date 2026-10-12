#!/bin/sh
# mdpubs installer. Run it, or paste it into Claude Code or Codex:
#
#   curl -fsSL __ORIGIN__/install | sh
#
# Installs the `mdpubs` CLI and the mdpubs skill, then logs you in through
# your browser. Your access token is written to ~/.config/mdpubs and is never
# printed, so the AI running this never sees it.
set -eu

ORIGIN="__ORIGIN__"
BIN_DIR="${MDPUBS_BIN_DIR:-$HOME/.local/bin}"

command -v curl >/dev/null 2>&1 || { echo "mdpubs: curl is required." >&2; exit 1; }

mkdir -p "$BIN_DIR"
curl -fsSL "$ORIGIN/install/cli" -o "$BIN_DIR/mdpubs"
chmod +x "$BIN_DIR/mdpubs"
echo "Installed the mdpubs CLI to $BIN_DIR/mdpubs"

# The skill goes to every agent found on this machine. Claude Code if none.
installed=0
for home in "$HOME/.claude" "$HOME/.codex"; do
	if [ -d "$home" ]; then
		mkdir -p "$home/skills/mdpubs"
		curl -fsSL "$ORIGIN/install/skill" -o "$home/skills/mdpubs/SKILL.md"
		echo "Installed the mdpubs skill to $home/skills/mdpubs"
		installed=1
	fi
done
if [ "$installed" = 0 ]; then
	mkdir -p "$HOME/.claude/skills/mdpubs"
	curl -fsSL "$ORIGIN/install/skill" -o "$HOME/.claude/skills/mdpubs/SKILL.md"
	echo "Installed the mdpubs skill to $HOME/.claude/skills/mdpubs"
fi

case ":$PATH:" in
	*":$BIN_DIR:"*) ;;
	*) echo "Note: $BIN_DIR is not on your PATH. Call the CLI as $BIN_DIR/mdpubs." ;;
esac

echo
exec "$BIN_DIR/mdpubs" login
