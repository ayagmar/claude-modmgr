// The social card, drawn at build time: an SVG rasterised by sharp,
// so no image is checked in and its words can't go stale.
import type { APIRoute } from 'astro'
import sharp from 'sharp'

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#eef0ea"/>
  <text x="80" y="150" font-family="Inter, DejaVu Sans, sans-serif" font-size="40" font-weight="700" fill="#2e6b57">modmgr</text>
  <text x="80" y="250" font-family="Inter, DejaVu Sans, sans-serif" font-size="64" font-weight="700" fill="#1d2421">Every mod in your Claude Code,</text>
  <text x="80" y="330" font-family="Inter, DejaVu Sans, sans-serif" font-size="64" font-weight="700" fill="#1d2421">and what it can do.</text>
  <rect x="80" y="400" width="1040" height="120" rx="14" fill="#151a18"/>
  <text x="120" y="472" font-family="JetBrains Mono, DejaVu Sans Mono, monospace" font-size="34" fill="#d9ded6">/plugin install modmgr --marketplace ayagmar/claude-modmgr</text>
</svg>`

export const GET: APIRoute = async () => {
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } })
}
