"""The background loop: runs each collector on its own interval, keeps the latest snapshot in memory for the API,
writes samples and events to SQLite, and folds raw samples into rollups."""
from __future__ import annotations
import logging, threading, time
from dataclasses import dataclass, field
from . import rules
from .collectors import backups, network
from .collectors.games import Games
from .collectors.services import Services
from .collectors.system import System, vnstat

log = logging.getLogger("hearth")


@dataclass
class State:
    system: dict | None = None
    services: list[dict] | None = None
    games: list[dict] | None = None
    tailscale: dict | None = None
    pihole: dict | None = None
    backups: dict | None = None
    traffic: dict | None = None
    public_ip: dict | None = None
    issues: list[dict] = field(default_factory=list)
    errors: dict[str, str] = field(default_factory=dict)
    updated: dict[str, int] = field(default_factory=dict)
    started: int = field(default_factory=lambda: int(time.time()))

    def units(self) -> dict[str, dict]:
        return {s["unit"]: s for s in self.services or []}


class Sampler:
    def __init__(self, cfg, db, state: State | None = None, alerts=None):
        self.cfg, self.db = cfg, db
        self.state = state or State()
        self.alerts = alerts  # phase 3: called with the issue list after every evaluation
        self.system = System(cfg.disks)
        self.services = Services(cfg.services)
        self.games = Games(cfg.games, db)
        self.pihole = network.PiHole(cfg.pihole_url, cfg.pihole_password)
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None
        iv = cfg.sample
        self.jobs = [  # (name, interval, fn); order matters: games read the services snapshot
            ("system", iv["system"], self.do_system),
            ("services", iv["services"], self.do_services),
            ("games", iv["games"], self.do_games),
            ("network", iv["network"], self.do_network),
            ("backups", iv["network"], self.do_backups),
            ("public_ip", iv["public_ip"], self.do_public_ip),
            ("rollup", 300, self.db.rollup),
        ]
        self.due = {name: 0.0 for name, _, _ in self.jobs}
        self.prev_health: dict[str, tuple[str, str | None]] = {}

    # ---------- jobs ----------
    def do_system(self):
        snap, samples = self.system.collect()
        self.state.system = snap
        self.db.record(samples)

    def do_services(self):
        svcs, samples = self.services.collect()
        for s in svcs:
            prev = self.prev_health.get(s["unit"])
            cur = (s["health"], s["invocation"])
            if prev and prev[0] != cur[0]:
                self.db.event("service", s["unit"], s["health"])
            elif prev and cur[0] == "ok" and prev[1] and cur[1] and prev[1] != cur[1]:
                self.db.event("service", s["unit"], "restarted")
            self.prev_health[s["unit"]] = cur
        self.state.services = svcs
        self.db.record(samples)

    def do_games(self):
        games, samples, events = self.games.collect(self.state.units())
        for kind, gid, who in events:
            self.db.event(kind, gid, who)
        self.state.games = games
        self.db.record(samples)

    def do_network(self):
        self.state.tailscale = network.tailscale()
        ph = self.pihole.collect()
        self.state.pihole = ph
        samples = {"dns_ms": ph.get("dns_ms")}
        if ph.get("percent_blocked") is not None:
            samples["pihole_blocked_pct"] = ph["percent_blocked"]
            samples["pihole_queries"] = ph["queries"]
        self.db.record(samples)
        iface = (self.state.system or {}).get("network", {}).get("iface")
        if iface:
            self.state.traffic = vnstat(iface)

    def do_backups(self):
        self.state.backups = backups.collect(self.cfg.cellar_status)

    def do_public_ip(self):
        ip = network.public_ip(self.cfg.public_ip_url)
        prev = self.db.get("public_ip")
        now = int(time.time())
        if ip:
            if prev and prev.get("ip") != ip:
                self.db.event("ip", "public", f"{prev.get('ip')} → {ip}")
                prev = {"ip": ip, "since": now}
            elif not prev:
                prev = {"ip": ip, "since": now}
            prev["checked"] = now
            self.db.put("public_ip", prev)
        self.state.public_ip = {**(prev or {}), "reachable": ip is not None}

    # ---------- loop ----------
    def tick(self, now: float | None = None) -> None:
        """Runs every job that's due. Separate from the loop so tests can drive it."""
        now = now or time.time()
        ran = False
        for name, interval, fn in self.jobs:
            if now < self.due[name]:
                continue
            self.due[name] = now + interval
            try:
                fn()
                self.state.errors.pop(name, None)
                self.state.updated[name] = int(time.time())
            except Exception as e:  # one broken collector must not stop the others
                log.exception("collector %s failed", name)
                self.state.errors[name] = f"{type(e).__name__}: {e}"
            ran = ran or name != "rollup"
        if ran:
            self.state.issues = rules.evaluate(self.state, self.cfg, self.db)
            if self.alerts:
                try:
                    self.alerts(self.state.issues)
                except Exception:
                    log.exception("alerts failed")

    def prime(self) -> None:
        """First pass at startup. CPU and network rates need two readings, so take one now and one a second later."""
        try:
            self.system.collect()
            self.services.collect()
        except Exception:
            log.exception("prime failed")
        time.sleep(1)
        self.tick()

    def run(self) -> None:
        self.prime()
        while not self.stop_event.wait(1):
            self.tick()

    def start(self) -> None:
        self.thread = threading.Thread(target=self.run, name="sampler", daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=10)
