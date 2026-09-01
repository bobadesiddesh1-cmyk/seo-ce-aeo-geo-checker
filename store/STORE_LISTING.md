# Chrome Web Store — submission pack

Everything you need to fill in the Developer Dashboard for GEO Lens. Copy/paste
the fields below. Items marked **[you provide]** are things only you can make
(screenshots of the running extension, hosting the privacy URL).

---

## 1. Package to upload

Upload **`geo-lens.zip`** (built from the `geo-lens/` folder, with `manifest.json`
at the root of the zip). Rebuild it any time with:

```bash
cd geo-lens && zip -r ../geo-lens.zip . -x '*.DS_Store'
```

---

## 2. Store listing fields

**Item name / Title**
```
GEO Lens — AEO/GEO Content Auditor
```

**Summary (short description, max 132 chars)**
```
AI-search content auditor: colour highlights, a scored AEO/GEO audit, and copy-ready rewrites for every issue. 100% local.
```

**Description**
```
GEO Lens shows you exactly why a page is — or isn't — ready to be cited by AI search: AI Overviews, ChatGPT, Perplexity, and Gemini. Then it writes the fix for you.

Click Scan and GEO Lens analyses the page's prose, highlights problems in colour right where they occur, and opens a side panel with an overall GEO score, four category sub-scores, and — for every issue that can be mechanically corrected — the replacement text, ready to copy.

IT WRITES THE FIX, NOT JUST THE DIAGNOSIS
• A 200-word wall of text, split into balanced paragraphs at real sentence boundaries.
• A question heading whose paragraph buries the answer, reordered to lead with it.
• "It could be argued that latency is the only metric" becomes "Latency is the only metric".
• A comma-run enumeration turned into <ul> list markup.
• Comparison content with no table: a <table> skeleton naming both options.
• A long page with no jump links: a <nav> table of contents built from its own headings.
• "Benefits of edge caching" rewritten as "What are the benefits of edge caching?"
Where a real rewrite would need facts the page doesn't state, you get a clearly labelled skeleton — never invented content.

WHAT IT CHECKS
• Extractability — can an AI lift a direct answer? Walls of text, unanswered question headings, buried definitions, missing opening summaries.
• Structure — question headings, lists vs prose, comparison tables, table of contents.
• Entity & E-E-A-T — sourced claims, first-hand experience, entity clarity in the opening.
• Citability — vague quantifiers, outbound sources, quotable stat-sentences, hedged claims.

TWO MORE VIEWS
• Quotable — the sentences an engine is most likely to lift verbatim, ranked and scored. If none qualify, it says so instead of promoting a weak one.
• Retrieval — how the page splits into chunks for retrieval, and which chunks are orphans: passages that lose their subject when retrieved alone ("It reduced costs by 30%" with no antecedent).

BUILT NOT TO CRY WOLF
• Content-type profiles — a product page, a documentation page and a long-form article are graded by different rubrics, so you don't get flagged for things that don't apply.
• Dismiss any issue for a page, or ignore a rule across a whole site. It sticks.
• Every category score shows its own arithmetic, so a number is never unexplained.
• Non-English pages are told the English-only rules make the score unreliable, rather than being silently mis-scored.

ALSO
• Colour-coded inline highlights, non-destructive — your page is restored exactly when you clear or close.
• Revision tracking: "+21 since your last scan, 7 issues fixed".
• Export a white-labelled HTML report (your agency name, client name and accent colour) to send to clients.
• Copy every fix on the page as Markdown in one click.
• Keyboard shortcut (Alt+Shift+G) and a right-click menu item.
• Tune every threshold in Settings.

SCOPE
GEO Lens audits the editorial layer — the prose itself. It deliberately does not check titles, meta descriptions, H1 counts, canonicals, schema validity, hreflang or crawler access; those are on-page and technical SEO, and a dedicated SEO toolkit handles them better.

PRIVACY
Everything runs locally in your browser. No account, no API key, no network calls, and no data ever leaves the page. GEO Lens requests no broad site access — it only runs when you scan.

Built for SEO professionals and content writers optimising for Answer Engine Optimization (AEO) and Generative Engine Optimization (GEO).
```

