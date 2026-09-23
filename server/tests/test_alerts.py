from hearth import config
from hearth.alerts import Alerts, in_quiet
from hearth.db import DB

T0 = 1_790_000_000  # 2026-09-21 13:33 UTC


class Fake:
    configured = True

    def __init__(self):
        self.sent = []

    def send(self, title, message, priority="default", tags=""):
        self.sent.append((message, priority))


def make(**alerts):
    cfg = config.parse({"alerts": {"grace_critical": 60, "grace_warning": 300, "remind_hours": 6, **alerts}})
    f = Fake()
    return Alerts(cfg, DB(":memory:"), sender=f), f


def crit(title="Valheim is down", rid="unit:valheim"):
    return {"id": rid, "severity": "critical", "title": title, "detail": "", "target": None}


def warn(title="Disk 86% full", rid="disk:/"):
    return {"id": rid, "severity": "warning", "title": title, "detail": "", "target": None}


def test_grace_then_once_then_recovery():
    a, f = make()
    a.step([crit()], T0)
    a.step([crit()], T0 + 30)
    assert f.sent == []  # a quick restart never pages
    a.step([crit()], T0 + 61)
    a.step([crit()], T0 + 120)
    assert f.sent == [("Valheim is down", "high")]
    a.step([], T0 + 200)
    assert f.sent[-1][0] == "Resolved: Valheim is down (after 3 min)"
    assert a.history()[0]["ended"] == T0 + 200


def test_blip_is_silent():
    a, f = make()
    a.step([crit()], T0)
    a.step([], T0 + 20)
    assert f.sent == []
    assert a.history()[0]["ended"] == T0 + 20


def test_reminder():
    a, f = make()
    a.step([crit()], T0)
    a.step([crit()], T0 + 61)
    a.step([crit()], T0 + 61 + 3600)
    assert len(f.sent) == 1
    a.step([crit()], T0 + 61 + 6 * 3600)
    assert f.sent[-1][0] == "Still: Valheim is down"


def test_escalation_and_rewording():
    a, f = make()
    a.step([warn()], T0)
    a.step([warn()], T0 + 301)
    assert f.sent == [("Disk 86% full", "default")]
    a.step([{**warn("Disk 96% full"), "severity": "critical"}], T0 + 400)
    assert f.sent[-1] == ("Disk 96% full", "high")
    assert len(a.history()) == 1


def test_quiet_hours_hold_warnings_not_critical():
    # 23:00-08:00 in UTC; T0 is 13:33 UTC, so shift to 02:00 UTC the next day.
    night = T0 + (24 - 13.55 + 2) * 3600
    a, f = make(quiet_hours="23:00-08:00", timezone="UTC")
    assert in_quiet(night, "23:00-08:00", "UTC") and not in_quiet(T0, "23:00-08:00", "UTC")
    a.step([warn(), crit()], night)
    a.step([warn(), crit()], night + 400)
    assert f.sent == [("Valheim is down", "high")]
    morning = night + 6.5 * 3600
    a.step([warn(), crit()], morning)
    assert ("Disk 86% full", "default") in f.sent


def test_warning_cleared_overnight_never_sent():
    night = T0 + (24 - 13.55 + 2) * 3600
    a, f = make(quiet_hours="23:00-08:00", timezone="UTC")
    a.step([warn()], night)
    a.step([warn()], night + 400)
    a.step([], night + 3600)
    assert f.sent == []
