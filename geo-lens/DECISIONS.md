# DECISIONS.md — GEO Lens

Design decisions made while building. Where the spec left something open, the
choice made and its rationale are recorded here.

## Scope boundary (v2)

GEO Lens ships alongside **SEO Sidekick**, which already covers on-page and
technical SEO. Two extensions grading the same page against overlapping rubrics
is worse than either alone, so v2 drew a hard line:

- **Sidekick owns page-level, binary, technical checks** — titles, meta
  descriptions, H1 count, heading-level skips, canonicals, `X-Robots-Tag`, schema
  detection and validation, image alt text, hreflang, broken links, AI-crawler
  access via `robots.txt`/`llms.txt`.
- **GEO Lens owns the passage-level editorial layer** — which sentence is wrong,
  and what it should say instead.

Removed from GEO Lens in v2 as duplicates of Sidekick:

| Removed | Why |
|---|---|
| The whole **Schema** category (`content/rules/schema.js`) | Sidekick's `schema-analyzer.js` does rich-result eligibility, required-vs-recommended properties, a gap detector with copy-paste JSON-LD templates, and a corrected-copy generator. GEO Lens's 106-line version was strictly worse. |
| `structure` — missing/multiple H1, heading-level skips | Sidekick's on-page analyzer reports both. |
| `entity` — author-byline presence, published/updated date presence | Sidekick's on-page analyzer reports both. |

Schema's 15% score weight was redistributed; the default (Article) weighting is
now Extractability .30 / Structure .20 / Entity .20 / Citability .30.

Two features considered for GEO Lens were **assigned to Sidekick instead**, as
technical rather than editorial: the JS-rendering check (raw HTML vs rendered
DOM), and bulk/sitemap scanning — Sidekick already holds `host_permissions` and
a sitemap parser, so both are far cheaper there.

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

- `GEO_SCAN` / `GEO_RESCAN` — popup or panel → background. Background loads the
  settings, dismissals and previous scan, injects the files, calls `run(opts)`,
  stores the result and the history entry, replies `{ ok, summary }`.
- `GEO_DOWNLOAD` — panel Export → background. Payload `{ html, filename, mime }`.
  Background triggers `chrome.downloads.download` with a `data:` URL (service
  workers cannot use `URL.createObjectURL` reliably; a data URL is CSP-safe and
  needs no object-URL lifecycle).
- `GEO_GET_RECENT` — popup → background. Replies `{ recent, current }`.
- `GEO_GET_SETTINGS` / `GEO_SET_SETTINGS` — options page ⇄ background.
- `GEO_DISMISS_ISSUE` / `GEO_DISMISS_RULE` — panel → background.
- `GEO_GET_DISMISSALS` / `GEO_CLEAR_DISMISSALS` — options page ⇄ background.
- `GEO_GET_HISTORY` — replies with the stored scans for a URL.

Panel buttons that only touch the page (clear, category toggles, click-to-scroll,
copy) call `highlighter`/`panel` directly in the content world — no messaging
needed. Dismissals go through the worker because they must persist.

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

Category starts at 100; deduct High −15 / Medium −8 / Low −3 (all three
configurable); floor 0. Overall = weighted mean over the four categories, using
the **detected profile's** weights (default Article: Extractability .30,
Structure .20, Entity .20, Citability .30). Grades A ≥85, B ≥70, C ≥55, D ≥40,
else F.

Every deduction is retained in `scoring.breakdown[category]` so the panel can
show the arithmetic — `100 −15 −8×3 = 61 · 30% of overall` — instead of an
unexplained number. A score floored at 0 says so, and shows what it would
otherwise have been.

## Highlighting

- Wraps only **text nodes** in `<span data-geo-hl>` markers, never touching
  element structure, so restore is exact. A registry records every inserted
  wrapper and its original text node; `clear()` replaces each wrapper with the
  original node and normalises, restoring the DOM byte-for-byte.
- Inline highlight cap: 60 by default, configurable. Issues are sorted by
  severity; lowest-priority overflow issues are still listed in the panel,
  flagged "not highlighted".
- Colors are applied as translucent background + solid bottom border using the
  category palette, so overlapping/adjacent highlights stay readable.

## UI

