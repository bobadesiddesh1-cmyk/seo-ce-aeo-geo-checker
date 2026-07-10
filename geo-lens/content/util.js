/*
 * util.js — shared, dependency-free text/DOM helpers used by every rule.
 * Loaded after highlighter.js, before the rules. Attaches window.__GEOLens.util.
 */
(function () {
  'use strict';
  const NS = (window.__GEOLens = window.__GEOLens || {});
  if (NS.util) return;

  const QUESTION_WORDS = new Set([
    'what', 'how', 'why', 'when', 'which', 'who', 'where',
    'can', 'is', 'are', 'does', 'do', 'should', 'will', 'could', 'would',
  ]);

  const FILLER_OPENERS = [
    "in today's", 'when it comes to', 'there are many', 'it is important',
    'in this article', 'in this post', 'in the world of', 'over the years',
  ];

  function normalizeWs(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  function words(s) {
    const t = normalizeWs(s);
    return t ? t.split(' ') : [];
  }

  function wordCount(s) {
    return words(s).length;
  }

  // Approximate sentence splitter with guards for common abbreviations.
  function splitSentences(text) {
    const t = normalizeWs(text);
    if (!t) return [];
    const guarded = t
      .replace(/\b(e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Prof|St|Sr|Jr|Inc|Ltd|Co|No|Fig|Eq|Vol|pp|Ph\.D)\./gi, '$1<DOT>')
      .replace(/\b([A-Z])\./g, '$1<DOT>');
    const parts = guarded.split(/(?<=[.!?])\s+(?=["“'(\[]?[A-Z0-9])/);
    return parts
      .map(function (s) { return s.replace(/<DOT>/g, '.').trim(); })
      .filter(Boolean);
  }

  function firstSentence(text) {
    const s = splitSentences(text);
    return s.length ? s[0] : normalizeWs(text);
  }

  function isQuestionHeading(text) {
    const t = normalizeWs(text);
    if (!t) return false;
    if (t.endsWith('?')) return true;
    const first = (t.split(' ')[0] || '').toLowerCase().replace(/[^a-z']/g, '');
    return QUESTION_WORDS.has(first);
  }

  function startsWithFiller(text) {
    const t = normalizeWs(text).toLowerCase();
    return FILLER_OPENERS.some(function (f) { return t.startsWith(f); });
  }

  function textOf(el) {
    return el ? normalizeWs(el.textContent) : '';
  }

  function snippet(text, max) {
    const t = normalizeWs(text);
    max = max || 160;
    return t.length > max ? t.slice(0, max - 1).trim() + '…' : t;
  }

  function firstParagraphAfter(el, root) {
    if (!el || !root) return null;
    const ps = root.querySelectorAll('p');
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (
        (el.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        textOf(p)
      ) {
        return p;
      }
    }
    return null;
  }

  NS.util = {
    QUESTION_WORDS,
    FILLER_OPENERS,
    normalizeWs,
    words,
    wordCount,
    splitSentences,
    firstSentence,
    isQuestionHeading,
    startsWithFiller,
    textOf,
    snippet,
    firstParagraphAfter,
  };
})();
