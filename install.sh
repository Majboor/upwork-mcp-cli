#!/usr/bin/env bash
# upwork-cli installer — automate Upwork with the official Upwork MCP server.
#
#   curl -fsSL https://raw.githubusercontent.com/Majboor/upwork-mcp-cli/main/install.sh | bash
#
# Clones (or updates) the repo, installs dependencies, and puts `upwork` on your PATH.
# Then run:  upwork login
set -euo pipefail

REPO_URL="${UPWORK_CLI_REPO:-https://github.com/Majboor/upwork-mcp-cli}"
INSTALL_DIR="${UPWORK_CLI_DIR:-$HOME/.upwork-cli-app}"   # code lives here (tokens stay in ~/.upwork-cli)
BIN_DIR="${UPWORK_CLI_BIN:-/usr/local/bin}"

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!  \033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mx  \033[0m %s\n' "$*" >&2; exit 1; }

# --- prerequisites ---------------------------------------------------------
command -v git  >/dev/null 2>&1 || die "git is required. Install Xcode Command Line Tools (xcode-select --install) or your distro's git."
command -v node >/dev/null 2>&1 || die "Node.js 18+ is required. Get it from https://nodejs.org (or: brew install node)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node 18+ required (found $(node -v))."

# --- clone or update -------------------------------------------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  say "Updating existing install in $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only || warn "Could not fast-forward; keeping current checkout."
else
  say "Cloning $REPO_URL → $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

# --- dependencies ----------------------------------------------------------
say "Installing dependencies"
( cd "$INSTALL_DIR" && npm install --no-fund --no-audit --loglevel=error )
chmod +x "$INSTALL_DIR/bin/upwork.js" 2>/dev/null || true

# --- put `upwork` on PATH --------------------------------------------------
link_ok=0
if [ -w "$BIN_DIR" ] 2>/dev/null; then
  ln -sf "$INSTALL_DIR/bin/upwork.js" "$BIN_DIR/upwork" && link_ok=1
elif sudo -n true 2>/dev/null; then
  sudo ln -sf "$INSTALL_DIR/bin/upwork.js" "$BIN_DIR/upwork" && link_ok=1
fi

if [ "$link_ok" -eq 1 ]; then
  say "Installed: $(command -v upwork)"
else
  warn "Couldn't write to $BIN_DIR. Add this alias to your shell profile instead:"
  printf '\n    alias upwork="node %s/bin/upwork.js"\n\n' "$INSTALL_DIR"
fi

# --- done ------------------------------------------------------------------
cat <<EOF

✅ upwork-cli installed.

  Next steps:
    upwork login                 # authorize with the Upwork official MCP (opens your browser)
    upwork commands              # see every tool the MCP publishes
    upwork find_jobs search -p query="ai automation" -p limit=5 --org talent --table

  Automate it: $INSTALL_DIR/examples/n8n/
  Docs:        https://github.com/Majboor/upwork-mcp-cli#readme
EOF
