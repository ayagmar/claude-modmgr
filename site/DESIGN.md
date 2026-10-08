---
name: modmgr
description: A field guide to the mods in your Claude Code, set as specimen plates with numbered field marks.
colors:
  cover: "#d77757"
  cover-ink: "#1c0e08"
  cover-muted: "#3b170a"
  cover-rule: "#b25a3d"
  mark: "#d77757"
  mark-ink: "#1c0e08"
  paper: "#f1f2ee"
  sheet: "#fbfbf9"
  ink: "#18191b"
  muted: "#545a5e"
  rule: "#cfd2cc"
  code-bg: "#e3e5df"
  term-bg: "#131517"
  term-fg: "#dadcd6"
  term-rule: "#2b2f33"
  band: "#131517"
  paper-dark: "#141517"
  sheet-dark: "#1b1d20"
  ink-dark: "#e8e7e2"
  muted-dark: "#a3a7a9"
  rule-dark: "#2e3236"
  code-bg-dark: "#24272b"
  term-bg-dark: "#0c0d0f"
  band-dark: "#202327"
  t-success: "#7cc48a"
  t-warning: "#e3b65a"
  t-error: "#ec7d74"
  t-claude: "#e5926a"
  t-subtle: "#8e959a"
typography:
  display:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "clamp(2.6rem, 1.2rem + 4.4vw, 5.25rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 68"
  display-close:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "clamp(2.2rem, 1.2rem + 4vw, 4.2rem)"
    fontWeight: 750
    lineHeight: 0.95
    letterSpacing: "0.005em"
    fontVariation: "'wdth' 68"
  headline:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "clamp(1.6rem, 1.1rem + 2vw, 2.6rem)"
    fontWeight: 750
    lineHeight: 1.05
    letterSpacing: "0.005em"
    fontVariation: "'wdth' 72"
  plate-title:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "clamp(1.35rem, 1.1rem + 1vw, 1.8rem)"
    fontWeight: 750
    lineHeight: 1.1
    fontVariation: "'wdth' 72"
  title:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
    fontVariation: "'wdth' 100"
  lead:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "clamp(1.05rem, 1rem + 0.3vw, 1.2rem)"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 650
    letterSpacing: "0.03em"
    fontVariation: "'wdth' 85"
  label-small:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 750
    letterSpacing: "0.06em"
    fontVariation: "'wdth' 85"
  numeral:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.85em"
    fontWeight: 750
    lineHeight: 1
    fontFeature: "'tnum'"
  caution-numeral:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1.6rem"
    fontWeight: 800
    lineHeight: 1.1
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 68"
  mono-frame:
    fontFamily: "JetBrains Mono Variable, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "clamp(0.66rem, 0.4rem + 0.55vw, 0.86rem)"
    fontWeight: 400
    lineHeight: 1.5
  mono-install:
    fontFamily: "JetBrains Mono Variable, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "clamp(0.88rem, 0.8rem + 0.3vw, 1rem)"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  focus: "2px"
  cell: "4px"
  key: "5px"
  line: "10px"
  plate: "12px"
  pill: "999px"
spacing:
  wrap: "min(100% - 2rem, 76rem)"
  measure: "66ch"
  section-block: "clamp(3.5rem, 2rem + 5vw, 6.5rem)"
  cover-overlap: "6.5rem"
  cell-width: "1ch"
  cell-height: "1.5em"
components:
  install-line:
    backgroundColor: "{colors.term-bg}"
    textColor: "{colors.term-fg}"
    typography: "{typography.mono-install}"
    rounded: "{rounded.line}"
    padding: "0.95rem 1.1rem"
  install-copy:
    textColor: "{colors.term-fg}"
    typography: "{typography.label}"
    padding: "0 1.15rem"
  install-copy-hover:
    backgroundColor: "{colors.cover}"
    textColor: "{colors.cover-ink}"
  plate-tab:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.45rem 0.9rem 0.45rem 0.6rem"
  plate-tab-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  specimen-plate:
    backgroundColor: "{colors.term-bg}"
    textColor: "{colors.term-fg}"
    typography: "{typography.mono-frame}"
    rounded: "{rounded.plate}"
    padding: "1.25rem 1.1rem 1.25rem 0"
  field-mark-tag:
    backgroundColor: "{colors.mark}"
    textColor: "{colors.mark-ink}"
    typography: "{typography.numeral}"
    size: "1.5em"
  key-card:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plate}"
    padding: "1.5rem 1.6rem 1.6rem"
  theme-pill:
    textColor: "{colors.cover-ink}"
    rounded: "{rounded.pill}"
    padding: "0.2rem 0.75rem"
  theme-pill-hover:
    backgroundColor: "{colors.cover-ink}"
    textColor: "{colors.cover}"
  inline-code:
    backgroundColor: "{colors.code-bg}"
    rounded: "{rounded.cell}"
    padding: "0.08em 0.35em"
  kbd:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.key}"
    padding: "0.05em 0.45em"
