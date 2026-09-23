"""Tailscale peers and key expiry, Pi-hole stats (v6 API) plus a real DNS probe, and the public IP."""
from __future__ import annotations
import json, random, socket, struct, subprocess, time, urllib.error, urllib.request
from datetime import datetime


def _iso(ts: str | None) -> int | None:
    if not ts or ts.startswith("0001"):
        return None
    try:
        return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def parse_tailscale(d: dict) -> dict:
    users = {str(k): v.get("LoginName") for k, v in (d.get("User") or {}).items()}

    def node(p: dict) -> dict:
        return {"name": (p.get("DNSName") or "").split(".")[0] or p.get("HostName"),
                "os": p.get("OS") or None, "online": bool(p.get("Online")),
                "ip": (p.get("TailscaleIPs") or [None])[0], "last_seen": _iso(p.get("LastSeen")),
                "key_expiry": _iso(p.get("KeyExpiry")), "user": users.get(str(p.get("UserID"))),
                "exit_node": bool(p.get("ExitNode")), "rx": p.get("RxBytes"), "tx": p.get("TxBytes"),
                "direct": bool(p.get("CurAddr"))}

    peers = [node(p) for p in (d.get("Peer") or {}).values()
             if not (p.get("Tags") and "tag:ingress" in p["Tags"])]  # Funnel relays, not devices
    peers.sort(key=lambda p: (not p["online"], p["name"] or ""))
    me = d.get("Self") or {}
    return {"state": d.get("BackendState"), "version": (d.get("Version") or "").split("-")[0] or None,
            "self": node(me) if me else None, "peers": peers,
            "tailnet": (d.get("CurrentTailnet") or {}).get("Name")}


def tailscale() -> dict:
    try:
        out = subprocess.run(["tailscale", "status", "--json"], capture_output=True, text=True, timeout=10)
        return parse_tailscale(json.loads(out.stdout))
    except (OSError, ValueError, subprocess.TimeoutExpired) as e:
        return {"state": "unavailable", "error": str(e), "peers": [], "self": None}


def dns_probe(name: str, server: str = "127.0.0.1", timeout: float = 2) -> tuple[bool, float | None]:
    """Sends one A query over UDP. True if any well-formed answer came back (even NXDOMAIN), with the ms taken."""
    qid = random.randint(0, 0xFFFF)
    q = struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0)
    q += b"".join(bytes([len(p)]) + p.encode() for p in name.split(".")) + b"\x00" + struct.pack(">HH", 1, 1)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    start = time.monotonic()
    try:
        s.sendto(q, (server, 53))
        data, _ = s.recvfrom(512)
        ok = len(data) >= 12 and struct.unpack(">H", data[:2])[0] == qid
        return ok, round((time.monotonic() - start) * 1000, 1)
    except OSError:
        return False, None
    finally:
        s.close()


class PiHole:
    """Pi-hole v6 REST API with an app password. Keeps one session and logs in again when it expires."""

    def __init__(self, url: str, password: str):
        self.url, self.password = url, password
        self.sid: str | None = None

    def _req(self, path: str, body: dict | None = None, method: str | None = None) -> dict:
        req = urllib.request.Request(self.url + path, method=method or ("POST" if body else "GET"),
                                     data=json.dumps(body).encode() if body else None,
                                     headers={"Content-Type": "application/json"})
        if self.sid:
            req.add_header("X-FTL-SID", self.sid)
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.load(r)

    def _login(self) -> None:
        d = self._req("/api/auth", {"password": self.password})
        s = d.get("session") or {}
        if not s.get("valid"):
            raise PermissionError(s.get("message") or "login refused")
        self.sid = s.get("sid")

    def get(self, path: str) -> dict:
        if not self.sid:
            self._login()
        try:
            return self._req(path)
        except urllib.error.HTTPError as e:
            if e.code != 401:
                raise
            self.sid = None
            self._login()
            return self._req(path)

    def collect(self) -> dict:
        up, ms = dns_probe("pi.hole")
        upstream, ums = dns_probe("cloudflare.com")
        out = {"dns": up, "dns_ms": ms, "upstream": upstream, "upstream_ms": ums, "configured": bool(self.password)}
        if not self.password:
            return out
        try:
            s = self.get("/api/stats/summary")
            q = s.get("queries") or {}
            blocking = self.get("/api/dns/blocking")
            top = self.get("/api/stats/top_clients?count=6")
            out.update(
                queries=q.get("total"), blocked=q.get("blocked"), percent_blocked=_round(q.get("percent_blocked")),
                cached=q.get("cached"), forwarded=q.get("forwarded"),
                unique_domains=q.get("unique_domains"),
                clients=(s.get("clients") or {}).get("active"),
                blocklist=(s.get("gravity") or {}).get("domains_being_blocked"),
                blocking=blocking.get("blocking"),
                top_clients=[{"name": c.get("name") or c.get("ip"), "ip": c.get("ip"), "count": c.get("count")}
                             for c in top.get("clients", [])],
            )
        except (OSError, ValueError, PermissionError) as e:
            out["error"] = str(e)
        return out


def _round(v):
    return round(v, 1) if isinstance(v, (int, float)) else None


def public_ip(url: str) -> str | None:
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            ip = r.read(64).decode().strip()
        socket.inet_pton(socket.AF_INET6 if ":" in ip else socket.AF_INET, ip)
        return ip
    except (OSError, ValueError):
        return None
