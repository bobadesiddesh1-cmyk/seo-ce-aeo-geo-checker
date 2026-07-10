/*
 * extractability.js — EXTRACTABILITY (red). How easily an AI engine can lift a
 * direct answer out of the content. analyze(ctx) -> Issue[].
 */
(function () {
  'use strict';
  const NS = (window.__GEOLens = window.__GEOLens || {});
  NS.rules = NS.rules || {};
  if (NS.rules.extractability) return;

  const CATEGORY = 'extractability';
  const DEF_RE = / is an? | refers to | means /;

  function analyze(ctx) {
    const U = NS.util;
    const issues = [];

    // 1) Paragraphs longer than 120 words.
    ctx.paragraphs.forEach(function (p) {
      if (p.words > 120) {
        issues.push({
          category: CATEGORY,
          severity: 'Medium',
          message: 'Wall of text: this paragraph runs ' + p.words + ' words. AI engines struggle to extract a clean answer from long blocks.',
          fix: 'Break it into 2–4 short paragraphs, and lead with a one-sentence answer before the detail.',
          node: p.el,
          snippet: U.snippet(p.text),
        });
      }
    });

    // 2) Question heading (H2/H3) whose following paragraph is not a direct answer.
    ctx.headings.forEach(function (h) {
      if ((h.level !== 2 && h.level !== 3) || !U.isQuestionHeading(h.text)) return;
      const p = U.firstParagraphAfter(h.el, ctx.root);
      if (!p) return;
      const first = U.firstSentence(U.textOf(p));
      const tooLong = U.wordCount(first) > 35;
      const filler = U.startsWithFiller(first);
      if (tooLong || filler) {
        issues.push({
          category: CATEGORY,
          severity: 'High',
          message: 'The question heading "' + U.snippet(h.text, 80) + '" is not answered directly — its paragraph ' + (filler ? 'opens with filler' : 'opens with a ' + U.wordCount(first) + '-word sentence') + '.',
          fix: 'Start the paragraph with a concise, self-contained answer (ideally under 30 words) before adding context.',
          node: p,
          snippet: U.snippet(first),
        });
      }
    });

    // 3) Definitions buried mid-paragraph (not the first sentence).
    let defCount = 0;
    ctx.paragraphs.forEach(function (p) {
      if (defCount >= 8) return;
      const sentences = U.splitSentences(p.text);
      for (let i = 1; i < sentences.length; i++) {
        if (DEF_RE.test(' ' + sentences[i] + ' ')) {
          issues.push({
            category: CATEGORY,
            severity: 'Low',
            message: 'A definition is buried mid-paragraph. AI engines favour definitions that lead their block.',
            fix: 'Move this definition to the start of its own paragraph or a "X is …" sentence right under the relevant heading.',
            node: p.el,
            snippet: U.snippet(sentences[i]),
          });
          defCount++;
          break;
        }
      }
    });

    // 4) No summary/answer within the first 100 words after the H1.
    const opening = ctx.openingParagraph;
    if (opening) {
      const first = U.firstSentence(U.textOf(opening));
      if (U.wordCount(first) > 35 || U.startsWithFiller(first)) {
        issues.push({
          category: CATEGORY,
          severity: 'High',
          message: 'The opening does not give a direct summary/answer in the first 100 words after the title.',
          fix: 'Add a 1–2 sentence TL;DR right after the H1 that answers the page’s core question.',
          node: opening,
          snippet: U.snippet(first),
        });
      }
    }

    return issues;
  }

  NS.rules.extractability = analyze;
})();
