"""Game servers: who's online and which version is running. Minecraft answers over RCON; Valheim has no RCON, so its
players are followed through its journal (handshake → character → closing socket)."""
from __future__ import annotations
import json, re, subprocess, time
from ..rcon import RconError, pool

LIST_RE = re.compile(r"There are (\d+) of a max of (\d+) players online:?\s*(.*)", re.S)
MC_VERSION_RE = re.compile(r"Starting minecraft server version (\S+)")
FABRIC_RE = re.compile(r"Loading Minecraft \S+ with Fabric Loader (\S+)")
NEOFORGE_RE = re.compile(r"--fml\.neoForgeVersion, ([^,\]\s]+)")
MC_META_GREP = "Starting minecraft server version|Fabric Loader|fml\\.neoForgeVersion"
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


def parse_mc_meta(lines: list[str]) -> dict:
    """Version and mod loader from a Minecraft server's startup lines."""
    meta = {}
    for line in lines:
        if m := MC_VERSION_RE.search(line):
            meta["version"] = m.group(1)
        if m := FABRIC_RE.search(line):
            meta["loader"] = f"Fabric {m.group(1)}"
        if m := NEOFORGE_RE.search(line):
            meta["loader"] = f"NeoForge {m.group(1)}"
    return meta


def journal_entries(match: list[str], cursor: str | None = None, grep: str | None = None,
                    last: int | None = None) -> list[dict]:
    """Raw journal entries for some journalctl matches (optionally only after a cursor, matching a pattern, or the
    last n), oldest first, with MESSAGE decoded to text."""
    args = ["journalctl", *match, "-o", "json", "--no-pager", "-q",
            "--output-fields=MESSAGE,_SYSTEMD_INVOCATION_ID"]
    if cursor:
        args.append(f"--after-cursor={cursor}")
    if grep:
        args += ["-g", grep]
    if last:
        args += ["-n", str(last)]
    try:
        out = subprocess.run(args, capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return []
    entries = []
    for raw in out.stdout.splitlines():
        try:
            e = json.loads(raw)
        except ValueError:
            continue
        msg = e.get("MESSAGE")
        if isinstance(msg, list):  # binary messages come back as byte arrays
            msg = bytes(msg).decode("utf8", "replace")
        e["MESSAGE"] = msg or ""
        entries.append(e)
    return entries


def invocation_lines(invocation: str, cursor: str | None = None, grep: str | None = None) -> tuple[list[str], str | None]:
    """Messages logged by one run of a unit (optionally only after a cursor), and the cursor of the last one."""
    entries = journal_entries([f"_SYSTEMD_INVOCATION_ID={invocation}"], cursor, grep)
    return [e["MESSAGE"] for e in entries], (entries[-1].get("__CURSOR", cursor) if entries else cursor)


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
        self.mc_meta: dict[str, tuple[str, dict, str | None]] = {}  # game id → (invocation, {version, loader}, cursor)
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
        cached = self.mc_meta.get(g.id)
        if inv and (not cached or cached[0] != inv):
            # New run (or Hearth just started): one grep over the run so far.
            lines, _ = invocation_lines(inv, grep=MC_META_GREP)
            self.mc_meta[g.id] = (inv, parse_mc_meta(lines), None)
        elif inv and not cached[1].get("version"):
            # Still starting up: read only what's new since the last poll, so a long modded startup isn't
            # re-scanned on every tick.
            lines, cursor = invocation_lines(inv, cached[2])
            self.mc_meta[g.id] = (inv, {**cached[1], **parse_mc_meta(lines)}, cursor)
        elif not inv and g.id not in self.mc_meta:
            # Stopped: take the version from the last run that logged one, once. Only that run, so a loader from
            # an older run can't stick.
            meta = {}
            last = journal_entries(["-u", g.unit], grep=MC_META_GREP, last=1)
            if last and (prev_inv := last[-1].get("_SYSTEMD_INVOCATION_ID")):
                meta = parse_mc_meta(invocation_lines(prev_inv, grep=MC_META_GREP)[0])
            self.mc_meta[g.id] = ("", meta, None)
        meta = self.mc_meta.get(g.id, ("", {}, None))[1]
        if meta.get("version"):
            snap["version"], snap["loader"] = meta["version"], meta.get("loader")
            self.db.put(f"loader:{g.id}", snap["loader"])
        else:
            # The version falls back to the db in collect(); keep the loader that went with it.
            snap["loader"] = self.db.get(f"loader:{g.id}")
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
