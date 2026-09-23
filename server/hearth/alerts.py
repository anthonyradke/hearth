"""Turns issues into notifications. An issue becomes an alert once it has lasted its grace period (so a restart that
takes a few seconds never pages anyone), is sent once through ntfy, reminded about every few hours while it stays
critical, and gets a recovery message when it clears. Warnings that open during quiet hours wait until morning (and
are dropped if they clear before then). Also pings healthchecks.io, so the server being down gets reported by
someone other than the server."""
from __future__ import annotations
import logging, threading, time, urllib.error, urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

log = logging.getLogger("hearth.alerts")


def in_quiet(now: float, quiet: str, tz: str) -> bool:
    """quiet = "23:00-08:00" (may wrap past midnight), in the configured time zone."""
    if not quiet:
        return False
    start, _, end = quiet.partition("-")
    t = datetime.fromtimestamp(now, ZoneInfo(tz)).strftime("%H:%M")
    return (start <= t < end) if start <= end else (t >= start or t < end)


class Ntfy:
    def __init__(self, url: str, topic: str, token: str = ""):
        self.url, self.topic, self.token = url.rstrip("/"), topic, token

    @property
    def configured(self) -> bool:
        return bool(self.topic)

    def send(self, title: str, message: str, priority: str = "default", tags: str = "") -> None:
        req = urllib.request.Request(f"{self.url}/{self.topic}", data=message.encode(), method="POST")
        req.add_header("Title", title)
        req.add_header("Priority", priority)
        if tags:
            req.add_header("Tags", tags)
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        with urllib.request.urlopen(req, timeout=10) as r:
            r.read()


class Alerts:
    def __init__(self, cfg, db, sender=None):
        self.cfg, self.db = cfg, db
        a = cfg.alerts
        self.ntfy = sender or Ntfy(a.ntfy_url, a.ntfy_topic, a.ntfy_token)
        self.lock = threading.Lock()

    # ---------- sending ----------
    def _send(self, title: str, message: str, priority: str, tags: str) -> bool:
        if not self.ntfy.configured:
            return False
        try:
            self.ntfy.send(title, message, priority, tags)
            return True
        except (OSError, urllib.error.URLError) as e:
            log.warning("ntfy send failed: %s", e)
            return False

    def test(self) -> bool:
        return self._send(self.cfg.alerts.title, "Test notification. Alerts are working.", "default", "white_check_mark")

    # ---------- the engine ----------
    def __call__(self, issues: list[dict], now: float | None = None) -> None:
        with self.lock:
            self.step(issues, now or time.time())

    def step(self, issues: list[dict], now: float) -> None:
        a = self.cfg.alerts
        quiet = in_quiet(now, a.quiet_hours, a.timezone)
        current = {i["id"]: i for i in issues}
        open_rows = {r["rule"]: dict(r) for r in self.db.q("SELECT * FROM alerts WHERE ended IS NULL")}

        # New issues open an alert row at once (the app shows it); notifying waits for the grace period.
        for rid, i in current.items():
            if rid not in open_rows:
                aid = self.db.x("INSERT INTO alerts(rule, severity, title, detail, started) VALUES(?,?,?,?,?)",
                                (rid, i["severity"], i["title"], i["detail"], int(now)))
                open_rows[rid] = {"id": aid, "rule": rid, "severity": i["severity"], "title": i["title"],
                                  "started": int(now), "notified": 0}
            else:  # keep the latest wording ("Disk 86% full" → "Disk 91% full") and escalate severity
                row = open_rows[rid]
                if row["title"] != i["title"] or row["severity"] != i["severity"]:
                    self.db.x("UPDATE alerts SET title=?, detail=?, severity=? WHERE id=?",
                              (i["title"], i["detail"], i["severity"], row["id"]))
                    escalated = row["severity"] == "warning" and i["severity"] == "critical"
                    row.update(title=i["title"], severity=i["severity"])
                    if escalated:
                        row["notified"] = 0  # a warning that turned critical is news again

        for rid, row in open_rows.items():
            if rid not in current:  # cleared
                self.db.x("UPDATE alerts SET ended=? WHERE id=?", (int(now), row["id"]))
                if row["notified"]:
                    took = _span(now - row["started"])
                    self._send(a.title, f"Resolved: {row['title']} (after {took})", "low", "white_check_mark")
                continue
            crit = row["severity"] == "critical"
            grace = a.grace_critical if crit else a.grace_warning
            if now - row["started"] < grace:
                continue
            if not row["notified"]:
                if quiet and not crit:
                    continue  # wait for morning
                if self._send(a.title, row["title"], "high" if crit else "default", "rotating_light" if crit else "warning"):
                    self.db.x("UPDATE alerts SET notified=? WHERE id=?", (int(now), row["id"]))
            elif crit and a.remind_hours and now - row["notified"] >= a.remind_hours * 3600:
                if self._send(a.title, f"Still: {row['title']}", "high", "rotating_light"):
                    self.db.x("UPDATE alerts SET notified=? WHERE id=?", (int(now), row["id"]))

    def event(self, kind: str, detail: str = "") -> None:
        """One-off notifications for things that happen rather than persist (the public IP changing)."""
        if kind == "ip":
            self._send(self.cfg.alerts.title, "Public IP changed. Friends may need the new game server address.",
                       "default", "globe_with_meridians")

    def history(self, limit: int = 100) -> list[dict]:
        return [dict(r) for r in self.db.q(
            "SELECT * FROM alerts ORDER BY (ended IS NULL) DESC, started DESC LIMIT ?", (limit,))]


def heartbeat(url: str) -> bool:
    """One healthchecks.io ping. If they stop, healthchecks.io raises the alarm."""
    if not url:
        return False
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            r.read(64)
        return True
    except (OSError, urllib.error.URLError) as e:
        log.warning("heartbeat failed: %s", e)
        return False


def _span(s: float) -> str:
    s = int(s)
    if s < 120:
        return f"{s} s"
    if s < 7200:
        return f"{s // 60} min"
    if s < 172800:
        return f"{s // 3600} h"
    return f"{s // 86400} days"
