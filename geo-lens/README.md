# GEO Lens — AEO/GEO Content Auditor

A Chrome extension (Manifest V3) that scans any article you're viewing and
highlights, in colour, directly on the page, exactly where the content falls
short for AI search visibility — AI Overviews, ChatGPT, Perplexity, Gemini —
with a scored side panel explaining every issue and how to fix it.

Built for SEO professionals and content writers auditing pages for **Answer
Engine Optimization (AEO)** and **Generative Engine Optimization (GEO)**.

- **100% local.** Every rule runs in your browser. No network calls, no API
  keys, nothing leaves the tab.
- **No build step, no dependencies.** Vanilla JavaScript. Load the folder
  unpacked and it works.
- **Non-destructive.** Highlights wrap text nodes and are removed cleanly —
  the page DOM is restored byte-for-byte when you clear or close the panel.

---

## Install (load unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium browser).
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the **`geo-lens/`** folder (the one
   containing `manifest.json`).
5. Pin the extension. Open any article, click the GEO Lens icon, and press
   **Scan this page**.

The extension requests only `activeTab`, `scripting`, `storage`, and
`downloads`. It has **no host permissions** — it can only touch a page after you
click Scan on it.

---

## How to use

- **Scan this page** — analyses the main content and opens the side panel.
- **Side panel** — overall GEO score (0–100) and letter grade, five category
  sub-scores, and every issue grouped by category with severity, the exact text
  affected, a plain-English explanation, and a concrete fix.
- **Click any issue** — scrolls the page to its highlight and pulses it.
- **Click a category row** — toggles that colour's highlights on/off.
- **Clear highlights** — removes all highlights (page restored exactly).
- **Export report** — downloads a self-contained HTML report you can send to a
  client.
- **Popup** — shows the last score for the current page and your 10 most recent
  scans; click a recent scan to reopen that URL.

---

## The five categories and what each rule checks

Each category starts at 100. Deductions: **High −15, Medium −8, Low −3**
(floored at 0). Overall score is a weighted mean — Extractability 25%,
Structure 25%, Entity 20%, Schema 15%, Citability 15%. Grades: A ≥ 85, B ≥ 70,
C ≥ 55, D ≥ 40, else F.

### 1. Extractability — red `#EF4444`
How easily an AI engine can lift a direct answer out of the prose.
- Paragraphs longer than 120 words (walls of text).
- A question-style H2/H3 whose following paragraph doesn't open with a direct
  answer (first sentence > 35 words, or starts with filler like "In today's").
- Definitions buried mid-paragraph (`is a` / `refers to` / `means` not in the
  first sentence).
- No summary/answer in the first 100 words after the H1.

### 2. Structure — orange `#F97316`
Whether the outline is machine-readable and query-aligned.
- Missing or multiple H1s.
- Heading hierarchy skips (e.g. H2 → H4).
- Fewer than 30% of H2s phrased as questions.
- Long comma-prose enumerations that should be `<ul>`/`<ol>`.
- Comparison content ("vs", "compared to", "difference between") with no
  `<table>` on the page.
- No table of contents / jump links on pages longer than 1,500 words.

### 3. Entity & E-E-A-T — yellow `#EAB308`
Trust and authorship signals.
- No visible author/byline (checks `rel=author`, `.author`, byline patterns,
  Person schema).
- No visible published/updated date (checks `<time>`, schema dates, date text).
- Statistics or claims (%, currency, "study", "research", "according to") with
  no source link.
