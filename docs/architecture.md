# Architecture: watching other machines

The main server (`role = "server"`) is the only thing the app talks to. Other machines run the Hearth agent
(`role = "agent"`, `hearth-agent.service`), and the server polls each of them. This keeps one alert engine, one
history database, one token on the phone and one Tailscale Serve endpoint, and it lets the server notice when a machine
stops answering.

## The agent

`server/hearth/agent.py` reuses the server's collectors (system, services, games) and the operations from `actions.py`
(start/stop/restart, Minecraft RCON, Valheim lists). It keeps no history and sends no alerts.

- `GET /agent/snapshot?since=<id>&instance=<id>` runs the collectors and returns the result, the samples to record, and
  player joins and leaves after event id `since`. Each agent run has a random `instance`; when the server asks with
  an old one, the agent sends every event it still holds, so neither side's restart loses or repeats an event.
- `GET /agent/journal/{unit}`, `POST /agent/units/{unit}/{verb}`, `POST /agent/games/{id}/rcon`,
  `GET/POST/DELETE /agent/games/{id}/lists/...` mirror the server's routes for that machine's own units and games.
- Every action is checked against the agent's own config, so the server can't make it do more than that config allows.
  RCON stays on the agent's localhost.

Auth is a bearer token (`/etc/hearth/token` on the agent, copied to the server's `[[host]] token_file`) and the
client's address, which has to be loopback or listed in `[agent] allow`. The unit listens on the address in
`[agent] listen` (normally the machine's tailnet address) and adds a cgroup firewall (`IPAddressDeny=any` plus the
allowed addresses), so nothing else on the LAN or the tailnet can reach it. It runs as the same unprivileged `hearth`
user as the server, with a polkit rule generated from its config. On a machine with an NVIDIA GPU, `install.sh` opens
`/dev/nvidiactl` and `/dev/nvidiaN` to the unit for `nvidia-smi`, and nothing else under `/dev`.

## The server's side

`server/hearth/remote.py` polls each `[[host]]` every 30 seconds, outside the sampler's lock so a machine that's down
can't hold up local collection or actions. Its data is renamed so it can't clash with the server's own:

| Thing | Server's own | On host `h` |
|---|---|---|
| Unit id in the API | `valheim.service` | `h/valheim.service` |
| Machine history keys | `cpu`, `disk:/data` | `h/cpu`, `h/disk:/data` |
| Unit history keys | `mem:valheim.service` | `mem:h/valheim.service` |
| Game ids, `players:<id>` | as configured | as configured on the agent (unique across machines) |
| Machine issue ids | `ram`, `disk:/` | `h:ram`, `h:disk:/` |

`/api/services`, `/api/games` and `/api/overview` merge every machine; each item carries `host`. Remote services also
carry `systemd_unit` (the plain name) and `section` (the group without the host prefix); their `group` is prefixed
with the host name so older apps that group by it keep the machines apart.

A host with no good poll for `unreachable_seconds` (90 by default) raises one critical issue, `<host>:unreachable`,
in place of all its other issues, which would be stale. Alerts store the host they're about and use its name as the
ntfy title.

## Disk health

SMART needs root, so `install.sh` writes `hearth-smart.service` and an hourly timer when the config lists devices
under `smart`. It runs `server/deploy/hearth-smart` as root with only `CAP_SYS_RAWIO`/`CAP_SYS_ADMIN` and read access
to those devices, saving `smartctl --json` output in `/var/lib/hearth-smart`. Hearth parses the files
(`collectors/smart.py`). A disk that's spun down isn't woken; its last file stays.
