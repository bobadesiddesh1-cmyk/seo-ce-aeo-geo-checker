# GEO Lens — AEO/GEO Content Auditor

A Chrome extension (Manifest V3) that scans any article you're viewing,
highlights in colour — directly on the page — exactly where the prose falls
short for AI search visibility (AI Overviews, ChatGPT, Perplexity, Gemini), and
hands you **the corrected text to paste in**.

Built for SEO professionals and content writers auditing pages for **Answer
Engine Optimization (AEO)** and **Generative Engine Optimization (GEO)**.

- **It writes the fix, not just the diagnosis.** Every mechanically-correctable
  issue comes with generated replacement text and a Copy button — and where a
  real answer has to be *written*, Chrome's built-in on-device model writes it.
- **100% local — including the AI.** Every rule runs in your browser, and the
  model is Chrome's built-in Gemini Nano, running on your device. No account, no
  API key, no network call, nothing leaves the tab.
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
5. Pin the extension. Open any article and either click the GEO Lens icon and
   press **Scan this page**, press **Alt+Shift+G**, or right-click the page and
   choose **Scan this page with GEO Lens**.

The extension requests only `activeTab`, `scripting`, `storage`, `downloads` and
`contextMenus`. It has **no host permissions** — it can only touch a page after
you explicitly scan it.

---

## How to use

- **Scan** — analyses the main content and opens the side panel.
- **Side panel** — overall GEO score (0–100) and letter grade, four category
  sub-scores each showing their own arithmetic, and three views: Issues,
  Quotable and Retrieval.
- **Copy** on any rewrite — puts the corrected text on your clipboard.
- **Copy fixes** — every rewrite on the page, as Markdown.
- **Click an issue** — scrolls the page to its highlight and pulses it.
- **Click a category row** — toggles that colour's highlights on/off.
- **Dismiss / Ignore rule here** — silence a false positive for this page or
  this whole site.
- **Export** — downloads a white-labelled, self-contained HTML report.
- **Popup** — last score for the current page with its change since the previous
  scan, plus your 10 most recent scans.

---

## Scope — what GEO Lens does *not* do

GEO Lens audits the **editorial layer**: the prose itself, sentence by sentence.

It deliberately does **not** check page titles, meta descriptions, H1 counts,
heading-level skips, canonicals, `X-Robots-Tag`, schema validity, image alt
text, hreflang, broken links or AI-crawler access. Those are on-page and
technical SEO. They belong in a dedicated SEO toolkit — the companion project
[SEO Sidekick](https://github.com/bobadesiddesh1-cmyk/seo-sidekick) covers all of
them — and duplicating them here would mean two tools disagreeing about the same
page.

The dividing line: **Sidekick answers "does this page have X?". GEO Lens answers
"which sentence is wrong, and what should it say instead?"**

---

## The four categories

Each category starts at 100. Deductions: **High −15, Medium −8, Low −3**
(floored at 0, all three configurable). The overall score is a weighted mean;
the weights depend on the detected content-type profile. Grades: A ≥ 85, B ≥ 70,
C ≥ 55, D ≥ 40, else F.

Every category row in the panel shows its own arithmetic — `100 −15 −8×3 = 61 ·
30% of overall` — so a score is never an unexplained number.

### 1. Extractability — red `#EF4444`
How easily an AI engine can lift a direct answer out of the prose.
- Paragraphs longer than 120 words (walls of text).
- A question-style H2/H3 whose following paragraph doesn't open with a direct
  answer.
- Definitions buried mid-paragraph.
- No summary/answer in the opening after the H1.

### 2. Structure — orange `#F97316`
Whether the outline is query-aligned. *(H1 count and heading-level skips live in
Sidekick, not here.)*
- Fewer than 30% of H2s phrased as questions.
- Long comma-prose enumerations that should be `<ul>`/`<ol>`.
- Comparison content with no `<table>` on the page.
- No table of contents on pages longer than 1,500 words.

### 3. Entity & E-E-A-T — yellow `#EAB308`
Prose-level trust signals. *(Author-byline and date presence live in Sidekick.)*
- Statistics or claims with no source link.
- Review/comparison pages with no first-person experience.
- Primary entity not named in the opening paragraph.

### 4. Citability — purple `#A855F7`
Whether individual sentences are quotable.
- Vague quantifiers where a number could exist (capped at 10).
- Zero outbound links to authoritative sources.
- Fewer than 3 crisp, quotable stat-sentences.
- Hedged claims.

---

## Passage rewrites

Every issue that can be mechanically corrected carries **generated replacement
text** with a Copy button. These are deterministic transforms of the page's own
words — no network, no model:

| Issue | What you get |
|---|---|
| Wall of text | The paragraph split into 2–4 balanced blocks at real sentence boundaries |
| Question heading not answered | The paragraph reordered to lead with its best answer sentence |
| Buried definition | The definition hoisted to the front of the paragraph |
| Hedged claim | The hedge prefix stripped: *"It could be argued that latency is the only metric"* → *"Latency is the only metric"* |
| Comma-run enumeration | `<ul>` markup with one `<li>` per item |
| Comparison without a table | A `<table>` skeleton with both compared options as columns |
| No table of contents | A `<nav>` TOC built from the page's own H2/H3s |
| Statement headings | Question rewrites: *"Benefits of edge caching"* → *"What are the benefits of edge caching?"* |
| Vague quantifier | The sentence with the vague term swapped for a placeholder |
| No opening summary | A TL;DR skeleton seeded with the H1 and the page's H2s |

Where a genuine rewrite is impossible without facts the page doesn't state (a
source URL, a real figure), the fixer emits a **skeleton with bracketed
placeholders and says so in its label** — it never invents content.