- Review/comparison pages with no first-person experience ("we tested", "our
  analysis").
- Primary entity (from the title/H1) not mentioned in the opening paragraph.

### 4. Schema — blue `#3B82F6`
Structured-data coverage. Parses every `<script type="application/ld+json">`
block (tolerates arrays and `@graph`). All issues anchor to the H1.
- No structured data at all (High).
- Article-like page missing Article/BlogPosting schema.
- 3+ question headings but no FAQPage schema.
- Step-by-step content but no HowTo schema.
- Article schema present but missing headline / author / datePublished /
  dateModified.
- Broken JSON-LD — shows the parse error.

### 5. Citability — purple `#A855F7`
Whether sentences are quotable and sourced enough to be cited.
- Vague quantifiers where a number could exist ("many", "several",
  "significantly", "huge" …) — capped at 10.
- Zero outbound links to authoritative sources in the main content (High).
- Fewer than 3 crisp, quotable stat-sentences (8–25 words with a number or
  definition).
- Hedged claims ("It could be argued", "Some say", "It might be").

At most **60 inline highlights** are drawn (highest severity first); any
remaining issues are still listed in the panel, marked "not highlighted".

---

## Handling of edge cases

- **No article content** — the panel shows "No article content detected".
- **Very long pages** — only the first 50,000 words are analysed; the panel
  notes the truncation.
- **CSP-strict sites** — all logic runs in the content script; the panel's
  styles are applied via a constructed stylesheet (`adoptedStyleSheets`), never
  an inline `<style>`/`<script>`, so page CSP can't block them.
- **SPAs** — re-scanning after in-page navigation re-extracts and re-renders.
  Injection is idempotent, so repeated scans never error.

---

## Architecture

```
geo-lens/
├── manifest.json            MV3 manifest (activeTab, scripting, storage, downloads)
├── background.js            service worker: injects content files, runs scan, downloads report
├── popup/                   popup.html / popup.css / popup.js — scan trigger, score, recent scans
├── content/
│   ├── highlighter.js       reversible text-node wrap/restore registry + palette
│   ├── util.js              shared text/DOM helpers
│   ├── rules/               extractability / structure / entity / schema / citability
│   ├── scanner.js           content extraction, orchestration, scoring, highlight cap
│   ├── panel.js             Shadow DOM side panel
│   └── panel.css            canonical panel stylesheet
├── report/report-template.js  self-contained HTML report generator
├── icons/                   16/32/48/128 PNGs + reproducible generator
├── DECISIONS.md             design decisions
└── README.md
```

See `DECISIONS.md` for the messaging contract, injection model, and the
reasoning behind each heuristic.

---

## Acceptance test results

Verified with an automated jsdom harness that loads the real content scripts and
runs the full pipeline (plus manual notes for browser-only paths):

- **Load unpacked, no console errors** — manifest validates; all 12 JS files
  pass `node --check`; injection order resolves every dependency.
- **Article scan** — a synthetic long-form article produced issues in all five
  categories, an overall score with grade, inline highlights, and a rendered
  panel. Clearing highlights restored the article's `innerHTML`
  **byte-for-byte** (verified equal before/after).
- **Finance/blog-style long-form** — a page with no JSON-LD and filler openings
  produced the expected Schema (no structured data) and Extractability
  (unanswered questions, no opening summary) issues.
- **Broken JSON-LD + partial Article schema** — the parse error is surfaced and
  the missing `author`/`datePublished`/`dateModified` fields are listed.
- **Empty page** — returns "No article content detected"; no highlights drawn.
- **Well-optimised page** (schema, author, dated, question headings, outbound
  link) — scored 98/A with only 2 minor issues, confirming the rules don't
  over-flag good content.
- **Export report** — produces a valid standalone `<!doctype html>` document
  (~14 KB in the test) containing the score, category bars, and every issue.

---

## Chrome Web Store listing draft

**Title (≤ 45 chars):**
`GEO Lens — AEO/GEO Content Auditor`

**Summary (132 chars):**
`Scan any page for AI-search visibility issues. Inline colour highlights and a scored AEO/GEO audit with fixes. 100% local.`

**Description:**

> GEO Lens shows you exactly why a page is or isn't ready to be cited by AI
> search — AI Overviews, ChatGPT, Perplexity, and Gemini.
>
> Click Scan and GEO Lens analyses the main content of the page and highlights
> problems in colour, right where they occur, then opens a side panel with an
> overall GEO score, five category sub-scores, and a fix for every issue.
>
> What it checks:
> • Extractability — can an AI lift a direct answer? Walls of text, unanswered
>   question headings, buried definitions, missing opening summaries.
> • Structure — H1 usage, heading hierarchy, question headings, list vs prose,
>   comparison tables, table of contents.
> • Entity & E-E-A-T — author, dates, sourced claims, first-hand experience,
>   entity consistency.
> • Schema — JSON-LD coverage: Article, FAQPage, HowTo, and broken markup.
> • Citability — vague quantifiers, outbound sources, quotable stat-sentences,
>   hedged claims.
>
> Everything runs locally in your browser. No account, no API key, no data ever
> leaves the page. Export a clean HTML report to send to clients.
>
> Built for SEO professionals and content writers optimising for Answer Engine
> Optimization (AEO) and Generative Engine Optimization (GEO).
>
> Permissions: GEO Lens uses activeTab and scripting so it only ever runs when
> you click Scan on a page — it requests no broad site access.

**Category:** Developer Tools / Productivity
**Primary color:** Indigo `#4F46E5`
