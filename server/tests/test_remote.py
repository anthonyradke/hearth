"""The agent on its own, and the server talking to it end to end (the server's HTTP client is pointed at the agent's
TestClient instead of the network)."""
import io, json, time, urllib.error
import pytest
from fastapi.testclient import TestClient
from hearth import actions, config, rules
from hearth.agent import create_agent
from hearth.alerts import Alerts
from hearth.db import DB
from hearth.main import create_app
from hearth.remote import sample_key

H = {"Authorization": "Bearer secret", "Tailscale-User-Login": "me@github"}
AH = {"Authorization": "Bearer agent-token"}


def svc(unit, name, health="ok", active="active", group="Games", actions_="none", inv="i1"):
    return {"unit": unit, "name": name, "group": group, "actions": actions_, "health": health, "active": active,
            "sub": "running" if active == "active" else "dead", "enabled": "enabled", "type": "simple",
            "memory": 1000, "cpu": 1.0, "since": 1, "restarts": 0, "result": "success", "pid": 5, "invocation": inv,
            "next_run": None, "last_run": None, "triggers": None, "description": name}


class FakeSystem:
    def collect(self):
        return ({"hostname": "h5", "os": "Ubuntu", "kernel": "7", "cores": 12, "uptime": 100, "boot": 1, "ts": 1,
                 "cpu": {"percent": 4.0, "per_core": [], "load": [0.1, 0.1, 0.1]},
                 "memory": {"percent": 20.0}, "disks": [{"mount": "/", "percent": 10.0},
                                                       {"mount": "/srv/data", "percent": 50.0}],
                 "temps": {"cpu": 50.0}, "gpus": [{"name": "GPU", "temp": 45.0, "util": 3.0}], "smart": [],
                 "battery": None},
                {"cpu": 4.0, "ram": 20.0, "disk": 10.0, "disk:/srv/data": 50.0, "gpu": 3.0})


class FakeServices:
    def __init__(self):
        self.list = [svc("mheynautics.service", "Mheynautics", actions_="full"), svc("ssh.service", "SSH",
                                                                                      group="Network")]

    def collect(self):
        return [dict(s) for s in self.list], {f"mem:{s['unit']}": 1000 for s in self.list}


class FakeGames:
    def __init__(self):
        self.pending = []

    def collect(self, units):
        ev, self.pending = self.pending, []
        g = {"id": "mheynautics", "kind": "minecraft", "name": "Mheynautics", "unit": "mheynautics.service",
             "address": "{public_ip}:25570", "running": True, "health": units["mheynautics.service"]["health"],
             "since": 1, "players": [{"name": "Steve"}], "max_players": 10, "version": "1.21.1", "error": None}
        return [g], {"players:mheynautics": 1}, ev


@pytest.fixture
def agent_cfg(tmp_path):
    (tmp_path / "token").write_text("agent-token\n")
    return config.parse({
        "role": "agent", "name": "h5",
        "agent": {"listen": "127.0.0.1:8011", "allow": ["testclient"], "token_file": str(tmp_path / "token")},
        "service": [{"unit": "mheynautics.service", "name": "Mheynautics", "actions": "full"},
                    {"unit": "ssh.service", "name": "SSH"}],
        "game": [{"id": "mheynautics", "kind": "minecraft", "name": "Mheynautics", "unit": "mheynautics.service",
                  "rcon_port": 25577, "rcon_password": "pw"},
                 {"id": "valheim", "kind": "valheim", "name": "V", "unit": "valheim.service",
                  "lists_dir": str(tmp_path)}],
    })


@pytest.fixture
def agent(agent_cfg):
    app = create_agent(agent_cfg, DB(":memory:"))
    a = app.state.agent
    a.system, a.services, a.games = FakeSystem(), FakeServices(), FakeGames()
    with TestClient(app) as c:
        c.agent = a
        yield c


def opener_for(client):
    """A urllib.request.urlopen stand-in that sends the request to a TestClient."""
    def open_(req, timeout=None):
        if getattr(client, "down", False):
            raise urllib.error.URLError("timed out")
        path = req.full_url.split("://", 1)[1]
        path = path[path.index("/"):]
        r = client.request(req.get_method(), path, headers=dict(req.header_items()), content=req.data)
        if r.status_code >= 400:
            raise urllib.error.HTTPError(req.full_url, r.status_code, r.reason_phrase, {}, io.BytesIO(r.content))
        return io.BytesIO(r.content)
    return open_