**Category:** `Developer Tools` (alternative: `Productivity`)

**Language:** English

---

## 3. Graphic assets

- **Store icon** — `geo-lens/icons/icon128.png` (128×128). ✅ included.
- **Small promo tile (440×280)** — `store/promo-tile-440x280.png`. ✅ included (optional but recommended).
- **Marquee promo (1400×560)** — `store/promo-marquee-1400x560.png`. ✅ included (optional).
- **Screenshots (1280×800, at least one, up to five)** — ✅ three ready-to-upload
  screenshots are included in `store/screenshots/`:
  - `01-panel-and-highlights.png` — article with colour highlights + scored panel
  - `02-popup-and-pitch.png` — popup with score and recent scans
  - `03-exported-report.png` — the exported HTML audit report

  **These three predate v2 and no longer show the current UI** — they still show
  five categories (including the removed Schema one) and no rewrite blocks.
  Recapture them before submitting: the rewrite card with its Copy button and the
  Quotable view are the strongest things to lead with.
  These are polished representative mockups built from the real UI and the real
  report generator, and are fine to submit as-is. **Recommended:** also capture a
  couple of real screenshots from your own scans later (open the extension, scan
  an article, screenshot the panel) and swap them in — real captures of live
  pages tend to convert best. Any replacement must also be exactly 1280×800.

---

## 4. Privacy tab (required to publish)

**Single purpose (one sentence)**
```
GEO Lens audits the prose of the page you are viewing for AEO/GEO (AI-search) content quality and shows each issue with corrected replacement text.
```

**Permission justifications**

| Permission | Justification to paste |
|---|---|
| `activeTab` | Reads the current tab's content only when the user clicks Scan, to analyse it. No standing access to any site. |
| `scripting` | Injects the local analysis and the results panel into the page the user chose to scan. |
| `storage` | Saves the user's settings, scan history (URL, title, score, timestamp) and dismissed-issue list locally on the device. |
| `downloads` | Saves the exported HTML audit report to the user's computer when they click Export. |
| `contextMenus` | Adds a right-click "Scan this page with GEO Lens" item so the user can start a scan without opening the popup. |

**Host permission justification:** None requested — the extension uses `activeTab`
instead, so it only runs on the tab after an explicit user click.

**Are you using remote code?** `No` — all code is in the package; no external
scripts are loaded.

**Data usage disclosures (check these):**
- Does your item collect or use user data? **You store data locally only.** In
  the data-collection form, declare that you do **not** collect or transmit any
  of the user-data categories (no personally identifiable info, no browsing
  history sent, no analytics). Local `chrome.storage` history is not
  "collection" because it never leaves the device and is not sent to you.
- Certify the three compliance checkboxes:
  - I do not sell or transfer user data to third parties (outside approved use cases). ✅
  - I do not use or transfer user data for purposes unrelated to the item's single purpose. ✅
  - I do not use or transfer user data to determine creditworthiness or for lending. ✅

**Privacy policy URL** — **[you provide a public URL]**. Use the included
`store/privacy-policy.html`. Easiest way to host it free:
1. Make sure the GitHub repo is **public**.
2. In the repo: Settings → Pages → Build from branch → `main` → `/root` → Save.
3. After it deploys, your URL will be:
   `https://bobadesiddesh1-cmyk.github.io/seo-ce-aeo-geo-checker/store/privacy-policy.html`
   (move the file to the served branch/path if you pick a different Pages source.)

---

## 5. Submit

Distribution → choose **Public** (or Unlisted while you test), then
**Submit for review**. Review usually takes a few hours to a few days.

---

## 6. Pre-submit checklist

- [ ] Registered as a Chrome Web Store developer ($5 one-time fee).
- [ ] `geo-lens.zip` uploaded (manifest at zip root).
- [ ] Title, summary, description filled from section 2.
- [ ] Icon 128 + at least one 1280×800 screenshot uploaded (three are in `store/screenshots/`).
- [ ] Single purpose + all five permission justifications filled.
- [ ] Data-usage form completed and three compliance boxes certified.
- [ ] Privacy policy URL is public and loads.
- [ ] Category and language set.
