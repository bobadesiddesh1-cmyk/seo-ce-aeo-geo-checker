/*
 * citability.js — CITABILITY (purple). Whether sentences are quotable and
 * sourced enough for an AI engine to cite them. analyze(ctx) -> Issue[].
 */
(function () {
  'use strict';
  const NS = (window.__GEOLens = window.__GEOLens || {});
  NS.rules = NS.rules || {};
  if (NS.rules.citability) return;

  const CATEGORY = 'citability';
  const VAGUE = ['a lot of', 'most people', 'many', 'several', 'significantly', 'huge'];
  const VAGUE_RE = new RegExp('\\b(' + VAGUE.map(function (v) { return v.replace(/ /g, '\\s+'); }).join('|') + ')\\b', 'i');
  const HEDGE_RE = /^(it could be argued|some say|it might be|it may be|arguably|perhaps)\b/i;
  const DEF_RE = / is an? | are | means | refers to /;

  function analyze(ctx) {
    const U = NS.util;
    const issues = [];
    const anchor = ctx.openingParagraph || ctx.h1El || ctx.root;

    // 1) Vague quantifiers where a number could exist (cap 10).
    let vagueCount = 0;
    outer:
    for (let pi = 0; pi < ctx.paragraphs.length; pi++) {
      const p = ctx.paragraphs[pi];
      const sentences = U.splitSentences(p.text);
      for (let i = 0; i < sentences.length; i++) {
        const m = sentences[i].match(VAGUE_RE);
        if (m) {
          issues.push({
            category: CATEGORY,
            severity: 'Low',
            message: 'Vague quantifier "' + m[1] + '" where a concrete number would be more citable.',
            fix: 'Replace "' + m[1] + '" with a specific figure or range an engine can quote.',
            node: p.el,
            snippet: m[0],
          });
          vagueCount++;
          if (vagueCount >= 10) break outer;
        }
      }
    }

    // 2) Zero outbound links to authoritative sources in main content.
    if (countOutboundLinks(ctx) === 0) {
      issues.push({
        category: CATEGORY,
        severity: 'High',
        message: 'The main content has no outbound links to authoritative sources.',
        fix: 'Link out to primary sources, studies, or official documentation — corroborated pages get cited more.',
        node: anchor,
        snippet: U.snippet(ctx.title),
      });
    }

    // 3) Too few standalone quotable sentences (8–25 words, with a number/definition).
    let quotable = 0;
    for (let pi = 0; pi < ctx.paragraphs.length; pi++) {
      const sentences = U.splitSentences(ctx.paragraphs[pi].text);
      for (let i = 0; i < sentences.length; i++) {
        const wc = U.wordCount(sentences[i]);
        if (wc >= 8 && wc <= 25 && (/\d/.test(sentences[i]) || DEF_RE.test(' ' + sentences[i] + ' '))) {
          quotable++;
        }
      }
    }
    if (quotable < 3) {
      issues.push({
        category: CATEGORY,
        severity: 'Medium',
        message: 'Only ' + quotable + ' crisp, quotable stat-sentence' + (quotable === 1 ? '' : 's') + ' found. AI engines cite short, self-contained factual sentences.',
        fix: 'Add citable stat-sentences: short (8–25 word) declaratives that each carry one number or definition.',
        node: anchor,
        snippet: U.snippet(ctx.title),
      });
    }

    // 4) Hedged claims.
    let hedgeCount = 0;
    for (let pi = 0; pi < ctx.paragraphs.length; pi++) {
      if (hedgeCount >= 8) break;
      const p = ctx.paragraphs[pi];
      const sentences = U.splitSentences(p.text);
      for (let i = 0; i < sentences.length; i++) {
        if (HEDGE_RE.test(sentences[i])) {
          issues.push({
            category: CATEGORY,
            severity: 'Low',
            message: 'Hedged claim ("' + U.snippet(sentences[i], 40) + '") reads as low-confidence and is rarely cited.',
            fix: 'State the claim directly and back it with a source, or cut it.',
            node: p.el,
            snippet: U.snippet(sentences[i]),
          });
          hedgeCount++;
          break;
        }
      }
    }

    return issues;
  }

  function countOutboundLinks(ctx) {
    let host = '';
    try { host = new URL(ctx.url).hostname.replace(/^www\./, ''); } catch (e) { host = location.hostname.replace(/^www\./, ''); }
    const links = ctx.root.querySelectorAll('a[href]');
    let n = 0;
    for (let i = 0; i < links.length; i++) {
      const href = links[i].getAttribute('href') || '';
      if (!/^https?:/i.test(href)) continue;
      let h;
      try { h = new URL(href, ctx.url).hostname.replace(/^www\./, ''); } catch (e) { continue; }
      if (h && h !== host) n++;
    }
    return n;
  }

  NS.rules.citability = analyze;
})();
