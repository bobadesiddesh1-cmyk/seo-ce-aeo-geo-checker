/*
 * structure.js — STRUCTURE (orange). Heading hierarchy, question headings,
 * lists, comparison tables, table of contents. analyze(ctx) -> Issue[].
 */
(function () {
  'use strict';
  const NS = (window.__GEOLens = window.__GEOLens || {});
  NS.rules = NS.rules || {};
  if (NS.rules.structure) return;

  const CATEGORY = 'structure';
  const COMPARE_RE = /\b(vs\.?|versus|compared to|difference between)\b/i;

  function analyze(ctx) {
    const U = NS.util;
    const issues = [];
    const anchor = ctx.h1El || ctx.openingParagraph || ctx.root;

    // 1) Missing or multiple H1s (document-wide).
    const h1s = ctx.doc.querySelectorAll('h1');
    if (h1s.length === 0) {
      issues.push({
        category: CATEGORY,
        severity: 'High',
        message: 'No H1 heading found. AI and search crawlers rely on the H1 as the page’s primary topic.',
        fix: 'Add exactly one H1 that states the page’s main subject in plain language.',
        node: anchor,
        snippet: U.snippet(ctx.title),
      });
    } else if (h1s.length > 1) {
      issues.push({
        category: CATEGORY,
        severity: 'Medium',
        message: 'Multiple H1 headings (' + h1s.length + ') found. This muddies the page’s primary topic signal.',
        fix: 'Keep a single H1; demote the others to H2/H3.',
        node: h1s[1],
        snippet: U.snippet(U.textOf(h1s[1])),
      });
    }

    // 2) Heading hierarchy skips (e.g. H2 -> H4).
    for (let i = 1; i < ctx.headings.length; i++) {
      const prev = ctx.headings[i - 1];
      const cur = ctx.headings[i];
      if (cur.level - prev.level > 1) {
        issues.push({
          category: CATEGORY,
          severity: 'Low',
          message: 'Heading level jumps from H' + prev.level + ' to H' + cur.level + ', skipping a level.',
          fix: 'Use sequential heading levels so the outline is machine-readable.',
          node: cur.el,
          snippet: U.snippet(cur.text),
        });
      }
    }

    // 3) Fewer than 30% of H2s phrased as questions.
    const h2s = ctx.headings.filter(function (h) { return h.level === 2; });
    if (h2s.length >= 2) {
      const q = h2s.filter(function (h) { return U.isQuestionHeading(h.text); }).length;
      if (q / h2s.length < 0.30) {
        issues.push({
          category: CATEGORY,
          severity: 'Medium',
          message: 'Only ' + q + ' of ' + h2s.length + ' H2s are phrased as questions. AI engines map question headings to user queries.',
          fix: 'Rewrite some H2s as the questions readers actually ask (e.g. "How does X work?", "Is X worth it?").',
          node: h2s[0].el,
          snippet: U.snippet(h2s[0].text),
        });
      }
    }

    // 4) Long comma-prose enumerations that should be lists.
    let listCount = 0;
    ctx.paragraphs.forEach(function (p) {
      if (listCount >= 6) return;
      const sentences = U.splitSentences(p.text);
      for (let i = 0; i < sentences.length; i++) {
        const commas = (sentences[i].match(/,/g) || []).length;
        if (commas >= 4) {
          issues.push({
            category: CATEGORY,
            severity: 'Low',
            message: 'A long comma-separated enumeration reads as prose. Lists are far easier for AI engines to parse and cite.',
            fix: 'Convert this enumeration into a <ul> or <ol>.',
            node: p.el,
            snippet: U.snippet(sentences[i]),
          });
          listCount++;
          break;
        }
      }
    });

    // 5) Comparison content with no table anywhere on the page.
    if (!ctx.doc.querySelector('table')) {
      let compareNode = null;
      let compareText = '';
      for (let i = 0; i < ctx.headings.length; i++) {
        if (COMPARE_RE.test(ctx.headings[i].text)) { compareNode = ctx.headings[i].el; compareText = ctx.headings[i].text; break; }
      }
      if (!compareNode) {
        for (let i = 0; i < ctx.paragraphs.length; i++) {
          if (COMPARE_RE.test(ctx.paragraphs[i].text)) { compareNode = ctx.paragraphs[i].el; compareText = U.firstSentence(ctx.paragraphs[i].text); break; }
        }
      }
      if (compareNode) {
        issues.push({
          category: CATEGORY,
          severity: 'Medium',
          message: 'The page compares options but has no comparison table. AI engines lift side-by-side data from tables.',
          fix: 'Add an HTML <table> summarising the comparison (rows = options, columns = criteria).',
          node: compareNode,
          snippet: U.snippet(compareText),
        });
      }
    }

    // 6) No table of contents / jump links on long pages (>1500 words).
    if (ctx.wordCount > 1500 && !hasToc(ctx)) {
      issues.push({
        category: CATEGORY,
        severity: 'Low',
        message: 'This page is ' + ctx.wordCount + ' words but has no table of contents or jump links.',
        fix: 'Add an in-page TOC with anchor links to each section so engines (and readers) can navigate.',
        node: anchor,
        snippet: U.snippet(ctx.title),
      });
    }

    return issues;
  }

  function hasToc(ctx) {
    const doc = ctx.doc;
    if (doc.querySelector('nav [href^="#"], [class*="toc" i], [id*="toc" i], [class*="table-of-contents" i]')) {
      return true;
    }
    const anchors = ctx.root.querySelectorAll('a[href^="#"]');
    return anchors.length >= 3;
  }

  NS.rules.structure = analyze;
})();
