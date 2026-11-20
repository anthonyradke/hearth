"""Turns the current state into a list of issues. The same list drives the app's "All good / 2 issues" and the
notifications. Titles stay vague on purpose (they end up in push messages): no IPs, no player names.

This machine's issues keep their plain ids ("ram", "disk:/"). A remote host's machine-level issues are prefixed with
its id ("h5:ram", "h5:unreachable"); its unit issues already carry the host in the unit id ("unit:h5/valheim.service").
Every issue says which host it's about, which is also the title of its push notification."""
from __future__ import annotations
import time

CRIT, WARN = "critical", "warning"


def issue(rule: str, severity: str, title: str, detail: str = "", target: str | None = None,
          host: str = "") -> dict:
    return {"id": rule, "severity": severity, "title": title, "detail": detail, "target": target, "host": host}


def machine(sysm: dict, services: list[dict], r, db, now: float, host: str = "") -> list[dict]:
    """Rules that apply to any machine: units, disks, memory, temperatures, GPU, disk health, power.
    host = "" for this machine, or the remote host's id."""
    out: list[dict] = []
    pre = f"{host}:" if host else ""
    key = (lambda k: f"{host}/{k}") if host else (lambda k: k)
    target = f"system:{host}" if host else "system"

    def add(rule: str, severity: str, title: str, detail: str = "", tgt: str | None = target):
        out.append(issue(pre + rule, severity, title, detail, tgt, host))

    # ---------- services (ids already carry the host) ----------
    for s in services:
        if s["health"] in ("down", "failed"):
            out.append(issue(f"unit:{s['unit']}", CRIT, f"{s['name']} is {s['health']}",
                             f"{s.get('systemd_unit') or s['unit']} should be running but is {s['active']} ({s['sub']}).",
                             s["unit"], host))
        since = int(now - r.flap_minutes * 60)
        n = db.q("SELECT count(*) FROM events WHERE kind='service' AND subject=? AND ts>=? "
                 "AND detail IN ('ok','restarted')", (s["unit"], since))[0][0]
        if n >= r.flap_restarts:
            out.append(issue(f"flap:{s['unit']}", WARN, f"{s['name']} keeps restarting",
                             f"Started {n} times in the last {int(r.flap_minutes)} minutes.", s["unit"], host))

    # ---------- disk, memory, temperature ----------
    for d in sysm.get("disks", []):
        if d["percent"] >= r.disk_crit:
            add(f"disk:{d['mount']}", CRIT, f"Disk {d['percent']:.0f}% full", d["mount"])
        elif d["percent"] >= r.disk_warn:
            add(f"disk:{d['mount']}", WARN, f"Disk {d['percent']:.0f}% full", d["mount"])
    ram = db.q("SELECT count(*), min(value) FROM raw WHERE key=? AND ts>=?", (key("ram"), int(now - r.ram_minutes * 60)))
    if ram and ram[0][0] >= 3 and ram[0][1] is not None and ram[0][1] > r.ram_pct:
        add("ram", WARN, f"Memory above {r.ram_pct:.0f}%", f"For the last {int(r.ram_minutes)} minutes.")
    temp = (sysm.get("temps") or {}).get("cpu")
    if temp is not None and temp > r.temp_c:
        add("temp", WARN, f"CPU at {temp:.0f} °C")
    for i, g in enumerate(sysm.get("gpus") or []):
        if g.get("temp") is not None and g["temp"] > r.gpu_temp_c:
            add(f"gpu_temp:{i}", WARN, f"GPU at {g['temp']:.0f} °C")

    # ---------- disk health (SMART) ----------
    for d in sysm.get("smart") or []:
        if d.get("error"):
            continue  # not read yet; the app shows it
        dev = d["device"]
        what = d.get("model") or dev
        if d.get("passed") is False:
            add(f"smart:{dev}", CRIT, "A disk failed its health check", what)
        elif d.get("critical_warning"):
            add(f"smart:{dev}", CRIT, "A disk reports a critical warning", f"{what}: code {d['critical_warning']}")
        elif any(d.get(k) for k in ("reallocated", "pending", "uncorrectable")):
            bad = ", ".join(f"{d[k]} {k}" for k in ("reallocated", "pending", "uncorrectable") if d.get(k))
            add(f"smart:{dev}", WARN, "A disk has bad sectors", f"{what}: {bad}")
        elif d.get("media_errors"):
            add(f"smart:{dev}", WARN, "A disk reports media errors", f"{what}: {d['media_errors']}")
        elif d.get("percent_used") is not None and d["percent_used"] >= r.ssd_wear_pct:
            add(f"smart:{dev}", WARN, f"SSD {d['percent_used']}% worn", what)

    # ---------- power (the battery is the UPS) ----------
    bat = sysm.get("battery")
    if bat and bat.get("ac") is False:
        pct = bat.get("percent")
        if pct is not None and pct < r.battery_low:
            add("power", CRIT, f"On battery, {pct}% left", "The power is out or unplugged.")
        else:
            add("power", CRIT, "Running on battery", "The power is out or unplugged.")
    return out


