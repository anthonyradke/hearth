"""The server's side of a [[host]]: polls that machine's agent (agent.py) and forwards actions to it.

Everything from a remote host is renamed so it can sit next to this machine's own data without clashing:
- a unit becomes "<host>/<unit>" (e.g. "h5/mheynautics.service") wherever the API uses a unit as an id;
- its history keys become "<host>/cpu", "<host>/disk:/srv/data" for the machine, "mem:<host>/<unit>" for a unit;
- game ids stay as they are (they're already unique across machines), and players:<id> with them."""
from __future__ import annotations
import json, logging, time, urllib.error, urllib.parse, urllib.request
from .actions import OpError
from .auth import load_token

log = logging.getLogger("hearth.remote")
UNIT_METRICS = ("mem", "cpu")


def sample_key(host: str, key: str) -> str:
    metric, sep, subject = key.partition(":")
    if sep and metric in UNIT_METRICS:
        return f"{metric}:{host}/{subject}"
    if sep and metric == "players":
        return key
    return f"{host}/{key}"


class Remote:
    def __init__(self, hcfg, db, opener=None):
        self.cfg, self.db = hcfg, db
        self.id, self.name = hcfg.id, hcfg.name
        self.token = load_token(hcfg.token_file)
        self.open = opener or urllib.request.urlopen
        seen = db.get(f"remote_seq:{self.id}") or {}
        self.instance: str | None = seen.get("instance")
        self.seq: int = seen.get("seq", 0)
        self.state: dict = {"id": self.id, "name": self.name, "reachable": None, "last_ok": None, "last_try": None,
                            "error": None, "version": None, "system": None, "services": None, "games": None,
                            "errors": {}}

    # ---------- transport ----------
    def _req(self, method: str, path: str, body: dict | None = None, timeout: float | None = None) -> dict:
        req = urllib.request.Request(self.cfg.url + path, method=method,
                                     data=json.dumps(body).encode() if body is not None else None)
        req.add_header("Authorization", f"Bearer {self.token}")
        if body is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with self.open(req, timeout=timeout or self.cfg.timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            try:
                detail = json.load(e).get("detail")
            except (ValueError, AttributeError, OSError):
                detail = None
            # The agent refusing something keeps its status (404, 403, 400…); its own failures stay 502.
            raise OpError(e.code if e.code < 500 else 502, f"{detail or e.reason}")
        except (OSError, ValueError) as e:
            reason = getattr(e, "reason", None) or e
            raise OpError(502, f"{self.name} didn't answer ({reason})")

    # ---------- polling ----------
    def poll(self, now: float | None = None) -> dict | None:
        """One snapshot, or None if the agent didn't answer. New join/leave events are those after the last seq seen
        (from the same agent run), so a restart of either side neither loses nor repeats any."""
        now = now or time.time()
        self.state["last_try"] = int(now)
        try:
            snap = self._req("GET", f"/agent/snapshot?since={self.seq}&instance={self.instance or ''}")
        except OpError as e:
            self.state.update(reachable=False, error=e.detail)
            return None
        # A different instance means the agent restarted: its ids started over and it sent everything it holds.
        same = snap.get("instance") == self.instance
        self.instance = snap.get("instance")
        self.seq = max((e["id"] for e in snap.get("events") or []), default=self.seq if same else 0)
        self.db.put(f"remote_seq:{self.id}", {"instance": self.instance, "seq": self.seq})
        self.state.update(reachable=True, last_ok=int(now), error=None, version=snap.get("version"),
                          system=snap.get("system"), errors=snap.get("errors") or {},
                          services=[self.service(s) for s in snap.get("services") or []]
                          if snap.get("services") is not None else self.state["services"],
                          games=[self.game(g) for g in snap.get("games") or []]
                          if snap.get("games") is not None else self.state["games"])
        return snap

    def service(self, s: dict) -> dict:
        unit = s["unit"]
        return {**s, "unit": f"{self.id}/{unit}", "systemd_unit": unit, "host": self.id,
                "section": s.get("group"), "group": f"{self.name} · {s.get('group')}"}

    def game(self, g: dict) -> dict:
        return {**g, "unit": f"{self.id}/{g['unit']}", "host": self.id}

    def samples(self, snap: dict) -> dict[str, float]:
        return {sample_key(self.id, k): v for k, v in (snap.get("samples") or {}).items()}

    # ---------- reading and actions, forwarded ----------
    def journal(self, unit: str, lines: int) -> list[dict]:
        return self._req("GET", f"/agent/journal/{urllib.parse.quote(unit)}?lines={lines}")["journal"]

    def unit_verb(self, unit: str, verb: str) -> None:
        self._req("POST", f"/agent/units/{urllib.parse.quote(unit)}/{urllib.parse.quote(verb)}", timeout=170)

    def rcon(self, gid: str, command: str) -> str:
        return self._req("POST", f"/agent/games/{urllib.parse.quote(gid)}/rcon", {"command": command})["output"]

    def lists(self, gid: str) -> dict:
        """→ {"lists": {name: [ids]}, "names": {steamid: character}}"""
        return self._req("GET", f"/agent/games/{urllib.parse.quote(gid)}/lists")

    def list_change(self, gid: str, name: str, sid: str, add: bool) -> None:
        base = f"/agent/games/{urllib.parse.quote(gid)}/lists/{urllib.parse.quote(name)}"
        if add:
            self._req("POST", base, {"id": sid})
        else:
            self._req("DELETE", f"{base}/{urllib.parse.quote(sid)}")
