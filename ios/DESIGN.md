# Design: Hearth for iPhone

**Date:** 2026-09-23. **Goal:** open it, know in one second whether the server is fine, and fix the usual problems
(a game server that needs a restart, a friend who needs whitelisting) without SSH. It's a sibling to Tally for iPhone:
the same neutrals, type ramp and shape rules, built from the same native parts. Its own idea is that **color means
something is wrong**. Changes to anything below get written here first.

## What I took from where
- **Apple Home: the status summary at the top.** Home opens on a line of status ("2 lights on, garage open") before any
  rooms. Hearth opens on one sentence: *All good*, or *2 issues* with the issues listed right under it.
- **Apple Health: the metric tile.** An SF Symbol and label in the tile's top row, one big number, and a small chart.
  Tapping pushes a detail screen with a range picker (1H / 6H / 24H / 7D / 30D) and a chart you can scrub.
- **Stocks and Tally: the scrub chart.** No axes. Drag across the chart and the big number above follows your
  finger; let go and it goes back to now. It's the same component as tallyho's.
- **Settings: grouped inset lists** for services, facts and settings. Rows with a status dot, name, secondary line and
  chevron.
- **Unraid, TrueNAS and Home Assistant: group services by what they do** (Network, Games, Apps, Desktop, System), not
  alphabetically, and put memory and uptime on the row so you don't have to open it.
- **UptimeRobot and Tailscale: the dot plus a word.** A 8 pt dot is never the only signal: the row also says
  "Running", "Stopped" or "Failed". (Tailscale's own device list does the same.)
- **Termius and Console: logs are monospaced**, newest at the bottom, in a panel. They're selectable text so a line
  can be copied.

## Structure
- A native tab bar (Liquid Glass on iOS 26) with four tabs: **Overview, Services, Games, Activity**. Tabs are peers
  and each keeps its own stack. Re-tapping a tab pops it to its root.
- Every tab is a native stack with a large title. These detail screens push from any tab: a metric (`/metric/cpu`),
  a service (`/service/valheim`), a game (`/game/ys`), Network, Backups and Settings. Settings is a gear on
  Overview.
- **Connecting is a one-way door.** Until a server and token are saved, the app shows only the Connect screen.
  Saving replaces it with the tabs (a `Stack.Protected` guard), so back can't return to it. Disconnect in Settings
  goes the other way.
- Confirmations for actions that kick people (stop, restart) use the native action sheet and say who's online. Short
  inputs (whitelist a player, an RCON command) are form sheets. Nothing destructive happens on a single tap.

## Color
- Neutrals are Apple's system grouped palette, the same as Tally (`#F2F2F7` / black; panels white / `#1C1C1E`). One
  cool grey family.
- **Ink is the only accent**: black in light mode, white in dark. It's used for buttons, the selected segment, links
  and the tab bar.
- **Status is the only other color, and only when it means something.** Green for "running" dots and the All good
  check; amber for warnings; red for critical and failed. When everything is fine, the charts are neutral grey. A
  sparkline turns amber or red only when its metric crosses a warning threshold. So an Overview with any color on it
  besides green dots is an Overview that needs you.
- No hue anywhere is decorative: no per-metric colors and no gradients.

## Type
- SF Pro (system). The ramp is shared with Tally: hero 44/700, titles 28 and 22, body 17, rows 16/500, captions 13 and
  12. One display size per screen: the status line on Overview, and the metric figure on a metric screen.
- Every number that updates (percentages, rates, players, bytes) uses tabular figures, so it doesn't jitter while live
  values tick. Journal lines use SF Mono (`ui-monospace`) at 12.
- Units are formatted like a product: 1.2 GB, 16 KB/s, 53 °C, up 63 days, 4 h ago. No raw bytes or epoch seconds.

## Shape and space
- Panels 24 with continuous corners, metric tiles 20, inputs 12. Actions and status pills are pills, dots are
  circles. (Tiles are 20 because two sit side by side at half width; 24 looked bubbly at that size.)
- 4-point rhythm: 8 to 12 inside a panel, 28 between sections, 16 screen margins, 12 between tiles.

## Motion
- Navigation, sheets, the tab bar and pull-to-refresh are the system's own.
- Live numbers don't animate. They change in place every 30 seconds, and tabular figures keep them from jumping.
  Data you're reading doesn't move for style.
- Charts: scrubbing runs on the UI thread (Reanimated worklets) with a selection tick at each point passed. Switching
  the range cross-fades the line (150 ms). Charts don't draw in when a screen appears: this app is opened many times a
  day.
- Press feedback: tiles and buttons scale to 0.97, list rows highlight. Reduce Motion turns the cross-fade into an
  instant swap.

## Haptics
Selection ticks when scrubbing and on the range picker; success when an action completes; warning when a confirmation
sheet opens for something that kicks players; error when an action is refused.

## Data
- The phone polls the overview every 15 seconds while the app is open and in front, and stops in the background.
  TanStack Query keeps the last good answer on the phone (persisted), so a cold start draws the last known state at
  once, marked with its age ("as of 2 min ago") until fresh data arrives.
- Offline (Tailscale off, or not at home without it): the last known state stays up, with a banner that says it
  can't reach the server and how old the data is. It never turns into a blank screen or a full-screen spinner.

## States
- **Loading, first launch only:** skeletons shaped like the tiles and rows.
- **Empty:** no players ("Nobody's on"), no events ("Nothing yet: joins, restarts and alerts show up here"), Pi-hole
  not configured ("Add a Pi-hole app password to /etc/hearth/config.toml").
- **Error:** inline, specific: "Refused: the token is wrong", "Can't reach Hearth: is Tailscale on?"

## Icon
- **The app icon: a flame inside a ring of 40 status dots**, 34 of them lit from yellow at the top to red, like an
  uptime ring that's almost full. It has warm cream and ember-dark versions for light and dark mode, plus a white
  tinted one. The icon is the one place with gradients and warm color: it has to be spotted on a home screen, and
  inside the app the no-decorative-color rule still holds.
- The flame is centred by eye: vertically it sits between its centre of mass and the centre of its outline. Most of
  its weight is in the round base, so centring the outline made it look like it was sinking in the ring, and
  centring the mass made it float.
- **Kept for later: the uptime ring**, the same flame inside a solid, almost-closed gradient ring (like an Activity
  ring). It's bolder and reads better at 30 px. `node scripts/icons.mjs uptime` switches the app to it.
  Previews of both rings in light and dark are in `design/icons/`.
- `scripts/icons.mjs` renders all of it: the light, dark and tinted icons, the splash marks and the favicon.

## Open questions
- Whether a home screen widget (WidgetKit) would be worth doing later. It needs a native target, so it's out of scope
  for the Expo app for now.
