"""Turns the current state into a list of issues. The same list drives the app's "All good / 2 issues" and, from
phase 3, the notifications. Titles stay vague on purpose (they end up in push messages): no IPs, no names."""
from __future__ import annotations
import time

CRIT, WARN = "critical", "warning"


def issue(rule: str, severity: str, title: str, detail: str = "", target: str | None = None) -> dict:
    return {"id": rule, "severity": severity, "title": title, "detail": detail, "target": target}


def evaluate(state, cfg, db, now: float | None = None) -> list[dict]:
    now = now or time.time()
    r = cfg.rules
    out: list[dict] = []
    sysm = state.system or {}

    # ---------- services ----------
    for s in state.services or []:
        if s["health"] in ("down", "failed"):
            out.append(issue(f"unit:{s['unit']}", CRIT, f"{s['name']} is {s['health']}",
                             f"{s['unit']} should be running but is {s['active']} ({s['sub']}).", s["unit"]))
        since = int(now - r.flap_minutes * 60)
        n = db.q("SELECT count(*) FROM events WHERE kind='service' AND subject=? AND ts>=? "
                 "AND detail IN ('ok','restarted')", (s["unit"], since))[0][0]
        if n >= r.flap_restarts:
            out.append(issue(f"flap:{s['unit']}", WARN, f"{s['name']} keeps restarting",
                             f"Started {n} times in the last {int(r.flap_minutes)} minutes.", s["unit"]))

    # ---------- disk, memory, temperature ----------
    for d in sysm.get("disks", []):
        if d["percent"] >= r.disk_crit:
            out.append(issue(f"disk:{d['mount']}", CRIT, f"Disk {d['percent']:.0f}% full", d["mount"], "system"))
        elif d["percent"] >= r.disk_warn:
            out.append(issue(f"disk:{d['mount']}", WARN, f"Disk {d['percent']:.0f}% full", d["mount"], "system"))
    ram = db.q("SELECT count(*), min(value) FROM raw WHERE key='ram' AND ts>=?", (int(now - r.ram_minutes * 60),))
    if ram and ram[0][0] >= 3 and ram[0][1] is not None and ram[0][1] > r.ram_pct:
        out.append(issue("ram", WARN, f"Memory above {r.ram_pct:.0f}%",
                         f"For the last {int(r.ram_minutes)} minutes.", "system"))
    temp = (sysm.get("temps") or {}).get("cpu")
    if temp is not None and temp > r.temp_c:
        out.append(issue("temp", WARN, f"CPU at {temp:.0f} °C", "", "system"))

    # ---------- power (the battery is the UPS) ----------
    bat = sysm.get("battery")
    if bat and bat.get("ac") is False:
        pct = bat.get("percent")
        if pct is not None and pct < r.battery_low:
            out.append(issue("power", CRIT, f"On battery, {pct}% left", "The power is out or unplugged.", "system"))
        else:
            out.append(issue("power", CRIT, "Running on battery", "The power is out or unplugged.", "system"))

    # ---------- network ----------
    ts = state.tailscale or {}
    if ts and ts.get("state") not in (None, "Running"):
        out.append(issue("tailscale", WARN, "Tailscale isn't running", str(ts.get("state")), "network"))
    exp = ((ts.get("self") or {}).get("key_expiry"))
    if exp and exp - now < r.tailscale_expiry_days * 86400:
        days = max(0, int((exp - now) // 86400))
        out.append(issue("tailscale_key", WARN, f"Tailscale key expires in {days} days",
                         "Disable key expiry for this machine in the admin console.", "network"))
    ph = state.pihole or {}
    if ph and ph.get("dns") is False:
        out.append(issue("dns", CRIT, "Pi-hole isn't answering DNS", "The whole house has no DNS.", "network"))
    elif ph and ph.get("upstream") is False:
        out.append(issue("dns_upstream", WARN, "DNS can't reach the upstream", "Local names work, the internet doesn't.",
                         "network"))
    elif ph and ph.get("configured") and ph.get("blocking") == "disabled":
        out.append(issue("dns_blocking", WARN, "Pi-hole blocking is off", "", "network"))

    # ---------- backups ----------
    b = state.backups or {}
    if b.get("available"):
        last = (b.get("backup") or {})
        if last.get("result") == "failed":
            out.append(issue("backup", CRIT, "Last backup failed", last.get("error") or "", "backups"))
        elif b.get("age_hours") is not None and b["age_hours"] > r.backup_max_age_hours:
            out.append(issue("backup", WARN, f"No backup for {b['age_hours']:.0f} hours", "", "backups"))
        for job in ("check", "drill"):
            if (b.get(job) or {}).get("result") == "failed":
                out.append(issue(f"backup_{job}", WARN, f"Backup {job} failed", b[job].get("error") or "", "backups"))
    elif b:
        out.append(issue("backup", WARN, "Backup status unreadable", b.get("error", ""), "backups"))

    order = {CRIT: 0, WARN: 1}
    return sorted(out, key=lambda i: order.get(i["severity"], 2))
