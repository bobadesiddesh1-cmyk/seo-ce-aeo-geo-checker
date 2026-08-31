/*
 * quotables.js — the inverse of the issue list.
 *
 * Every other part of GEO Lens finds what is wrong. This finds what is right:
 * the sentences on the page most likely to be lifted verbatim as a citation by
 * an AI answer engine. A page with no strong candidate is told so plainly
 * rather than being handed a weak "best" one.
 *
 * A citable sentence is short, self-contained (no dangling pronoun), carries one
 * concrete fact, and does not hedge.
 *
 * extract(ctx) -> { candidates: [...], threshold }
 * Attaches window.__GEOLens.quotables.
 */
(function () {
  'use strict';
  const NS = (window.__GEOLens = window.__GEOLens || {});
  if (NS.quotables) return;

  const DEF_RE = / is an? | are | means | refers to /;
  const DANGLING_RE = /^(it|this|that|they|these|those|he|she|there|such|both|either|neither)\b/i;
  const VAGUE_RE = /\b(a lot of|most people|many|several|significantly|huge)\b/i;
  const FILLER_RE = /^(in today|when it comes to|there are many|it is important|in this article|in this post)/i;

  // Below this a sentence is not worth presenting as a citation candidate.
  const THRESHOLD = 10;

  function scoreSentence(text, ctx) {
    const U = NS.util;
    const wc = U.wordCount(text);
    const reasons = [];
    let score = 0;

    // Length: the citable band is 8–25 words, peaking around 16.
    if (wc < 8 || wc > 30) return null;
    if (wc <= 25) { score += 8 - Math.min(8, Math.abs(wc - 16) / 2); reasons.push(wc + ' words'); }
    else score -= 4;

    // One concrete fact.
    if (/\d/.test(text)) { score += 7; reasons.push('carries a figure'); }
    if (/[₹$€£]\s?\d|\d\s?%/.test(text)) { score += 3; }
    if (DEF_RE.test(' ' + text + ' ')) { score += 5; reasons.push('states a definition'); }

    // Self-contained: no pronoun that needs the previous sentence.
    if (DANGLING_RE.test(text)) { score -= 12; reasons.push('opens with a dangling reference'); }

    // Names the page's subject, so it survives being quoted alone.
    if (ctx.primaryEntity && text.toLowerCase().indexOf(ctx.primaryEntity.toLowerCase()) !== -1) {
      score += 5;
      reasons.push('names the page subject');
    }

    // Confidence.
    if (NS.HEDGE_RE && NS.HEDGE_RE.test(text)) { score -= 10; reasons.push('hedged'); }
    if (VAGUE_RE.test(text)) { score -= 5; reasons.push('vague quantifier'); }
    if (FILLER_RE.test(text)) { score -= 8; reasons.push('filler opener'); }

    // Ends as a complete declarative.
    if (/[.!]$/.test(text.trim())) score += 2;
    if (/\?$/.test(text.trim())) score -= 6;

    return { score: Math.round(score), reasons: reasons };
  }

  function extract(ctx) {
    const U = NS.util;
    const limit = (ctx.settings && ctx.settings.quotableCount) || 5;
    const out = [];

    ctx.paragraphs.forEach(function (p) {
      const sentences = U.splitSentences(p.text);
      sentences.forEach(function (s) {
        const r = scoreSentence(s, ctx);
        if (!r) return;
        out.push({ text: s, score: r.score, reasons: r.reasons, node: p.el });
      });
    });

    out.sort(function (a, b) { return b.score - a.score; });

    // De-duplicate near-identical sentences before taking the top N.
    const seen = {};
    const picked = [];
    for (let i = 0; i < out.length && picked.length < limit; i++) {
      const key = out[i].text.slice(0, 60).toLowerCase();
      if (seen[key]) continue;
      seen[key] = 1;
      picked.push(out[i]);
    }

    return {
      threshold: THRESHOLD,
      candidates: picked.filter(function (c) { return c.score >= THRESHOLD; }),
      considered: out.length,
    };
  }

  NS.quotables = { extract: extract, THRESHOLD: THRESHOLD };
})();
