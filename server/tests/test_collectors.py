from hearth.collectors import backups, games, network, services, system

STAT = """cpu  100 0 100 700 100 0 0 0 0 0
cpu0 50 0 50 350 50 0 0 0 0 0
cpu1 50 0 50 350 50 0 0 0 0 0
intr 1 2 3
"""
STAT2 = """cpu  200 0 200 1300 100 0 0 0 0 0
cpu0 150 0 50 350 50 0 0 0 0 0
cpu1 50 0 150 950 50 0 0 0 0 0
"""


def test_cpu_percent():
    a, b = system.parse_stat(STAT), system.parse_stat(STAT2)
    assert a["cpu"] == (200, 1000)  # iowait counts as idle
    pct = system.cpu_percent(a, b)
    assert pct["cpu"] == 25.0
    assert pct["cpu0"] == 100.0
    assert pct["cpu1"] == round(100 * 100 / 700, 1)


def test_meminfo_and_net():
    m = system.parse_meminfo("MemTotal: 1000 kB\nMemAvailable: 250 kB\n")
    assert m == {"MemTotal": 1024000, "MemAvailable": 256000}
    dev = ("Inter-|x\n face |x\n  eth0: 1000 5 0 0 0 0 0 0 2000 7 0 0 0 0 0 0\n"
           "    lo: 1 1 0 0 0 0 0 0 1 1 0 0 0 0 0 0\n")
    assert system.parse_net_dev(dev)["eth0"] == (1000, 2000)
    route = "Iface\tDestination\tGateway\neth0\t00000000\t0132A8C0\neth0\t0032A8C0\t00000000\n"
    assert system.default_iface(route) == "eth0"


def test_sensors():
    data = {"coretemp-isa-0000": {"Adapter": "ISA", "Package id 0": {"temp1_input": 53.0},
                                  "Core 0": {"temp2_input": 50.0}, "Core 4": {"temp6_input": 55.0}},
            "nvme-pci-0400": {"Composite": {"temp1_input": 35.85}},
            "thinkpad-isa-0000": {"fan1": {"fan1_input": 3866.0}, "temp3": {"temp3_input": 0.0}}}
    t = system.parse_sensors(data)
    assert t["cpu"] == 53.0 and t["cores_max"] == 55.0
    assert t["others"] == [{"name": "SSD", "c": 35.9}]
    assert t["fans"] == [{"name": "Fan 1", "rpm": 3866}]


def test_systemctl_show():
    text = ("Id=valheim.service\nActiveState=active\nSubState=running\nUnitFileState=enabled\nType=simple\n"
            "MemoryCurrent=1200\nCPUUsageNSec=5\nActiveEnterTimestamp=@1789438933\nNRestarts=0\n\n"
            "Id=minecraft2.service\nActiveState=inactive\nSubState=dead\nUnitFileState=disabled\nType=simple\n"
            "MemoryCurrent=[not set]\nActiveExitTimestamp=@1789000000\n\n"
            "Id=gone.service\nActiveState=failed\nUnitFileState=enabled\nType=simple\n\n"
            "Id=iso.service\nActiveState=inactive\nUnitFileState=enabled\nType=oneshot\n\n"
            "Id=x.service\nActiveState=inactive\nUnitFileState=enabled\nType=simple\nMemoryCurrent=18446744073709551615\n")
    b = [services.normalize(x) for x in services.parse_show(text)]
    assert b[0]["memory"] == 1200 and b[0]["since"] == 1789438933
    assert b[1]["memory"] is None and b[1]["since"] == 1789000000
    assert [services.health(s) for s in b] == ["ok", "stopped", "failed", "stopped", "down"]
    assert b[4]["memory"] is None


def test_minecraft_list():
    assert games.parse_list("There are 0 of a max of 20 players online: ") == (0, 20, [])
    assert games.parse_list("There are 2 of a max of 20 players online: Alex, Steve") == (2, 20, ["Alex", "Steve"])
    assert games.parse_list("Unknown command") is None


def test_valheim_tracker():
    v = games.Valheim({"111": "Known"})
    ev = v.feed([
        "09/15/2026 02:22:53: Valheim version: l-1.0.12 (network version 40)",
        "09/15/2026 02:22:53: Get create world ValMean",
        "Got handshake from client 222",
        "Got character ZDOID from Newbie : 1460180917:1",
        "Got handshake from client 111",
        "Got character ZDOID from Known : 55:1",
        "Got character ZDOID from Newbie : 0:0",  # died, still online
    ])
    assert v.version == "l-1.0.12" and v.world == "ValMean"
    assert ev == [("join", "222"), ("join", "Known")]
    assert sorted(p["name"] for p in v.players()) == ["Known", "Newbie"]
    assert v.names["222"] == "Newbie"
    assert v.feed(["Closing socket 222"]) == [("leave", "Newbie")]
    assert v.feed(["09/13/2026 21:09:09:  Connections 0 ZDOS:1  sent:0 recv:0"]) == [("leave", "Known")]
    assert v.players() == []


def test_tailscale():
    d = {"BackendState": "Running", "Version": "1.102.4-tabc",
         "Self": {"DNSName": "box.tail.ts.net.", "OS": "linux", "Online": True, "TailscaleIPs": ["100.1.1.1"],
                  "KeyExpiry": "2026-10-01T00:00:00Z", "UserID": 1},
         "User": {"1": {"LoginName": "me@github"}},
         "Peer": {"a": {"HostName": "funnel-ingress-node", "Tags": ["tag:ingress"]},
                  "b": {"DNSName": "phone.tail.ts.net.", "OS": "iOS", "Online": False, "UserID": 1,
                        "LastSeen": "2026-09-20T00:00:00Z"},
                  "c": {"DNSName": "mac.tail.ts.net.", "OS": "macOS", "Online": True, "UserID": 1}}}
    t = network.parse_tailscale(d)
    assert t["version"] == "1.102.4"
    assert [p["name"] for p in t["peers"]] == ["mac", "phone"]
    assert t["self"]["key_expiry"] == 1790812800 and t["self"]["user"] == "me@github"


def test_cellar_status():
    s = backups.parse_status({"schema": 1, "updated": "2026-09-23T19:28:23+00:00",
                              "last_success": "2026-09-23T19:27:57+00:00",
                              "backup": {"started": "2026-09-23T19:26:10+00:00", "finished": None, "result": "running"},
                              "sources": [{"path": "/a", "bytes": 1}, {"path": "/b", "bytes": 5}]})
    assert s["last_success"] == 1790191677
    assert s["backup"]["finished"] is None and s["backup"]["result"] == "running"
    assert [x["path"] for x in s["sources"]] == ["/b", "/a"]
    assert s["drill"] is None
