// The social card: one SVG, rasterised by pages/og.png.ts and versioned by
// pages/index.astro. Link previews (Discord, Slack, X) cache an image by its
// URL, so the page names og.png with a hash of this SVG: a card whose words
// change gets a new URL, and the hash can't disagree with the image because
// both come from cardSvg.
import { createHash } from 'node:crypto'
import { countText, INSTALL } from './present.ts'

/** The card, for an index of `total` mods. */
export const cardSvg = (
  total: number,
): string => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0b0d10"/>
  <rect x="80" y="76" width="44" height="44" rx="11" fill="#d77757"/>
  <rect x="88.5" y="88.5" width="27" height="19" rx="3.5" fill="#131517"/>
  <rect x="93" y="94.5" width="9.5" height="7" rx="1.4" fill="none" stroke="#d77757" stroke-width="2.2"/>
  <text x="142" y="109" font-family="Archivo, DejaVu Sans, sans-serif" font-size="32" font-weight="700" fill="#f5f5f4">modmgr</text>
  <text x="80" y="268" font-family="Archivo, DejaVu Sans, sans-serif" font-size="84" font-weight="700" letter-spacing="-3" fill="#f5f5f4">Search ${countText(total)} mods</text>
  <text x="80" y="362" font-family="Archivo, DejaVu Sans, sans-serif" font-size="84" font-weight="700" letter-spacing="-3" fill="#f5f5f4">for Claude Code</text>
  <rect x="80" y="438" width="1040" height="100" rx="18" fill="#15191e" stroke="#2c323a" stroke-width="2"/>
  <text x="116" y="499" font-family="JetBrains Mono, DejaVu Sans Mono, monospace" font-size="28" fill="#f5f5f4"><tspan fill="#e8916f">&gt;</tspan><tspan dx="17">${INSTALL}</tspan></text>
</svg>`

/** The card's version for its URL: the first 10 hex digits of the SVG's sha256. */
export const cardVersion = (svg: string): string =>
  createHash('sha256').update(svg).digest('hex').slice(0, 10)
