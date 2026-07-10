/*
 * entity.js — ENTITY & E-E-A-T (yellow). Author, dates, sourced claims,
 * first-person experience, entity consistency. analyze(ctx) -> Issue[].
 */
(function () {
  'use strict';
  const NS = (window.__GEOLens = window.__GEOLens || {});
  NS.rules = NS.rules || {};
  if (NS.rules.entity) return;

  const CATEGORY = 'entity';
  const CLAIM_RE = /(\d+(\.\d+)?\s?%|[₹$€£]\s?\d|\bstudy\b|\bresearch\b|\bsurvey\b|according to)/i;
  const FIRST_PERSON_RE = /\b(we tested|i used|i tested|our analysis|we found|in our testing|i tried|we reviewed|our team|hands[- ]on)\b/i;
  const REVIEW_RE = /\b(review|vs\.?|versus|comparison|best|top \d|worst|ranked|rating)\b/i;
  const DATE_TEXT_RE = /\b(\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i;

  function hasAuthor(ctx) {
    const doc = ctx.doc;
    if (doc.querySelector('[rel="author"], [itemprop="author"], [class*="author" i], [class*="byline" i], [id*="author" i], a[href*="/author/" i]')) {
      return true;
    }
    if (ctx.jsonLd.hasAuthor || ctx.jsonLd.typeSet.has('person')) return true;
    // "By " near the top of the content.
    const head = NS.util.snippet(NS.util.textOf(ctx.root), 400);
    return /(^|\s)by\s+[A-Z][a-z]+/.test(head);
  }

  function hasDate(ctx) {
    const doc = ctx.doc;
    if (doc.querySelector('time[datetime], [itemprop="datePublished"], [itemprop="dateModified"], [class*="published" i], [class*="posted" i], [class*="date" i]')) {
      return true;
    }
    if (ctx.jsonLd.hasDate) return true;
    const head = NS.util.snippet(NS.util.textOf(ctx.root), 500);
    return DATE_TEXT_RE.test(head);
  }

  function analyze(ctx) {
    const U = NS.util;
    const issues = [];
    const anchor = ctx.openingParagraph || ctx.h1El || ctx.root;

    // 1) No visible author.
    if (!hasAuthor(ctx)) {
      issues.push({
        category: CATEGORY,
        severity: 'Medium',
        message: 'No visible author or byline detected. E-E-A-T signals (who wrote this) boost trust for AI answers.',
        fix: 'Add a visible byline and, ideally, Person/author structured data linking to an author bio.',
        node: anchor,
        snippet: U.snippet(ctx.title),
      });
    }

    // 2) No visible published/updated date.
    if (!hasDate(ctx)) {
      issues.push({
        category: CATEGORY,
        severity: 'Medium',
        message: 'No visible published or updated date. Freshness is a strong signal for AI answer engines.',
        fix: 'Show a published and last-updated date, backed by datePublished/dateModified in schema.',
        node: anchor,
        snippet: U.snippet(ctx.title),
      });
    }

    // 3) Statistics/claims with no adjacent source link.
    let claimCount = 0;
    ctx.paragraphs.forEach(function (p) {
      if (claimCount >= 8) return;
      const sentences = U.splitSentences(p.text);
      const hasLink = p.el.querySelector('a[href]');
      for (let i = 0; i < sentences.length; i++) {
        if (CLAIM_RE.test(sentences[i]) && !hasLink) {
          issues.push({
            category: CATEGORY,
            severity: 'Medium',
            message: 'A statistic or claim is stated with no source link. AI engines prefer verifiable, cited facts.',
            fix: 'Cite the source with an inline link to the study, dataset, or authority behind this claim.',
            node: p.el,
            snippet: U.snippet(sentences[i]),
          });
          claimCount++;
          break;
        }
      }
    });

    // 4) Review/comparison page with no first-person experience signals.
    const looksReview = REVIEW_RE.test(ctx.title) || REVIEW_RE.test(ctx.url) || (ctx.h1El && REVIEW_RE.test(U.textOf(ctx.h1El)));
    if (looksReview && !FIRST_PERSON_RE.test(ctx.plainText)) {
      issues.push({
        category: CATEGORY,
        severity: 'Low',
        message: 'This looks like a review/comparison but shows no first-hand experience signals ("we tested", "our analysis").',
        fix: 'Add first-person experience — what you tested, used, or measured — to satisfy the "Experience" in E-E-A-T.',
        node: anchor,
        snippet: U.snippet(ctx.title),
      });
    }

    // 5) Primary entity from title/H1 missing from the first paragraph.
    const entity = primaryEntity(ctx);
    if (entity && ctx.openingParagraph) {
      const intro = U.textOf(ctx.openingParagraph).toLowerCase();
      if (intro && intro.indexOf(entity.toLowerCase()) === -1) {
        issues.push({
          category: CATEGORY,
          severity: 'Low',
          message: 'The page’s primary entity ("' + entity + '") is not mentioned in the opening paragraph.',
          fix: 'Name the main entity in the first sentence so engines bind the page to the right topic.',
          node: ctx.openingParagraph,
          snippet: U.snippet(U.textOf(ctx.openingParagraph)),
        });
      }
    }

    return issues;
  }

  // Pick the longest meaningful token from the H1 (fallback: title) as the entity.
  function primaryEntity(ctx) {
    const U = NS.util;
    const src = (ctx.h1El && U.textOf(ctx.h1El)) || ctx.title || '';
    const stop = new Set(['the', 'and', 'for', 'with', 'your', 'from', 'that', 'this', 'what', 'how', 'why', 'best', 'guide', 'complete']);
    const tokens = src.split(/[^A-Za-z0-9]+/).filter(function (w) {
      return w.length >= 4 && !stop.has(w.toLowerCase());
    });
    tokens.sort(function (a, b) { return b.length - a.length; });
    return tokens[0] || '';
  }

  NS.rules.entity = analyze;
})();
