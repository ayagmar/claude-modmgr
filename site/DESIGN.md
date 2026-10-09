---
name: modmgr
description: The search-first store for Claude Code mods, near-black with hairlines and one orange accent, at dev-tool craft.
colors:
  bg: "#0b0d10"
  raised: "#111418"
  field: "#15191e"
  hover: "#181c22"
  line: "#20252c"
  line-strong: "#2c323a"
  text: "#f5f5f4"
  text-2: "#a7abb1"
  text-3: "#8a9098"
  accent: "#d77757"
  accent-text: "#e8916f"
  accent-ink: "#1a0c06"
  accent-wash: "rgb(215 119 87 / 0.14)"
  accent-ring: "rgb(215 119 87 / 0.22)"
  bg-light: "#fbfbfa"
  raised-light: "#f4f4f2"
  field-light: "#ffffff"
  hover-light: "#f1f1ef"
  line-light: "#e5e5e1"
  line-strong-light: "#d4d4cf"
  text-light: "#131417"
  text-2-light: "#50545a"
  text-3-light: "#62676e"
  accent-text-light: "#a8461f"
  accent-wash-light: "rgb(215 119 87 / 0.16)"
  accent-ring-light: "rgb(215 119 87 / 0.25)"
  term-bg: "#0d0f12"
  term-fg: "#dadcd6"
  term-line: "#262b31"
  t-success: "#7cc48a"
  t-warning: "#e3b65a"
  t-error: "#ec7d74"
  t-claude: "#e5926a"
  t-subtle: "#8e959a"
typography:
  display:
    fontFamily: "Archivo Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(2.25rem, 1.35rem + 3.4vw, 4rem)"
    fontWeight: 680
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Archivo Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(1.75rem, 1.35rem + 1.5vw, 2.5rem)"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Archivo Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-0.015em"
  row-name:
    fontFamily: "Archivo Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    letterSpacing: "-0.01em"
  lead:
    fontFamily: "Archivo Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Archivo Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "\"kern\""
  label:
    fontFamily: "Archivo Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
  caption:
    fontFamily: "Archivo Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
  mono:
    fontFamily: "JetBrains Mono Variable, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  mark: "3px"
  xs: "5px"
  sm: "7px"
  md: "8px"
  row: "10px"
  lg: "12px"
  field: "14px"
  pill: "999px"
spacing:
  row-inset: "0.75rem"
  control: "2rem"
  section: "clamp(4rem, 2.5rem + 5vw, 7.5rem)"
  wrap: "68rem"
  results: "60rem"
  board: "76rem"
components:
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 0.7rem"
    height: "2rem"
  button-quiet-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.text}"
  button-copied:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
  search-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "0 7rem 0 3.1rem"
    height: "3.5rem"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 0.8rem"
    height: "2rem"
  chip-selected:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.text}"
  sort-select:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 1.9rem 0 0.7rem"
    height: "2rem"
  result-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.row}"
    padding: "0.7rem 8.5rem 0.7rem 0.75rem"
  result-row-hover:
    backgroundColor: "{colors.hover}"
  result-row-open:
    backgroundColor: "{colors.raised}"
  result-row-selected:
    backgroundColor: "{colors.field}"
  datasheet:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "1.125rem 1.125rem 1rem"
    width: "clamp(21.5rem, 4rem + 22vw, 23rem)"
  datasheet-chip:
    backgroundColor: "{colors.line-strong}"
    rounded: "{rounded.mark}"
    width: "2rem"
  datasheet-pin-on:
    backgroundColor: "{colors.text}"
    textColor: "{colors.text}"
  datasheet-pin-off:
    backgroundColor: "transparent"
    textColor: "{colors.text-3}"
  badge:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text-2}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: "0 0.4rem"
  tag:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: "0 0.4rem"
  match-mark:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.accent-text}"
    rounded: "{rounded.mark}"
  command-block:
    backgroundColor: "{colors.field}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: "0.6rem 0.75rem"
  pager-link:
    textColor: "{colors.text-2}"
    rounded: "{rounded.sm}"
    padding: "0 0.55rem"
    size: "2rem"
  pager-current:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
  stepper:
    backgroundColor: "{colors.raised}"
    rounded: "{rounded.row}"
    padding: "0.25rem"
  stepper-tab:
    textColor: "{colors.text-2}"
    rounded: "{rounded.sm}"
    padding: "0 0.85rem 0 0.6rem"
    height: "2rem"
  stepper-tab-active:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
  terminal-window:
    backgroundColor: "{colors.term-bg}"
    textColor: "{colors.term-fg}"
    rounded: "{rounded.lg}"
  install-line:
    backgroundColor: "{colors.field}"
    typography: "{typography.mono}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 0.5rem 0.5rem 1.1rem"
  code-inline:
    backgroundColor: "{colors.raised}"
    typography: "{typography.mono}"
    rounded: "{rounded.xs}"
    padding: "0.1em 0.35em"
  kbd:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text-2}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    height: "1.35rem"
