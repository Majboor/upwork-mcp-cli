"""
upwork_mcp — a simple Python wrapper for the Upwork MCP server.

Beginner-friendly, zero dependencies. It drives the `upwork` CLI (which handles
OAuth to the official Upwork MCP for you) and returns plain Python dicts/lists.

Quick start:
    pip install upwork-mcp-cli        # (or clone the repo)
    upwork login                      # one-time browser auth (from the Node CLI)

    from upwork_mcp import Upwork
    up = Upwork()
    for job in up.search("n8n automation", limit=5):
        print(job["title"], job["proposal_count"])

    job = up.get_job(up.search("shopify")[0]["id"])
    print(job["bid_stats"], job["client_record"])

If the `upwork` command isn't on your PATH, point at the CLI entry file:
    up = Upwork(cli="/path/to/upwork-mcp-cli/bin/upwork.js")
    #   ...or set the UPWORK_CLI env var to that path.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from typing import Any, Dict, List, Optional

__all__ = ["Upwork", "UpworkError"]
__version__ = "0.1.0"


class UpworkError(RuntimeError):
    """Raised when the underlying CLI call fails."""


def _num(v: Any) -> Optional[float]:
    try:
        if v is None or v == "":
            return None
        f = float(v)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return None


def _clean(s: Any) -> Any:
    if isinstance(s, str):
        return s.replace("<untrusted_participant_content>", "").replace("</untrusted_participant_content>", "").strip()
    return s


class Upwork:
    """Thin client over the Upwork MCP (via the `upwork` CLI).

    Args:
        org: default account alias ("talent", "client", or "agency").
        cli: path to the CLI. Defaults to `upwork` on PATH, else $UPWORK_CLI.
        timeout: per-call timeout in seconds.
    """

    def __init__(self, org: str = "talent", cli: Optional[str] = None, timeout: int = 90):
        self.org = org
        self.timeout = timeout
        self._cmd = self._resolve_cli(cli)

    # ---- low level ---------------------------------------------------------
    @staticmethod
    def _resolve_cli(cli: Optional[str]) -> List[str]:
        cli = cli or os.environ.get("UPWORK_CLI")
        if cli:
            return ["node", cli] if cli.endswith(".js") else [cli]
        found = shutil.which("upwork")
        if found:
            return [found]
        raise UpworkError(
            "Could not find the `upwork` CLI. Install it "
            "(npm i -g upwork-mcp-cli) and run `upwork login`, or pass "
            "cli='/path/to/bin/upwork.js' (or set the UPWORK_CLI env var)."
        )

    def raw(self, *args: str) -> Dict[str, Any]:
        """Run any CLI command with --raw and return the unwrapped MCP payload."""
        cmd = [*self._cmd, *args, "--raw"]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=self.timeout)
        except FileNotFoundError as e:
            raise UpworkError(f"CLI not runnable: {e}") from e
        except subprocess.TimeoutExpired as e:
            raise UpworkError(f"CLI timed out after {self.timeout}s") from e
        if proc.returncode != 0:
            raise UpworkError((proc.stderr or proc.stdout or "CLI error").strip().splitlines()[0])
        try:
            env = json.loads(proc.stdout)
        except json.JSONDecodeError:
            return {"_text": proc.stdout.strip()}
        text = (env.get("content") or [{}])[0].get("text") if isinstance(env, dict) else None
        if isinstance(text, str):
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return {"_text": text}
        return env

    def call(self, tool: str, action: str, org: Optional[str] = None, **params: Any) -> Dict[str, Any]:
        """Generic escape hatch: call any tool/action with -p params.

        Example: up.call("find_jobs", "search", query="react", limit=5)
        """
        args = [tool, action, "--org", org or self.org]
        for k, v in params.items():
            args += ["-p", f"{k}={v}"]
        return self.raw(*args)

    # ---- jobs --------------------------------------------------------------
    def search(self, query: str, limit: int = 10, job_type: Optional[str] = None,
               experience: Optional[str] = None, org: Optional[str] = None) -> List[Dict[str, Any]]:
        """Search marketplace jobs. Returns a list of normalized job dicts."""
        args = ["find_jobs", "search", "-p", f"query={query}", "-p", f"limit={min(limit, 10)}",
                "--org", org or self.org]
        if job_type:
            args += ["-p", f"job_type={job_type}"]
        if experience:
            args += ["-p", f"experience_level={experience}"]
        r = self.raw(*args)
        return [self._norm_job(j) for j in (r.get("jobs") or [])]

    def get_job(self, job_id: Any, org: Optional[str] = None) -> Dict[str, Any]:
        """Deep intel for one job: competitor bids, client history, connects cost."""
        payload = json.dumps({"action": "get", "params": {"id": str(job_id)}})
        r = self.raw("find_jobs", "get", "--json", payload, "--org", org or self.org)
        mp = (r.get("data") or {}).get("marketplaceJobPosting") or {}
        act = mp.get("activityStat") or {}
        bid = act.get("applicationsBidStats") or {}

        def dv(x):
            return (x.get("displayValue", x.get("rawValue")) if isinstance(x, dict) else x)

        return {
            "id": str(job_id),
            "title": _clean((mp.get("content") or {}).get("title")),
            "description": _clean((mp.get("content") or {}).get("description")),
            "connects_cost": _num(r.get("connects_cost")),
            "bid_stats": {"avg": _num(dv(bid.get("avgRateBid"))), "min": _num(dv(bid.get("minRateBid"))),
                          "max": _num(dv(bid.get("maxRateBid")))},
            "job_activity": act.get("jobActivity"),
            "client_record": r.get("client_record"),
            "work_history": r.get("client_work_history"),
            "screening": r.get("screening_questions"),
        }

    # ---- account & pipeline ------------------------------------------------
    def dashboard(self, org: Optional[str] = None) -> Dict[str, Any]:
        """Connects balance, matching jobs, invitations, offers, messages."""
        r = self.raw("get_freelancer_dashboard", "check", "--org", org or self.org)
        d = r.get("data") or r
        c = (d.get("connects") or {}).get("balance") or {}
        return {
            "connects": {"total": _num(c.get("connectsBalance")), "free": _num(c.get("connectsBalanceFree")),
                         "paid": _num(c.get("connectsBalancePaid"))},
            "matching_jobs": _num((d.get("matching_jobs") or {}).get("count")),
            "active_contracts": _num((d.get("active_contracts") or {}).get("total_count")),
            "invitations": _num((d.get("invitations") or {}).get("count")),
            "offers": _num((d.get("offers") or {}).get("count")),
            "messages": _num((d.get("messages") or {}).get("count")),
        }

    def profile(self, org: Optional[str] = None) -> Dict[str, Any]:
        r = self.raw("get_profile", "get", "--org", org or self.org)
        p = r.get("data") or r
        pd = p.get("personalData") or {}
        pa = p.get("profileAggregates") or {}
        return {
            "name": f"{pd.get('firstName', '')} {pd.get('lastName', '')}".strip(),
            "title": _clean(pd.get("title")),
            "rate": _num((pd.get("chargeRate") or {}).get("rawValue")),
            "earnings": _num(pa.get("totalEarnings")),
            "jobs": _num(pa.get("totalJobs")),
        }

    def proposals(self, org: Optional[str] = None) -> List[Dict[str, Any]]:
        """Your submitted proposals, each with an `age_days` field."""
        r = self.raw("list_freelancer_proposals", "list", "--org", org or self.org)
        edges = ((r.get("data") or {}).get("vendorProposals") or {}).get("edges") or []
        now = time.time() * 1000
        out = []
        for e in edges:
            n = e.get("node") or {}
            created = _num(((n.get("auditDetails") or {}).get("createdDateTime") or {}).get("rawValue"))
            out.append({
                "id": n.get("id"),
                "job_id": (n.get("marketplaceJobPosting") or {}).get("id"),
                "title": _clean(((n.get("marketplaceJobPosting") or {}).get("content") or {}).get("title")),
                "status": (n.get("status") or {}).get("status"),
                "status_label": (n.get("status") or {}).get("status_label"),
                "bid": _num(((n.get("terms") or {}).get("chargeRate") or {}).get("rawValue")),
                "age_days": int((now - created) / 86400000) if created else None,
            })
        return out

    def messages(self, unread: bool = False, org: Optional[str] = None) -> List[Dict[str, Any]]:
        """Message rooms (most recent first). Set unread=True for unread only."""
        r = self.raw("get_messages", "list_rooms", "--org", org or self.org)
        rooms = (r.get("data") or {}).get("rooms") or []
        out = []
        for rm in rooms:
            last = _clean((rm.get("latestStory") or {}).get("message")) or ""
            from_me = last.lower().startswith("you:")
            out.append({
                "id": rm.get("id"),
                "name": _clean(rm.get("roomName")),
                "unread": _num(rm.get("numUnread")) or 0,
                "from_me": from_me,
                "last_message": last[4:].strip() if from_me else last,
                "room_type": rm.get("roomType"),
            })
        return [x for x in out if x["unread"]] if unread else out

    def rate_insights(self, level: str = "expert", text: str = "automation",
                      org: str = "client") -> Dict[str, Any]:
        """The going hourly rate range for similar work."""
        return self.raw("get_rate_insights", "get", "-p", f"experience_level={level}",
                        "-p", f"project_text={text}", "--org", org)

    # ---- convenience -------------------------------------------------------
    def triage(self, query: str, limit: int = 10, enrich: int = 0) -> List[Dict[str, Any]]:
        """Search + score jobs 0-100 (HOT/WATCH/SKIP). Optionally enrich the top N
        with deep intel (competitor bids / client spend) for a sharper score."""
        jobs = self.search(query, limit=limit)
        for i, j in enumerate(jobs):
            spend = None
            if i < enrich:
                try:
                    deep = self.get_job(j["id"])
                    j["bid_stats"] = deep["bid_stats"]
                    spend = _num((deep.get("client_record") or {}).get("spend_total"))
                except UpworkError:
                    pass
            prop = j.get("proposal_count") or 0
            score = round(100 * (0.5 * (1 - min(1, prop / 50)) +
                                 0.3 * (min(1, (spend or 0) / 5000) if spend else 0.2) +
                                 0.2))
            j["alpha_score"] = score
            j["tag"] = "HOT" if score >= 60 else "WATCH" if score >= 45 else "SKIP"
        return sorted(jobs, key=lambda x: x["alpha_score"], reverse=True)

    # ---- helpers -----------------------------------------------------------
    @staticmethod
    def _norm_job(j: Dict[str, Any]) -> Dict[str, Any]:
        client = j.get("client") or {}
        return {
            "id": str(j.get("id")),
            "title": _clean(j.get("title")),
            "snippet": _clean(j.get("description_snippet")),
            "job_type": j.get("job_type"),
            "experience_level": j.get("experience_level"),
            "budget": j.get("budget"),
            "proposal_count": _num(j.get("proposal_count")),
            "skills": j.get("skills") or [],
            "published_date": j.get("published_date") or j.get("created_date"),
            "client": {"country": client.get("country"),
                       "verified": client.get("verification_status") == "VERIFIED",
                       "total_hires": _num(client.get("total_hires")),
                       "rating": _num(client.get("rating"))},
        }