- Panel and popup use a system/Inter font stack, no emoji, the four category
  colors as the visual language, and are dark-mode aware via
  `prefers-color-scheme`.
- The panel carries three views behind a tab strip (Issues / Quotable /
  Retrieval). Switching tabs re-renders from the cached result — it never
  re-scans.
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


---

# v2 subsystems

## Settings and the state contract

`run()` is called with `{ settings, dismissedRules, dismissedIssues, previous }`.
The service worker reads storage and passes the result in; the content world
never awaits storage and `run()` stays synchronous. `chrome.scripting`
awaits a returned promise, so making it async later is possible, but nothing
currently needs it.

`DEFAULT_SETTINGS` is declared twice — in `content/settings.js` and in
`background.js` — because a service worker cannot import a content-world file
and the extension has no build step to share one. The acceptance harness asserts
the two key sets match, so the mirror cannot silently drift.

## Content-type profiles

Detection order is strongest-signal-first: structured-data `@type`, then URL
shape, then DOM heuristics (a price plus an add-to-cart control reads as
commercial). A profile names the rule IDs that do not apply to it and supplies
its own category weights.

The docs-path pattern deliberately **excludes `guide` and `tutorial`**. They are
among the most common blog slugs (`/blog/beginners-guide`), and matching them
would classify ordinary articles as documentation — silently disabling the
outbound-citation and comparison-table rules. This was caught by the harness,
which is why the fixture URL is `/blog/guide`.

## Rule IDs and fingerprints

Every issue carries a stable `ruleId` (`extractability.longParagraph`) and a
`fingerprint` — `ruleId` plus a djb2 hash of the first 60 characters of its
snippet. Fingerprints are what make dismissals survive a reload and let revision
tracking name the issues that were fixed rather than just the count.

## Fixers

`content/fixers.js` turns an issue into corrected text. Rules stay declarative:
they attach `rewriteData` describing what they found, and the fixer does the
text generation. Every transform is deterministic and mechanical — reordering
sentences the page already has, splitting at real sentence boundaries, stripping
a hedge prefix, emitting list markup.

**Where a genuine rewrite is impossible without facts the page does not state**
(a source URL, a real figure), the fixer emits a skeleton with bracketed
placeholders and says so in its label. It never invents content — a plausible
invented statistic is worse than no rewrite at all.

A fixer that throws is caught and the issue simply lists without a rewrite; a
broken transform never breaks the scan.

## Quotables

Sentences are scored on length band (8–25 words, peaking near 16), whether they
carry a figure or a definition, whether they name the page's primary entity,
and penalised for dangling openers, hedges, vague quantifiers and filler. Below
a threshold of 10 nothing is shown and the panel says so explicitly, rather than
presenting the least-bad sentence as if it were citable.

## Retrieval chunks

Blocks are walked in document order and grouped at H2/H3 boundaries, capped at
roughly `chunkTokens` (default 500) using a 1.3 words-to-tokens estimate. A
chunk is an **orphan** when it both lacks a self-describing heading (or opens
with a dangling pronoun) *and* fails to establish its subject. Both conditions
are required: a passage with a clear heading is retrievable even if it opens
with "It", and a passage that names its subject is fine without a heading.

## Primary entity

Picked by score, not by length. Length alone selects the gerund from "Choosing a
CDN" and discards the acronym, and acronyms (CDN, DNS, API) are exactly the
entities such pages are about. Acronyms score highest, then proper nouns; stock
title words ("complete", "guide", "ultimate") and a leading gerund are excluded.
This feeds three rewrites and a quotable bonus, so getting it wrong was visible
in the output.

## Revision history

Keyed by `origin + pathname`, so query strings and fragments do not fragment a
page's timeline. Each entry stores its issue fingerprints. Bounded at 20 scans
per page and 60 pages, evicting least-recently-scanned pages first.

## Report white-labelling

Agency name, client name and accent colour come from settings. All branding is
HTML-escaped, and the accent colour is only emitted if it matches `#rrggbb` —
otherwise a `javascript:` value would land inside a `style` attribute. Both are
covered by the harness.

## Language

Every prose heuristic is English-only. Rather than silently mis-scoring other
languages, a declared non-English `<html lang>` produces a notice in both the
panel and the exported report saying the scores are unreliable. An *undeclared*
lang is not warned about — that would fire on most of the web.
