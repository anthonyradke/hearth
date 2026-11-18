"""Disk health from SMART. Reading SMART needs root, so a separate root timer (hearth-smart.timer, written by install.sh)
saves `smartctl --json` output for each configured device into smart_dir, and Hearth only parses those files. A disk
that was asleep when the timer ran keeps its previous file (smartctl -n standby doesn't wake it)."""
from __future__ import annotations
import json, os

# ATA attributes worth watching: a non-zero raw value on any of these means the disk is starting to fail.
ATA_BAD = {5: "reallocated", 197: "pending", 198: "uncorrectable"}


def device_file(smart_dir: str, device: str) -> str:
    return os.path.join(smart_dir, os.path.basename(device) + ".json")


def parse(d: dict) -> dict:
    """smartctl --json → the handful of fields the app shows and the rules check."""
    dev = d.get("device") or {}
    nvme = d.get("nvme_smart_health_information_log")
    out = {
        "device": dev.get("name"),
        "kind": "nvme" if nvme is not None else "ata",
        "model": d.get("model_name"),
        "passed": (d.get("smart_status") or {}).get("passed"),
        "temp": (d.get("temperature") or {}).get("current"),
        "power_on_hours": (d.get("power_on_time") or {}).get("hours"),
        "size": (d.get("user_capacity") or {}).get("bytes") or d.get("nvme_total_capacity"),
    }
    if nvme is not None:
        out.update(percent_used=nvme.get("percentage_used"), available_spare=nvme.get("available_spare"),
                   media_errors=nvme.get("media_errors"), critical_warning=nvme.get("critical_warning"),
                   unsafe_shutdowns=nvme.get("unsafe_shutdowns"))
    else:
        attrs = {a.get("id"): a for a in (d.get("ata_smart_attributes") or {}).get("table", [])}
        for aid, key in ATA_BAD.items():
            raw = ((attrs.get(aid) or {}).get("raw") or {}).get("value")
            out[key] = raw if isinstance(raw, int) else None
    return out


def collect(smart_dir: str, devices: list[str]) -> list[dict]:
    out = []
    for dev in devices:
        path = device_file(smart_dir, dev)
        try:
            with open(path) as f:
                s = parse(json.load(f))
            s["checked"] = int(os.stat(path).st_mtime)
        except (OSError, ValueError) as e:
            s = {"device": dev, "error": "no SMART data yet" if isinstance(e, FileNotFoundError) else str(e)}
        s["device"] = s.get("device") or dev
        out.append(s)
    return out
