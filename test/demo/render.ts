// Draws an element tree from ui/ (Box, Text, Button, Input, Select) as lines of
// styled text at a fixed width, close enough to the terminal's own drawing for
// the landing page's mock: rows and columns, fixed widths, gaps, padding,
// borders, wrapping rows, space-between and flex-end, a grown child filling a
// fixed height, clipped heights, hidden boxes, truncated and wrapped text. It
// is not Ink; it only has to draw what modmgr's views use.

export type Segment = {
  readonly text: string
  readonly tone?: string
  readonly bold?: true
  readonly dim?: true
  readonly underline?: true
  /** The focus ring sits on it (the element drawn with `autoFocus`). */
  readonly ring?: true
}
export type Line = Segment[]

type Props = Readonly<Record<string, unknown>>
type Node = { readonly type: unknown; readonly props: Props | null; readonly children: unknown[] }

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && 'type' in value && 'children' in value

/** The JSX factory the plugin's modules compile against (`jsxFactory: h`). */
export const installJsx = (): void => {
  const flat = (children: unknown[]): unknown[] =>
    children.flatMap(child => (Array.isArray(child) ? flat(child) : [child]))
  const globals = globalThis as Record<string, unknown>
  globals.h = (type: unknown, props: Props | null, ...children: unknown[]): Node => ({
    type,
    props,
    children: flat(children),
  })
  globals.Fragment = 'Fragment'
}

/** The element table a view draws with: the tags, as strings. */
export const ELEMENTS = {
  Box: 'Box',
  Text: 'Text',
  Button: 'Button',
  Input: 'Input',
  Select: 'Select',
} as const

const widthOf = (line: Line): number => line.reduce((sum, seg) => sum + [...seg.text].length, 0)

const pad = (line: Line, width: number): Line => {
  const missing = width - widthOf(line)
  return missing > 0 ? [...line, { text: ' '.repeat(missing) }] : line
}

/** Cuts a line to `width` cells, ending in `…` when something was cut. */
const cut = (line: Line, width: number): Line => {
  if (widthOf(line) <= width) return line
  const out: Line = []
  let left = Math.max(0, width - 1)
  for (const seg of line) {
    const chars = [...seg.text]
    if (chars.length <= left) {
      out.push(seg)
      left -= chars.length
      continue
    }
    if (left > 0) out.push({ ...seg, text: chars.slice(0, left).join('') })
    break
  }
  return width > 0 ? [...out, { text: '…' }] : out
}

const styleOf = (props: Props): Omit<Segment, 'text'> => ({
  ...(typeof props.color === 'string' ? { tone: props.color } : {}),
  ...(props.bold === true ? { bold: true as const } : {}),
  ...(props.dimColor === true ? { dim: true as const } : {}),
  ...(props.underline === true ? { underline: true as const } : {}),
})

const textOf = (children: readonly unknown[]): string =>
  children
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : isNode(child)
          ? textOf(child.children)
          : '',
    )
    .join('')

/** Word-wraps `text` to `width`. */
const wrap = (text: string, width: number): string[] => {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let current = ''
    for (const word of paragraph.split(' ')) {
      const next = current === '' ? word : `${current} ${word}`
      if ([...next].length <= width || current === '') current = next
      else {
        lines.push(current)
        current = word
      }
    }
    lines.push(current)
  }
  return lines.flatMap(line => {
    const chars = [...line]
    if (chars.length <= width || width <= 0) return [line]
    const parts: string[] = []
    for (let i = 0; i < chars.length; i += width) parts.push(chars.slice(i, i + width).join(''))
    return parts
  })
}

const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined)

