# DECISIONS.md — GEO Lens

Design decisions made while building. Where the spec left something open, the
choice made and its rationale are recorded here.

## Architecture

- **No build step, no npm, vanilla JS.** All content-side files are plain
  scripts injected on demand via `chrome.scripting.executeScript({files})`. The
  folder loads unpacked as-is.
- **Injection model.** Scan runs only on user click (`activeTab`). On click the
  popup asks `background.js` (service worker) to inject the content files into
  the active tab, then invokes `window.__GEOLens.run()`. No content scripts are
  declared in the manifest, so nothing runs until the user acts. This keeps the
  extension free of broad host permissions — important for Web Store review.
- **Idempotent injection.** Every content file is wrapped in an IIFE that
  assigns to the single global namespace `window.__GEOLens` and returns early if
  already initialised. Re-injecting on a second scan therefore cannot throw
  "identifier already declared" and cannot attach duplicate message listeners.
- **Single global namespace:** `window.__GEOLens` holds `{ rules, highlighter,
  panel, buildReport, run, clear, lastResult }`.

## Messaging contract

Popup ⇄ background ⇄ content. Message `type` strings are the contract:

- `GEO_SCAN` — popup → background. Payload `{ tabId, url }`. Background injects
  files, calls `run()`, stores the result, replies `{ ok, summary }`.
- `GEO_DOWNLOAD` — content (panel Export button) → background. Payload
  `{ html, filename }`. Background triggers `chrome.downloads.download` with a
  base64 `data:` URL (service workers cannot use `URL.createObjectURL` reliably;
  a data URL is CSP-safe and needs no object-URL lifecycle).
- `GEO_GET_RECENT` — popup → background. Replies `{ recent, current }`.

Panel buttons that only touch the page (clear, category toggles,
click-to-scroll) call `highlighter`/`panel` directly in the content world — no
messaging needed.

## Content extraction heuristic

Main content root is chosen in this priority order:
1. First `<article>` with meaningful text.
2. `<main>`.
3. `[role="main"]`.
4. Largest text-density block: among candidate block elements, the one whose
   direct-plus-descendant text length is greatest while excluding elements whose
   tag/role/class matches nav/header/footer/aside/sidebar/menu/comment/ad
   patterns.
If nothing yields ≥ 200 characters of text, the scan reports "No article
content detected" and no highlights are drawn.

Long pages: if the extracted root exceeds 50,000 words the analysis processes
the first 50,000 words (by walking text nodes until the budget is hit) and the
panel notes the truncation.

## Rules engine

Each rule file exposes `analyze(ctx) -> Issue[]` where
`ctx = { root, doc, wordCount, headings, paragraphs, jsonLd, url, title }`.
`Issue = { id, category, severity, message, fix, node|null, snippet }`.
`node` is the DOM element/text container to highlight, or `null` for page-level
issues (which anchor their highlight to the H1/opening block).

Heuristics implement the spec literally. Notable judgement calls:

- **Question heading detection.** A heading is a "question" if its trimmed text
  ends with `?` or its first word (case-insensitive) is one of
  what/how/why/when/which/who/where/can/is/are/does/do/should/will/could/would.
- **Sentence splitting** uses a regex on `.?!` followed by whitespace and a
  capital/space, with abbreviation guards for common cases (e.g. "e.g.",
  "i.e.", "Mr.", "Dr.", "vs."). Good enough for auditing prose; documented as
  approximate.
- **Direct-answer check.** After a question heading, the following paragraph
  fails if its first sentence is > 35 words OR starts with a filler opener
  (case-insensitive list in `extractability.js`).
- **Vague quantifiers / hedges** are matched as whole words, capped (10 and no
  cap respectively per spec — hedges are rare so left uncapped) to avoid noise.

## Scoring

Per spec. Category starts at 100; deduct High −15 / Medium −8 / Low −3; floor 0.
Overall = weighted mean (Extractability .25, Structure .25, Entity .20,
Schema .15, Citability .15). Grades A ≥85, B ≥70, C ≥55, D ≥40, else F.

## Highlighting

- Wraps only **text nodes** in `<span data-geo-hl>` markers, never touching
  element structure, so restore is exact. A registry records every inserted
  wrapper and its original text node; `clear()` replaces each wrapper with the
  original node and normalises, restoring the DOM byte-for-byte.
- Inline highlight cap: 60. Issues are sorted by severity; lowest-priority
  overflow issues are still listed in the panel, flagged "not highlighted".
- Colors are applied as translucent background + solid bottom border using the
  category palette, so overlapping/adjacent highlights stay readable.

## UI

- Panel and popup use a system/Inter font stack, no emoji, the five category
  colors as the visual language, and are dark-mode aware via
  `prefers-color-scheme`.
- The panel lives in a Shadow DOM host appended to `<html>` with a constructed
  stylesheet (`adoptedStyleSheets`) so host-page CSS cannot leak in and page CSP
  cannot block it. `panel.css` is the canonical stylesheet, fetched at runtime
  from the extension origin (declared in `web_accessible_resources`); a small
  embedded fallback covers the rare case the fetch fails.

## Privacy

All analysis is local and deterministic. No network calls, no API keys, nothing
leaves the browser. Stated in the panel footer ("100% local analysis").

## Icons

Generated programmatically by `icons/generate-icons.js` (a Node script) into
16/32/48/128 PNGs — a lens ring over a target, using the brand gradient. The
script is included so the icons are reproducible; the PNGs are committed so the
extension loads without running it.