**Copy fixes** in the toolbar exports every rewrite on the page as Markdown.

---

## Intelligence (on-device)

The transforms above are mechanical: they reorder sentences the page already has
and strip hedge prefixes. That is the right tool for a paragraph split, and the
wrong tool for *"write the answer to this heading"* — there the deterministic
fixer can only emit `[one-sentence answer, under 30 words]` and hand the work
back to you.

So where a real answer has to be **written**, GEO Lens uses **Chrome's built-in
Prompt API** (Gemini Nano, Chrome 138+ desktop). It runs on your device: no
account, no API key, and no network request, so the extension stays 100% local.

**It writes** the direct answer under a question heading, the TL;DR for the top
of the article, the opening sentence that names the page's subject, and real
question-heading rewrites.

**It also finds three things no regex can:**

| Finding | Why a heuristic can't do it |
|---|---|
| **Question not actually answered** | The mechanical rule measures the first sentence's *length*. A crisp 18-word sentence that talks around the question passes it. This asks whether the question is genuinely resolved. |
| **Claim asserted without support** | Regex finds `%`. It cannot tell whether the surrounding page substantiates the number. |
| **Question the page never answers** | Requires knowing what a reader searching this topic actually wants. |

These appear in the **Insights** tab.

### Grounding — the part that matters

This tool's output gets pasted onto real client pages, so a plausible invented
statistic is far worse than no rewrite at all. Every generation is constrained
three ways:

1. The system prompt forbids introducing any fact not in the passage.
2. Output is schema-constrained via `responseConstraint`.
3. **Any rewrite that introduces a number, percentage or currency figure absent
   from the source text is discarded**, and the mechanical fix is kept instead.

Bracketed placeholders pass — that is the model correctly declining to guess.
The Insights tab reports how many generations were accepted and how many were
rejected for inventing a figure. Rewrites the model wrote are badged **AI** in
the panel and in the exported report; read them before you publish them.

### When it isn't available

The model needs Chrome 138+ on desktop, and a first run downloads roughly 2 GB.
When it is unavailable, downloading, or switched off, **every scan still works**
— you get the deterministic fixes, and the panel says plainly which state it is
in. The AI never blocks a scan: the mechanical result renders immediately and
the written rewrites repaint the panel whenever they land.

Turn it off in Settings.

---

## The three panel views

- **Issues** — every problem, grouped by category, each with its rewrite.
- **Insights** — the AI-only findings above: unanswered questions, unsupported
  claims, and reader questions the page never addresses.
- **Quotable** — the sentences an engine is most likely to lift verbatim, ranked
  and scored, with the reasons each scored well. If nothing qualifies it says
  *"No strong citation candidate on this page"* rather than promoting a weak one.
- **Retrieval** — how the page splits into ~500-token, heading-bounded chunks,
  and which chunks are **orphans**: passages that lose their subject once
  retrieved alone (*"It reduced costs by 30%"* with no antecedent).

---

## Content-type profiles

Scoring a spec sheet for "walls of text", or a reference doc for "first-hand
experience", produces false positives. GEO Lens detects the page type — from
structured data, then the URL, then DOM signals — and swaps both the active
rules and the category weights.

| Profile | Rules switched off | Weights (E / S / En / C) |
|---|---|---|
| **Article** | none | .30 / .20 / .20 / .30 |
| **Product page** | TOC, question headings, buried definition | .25 / .20 / .25 / .30 |
| **Documentation** | first-person experience, outbound links, comparison table | .35 / .30 / .10 / .25 |
| **Homepage** | long paragraphs, buried definition, TOC, first-person, quotable count | .30 / .30 / .20 / .20 |

The detected profile is shown as a badge in the panel header; hovering it says
why. You can pin a profile in Settings.

---

## Revision tracking

