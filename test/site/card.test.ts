// The social card's URL version (site/src/lib/card.ts): link previews cache
// og.png by URL, so the version must follow the drawn card exactly.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { cardSvg, cardVersion } from '../../site/src/lib/card.ts'

describe('the social card', () => {
  it('is versioned by the sha256 of the SVG og.png rasterises', () => {
    // Catches a version taken from anything but the drawn card (a build date,
    // a constant), which would leave Discord showing the old card.
    const svg = cardSvg(2923)
    expect(svg).toContain('Search 2,923 mods')
    expect(cardVersion(svg)).toBe(createHash('sha256').update(svg).digest('hex').slice(0, 10))
    expect(cardVersion(svg)).toMatch(/^[0-9a-f]{10}$/)
  })

  it('gets a new version when its words change, and keeps it when they do not', () => {
    // Catches a card whose count moved while its URL stayed put (stale previews),
    // and a version that changes every build (previews never cached).
    expect(cardVersion(cardSvg(2923))).not.toBe(cardVersion(cardSvg(2924)))
    expect(cardVersion(cardSvg(2923))).toBe(cardVersion(cardSvg(2923)))
  })
})
