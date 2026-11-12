import time
from hearth import rules
from hearth.sampler import State


def svc(unit, health, name=None):
    return {"unit": unit, "name": name or unit, "health": health, "active": "failed" if health == "failed" else
            "inactive", "sub": "dead"}


def ids(issues):
    return [i["id"] for i in issues]


def test_all_good(cfg, db):
    st = State(system={"disks": [{"mount": "/", "percent": 10}], "temps": {"cpu": 50},
                       "battery": {"ac": True, "percent": 80}},
               services=[svc("ssh", "ok"), svc("minecraft2", "stopped")],
               pihole={"dns": True, "upstream": True}, backups={"available": True, "age_hours": 3,
                                                                  "backup": {"result": "ok"}})
    assert rules.evaluate(st, cfg, db) == []


def test_problems(cfg, db):
    now = time.time()
    st = State(system={"disks": [{"mount": "/", "percent": 96}], "temps": {"cpu": 95},
                       "battery": {"ac": False, "percent": 20}},
               services=[svc("valheim", "failed", "Valheim"), svc("ssh", "down")],
               tailscale={"state": "Running", "self": {"key_expiry": now + 3 * 86400}},
               pihole={"dns": False}, backups={"available": True, "age_hours": 50, "backup": {"result": "ok"},
                                               "drill": {"result": "failed", "error": "x"}})
    out = rules.evaluate(st, cfg, db, now)
    assert set(ids(out)) == {"unit:valheim", "unit:ssh", "disk:/", "temp", "power", "tailscale_key", "dns",
                             "backup", "backup_drill"}
    assert out[0]["severity"] == "critical"
    power = next(i for i in out if i["id"] == "power")
    assert power["title"] == "On battery, 20% left"


def test_backup_jobs(cfg, db):
    now = time.time()
    day = 86400
    st = State(backups={"available": True, "age_hours": 3,
                        "backup": {"result": "partial", "error": "mc: save-on failed"},
                        "frequent": {"result": "failed", "error": "repository locked"},
                        "check": {"result": "ok", "finished": now - 9 * day},
                        "drill": {"result": "running", "started": now - 40 * day}})
    out = {i["id"]: i for i in rules.evaluate(st, cfg, db, now)}
    assert set(out) == {"backup", "backup_frequent", "backup_check", "backup_drill"}
    assert out["backup"]["title"] == "Last backup was partial"
    assert out["backup_check"]["title"] == "No backup check for 9 days"
    assert out["backup_drill"]["title"] == "No backup drill for 40 days"

    st.backups.update(backup={"result": "ok"}, frequent={"result": "ok"},
                      check={"result": "ok", "finished": now - 2 * day},
                      drill={"result": "ok", "finished": now - 20 * day})
    assert rules.evaluate(st, cfg, db, now) == []


def test_ram_sustained(cfg, db):
    now = int(time.time())
    for i in range(10):
        db.record({"ram": 95}, ts=now - i * 30)
    assert "ram" in ids(rules.evaluate(State(), cfg, db, now))
    db.record({"ram": 50}, ts=now - 60)
    assert "ram" not in ids(rules.evaluate(State(), cfg, db, now))


def test_flapping(cfg, db):
    now = int(time.time())
    for i in range(3):
        db.event("service", "valheim", "restarted", ts=now - i * 60)
    out = rules.evaluate(State(services=[svc("valheim", "ok")]), cfg, db, now)
    assert ids(out) == ["flap:valheim"]