---

# Design System: modmgr

## Overview

**Creative North Star: "The Field Guide to Mods"**

The page is a field guide in the Peterson manner: an orange cloth cover, plates printed on a cool off-white paper, and specimens in terminal black. The specimens are the real `/mods` dialog frames, generated from the plugin's tests and never retouched; the guide's work is to number the field marks on the exact cells that matter and to say, in a legend, what each one tells you. Everything else is the back matter of a guide: headings in a left margin column, matter on the right, ruled lists, numbered cautions.

Density is calm and editorial around dense specimens. Type is achromatic; colour lives in fields (the cover bands) and marks (the boxes and their numeral discs), never in running text. Narrow uppercase Archivo carries the guide's titles, normal-width Archivo the prose, JetBrains Mono the frames and ids. Marks are told apart by number and position, never by hue.

The world refuses the split hero with a screenshot and the three-card feature row; the plates and their legends do that work instead.

**Key Characteristics:**
- Orange cover cloth owns whole bands (the cover and the closing install) and stays orange in both themes.
- Specimen plates in terminal black on paper, with numbered orange field marks drawn onto a 1ch by 1.5em cell grid.
- Plates are numbered in roman (I to V); the dialog's own tab keys keep their arabic 1 to 4.
- Narrow uppercase titles (Archivo at 68 to 85% width) over normal-width body.
- Mod ids are set in italic mono, like a binomial.
- Light by default; dark follows the system or the toggle, swapping paper and ink but not the cover.

## Colors

One loud cloth, achromatic paper and ink, and the terminal's own black and tones for specimens.

### Primary
- **Orange Cover Cloth** (cover): fills the masthead and hero band, bleeds 6.5rem down behind the first plate, and returns as the closing install band. Also the selection colour, link underline, and the Copy button's hover fill. Never body text on paper.
- **Cover Ink** (cover-ink): all text, links, rules of emphasis and focus outlines on the cloth. **Cover Muted** (cover-muted) for secondary lines on the cloth; **Cover Rule** (cover-rule) for the masthead's bottom rule.

### Secondary
- **Field-Mark Orange** (mark, mark-ink): the same hue in a separate role: field-mark box strokes (2px) with a 10% tint fill (32% when its legend entry is hovered), the numeral disc behind every mark number, the active plate tab's numeral divider, the caution numerals and the limits heading on the black band.

### Neutral
- **Plate Paper** (paper / paper-dark): page ground.
- **Sheet** (sheet / sheet-dark): raised surfaces: the key card, plate tabs at rest, kbd keys, keymap row hover.
- **Ink** (ink / ink-dark): text and links on paper, the active plate tab's fill, 2px heading rules over lists.
- **Muted** (muted / muted-dark): captions, definitions, FAQ answers, small group labels.
- **Rule** (rule / rule-dark): 1px dividers between sections and list rows, tab and card borders.
- **Code Ground** (code-bg / code-bg-dark): inline code chips.
- **Terminal Black** (term-bg, term-fg, term-rule): the specimen pane and the install line. **Band** (band / band-dark) carries the limits section on the plates' own black.

### Tertiary
- **Terminal Tones** (t-success, t-warning, t-error, t-claude, t-subtle): only inside frames, as the dialog draws them; t-claude also marks the install line's `>` prompt.

### Named Rules
**The Cover Cloth Rule.** Orange owns whole bands or marks a specific thing (a field mark, a numeral, a hover, a selection). It is never a text colour on paper and never a decorative stripe.

**The Achromatic Text Rule.** Running text is ink or muted on paper, cover-ink on cloth, term-fg on black. State reads by glyph and number, never by colour alone.

## Typography

**Display Font:** Archivo Variable at narrow widths (with system-ui)
**Body Font:** Archivo Variable at normal width (with system-ui)
**Label/Mono Font:** JetBrains Mono Variable (with ui-monospace, SF Mono, Menlo)

