"""Unit state, memory and CPU from `systemctl show`, and recent journal lines."""
from __future__ import annotations
import glob, json, subprocess, time

PROPS = ["Id", "Description", "ActiveState", "SubState", "UnitFileState", "Type", "MemoryCurrent", "CPUUsageNSec",
         "ActiveEnterTimestamp", "ActiveExitTimestamp", "NRestarts", "Result", "MainPID", "InvocationID",
         "NextElapseUSecRealtime", "LastTriggerUSec", "Unit"]


def parse_show(text: str) -> list[dict[str, str]]:
    """`systemctl show a b c` prints one block per unit, separated by blank lines, in argument order."""
    blocks, cur = [], {}
    for line in text.splitlines():
        if not line.strip():
            if cur:
                blocks.append(cur)
                cur = {}
            continue
        k, _, v = line.partition("=")
        cur[k] = v
    if cur:
        blocks.append(cur)
    return blocks


def _int(v: str | None) -> int | None:
    if v is None or v in ("", "[not set]") or not v.lstrip("-").isdigit():
        return None
    n = int(v)
    return None if n >= 2**63 - 1 or n < 0 else n  # "infinity" comes back as UINT64_MAX


def _ts(v: str | None) -> int | None:
    """--timestamp=unix gives "@1789438933"; empty or 0 means never."""
    if not v or not v.startswith("@"):
        return None
    n = int(v[1:])
    return n or None


def cgroup_usage(pattern: str) -> tuple[int | None, int | None]:
    """(memory bytes, cpu nanoseconds) summed over the cgroups matching the glob."""
    mem = cpu = None
    for path in glob.glob(pattern):
        try:
            with open(f"{path}/memory.current") as f:
                mem = (mem or 0) + int(f.read())
            with open(f"{path}/cpu.stat") as f:
                for line in f:
                    if line.startswith("usage_usec"):
                        cpu = (cpu or 0) + int(line.split()[1]) * 1000
        except (OSError, ValueError):
            continue
    return mem, cpu


def normalize(b: dict[str, str]) -> dict:
    return {
        "unit": b.get("Id", ""),
        "description": b.get("Description", ""),
        "active": b.get("ActiveState", "unknown"),
        "sub": b.get("SubState", ""),
        "enabled": b.get("UnitFileState", ""),
        "type": b.get("Type", "timer" if b.get("Id", "").endswith(".timer") else ""),
        "memory": _int(b.get("MemoryCurrent")),
        "cpu_ns": _int(b.get("CPUUsageNSec")),
        "since": _ts(b.get("ActiveEnterTimestamp")) if b.get("ActiveState") == "active"
        else _ts(b.get("ActiveExitTimestamp")),
        "restarts": _int(b.get("NRestarts")) or 0,
        "result": b.get("Result", ""),
        "pid": _int(b.get("MainPID")) or None,
        "invocation": b.get("InvocationID") or None,
        "next_run": _ts(b.get("NextElapseUSecRealtime")),
        "last_run": _ts(b.get("LastTriggerUSec")),
        "triggers": b.get("Unit") or None,
    }


def expected_active(s: dict) -> bool:
    """A unit should be running if it's enabled and isn't a oneshot (oneshots finish and go inactive)."""
    return s["enabled"] in ("enabled", "static", "enabled-runtime") and s["type"] != "oneshot"


def health(s: dict) -> str:
    """ok | stopped | down | failed | starting. stopped = off on purpose (disabled); down = should be running."""
    if s["active"] == "failed":
        return "failed"
    if s["active"] in ("activating", "reloading", "deactivating"):
        return "starting" if s["active"] != "deactivating" else "stopping"
    if s["active"] == "active":
        return "ok"
    return "down" if expected_active(s) else "stopped"


class Services:
    def __init__(self, services):
        self.services = services
        self.prev_cpu: dict[str, tuple[float, int]] = {}

    def collect(self) -> tuple[list[dict], dict[str, float]]:
        units = [s.unit for s in self.services]
        if not units:
            return [], {}
        out = subprocess.run(["systemctl", "show", *units, "--timestamp=unix", "-p", ",".join(PROPS)],
                             capture_output=True, text=True, timeout=10)
        now = time.time()
        blocks = parse_show(out.stdout)
        result, samples = [], {}
        for svc, b in zip(self.services, blocks):
            s = normalize(b)
            if svc.cgroup:
                mem, cpu = cgroup_usage(svc.cgroup)
                if mem is not None:
                    s["memory"], s["cpu_ns"] = mem, cpu
            s["cpu"] = None
            if s["cpu_ns"] is not None:
                prev = self.prev_cpu.get(svc.unit)
                if prev and now > prev[0] and s["cpu_ns"] >= prev[1]:
                    s["cpu"] = round(100 * (s["cpu_ns"] - prev[1]) / 1e9 / (now - prev[0]), 1)
                self.prev_cpu[svc.unit] = (now, s["cpu_ns"])
            s.update(unit=svc.unit, name=svc.name, group=svc.group, actions=svc.actions, health=health(s))
            del s["cpu_ns"]
            result.append(s)
            if s["memory"] is not None:
                samples[f"mem:{svc.unit}"] = s["memory"]
            if s["cpu"] is not None:
                samples[f"cpu:{svc.unit}"] = s["cpu"]
        return result, samples


def journal(unit: str, lines: int = 80, invocation: str | None = None) -> list[dict]:
    """Recent journal lines for a unit: [{ts, priority, message}] oldest first. For a timer, its service."""
    if unit.endswith(".timer"):
        unit = unit[:-6] + ".service"
    args = ["journalctl", "-u", unit, "-n", str(lines), "-o", "json", "--no-pager", "-q",
            "--output-fields=MESSAGE,PRIORITY"]
    try:
        out = subprocess.run(args, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return []
    rows = []
    for line in out.stdout.splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        msg = e.get("MESSAGE")
        if isinstance(msg, list):  # binary messages come back as byte arrays
            msg = bytes(msg).decode("utf8", "replace")
        rows.append({"ts": int(e.get("__REALTIME_TIMESTAMP", 0)) // 1_000_000,
                     "priority": int(e.get("PRIORITY", 6)), "message": msg or ""})
    return rows
