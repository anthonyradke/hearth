import pytest
from fastapi.testclient import TestClient
from hearth import actions, config
from hearth.db import DB
from hearth.main import create_app

H = {"Authorization": "Bearer secret", "Tailscale-User-Login": "me@github"}
SID = "76561198000000001"


@pytest.fixture
def client(tmp_path, monkeypatch):
    (tmp_path / "adminlist.txt").write_text("// List admin players ID  ONE per line\n76561198000000009\n")
    cfg = config.parse({
        "owner": "me@github",
        "service": [{"unit": "valheim", "name": "Valheim", "actions": "full"},
                    {"unit": "tally", "name": "Tally", "actions": "restart"},
                    {"unit": "ssh", "name": "SSH", "actions": "none"}],
        "game": [{"id": "vh", "kind": "valheim", "name": "W", "unit": "valheim", "lists_dir": str(tmp_path)},
                 {"id": "mc", "kind": "minecraft", "name": "M", "unit": "minecraft", "rcon_port": 1, "rcon_password": "x"}],
    })
    calls = []
    monkeypatch.setattr(actions, "systemctl", lambda verb, unit: (calls.append((verb, unit)) or (True, "")))
    app = create_app(cfg, DB(":memory:"), start=False)
    app.state.token = "secret"
    app.state.sampler.refresh_services = lambda: None
    with TestClient(app) as c:
        c.calls, c.dir, c.db = calls, tmp_path, app.state.db
        yield c


def test_unit_actions_follow_config(client):
    assert client.post("/api/services/valheim/stop", headers=H).status_code == 200
    assert client.post("/api/services/tally/restart", headers=H).status_code == 200
    assert client.post("/api/services/tally/stop", headers=H).status_code == 403
    assert client.post("/api/services/ssh/restart", headers=H).status_code == 403
    assert client.post("/api/services/nope/restart", headers=H).status_code == 404
    assert client.post("/api/services/valheim/restart").status_code == 401
    assert client.calls == [("stop", "valheim"), ("restart", "tally")]
    assert [a["action"] for a in client.db.audits()] == ["restart", "stop"]


def test_valheim_lists(client):
    r = client.get("/api/games/vh/lists", headers=H).json()
    assert [x["id"] for x in r["lists"]["admin"]] == ["76561198000000009"]
    assert r["lists"]["banned"] == []
    assert client.post("/api/games/vh/lists/admin", headers=H, json={"id": "nope"}).status_code == 400
    r = client.post("/api/games/vh/lists/admin", headers=H, json={"id": SID}).json()
    assert [x["id"] for x in r["lists"]["admin"]] == ["76561198000000009", SID]
    text = (client.dir / "adminlist.txt").read_text()
    assert text.startswith("// List admin players") and text.endswith(SID + "\n")
    r = client.delete(f"/api/games/vh/lists/admin/76561198000000009", headers=H).json()
    assert [x["id"] for x in r["lists"]["admin"]] == [SID]
    client.post("/api/games/vh/lists/banned", headers=H, json={"id": SID})
    assert (client.dir / "bannedlist.txt").read_text() == SID + "\n"
    assert client.get("/api/games/mc/lists", headers=H).status_code == 400


def test_rcon_refuses_valheim(client):
    assert client.post("/api/games/vh/rcon", headers=H, json={"command": "list"}).status_code == 400
