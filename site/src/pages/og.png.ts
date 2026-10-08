// The social card, drawn at build time: an SVG rasterised by sharp, so no
// image is checked in and its words, the count included, can't go stale.
import type { APIRoute } from 'astro'
import sharp from 'sharp'
import { modsData } from '../lib/mods.ts'
import { countText, INSTALL } from '../lib/present.ts'

export const GET: APIRoute = async () => {
  const total = countText((await modsData()).rows.length)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0b0d10"/>
  <rect x="80" y="76" width="44" height="44" rx="11" fill="#d77757"/>
  <rect x="88.5" y="88.5" width="27" height="19" rx="3.5" fill="#131517"/>
  <rect x="93" y="94.5" width="9.5" height="7" rx="1.4" fill="none" stroke="#d77757" stroke-width="2.2"/>
  <text x="142" y="109" font-family="Archivo, DejaVu Sans, sans-serif" font-size="32" font-weight="700" fill="#f5f5f4">modmgr</text>
  <text x="80" y="268" font-family="Archivo, DejaVu Sans, sans-serif" font-size="84" font-weight="700" letter-spacing="-3" fill="#f5f5f4">Search ${total} mods</text>
  <text x="80" y="362" font-family="Archivo, DejaVu Sans, sans-serif" font-size="84" font-weight="700" letter-spacing="-3" fill="#f5f5f4">for Claude Code</text>
  <rect x="80" y="438" width="1040" height="100" rx="18" fill="#15191e" stroke="#2c323a" stroke-width="2"/>
  <text x="116" y="499" font-family="JetBrains Mono, DejaVu Sans Mono, monospace" font-size="28" fill="#f5f5f4"><tspan fill="#e8916f">&gt;</tspan><tspan dx="17">${INSTALL}</tspan></text>
</svg>`
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } })
}
