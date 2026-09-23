def test_rollup_and_history(db):
    t0 = 1_000_000_200  # bucket-aligned (divisible by 300)
    for i in range(20):  # 10 minutes of 30 s samples
        db.record({"cpu": i}, ts=t0 + i * 30)
    db.rollup(now=t0 + 600)
    rows = db.q("SELECT ts, avg, min, max FROM rollup WHERE key='cpu' ORDER BY ts")
    assert [tuple(r) for r in rows] == [(t0, 4.5, 0, 9), (t0 + 300, 14.5, 10, 19)]
    db.rollup(now=t0 + 600)  # idempotent
    assert len(db.q("SELECT * FROM rollup")) == 2
    h = db.history("cpu", "24h", now=t0 + 600)
    assert [p[0] for p in h] == [t0, t0 + 300]
    h1 = db.history("cpu", "1h", now=t0 + 600)
    assert len(h1) == 20 and h1[0][1] == 0


def test_history_includes_unrolled_tail(db):
    t0 = 1_000_000_200
    db.record({"ram": 50}, ts=t0)
    db.rollup(now=t0 + 300)
    db.record({"ram": 70}, ts=t0 + 310)  # not rolled up yet
    h = db.history("ram", "24h", now=t0 + 320)
    assert [p[1] for p in h] == [50, 70]


def test_expiry(db):
    db.record({"cpu": 1}, ts=1000)
    db.rollup(now=1000 + 49 * 3600)
    assert db.q("SELECT count(*) FROM raw")[0][0] == 0


def test_kv_events_audit(db):
    db.put("x", {"a": 1})
    assert db.get("x") == {"a": 1} and db.get("nope", 5) == 5
    db.event("join", "vh", "Someone")
    assert db.events()[0]["detail"] == "Someone"
    db.audit("me", "restart", "valheim", "ok")
    assert db.audits()[0]["action"] == "restart"
