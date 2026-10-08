---
version: 1
slug: "src-pages-index-astro"
primary_target: "src/pages/index.astro"
related_targets: []
---

# Landing page (index.astro)

Scope: the modmgr landing page at `/claude-modmgr/`. Mode: Persuade.

Audience: Claude Code users looking for mods, and those about to install modmgr. Job: find a mod, see what it can reach before installing, copy its install line; learn that `/mods` brings the same store and inspection into Claude Code. Proof: the community index (computed count, never hardcoded), capabilities from `claude plugin validate`, and the real `/mods` frames in `src/data/demo.ts`. Constraints: Lighthouse 100 x4 at 8x CPU, first visit under 100 KB fonts aside, no client framework, first page of results prerendered, one page of rows in the DOM, URL-held state.

Chosen route: the standing exit (category standard played straight), at the craft of Raycast's Store and Linear. Memorable moment: the search field is focused on load and the results begin inside the first viewport.

## Direction contract

THESIS: the store for Claude Code mods, done the way the best dev-tool companies would: search first, real product UI, exact type and spacing, nothing gimmicky. Refuses the field-guide cover and the split hero with a screenshot.

OWN-WORLD: near-black ground (#0b0d10 range) with two or three layered surfaces and hairline borders, warm off-white text #f5f5f4, Claude orange #d77757 as the single accent (primary action, focus, match highlight). Archivo Variable at normal width, tight scale; JetBrains Mono for install lines and repos. Light theme via prefers-color-scheme at equal craft. No glows, gradient blobs, glass, or icon feature cards.

STORY: within seconds the visitor sees this is where to find mods for Claude Code (the live count, from public GitHub, refreshed daily), searches, sees per mod what it can reach, copies its install line, and learns `/mods` brings the same store inside Claude Code; then copies `/plugin install modmgr --marketplace ayagmar/claude-mods`.

FIRST VIEWPORT: slim nav (wordmark; Source, Security, Changelog; compact copyable install line). Centred headline with the live count, one-line subhead, a large search field focused on load with a "/" and ⌘K hint, filter chips and a sort select under it; the dense results list starts inside the viewport: name, repo, stars, description, reach badges, install copy and GitHub link per row; a selected row expands inline with reach in words, notable lines, validation and the install line. Pagination of 40 with numbered links and a "41–80 of N" line.

FORM: the category standard (standing exit), position: owner's choice outside the ordered list; seed key 127d232d. Code-led, no image generation. Signature interaction: keyboard-driven search (/, ⌘K, ↑/↓, Enter, [ ]) with inline expansion; motion is Linear-grade restraint, transform and opacity only.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
