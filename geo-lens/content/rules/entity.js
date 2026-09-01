/*
 * entity.js — ENTITY & E-E-A-T (yellow). The PROSE-LEVEL trust signals:
 * unsourced statistical claims, missing first-hand experience on review-style
 * pages, and the primary entity going unnamed in the opening.
 *
 * Deliberately NOT here: author-byline presence and published/updated date
 * presence. Those are on-page SEO basics and are owned by SEO Sidekick.
 * See DECISIONS.md ("Scope boundary").
 *
 * analyze(ctx) -> Issue[]
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

  function analyze(ctx) {
    const U = NS.util;
    const issues = [];
    const anchor = ctx.openingParagraph || ctx.h1El || ctx.root;

    // 1) Statistics/claims with no adjacent source link.
    let claimCount = 0;
    ctx.paragraphs.forEach(function (p) {
      if (claimCount >= 8) return;
      const sentences = U.splitSentences(p.text);
      const hasLink = p.el.querySelector('a[href]');
      for (let i = 0; i < sentences.length; i++) {
        if (CLAIM_RE.test(sentences[i]) && !hasLink) {
          issues.push({
            ruleId: 'entity.unsourcedClaim',
            category: CATEGORY,
            severity: 'Medium',
            message: 'A statistic or claim is stated with no source link. AI engines prefer verifiable, cited facts.',
            fix: 'Cite the source with an inline link to the study, dataset, or authority behind this claim.',
            node: p.el,
            snippet: U.snippet(sentences[i]),
            rewriteData: { kind: 'citeClaim', sentence: sentences[i] },
          });
          claimCount++;
          break;
        }
      }
    });

    // 2) Review/comparison page with no first-person experience signals.
    const looksReview = REVIEW_RE.test(ctx.title) || REVIEW_RE.test(ctx.url) || (ctx.h1El && REVIEW_RE.test(U.textOf(ctx.h1El)));
    if (looksReview && !FIRST_PERSON_RE.test(ctx.plainText)) {
      issues.push({
        ruleId: 'entity.noFirstPersonExperience',
        category: CATEGORY,
        severity: 'Low',
        message: 'This looks like a review/comparison but shows no first-hand experience signals ("we tested", "our analysis").',
        fix: 'Add first-person experience — what you tested, used, or measured — to satisfy the "Experience" in E-E-A-T.',
        node: anchor,
        snippet: U.snippet(ctx.title),
        rewriteData: { kind: 'firstPerson', entity: primaryEntity(ctx) },
      });
    }

    // 3) Primary entity from title/H1 missing from the first paragraph.
    const entity = primaryEntity(ctx);
    if (entity && ctx.openingParagraph) {
      const intro = U.textOf(ctx.openingParagraph);
      if (intro && intro.toLowerCase().indexOf(entity.toLowerCase()) === -1) {
        issues.push({
          ruleId: 'entity.entityMissingFromOpening',
          category: CATEGORY,
          severity: 'Low',
          message: 'The page’s primary entity ("' + entity + '") is not mentioned in the opening paragraph.',
          fix: 'Name the main entity in the first sentence so engines bind the page to the right topic.',
          node: ctx.openingParagraph,
          snippet: U.snippet(intro),
          rewriteData: { kind: 'nameEntity', entity: entity, paragraph: intro },
        });
      }
    }

    return issues;
  }

  // Pick the page's subject from the H1 (fallback: title).
  //
  // Scored rather than "longest token": length alone picks the gerund out of
  // "Choosing a CDN" and throws away the acronym, and acronyms (CDN, DNS, API,
  // SEO) are precisely the entities these pages are about. Acronyms and proper
  // nouns win; leading gerunds and stock title words are excluded outright.
  const TITLE_STOP = new Set([
    'the', 'and', 'for', 'with', 'your', 'our', 'from', 'that', 'this', 'into',
    'what', 'how', 'why', 'when', 'which', 'who', 'where', 'are', 'you',
    'best', 'top', 'guide', 'complete', 'ultimate', 'review', 'reviews',
    'tips', 'ways', 'everything', 'need', 'know', 'about', 'explained',
    'introduction', 'overview', 'tutorial', 'beginners', 'beginner',
  ]);

  function primaryEntity(ctx) {
    const U = NS.util;
    const src = (ctx.h1El && U.textOf(ctx.h1El)) || ctx.title || '';
    const raw = src.split(/[^A-Za-z0-9]+/).filter(Boolean);

    let best = '';
    let bestScore = -Infinity;
    raw.forEach(function (w, i) {
      if (w.length < 2) return;
      const lower = w.toLowerCase();
      if (TITLE_STOP.has(lower)) return;
      if (/^[a-z]+ing$/.test(lower) && i === 0) return; // leading gerund verb

      let score = 0;
      if (/^[A-Z0-9]{2,6}$/.test(w) && w === w.toUpperCase() && /[A-Z]/.test(w)) score += 12; // acronym
      else if (/^[A-Z]/.test(w)) score += 5;                                                  // proper noun
      if (w.length >= 4) score += 2;
      if (i > 0) score += 1; // later tokens are usually the noun, not the verb

      if (score > bestScore) { bestScore = score; best = w; }
    });

    if (best) return best;
    // Nothing scored: fall back to the longest non-trivial token.
    const fallback = raw.filter(function (w) { return w.length >= 4 && !TITLE_STOP.has(w.toLowerCase()); });
    fallback.sort(function (a, b) { return b.length - a.length; });
    return fallback[0] || '';
  }

  NS.rules.entity = analyze;
  NS.primaryEntity = primaryEntity;
})();
