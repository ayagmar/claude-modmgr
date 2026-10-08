// The social card, drawn at build time: an SVG rasterised by sharp,
// so no image is checked in and its words can't go stale.
import type { APIRoute } from 'astro'
import sharp from 'sharp'

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#d77757"/>
  <text x="80" y="120" font-family="Archivo, DejaVu Sans, sans-serif" font-size="36" font-weight="800" fill="#1c0e08">MODMGR</text>
  <text x="80" y="250" font-family="Archivo, DejaVu Sans Condensed, sans-serif" font-stretch="condensed" font-size="76" font-weight="800" fill="#1c0e08">KNOW WHAT EVERY MOD IN</text>
  <text x="80" y="335" font-family="Archivo, DejaVu Sans Condensed, sans-serif" font-stretch="condensed" font-size="76" font-weight="800" fill="#1c0e08">YOUR CLAUDE CODE CAN DO.</text>
  <rect x="80" y="410" width="1040" height="120" rx="14" fill="#131517"/>
  <text x="110" y="480" font-family="JetBrains Mono, DejaVu Sans Mono, monospace" font-size="28" fill="#dadcd6"><tspan fill="#e5926a">&gt;</tspan><tspan dx="17">/plugin</tspan> install modmgr --marketplace ayagmar/claude-mods</text>
</svg>`

export const GET: APIRoute = async () => {
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } })
}