Every scan is stored per URL (keyed by origin + path, so query strings don't
fragment a page's timeline) with the fingerprint of every issue found. The next
scan shows **`+21`** next to the score and *"7 issues fixed since the last scan
2d ago"*. History keeps 20 scans per page across 60 pages.

---

## Dismissing false positives

Each issue card has **Dismiss** (hide this exact issue on this page) and
**Ignore rule here** (stop reporting that rule on this whole site). Both persist
and are re-applied on every later scan; the header shows how many are hidden.
Clear them all in Settings.

---

## Settings

`options/options.html` — every threshold the rules use is tunable: wall-of-text
length, direct-answer sentence length, question-heading ratio, TOC word count,
highlight cap, retrieval chunk size, quotable count, and the per-severity
deductions. Also the content-type profile override and the report branding.

---

## Exported report

**Export** downloads a standalone HTML file containing the score, category
breakdown, every issue *with its rewrite*, the quotable passages, the orphaned
chunks and the revision delta. White-label it with your agency name, client name
and accent colour in Settings.

---

## Handling of edge cases

- **No article content** — the panel shows "No article content detected".
- **Very long pages** — only the first 50,000 words are analysed; the panel notes it.
- **Non-English pages** — every prose heuristic here (sentence splitting,
  question words, hedges, filler openers) is English-only. If the page declares a
  non-English `lang`, the panel and the report say the scores are unreliable
  rather than silently mis-scoring it.
- **CSP-strict sites** — all logic runs in the content script; the panel's styles
  are applied via `adoptedStyleSheets`, never an inline `<style>`/`<script>`.
- **SPAs** — re-scanning after in-page navigation re-extracts and re-renders.
  Injection is idempotent, so repeated scans never error or stack highlights.

---

## Architecture

```
geo-lens/
├── manifest.json            MV3 (activeTab, scripting, storage, downloads, contextMenus)
├── background.js            service worker: injection, all persisted state, downloads
├── popup/                   scan trigger, last score, delta badge, recent scans
├── options/                 settings page — thresholds, profile, branding, dismissals
├── onboarding/welcome.html  first-run page
├── content/
│   ├── highlighter.js       reversible text-node wrap/restore registry + palette
│   ├── util.js              shared text/DOM helpers
│   ├── settings.js          DEFAULT_SETTINGS + merge
│   ├── profiles.js          content-type detection, per-profile rules and weights
│   ├── rules/               extractability / structure / entity / citability
│   ├── fixers.js            issue -> corrected text (deterministic)
│   ├── ai-bridge.js         builds the model's job list, merges its output
│   ├── quotables.js         citation-candidate ranking
│   ├── chunks.js            retrieval preview + orphan detection
│   ├── scanner.js           orchestration, scoring, dismissals, delta
│   ├── panel.js             Shadow DOM side panel (3 views)
│   └── panel.css            canonical panel stylesheet
├── ai/engine.js             on-device Prompt API: prompts, JSON schemas,
│                            grounding guard, token budget
├── report/report-template.js  white-label standalone HTML report
├── test/harness.js          jsdom acceptance harness (131 checks)
├── icons/                   16/32/48/128 PNGs + reproducible generator
├── DECISIONS.md             design decisions
└── README.md
```

At most **60 inline highlights** are drawn (highest severity first, configurable);
remaining issues still list in the panel, marked "not highlighted".

See `DECISIONS.md` for the messaging contract, the injection model, the scope
boundary and the reasoning behind each heuristic.

---

## Tests

```sh
cd geo-lens/test
npm install jsdom
node harness.js
```

Loads the real content scripts into jsdom in the service worker's injection
order and runs the full pipeline: extraction, profile detection, rules,
dismissals, scoring, rewrite generation, quotables, chunking, panel render and
report export, plus the AI engine against a mock model. **131 checks, all
passing**, including:

- The Schema category is gone and no H1/hierarchy rule fires.
- Highlighting then clearing restores the article's `innerHTML` **byte-for-byte**.
- Named rewrite transforms produce the expected output (hedge stripped,
  enumeration becomes `<ul>` with the right item count, comparison table names
  both options).
- A well-optimised page scores ≥ 70 with ≤ 4 issues — the rules don't over-flag.
- Profiles suppress the right rules; a manual override wins.
- Dismissals suppress by rule and by fingerprint; fingerprints are stable across
  scans.
- Custom thresholds and deductions actually change the result.
- Report branding is HTML-escaped and a `javascript:` accent colour is rejected.
- `DEFAULT_SETTINGS` in `content/settings.js` and `background.js` stay in step.
- A re-scan does not stack highlights.
- **A model that fabricates a statistic has its rewrite discarded** and the
  mechanical fix kept; the rejection is counted.
- An absent, unavailable, crashing, or JSON-mangling model degrades cleanly —
  the scan still completes with deterministic output.
- Only skeleton-shaped fixes are sent to the model; exact mechanical transforms
  are never handed to it to degrade.
