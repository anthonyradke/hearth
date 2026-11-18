#!/usr/bin/env bash
# Installs or updates Hearth on this machine. Safe to run again. What it installs follows role in the config:
#   role = "server" (default): the backend the app talks to, hearth.service behind Tailscale Serve
#   role = "agent": hearth-agent.service only, which the server polls over the tailnet ([[host]] in its config)
#   sudo ./install.sh            install/update, then self-test
#   sudo ./install.sh new-token  replace the API token (server: the app needs the new one; agent: the server does)
set -euo pipefail
cd "$(dirname "$0")"
REPO=$(pwd)

if [ "$(id -u)" != 0 ]; then
    echo "run with sudo: sudo ./install.sh" >&2
    exit 1
fi

command -v setfacl >/dev/null || apt-get install -y -q acl >/dev/null
UV=${UV:-$(command -v uv || echo /home/"${SUDO_USER:-root}"/.local/bin/uv)}
[ -x "$UV" ] || { echo "uv not found; set UV=/path/to/uv" >&2; exit 1; }
PORT=8010
SERVE_PORT=8446
CONF=/etc/hearth/config.toml
# Reads one top-level or [section] key from the config: cfg role / cfg agent.listen
cfg() {
    python3 - "$CONF" "$1" <<'EOF'
import sys, tomllib
v = tomllib.load(open(sys.argv[1], "rb"))
for part in sys.argv[2].split("."):
    v = v.get(part, "") if isinstance(v, dict) else ""
print(" ".join(map(str, v)) if isinstance(v, list) else v)
EOF
}

new_token() {
    (umask 027 && python3 -c 'import secrets; print(secrets.token_urlsafe(32))' > /etc/hearth/token)
    chown root:hearth /etc/hearth/token
    chmod 640 /etc/hearth/token
}

# ---------- user ----------
if ! id hearth >/dev/null 2>&1; then
    useradd --system --user-group --home-dir /var/lib/hearth --no-create-home --shell /usr/sbin/nologin hearth
    echo "created system user hearth"
fi
usermod -aG systemd-journal hearth
for g in sudo docker adm; do
    if id -nG hearth | tr ' ' '\n' | grep -qx "$g"; then gpasswd -d hearth "$g"; fi
done

# ---------- config ----------
install -d -m 750 -o root -g hearth /etc/hearth
if [ ! -e "$CONF" ]; then
    install -m 640 -o root -g hearth server/config.example.toml "$CONF"
    echo
    echo "Created $CONF from the example. Edit it for this machine (sudo nano $CONF), then run this again."
    exit 1
fi
chown root:hearth "$CONF"
chmod 640 "$CONF"

ROLE=$(cfg role)
ROLE=${ROLE:-server}
case "$ROLE" in
    server) UNIT=hearth ;;
    agent) UNIT=hearth-agent ;;
    *) echo "role in $CONF must be server or agent, not $ROLE" >&2; exit 1 ;;
esac
# The other role's unit must not be left running from an earlier install.
OTHER=$([ "$UNIT" = hearth ] && echo hearth-agent || echo hearth)
if [ -e /etc/systemd/system/$OTHER.service ]; then
    systemctl disable --now $OTHER >/dev/null 2>&1 || true
    rm -rf /etc/systemd/system/$OTHER.service /etc/systemd/system/$OTHER.service.d
    echo "removed $OTHER.service (this machine is now a $ROLE)"
fi

if [ "${1:-}" = new-token ] || [ ! -s /etc/hearth/token ]; then
    new_token
    echo "Generated a new API token. Show it with: sudo cat /etc/hearth/token"
    [ "${1:-}" = new-token ] && { systemctl restart $UNIT 2>/dev/null || true; exit 0; }
fi

# ---------- code ----------
install -d -m 755 /opt/hearth /opt/hearth/app
rm -rf /opt/hearth/app/hearth
cp -r server/hearth /opt/hearth/app/
cp server/pyproject.toml server/uv.lock server/.python-version /opt/hearth/app/
find /opt/hearth/app -name __pycache__ -prune -exec rm -rf {} +
(cd /opt/hearth/app && UV_PROJECT_ENVIRONMENT=/opt/hearth/venv UV_PYTHON_INSTALL_DIR=/opt/hearth/python \
    "$UV" sync --frozen --no-dev --no-install-project --python-preference only-managed -q)
chmod -R a+rX /opt/hearth

