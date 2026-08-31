/*
 * structure.js — STRUCTURE (orange). The EDITORIAL shape of the outline:
 * question headings, prose that should be a list, comparison content without a
 * table, and missing jump links on long pages.
 *
 * Deliberately NOT here: missing/duplicate H1 and heading-level skips. Those
 * are on-page SEO basics and are owned by SEO Sidekick's on-page analyzer.
 * GEO Lens does not duplicate them. See DECISIONS.md ("Scope boundary").
 *
 * analyze(ctx) -> Issue[]
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
    const S = ctx.settings;
    const issues = [];
    const anchor = ctx.h1El || ctx.openingParagraph || ctx.root;

    // 1) Too few H2s phrased as the questions readers actually ask.
    const h2s = ctx.headings.filter(function (h) { return h.level === 2; });
    if (h2s.length >= 2) {
      const qHeads = h2s.filter(function (h) { return U.isQuestionHeading(h.text); });
      const ratio = qHeads.length / h2s.length;
      if (ratio < S.questionHeadingRatio) {
        issues.push({
          ruleId: 'structure.questionHeadingRatio',
          category: CATEGORY,
          severity: 'Medium',
          message: 'Only ' + qHeads.length + ' of ' + h2s.length + ' H2s are phrased as questions. AI engines map question headings to user queries.',
          fix: 'Rewrite some H2s as the questions readers actually ask (e.g. "How does X work?", "Is X worth it?").',
          node: h2s[0].el,
          snippet: U.snippet(h2s[0].text),
          rewriteData: { kind: 'questionHeadings', headings: h2s.slice(0, 5).map(function (h) { return h.text; }) },
        });
      }
    }

    // 2) Long comma-prose enumerations that should be lists.
    let listCount = 0;
    ctx.paragraphs.forEach(function (p) {
      if (listCount >= 6) return;
      const sentences = U.splitSentences(p.text);
      for (let i = 0; i < sentences.length; i++) {
        const commas = (sentences[i].match(/,/g) || []).length;
        if (commas >= 4) {
          issues.push({
            ruleId: 'structure.proseEnumeration',
            category: CATEGORY,
            severity: 'Low',
            message: 'A long comma-separated enumeration reads as prose. Lists are far easier for AI engines to parse and cite.',
            fix: 'Convert this enumeration into a <ul> or <ol>.',
            node: p.el,
            snippet: U.snippet(sentences[i]),
            rewriteData: { kind: 'enumerationToList', sentence: sentences[i] },
          });
          listCount++;
          break;
        }
      }
    });

    // 3) Comparison content with no table anywhere on the page.
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
          ruleId: 'structure.noComparisonTable',
          category: CATEGORY,
          severity: 'Medium',
          message: 'The page compares options but has no comparison table. AI engines lift side-by-side data from tables.',
          fix: 'Add an HTML <table> summarising the comparison (rows = options, columns = criteria).',
          node: compareNode,
          snippet: U.snippet(compareText),
          rewriteData: { kind: 'comparisonTable', source: compareText },
        });
      }
    }

    // 4) No table of contents / jump links on long pages.
    if (ctx.wordCount > S.tocMinWords && !hasToc(ctx)) {
      issues.push({
        ruleId: 'structure.noToc',
        category: CATEGORY,
        severity: 'Low',
        message: 'This page is ' + ctx.wordCount + ' words but has no table of contents or jump links.',
        fix: 'Add an in-page TOC with anchor links to each section so engines (and readers) can navigate.',
        node: anchor,
        snippet: U.snippet(ctx.title),
        rewriteData: { kind: 'toc', headings: ctx.headings.filter(function (h) { return h.level === 2 || h.level === 3; }).slice(0, 20) .map(function (h) { return { level: h.level, text: h.text }; }) },
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
