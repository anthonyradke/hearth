// Renders the app icon and splash mark: a flame inside a ring of status dots, like an uptime ring that's almost full.
// Run after changing the mark: node scripts/icons.mjs
// `node scripts/icons.mjs uptime` renders the solid-ring alternative into the app instead (see DESIGN.md). Either
// way, light and dark previews of both rings are written to design/icons/.
import sharp from 'sharp'
import fs from 'node:fs'

const style = process.argv[2] === 'uptime' ? 'uptime' : 'led'

// Vertically the flame sits between its centre of mass (y 572 in its own space) and its bounding box centre: its
// weight is in the round base, so box-centring made it look like it was sinking in the ring, and mass-centring
// made it float. `drop` lowers it from the centre of mass. Horizontally its base is centred (x 512); the mass
// leans right only because of the notch on the left.
const flame = `M512 190 C560 300 720 400 720 600 C720 730 625 830 512 830 C399 830 304 730 304 600 C304 500 360 440
  400 400 C405 470 430 520 470 540 C450 430 460 300 512 190 Z`
const R = 330
const drop = 24

const themes = {
  dark: { bg: ['#3a1608', '#140905', '#070302'], track: '#2a1510', ring: ['#ffd166', '#ff3b30'], fire: ['#ffe08a', '#ff5a1f'], glow: true },
  light: { bg: ['#fffaf3', '#f6efe6', '#ece2d6'], track: '#e6dacd', ring: ['#ffb02e', '#ff3b30'], fire: ['#ffb347', '#ff5a1f'], glow: false },
  tinted: { track: '#ffffff40', ring: ['#ffffff', '#ffffff'], fire: ['#ffffff', '#ffffff'], glow: false },
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a, b, t) => `rgb(${hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t)).join(',')})`

// 40 dots clockwise from the top, the last 6 unlit
const ledRing = (t) => Array.from({ length: 40 }, (_, k) => {
  const a = -Math.PI / 2 + (k / 40) * 2 * Math.PI, lit = k < 34
  const fill = lit ? mix(t.ring[0], t.ring[1], k / 33) : t.track
  return `<circle cx="${(512 + R * Math.cos(a)).toFixed(1)}" cy="${(512 + R * Math.sin(a)).toFixed(1)}" r="21"
    fill="${fill}"${lit && t.glow ? ' filter="url(#glow)"' : ''}/>`
}).join('')

const uptimeRing = (t) => `
  <circle cx="512" cy="512" r="${R}" fill="none" stroke="${t.track}" stroke-width="64"/>
  <circle cx="512" cy="512" r="${R}" fill="none" stroke="url(#ring)" stroke-width="64" stroke-linecap="round"
    stroke-dasharray="${2 * Math.PI * R * 0.86} ${2 * Math.PI * R}" transform="rotate(-90 512 512)"${t.glow ? ' filter="url(#glow)"' : ''}/>`

const svg = (ring, t, withBg) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="bg" cx="50%" cy="58%" r="70%">${(t.bg ?? []).map((c, i) => `<stop offset="${[0, 0.6, 1][i]}" stop-color="${c}"/>`).join('')}</radialGradient>
    <linearGradient id="ring" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.ring[0]}"/><stop offset="1" stop-color="${t.ring[1]}"/></linearGradient>
    <linearGradient id="fire" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.fire[0]}"/><stop offset="1" stop-color="${t.fire[1]}"/></linearGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${ring === ledRing ? 9 : 14}" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  ${withBg ? '<rect width="1024" height="1024" fill="url(#bg)"/>' : ''}${ring(t)}
  <path d="${flame}" transform="translate(512 ${512 + drop}) scale(0.5) translate(-512 -572)" fill="url(#fire)"/>
</svg>`

const png = (s, file, size = 1024) => sharp(Buffer.from(s)).resize(size, size).png().toFile(file).then(() => console.log(file))
const ring = style === 'uptime' ? uptimeRing : ledRing

await png(svg(ring, themes.light, true), 'assets/icon.png')             // iOS flattens this; no transparency allowed
await png(svg(ring, themes.dark, true), 'assets/icon-dark.png')         // iOS 18+ dark icon
await png(svg(ring, themes.tinted, false), 'assets/icon-tinted.png')    // iOS 18+ tinted icon: white on transparent
await png(svg(ring, themes.light, false), 'assets/splash-icon.png', 512)
await png(svg(ring, themes.dark, false), 'assets/splash-icon-dark.png', 512)
await png(svg(ring, themes.dark, true), 'assets/favicon.png', 48)

fs.mkdirSync('design/icons', { recursive: true })
for (const [name, r] of [['led-ring', ledRing], ['uptime-ring', uptimeRing]])
  for (const mode of ['light', 'dark']) await png(svg(r, themes[mode], true), `design/icons/${name}-${mode}.png`)
