"""The RCON client against a small fake Minecraft RCON server."""
import socket, struct, threading

import pytest

from hearth import rcon


def _packet(rid: int, kind: int, body: str) -> bytes:
    payload = struct.pack("<ii", rid, kind) + body.encode() + b"\x00\x00"
    return struct.pack("<i", len(payload)) + payload


def _read(conn: socket.socket):
    head = conn.recv(4, socket.MSG_WAITALL)
    if len(head) < 4:
        return None
    data = conn.recv(struct.unpack("<i", head)[0], socket.MSG_WAITALL)
    rid, kind = struct.unpack("<ii", data[:8])
    return rid, kind, data[8:-2].decode()


class FakeServer:
    """Answers logins with the password check and commands through `reply(rid, command) -> [packets]`."""

    def __init__(self, reply, password="pw"):
        self.reply, self.password = reply, password
        self.commands: list[str] = []
        self.connections = 0
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen()
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            self.connections += 1
            threading.Thread(target=self._client, args=(conn,), daemon=True).start()

    def _client(self, conn):
        with conn:
            while (pkt := _read(conn)) is not None:
                rid, kind, body = pkt
                if kind == rcon.LOGIN:
                    conn.sendall(_packet(rid if body == self.password else -1, 2, ""))
                    continue
                self.commands.append(body)
                for p in self.reply(rid, body):
                    conn.sendall(p)

    def close(self):
        self.sock.close()


@pytest.fixture
def server(request):
    s = FakeServer(request.param)
    yield s
    s.close()


@pytest.mark.parametrize("server", [lambda rid, cmd: [_packet(rid, 0, f"ran {cmd}\n")]], indirect=True)
def test_command(server):
    with rcon.Rcon("127.0.0.1", server.port, "pw") as c:
        assert c.command("list") == "ran list"
        assert c.command("seed") == "ran seed"


@pytest.mark.parametrize("server", [lambda rid, cmd: []], indirect=True)
def test_bad_password(server):
    with pytest.raises(rcon.RconError):
        rcon.Rcon("127.0.0.1", server.port, "wrong")


@pytest.mark.parametrize("server", [lambda rid, cmd: [_packet(rid - 1, 0, "stale"), _packet(rid, 0, "fresh")]],
                         indirect=True)
def test_skips_replies_to_other_requests(server):
    with rcon.Rcon("127.0.0.1", server.port, "pw") as c:
        assert c.command("list") == "fresh"


@pytest.mark.parametrize("server", [lambda rid, cmd: [_packet(rid, 0, "a" * 4096), _packet(rid, 0, "b")]],
                         indirect=True)
def test_long_reply_in_several_packets(server):
    with rcon.Rcon("127.0.0.1", server.port, "pw") as c:
        assert c.command("help") == "a" * 4096 + "b"


@pytest.mark.parametrize("server", [lambda rid, cmd: []], indirect=True)  # never answers: a lagging server
def test_timed_out_command_is_not_sent_again(server, monkeypatch):
    real = rcon.Rcon.__init__
    monkeypatch.setattr(rcon.Rcon, "__init__", lambda self, h, p, pw, timeout=5: real(self, h, p, pw, timeout=0.3))
    pool = rcon.Pool()
    with pytest.raises(TimeoutError):
        pool.command(server.port, "pw", "list")
    assert server.commands == ["list"]
    assert server.connections == 1


def test_broken_connection_is_replaced_once():
    calls = []

    def reply(rid, cmd):
        calls.append(cmd)
        return [_packet(rid, 0, "ok")]

    server = FakeServer(reply)
    try:
        pool = rcon.Pool()
        assert pool.command(server.port, "pw", "list") == "ok"
        pool.conns[("127.0.0.1", server.port)].sock.close()  # the server restarted, say
        assert pool.command(server.port, "pw", "list") == "ok"
        assert server.connections == 2
    finally:
        server.close()
