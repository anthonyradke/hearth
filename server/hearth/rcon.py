"""Minimal Source RCON client, as Minecraft speaks it."""
from __future__ import annotations
import socket, struct, threading

LOGIN, CMD = 3, 2


class RconError(Exception):
    pass


class Rcon:
    def __init__(self, host: str, port: int, password: str, timeout: float = 5):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.timeout = timeout
        self.rid = 0
        if self._send(LOGIN, password) is None:
            self.close()
            raise RconError("authentication failed")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def _send(self, kind: int, body: str) -> str | None:
        self.rid += 1
        payload = struct.pack("<ii", self.rid, kind) + body.encode("utf8") + b"\x00\x00"
        self.sock.sendall(struct.pack("<i", len(payload)) + payload)
        out = ""
        while True:
            length = struct.unpack("<i", self._recv(4))[0]
            data = self._recv(length)
            resp_id = struct.unpack("<i", data[:4])[0]
            if resp_id == -1:
                return None
            out += data[8:-2].decode("utf8", "replace")
            # Long replies arrive as several packets; stop once nothing more is queued.
            self.sock.settimeout(0.2)
            try:
                more = self.sock.recv(1, socket.MSG_PEEK)
            except (socket.timeout, BlockingIOError):
                more = b""
            finally:
                self.sock.settimeout(self.timeout)
            if not more:
                return out

    def _recv(self, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise RconError("connection closed")
            buf += chunk
        return buf

    def command(self, line: str) -> str:
        r = self._send(CMD, line)
        return (r or "").strip()

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


class Pool:
    """One long-lived connection per server. Minecraft logs a "Thread RCON Client started / shutting down" pair for
    every connection, so reconnecting every minute would fill its log. Thread-safe: the sampler and the console share
    it. A broken connection is replaced once per command."""

    def __init__(self):
        self.conns: dict[tuple[str, int], Rcon] = {}
        self.locks: dict[tuple[str, int], threading.Lock] = {}
        self.guard = threading.Lock()

    def command(self, port: int, password: str, line: str, host: str = "127.0.0.1") -> str:
        key = (host, port)
        with self.guard:
            lock = self.locks.setdefault(key, threading.Lock())
        with lock:
            for attempt in (1, 2):
                conn = self.conns.get(key)
                try:
                    if conn is None:
                        conn = self.conns[key] = Rcon(host, port, password)
                    return conn.command(line)
                except (OSError, RconError):
                    if conn:
                        conn.close()
                    self.conns.pop(key, None)
                    if attempt == 2:
                        raise
        raise RconError("unreachable")

    def drop(self, port: int, host: str = "127.0.0.1") -> None:
        conn = self.conns.pop((host, port), None)
        if conn:
            conn.close()


pool = Pool()


def run(port: int, password: str, line: str, host: str = "127.0.0.1") -> str:
    return pool.command(port, password, line, host)
