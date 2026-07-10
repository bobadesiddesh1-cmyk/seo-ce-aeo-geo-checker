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
Scan any page for AI-search visibility issues. Inline colour highlights and a scored AEO/GEO audit with fixes. 100% local.
```

**Description**
```
GEO Lens shows you exactly why a page is — or isn't — ready to be cited by AI search: AI Overviews, ChatGPT, Perplexity, and Gemini.

Click Scan and GEO Lens analyses the main content of the page, highlights problems in colour right where they occur, and opens a side panel with an overall GEO score, five category sub-scores, and a concrete fix for every issue.

WHAT IT CHECKS
• Extractability — can an AI lift a direct answer? Walls of text, unanswered question headings, buried definitions, missing opening summaries.
• Structure — H1 usage, heading hierarchy, question headings, lists vs prose, comparison tables, table of contents.
• Entity & E-E-A-T — author, dates, sourced claims, first-hand experience, entity consistency.
• Schema — JSON-LD coverage: Article, FAQPage, HowTo, and broken markup.
• Citability — vague quantifiers, outbound sources, quotable stat-sentences, hedged claims.

FEATURES
• Colour-coded inline highlights, non-destructive (your page is restored exactly when you clear or close).
• Scored side panel (0–100 + A–F grade) with severity, the exact text affected, a plain-English explanation, and a fix for each issue.
• Click any issue to jump to it on the page.
• Toggle highlight categories on and off.
• Export a self-contained HTML report to send to clients.
• Recent-scan history.

PRIVACY
Everything runs locally in your browser. No account, no API key, no network calls, and no data ever leaves the page. GEO Lens requests no broad site access — it only runs when you click Scan.

Built for SEO professionals and content writers optimising for Answer Engine Optimization (AEO) and Generative Engine Optimization (GEO).
```

**Category:** `Developer Tools` (alternative: `Productivity`)

**Language:** English

---

## 3. Graphic assets

- **Store icon** — `geo-lens/icons/icon128.png` (128×128). ✅ included.
- **Small promo tile (440×280)** — `store/promo-tile-440x280.png`. ✅ included (optional but recommended).
- **Marquee promo (1400×560)** — `store/promo-marquee-1400x560.png`. ✅ included (optional).
- **Screenshots (1280×800 or 640×400, at least one, up to five)** — **[you provide]**.
  Take these from the running extension:
  1. Load the extension (chrome://extensions → Load unpacked → `geo-lens`).
  2. Open a real article (a Wikipedia page or a blog post works well).
  3. Click Scan. Capture: (a) the side panel with the score + issues, (b) the
     page with colour highlights visible, (c) the popup with a recent-scan list.
  4. Crop/resize each to exactly 1280×800 (or 640×400).

---

## 4. Privacy tab (required to publish)

**Single purpose (one sentence)**
```
GEO Lens audits the page you are viewing for AEO/GEO (AI-search) content quality and shows the issues and fixes.
```

**Permission justifications**

| Permission | Justification to paste |
|---|---|
| `activeTab` | Reads the current tab's content only when the user clicks Scan, to analyse it. No standing access to any site. |
| `scripting` | Injects the local analysis and the results panel into the page the user chose to scan. |
| `storage` | Saves the user's recent-scan history (URL, title, score, timestamp) locally on the device. |
| `downloads` | Saves the exported HTML audit report to the user's computer when they click Export. |

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
- [ ] Icon 128 + at least one 1280×800 screenshot uploaded.
- [ ] Single purpose + all four permission justifications filled.
- [ ] Data-usage form completed and three compliance boxes certified.
- [ ] Privacy policy URL is public and loads.
- [ ] Category and language set.
