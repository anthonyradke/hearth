"""CPU, memory, disks, temperatures, network, battery and uptime, from /proc, /sys and `sensors -j`; NVIDIA GPUs from
`nvidia-smi`; disk health from the files hearth-smart.timer writes (smart.py)."""
from __future__ import annotations
import json, os, platform, shutil, socket, subprocess, time
from . import smart as smart_mod

GPU_FIELDS = ["name", "temperature.gpu", "utilization.gpu", "memory.used", "memory.total", "power.draw",
              "power.limit", "fan.speed"]


def read(path: str, default: str = "") -> str:
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return default


def parse_stat(text: str) -> dict[str, tuple[int, int]]:
    """/proc/stat → {"cpu": (busy, total), "cpu0": …}. iowait counts as idle."""
    out = {}
    for line in text.splitlines():
        if not line.startswith("cpu"):
            break
        name, *vals = line.split()
        v = [int(x) for x in vals[:8]]
        idle = v[3] + v[4]
        total = sum(v)
        out[name] = (total - idle, total)
    return out


def cpu_percent(prev: dict, cur: dict) -> dict[str, float]:
    out = {}
    for k, (busy, total) in cur.items():
        if k in prev:
            db, dt = busy - prev[k][0], total - prev[k][1]
            out[k] = round(100 * db / dt, 1) if dt > 0 else 0.0
    return out


def parse_meminfo(text: str) -> dict[str, int]:
    out = {}
    for line in text.splitlines():
        k, _, rest = line.partition(":")
        parts = rest.split()
        if parts:
            out[k] = int(parts[0]) * 1024
    return out


def parse_net_dev(text: str) -> dict[str, tuple[int, int]]:
    out = {}
    for line in text.splitlines()[2:]:
        name, _, rest = line.partition(":")
        v = rest.split()
        if len(v) >= 9:
            out[name.strip()] = (int(v[0]), int(v[8]))
    return out


def default_iface(route_text: str) -> str | None:
    for line in route_text.splitlines()[1:]:
        f = line.split()
        if len(f) > 2 and f[1] == "00000000":
            return f[0]
    return None


def parse_sensors(data: dict) -> dict:
    """`sensors -j` → the CPU package temp, the hottest core, other named sensors, and fans."""
    cpu = None
    cores = []
    others = []
    fans = []
    for chip, feats in data.items():
        if not isinstance(feats, dict):
            continue
        for label, vals in feats.items():
            if not isinstance(vals, dict):
                continue
            for k, v in vals.items():
                if k.endswith("_input") and k.startswith("temp") and isinstance(v, (int, float)) and v > 0:
                    if chip.startswith("coretemp") and label.startswith("Package"):
                        cpu = v
                    elif chip.startswith("coretemp") and label.startswith("Core"):
                        cores.append(v)
                    elif chip.startswith("nvme"):
                        others.append({"name": "SSD", "c": round(v, 1)})
                    elif chip.startswith("k10temp") and label in ("Tctl", "Tdie"):
                        cpu = v
                elif k.startswith("fan") and k.endswith("_input") and isinstance(v, (int, float)):
                    fans.append({"name": f"Fan {len(fans) + 1}", "rpm": int(v)})
    if cpu is None and cores:
        cpu = max(cores)
    return {"cpu": cpu, "cores_max": max(cores) if cores else None, "others": others, "fans": fans}


def os_name() -> str:
    for line in read("/etc/os-release").splitlines():
        if line.startswith("PRETTY_NAME="):
            return line.split("=", 1)[1].strip('"')
    return platform.system()


def battery(base: str = "/sys/class/power_supply") -> dict | None:
    try:
        names = os.listdir(base)
    except OSError:
        return None
    bat = next((n for n in names if n.startswith("BAT")), None)
    if not bat:
        return None
    ac = None
    for n in names:
        if read(f"{base}/{n}/type").strip() == "Mains":
            ac = read(f"{base}/{n}/online").strip() == "1"
    cap = read(f"{base}/{bat}/capacity").strip()
    power = read(f"{base}/{bat}/power_now").strip()
    return {
        "percent": int(cap) if cap.isdigit() else None,
        "status": read(f"{base}/{bat}/status").strip() or None,  # Charging, Discharging, Not charging, Full
        "ac": ac,
        "watts": round(int(power) / 1e6, 1) if power.isdigit() else None,
        "health": _health(base, bat),
    }


def _health(base: str, bat: str) -> float | None:
    for full, design in (("energy_full", "energy_full_design"), ("charge_full", "charge_full_design")):
        f, d = read(f"{base}/{bat}/{full}").strip(), read(f"{base}/{bat}/{design}").strip()
        if f.isdigit() and d.isdigit() and int(d):
            return round(100 * int(f) / int(d), 1)
    return None


def vnstat(iface: str) -> dict | None:
    """Today's and this month's totals for the interface, if vnstat tracks it."""
    try:
        out = subprocess.run(["vnstat", "--json", "d", "1", "-i", iface], capture_output=True, text=True, timeout=5)
        day = json.loads(out.stdout)["interfaces"][0]["traffic"]["day"]
        out = subprocess.run(["vnstat", "--json", "m", "1", "-i", iface], capture_output=True, text=True, timeout=5)
        month = json.loads(out.stdout)["interfaces"][0]["traffic"]["month"]
        return {"today": {"rx": day[0]["rx"], "tx": day[0]["tx"]} if day else None,
                "month": {"rx": month[0]["rx"], "tx": month[0]["tx"]} if month else None}
    except (OSError, ValueError, KeyError, IndexError, subprocess.TimeoutExpired):
        return None