**Character:** One grotesque in two registers: condensed uppercase for the guide's titles, normal width for reading. Mono belongs to the specimens, install lines, code and ids. Width is set with `font-stretch`; the `wdth` values in the tokens are the same axis.

### Hierarchy
- **Display** (h1): the cover headline, uppercase, at 68% width.
- **Display Close**: the closing "Install it" heading, uppercase at 68% width.
- **Headline** (h2): plate-section and back-matter titles, uppercase at 72% width, balanced.
- **Plate Title**: "Plate I. Installed", uppercase at 72% width.
- **Title** (h3): caution and list-item heads, sentence case.
- **Body**: prose capped at the 66ch measure.
- **Lead**: the cover's introductory paragraph, max 38rem.
- **Label**: plate tabs, uppercase at 85% width; nav at 0.95rem weight 550.
- **Label Small**: group headings inside the key card and keymap column heads, uppercase at 85%, muted.
- **Numeral**: the field-mark disc numbers, tabular.
- **Caution Numeral**: the limits list's plain orange numbers, narrow, no disc.
- **Mono Frame**: the specimen grid; text and marks share it.

### Named Rules
**The Binomial Rule.** A mod id named in prose or a caption is italic mono at 0.92em, like a species name. Captions italicise only ids that appear on their own frame.

**The Roman Plate Rule.** Plates are numbered I to V, as text separated from the title by a rule. Arabic digits are kept for the dialog's own tab keys and for numbered marks and cautions.

## Layout

A single 76rem column (`min(100% - 2rem, 76rem)`) with sections padded `clamp(3.5rem, 2rem + 5vw, 6.5rem)` and separated by 1px rules; bands (cover, limits, close) drop the rule. Prose holds the 66ch measure.

- **Cover:** masthead row (name left, nav right) over a hero; from 64rem the h1 spans the full width and the lead and install line sit in two columns (1fr / 1.15fr).
- **Plates:** the plate index and first plate overlap the cover's lower edge via a 6.5rem orange gradient behind the section. From 78rem the plate and its caption sit side by side (frame at its own width, caption at least 15rem, starting 3.25rem down on paper); below that they stack, and between 52rem and 78rem the legend runs in two columns.
- **Back matter:** from 64rem, sections use a 1fr / 2.6fr grid with the h2 sticky in the left column; below, they stack.
- **Narrow screens (below 60rem):** the frame keeps its 96-column width and scrolls inside its pane; a scroll cue says so, each mark's numeral sits beside its own box instead of in the gutter, and tapping a legend entry (or opening a plate) scrolls the frame to that mark.

## Elevation & Depth

Paper is flat; depth belongs to the black objects that sit on it. Only the specimen pane and the install line cast shadows, both soft and ambient, so they read as dark slabs laid on the page. Everything else separates by rule, sheet tone, or band.

