"""Things the app can change: start/stop/restart units (through the polkit rule install.sh generates), Minecraft
console commands over RCON, and Valheim's admin/permitted/banned lists. Every attempt goes into the audit log, whether
it worked or not.

The operations themselves (the functions above the routes) are shared with the agent (agent.py), which runs them on
its own machine. A target that lives on another machine ("h5/mheynautics.service", or a game reported by h5) is sent to
that machine's agent; the agent checks its own config again, so the server can't make it do more than it allows."""
from __future__ import annotations
import logging, os, re, subprocess
from typing import Annotated
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from .auth import check
from .rcon import RconError, pool

log = logging.getLogger("hearth.actions")
Who = Annotated[str, Depends(check)]
router = APIRouter(prefix="/api")

VERBS = {"restart": ("restart",), "full": ("start", "stop", "restart")}
LISTS = {"admin": "adminlist.txt", "permitted": "permittedlist.txt", "banned": "bannedlist.txt"}
STEAMID = re.compile(r"^7656\d{13}$")
LIST_NOTE = "Valheim reads these when it starts. Changes may need a restart to take effect."


class OpError(Exception):
    """An operation refused or failed; status is the HTTP status to answer with."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


# ---------- operations (shared with the agent) ----------
def systemctl(verb: str, unit: str, timeout: int = 150) -> tuple[bool, str]:
    try:
        r = subprocess.run(["systemctl", verb, unit, "--no-ask-password"], capture_output=True, text=True,
                           timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, f"still going after {timeout} s"
    return r.returncode == 0, (r.stderr or r.stdout).strip()


def unit_verb(cfg, unit: str, verb: str) -> None:
    svc = cfg.service(unit)
    if not svc:
        raise OpError(404, "unknown service")
    if verb not in VERBS.get(svc.actions, ()):
        raise OpError(403, f"{svc.name} doesn't allow {verb} from the app")
    ok, detail = systemctl(verb, unit)
    if not ok:
        raise OpError(502, detail or f"systemctl {verb} failed")


def game_cfg(cfg, gid: str, kind: str):
    g = cfg.game(gid)
    if not g:
        raise OpError(404, "unknown game")
    if g.kind != kind:
        raise OpError(400, f"only for {kind} servers")
    return g


def rcon_command(cfg, gid: str, command: str) -> str:
    g = game_cfg(cfg, gid, "minecraft")
    if not g.rcon_port or not g.rcon_password:
        raise OpError(409, "RCON isn't configured for this server")
    try:
        return pool.command(g.rcon_port, g.rcon_password, command)
    except (OSError, RconError) as e:
        raise OpError(502, f"The server didn't answer: {e}")


def read_list(path: str) -> list[str]:
    try:
        with open(path) as f:
            return [ln.strip() for ln in f if ln.strip() and not ln.strip().startswith("//")]
    except FileNotFoundError:
        return []


def write_list(path: str, ids: list[str]) -> None:
    """Rewrites in place (not replace-by-rename): hearth only has an ACL on the file, not on its folder. Comment lines
    Valheim puts at the top are kept."""
    try:
        with open(path) as f:
            head = [ln.rstrip("\n") for ln in f if ln.strip().startswith("//")]
    except FileNotFoundError:
        head = []
    with open(path, "r+" if os.path.exists(path) else "w") as f:
        f.seek(0)
        f.write("\n".join(head + ids) + "\n")
        f.truncate()


def list_ids(cfg, gid: str) -> dict[str, list[str]]:
    g = game_cfg(cfg, gid, "valheim")
    return {key: read_list(os.path.join(g.lists_dir, fname)) for key, fname in LISTS.items()}


def list_change(cfg, gid: str, name: str, sid: str, add: bool) -> None:
    g = game_cfg(cfg, gid, "valheim")
    if name not in LISTS:
        raise OpError(404, "unknown list")
    if add and not STEAMID.match(sid):
        raise OpError(400, "That isn't a SteamID64 (17 digits starting with 7656)")
    path = os.path.join(g.lists_dir, LISTS[name])
    ids = read_list(path)
    new = ids + [sid] if add and sid not in ids else [i for i in ids if i != sid] if not add and sid in ids else None
    if new is not None:
        try:
            write_list(path, new)
        except OSError as e:
            raise OpError(502, f"Couldn't write the list: {e.strerror}")


def lists_view(ids: dict[str, list[str]], names: dict[str, str]) -> dict:
    return {"lists": {k: [{"id": i, "name": names.get(i)} for i in v] for k, v in ids.items()},
            "known": [{"id": i, "name": n} for i, n in names.items()], "note": LIST_NOTE}


# ---------- routes ----------
def _remote(request: Request, host_id: str):
    return request.app.state.sampler.remotes[host_id]


def _game_host(request: Request, gid: str) -> str | None:
    """The remote host a game id belongs to, or None for this machine's own games."""
    if request.app.state.cfg.game(gid):
        return None
    for hid, r in request.app.state.sampler.remotes.items():
        if any(g["id"] == gid for g in r.state.get("games") or []):
            return hid
    raise HTTPException(404, "unknown game")


