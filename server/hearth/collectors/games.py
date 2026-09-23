"""Game servers: who's online and which version is running. Minecraft answers over RCON; Valheim has no RCON, so its
players are followed through its journal (handshake → character → closing socket)."""
from __future__ import annotations
import json, re, subprocess, time
from ..rcon import RconError, pool

LIST_RE = re.compile(r"There are (\d+) of a max of (\d+) players online:?\s*(.*)", re.S)
MC_VERSION_RE = re.compile(r"Starting minecraft server version (\S+)")
FABRIC_RE = re.compile(r"Loading Minecraft \S+ with Fabric Loader (\S+)")
VH_VERSION_RE = re.compile(r"Valheim version: (\S+)")
VH_WORLD_RE = re.compile(r"Get create world (.+)$")
VH_HANDSHAKE_RE = re.compile(r"Got handshake from client (\d+)")
VH_CHAR_RE = re.compile(r"Got character ZDOID from (.+?) : (-?\d+):(-?\d+)")
VH_CLOSE_RE = re.compile(r"Closing socket (\d+)")
VH_COUNT_RE = re.compile(r"Connections (\d+) ZDOS")


def parse_list(text: str) -> tuple[int, int, list[str]] | None:
    m = LIST_RE.search(text)
    if not m:
        return None
    names = [n.strip() for n in m.group(3).split(",") if n.strip()]
    return int(m.group(1)), int(m.group(2)), names


