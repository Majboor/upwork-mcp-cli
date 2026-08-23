#!/usr/bin/env python3
"""
upwork_triage.py — search Upwork jobs via the official MCP (through upwork-cli),
score them, and print a HOT/WATCH/SKIP triage table.

Pure standard library. No pip install, no API key — it shells out to `upwork`
(or `node bin/upwork.js` if the CLI isn't on PATH) and lets upwork-cli handle
OAuth 2.1 against Upwork's official MCP server.

Usage:
    python3 examples/python/upwork_triage.py "n8n automation" --limit 10 --enrich 3
    python3 examples/python/upwork_triage.py "ai automation" "GoHighLevel" --limit 15
    python3 examples/python/upwork_triage.py "react developer" --org talent --enrich 5

What it does:
    1. Runs `find_jobs search` for each keyword (via --raw, parsing the MCP
       envelope's nested content[0].text JSON string).
    2. Computes a preliminary Alpha Score from cheap, always-present signals:
       proposal count (competition) and client reputation.
    3. Optionally "enriches" the top --enrich jobs with `find_jobs get`, which
       adds competitor bid stats (applicationsBidStats) and deeper client
       spend/hire history — then recomputes the score with a bid-headroom term.
    4. Prints an aligned table, sorted by score, tagged HOT / WATCH / SKIP.

See the formula under "How it works" in examples/python/README.md.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from typing import Any, Optional


# --------------------------------------------------------------------------
# CLI plumbing
# --------------------------------------------------------------------------

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
            "Install the CLI first (see the repo README) and run `upwork login`.",
            file=sys.stderr,
        )
        sys.exit(1)
    return ["node", cli_js]


def run(*args: str) -> Any:
    """Run an upwork-cli command with --raw and return the *unwrapped* payload.

    The MCP always wraps a result as:
        {"content": [{"type": "text", "text": "<json>"}]}
    and that inner "text" is itself a JSON *string* (not an object) — the one
    gotcha every upwork-cli integration has to handle. This helper parses the
    envelope, then parses content[0].text a second time, and hands back the
    actual payload dict/list.
    """
    cli = find_cli()
    argv = [*cli, *args, "--raw"]
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"upwork-cli timed out: {' '.join(argv)}")

    if result.returncode != 0:
        stderr = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"upwork-cli failed ({' '.join(argv)}): {stderr}")

    envelope = json.loads(result.stdout)
    content = envelope.get("content") or []
    if not content or "text" not in content[0]:
        raise RuntimeError(f"Unexpected MCP envelope shape: {result.stdout[:200]!r}")

    return json.loads(content[0]["text"])  # nested-string unwrap


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------

@dataclass
class JobRow:
    id: str
    title: str
    description_snippet: str = ""
    job_type: Optional[str] = None          # "fixed" | "hourly"
    budget: Optional[float] = None
    proposal_count: Optional[int] = None
    skills: list[str] = field(default_factory=list)
    country: Optional[str] = None
    client_rating: Optional[float] = None
    client_total_hires: Optional[int] = None
    client_total_posted: Optional[int] = None
    client_verified: Optional[bool] = None

    # populated only when --enrich pulls `find_jobs get`
    enriched: bool = False
    avg_bid: Optional[float] = None
    min_bid: Optional[float] = None
    max_bid: Optional[float] = None
    connects_cost: Optional[int] = None
    client_spend: Optional[float] = None
    client_contracts_total: Optional[int] = None
    client_jobs_with_hires: Optional[int] = None
    client_feedback_score: Optional[float] = None

    score: float = 0.0
    tag: str = "WATCH"


def _as_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_int(value: Any) -> Optional[int]:
    f = _as_float(value)
    return int(f) if f is not None else None


def job_from_search(job: dict) -> JobRow:
    client = job.get("client") or {}
    skills = job.get("skills") or []
    if not isinstance(skills, list):
        skills = []

    verified = client.get("verification_status")
    return JobRow(
        id=str(job.get("id", "")),
        title=job.get("title") or "(untitled)",
        description_snippet=job.get("description_snippet") or "",
        job_type=job.get("job_type"),
        budget=_as_float(job.get("budget")),
        proposal_count=_as_int(job.get("proposal_count")),
        skills=[str(s) for s in skills],
        country=client.get("country"),
        client_rating=_as_float(client.get("rating")),
        client_total_hires=_as_int(client.get("total_hires")),
        client_total_posted=_as_int(client.get("total_posted_jobs")),
        client_verified=(str(verified).upper() == "VERIFIED") if verified else None,
    )


def _dig(obj: Any, *path: str) -> Any:
    """Safely walk a chain of dict keys, returning None on any miss."""
    cur = obj
    for key in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def enrich_job(row: JobRow, payload: dict) -> None:
    """Fold a `find_jobs get` payload's deep intel into an existing JobRow."""
    mjp = _dig(payload, "data", "marketplaceJobPosting") or {}
    bid_stats = _dig(mjp, "activityStat", "applicationsBidStats") or {}
    contract_terms = mjp.get("contractTerms") or {}
    client_record = payload.get("client_record") or {}

    row.avg_bid = _as_float(_dig(bid_stats, "avgRateBid", "rawValue"))
    row.min_bid = _as_float(_dig(bid_stats, "minRateBid", "rawValue"))
    row.max_bid = _as_float(_dig(bid_stats, "maxRateBid", "rawValue"))
    row.connects_cost = _as_int(payload.get("connects_cost"))

    row.client_spend = _as_float(client_record.get("spend_total"))
    row.client_contracts_total = _as_int(client_record.get("contracts_total"))
    row.client_jobs_with_hires = _as_int(client_record.get("jobs_with_hires"))
    row.client_feedback_score = _as_float(client_record.get("feedback_score"))

    # Prefer the precise contract amount over the search snapshot's budget,
    # when the get() call actually returned one.
    fixed_amount = _as_float(
        _dig(contract_terms, "fixedPriceContractTerms", "amount", "rawValue")
    )
    if fixed_amount is not None:
        row.budget = fixed_amount
    if contract_terms.get("contractType"):
        row.job_type = contract_terms["contractType"].lower()

    row.enriched = True