---

# Design System: modmgr

## Overview

**Creative North Star: "The Store at the Prompt"**

The page is a search tool before it is a page. A near-black ground, two or three surface steps above it, 1px hairlines, warm off-white type and a single Claude-orange accent: the category standard for developer tools, played straight and held to exact type and spacing. The first viewport is a slim nav, a centred two-line headline carrying the live mod count, a large search field focused on load, filter chips, and the first dense rows of results. Everything below (the `/mods` dialog, the honesty block, the install line) is set left on one section rhythm and stays as quiet as the results.

Density is a dev-tool list's, not a marketing page's: rows of about 70px, 13px meta type, tabular numbers, actions that stay dim until the row is pointed at or focused. Depth comes from surface steps and hairlines, never from shadow. Light mode, from `prefers-color-scheme`, is an equal re-tune of the same tokens, not an afterthought; the terminal window stays dark in both themes because the real terminal is dark.

The keyboard is a first-class path: `/` and Ctrl K (⌘K on Apple platforms) focus search, arrow keys move between rows, Enter opens one inline (on a wide screen, where the datasheet already shows the focused row, Enter copies its install line; Escape inside the datasheet returns to the row), `[` and `]` turn the page. Without script the page still paints the first 40 mods, the rows still open (native `details`), the datasheet shows the first of them and steps aside (keeping its space) while another row is open inline, the dialog stepper still switches (CSS radio group), and the nav's install button becomes a link to the install section.

**Key Characteristics:**
- Near-black ground with tonal surface steps and 1px hairlines; no ambient shadow.
- One accent, Claude orange, for focus, matches, selected state and the copy confirmation.
- Archivo Variable at normal width for everything read; JetBrains Mono for repos, commands, keys and the terminal.
- Search-first first viewport, dense results list; a datasheet beside it on a wide screen, inline expansion on a narrow one.
- Motion is short, eased on one curve, transform and opacity only, and gated on reduced-motion preference.

## Colors

A cool near-black neutral ramp carrying one warm accent; the light theme swaps the neutrals and darkens the accent's text tone, leaving the accent fill unchanged.

### Primary
- **Claude Ember** (`accent`): the only chromatic UI color. It fills the copy button's confirmed state, the active step's number disc, text selection, and the brand mark; it draws the 2px focus outline, the search field's focused border, the text caret, and the checked chip's check. Never a resting fill on a control.
- **Ember Text** (`accent-text`, `accent-text-light`): the accent when it must read as text: the search-match highlight, the checked-chip check icon, the `> ` prompt before the install line. Darkened to a burnt sienna in light mode for contrast.
- **Ember Wash and Ring** (`accent-wash`, `accent-ring`): translucent accent. The wash backs search-match `mark`s and checked chips (whose border is the accent at 55% alpha); the ring is the 3px focus halo on the search field only.
- **Ember Ink** (`accent-ink`): text on an accent fill (copied button, active step number, selection).

### Neutral
- **Night Ground** (`bg` / `bg-light`): the page.
- **Raised Slate** (`raised` / `raised-light`): the open result row, badges, inline code, `kbd`, the stepper track, and the full-width honesty band.
- **Field Slate** (`field` / `field-light`): anything you type into or that holds a command: search field, sort select, command block, install line, current page, active step tab; also the selected row beside the datasheet, one step above a hovered row. In light mode it is pure white, the lightest surface.
- **Hover Slate** (`hover` / `hover-light`): pointer and keyboard hover on rows, chips, quiet buttons and page links.
- **Hairline** (`line` / `line-light`): section borders, nav and footer borders, open-row inset, badge borders, quiet actions at rest.
- **Strong Hairline** (`line-strong` / `line-strong-light`): borders of interactive controls (buttons, chips, select, field, tags, kbd), dividers between honesty items, link underlines.
- **Off-white Text** (`text` / `text-light`): headings, names, values.
- **Secondary Text** (`text-2` / `text-2-light`): descriptions, subheads, meta, nav links, control labels.
- **Tertiary Text** (`text-3` / `text-3-light`): repos, placeholders, icons at rest, footnotes, the about line, detail-panel labels.

