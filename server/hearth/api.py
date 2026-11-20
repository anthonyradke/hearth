"""Read-only JSON API. Every route except /api/ping needs auth (see auth.py).

With remote hosts ([[host]] in the config), the lists (/services, /games, /overview's counts and issues) cover every
machine; each item says which host it's on. Remote units are addressed as "<host>/<unit>". /hosts gives one summary
per machine, this one first, and /hosts/{id} the full system snapshot for one."""
from __future__ import annotations
import time
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from . import __version__
from .actions import OpError
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


def host_spark(db, prefix: str) -> dict[str, list[float]]:
    keys = ("cpu", "ram", "disk", "temp", "net_rx", "net_tx", "battery", "gpu")
    return {k: spark(db, prefix + k) for k in keys}


def counts(svcs: list[dict]) -> dict[str, int]:
    out = {"total": len(svcs)}
    for s in svcs:
        out[s["health"]] = out.get(s["health"], 0) + 1
    return out


def root_disk(sysm: dict) -> dict | None:
    disks = sysm.get("disks") or []
    return next((d for d in disks if d["mount"] == "/"), disks[0] if disks else None)


def host_summary(request: Request, hid: str) -> dict:
    """One machine at a glance: reachability, its issues, the headline numbers and sparklines."""
    cfg, st, db = _cfg(request), _st(request), _db(request)
    local = hid == cfg.name
    if local:
        sysm, svcs, info = st.system or {}, st.services or [], {"reachable": True, "last_ok": (st.system or {}).get("ts"),
                                                                 "error": None, "errors": st.errors}
        name = cfg.name
    else:
        h = st.hosts.get(hid)
        if h is None:
            raise HTTPException(404, "unknown host")
        sysm, svcs, name = h.get("system") or {}, h.get("services") or [], h["name"]
        info = {k: h.get(k) for k in ("reachable", "last_ok", "error", "errors", "version")}
    mine = [i for i in st.issues if i.get("host") == hid]
    return {
        "id": hid, "name": name, "local": local, **info,
        "status": {"level": level(mine), "issues": mine},
        "host": {k: sysm.get(k) for k in ("hostname", "os", "kernel", "cores", "uptime", "boot")},
        "cpu": sysm.get("cpu"), "memory": sysm.get("memory"), "disk": root_disk(sysm), "disks": sysm.get("disks"),
        "temps": sysm.get("temps"), "battery": sysm.get("battery"), "network": sysm.get("network"),
        "gpus": sysm.get("gpus"), "smart": sysm.get("smart"),
        "spark": host_spark(db, "" if local else f"{hid}/"),
        "services": counts(svcs),
        "ts": sysm.get("ts"),
    }


def host_ids(request: Request) -> list[str]:
    return [_cfg(request).name] + [h.id for h in _cfg(request).hosts]


def level(issues: list[dict]) -> str:
    if any(i["severity"] == "critical" for i in issues):
        return "critical"
    return "warning" if issues else "ok"


@router.get("/ping")
def ping():
    return {"ok": True, "app": "hearth", "version": __version__}


@router.get("/overview")
def overview(request: Request, who: Who):
    st, db, sampler = _st(request), _db(request), request.app.state.sampler
    sysm = st.system or {}
    return {
        "host": {k: sysm.get(k) for k in ("hostname", "os", "kernel", "cores", "uptime", "boot")},
        "status": {"level": level(st.issues), "issues": st.issues},
        "cpu": sysm.get("cpu"),
        "memory": sysm.get("memory"),
        "disk": root_disk(sysm),
        "temps": sysm.get("temps"),
        "battery": sysm.get("battery"),
        "network": sysm.get("network"),
        "spark": {k: spark(db, k) for k in ("cpu", "ram", "disk", "temp", "net_rx", "net_tx", "battery")},
        "services": counts(sampler.all_services()),
        "games": [{k: g.get(k) for k in ("id", "name", "kind", "running", "health", "since", "version",
                                         "max_players", "host")} | {"players": len(g["players"])}
                  for g in sampler.all_games()],
        "backups": {**backup_summary(st.backups or {}),
                    "hosts": [{"id": hid, **s} for hid in host_ids(request)
                              if (s := backup_summary(host_backups(request, hid))) is not None]},
        "dns": {k: (st.pihole or {}).get(k) for k in ("dns", "percent_blocked", "queries", "configured")},
        "hosts": [host_summary(request, hid) for hid in host_ids(request)],
        "errors": st.errors,
        "ts": sysm.get("ts") or int(time.time()),
    }


@router.get("/hosts")
def hosts(request: Request, who: Who):
    return {"hosts": [host_summary(request, hid) for hid in host_ids(request)]}


def _host_system(request: Request, hid: str) -> dict:
    cfg, st = _cfg(request), _st(request)
    if hid == cfg.name:
        return {**(st.system or {}), "traffic": st.traffic}
    if hid not in st.hosts:
        raise HTTPException(404, "unknown host")
    return {**(st.hosts[hid].get("system") or {}), "traffic": None}


