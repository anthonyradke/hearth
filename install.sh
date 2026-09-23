#!/usr/bin/env bash
# Installs or updates the Hearth backend on this machine. Safe to run again.
#   sudo ./install.sh            install/update, then self-test
#   sudo ./install.sh new-token  replace the API token (the app has to be given the new one)
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

if [ "${1:-}" = new-token ] || [ ! -s /etc/hearth/token ]; then
    new_token
    echo "Generated a new API token. Show it with: sudo cat /etc/hearth/token"
    [ "${1:-}" = new-token ] && { systemctl restart hearth 2>/dev/null || true; exit 0; }
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
install -d -m 755 /etc/systemd/system/hearth.service.d
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
} > /etc/systemd/system/hearth.service.d/paths.conf
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

# ---------- unit + Tailscale Serve ----------
install -m 644 server/deploy/hearth.service /etc/systemd/system/hearth.service
systemctl daemon-reload
systemctl enable hearth >/dev/null 2>&1
systemctl restart hearth
tailscale serve --https=$SERVE_PORT --bg http://127.0.0.1:$PORT >/dev/null

# ---------- self-test ----------
echo
echo "Self-test:"
fail=0
check() {
    if "$@" >/dev/null 2>&1; then echo "  ok    $desc"; else echo "  FAIL  $desc"; fail=1; fi
}
TOKEN=$(cat /etc/hearth/token)
OWNER=$(python3 -c 'import sys,tomllib; print(tomllib.load(open(sys.argv[1],"rb")).get("owner",""))' "$CONF")
HOST=$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
TSIP=$(tailscale ip -4)
for i in $(seq 1 30); do
    curl -sf http://127.0.0.1:$PORT/api/ping >/dev/null && break
    sleep 1
done
code() { curl -s -m 15 -o /dev/null -w '%{http_code}' "$@"; }
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
desc="hearth can't use sudo or docker";  check sh -c "! id -nG hearth | grep -qwE 'sudo|docker'"
desc="hearth can read the journal";      check runuser -u hearth -- journalctl -n 1 -q -u hearth
desc="hearth can't read other home files"
check runuser -u hearth -- sh -c '! ls /home/*/ 2>/dev/null | grep -q .'
desc="collectors running without errors"
check sh -c "sleep 3; curl -sf -H 'Authorization: Bearer $TOKEN' -H 'Tailscale-User-Login: $OWNER' \
    http://127.0.0.1:$PORT/api/overview | python3 -c 'import json,sys; e=json.load(sys.stdin)[\"errors\"]; sys.exit(1 if e else 0)'"
[ "$fail" = 0 ] || { journalctl -u hearth -n 30 --no-pager; exit 1; }
echo
echo "Hearth is at https://$HOST:$SERVE_PORT (tailnet only). Token: sudo cat /etc/hearth/token"
