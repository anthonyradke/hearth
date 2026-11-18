"""Loads /etc/hearth/config.toml (or $HEARTH_CONFIG). Everything specific to the machine comes from here.

role = "server" (the default) runs the full backend: API, history, rules, alerts, and polls any [[host]] agents.
role = "agent" runs only the small agent (agent.py) on a second machine, which the server polls over the tailnet."""
from __future__ import annotations
import os, re, socket, tomllib
from dataclasses import dataclass, field

ACTIONS = ("none", "restart", "full")
ROLES = ("server", "agent")
HOST_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,30}$")


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
class RemoteHost:
    """A machine running the Hearth agent, polled by the server."""
    id: str
    url: str                       # http://<tailnet ip>:<port>, no trailing slash
    token_file: str
    name: str = ""
    timeout: float = 5
    unreachable_seconds: float = 90  # no good poll for this long = the host is unreachable


@dataclass
class AgentCfg:
    listen: str = "127.0.0.1:8011"   # host:port; on a real install the machine's tailnet IP
    allow: list[str] = field(default_factory=list)  # client IPs allowed besides loopback (the server's tailnet IP)
    token_file: str = "/etc/hearth/token"


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
    check_max_age_days: float = 8      # weekly
    drill_max_age_days: float = 33     # monthly
    gpu_temp_c: float = 90
    ssd_wear_pct: float = 90           # NVMe "percentage used"


@dataclass
class AlertsCfg:
    ntfy_url: str = "https://ntfy.sh"
    ntfy_topic: str = ""
    ntfy_token: str = ""
    title: str = "Hearth"
    quiet_hours: str = ""          # "23:00-08:00": warnings wait until the end; critical alerts always go out
    timezone: str = "UTC"
    grace_critical: float = 90     # seconds an issue must last before it's sent
    grace_warning: float = 300
    remind_hours: float = 6        # repeat critical alerts this often while they last (0 = never)
    heartbeat_url: str = ""        # healthchecks.io ping URL
    heartbeat_seconds: int = 60


@dataclass
class Config:
    role: str = "server"
    name: str = ""                     # how this machine is labelled in the app; defaults to the hostname
    owner: str = ""
    db: str = "/var/lib/hearth/hearth.db"
    token_file: str = "/etc/hearth/token"
    disks: list[str] = field(default_factory=lambda: ["/"])
    smart: list[str] = field(default_factory=list)  # devices whose SMART data hearth-smart.timer records
    smart_dir: str = "/var/lib/hearth-smart"
    sample: dict[str, int] = field(default_factory=lambda: {
        "system": 30, "services": 30, "games": 60, "network": 60, "public_ip": 600})
    services: list[Service] = field(default_factory=list)
    games: list[Game] = field(default_factory=list)
    pihole_url: str = "http://127.0.0.1"
    pihole_password: str = ""
    cellar_status: str = "/var/lib/cellar/status.json"
    public_ip_url: str = "https://api.ipify.org"
    rules: Rules = field(default_factory=Rules)
    alerts: AlertsCfg = field(default_factory=AlertsCfg)
    hosts: list[RemoteHost] = field(default_factory=list)
    agent: AgentCfg = field(default_factory=AgentCfg)

    def service(self, unit: str) -> Service | None:
        return next((s for s in self.services if s.unit == unit), None)

    def game(self, gid: str) -> Game | None:
        return next((g for g in self.games if g.id == gid), None)

    def host(self, hid: str) -> RemoteHost | None:
        return next((h for h in self.hosts if h.id == hid), None)


def parse(raw: dict) -> Config:
    c = Config()
    for k in ("role", "name", "owner", "db", "token_file", "disks", "smart", "smart_dir"):
        if k in raw:
            setattr(c, k, raw[k])
    if c.role not in ROLES:
        raise ValueError(f"role must be one of {ROLES}")
    c.name = c.name or socket.gethostname()
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
    c.alerts = AlertsCfg(**raw.get("alerts", {}))
    c.hosts = [RemoteHost(**h) for h in raw.get("host", [])]
    for h in c.hosts:
        if not HOST_ID.match(h.id):
            raise ValueError(f"host {h.id!r}: id must be lowercase letters, digits and dashes")
        if h.id == c.name:
            raise ValueError(f"host {h.id!r}: same name as this machine")
        h.name = h.name or h.id
        h.url = h.url.rstrip("/")
    if len({h.id for h in c.hosts}) != len(c.hosts):
        raise ValueError("two [[host]] entries share an id")
    c.agent = AgentCfg(**raw.get("agent", {}))
    return c


def load(path: str | None = None) -> Config:
    path = path or os.environ.get("HEARTH_CONFIG", "/etc/hearth/config.toml")
    with open(path, "rb") as f:
        return parse(tomllib.load(f))
