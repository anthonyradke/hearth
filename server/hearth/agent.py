"""The Hearth agent: runs on a second machine (role = "agent") and lets the main Hearth server watch and control it.

It has no history, rules, alerts or app of its own. The server polls GET /agent/snapshot every 30 s over the tailnet;
each poll runs this machine's collectors (system, services, games) and returns the result plus any player joins and
leaves since the last poll. Actions (start/stop/restart, the Minecraft console, Valheim lists) are checked against this
machine's own config, so the server can never make it do more than its config allows. RCON stays on localhost: the
agent is the only thing that talks to it.

Auth: a bearer token shared with the server, and the client's address must be loopback or listed under [agent] allow.
The unit adds a firewall of its own (IPAddressAllow), and listens on the tailnet address only.

Run: uvicorn --factory hearth.agent:app (config from $HEARTH_CONFIG)."""
from __future__ import annotations
import hmac, logging, secrets, threading, time
from collections import deque
from fastapi import APIRouter, Body, Depends, FastAPI, HTTPException, Query, Request
from . import __version__, config
from .actions import OpError, list_change, list_ids, rcon_command, unit_verb
from .auth import load_token
from .collectors.games import Games
from .collectors.services import Services, journal
from .collectors.system import System
from .db import DB

log = logging.getLogger("hearth.agent")
LOOPBACK = {"127.0.0.1", "::1"}


class Agent:
    def __init__(self, cfg, db):
        self.cfg, self.db = cfg, db
        self.system = System(cfg.disks, cfg.smart, cfg.smart_dir)
        self.services = Services(cfg.services)
        self.games = Games(cfg.games, db)
        self.lock = threading.Lock()
        self.instance = secrets.token_hex(6)  # changes on every restart, so the server knows event ids started over
        self.seq = 0
        self.events: deque[dict] = deque(maxlen=500)

    def snapshot(self, since: int = 0) -> dict:
        errors, samples = {}, {}
        system = services = games = None
        with self.lock:
            try:
                system, s = self.system.collect()
                samples.update(s)
            except Exception as e:
                log.exception("system collector failed")
                errors["system"] = f"{type(e).__name__}: {e}"
            try:
                services, s = self.services.collect()
                samples.update(s)
            except Exception as e:
                log.exception("services collector failed")
                errors["services"] = f"{type(e).__name__}: {e}"
            if services is not None:
                try:
                    games, s, evs = self.games.collect({x["unit"]: x for x in services})
                    samples.update(s)
                    for kind, gid, who in evs:
                        self.seq += 1
                        self.events.append({"id": self.seq, "ts": int(time.time()), "kind": kind, "subject": gid,
                                            "detail": who})
                except Exception as e:
                    log.exception("games collector failed")
                    errors["games"] = f"{type(e).__name__}: {e}"
            events = [e for e in self.events if e["id"] > since]
        return {"app": "hearth-agent", "version": __version__, "instance": self.instance, "seq": self.seq,
                "ts": int(time.time()), "system": system, "services": services, "games": games,
                "samples": {k: v for k, v in samples.items() if v is not None}, "events": events, "errors": errors}


def check(request: Request) -> str:
    st = request.app.state
    client = request.client.host if request.client else ""
    if client not in st.allowed:
        raise HTTPException(403, "not an allowed address")
    got = request.headers.get("authorization", "")
    if not st.token or not got.startswith("Bearer ") or not hmac.compare_digest(got[7:].strip(), st.token):
        raise HTTPException(401, "bad or missing token")
    return client


router = APIRouter(prefix="/agent")


def _op(fn, what: str, client: str):
    try:
        out = fn()
    except OpError as e:
        log.info("%s from %s: refused/failed (%s %s)", what, client, e.status, e.detail)
        raise HTTPException(e.status, e.detail)
    log.info("%s from %s: ok", what, client)
    return out


@router.get("/ping")
def ping():
    return {"ok": True, "app": "hearth-agent", "version": __version__}


@router.get("/snapshot")
def snapshot(request: Request, client: str = Depends(check), since: int = Query(0, ge=0), instance: str = ""):
    agent = request.app.state.agent
    return agent.snapshot(since if instance == agent.instance else 0)  # after a restart, ids from before mean nothing


@router.get("/journal/{unit}")
def unit_journal(unit: str, request: Request, client: str = Depends(check), lines: int = Query(100, ge=1, le=1000)):
    if not request.app.state.cfg.service(unit):
        raise HTTPException(404, "unknown service")
    return {"unit": unit, "journal": journal(unit, lines)}


@router.post("/units/{unit}/{verb}")
def unit_action(unit: str, verb: str, request: Request, client: str = Depends(check)):
    _op(lambda: unit_verb(request.app.state.cfg, unit, verb), f"{verb} {unit}", client)
    return {"ok": True}


@router.post("/games/{gid}/rcon")
def rcon(gid: str, request: Request, client: str = Depends(check),
         command: str = Body(..., embed=True, min_length=1, max_length=500)):
    command = command.strip().lstrip("/")
    out = _op(lambda: rcon_command(request.app.state.cfg, gid, command), f"rcon {gid}", client)
    return {"command": command, "output": out}


@router.get("/games/{gid}/lists")
def lists(gid: str, request: Request, client: str = Depends(check)):
    st = request.app.state
    ids = _op(lambda: list_ids(st.cfg, gid), f"read lists {gid}", client)
    return {"lists": ids, "names": st.db.get(f"valheim_names:{gid}", {})}


@router.post("/games/{gid}/lists/{name}")
def list_add(gid: str, name: str, request: Request, client: str = Depends(check), id: str = Body(..., embed=True)):
    _op(lambda: list_change(request.app.state.cfg, gid, name, id.strip(), True), f"list-add {gid} {name}", client)
    return lists(gid, request, client)


@router.delete("/games/{gid}/lists/{name}/{sid}")
def list_remove(gid: str, name: str, sid: str, request: Request, client: str = Depends(check)):
    _op(lambda: list_change(request.app.state.cfg, gid, name, sid, False), f"list-remove {gid} {name}", client)
    return lists(gid, request, client)


def create_agent(cfg: config.Config | None = None, db: DB | None = None) -> FastAPI:
    cfg = cfg or config.load()
    db = db or DB(cfg.db)
    app = FastAPI(title="Hearth agent", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.cfg, app.state.db = cfg, db
    app.state.token = load_token(cfg.agent.token_file)
    listen_host = cfg.agent.listen.rpartition(":")[0].strip("[]")
    app.state.allowed = LOOPBACK | set(cfg.agent.allow) | {listen_host}  # listen host: the install self-test
    app.state.agent = Agent(cfg, db)
    app.include_router(router)
    return app


def app() -> FastAPI:
    """uvicorn --factory hearth.agent:app"""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    return create_agent()
