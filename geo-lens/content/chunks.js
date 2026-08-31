/*
 * chunks.js — retrieval preview.
 *
 * An AI answer engine rarely reads a page whole. It splits it into passages,
 * embeds them, and retrieves one or two in isolation. A passage that reads
 * "It cut costs by 30%" is uncitable no matter how good the prose is, because
 * the subject lives three paragraphs up.
 *
 * This module splits the content the way a retrieval pipeline would — bounded
 * by headings, capped at roughly N tokens — and flags ORPHAN chunks: those that
 * lose their subject once separated from the rest of the page.
 *
 * build(ctx) -> { chunks: [...], orphanCount, tokenBudget }
 * Attaches window.__GEOLens.chunks.
 */
(function () {
  'use strict';
  const NS = (window.__GEOLens = window.__GEOLens || {});
  if (NS.chunks) return;

  const DANGLING_RE = /^(it|this|that|they|these|those|he|she|such)\b/i;
  // Rough English words->tokens ratio; good enough to size a preview.
  const TOKENS_PER_WORD = 1.3;

  function estimateTokens(words) {
    return Math.round(words * TOKENS_PER_WORD);
  }

  // Walk the content root in document order, emitting one entry per heading or
  // paragraph so chunks can be assembled along the page's real reading order.
  function collectBlocks(ctx) {
    const U = NS.util;
    const blocks = [];
    const seen = new Set();

    const nodes = ctx.root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote');
    nodes.forEach(function (el) {
      if (seen.has(el)) return;
      // Skip a list item whose parent list sits inside an already-taken block.
      const text = U.textOf(el);
      if (!text) return;
      seen.add(el);
      const isHeading = /^H[1-6]$/.test(el.nodeName);
      blocks.push({
        el: el,
        text: text,
        words: U.wordCount(text),
        isHeading: isHeading,
        level: isHeading ? parseInt(el.nodeName.charAt(1), 10) : 0,
      });
    });
    return blocks;
  }

  function build(ctx) {
    const budget = (ctx.settings && ctx.settings.chunkTokens) || 500;
    const wordBudget = Math.max(60, Math.round(budget / TOKENS_PER_WORD));
    const blocks = collectBlocks(ctx);
    const chunks = [];

    let cur = null;
    function flush() {
      if (cur && cur.parts.length) {
        cur.text = cur.parts.join(' ');
        delete cur.parts;
        chunks.push(cur);
      }
      cur = null;
    }
    function start(heading) {
      cur = { heading: heading || '', parts: [], words: 0, node: null };
    }

    blocks.forEach(function (b) {
      // A heading of level 2 or 3 always begins a new retrieval unit.
      if (b.isHeading && b.level <= 3) {
        flush();
        start(b.text);
        if (!cur.node) cur.node = b.el;
        return;
      }
      if (!cur) start('');
      // Deeper headings ride along as part of the passage text.
      if (b.isHeading) { cur.parts.push(b.text); cur.words += b.words; if (!cur.node) cur.node = b.el; return; }

      if (cur.words + b.words > wordBudget && cur.parts.length) {
        const carriedHeading = cur.heading;
        flush();
        start(carriedHeading);
        cur.continued = true;
      }
      cur.parts.push(b.text);
      cur.words += b.words;
      if (!cur.node) cur.node = b.el;
    });
    flush();

    const entity = (ctx.primaryEntity || '').toLowerCase();
    chunks.forEach(function (c, i) {
      c.index = i + 1;
      c.tokens = estimateTokens(c.words);
      c.reasons = [];

      const hay = ((c.heading || '') + ' ' + c.text).toLowerCase();
      const firstSentence = NS.util.firstSentence(c.text);

      // An orphan cannot be understood on its own.
      const namesEntity = entity ? hay.indexOf(entity) !== -1 : true;
      const dangles = DANGLING_RE.test(firstSentence);

      if (!c.heading) c.reasons.push('no heading of its own');
      if (dangles) c.reasons.push('opens with a dangling reference');
      if (entity && !namesEntity) c.reasons.push('never names "' + ctx.primaryEntity + '"');

      // Flag only when the passage genuinely cannot stand alone: it must both
      // lack a self-describing heading AND fail to establish its subject.
      c.orphan = (!c.heading || dangles) && (!namesEntity || dangles);
    });

    return {
      chunks: chunks,
      orphanCount: chunks.filter(function (c) { return c.orphan; }).length,
      tokenBudget: budget,
    };
  }

  NS.chunks = { build: build, estimateTokens: estimateTokens };
})();