# --------------------------------------------------------------------------
# Alpha Score
# --------------------------------------------------------------------------

def _clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def score_competition(proposal_count: Optional[int]) -> float:
    """Lower proposal_count = better. Unknown (brand-new posting) = mild optimism."""
    if proposal_count is None:
        return 65.0
    if proposal_count <= 0:
        return 100.0
    return _clamp(100.0 - proposal_count * 1.8)


def score_headroom(row: JobRow) -> Optional[float]:
    """How far the client's stated budget sits above the average competing bid.

    Only meaningful once a job is enriched (needs applicationsBidStats).
    Returns None when there isn't enough data to judge headroom.
    """
    if not row.enriched or row.avg_bid in (None, 0) or row.budget is None:
        return None
    ratio = (row.budget - row.avg_bid) / row.avg_bid
    return _clamp(50.0 + ratio * 50.0)


def score_client(row: JobRow) -> float:
    """Blend whatever client-reputation signals are available (search and/or enriched)."""
    parts: list[float] = []
    weights: list[float] = []

    if row.client_verified is not None:
        parts.append(100.0 if row.client_verified else 30.0)
        weights.append(0.5)

    rating = row.client_feedback_score if row.client_feedback_score is not None else row.client_rating
    if rating is not None:
        parts.append(_clamp(rating / 5.0 * 100.0))
        weights.append(1.0)

    total_posted = row.client_contracts_total or row.client_total_posted
    total_hired = row.client_jobs_with_hires or row.client_total_hires
    if total_posted:
        parts.append(_clamp((total_hired or 0) / total_posted * 100.0))
        weights.append(1.0)

    if row.client_spend is not None:
        # log scale so a $500k agency client doesn't just max out linearly:
        # $0 -> 0, ~$1k -> 50, ~$10k -> 80, $100k+ -> ~100
        spend_score = _clamp(math.log10(max(row.client_spend, 0.0) + 1.0) / 5.0 * 100.0)
        parts.append(spend_score)
        weights.append(0.75)

    if not parts:
        return 50.0  # no client signal at all — stay neutral
    return sum(p * w for p, w in zip(parts, weights)) / sum(weights)


def compute_score(row: JobRow) -> float:
    competition = score_competition(row.proposal_count)
    client = score_client(row)
    headroom = score_headroom(row)

    if headroom is None:
        total = competition * 0.60 + client * 0.40
    else:
        total = competition * 0.45 + client * 0.30 + headroom * 0.25

    return round(_clamp(total), 1)


def tag_for(score: float) -> str:
    if score >= 70:
        return "HOT"
    if score >= 45:
        return "WATCH"
    return "SKIP"


# --------------------------------------------------------------------------
# Search / enrich pipeline
# --------------------------------------------------------------------------

