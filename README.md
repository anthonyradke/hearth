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

## The app

`ios/` is an Expo (React Native) app, SDK 57. It has four tabs. Overview answers "is everything fine?" in one line, then shows CPU, memory, disk, temperature, network and power tiles, the game servers and links to Network and Backups. Services lists every unit by group. Games shows who's online on each server. Activity is a feed of joins, leaves and services starting or stopping. Every chart can be scrubbed with a finger, like the Stocks app. `ios/DESIGN.md` explains the design decisions.

```bash
cd ios
npm install
echo 'EXPO_PUBLIC_HEARTH_URL=https://<server>.<tailnet>.ts.net:8446' > .env.local   # never committed
npx expo start --port 8083
```

**On my iPhone with Expo Go:** open Expo Go and enter `exp://<server's Tailscale IP>:8083`. The phone needs Tailscale on. The first launch asks for the token.

**As a real app (free Apple ID):** on the Mac with Xcode, `npx expo run:ios --device --configuration Release`, and pick my Personal Team for signing if Xcode asks. Apps signed this way stop opening after 7 days; running the same command again re-signs it.

**Web preview (for checking layouts on the server):** `npx expo start --web --port 8083`, plus `HEARTH_TOKEN=$(sudo cat /etc/hearth/token) HEARTH_LOGIN=<owner> node scripts/preview.mjs`, then open `http://127.0.0.1:8091`. The preview script adds the credentials the phone would send, and it only listens on localhost.

## API

JSON under `/api`. `/api/ping` is the only route that doesn't need auth.

- Reading: `overview`, `system`, `issues`, `services`, `services/{unit}` (with recent journal lines), `games`, `games/{id}`, `network`, `backups`, `history?key=cpu&range=24h` (ranges 1h, 6h, 24h, 7d, 30d and 90d), `events`, `alerts` and `audit`.
- Changing things: `POST services/{unit}/{start|stop|restart}` (only what the config allows for that unit), `POST games/{id}/rcon` for Minecraft console commands, `GET/POST/DELETE games/{id}/lists/...` for Valheim's admin, permitted and banned lists, and `POST alerts/test`. Every attempt lands in the audit log, including refused ones.

## Alerts

Each rule (a unit that should be running isn't, disk, memory, CPU temperature, running on battery, Tailscale key expiry, a failed or stale backup, Pi-hole not answering) has to hold for a grace period before it's sent. That's 90 seconds for critical and 5 minutes for warnings, so a quick restart never pages me. Each alert goes out once through [ntfy](https://ntfy.sh), again every 6 hours while it's still critical, and then a "Resolved" message once it clears. During quiet hours, warnings wait until morning and are dropped if they clear before then. Critical alerts always go out. The messages stay vague on purpose, because anyone with the topic can read them.

The server can't report its own death, so Hearth also pings a [healthchecks.io](https://healthchecks.io) check every minute. When the pings stop, healthchecks.io sends the alert.
