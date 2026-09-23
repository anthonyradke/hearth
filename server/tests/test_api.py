import pytest
from fastapi.testclient import TestClient
from hearth.main import create_app

H = {"Authorization": "Bearer secret", "Tailscale-User-Login": "me@github"}


@pytest.fixture
def client(cfg, db):
    app = create_app(cfg, db, start=False)
    app.state.token = "secret"
    st = app.state.sampler.state
    st.system = {"hostname": "box", "disks": [{"mount": "/", "percent": 5}], "cpu": {"percent": 3}}
    st.games = [{"id": "vh", "kind": "valheim", "name": "World", "unit": "valheim", "address": "{public_ip}:2456",
                 "running": True, "health": "ok", "players": [{"name": "A", "id": "1"}]}]
    st.public_ip = {"ip": "203.0.113.9"}
    with TestClient(app) as c:
        yield c


def test_ping_is_open(client):
    assert client.get("/api/ping").json()["ok"] is True


def test_auth(client):
    assert client.get("/api/overview").status_code == 401
    assert client.get("/api/overview", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/api/overview", headers={"Authorization": "Bearer secret"}).status_code == 403
    bad = {**H, "Tailscale-User-Login": "someone@else"}
    assert client.get("/api/overview", headers=bad).status_code == 403
    assert client.get("/api/overview", headers=H).status_code == 200


def test_overview_and_games(client):
    o = client.get("/api/overview", headers=H).json()
    assert o["status"]["level"] == "ok" and o["host"]["hostname"] == "box"
    assert o["games"][0]["players"] == 1
    g = client.get("/api/games/vh", headers=H).json()
    assert g["address"] == "203.0.113.9:2456"
    assert client.get("/api/games/nope", headers=H).status_code == 404


def test_history(client, db):
    import time
    db.record({"cpu": 7}, ts=int(time.time()))
    r = client.get("/api/history?key=cpu&range=1h", headers=H).json()
    assert r["points"][0][1] == 7
    assert client.get("/api/history?key=cpu&range=2y", headers=H).status_code == 400