def search_jobs(keyword: str, limit: int, org: str) -> list[JobRow]:
    payload = run(
        "find_jobs", "search",
        "-p", f"query={keyword}",
        "-p", f"limit={limit}",
        "--org", org,
    )
    jobs = payload.get("jobs") or []
    return [job_from_search(j) for j in jobs]


def get_job(job_id: str, org: str) -> dict:
    # `-p id=<big numeric string>` gets silently coerced to a number by the
    # CLI's flat-flag parser and loses precision — --json keeps it a string.
    args_json = json.dumps({"action": "get", "params": {"id": job_id}})
    return run("find_jobs", "get", "--json", args_json, "--org", org)


def triage(keywords: list[str], limit: int, enrich: int, org: str) -> list[JobRow]:
    by_id: dict[str, JobRow] = {}
    for keyword in keywords:
        try:
            for row in search_jobs(keyword, limit, org):
                if row.id and row.id not in by_id:
                    by_id[row.id] = row
        except RuntimeError as exc:
            print(f"warning: search for {keyword!r} failed: {exc}", file=sys.stderr)

    rows = list(by_id.values())
    for row in rows:
        row.score = compute_score(row)
        row.tag = tag_for(row.score)

    if enrich > 0 and rows:
        rows.sort(key=lambda r: r.score, reverse=True)
        for row in rows[:enrich]:
            try:
                payload = get_job(row.id, org)
                enrich_job(row, payload)
                row.score = compute_score(row)
                row.tag = tag_for(row.score)
            except RuntimeError as exc:
                print(f"warning: enrich {row.id} failed: {exc}", file=sys.stderr)

    rows.sort(key=lambda r: r.score, reverse=True)
    return rows


# --------------------------------------------------------------------------
# Table rendering
# --------------------------------------------------------------------------

def _truncate(text: str, width: int) -> str:
    text = " ".join(text.split())  # collapse newlines/whitespace
    return text if len(text) <= width else text[: width - 1] + "…"


def _fmt_budget(row: JobRow) -> str:
    if row.budget is None:
        return "-"
    suffix = "/hr" if (row.job_type or "").lower() == "hourly" else ""
    return f"${row.budget:,.0f}{suffix}"


def print_table(rows: list[JobRow]) -> None:
    if not rows:
        print("No jobs found.")
        return

    columns = [
        ("TAG", 5),
        ("SCORE", 5),
        ("ID", 20),
        ("TITLE", 42),
        ("BUDGET", 10),
        ("PROP", 5),
        ("COUNTRY", 15),
    ]
    header = "  ".join(name.ljust(w) for name, w in columns)
    print(header)
    print("-" * len(header))

    for row in rows:
        proposals = "-" if row.proposal_count is None else str(row.proposal_count)
        cells = [
            row.tag.ljust(columns[0][1]),
            f"{row.score:5.1f}".ljust(columns[1][1]),
            _truncate(row.id, columns[2][1]).ljust(columns[2][1]),
            _truncate(row.title, columns[3][1]).ljust(columns[3][1]),
            _fmt_budget(row).ljust(columns[4][1]),
            proposals.ljust(columns[5][1]),
            _truncate(row.country or "-", columns[6][1]).ljust(columns[6][1]),
        ]
        print("  ".join(cells))

    hot = sum(1 for r in rows if r.tag == "HOT")
    watch = sum(1 for r in rows if r.tag == "WATCH")
    skip = sum(1 for r in rows if r.tag == "SKIP")
    enriched = sum(1 for r in rows if r.enriched)
    print("-" * len(header))
    print(
        f"{len(rows)} job(s) · {hot} HOT · {watch} WATCH · {skip} SKIP "
        f"· {enriched} enriched"
    )


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="upwork_triage.py",
        description="Search Upwork jobs via the official MCP (upwork-cli) and "
                    "print a scored HOT/WATCH/SKIP triage table.",
    )
    parser.add_argument(
        "keywords", nargs="+",
        help='one or more search terms, e.g. "n8n automation" "GoHighLevel"',
    )
    parser.add_argument(
        "--limit", type=int, default=10,
        help="results to fetch per keyword (default: 10)",
    )
    parser.add_argument(
        "--enrich", type=int, default=0,
        help="fetch full job intel (find_jobs get) for the top N scored jobs, "
             "adding competitor bid stats and client spend to the score "
             "(default: 0, i.e. search-only scoring)",
    )
    parser.add_argument(
        "--org", default="talent",
        help="upwork-cli account alias/org uid (default: talent)",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    rows = triage(args.keywords, args.limit, args.enrich, args.org)
    print_table(rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