def _num(v: str) -> float | None:
    try:
        return float(v)
    except ValueError:
        return None  # "[N/A]", "[Not Supported]"


def parse_gpus(text: str) -> list[dict]:
    """`nvidia-smi --query-gpu=<GPU_FIELDS> --format=csv,noheader,nounits` → one dict per GPU. Memory in bytes."""
    out = []
    for line in text.strip().splitlines():
        f = [x.strip() for x in line.split(",")]
        if len(f) != len(GPU_FIELDS):
            continue
        name, temp, util, used, total, watts, limit, fan = f
        mib = 1024 * 1024
        out.append({"name": name, "temp": _num(temp), "util": _num(util),
                    "mem_used": int(_num(used) * mib) if _num(used) is not None else None,
                    "mem_total": int(_num(total) * mib) if _num(total) is not None else None,
                    "watts": _num(watts), "watts_limit": _num(limit), "fan": _num(fan)})
    return out


def gpus() -> list[dict] | None:
    """None when there's no NVIDIA driver; [] when nvidia-smi is there but didn't answer."""
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        out = subprocess.run([exe, f"--query-gpu={','.join(GPU_FIELDS)}", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return []
    return parse_gpus(out.stdout) if out.returncode == 0 else []


class System:
    """Stateful: CPU and network rates need the previous reading."""

    def __init__(self, disks: list[str], smart: list[str] | None = None, smart_dir: str = ""):
        self.disks = disks
        self.smart, self.smart_dir = smart or [], smart_dir
        self.prev_stat: dict = {}
        self.prev_net: tuple[float, tuple[int, int]] | None = None
        self.static = {"hostname": socket.gethostname(), "os": os_name(), "kernel": platform.release(),
                       "cores": os.cpu_count()}

    def collect(self) -> tuple[dict, dict[str, float]]:
        now = time.time()
        stat = parse_stat(read("/proc/stat"))
        pct = cpu_percent(self.prev_stat, stat)
        self.prev_stat = stat
        per_core = [pct[k] for k in sorted((k for k in pct if k != "cpu"), key=lambda k: int(k[3:]))]

        mem = parse_meminfo(read("/proc/meminfo"))
        total, avail = mem.get("MemTotal", 0), mem.get("MemAvailable", 0)
        st, sf = mem.get("SwapTotal", 0), mem.get("SwapFree", 0)
        load = [float(x) for x in read("/proc/loadavg", "0 0 0").split()[:3]]

        disks = []
        for mount in self.disks:
            try:
                v = os.statvfs(mount)
            except OSError:
                continue
            size, free = v.f_blocks * v.f_frsize, v.f_bavail * v.f_frsize
            used = size - v.f_bfree * v.f_frsize
            disks.append({"mount": mount, "size": size, "used": used, "free": free,
                          "percent": round(100 * used / (used + free), 1) if used + free else 0})

        try:
            out = subprocess.run(["sensors", "-j"], capture_output=True, text=True, timeout=5)
            temps = parse_sensors(json.loads(out.stdout or "{}"))
        except (OSError, ValueError, subprocess.TimeoutExpired):
            temps = {"cpu": None, "cores_max": None, "others": [], "fans": []}

        iface = default_iface(read("/proc/net/route"))
        net = {"iface": iface, "rx_rate": None, "tx_rate": None}
        counters = parse_net_dev(read("/proc/net/dev")).get(iface) if iface else None
        if counters:
            if self.prev_net and now > self.prev_net[0]:
                dt = now - self.prev_net[0]
                net["rx_rate"] = max(0, round((counters[0] - self.prev_net[1][0]) / dt))
                net["tx_rate"] = max(0, round((counters[1] - self.prev_net[1][1]) / dt))
            self.prev_net = (now, counters)
            net["rx_total"], net["tx_total"] = counters

        uptime = float(read("/proc/uptime", "0").split()[0])
        bat = battery()
        gpu = gpus()
        snap = {
            **self.static,
            "ts": int(now),
            "uptime": int(uptime),
            "boot": int(now - uptime),
            "cpu": {"percent": pct.get("cpu"), "per_core": per_core, "load": load},
            "memory": {"total": total, "available": avail, "used": total - avail,
                       "percent": round(100 * (total - avail) / total, 1) if total else None,
                       "swap_total": st, "swap_used": st - sf,
                       "swap_percent": round(100 * (st - sf) / st, 1) if st else 0},
            "disks": disks,
            "temps": temps,
            "network": net,
            "battery": bat,
            "gpus": gpu,
            "smart": smart_mod.collect(self.smart_dir, self.smart) if self.smart else None,
        }
        samples = {
            "cpu": pct.get("cpu"), "load1": load[0], "ram": snap["memory"]["percent"],
            "swap": snap["memory"]["swap_percent"], "temp": temps["cpu"],
            "net_rx": net["rx_rate"], "net_tx": net["tx_rate"],
        }
        for d in disks:
            samples["disk" if d["mount"] == "/" else f"disk:{d['mount']}"] = d["percent"]
        if bat and bat["percent"] is not None:
            samples["battery"] = bat["percent"]
        if gpu:
            g = gpu[0]
            samples.update(gpu=g["util"], gpu_temp=g["temp"],
                           gpu_mem=round(100 * g["mem_used"] / g["mem_total"], 1)
                           if g["mem_used"] is not None and g["mem_total"] else None)
        return snap, samples
