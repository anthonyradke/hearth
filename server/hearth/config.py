"""Loads /etc/hearth/config.toml (or $HEARTH_CONFIG). Everything specific to the machine comes from here."""
from __future__ import annotations
import os, tomllib
from dataclasses import dataclass, field

ACTIONS = ("none", "restart", "full")


@dataclass
class Service:
    unit: str
    name: str
    group: str = "Other"
    actions: str = "none"
    cgroup: str = ""


@dataclass
class Game:
    id: str
    kind: str  # minecraft | valheim
    name: str
    unit: str
    address: str = ""
    rcon_port: int = 0
    rcon_password: str = ""
    lists_dir: str = ""


@dataclass
class Rules:
    disk_warn: float = 85
    disk_crit: float = 95
    ram_pct: float = 90
    ram_minutes: float = 5
    temp_c: float = 90
    battery_low: float = 30
    flap_restarts: int = 3
    flap_minutes: float = 15
    tailscale_expiry_days: float = 14
    backup_max_age_hours: float = 36


@dataclass
class Config:
    owner: str = ""
    db: str = "/var/lib/hearth/hearth.db"
    token_file: str = "/etc/hearth/token"
    disks: list[str] = field(default_factory=lambda: ["/"])
    sample: dict[str, int] = field(default_factory=lambda: {
        "system": 30, "services": 30, "games": 60, "network": 60, "public_ip": 600})
    services: list[Service] = field(default_factory=list)
    games: list[Game] = field(default_factory=list)
    pihole_url: str = "http://127.0.0.1"
    pihole_password: str = ""
    cellar_status: str = "/var/lib/cellar/status.json"
    public_ip_url: str = "https://api.ipify.org"
    rules: Rules = field(default_factory=Rules)

    def service(self, unit: str) -> Service | None:
        return next((s for s in self.services if s.unit == unit), None)

    def game(self, gid: str) -> Game | None:
        return next((g for g in self.games if g.id == gid), None)


def parse(raw: dict) -> Config:
    c = Config()
    for k in ("owner", "db", "token_file", "disks"):
        if k in raw:
            setattr(c, k, raw[k])
    c.sample.update(raw.get("sample", {}))
    c.services = [Service(**s) for s in raw.get("service", [])]
    for s in c.services:
        if s.actions not in ACTIONS:
            raise ValueError(f"service {s.unit}: actions must be one of {ACTIONS}")
    c.games = [Game(**g) for g in raw.get("game", [])]
    for g in c.games:
        if g.kind not in ("minecraft", "valheim"):
            raise ValueError(f"game {g.id}: kind must be minecraft or valheim")
    ph = raw.get("pihole", {})
    c.pihole_url = ph.get("url", c.pihole_url).rstrip("/")
    c.pihole_password = ph.get("password", "")
    c.cellar_status = raw.get("cellar", {}).get("status", c.cellar_status)
    c.public_ip_url = raw.get("public_ip", {}).get("url", c.public_ip_url)
    c.rules = Rules(**raw.get("rules", {}))
    return c


def load(path: str | None = None) -> Config:
    path = path or os.environ.get("HEARTH_CONFIG", "/etc/hearth/config.toml")
    with open(path, "rb") as f:
        return parse(tomllib.load(f))