### Terminal (both themes)
- **Terminal Ground / Foreground / Line** (`term-bg`, `term-fg`, `term-line`) and the tone set (`t-success`, `t-warning`, `t-error`, `t-claude`, `t-subtle`): reserved for the `/mods` dialog window, matching the colors the real dialog draws. They never appear outside the window.

### Named Rules
**The One Ember Rule.** Orange is the only hue in the UI chrome, and it means "focused, matched, chosen or done". It is never a resting background on a button, chip or section.

**The Terminal Stays Dark Rule.** The dialog window keeps its dark terminal palette in light mode; only the page around it re-tunes.

## Typography

**Display Font:** Archivo Variable, normal width, weights 400 to 700 (with system-ui, -apple-system, Segoe UI)
**Body Font:** Archivo Variable
**Label/Mono Font:** JetBrains Mono Variable (with ui-monospace, SF Mono, Menlo)

**Character:** A neutral grotesque set tight and heavy at the top and plain below; the mono is reserved for literal things a person types or copies. Both are self-hosted and subset to the page's characters.

### Hierarchy
- **Display** (680, `clamp(2.25rem, 1.35rem + 3.4vw, 4rem)`, 1.02, -0.03em): the hero headline only, set as two block lines so the fallback breaks where Archivo does.
- **Headline** (650, `clamp(1.75rem, 1.35rem + 1.5vw, 2.5rem)`, 1.1, -0.035em): section headings; the install heading steps up to `clamp(2rem, 1.5rem + 2vw, 3rem)`.
- **Title** (650, 1.0625rem, -0.015em): honesty-block item headings.
- **Lead** (400, 1.0625rem, 1.55): section intros and the install subhead, max about 40rem; the hero subhead is `clamp(1rem, 0.95rem + 0.25vw, 1.125rem)`.
- **Row name** (600, 0.9375rem, -0.01em): a mod's name in a result row.
- **Body** (400, 1rem, 1.55): running text; 0.875rem for row descriptions and detail lists, 0.9375rem in the honesty block.
- **Label** (500 to 550, 0.8125rem): buttons, chips, sort, count, pager, footer, facts.
- **Caption** (0.75rem): badges, tags, `kbd`, keyboard hints; detail-panel labels at 600 in tertiary text, sentence case.
- **Mono** (400 to 500, 0.8125rem): repo names, command blocks, the nav install button, the window title; the install line runs `clamp(0.8125rem, 0.75rem + 0.3vw, 0.9375rem)`.

### Named Rules
**The Typed-Literal Rule.** Mono only for what is typed, copied or shown by a terminal, always with ligatures off so `--flag` reads as typed.

**The Tabular Count Rule.** Every number that changes or lines up (count, range, stars, page numbers, step numbers) uses tabular figures.

## Layout

One centred column: `min(100% - 2rem, 68rem)`, narrowed to 60rem for the results so rows stay scannable. From 68.75rem the results widen to a 76rem board of two columns: the list (`minmax(0, 1fr)`) and the datasheet (`clamp(21.5rem, 4rem + 22vw, 23rem)`), 1.75rem apart. The hero, the search (max 46rem) and the install section are centred; the results, the dialog section and the honesty block are left-aligned with headings at max 40rem.

Rhythm: the nav is 3.5rem tall; controls are 2rem tall (buttons, chips, select, page links, step tabs) except the 3.5rem search field and the 2.25rem install copy button. Rows and the results head share a 0.75rem horizontal inset so text aligns from count to description. The three lower sections share `clamp(4rem, 2.5rem + 5vw, 7.5rem)` block padding; the honesty block becomes a two-column grid (`1fr 1.5fr`) from 56rem. The inline detail panel is a two-column grid (`1fr 1.35fr`) that collapses to one column on phones.

