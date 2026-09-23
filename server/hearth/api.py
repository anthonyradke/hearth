"""Read-only JSON API. Every route except /api/ping needs auth (see auth.py)."""
from __future__ import annotations
import time
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from . import __version__
from .auth import check
from .collectors.services import journal
from .db import RANGES

Who = Annotated[str, Depends(check)]
router = APIRouter(prefix="/api")


def _st(request: Request):
    return request.app.state.sampler.state


def _db(request: Request):
    return request.app.state.db


def _cfg(request: Request):
    return request.app.state.cfg


def spark(db, key: str, rng: str = "1h") -> list[float]:
    return [p[1] for p in db.history(key, rng)]


def with_address(g: dict, st) -> dict:
    """Fills {public_ip} in a game's address from the last public IP lookup."""
    ip = (st.public_ip or {}).get("ip")
    addr = g.get("address") or ""
    if "{public_ip}" in addr:
        addr = addr.replace("{public_ip}", ip) if ip else ""
    return {**g, "address": addr or None}


def level(issues: list[dict]) -> str:
    if any(i["severity"] == "critical" for i in issues):
        return "critical"
    return "warning" if issues else "ok"


@router.get("/ping")
def ping():
    return {"ok": True, "app": "hearth", "version": __version__}


@router.get("/overview")
def overview(request: Request, who: Who):
    st, db = _st(request), _db(request)
    sysm = st.system or {}
    svcs = st.services or []
    counts = {"total": len(svcs)}
    for s in svcs:
        counts[s["health"]] = counts.get(s["health"], 0) + 1
    b = st.backups or {}
    root = next((d for d in sysm.get("disks", []) if d["mount"] == "/"), (sysm.get("disks") or [None])[0])
    return {
        "host": {k: sysm.get(k) for k in ("hostname", "os", "kernel", "cores", "uptime", "boot")},
        "status": {"level": level(st.issues), "issues": st.issues},
        "cpu": sysm.get("cpu"),
        "memory": sysm.get("memory"),
        "disk": root,
        "temps": sysm.get("temps"),
        "battery": sysm.get("battery"),
        "network": sysm.get("network"),
        "spark": {k: spark(db, k) for k in ("cpu", "ram", "disk", "temp", "net_rx", "net_tx", "battery")},
        "services": counts,
        "games": [{k: g.get(k) for k in ("id", "name", "kind", "running", "health", "since", "version",
                                         "max_players")} | {"players": len(g["players"])} for g in st.games or []],
        "backups": {"available": b.get("available"), "last_success": b.get("last_success"),
                    "result": (b.get("backup") or {}).get("result"), "age_hours": b.get("age_hours"),
                    "next": ((b.get("timers") or {}).get("backup") or {}).get("next")},
        "dns": {k: (st.pihole or {}).get(k) for k in ("dns", "percent_blocked", "queries", "configured")},
        "errors": st.errors,
        "ts": sysm.get("ts") or int(time.time()),
    }


@router.get("/system")
def system(request: Request, who: Who):
    st = _st(request)
    return {**(st.system or {}), "traffic": st.traffic}


@router.get("/issues")
def issues(request: Request, who: Who):
    st = _st(request)
    return {"level": level(st.issues), "issues": st.issues}


@router.get("/services")
def services(request: Request, who: Who):
    cfg = _cfg(request)
    groups = list(dict.fromkeys(s.group for s in cfg.services))
    return {"groups": groups, "services": _st(request).services or []}


@router.get("/services/{unit}")
def service(unit: str, request: Request, who: Who, lines: int = Query(100, ge=1, le=1000)):
    s = next((s for s in _st(request).services or [] if s["unit"] == unit), None)
    if not s:
        raise HTTPException(404, "unknown service")
    events = _db(request).q("SELECT * FROM events WHERE kind='service' AND subject=? ORDER BY id DESC LIMIT 30",
                            (unit,))
    return {**s, "journal": journal(unit, lines), "events": [dict(e) for e in events]}


@router.get("/games")
def games(request: Request, who: Who):
    st = _st(request)
    return {"games": [with_address(g, st) for g in st.games or []]}


@router.get("/games/{gid}")
def game(gid: str, request: Request, who: Who):
    g = next((g for g in _st(request).games or [] if g["id"] == gid), None)
    if not g:
        raise HTTPException(404, "unknown game")
    db = _db(request)
    events = [dict(e) for e in db.q("SELECT * FROM events WHERE kind IN ('join','leave') AND subject=? "
                                    "ORDER BY id DESC LIMIT 50", (gid,))]
    return {**with_address(g, _st(request)), "events": events}


@router.get("/network")
def network(request: Request, who: Who):
    st = _st(request)
    return {"tailscale": st.tailscale, "pihole": st.pihole, "public_ip": st.public_ip, "traffic": st.traffic,
            "interface": ((st.system or {}).get("network"))}


@router.get("/backups")
def backups(request: Request, who: Who):
    return _st(request).backups or {"available": False}


@router.get("/history")
def history(request: Request, who: Who, key: str, range: str = "24h"):
    if range not in RANGES:
        raise HTTPException(400, f"range must be one of {list(RANGES)}")
    return {"key": key, "range": range, "points": _db(request).history(key, range)}


@router.get("/history/keys")
def history_keys(request: Request, who: Who):
    return {"keys": sorted(_db(request).keys())}


@router.get("/events")
def events(request: Request, who: Who, limit: int = Query(100, ge=1, le=500), before: int | None = None,
           kind: str | None = None):
    return {"events": _db(request).events(limit, before, kind)}


@router.get("/audit")
def audit(request: Request, who: Who, limit: int = Query(100, ge=1, le=500), before: int | None = None):
    return {"audit": _db(request).audits(limit, before)}