# ---------- file access (from config) ----------
# Valheim's admin/permitted/banned lists: traverse on each parent, read-write on the three files, nothing else.
# The unit runs with ProtectSystem=strict, so the files also go into a ReadWritePaths drop-in.
install -d -m 755 /etc/systemd/system/$UNIT.service.d
paths=$(python3 - "$CONF" <<'EOF'
import sys, tomllib
cfg = tomllib.load(open(sys.argv[1], "rb"))
for g in cfg.get("game", []):
    if g.get("kind") == "valheim" and g.get("lists_dir"):
        for f in ("adminlist.txt", "permittedlist.txt", "bannedlist.txt"):
            print(f"{g['lists_dir'].rstrip('/')}/{f}")
EOF
)
{
    echo "# Written by install.sh from $CONF."
    echo "[Service]"
    for f in $paths; do echo "ReadWritePaths=-$f"; done
} > /etc/systemd/system/$UNIT.service.d/paths.conf
for f in $paths; do
    [ -e "$f" ] || continue
    d=$(dirname "$f")
    while [ "$d" != / ]; do
        perm=$(stat -c %a "$d")
        (( (${perm: -1} & 1) == 1 )) || setfacl -m u:hearth:x "$d"  # others can't traverse: let hearth
        d=$(dirname "$d")
    done
    setfacl -m u:hearth:rw "$f"
done

# ---------- service actions (polkit), from config ----------
python3 - "$CONF" > /etc/polkit-1/rules.d/50-hearth.rules <<'EOF'
import json, sys, tomllib
cfg = tomllib.load(open(sys.argv[1], "rb"))
verbs = {"restart": ["restart"], "full": ["start", "stop", "restart"]}
allowed = {}
for s in cfg.get("service", []):
    v = verbs.get(s.get("actions", "none"))
    if v:
        unit = s["unit"] if "." in s["unit"] else s["unit"] + ".service"
        allowed[unit] = v
print("// Written by hearth's install.sh from /etc/hearth/config.toml. Lets the hearth user start, stop or")
print("// restart exactly these units and nothing else.")
print(f"var HEARTH_UNITS = {json.dumps(allowed, indent=2)};")
print("""polkit.addRule(function(action, subject) {
    if (action.id == "org.freedesktop.systemd1.manage-units" && subject.user == "hearth") {
        var allowed = HEARTH_UNITS[action.lookup("unit")];
        if (allowed && allowed.indexOf(action.lookup("verb")) >= 0) {
            return polkit.Result.YES;
        }
        return polkit.Result.NO;
    }
});""")
EOF
chmod 644 /etc/polkit-1/rules.d/50-hearth.rules

# ---------- disk health (SMART), from config ----------
# smartctl needs root, so a root timer saves its output where Hearth can read it (collectors/smart.py).
SMART_DEVS=$(cfg smart)
if [ -n "$SMART_DEVS" ] && command -v smartctl >/dev/null; then
    install -m 755 server/deploy/hearth-smart /opt/hearth/hearth-smart
    {
        echo "# Written by hearth's install.sh from $CONF (smart = [...])."
        echo "[Unit]"
        echo "Description=Hearth: save SMART data for the app"
        echo "[Service]"
        echo "Type=oneshot"
        echo "ExecStart=/opt/hearth/hearth-smart /var/lib/hearth-smart $SMART_DEVS"
        echo "StateDirectory=hearth-smart"
        echo "StateDirectoryMode=0755"
        echo "UMask=0022"
        echo "Nice=10"
        echo "IOSchedulingClass=idle"
        # Raw disk commands need CAP_SYS_RAWIO (ATA) and CAP_SYS_ADMIN (NVMe), on these devices only.
        echo "CapabilityBoundingSet=CAP_SYS_RAWIO CAP_SYS_ADMIN"
        echo "DevicePolicy=closed"
        for d in $SMART_DEVS; do echo "DeviceAllow=$d r"; done
        echo "PrivateNetwork=yes"
        echo "PrivateTmp=yes"
        echo "ProtectSystem=strict"
        echo "ProtectHome=yes"
        echo "ProtectKernelModules=yes"
        echo "ProtectKernelLogs=yes"
        echo "ProtectKernelTunables=yes"
        echo "ProtectControlGroups=yes"
        echo "ProtectClock=yes"
        echo "ProtectHostname=yes"
        echo "NoNewPrivileges=yes"
        echo "RestrictNamespaces=yes"
        echo "RestrictRealtime=yes"
        echo "RestrictSUIDSGID=yes"
        echo "LockPersonality=yes"
        echo "MemoryDenyWriteExecute=yes"
        echo "SystemCallArchitectures=native"
        echo "RestrictAddressFamilies=AF_UNIX"
    } > /etc/systemd/system/hearth-smart.service
    cat > /etc/systemd/system/hearth-smart.timer <<'EOF'