def remote(h: dict, hcfg, r, db, now: float, started: float) -> list[dict]:
    """A remote host: unreachable, or the machine rules on its last snapshot."""
    last = h.get("last_ok")
    if (last is None and now - started > hcfg.unreachable_seconds) or (last and now - last > hcfg.unreachable_seconds):
        # Everything else about it would be stale, so this one issue stands in for all of them.
        return [issue(f"{h['id']}:unreachable", CRIT, f"{h['name']} is unreachable", h.get("error") or "",
                      f"host:{h['id']}", h["id"])]
    if last is None:
        return []  # just started; give it a moment
    return (machine(h.get("system") or {}, h.get("services") or [], r, db, now, h["id"])
            + backups(h.get("backups") or {}, r, now, h["id"]))


def backups(b: dict, r, now: float, host: str = "") -> list[dict]:
    """cellar's status on one machine. host = "" for this machine; a remote host's ids get its prefix ("h5:backup")
    and its issues point at "backups:<host>"."""
    out: list[dict] = []
    pre = f"{host}:" if host else ""
    target = f"backups:{host}" if host else "backups"

    def add(rule: str, severity: str, title: str, detail: str = ""):
        out.append(issue(pre + rule, severity, title, detail, target, host))

    if not b.get("available"):
        if b:
            add("backup", WARN, "Backup status unreadable", b.get("error", ""))
        return out
    last = (b.get("backup") or {})
    if last.get("result") == "failed":
        add("backup", CRIT, "Last backup failed", last.get("error") or "")
    elif b.get("age_hours") is not None and b["age_hours"] > r.backup_max_age_hours:
        add("backup", WARN, f"No backup for {b['age_hours']:.0f} hours")
    elif last.get("result") == "partial":
        add("backup", WARN, "Last backup was partial", last.get("error") or "")
    if (b.get("frequent") or {}).get("result") == "failed":
        add("backup_frequent", WARN, "Half-hourly backup failed", b["frequent"].get("error") or "")
    for job, max_days in (("check", r.check_max_age_days), ("drill", r.drill_max_age_days)):
        j = b.get(job) or {}
        last_run = j.get("finished") or j.get("started")
        if j.get("result") == "failed":
            add(f"backup_{job}", WARN, f"Backup {job} failed", j.get("error") or "")
        elif last_run and now - last_run > max_days * 86400:
            add(f"backup_{job}", WARN, f"No backup {job} for {(now - last_run) / 86400:.0f} days")
    # The second, local copy (on the other machine's disk). Only warnings: the offsite copy still covers it.
    loc = b.get("local")
    if loc:
        lb = loc.get("backup") or {}
        if lb.get("result") == "failed":
            add("backup_local", WARN, "Local backup copy failed", lb.get("error") or "")
        elif loc.get("age_hours") is not None and loc["age_hours"] > r.backup_max_age_hours:
            add("backup_local", WARN, f"No local backup copy for {loc['age_hours']:.0f} hours")
        for job in ("frequent", "check", "drill"):
            if (loc.get(job) or {}).get("result") == "failed":
                add(f"backup_local_{job}", WARN, f"Local backup copy: {job} failed", loc[job].get("error") or "")
    return out


def network(state, r, now: float) -> list[dict]:
    out: list[dict] = []
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
    return out


def evaluate(state, cfg, db, now: float | None = None) -> list[dict]:
    now = now or time.time()
    r = cfg.rules
    out = machine(state.system or {}, state.services or [], r, db, now)
    out += network(state, r, now)
    out += backups(state.backups or {}, r, now)
    for h in cfg.hosts:
        if h.id in state.hosts:
            out += remote(state.hosts[h.id], h, r, db, now, state.started)
    for i in out:
        i["host"] = i["host"] or cfg.name
    order = {CRIT: 0, WARN: 1}
    return sorted(out, key=lambda i: order.get(i["severity"], 2))