### Shadow Vocabulary
- **Specimen lift** (`box-shadow: 0 2px 4px rgb(0 0 0 / 0.12), 0 28px 50px -24px rgb(0 0 0 / 0.55)`): the plate pane.
- **Install lift** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.18), 0 10px 24px -12px rgb(0 0 0 / 0.45)`): the install line.

### Named Rules
**The Black Slab Rule.** Shadows are for the terminal-black objects only. Cards, tabs and sheets stay flat with a 1px rule border.

## Shapes

Soft rectangles throughout: 12px for plates and the key card, 10px for the install line, 5px for kbd keys (with a 2px bottom border as their only bevel), 4px for code chips and field-mark boxes, full pills for plate tabs and the theme toggle, and true circles only for field-mark numeral discs. Lists are ruled, not boxed: a 2px ink rule opens a list (tabs, keymap, FAQ, every-key drawer) and 1px rules divide its rows. The specimen's numeral gutter is a 1px dashed term-rule line.

## Components

### Install Line
The one action, styled as the prompt people type at. A terminal-black slab (max 44rem) with a t-claude `> ` prompt, mono text that wraps but keeps each `--flag value` together, and a Copy button separated by a 1px term-rule divider. Copy appears only with script and clipboard support; on hover it fills orange with cover ink; focus uses an inset orange outline. A label above names where to type it.

### Plate Index (tabs)
A radio group, so plates switch without script and only when asked. Pills on sheet with a 1px rule border; the roman numeral sits left of a 1px divider in muted. Hover darkens the border to ink. Checked: ink fill, paper text, the numeral in the tab's text colour and its divider in orange. Focus: 3px ink outline offset 3px.

### Specimen Plate
The generated frame in a terminal-black pane (1px term-rule border, 12px radius, specimen lift), drawn on a cell grid one character wide and 1.5em tall. Glyphs a mono font may lack are held to one cell. The ring segment inverts term-fg and term-bg. Frames come from the generated demo data and are never edited by hand.

### Field Mark
A 2px orange box (4px radius, 10% orange fill) placed on the exact cells of its text, with an orange numeral disc (1.5em circle, mark-ink, tabular) in the gutter on the same row. On opening a plate, boxes grow in from their left edge one after another (0.6s, 0.15s stagger), discs pop in, and each legend entry rises with its mark; reduced motion disables all of it. Hovering a legend entry deepens its box's fill.

### Plate Caption and Legend
Plate title, a muted caption, then an ordered legend whose entries carry the same numeral disc as their mark. The disc is used only by field marks and their legends.

### Cautions
An ordered list on the band, each item ruled, with a plain narrow orange numeral in a 2.75rem margin column, an h3 head and a muted body.

### Key Card
A sheet card (1px rule, 12px radius) holding small-label groups; the notable list uses the dialog's own `◆` glyph as its bullet, in ink.

### Definition Rows, Keymap, FAQ
Ruled lists under a 2px ink rule. Tab names are narrow uppercase with a muted plate cross-reference (roman numerals) beneath; definitions in muted. The keymap is a table with kbd keys, a row hover on sheet, and scrolls sideways inside a focusable region. FAQ items are disclosure rows with muted markers.

### Navigation
Masthead on the cloth: "modmgr" set in narrow uppercase (800, 72% width) left; Source, Changes, Security as cover-ink underlined links right, with a pill theme toggle (1px cover-ink border, inverts on hover) that appears only with script.

### Links and Focus
Links keep their text colour with an orange underline (0.12em, offset 0.22em) that thickens to 0.22em on hover; on cloth the underline is cover-ink. Focus is a 3px outline in ink (cover-ink on cloth, orange on the band), offset 3px.

## Motion

All motion sits inside `prefers-reduced-motion: no-preference`, in transform and opacity only, with one easing curve (`--ease`, `cubic-bezier(0.16, 1, 0.3, 1)`). Under reduced motion the page is the same, with nothing moving.

- **Cover settles on load:** the headline and lead rise 0.35em into place without ever being hidden (they may be the largest paint); the install line fades up 0.1s later, then the plate index.
- **Plate switch:** the frame settles 0.9rem up, the plate title and caption rise, then each field mark grows in from its left edge with its legend entry and numeral, 0.15s apart.
- **Scroll:** where scroll-driven animations exist, each section's heading and matter rise 2.25rem as they enter, and the cautions arrive one by one. Without support, nothing is hidden.
- **Feedback:** plate tabs lift 2px on hover and press to 97%; the theme pill and Copy press to 95%; Copy answers with an orange fill and a short scale-up, replayed on every click; summary chevrons turn a quarter and opened answers rise in.

## Do's and Don'ts

### Do:
- **Do** show the dialog as generated frames and point at it with numbered field marks; let the legend say what each mark means.
- **Do** keep orange to whole bands and to marks, numerals, hovers and selection.
- **Do** number plates in roman with a rule between number and title, and keep the dialog's own 1 to 4 tab keys arabic.
- **Do** reserve the orange numeral disc for field marks and their legend entries; caution numbers are plain narrow orange numerals.
- **Do** set mod ids in italic mono (0.92em).
- **Do** open ruled lists with a 2px ink rule and divide rows with 1px rules.
- **Do** keep every interaction working without script: radio plates, native disclosures, a copy button that only appears when it can work.
- **Do** keep every animation and transition inside `prefers-reduced-motion: no-preference`, in transform and opacity only, and never start the headline, the lead or a frame hidden.

### Don't:
- **Don't** use a split hero with a screenshot or a three-card feature row.
- **Don't** set body text in orange on paper, or carry state by colour alone.
- **Don't** edit a frame's contents to suit a mark; change the mark or regenerate the frames.
- **Don't** put shadows on paper-toned surfaces; only the terminal-black slabs lift.
- **Don't** put numeral discs on plate numbers, cautions or anything other than field marks.