# Written by hearth's install.sh.
[Unit]
Description=Hearth: save SMART data hourly

[Timer]
OnBootSec=2min
OnUnitActiveSec=1h
RandomizedDelaySec=2min

[Install]
WantedBy=timers.target
EOF
elif [ -n "$SMART_DEVS" ]; then
    echo "smart is set in $CONF but smartctl isn't installed (apt install smartmontools); skipping disk health"
else
    systemctl disable --now hearth-smart.timer >/dev/null 2>&1 || true
    rm -f /etc/systemd/system/hearth-smart.service /etc/systemd/system/hearth-smart.timer
fi

# ---------- unit ----------
install -m 644 server/deploy/$UNIT.service /etc/systemd/system/$UNIT.service
if [ "$ROLE" = agent ]; then
    LISTEN=$(cfg agent.listen)
    LISTEN=${LISTEN:-127.0.0.1:8011}
    LHOST=${LISTEN%:*}
    LPORT=${LISTEN##*:}
    ALLOW=$(cfg agent.allow)
    {
        echo "# Written by hearth's install.sh from [agent] in $CONF."
        echo "[Service]"
        echo "Environment=HEARTH_LISTEN_HOST=$LHOST HEARTH_LISTEN_PORT=$LPORT"
        echo "IPAddressAllow=$LHOST $ALLOW"
    } > /etc/systemd/system/$UNIT.service.d/net.conf
    # nvidia-smi needs /dev/nvidiactl and one /dev/nvidiaN per GPU, nothing else under /dev. (The char-nvidia-frontend
    # class doesn't work: NVML then fails with "Unknown Error".)
    if [ -e /dev/nvidiactl ]; then
        {
            echo "# Written by hearth's install.sh: this machine has an NVIDIA GPU."
            echo "[Service]"
            for d in /dev/nvidiactl /dev/nvidia[0-9]*; do [ -e "$d" ] && echo "DeviceAllow=$d rw"; done
        } > /etc/systemd/system/$UNIT.service.d/gpu.conf
    else
        rm -f /etc/systemd/system/$UNIT.service.d/gpu.conf
    fi
fi
systemctl daemon-reload
systemctl enable $UNIT >/dev/null 2>&1
systemctl restart $UNIT
if [ -e /etc/systemd/system/hearth-smart.timer ]; then
    systemctl enable --now hearth-smart.timer >/dev/null 2>&1
    systemctl start hearth-smart.service  # now, so the app has data before the first hourly run
fi
if [ "$ROLE" = server ]; then
    tailscale serve --https=$SERVE_PORT --bg http://127.0.0.1:$PORT >/dev/null
    # Agents' tokens: readable by hearth only.
    for f in $(python3 -c 'import sys,tomllib; [print(h.get("token_file","")) for h in tomllib.load(open(sys.argv[1],"rb")).get("host",[])]' "$CONF"); do
        if [ -e "$f" ]; then chown root:hearth "$f"; chmod 640 "$f"; fi
    done
fi

# ---------- self-test ----------
echo
echo "Self-test:"
fail=0
check() {
    if "$@" >/dev/null 2>&1; then echo "  ok    $desc"; else echo "  FAIL  $desc"; fail=1; fi
}
code() { curl -s -m 15 -o /dev/null -w '%{http_code}' "$@"; }
TOKEN=$(cat /etc/hearth/token)
desc="hearth can't use sudo or docker";  check sh -c "! id -nG hearth | grep -qwE 'sudo|docker'"
desc="hearth can read the journal";      check runuser -u hearth -- journalctl -n 1 -q -u $UNIT
desc="hearth can't read other home files"
check runuser -u hearth -- sh -c '! ls /home/*/ 2>/dev/null | grep -q .'
if [ -e /etc/systemd/system/hearth-smart.timer ]; then
    desc="SMART data saved for $SMART_DEVS"
    check sh -c "for d in $SMART_DEVS; do test -s /var/lib/hearth-smart/\$(basename \$d).json || exit 1; done"
fi

if [ "$ROLE" = agent ]; then
    URL="http://$LHOST:$LPORT"
    for i in $(seq 1 30); do
        curl -sf "$URL/agent/ping" >/dev/null && break
        sleep 1
    done
    desc="$UNIT.service active";             check systemctl is-active --quiet $UNIT
    desc="answers on $URL";                  check curl -sf "$URL/agent/ping"
    desc="refuses a request with no token";  check test "$(code "$URL/agent/snapshot")" = 401
    desc="refuses a wrong token";            check test "$(code -H 'Authorization: Bearer nope' "$URL/agent/snapshot")" = 401
    desc="not listening on any other address"
    check sh -c "! ss -Htln | awk '{print \$4}' | grep -E ':$LPORT\$' | grep -vF '$LHOST:$LPORT'"
    desc="collectors running without errors"
    check sh -c "curl -sf -H 'Authorization: Bearer $TOKEN' $URL/agent/snapshot | python3 -c 'import json,sys; e=json.load(sys.stdin)[\"errors\"]; sys.exit(1 if e else 0)'"
    if [ -e /etc/systemd/system/$UNIT.service.d/gpu.conf ]; then
        desc="GPU visible to the agent"
        check sh -c "curl -sf -H 'Authorization: Bearer $TOKEN' $URL/agent/snapshot | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)[\"system\"][\"gpus\"] else 1)'"
    fi
    [ "$fail" = 0 ] || { journalctl -u $UNIT -n 30 --no-pager; exit 1; }
    echo
    echo "Hearth agent is at $URL (allowed: $LHOST $ALLOW). Give the server its token: sudo cat /etc/hearth/token"
    exit 0
fi

OWNER=$(cfg owner)
HOST=$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
TSIP=$(tailscale ip -4)
for i in $(seq 1 30); do
    curl -sf http://127.0.0.1:$PORT/api/ping >/dev/null && break
    sleep 1
done
desc="hearth.service active";            check systemctl is-active --quiet hearth
desc="answers on 127.0.0.1:$PORT";       check curl -sf http://127.0.0.1:$PORT/api/ping
desc="refuses a request with no token";  check test "$(code http://127.0.0.1:$PORT/api/overview)" = 401
desc="refuses the token without the owner login"
check test "$(code -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/api/overview)" = 403
desc="serves the overview to the owner"
check test "$(code -H "Authorization: Bearer $TOKEN" -H "Tailscale-User-Login: $OWNER" \
    http://127.0.0.1:$PORT/api/overview)" = 200
# x1 doesn't take Tailscale's DNS, so from here the name resolves to the public Funnel relays; pin it to our own
# tailnet IP. No login header is sent: a 200 proves Serve added the owner's.
desc="reachable through Tailscale Serve, which adds the owner login (https://$HOST:$SERVE_PORT)"
check test "$(code --resolve "$HOST:$SERVE_PORT:$TSIP" -H "Authorization: Bearer $TOKEN" \
    https://$HOST:$SERVE_PORT/api/overview)" = 200
desc="not on the internet (no Funnel on $SERVE_PORT)"
check sh -c "! tailscale funnel status 2>/dev/null | grep -q ':$SERVE_PORT (Funnel on)'"
desc="collectors running without errors"
check sh -c "sleep 3; curl -sf -H 'Authorization: Bearer $TOKEN' -H 'Tailscale-User-Login: $OWNER' \
    http://127.0.0.1:$PORT/api/overview | python3 -c 'import json,sys; e=json.load(sys.stdin)[\"errors\"]; sys.exit(1 if e else 0)'"
# Each agent: reachable from here with its token (the agent's firewall only lets this machine in).
HOSTS_TMP=$(mktemp)
python3 - "$CONF" <<'EOF' > "$HOSTS_TMP"
import sys, tomllib
for h in tomllib.load(open(sys.argv[1], "rb")).get("host", []):
    print(h["id"], h["url"].rstrip("/"), h["token_file"])
EOF
while read -r hid hurl htok; do
    desc="host $hid: agent answers with its token ($hurl)"
    check test "$(code -H "Authorization: Bearer $(cat "$htok" 2>/dev/null)" "$hurl/agent/snapshot")" = 200
    desc="host $hid: polled by hearth"
    check sh -c "sleep 2; curl -sf -H 'Authorization: Bearer $TOKEN' -H 'Tailscale-User-Login: $OWNER' \
        http://127.0.0.1:$PORT/api/hosts/$hid | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)[\"reachable\"] else 1)'"
done < "$HOSTS_TMP"
rm -f "$HOSTS_TMP"
[ "$fail" = 0 ] || { journalctl -u hearth -n 30 --no-pager; exit 1; }
echo
echo "Hearth is at https://$HOST:$SERVE_PORT (tailnet only). Token: sudo cat /etc/hearth/token"
