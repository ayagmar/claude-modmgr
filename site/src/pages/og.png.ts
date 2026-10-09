// The social card, drawn at build time: lib/card.ts's SVG rasterised by sharp,
// so no image is checked in and its words, the count included, can't go stale.
import type { APIRoute } from 'astro'
import sharp from 'sharp'
import { cardSvg } from '../lib/card.ts'
import { modsData } from '../lib/mods.ts'

export const GET: APIRoute = async () => {
  const svg = cardSvg((await modsData()).rows.length)
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } })
}