def invocation_lines(invocation: str, cursor: str | None = None, grep: str | None = None) -> tuple[list[str], str | None]:
    """Messages logged by one run of a unit (optionally only after a cursor), and the cursor of the last one."""
    args = ["journalctl", f"_SYSTEMD_INVOCATION_ID={invocation}", "-o", "json", "--no-pager", "-q",
            "--output-fields=MESSAGE"]
    if cursor:
        args.append(f"--after-cursor={cursor}")
    if grep:
        args += ["-g", grep]
    try:
        out = subprocess.run(args, capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return [], cursor
    lines, last = [], cursor
    for raw in out.stdout.splitlines():
        try:
            e = json.loads(raw)
        except ValueError:
            continue
        msg = e.get("MESSAGE")
        if isinstance(msg, list):
            msg = bytes(msg).decode("utf8", "replace")
        lines.append(msg or "")
        last = e.get("__CURSOR", last)
    return lines, last


class Valheim:
    """Follows one Valheim run's journal incrementally. Knows who is online, and which SteamID plays which
    character (learned from the handshake that precedes each character load)."""

    def __init__(self, names: dict[str, str] | None = None):
        self.invocation: str | None = None
        self.cursor: str | None = None
        self.online: dict[str, str | None] = {}  # steamid → character name (None until known)
        self.names: dict[str, str] = dict(names or {})
        self.pending: list[str] = []  # handshakes waiting for their character
        self.version: str | None = None
        self.world: str | None = None
        self.count: int | None = None

    def reset(self, invocation: str | None) -> None:
        self.invocation, self.cursor = invocation, None
        self.online, self.pending, self.count = {}, [], None
        self.version = self.world = None

    def feed(self, lines: list[str]) -> list[tuple[str, str]]:
        """Processes log lines; returns [("join"|"leave", name-or-id), …]."""
        events = []
        for line in lines:
            if m := VH_VERSION_RE.search(line):
                self.version = m.group(1)
            elif m := VH_WORLD_RE.search(line):
                self.world = m.group(1).strip()
            elif m := VH_HANDSHAKE_RE.search(line):
                sid = m.group(1)
                if sid not in self.online:
                    self.online[sid] = self.names.get(sid)
                    events.append(("join", self.names.get(sid) or sid))
                if sid not in self.pending:
                    self.pending.append(sid)
            elif m := VH_CHAR_RE.search(line):
                name = m.group(1)
                if m.group(2) == "0" and m.group(3) == "0":
                    continue  # the character died; still online
                owner = next((s for s, n in self.online.items() if n == name), None)
                if owner:
                    continue
                sid = self.pending.pop(0) if self.pending else None
                if sid:
                    self.online[sid] = name
                    self.names[sid] = name
            elif m := VH_CLOSE_RE.search(line):
                sid = m.group(1)
                if sid in self.online:
                    events.append(("leave", self.online.pop(sid) or sid))
                if sid in self.pending:
                    self.pending.remove(sid)
            elif m := VH_COUNT_RE.search(line):
                self.count = int(m.group(1))
                if self.count == 0 and self.online:  # a disconnect we missed
                    for sid, n in list(self.online.items()):
                        events.append(("leave", n or sid))
                    self.online.clear()
        return events

    def players(self) -> list[dict]:
        return [{"name": n or "Joining…", "id": sid} for sid, n in self.online.items()]


class Games:
    def __init__(self, games, db):
        self.games = games
        self.db = db
        self.mc_players: dict[str, list[str]] = {}
        self.mc_meta: dict[str, tuple[str, dict]] = {}  # game id → (invocation, {version, loader})
        self.valheim: dict[str, Valheim] = {
            g.id: Valheim(db.get(f"valheim_names:{g.id}", {})) for g in games if g.kind == "valheim"}

    def collect(self, units: dict[str, dict]) -> tuple[list[dict], dict[str, float], list[tuple[str, str, str]]]:
        """→ (game snapshots, samples, events [(kind, game id, player)])"""
        out, samples, events = [], {}, []
        for g in self.games:
            u = units.get(g.unit, {})
            running = u.get("active") == "active"
            snap = {"id": g.id, "kind": g.kind, "name": g.name, "unit": g.unit, "address": g.address,
                    "running": running, "health": u.get("health", "unknown"), "since": u.get("since"),
                    "memory": u.get("memory"), "cpu": u.get("cpu"), "players": [], "max_players": None,
                    "version": None, "error": None}
            if g.kind == "minecraft":
                ev = self._minecraft(g, u, snap)
            else:
                ev = self._valheim(g, u, snap)
            events += [(kind, g.id, who) for kind, who in ev]
            if running:
                samples[f"players:{g.id}"] = len(snap["players"])
            if snap["version"]:
                self.db.put(f"version:{g.id}", snap["version"])
            else:
                snap["version"] = self.db.get(f"version:{g.id}")
            out.append(snap)
        return out, samples, events

    def _minecraft(self, g, u: dict, snap: dict) -> list[tuple[str, str]]:
        inv = u.get("invocation")
        if inv:
            cached = self.mc_meta.get(g.id)
            if not cached or cached[0] != inv or not cached[1].get("version"):
                lines, _ = invocation_lines(inv, grep="Starting minecraft server version|Fabric Loader")
                meta = {}
                for line in lines:
                    if m := MC_VERSION_RE.search(line):
                        meta["version"] = m.group(1)
                    if m := FABRIC_RE.search(line):
                        meta["loader"] = f"Fabric {m.group(1)}"
                self.mc_meta[g.id] = (inv, meta)
        elif g.id not in self.mc_meta:
            # Stopped: take the version from the last run in the journal, once.
            try:
                out = subprocess.run(["journalctl", "-u", g.unit, "-o", "cat", "--no-pager", "-q", "-n", "4",
                                      "-g", "Starting minecraft server version|Fabric Loader"],
                                     capture_output=True, text=True, timeout=15).stdout.splitlines()
            except (OSError, subprocess.TimeoutExpired):
                out = []
            meta = {}
            for line in out:
                if m := MC_VERSION_RE.search(line):
                    meta["version"] = m.group(1)
                if m := FABRIC_RE.search(line):
                    meta["loader"] = f"Fabric {m.group(1)}"
            self.mc_meta[g.id] = ("", meta)
        if g.id in self.mc_meta:
            meta = self.mc_meta[g.id][1]
            snap["version"] = meta.get("version")
            snap["loader"] = meta.get("loader")
        prev = self.mc_players.get(g.id, [])
        if not snap["running"]:
            pool.drop(g.rcon_port)
            self.mc_players[g.id] = []
            return [("leave", p) for p in prev]
        if not g.rcon_port or not g.rcon_password:
            snap["error"] = "RCON not configured"
            return []
        try:
            parsed = parse_list(pool.command(g.rcon_port, g.rcon_password, "list"))
        except (OSError, RconError) as e:
            snap["error"] = "starting up" if u.get("since") and _recent(u["since"]) else f"RCON: {e}"
            return []
        if not parsed:
            snap["error"] = "unexpected reply to list"
            return []
        _, snap["max_players"], names = parsed
        snap["players"] = [{"name": n} for n in names]
        self.mc_players[g.id] = names
        return [("join", n) for n in names if n not in prev] + [("leave", p) for p in prev if p not in names]

    def _valheim(self, g, u: dict, snap: dict) -> list[tuple[str, str]]:
        v = self.valheim[g.id]
        inv = u.get("invocation") if snap["running"] else None
        events = []
        if inv != v.invocation:
            events += [("leave", n or sid) for sid, n in v.online.items()]
            v.reset(inv)
        if inv:
            catching_up = v.cursor is None
            lines, v.cursor = invocation_lines(inv, v.cursor)
            known = dict(v.names)
            fed = v.feed(lines)
            if not catching_up:  # replaying a run's earlier log on startup isn't news
                events += fed
            if v.names != known:
                self.db.put(f"valheim_names:{g.id}", v.names)
        snap["players"] = v.players()
        snap["version"] = v.version
        snap["world"] = v.world
        return events


def _recent(since: int, seconds: int = 180) -> bool:
    return time.time() - since < seconds