Breakpoints observed: 68.75rem (the results board and its datasheet; rows drop their Copy and GitHub actions and no longer open inline), 40rem (phone: nav install shrinks to an icon, search hints hide, row head wraps with repo and badges on their own lines, description clamps to two lines, Copy becomes icon-only, the dialog frame scrolls sideways and opens on its detail column), 23.5rem (wordmark text hides), 56rem (honesty grid), 64rem (keyboard hint row appears).

## Elevation & Depth

Flat. Depth is carried by tonal surface steps (ground, raised, field, hover) and 1px hairlines, including inset hairlines drawn with `box-shadow: inset 0 0 0 1px` on the open row, the selected row (strong hairline), the focused row (accent) and the current page. Only two real lifts exist, both state responses.

### Shadow Vocabulary
- **Step lift** (`box-shadow: 0 0 0 1px var(--line-strong), 0 1px 2px rgb(0 0 0 / 0.2)`): the active tab of the dialog stepper.
- **Search focus ring** (`box-shadow: 0 0 0 3px var(--accent-ring)`): the search field while focused, with its border turned accent.

### Named Rules
**The Hairline Rule.** A surface separates by one step of tone and one 1px line. If something seems to need a drop shadow, it needs a surface step instead.

## Shapes

Softly rounded rectangles, radius growing with the element's size: 3px on match marks, 5px on badges, tags, inline code and `kbd`, 7px on page links and step tabs, 8px on buttons, select and command blocks, 10px on result rows and the stepper track, 12px on the terminal window and install line, 14px on the search field. Filter chips are full pills; the step number is a circle. Borders are always 1px.

## Components

### Buttons
Quiet and outlined; the accent appears only once the action has happened.
- **Shape:** gently rounded (8px), 2rem tall, 1px strong-hairline border, transparent fill.
- **Default:** secondary-text label at 0.8125rem/550 with a 1em stroked SVG icon; icon-only variants are 2rem square.
- **Hover / Focus:** text brightens and the hover surface fills; 2px accent outline at 2px offset on focus; presses scale to 0.96.
- **Copied:** for 1.6s the button fills accent with accent-ink text and its label reads "Copied" ("Select it" if the clipboard refuses), announced through a polite status region.
- **Row actions:** below 68.75rem, Copy and GitHub sit at the row's top right (above it they live on the datasheet), dimmed (tertiary text, hairline border) at rest and brought up on row hover, focus or open.
- **Nav install:** the same quiet button in mono, reading `/plugin install modmgr` and copying the full line; icon-only on phones.

### Chips
- **Style:** pill, 2rem tall, strong-hairline border, secondary text, transparent.
- **State:** checked fills with the accent wash, borders with accent at 55% alpha, brightens the text and shows a check icon in ember text. They are visually hidden checkboxes behind labels.

### Inputs / Fields
- **Search:** 3.5rem tall, field surface, strong-hairline border, 14px radius, search icon inset left, `/` and Ctrl K `kbd` hints inset right (hidden on phones), accent caret, autofocused.
- **Focus:** border turns accent with a 3px accent-ring halo.
- **Sort select:** 2rem, field surface, 8px radius, custom chevron, labelled "Sort" in secondary text.

### Navigation
Slim 3.5rem bar with a bottom hairline: brand mark and lowercase wordmark at 650, three text links in secondary text that brighten on hover, the copy install button pushed right.

### Results head and pager
The head carries the live range ("1–40 of N mods", polite live region, tabular), the keyboard hint row from 64rem, and the sort. The pager sits under a hairline: range on the left, Prev, numbered 2rem links with ellipsis gaps and Next on the right; the current page is a field surface with an inset strong hairline, disabled ends fade to 60%.