def _run(request: Request, who: str, action: str, target: str, detail: str, fn):
    """Runs fn, audits the outcome, and turns an OpError into the HTTP answer."""
    db = request.app.state.db
    try:
        out = fn()
    except OpError as e:
        db.audit(who, action, target, "failed", (detail + " " + e.detail).strip()[:300])
        raise HTTPException(e.status, e.detail)
    db.audit(who, action, target, "ok", detail[:200])
    return out


@router.post("/services/{unit:path}/{verb}")
def unit_action(unit: str, verb: str, request: Request, who: Who):
    sampler = request.app.state.sampler
    host, _, remote_unit = unit.partition("/")
    if remote_unit and host in sampler.remotes:
        _run(request, who, verb, unit, "", lambda: _remote(request, host).unit_verb(remote_unit, verb))
        refresh = lambda: sampler.refresh_remote(host)
    else:
        _run(request, who, verb, unit, "", lambda: unit_verb(request.app.state.cfg, unit, verb))
        refresh = sampler.refresh_services
    try:  # refresh now so the app sees the new state instead of the one from before
        refresh()
    except Exception:
        log.exception("refresh after %s %s failed", verb, unit)
    s = next((s for s in sampler.all_services() if s["unit"] == unit), None)
    return {"ok": True, "service": s}


@router.post("/games/{gid}/rcon")
def rcon(gid: str, request: Request, who: Who, command: str = Body(..., embed=True, min_length=1, max_length=500)):
    command = command.strip().lstrip("/")
    host = _game_host(request, gid)
    if host:
        out = _run(request, who, "rcon", gid, command, lambda: _remote(request, host).rcon(gid, command))
    else:
        out = _run(request, who, "rcon", gid, command, lambda: rcon_command(request.app.state.cfg, gid, command))
    return {"command": command, "output": out}


def _lists(request: Request, gid: str, host: str | None) -> dict:
    names = request.app.state.db.get(f"valheim_names:{gid}", {})
    try:
        if host:  # the agent follows that Valheim's log, so it knows the newer names
            r = _remote(request, host).lists(gid)
            ids, names = r["lists"], {**names, **(r.get("names") or {})}
        else:
            ids = list_ids(request.app.state.cfg, gid)
    except OpError as e:
        raise HTTPException(e.status, e.detail)
    return lists_view(ids, names)


@router.get("/games/{gid}/lists")
def lists(gid: str, request: Request, who: Who):
    return _lists(request, gid, _game_host(request, gid))


def _list_change(request: Request, who: str, gid: str, name: str, sid: str, add: bool) -> dict:
    host = _game_host(request, gid)
    sid = sid.strip()
    action = "list-add" if add else "list-remove"
    if host:
        fn = lambda: _remote(request, host).list_change(gid, name, sid, add)
    else:
        fn = lambda: list_change(request.app.state.cfg, gid, name, sid, add)
    _run(request, who, action, gid, f"{name} {sid}", fn)
    return _lists(request, gid, host)


@router.post("/games/{gid}/lists/{name}")
def list_add(gid: str, name: str, request: Request, who: Who, id: str = Body(..., embed=True)):
    return _list_change(request, who, gid, name, id, True)


@router.delete("/games/{gid}/lists/{name}/{sid}")
def list_remove(gid: str, name: str, sid: str, request: Request, who: Who):
    return _list_change(request, who, gid, name, sid, False)
