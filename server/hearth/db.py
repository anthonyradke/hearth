"""SQLite history. Raw samples are kept 48 h; 5-minute rollups (avg/min/max) are kept 90 days. Also events (game
joins, state changes), the action audit log, alerts and a small key-value store for things remembered across
restarts (last seen versions, the public IP)."""
from __future__ import annotations
import json, os, sqlite3, threading, time

SCHEMA = """
CREATE TABLE IF NOT EXISTS raw(ts INTEGER NOT NULL, key TEXT NOT NULL, value REAL NOT NULL);
CREATE INDEX IF NOT EXISTS raw_key_ts ON raw(key, ts);
CREATE TABLE IF NOT EXISTS rollup(key TEXT NOT NULL, ts INTEGER NOT NULL, avg REAL NOT NULL, min REAL NOT NULL,
  max REAL NOT NULL, PRIMARY KEY(key, ts)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL,
  subject TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, who TEXT NOT NULL,
  action TEXT NOT NULL, target TEXT NOT NULL, result TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY, rule TEXT NOT NULL, severity TEXT NOT NULL,
  title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', started INTEGER NOT NULL, ended INTEGER,
  notified INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS alerts_open ON alerts(rule, ended);
"""

BUCKET = 300          # rollup width, seconds
RAW_KEEP = 48 * 3600
ROLLUP_KEEP = 90 * 86400

# range → (source table, bucket seconds). Picked so a chart gets roughly 120–360 points.
RANGES = {
    "1h": ("raw", 30), "6h": ("rollup", 300), "24h": ("rollup", 300), "7d": ("rollup", 1800),
    "30d": ("rollup", 7200), "90d": ("rollup", 21600),
}
SPAN = {"1h": 3600, "6h": 6 * 3600, "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400, "90d": 90 * 86400}


class DB:
    """One connection shared by the sampler and the API, serialized with a lock. Writes are tiny and rare
    (a few dozen rows every 30 s), so this is simpler than a pool and never contends in practice."""

    def __init__(self, path: str):
        if path != ":memory:":
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        self.con = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.con.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock:
            if path != ":memory:":
                self.con.execute("PRAGMA journal_mode=WAL")
            self.con.execute("PRAGMA synchronous=NORMAL")
            self.con.executescript(SCHEMA)

    def q(self, sql: str, args=()) -> list[sqlite3.Row]:
        with self.lock:
            return self.con.execute(sql, args).fetchall()

    def x(self, sql: str, args=()) -> int:
        with self.lock:
            return self.con.execute(sql, args).lastrowid

    # ---------- samples ----------
    def record(self, samples: dict[str, float], ts: int | None = None) -> None:
        ts = int(ts or time.time())
        rows = [(ts, k, float(v)) for k, v in samples.items() if v is not None]
        if rows:
            with self.lock:
                self.con.executemany("INSERT INTO raw(ts, key, value) VALUES(?,?,?)", rows)

    def rollup(self, now: int | None = None) -> None:
        """Folds finished 5-minute buckets from raw into rollup, then drops expired rows. Idempotent: a bucket
        is rewritten whole each time, so running it twice changes nothing."""
        now = int(now or time.time())
        done = now - now % BUCKET  # start of the current (unfinished) bucket
        with self.lock:
            last = self.con.execute("SELECT value FROM kv WHERE key='rollup_until'").fetchone()
            since = int(last[0]) if last else done - RAW_KEEP
            if since < done:
                self.con.execute("BEGIN")
                self.con.execute(
                    f"""INSERT OR REPLACE INTO rollup(key, ts, avg, min, max)
                        SELECT key, ts - ts % {BUCKET}, avg(value), min(value), max(value) FROM raw
                        WHERE ts >= ? AND ts < ? GROUP BY key, ts - ts % {BUCKET}""", (since, done))
                self.con.execute("INSERT OR REPLACE INTO kv VALUES('rollup_until', ?)", (str(done),))
                self.con.execute("COMMIT")
            self.con.execute("DELETE FROM raw WHERE ts < ?", (now - RAW_KEEP,))
            self.con.execute("DELETE FROM rollup WHERE ts < ?", (now - ROLLUP_KEEP,))
            self.con.execute("DELETE FROM events WHERE ts < ?", (now - ROLLUP_KEEP,))

    def history(self, key: str, rng: str, now: int | None = None) -> list[list[float]]:
        """[[ts, avg, min, max], …] oldest first, bucketed for the range."""
        table, width = RANGES[rng]
        now = int(now or time.time())
        start = now - SPAN[rng]
        if table == "raw":
            sql = f"""SELECT ts - ts % {width} AS b, avg(value), min(value), max(value) FROM raw
                      WHERE key=? AND ts >= ? GROUP BY b ORDER BY b"""
            rows = self.q(sql, (key, start))
            # The last hour may not be rolled up yet, so recent ranges always come from raw.
        else:
            sql = f"""SELECT ts - ts % {width} AS b, avg(avg), min(min), max(max) FROM rollup
                      WHERE key=? AND ts >= ? GROUP BY b ORDER BY b"""
            rows = self.q(sql, (key, start))
            tail = self.q(f"""SELECT ts - ts % {width} AS b, avg(value), min(value), max(value) FROM raw
                              WHERE key=? AND ts >= ? GROUP BY b ORDER BY b""",
                          (key, max(start, rows[-1][0] + width if rows else start)))
            rows = list(rows) + [r for r in tail if not rows or r[0] > rows[-1][0]]
        return [[r[0], round(r[1], 3), round(r[2], 3), round(r[3], 3)] for r in rows]

    def keys(self) -> list[str]:
        return [r[0] for r in self.q("SELECT DISTINCT key FROM raw")]

    # ---------- kv ----------
    def get(self, key: str, default=None):
        r = self.q("SELECT value FROM kv WHERE key=?", (key,))
        return json.loads(r[0][0]) if r else default

    def put(self, key: str, value) -> None:
        self.x("INSERT OR REPLACE INTO kv(key, value) VALUES(?, ?)", (key, json.dumps(value)))

    # ---------- events / audit ----------
    def event(self, kind: str, subject: str, detail: str = "", ts: int | None = None) -> None:
        self.x("INSERT INTO events(ts, kind, subject, detail) VALUES(?,?,?,?)",
               (int(ts or time.time()), kind, subject, detail))

    def events(self, limit: int = 100, before: int | None = None, kind: str | None = None) -> list[dict]:
        sql, args = "SELECT * FROM events WHERE 1=1", []
        if before:
            sql += " AND id < ?"; args.append(before)
        if kind:
            sql += " AND kind = ?"; args.append(kind)
        sql += " ORDER BY id DESC LIMIT ?"; args.append(limit)
        return [dict(r) for r in self.q(sql, args)]

    def audit(self, who: str, action: str, target: str, result: str, detail: str = "") -> int:
        return self.x("INSERT INTO audit(ts, who, action, target, result, detail) VALUES(?,?,?,?,?,?)",
                      (int(time.time()), who, action, target, result, detail))

    def audits(self, limit: int = 100, before: int | None = None) -> list[dict]:
        sql, args = "SELECT * FROM audit", []
        if before:
            sql += " WHERE id < ?"; args.append(before)
        sql += " ORDER BY id DESC LIMIT ?"; args.append(limit)
        return [dict(r) for r in self.q(sql, args)]