@router.get("/hosts/{hid}")
def host(hid: str, request: Request, who: Who):
    return {**host_summary(request, hid), "system": _host_system(request, hid)}


@router.get("/system")
def system(request: Request, who: Who, host: str | None = None):
    return _host_system(request, host or _cfg(request).name)


@router.get("/issues")
def issues(request: Request, who: Who):
    st = _st(request)
    return {"level": level(st.issues), "issues": st.issues}


@router.get("/services")
def services(request: Request, who: Who):
    cfg, sampler = _cfg(request), request.app.state.sampler
    svcs = sampler.all_services()
    groups = list(dict.fromkeys([s.group for s in cfg.services] + [s["group"] for s in svcs]))
    return {"groups": groups, "services": svcs,
            "hosts": [{"id": cfg.name, "name": cfg.name, "local": True}]
            + [{"id": h.id, "name": h.name, "local": False, "reachable": (_st(request).hosts.get(h.id) or {}).get("reachable")}
               for h in cfg.hosts]}


@router.get("/services/{unit:path}")
def service(unit: str, request: Request, who: Who, lines: int = Query(100, ge=1, le=1000)):
    sampler = request.app.state.sampler
    s = next((s for s in sampler.all_services() if s["unit"] == unit), None)
    if not s:
        raise HTTPException(404, "unknown service")
    events = _db(request).q("SELECT * FROM events WHERE kind='service' AND subject=? ORDER BY id DESC LIMIT 30",
                            (unit,))
    extra = {}
    if s.get("host") in sampler.remotes:
        try:
            extra["journal"] = sampler.remotes[s["host"]].journal(s["systemd_unit"], lines)
        except OpError as e:
            extra = {"journal": [], "journal_error": e.detail}
    else:
        extra["journal"] = journal(unit, lines)
    return {**s, **extra, "events": [dict(e) for e in events]}


@router.get("/games")
def games(request: Request, who: Who):
    st = _st(request)
    return {"games": [with_address(g, st) for g in request.app.state.sampler.all_games()]}


@router.get("/games/{gid}")
def game(gid: str, request: Request, who: Who):
    g = next((g for g in request.app.state.sampler.all_games() if g["id"] == gid), None)
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


def host_backups(request: Request, hid: str) -> dict | None:
    """cellar's status on one machine: None if that machine doesn't run cellar (or its agent hasn't said yet)."""
    cfg, st = _cfg(request), _st(request)
    if hid == cfg.name:
        return st.backups or {"available": False}
    if hid not in st.hosts:
        raise HTTPException(404, "unknown host")
    return st.hosts[hid].get("backups")


def backup_summary(b: dict | None) -> dict | None:
    if b is None:
        return None
    loc = b.get("local") or {}
    return {"available": b.get("available"), "last_success": b.get("last_success"),
            "result": (b.get("backup") or {}).get("result"), "age_hours": b.get("age_hours"),
            "next": ((b.get("timers") or {}).get("backup") or {}).get("next"),
            "local": {"last_success": loc.get("last_success"),
                      "result": (loc.get("backup") or {}).get("result")} if loc else None}


@router.get("/backups")
def backups(request: Request, who: Who, host: str | None = None):
    """This machine's status at the top level (what the app read before there were hosts), plus every machine that
    runs cellar under "hosts". With ?host=, that one machine."""
    cfg, st = _cfg(request), _st(request)
    if host:
        b = host_backups(request, host)
        if b is None:
            raise HTTPException(404, "no backups on that host")
        return {**b, "host": host}
    hosts = []
    for hid in host_ids(request):
        b = host_backups(request, hid)
        if b is not None:
            remote = st.hosts.get(hid) or {}
            hosts.append({"id": hid, "name": remote.get("name", hid), "local": hid == cfg.name,
                          "reachable": True if hid == cfg.name else remote.get("reachable"), "backups": b})
    return {**host_backups(request, cfg.name), "host": cfg.name, "hosts": hosts}


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


@router.get("/alerts")
def alerts(request: Request, who: Who, limit: int = Query(100, ge=1, le=500)):
    a = request.app.state.alerts
    c = _cfg(request).alerts
    return {"alerts": a.history(limit), "ntfy": {"url": c.ntfy_url, "topic": c.ntfy_topic} if c.ntfy_topic else None,
            "heartbeat": _st(request).heartbeat,
            "quiet_hours": c.quiet_hours or None}


@router.post("/alerts/test")
def alerts_test(request: Request, who: Who):
    a = request.app.state.alerts
    if not a.ntfy.configured:
        raise HTTPException(409, "ntfy isn't set up yet: add a topic under [alerts] in the config")
    ok = a.test()
    _db(request).audit(who, "test-notification", "ntfy", "ok" if ok else "failed")
    if not ok:
        raise HTTPException(502, "ntfy didn't accept the message")
    return {"ok": True}