### Result rows
Native `details`/`summary`, one open at a time. The head line holds name (one line from 40rem, with an ellipsis only when the row can't hold it), repo in mono (takes what is left and truncates, keeping at least 6rem), Clone or validation tags (outlined), then reach badges (raised fill, hairline; the notable badge gets a strong hairline, full text and a diamond icon) and stars with a star icon, pushed right as one group. When the line can't hold that group it moves down a line whole, still right-aligned (a few rows at 1440, more at tablet widths); a reach badge is never dropped. The description runs the full width below on one truncated line, so every row cuts at the same place. Hover and keyboard focus fill the hover surface; focus adds an inset accent hairline; open fills raised with an inset hairline. On a wide screen hover drops to the raised surface and the selected row steps up to the field surface with an inset strong hairline, so a resting pointer never reads as a second choice.

### Inline detail panel
Opens under the row's head with a 0.24s fade and 4px rise. Left column: "What it can reach" in words, then notable lines each led by a diamond. Right column: the install line in a mono command block, a sentence on what it does, and facts (validation, last push, GitHub link). Labels are 0.75rem/600 tertiary text, sentence case.

### Datasheet
On a wide screen the selected mod sits beside the list in a sticky panel (`section`, labelled "Selected mod"; its changes go unannounced): raised surface, 1px hairline, 12px radius, 1rem from the viewport top, at least `min(41rem, 100vh - 2rem)` tall so it holds its frame from one mod to the next, scrolling inside itself when the screen is shorter. Selection follows focus and arrow keys, a click or tap, and a mouse resting 120ms on a row (only the pointer moving counts); the panel swaps at once, with no fade, as a detail pane does. It reads top to bottom: the name (1.25rem/650), the repo path in tertiary mono, the description clamped to four lines in a fixed four-line box, then parts split by hairlines.
- **What it can reach:** the seven reaches as a chip's pins, drawn in CSS: a 2rem package in the strong-hairline tone with a pin-1 notch, pins 1–4 (`REACH_LABEL` order) down its left and 5–7 down its right, each a 0.6rem pad on a lead against the package. A reached pin fills its pad and sets its label in primary text at 550; the rest are hollow pads in tertiary text. Each pin says ": yes" or ": no" to assistive tech.
- **Notable:** the dialog's lines, each led by a diamond, or "Nothing notable" in tertiary text.
- **Facts:** a two-column `dl` (Validate, Stars, Last push, Installs) with caption labels and tabular values.
- **Install:** pinned to the panel's foot (sticky inside its scroll): the command block behind the ember `> ` prompt, with each flag kept with its value when it wraps, the sentence on what it does, then Copy (primary text, carrying an `Enter` key since Enter on a row does the same) and Open on GitHub as quiet buttons.
Below 68.75rem it is not shown; rows open inline instead.

### The `/mods` dialog window (signature)
A segmented stepper (Discover, Review, Installed) over a terminal window. The stepper is a raised track with 7px tabs; the active tab lifts onto the field surface and its numbered disc fills accent. The window is the terminal palette with a 2.25rem title bar (three muted dots, `claude · /mods` centred in mono) and a hairline below. Its frame is real dialog output in a `pre` whose font size fits the frame's columns to the window width (a cell is 0.6em; capped at 1.1rem); glyphs outside the font are pinned to one cell. On phones the frame stays at 0.6rem, scrolls sideways and opens on its detail column. A caption bar under a terminal hairline names the step. Switching steps cross-fades the frame (0.4s) with the caption following 60ms later.

### Honesty block
A full-width raised band with hairlines top and bottom: heading and intro on the left, four claims on the right separated by strong hairlines, each a title plus a secondary-text sentence.

### Install line
Centred, max 40rem: field surface, strong hairline, 12px radius, the full mono line prefixed by an ember `> ` prompt and wrapping only between flags, with a 2.25rem copy button at its right.

### Footer
Hairline above, license line left and three links right in tertiary text at 0.8125rem.

## Do's and Don'ts

### Do:
- **Do** separate surfaces with one tonal step and a 1px hairline (`line` for structure, `line-strong` for controls).
- **Do** keep orange to focus, search matches, checked chips, the active step and the copied state.
- **Do** set repos, commands, keys and terminal output in JetBrains Mono with ligatures off, and everything else in Archivo Variable at normal width.
- **Do** use tabular figures for counts, ranges, stars and page numbers.
- **Do** animate only transform, opacity and color, on `cubic-bezier(0.16, 1, 0.3, 1)`, 0.12 to 0.4s, inside `prefers-reduced-motion: no-preference`.
- **Do** keep every control reachable by keyboard and every core path (rows, stepper, install line) working without script.
- **Do** re-tune neutrals for light mode at equal care and leave the terminal window dark.

### Don't:
- **Don't** add drop shadows beyond the step lift and the search focus ring.
- **Don't** fill a resting button, chip or section with the accent.
- **Don't** add glows, gradient blobs, glass or icon feature cards.
- **Don't** use mono for prose or Archivo for something a person types.
- **Don't** introduce a second accent hue in the page chrome; the terminal tones stay inside the window.
