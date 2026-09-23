"""Things the app can change: start/stop/restart units (through the polkit rule install.sh generates), Minecraft
console commands over RCON, and Valheim's admin/permitted/banned lists. Every attempt goes into the audit log, whether
it worked or not."""
from __future__ import annotations
import os, re, subprocess
from typing import Annotated
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from .auth import check
from .rcon import RconError, pool

Who = Annotated[str, Depends(check)]
router = APIRouter(prefix="/api")

VERBS = {"restart": ("restart",), "full": ("start", "stop", "restart")}
LISTS = {"admin": "adminlist.txt", "permitted": "permittedlist.txt", "banned": "bannedlist.txt"}
STEAMID = re.compile(r"^7656\d{13}$")


def systemctl(verb: str, unit: str, timeout: int = 150) -> tuple[bool, str]:
    try:
        r = subprocess.run(["systemctl", verb, unit, "--no-ask-password"], capture_output=True, text=True,
                           timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, f"still going after {timeout} s"
    return r.returncode == 0, (r.stderr or r.stdout).strip()


@router.post("/services/{unit}/{verb}")
def unit_action(unit: str, verb: str, request: Request, who: Who):
    cfg, db, sampler = request.app.state.cfg, request.app.state.db, request.app.state.sampler
    svc = cfg.service(unit)
    if not svc:
        raise HTTPException(404, "unknown service")
    if verb not in VERBS.get(svc.actions, ()):
        raise HTTPException(403, f"{svc.name} doesn't allow {verb} from the app")
    ok, detail = systemctl(verb, unit)
    db.audit(who, verb, unit, "ok" if ok else "failed", "" if ok else detail[:300])
    try:  # refresh now so the app sees the new state instead of the one from before
        sampler.refresh_services()
    except Exception:
        pass
    if not ok:
        raise HTTPException(502, detail or f"systemctl {verb} failed")
    s = next((s for s in sampler.state.services or [] if s["unit"] == unit), None)
    return {"ok": True, "service": s}


def _game(request: Request, gid: str, kind: str):
    g = request.app.state.cfg.game(gid)
    if not g:
        raise HTTPException(404, "unknown game")
    if g.kind != kind:
        raise HTTPException(400, f"only for {kind} servers")
    return g


@router.post("/games/{gid}/rcon")
def rcon(gid: str, request: Request, who: Who, command: str = Body(..., embed=True, min_length=1, max_length=500)):
    g = _game(request, gid, "minecraft")
    command = command.strip().lstrip("/")
    if not g.rcon_port or not g.rcon_password:
        raise HTTPException(409, "RCON isn't configured for this server")
    try:
        out = pool.command(g.rcon_port, g.rcon_password, command)
    except (OSError, RconError) as e:
        request.app.state.db.audit(who, "rcon", gid, "failed", command[:200])
        raise HTTPException(502, f"The server didn't answer: {e}")
    request.app.state.db.audit(who, "rcon", gid, "ok", command[:200])
    return {"command": command, "output": out}


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


@router.get("/games/{gid}/lists")
def lists(gid: str, request: Request, who: Who):
    g = _game(request, gid, "valheim")
    names = request.app.state.db.get(f"valheim_names:{gid}", {})
    out = {}
    for key, fname in LISTS.items():
        ids = read_list(os.path.join(g.lists_dir, fname))
        out[key] = [{"id": i, "name": names.get(i)} for i in ids]
    known = [{"id": i, "name": n} for i, n in names.items()]
    return {"lists": out, "known": known,
            "note": "Valheim reads these when it starts. Changes may need a restart to take effect."}


@router.post("/games/{gid}/lists/{name}")
def list_add(gid: str, name: str, request: Request, who: Who, id: str = Body(..., embed=True)):
    g = _game(request, gid, "valheim")
    if name not in LISTS:
        raise HTTPException(404, "unknown list")
    sid = id.strip()
    if not STEAMID.match(sid):
        raise HTTPException(400, "That isn't a SteamID64 (17 digits starting with 7656)")
    path = os.path.join(g.lists_dir, LISTS[name])
    ids = read_list(path)
    if sid not in ids:
        try:
            write_list(path, ids + [sid])
        except OSError as e:
            request.app.state.db.audit(who, "list-add", gid, "failed", f"{name} {sid}")
            raise HTTPException(502, f"Couldn't write the list: {e.strerror}")
    request.app.state.db.audit(who, "list-add", gid, "ok", f"{name} {sid}")
    return lists(gid, request, who)


@router.delete("/games/{gid}/lists/{name}/{sid}")
def list_remove(gid: str, name: str, sid: str, request: Request, who: Who):
    g = _game(request, gid, "valheim")
    if name not in LISTS:
        raise HTTPException(404, "unknown list")
    path = os.path.join(g.lists_dir, LISTS[name])
    ids = read_list(path)
    if sid in ids:
        try:
            write_list(path, [i for i in ids if i != sid])
        except OSError as e:
            request.app.state.db.audit(who, "list-remove", gid, "failed", f"{name} {sid}")
            raise HTTPException(502, f"Couldn't write the list: {e.strerror}")
    request.app.state.db.audit(who, "list-remove", gid, "ok", f"{name} {sid}")
    return lists(gid, request, who)
