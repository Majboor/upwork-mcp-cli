#!/usr/bin/env bash
# upwork-alerts.sh — scheduled Upwork job alerts via the official Upwork MCP.
#
# Searches a list of keywords, remembers what it has already seen, and prints
# (and optionally desktop-notifies) only the NEW jobs. Perfect for cron.
#
#   ./upwork-alerts.sh                      # run once, print new jobs
#   KEYWORDS="react,next.js" ./upwork-alerts.sh
#
# Cron (every 30 min):  see README.md in this folder.
set -uo pipefail

# ---- config (override via env) --------------------------------------------
# Common things freelancers actually search for on Upwork. Edit freely.
KEYWORDS="${KEYWORDS:-n8n automation,GoHighLevel,Zapier,Make.com,AI automation,ChatGPT integration,OpenAI API,web scraping,React developer,Next.js,Shopify,WordPress,Python automation,API integration,chatbot,Airtable,automation expert,data pipeline}"
LIMIT="${LIMIT:-10}"
ORG="${ORG:-talent}"
STATE_DIR="${STATE_DIR:-$HOME/.upwork-cli/alerts}"
NOTIFY="${NOTIFY:-1}"          # 1 = macOS desktop notification for new jobs

# locate the CLI: prefer `upwork` on PATH, else this repo's bin
if command -v upwork >/dev/null 2>&1; then CLI=(upwork)
else CLI=(node "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/bin/upwork.js"); fi

mkdir -p "$STATE_DIR"
SEEN="$STATE_DIR/seen.txt"; touch "$SEEN"
have_jq=0; command -v jq >/dev/null 2>&1 && have_jq=1
new_total=0

notify() { [ "$NOTIFY" = "1" ] && command -v osascript >/dev/null 2>&1 && \
  osascript -e "display notification \"$2\" with title \"Upwork: $1\"" >/dev/null 2>&1 || true; }

IFS=',' read -ra KW <<< "$KEYWORDS"
for raw in "${KW[@]}"; do
  q="$(echo "$raw" | sed 's/^ *//;s/ *$//')"; [ -z "$q" ] && continue
  out="$("${CLI[@]}" find_jobs search -p query="$q" -p limit="$LIMIT" --org "$ORG" --raw 2>/dev/null)" || continue

  if [ "$have_jq" = "1" ]; then
    rows="$(printf '%s' "$out" | jq -r '(.content[0].text | fromjson | .jobs[]?) | "\(.id)\t\(.title)"' 2>/dev/null)"
  else
    # no jq: crude id\ttitle extraction from the nested JSON
    rows="$(printf '%s' "$out" | tr ',' '\n' | grep -oE '"(id|title)":"[^"]*"' | paste - - 2>/dev/null | sed 's/"id":"//;s/","title":"/\t/;s/"$//')"
  fi
  [ -z "$rows" ] && continue

  new_for_kw=0
  while IFS=$'\t' read -r id title; do
    [ -z "$id" ] && continue
    if ! grep -q "^$id$" "$SEEN"; then
      echo "$id" >> "$SEEN"
      printf '  🔔 [%s] %s\n' "$q" "$title"
      new_for_kw=$((new_for_kw+1)); new_total=$((new_total+1))
    fi
  done <<< "$rows"
  [ "$new_for_kw" -gt 0 ] && notify "$q" "$new_for_kw new job(s)"
done

echo "── $new_total new job(s) across ${#KW[@]} keywords. State: $SEEN"
