// Renders the app icon (a flame inside a hearth's arch, paper on black, a sibling to Tally's mark) and the splash
// mark. Run after changing the mark: node scripts/icons.mjs
import sharp from 'sharp'

const mark = (color) => `
  <path d="M252 780 V470 A260 260 0 0 1 772 470 V780" stroke="${color}" stroke-width="64" stroke-linecap="round"
    stroke-linejoin="round" fill="none"/>
  <path d="M512 404 C560 478 628 520 628 610 C628 680 576 732 512 732 C448 732 396 680 396 610 C396 560 424 530 450 500
    C458 540 476 560 500 566 C488 510 486 456 512 404 Z" fill="${color}"/>
  <line x1="200" y1="780" x2="824" y2="780" stroke="${color}" stroke-width="64" stroke-linecap="round"/>`
const svg = (bg, color) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : ''}${mark(color)}</svg>`

const out = async (file, s, size = 1024) => { await sharp(Buffer.from(s)).resize(size, size).png().toFile(`assets/${file}`); console.log(file) }
await out('icon.png', svg('#000000', '#f4f2ee'))                 // iOS flattens this; no transparency allowed
await out('icon-dark.png', svg(null, '#f4f2ee'))                 // iOS 18+ dark icon: transparent background
await out('icon-tinted.png', svg(null, '#ffffff'))               // iOS 18+ tinted icon: white on transparent
await out('splash-icon.png', svg(null, '#000000'), 512)
await out('splash-icon-dark.png', svg(null, '#f4f2ee'), 512)
await out('favicon.png', svg('#000000', '#f4f2ee'), 48)
