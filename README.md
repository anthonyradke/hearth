# Hearth

Hearth is how I keep an eye on my home server from my phone. It's an old ThinkPad that runs a couple of Minecraft servers, a Valheim server, Pi-hole for the house and a few of my own apps. Before this, checking on it meant SSHing in and running `uptime`, `sensors` and `systemctl status` by hand. Now it's one screen.

It has two parts:

- `server/`, a small FastAPI backend that runs on the server. Every 30 to 60 seconds it samples CPU, memory, disks, temperatures, network, battery, every systemd unit I care about, who's on the game servers, Tailscale, Pi-hole and the state of my nightly backups. It keeps 48 hours of raw samples and 90 days of 5-minute averages in SQLite.
- `ios/`, a native iOS app (Expo / React Native) that talks to it over Tailscale.

## How it's locked down

The API is only reachable on my tailnet, through Tailscale Serve. It's never on the internet. Every request needs a bearer token, which is generated at install time. It also needs the `Tailscale-User-Login` header that Serve adds, and that header has to match my own login, so a stolen token alone isn't enough.

The backend runs as its own `hearth` system user, not as me, because my account has passwordless sudo. That user can read the journal and nothing in my home directory except the three Valheim list files. The only units it can start, stop or restart are the ones the config marks for it, through a generated polkit rule. It isn't in the `docker` group; it reads the remote desktop container's CPU and memory from its cgroup.

## Setting it up

```bash
sudo ./install.sh            # first run creates /etc/hearth/config.toml from the example and stops
sudo nano /etc/hearth/config.toml
sudo ./install.sh            # installs to /opt/hearth, starts hearth.service, runs a self-test
sudo cat /etc/hearth/token   # goes into the app once
```

Everything machine-specific (units, game servers, RCON passwords, the Pi-hole app password, thresholds) lives in `/etc/hearth/config.toml`. `server/config.example.toml` explains each setting. `install.sh` is safe to run again after any change, and `sudo ./install.sh new-token` replaces the token.

## Developing

```bash
cd server
uv sync
uv run pytest -q
HEARTH_CONFIG=/path/to/dev-config.toml uv run uvicorn --factory hearth.main:app --port 8010
```

## API

Everything is `GET` and JSON under `/api`: `overview`, `system`, `issues`, `services`, `services/{unit}` (with recent journal lines), `games`, `games/{id}`, `network`, `backups`, `history?key=cpu&range=24h` (ranges 1h, 6h, 24h, 7d, 30d and 90d), `events` and `audit`. `/api/ping` is the only route that doesn't need auth.