/** Draws `node` in at most `width` cells; each line is at most `width` long. */
export const render = (node: unknown, width: number): Line[] => {
  if (node === null || node === undefined || node === false || node === true) return []
  if (typeof node === 'string' || typeof node === 'number') return [[{ text: String(node) }]]
  if (Array.isArray(node)) return node.flatMap(child => render(child, width))
  if (!isNode(node)) return []
  const props = node.props ?? {}
  switch (node.type) {
    case 'Text': {
      const text = textOf(node.children)
      const style = styleOf(props)
      // Blank text keeps its width, as Ink draws it.
      if (text !== '' && text.trim() === '') return [[{ ...style, text }]]
      if (props.wrap === 'truncate-end' || props.wrap === 'truncate') {
        return [cut([{ ...style, text }], width)]
      }
      return wrap(text, width).map(line => [{ ...style, text: line }])
    }
    case 'Button': {
      const hotkey = typeof props.hotkey === 'string' ? `${props.hotkey}: ` : ''
      const label = typeof props.label === 'string' ? props.label : ''
      const style = {
        ...styleOf(props),
        ...(props.autoFocus === true ? { ring: true as const } : {}),
      }
      return [cut([{ ...style, text: `${hotkey}${label}` }], width)]
    }
    case 'Input': {
      const value = typeof props.value === 'string' && props.value !== '' ? props.value : undefined
      const placeholder = typeof props.placeholder === 'string' ? props.placeholder : ''
      return [
        cut([{ text: value ?? placeholder, ...(value ? {} : { dim: true as const }) }], width),
      ]
    }
    case 'Select': {
      const options = Array.isArray(props.options)
        ? (props.options as { value: string; label: string }[])
        : []
      const chosen = options.find(option => option.value === props.value)?.label ?? ''
      return [
        cut(
          [{ text: `${String(props.label ?? '')}: ` }, { text: `${chosen} ▾`, tone: 'claude' }],
          width,
        ),
      ]
    }
    case 'Box':
    case 'Fragment':
      return box(node, props, width)
    default:
      return []
  }
}

type Block = { readonly lines: Line[]; readonly width: number }

const BORDERS: Readonly<Record<string, string>> = { round: '╭╮╰╯─│', single: '┌┐└┘─│' }

const box = (node: Node, props: Props, available: number): Line[] => {
  if (props.display === 'none') return []
  const outer = Math.min(num(props.width) ?? available, available)
  const border = typeof props.borderStyle === 'string' ? BORDERS[props.borderStyle] : undefined
  const left = (num(props.paddingLeft) ?? num(props.paddingX) ?? 0) + (border ? 1 : 0)
  const right = (num(props.paddingRight) ?? num(props.paddingX) ?? 0) + (border ? 1 : 0)
  const width = Math.max(0, outer - left - right)
  const children = node.children.filter(
    child => child !== null && child !== undefined && child !== false,
  )
  const height = num(props.height)
  let lines: Line[]
  if (node.type === 'Fragment' || props.flexDirection === 'column') {
    lines = column(children, width, height)
  } else {
    lines = row(children, props, width)
  }
  if (height !== undefined && props.overflow === 'hidden') lines = lines.slice(0, height)
  if (props.justifyContent === 'flex-end' && props.flexDirection !== 'column') {
    lines = lines.map(line => [{ text: ' '.repeat(Math.max(0, width - widthOf(line))) }, ...line])
  }
  if (border !== undefined) {
    const [tl, tr, bl, br, h, v] = [...border]
    const edge = (props.borderDimColor === true ? { dim: true } : {}) as Omit<Segment, 'text'>
    const padL = ' '.repeat(left - 1)
    const padR = ' '.repeat(right - 1)
    lines = [
      [{ ...edge, text: `${tl}${(h ?? '').repeat(width + left + right - 2)}${tr}` }],
      ...lines.map(line => [
        { ...edge, text: v ?? '' },
        { text: padL },
        ...pad(cut(line, width), width),
        { text: padR },
        { ...edge, text: v ?? '' },
      ]),
      [{ ...edge, text: `${bl}${(h ?? '').repeat(width + left + right - 2)}${br}` }],
    ]
  } else if (left > 0) {
    lines = lines.map(line => [{ text: ' '.repeat(left) }, ...line])
  }
  return num(props.width) === undefined ? lines : lines.map(line => pad(cut(line, outer), outer))
}