@pytest.fixture
def server(tmp_path, agent):
    (tmp_path / "h5.token").write_text("agent-token")
    cfg = config.parse({
        "owner": "me@github", "name": "x1",
        "service": [{"unit": "ssh", "name": "SSH", "group": "Network"}],
        "host": [{"id": "h5", "url": "http://h5.test:8011", "token_file": str(tmp_path / "h5.token")}],
    })
    app = create_app(cfg, DB(":memory:"), start=False)
    app.state.token = "secret"
    sampler = app.state.sampler
    sampler.remotes["h5"].open = opener_for(agent)
    sampler.state.system = {"hostname": "x1", "disks": [{"mount": "/", "percent": 5}], "ts": 1}
    sampler.state.services = []
    with TestClient(app) as c:
        c.app_, c.sampler, c.agent = app, sampler, agent
        yield c


# ---------- the agent alone ----------
def test_agent_auth(agent):
    assert agent.get("/agent/ping").json()["app"] == "hearth-agent"
    assert agent.get("/agent/snapshot").status_code == 401
    assert agent.get("/agent/snapshot", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert agent.get("/agent/snapshot", headers=AH).status_code == 200
    agent.app.state.allowed = {"127.0.0.1"}  # the TestClient's address is no longer allowed
    assert agent.get("/agent/snapshot", headers=AH).status_code == 403


def test_agent_snapshot_and_events(agent):
    a = agent.agent
    s = agent.get("/agent/snapshot", headers=AH).json()
    assert s["system"]["hostname"] == "h5" and len(s["services"]) == 2 and s["games"][0]["players"] == [{"name": "Steve"}]
    assert s["samples"]["players:mheynautics"] == 1 and s["events"] == []
    a.games.pending = [("join", "mheynautics", "Alex")]
    s = agent.get(f"/agent/snapshot?since=0&instance={a.instance}", headers=AH).json()
    assert [(e["id"], e["detail"]) for e in s["events"]] == [(1, "Alex")]
    s = agent.get(f"/agent/snapshot?since=1&instance={a.instance}", headers=AH).json()
    assert s["events"] == []
    # Asking with another run's instance gets everything the agent holds.
    s = agent.get("/agent/snapshot?since=1&instance=old", headers=AH).json()
    assert len(s["events"]) == 1


def test_agent_actions_follow_its_own_config(agent, monkeypatch):
    calls = []
    monkeypatch.setattr(actions, "systemctl", lambda verb, unit: (calls.append((verb, unit)) or (True, "")))
    assert agent.post("/agent/units/mheynautics.service/stop", headers=AH).status_code == 200
    assert agent.post("/agent/units/ssh.service/restart", headers=AH).status_code == 403
    assert agent.post("/agent/units/other.service/restart", headers=AH).status_code == 404
    assert calls == [("stop", "mheynautics.service")]
    assert agent.get("/agent/journal/other.service", headers=AH).status_code == 404


# ---------- server ↔ agent ----------
def test_server_polls_and_merges(server):
    s = server.sampler
    s.do_remote("h5")
    h = s.state.hosts["h5"]
    assert h["reachable"] and h["system"]["hostname"] == "h5"
    svcs = server.get("/api/services", headers=H).json()
    units = [x["unit"] for x in svcs["services"]]
    assert "h5/mheynautics.service" in units and "h5 · Games" in svcs["groups"]
    assert [x["id"] for x in svcs["hosts"]] == ["x1", "h5"]
    m = next(x for x in svcs["services"] if x["unit"] == "h5/mheynautics.service")
    assert m["host"] == "h5" and m["systemd_unit"] == "mheynautics.service" and m["section"] == "Games"
    games = server.get("/api/games", headers=H).json()["games"]
    assert games[0]["id"] == "mheynautics" and games[0]["unit"] == "h5/mheynautics.service"
    o = server.get("/api/overview", headers=H).json()
    assert [x["id"] for x in o["hosts"]] == ["x1", "h5"] and o["hosts"][1]["gpus"][0]["name"] == "GPU"
    assert o["services"]["total"] == 2
    assert server.get("/api/hosts/h5", headers=H).json()["system"]["disks"][1]["mount"] == "/srv/data"
    assert server.get("/api/system?host=h5", headers=H).json()["hostname"] == "h5"
    assert server.get("/api/hosts/nope", headers=H).status_code == 404
    keys = server.get("/api/history/keys", headers=H).json()["keys"]
    assert {"h5/cpu", "h5/disk:/srv/data", "h5/gpu", "mem:h5/mheynautics.service", "players:mheynautics"} <= set(keys)


def test_server_records_remote_events_once(server):
    s, a = server.sampler, server.agent.agent
    s.do_remote("h5")
    a.games.pending = [("join", "mheynautics", "Alex")]
    s.do_remote("h5")
    s.do_remote("h5")
    joins = server.app_.state.db.events(kind="join")
    assert [(e["subject"], e["detail"]) for e in joins] == [("mheynautics", "Alex")]
    # A unit going down on h5 is a service event under its full id.
    a.services.list[0] = svc("mheynautics.service", "Mheynautics", health="down", active="inactive")
    s.do_remote("h5")
    ev = server.app_.state.db.events(kind="service")
    assert [(e["subject"], e["detail"]) for e in ev] == [("h5/mheynautics.service", "down")]


def test_remote_actions_go_through_the_agent(server, monkeypatch):
    calls = []
    monkeypatch.setattr(actions, "systemctl", lambda verb, unit: (calls.append((verb, unit)) or (True, "")))
    monkeypatch.setattr(actions.pool, "command", lambda port, pw, line, host="127.0.0.1": f"{port}:{line}")
    server.sampler.do_remote("h5")
    r = server.post("/api/services/h5%2Fmheynautics.service/restart", headers=H)
    assert r.status_code == 200 and r.json()["service"]["unit"] == "h5/mheynautics.service"
    # The agent's own config says no, so the server's answer is no.
    assert server.post("/api/services/h5/ssh.service/restart", headers=H).status_code == 403
    assert calls == [("restart", "mheynautics.service")]
    r = server.post("/api/games/mheynautics/rcon", headers=H, json={"command": "/list"})
    assert r.json() == {"command": "list", "output": "25577:list"}
    detail = server.get("/api/services/h5/mheynautics.service", headers=H).json()
    assert detail["name"] == "Mheynautics" and "journal" in detail
    audits = [(x["action"], x["target"], x["result"]) for x in reversed(server.app_.state.db.audits())]
    assert audits == [("restart", "h5/mheynautics.service", "ok"), ("restart", "h5/ssh.service", "failed"),
                      ("rcon", "mheynautics", "ok")]


def test_remote_valheim_lists(server, agent_cfg, tmp_path):
    server.sampler.do_remote("h5")
    server.sampler.remotes["h5"].state["games"].append(
        {"id": "valheim", "kind": "valheim", "name": "V", "unit": "h5/valheim.service", "players": []})
    sid = "76561198000000001"
    r = server.post("/api/games/valheim/lists/admin", headers=H, json={"id": sid})
    assert r.status_code == 200 and [x["id"] for x in r.json()["lists"]["admin"]] == [sid]
    assert (tmp_path / "adminlist.txt").read_text() == sid + "\n"
    assert server.post("/api/games/valheim/lists/admin", headers=H, json={"id": "bad"}).status_code == 400


def test_unreachable_host(server):
    s = server.sampler
    server.agent.down = True
    s.do_remote("h5")
    assert s.state.hosts["h5"]["reachable"] is False
    now = time.time()
    s.state.started = now - 300
    issues = rules.evaluate(s.state, s.cfg, s.db, now)
    assert [i["id"] for i in issues] == ["h5:unreachable"] and issues[0]["host"] == "h5"
    # Just after Hearth starts, a host that hasn't answered yet isn't reported.
    s.state.started = now
    assert rules.evaluate(s.state, s.cfg, s.db, now) == []
    # An action on an unreachable host is a 502 with a reason.
    server.agent.down = False
    s.do_remote("h5")
    server.agent.down = True
    r = server.post("/api/services/h5/mheynautics.service/restart", headers=H)
    assert r.status_code == 502 and "didn't answer" in r.json()["detail"]


def test_remote_issues_are_prefixed(server):
    s = server.sampler
    a = server.agent.agent
    a.services.list[0] = svc("mheynautics.service", "Mheynautics", health="down", active="inactive")
    s.do_remote("h5")
    ids = {i["id"]: i for i in rules.evaluate(s.state, s.cfg, s.db)}
    assert "unit:h5/mheynautics.service" in ids and ids["unit:h5/mheynautics.service"]["host"] == "h5"


def test_alert_titles_name_the_host(server):
    sent = []

    class Sender:
        configured = True

        def send(self, title, message, priority="default", tags=""):
            sent.append((title, message))

    cfg = server.sampler.cfg
    cfg.alerts.title = "x1"
    al = Alerts(cfg, server.sampler.db, sender=Sender())
    now = 1_000_000.0
    issue = rules.issue("h5:unreachable", "critical", "h5 is unreachable", host="h5")
    local = rules.issue("ram", "warning", "Memory above 90%", host="x1")
    al([issue, local], now)
    al([issue, local], now + 400)
    al([], now + 500)
    assert ("h5", "h5 is unreachable") in sent and ("x1", "Memory above 90%") in sent
    assert any(t == "h5" and m.startswith("Resolved: h5 is unreachable") for t, m in sent)


def test_sample_keys():
    assert sample_key("h5", "cpu") == "h5/cpu"
    assert sample_key("h5", "disk:/srv/data") == "h5/disk:/srv/data"
    assert sample_key("h5", "mem:valheim.service") == "mem:h5/valheim.service"
    assert sample_key("h5", "players:valheim") == "players:valheim"


def test_host_config_validation():
    with pytest.raises(ValueError):
        config.parse({"host": [{"id": "H5!", "url": "http://x", "token_file": "/t"}]})
    with pytest.raises(ValueError):
        config.parse({"role": "nope"})
