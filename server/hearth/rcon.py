"""Minimal Source RCON client, as Minecraft speaks it."""
from __future__ import annotations
import socket, struct

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


def run(port: int, password: str, line: str, host: str = "127.0.0.1") -> str:
    with Rcon(host, port, password) as r:
        return r.command(line)
