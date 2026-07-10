/*
 * schema.js — SCHEMA (blue). Structured-data (JSON-LD) coverage. All issues are
 * page-level and anchor their highlight to the H1. analyze(ctx) -> Issue[].
 *
 * Relies on ctx.jsonLd built by the scanner:
 *   { scriptCount, nodes:[{ '@type', ... }], errors:[{text,error}], typeSet:Set }
 */
(function () {
  'use strict';
  const NS = (window.__GEOLens = window.__GEOLens || {});
  NS.rules = NS.rules || {};
  if (NS.rules.schema) return;

  const CATEGORY = 'schema';
  const ARTICLE_TYPES = ['article', 'blogposting', 'newsarticle', 'techarticle', 'report'];

  function analyze(ctx) {
    const U = NS.util;
    const jl = ctx.jsonLd;
    const issues = [];
    const anchor = ctx.h1El || ctx.openingParagraph || ctx.root;
    const push = function (severity, message, fix, snippet) {
      issues.push({ category: CATEGORY, severity: severity, message: message, fix: fix, node: anchor, snippet: snippet || U.snippet(ctx.title) });
    };

    // 6) Broken JSON-LD (report first; a parse error is worse than absence).
    jl.errors.forEach(function (e) {
      push('High',
        'A JSON-LD block failed to parse: ' + U.snippet(e.error, 120) + '.',
        'Fix the JSON syntax so crawlers can read your structured data. Offending block starts: "' + U.snippet(e.text, 60) + '".',
        U.snippet(e.text, 80));
    });

    // 1) No structured data at all (no parseable nodes and nothing broken).
    if (jl.nodes.length === 0 && jl.errors.length === 0) {
      push('High',
        'No structured data (JSON-LD) found on the page. Schema is how AI engines confirm what the page is about.',
        'Add JSON-LD markup — at minimum Article/BlogPosting for content pages, plus Organization/WebSite.');
      // With nothing present, the more specific checks below are moot.
      return issues;
    }

    const types = jl.typeSet;
    const hasArticle = ARTICLE_TYPES.some(function (t) { return types.has(t); });

    // 2) Article-like page missing Article/BlogPosting schema.
    if (ctx.isArticleLike && !hasArticle) {
      push('Medium',
        'This reads like an article but has no Article/BlogPosting schema.',
        'Add Article or BlogPosting JSON-LD with headline, author, datePublished, and dateModified.');
    }

    // 3) 3+ question headings but no FAQPage schema.
    const questionHeadings = ctx.headings.filter(function (h) {
      return (h.level === 2 || h.level === 3) && U.isQuestionHeading(h.text);
    }).length;
    if (questionHeadings >= 3 && !types.has('faqpage')) {
      push('Medium',
        'The page has ' + questionHeadings + ' question-style headings but no FAQPage schema.',
        'Wrap the Q&A pairs in FAQPage structured data so they can appear as rich answers.');
    }

    // 4) Step-by-step content but no HowTo schema.
    if (hasSteps(ctx) && !types.has('howto')) {
      push('Medium',
        'The page has step-by-step instructions but no HowTo schema.',
        'Add HowTo JSON-LD describing each step so engines can present the procedure directly.');
    }

    // 5) Article schema present but missing key fields.
    if (hasArticle) {
      const node = jl.nodes.find(function (n) {
        const t = typeString(n['@type']);
        return ARTICLE_TYPES.some(function (a) { return t.indexOf(a) !== -1; });
      });
      if (node) {
        const missing = ['headline', 'author', 'datePublished', 'dateModified'].filter(function (f) {
          return node[f] === undefined || node[f] === null || node[f] === '';
        });
        if (missing.length) {
          push('Low',
            'Article schema is present but missing: ' + missing.join(', ') + '.',
            'Populate the missing field' + (missing.length > 1 ? 's' : '') + ' (' + missing.join(', ') + ') in your Article JSON-LD.');
        }
      }
    }

    return issues;
  }

  function typeString(t) {
    if (!t) return '';
    return (Array.isArray(t) ? t.join(' ') : String(t)).toLowerCase();
  }

  function hasSteps(ctx) {
    if (/\bstep\s*1\b/i.test(ctx.plainText) && /\bstep\s*2\b/i.test(ctx.plainText)) return true;
    const ols = ctx.root.querySelectorAll('ol');
    for (let i = 0; i < ols.length; i++) {
      if (ols[i].querySelectorAll('li').length >= 3) return true;
    }
    return false;
  }

  NS.rules.schema = analyze;
})();
