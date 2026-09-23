"""cellar's status.json (schema 1) plus when its timers fire next."""
from __future__ import annotations
import json, subprocess, time
from datetime import datetime
from .services import parse_show, _ts

TIMERS = ["cellar-backup.timer", "cellar-check.timer", "cellar-drill.timer"]


def _t(v: str | None) -> int | None:
    if not v:
        return None
    try:
        return int(datetime.fromisoformat(v).timestamp())
    except ValueError:
        return None


def parse_status(d: dict) -> dict:
    """Keeps the shape of status.json but turns timestamps into epoch seconds, which is what the app uses."""
    def job(j: dict | None) -> dict | None:
        if not j:
            return None
        j = dict(j)
        for k in ("started", "finished", "measured"):
            if k in j:
                j[k] = _t(j[k])
        return j

    return {
        "schema": d.get("schema"),
        "updated": _t(d.get("updated")),
        "last_success": _t(d.get("last_success")),
        "backup": job(d.get("backup")),
        "check": job(d.get("check")),
        "drill": job(d.get("drill")),
        "repo": job(d.get("repo")),
        "sources": sorted(d.get("sources") or [], key=lambda s: -(s.get("bytes") or 0)),
    }


def collect(path: str) -> dict:
    try:
        with open(path) as f:
            out = parse_status(json.load(f))
        out["available"] = True
    except (OSError, ValueError) as e:
        out = {"available": False, "error": str(e)}
    try:
        r = subprocess.run(["systemctl", "show", *TIMERS, "--timestamp=unix", "-p",
                            "Id,ActiveState,NextElapseUSecRealtime,LastTriggerUSec"],
                           capture_output=True, text=True, timeout=5)
        out["timers"] = {b["Id"].split("-")[1].split(".")[0]: {
            "active": b.get("ActiveState") == "active", "next": _ts(b.get("NextElapseUSecRealtime")),
            "last": _ts(b.get("LastTriggerUSec"))} for b in parse_show(r.stdout) if b.get("Id")}
    except (OSError, subprocess.TimeoutExpired):
        out["timers"] = {}
    ls = out.get("last_success")
    out["age_hours"] = round((time.time() - ls) / 3600, 1) if ls else None
    return out
