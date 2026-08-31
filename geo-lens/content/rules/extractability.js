/*
 * extractability.js — EXTRACTABILITY (red). How easily an AI engine can lift a
 * direct answer out of the prose. This is GEO Lens's core category: every rule
 * here is passage-level and carries the data its fixer needs to generate the
 * corrected text. analyze(ctx) -> Issue[].
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
    const S = ctx.settings;
    const issues = [];

    // 1) Walls of text.
    ctx.paragraphs.forEach(function (p) {
      if (p.words > S.longParagraphWords) {
        issues.push({
          ruleId: 'extractability.longParagraph',
          category: CATEGORY,
          severity: 'Medium',
          message: 'Wall of text: this paragraph runs ' + p.words + ' words. AI engines struggle to extract a clean answer from long blocks.',
          fix: 'Break it into 2–4 short paragraphs, and lead with a one-sentence answer before the detail.',
          node: p.el,
          snippet: U.snippet(p.text),
          rewriteData: { kind: 'splitParagraph', paragraph: p.text },
        });
      }
    });

    // 2) Question heading whose following paragraph is not a direct answer.
    ctx.headings.forEach(function (h) {
      if ((h.level !== 2 && h.level !== 3) || !U.isQuestionHeading(h.text)) return;
      const p = U.firstParagraphAfter(h.el, ctx.root);
      if (!p) return;
      const pText = U.textOf(p);
      const first = U.firstSentence(pText);
      const tooLong = U.wordCount(first) > S.answerSentenceWords;
      const filler = U.startsWithFiller(first);
      if (tooLong || filler) {
        issues.push({
          ruleId: 'extractability.unansweredQuestion',
          category: CATEGORY,
          severity: 'High',
          message: 'The question heading "' + U.snippet(h.text, 80) + '" is not answered directly — its paragraph ' + (filler ? 'opens with filler' : 'opens with a ' + U.wordCount(first) + '-word sentence') + '.',
          fix: 'Start the paragraph with a concise, self-contained answer (ideally under 30 words) before adding context.',
          node: p,
          snippet: U.snippet(first),
          rewriteData: { kind: 'directAnswer', heading: h.text, paragraph: pText },
        });
      }
    });

    // 3) Definitions buried mid-paragraph.
    let defCount = 0;
    ctx.paragraphs.forEach(function (p) {
      if (defCount >= 8) return;
      const sentences = U.splitSentences(p.text);
      for (let i = 1; i < sentences.length; i++) {
        if (DEF_RE.test(' ' + sentences[i] + ' ')) {
          issues.push({
            ruleId: 'extractability.buriedDefinition',
            category: CATEGORY,
            severity: 'Low',
            message: 'A definition is buried mid-paragraph. AI engines favour definitions that lead their block.',
            fix: 'Move this definition to the start of its own paragraph or a "X is …" sentence right under the relevant heading.',
            node: p.el,
            snippet: U.snippet(sentences[i]),
            rewriteData: { kind: 'hoistDefinition', paragraph: p.text, index: i },
          });
          defCount++;
          break;
        }
      }
    });

    // 4) No summary/answer in the opening.
    const opening = ctx.openingParagraph;
    if (opening) {
      const openText = U.textOf(opening);
      const first = U.firstSentence(openText);
      if (U.wordCount(first) > S.answerSentenceWords || U.startsWithFiller(first)) {
        issues.push({
          ruleId: 'extractability.noOpeningSummary',
          category: CATEGORY,
          severity: 'High',
          message: 'The opening does not give a direct summary/answer in the first 100 words after the title.',
          fix: 'Add a 1–2 sentence TL;DR right after the H1 that answers the page’s core question.',
          node: opening,
          snippet: U.snippet(first),
          rewriteData: {
            kind: 'tldr',
            title: (ctx.h1El && U.textOf(ctx.h1El)) || ctx.title,
            sections: ctx.headings.filter(function (h) { return h.level === 2; }).slice(0, 4).map(function (h) { return h.text; }),
            paragraph: openText,
          },
        });
      }
    }

    return issues;
  }

  NS.rules.extractability = analyze;
})();