/** Children stacked; with a fixed height, a growing child takes the rows the others leave. */
const column = (
  children: readonly unknown[],
  width: number,
  height: number | undefined,
): Line[] => {
  const grows = (child: unknown) => isNode(child) && child.props?.flexGrow === 1
  const drawn = children.map(child => (grows(child) ? undefined : render(child, width)))
  const used = drawn.reduce((sum, lines) => sum + (lines?.length ?? 0), 0)
  return children.flatMap((child, index) => {
    const lines = drawn[index]
    if (lines !== undefined) return lines
    const own = render(child, width)
    if (height === undefined) return own
    const room = Math.max(own.length, height - used)
    return [...own, ...Array.from({ length: room - own.length }, (): Line => [])]
  })
}

/** Lays children side by side, wrapping onto new rows when the box says so. */
const row = (children: readonly unknown[], props: Props, width: number): Line[] => {
  const gap = num(props.columnGap) ?? num(props.gap) ?? 0
  const growing = children.filter(child => isNode(child) && child.props?.flexGrow === 1)
  // Natural widths first: fixed boxes take their width, the rest what they draw in what's left.
  const blocks: (Block | undefined)[] = children.map(child => {
    if (growing.includes(child)) return undefined
    const fixed = isNode(child) ? num(child.props?.width) : undefined
    const lines = render(child, fixed ?? width)
    return { lines, width: fixed ?? Math.max(0, ...lines.map(widthOf)) }
  })
  const used =
    blocks.reduce((sum, block) => sum + (block?.width ?? 0), 0) +
    gap * Math.max(0, children.length - 1)
  const share = growing.length === 0 ? 0 : Math.max(0, Math.floor((width - used) / growing.length))
  const all: Block[] = children.map((child, index) => {
    const block = blocks[index]
    if (block !== undefined) return block
    return { lines: render(child, share), width: share }
  })
  // Rows of blocks: one unless the box wraps.
  const rows: Block[][] = [[]]
  let filled = 0
  for (const block of all) {
    const current = rows[rows.length - 1] as Block[]
    const need = current.length === 0 ? block.width : filled + gap + block.width
    if (props.flexWrap === 'wrap' && current.length > 0 && need > width) {
      rows.push([block])
      filled = block.width
    } else {
      current.push(block)
      filled = need
    }
  }
  return rows.flatMap(blocksOfRow => {
    const height = Math.max(0, ...blocksOfRow.map(block => block.lines.length))
    const total = blocksOfRow.reduce((sum, block) => sum + block.width, 0)
    const spread =
      props.justifyContent === 'space-between' && blocksOfRow.length > 1
        ? Math.max(gap, Math.floor((width - total) / (blocksOfRow.length - 1)))
        : gap
    const lines: Line[] = []
    for (let i = 0; i < height; i += 1) {
      const line: Line = []
      blocksOfRow.forEach((block, index) => {
        if (index > 0) line.push({ text: ' '.repeat(spread) })
        const own = block.lines[i] ?? []
        line.push(...(index === blocksOfRow.length - 1 ? own : pad(own, block.width)))
      })
      lines.push(cut(line, width))
    }
    return lines
  })
}

/** Joins a line's adjacent segments of one style, and drops trailing spaces. */
export const tidy = (line: Line): Line => {
  const out: Segment[] = []
  for (const seg of line) {
    const last = out.at(-1)
    const same =
      last !== undefined &&
      last.tone === seg.tone &&
      last.bold === seg.bold &&
      last.dim === seg.dim &&
      last.underline === seg.underline &&
      last.ring === seg.ring
    if (same) out[out.length - 1] = { ...last, text: last.text + seg.text }
    else if (seg.text !== '') out.push(seg)
  }
  const end = out.at(-1)
  if (end !== undefined && end.ring === undefined && end.text.trimEnd() !== end.text) {
    const trimmed = end.text.trimEnd()
    if (trimmed === '') out.pop()
    else out[out.length - 1] = { ...end, text: trimmed }
  }
  return out
}
