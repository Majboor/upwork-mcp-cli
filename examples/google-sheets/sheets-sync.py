#!/usr/bin/env python3
"""
sheets-sync.py — sync Upwork jobs (via the official MCP + upwork-cli) into a Google Sheet.

Runs `upwork find_jobs search ... --raw`, parses the MCP envelope's
`content[0].text` (a JSON *string*, not an object — this is the one gotcha
every upwork-cli integration has to handle), and appends any job IDs not
already present in column A of your sheet. Safe to run over and over — on a
cron job, a launchd timer, GitHub Actions, anywhere — it only ever appends
new rows.

Auth: a Google service account (NOT OAuth) so this can run unattended.
  1. Create a service account in Google Cloud Console, enable the
     Google Sheets API, and download its JSON key.
  2. Share your target Google Sheet with the service account's
     `client_email` (Editor access).
  3. Set the env vars below and run.

Install deps (once):
    # pip install gspread google-auth
"""

import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone

try:
    import gspread
    from google.oauth2.service_account import Credentials
except ImportError:
    print(
        "Missing deps. Run: pip install gspread google-auth",
        file=sys.stderr,
    )
    sys.exit(1)

# ---- config (env vars) -----------------------------------------------------
GOOGLE_APPLICATION_CREDENTIALS = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
SHEET_ID = os.environ.get("SHEET_ID")
WORKSHEET_NAME = os.environ.get("WORKSHEET_NAME", "Sheet1")
QUERY = os.environ.get("QUERY", "react developer")
LIMIT = os.environ.get("LIMIT", "10")
ORG = os.environ.get("ORG", "talent")

HEADER = ["id", "title", "budget", "proposals", "country", "skills", "date"]

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
]


def find_cli() -> list[str]:
    """Prefer `upwork` on PATH, else fall back to this repo's bin/upwork.js."""
    if shutil.which("upwork"):
        return ["upwork"]
    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(here, "..", ".."))
    cli_js = os.path.join(repo_root, "bin", "upwork.js")
    if not os.path.exists(cli_js):
        print(
            f"Could not find `upwork` on PATH or {cli_js}. "
            "Install the CLI first (see the repo README).",
            file=sys.stderr,
        )
        sys.exit(1)
    return ["node", cli_js]


def search_jobs(query: str, limit: str, org: str) -> list[dict]:
    """Run `find_jobs search --raw` and return the parsed list of job dicts.

    The MCP wraps every response as {"content":[{"type":"text","text":"<json>"}]}
    — the payload is a JSON *string* inside content[0].text, so it has to be
    parsed twice: once for the envelope, once for the actual data.
    """
    cli = find_cli()
    argv = cli + [
        "find_jobs",
        "search",
        "-p",
        f"query={query}",
        "-p",
        f"limit={limit}",
        "--org",
        org,
        "--raw",
    ]
    result = subprocess.run(argv, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        print(f"upwork-cli failed: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)

    envelope = json.loads(result.stdout)
    text = envelope["content"][0]["text"]  # JSON string, not an object
    payload = json.loads(text)
    return payload.get("jobs", [])


def job_to_row(job: dict) -> list:
    skills = job.get("skills") or []
    if isinstance(skills, list):
        skills = ", ".join(str(s) for s in skills)
    return [
        str(job.get("id", "")),  # ids are strings — never coerce to int
        job.get("title", ""),
        job.get("budget", ""),
        job.get("proposal_count", ""),
        (job.get("client") or {}).get("country", ""),
        skills,
        datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    ]


def open_worksheet():
    if not GOOGLE_APPLICATION_CREDENTIALS or not SHEET_ID:
        print(
            "Set GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON) "
            "and SHEET_ID (the spreadsheet id from its URL) env vars first.",
            file=sys.stderr,
        )
        sys.exit(1)

    creds = Credentials.from_service_account_file(
        GOOGLE_APPLICATION_CREDENTIALS, scopes=SCOPES
    )
    client = gspread.authorize(creds)
    spreadsheet = client.open_by_key(SHEET_ID)
    try:
        ws = spreadsheet.worksheet(WORKSHEET_NAME)
    except gspread.exceptions.WorksheetNotFound:
        ws = spreadsheet.add_worksheet(title=WORKSHEET_NAME, rows=1000, cols=len(HEADER))

    if not ws.row_values(1):
        ws.append_row(HEADER, value_input_option="RAW")

    return ws


def existing_ids(ws) -> set:
    """Column A holds job ids; row 1 is the header."""
    col_a = ws.col_values(1)
    return set(col_a[1:]) if col_a else set()


def main():
    jobs = search_jobs(QUERY, LIMIT, ORG)
    if not jobs:
        print("No jobs returned for query "+repr(QUERY)+".")
        return

    ws = open_worksheet()
    seen = existing_ids(ws)

    new_rows = [job_to_row(j) for j in jobs if str(j.get("id", "")) not in seen]
    if not new_rows:
        print(f"Fetched {len(jobs)} job(s); all already in the sheet. Nothing to add.")
        return

    ws.append_rows(new_rows, value_input_option="RAW")
    print(f"Appended {len(new_rows)} new job(s) (of {len(jobs)} fetched) to '{WORKSHEET_NAME}'.")


if __name__ == "__main__":
    main()
