/*
 * fixers.js — turns a diagnosed issue into the CORRECTED TEXT.
 *
 * This is the layer that separates GEO Lens from a linter. Every transform here
 * is deterministic and mechanical — reordering sentences the page already has,
 * splitting a block at real sentence boundaries, stripping a hedge prefix,
 * converting a comma run into list markup. Nothing calls a network or a model.
 *
 * Where a genuine rewrite is impossible without knowing facts the page does not
 * state (a source URL, a real figure), the fixer emits a SKELETON with square-
 * bracket placeholders and says so in its label, rather than inventing content.
 *
 * generate(issue, ctx) -> { label, format, text } | null
 * Attaches window.__GEOLens.fixers.
 */
(function () {
  'use strict';
  const NS = (window.__GEOLens = window.__GEOLens || {});
  if (NS.fixers) return;

  const QUESTION_LEAD_RE = /^(what|how|why|when|which|who|where|can|is|are|does|do|should|will|could|would)\b\s*/i;
  const AUX_RE = /^(is|are|do|does|can|should|will|would|could)\b\s*/i;
  const ARTICLE_RE = /^(the|a|an)\s+/i;

  function cap(s) {
    const t = (s || '').trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  }

  function stripTrailingPunct(s) {
    return (s || '').replace(/[\s.,;:!?]+$/, '');
  }

  function slugify(s) {
    return (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'section';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // "How does X work?" -> "X". Best-effort subject extraction from a heading.
  function subjectOf(heading) {
    let t = stripTrailingPunct(heading || '').replace(/\?+$/, '').trim();
    t = t.replace(QUESTION_LEAD_RE, '');
    t = t.replace(AUX_RE, '');
    t = t.replace(ARTICLE_RE, '');
    t = t.replace(/\s+(work|works|mean|means|matter|matters|happen|happens)$/i, '');
    return t.trim() || stripTrailingPunct(heading || '');
  }

  // ---- 1. Split a wall of text into balanced paragraphs -------------------
  function splitParagraph(data) {
    const U = NS.util;
    const sentences = U.splitSentences(data.paragraph);
    if (sentences.length < 2) return null;

    const total = U.wordCount(data.paragraph);
    const target = total > 260 ? 4 : total > 180 ? 3 : 2;
    const per = Math.ceil(total / target);

    const blocks = [];
    let cur = [];
    let curWords = 0;
    sentences.forEach(function (s, i) {
      cur.push(s);
      curWords += U.wordCount(s);
      const isLast = i === sentences.length - 1;
      if (!isLast && curWords >= per && blocks.length < target - 1) {
        blocks.push(cur.join(' '));
        cur = [];
        curWords = 0;
      }
    });
    if (cur.length) blocks.push(cur.join(' '));
    if (blocks.length < 2) return null;

    return {
      label: 'Split into ' + blocks.length + ' paragraphs',
      format: 'text',
      text: blocks.join('\n\n'),
    };
  }

  // ---- 2. Hoist a direct answer to the front of the paragraph -------------
  function directAnswer(data, ctx) {
    const U = NS.util;
    const S = ctx.settings;
    const sentences = U.splitSentences(data.paragraph);
    if (!sentences.length) return null;

    const limit = Math.min(S.answerSentenceWords, 30);
    let bestIdx = -1;
    let bestScore = -Infinity;
    sentences.forEach(function (s, i) {
      const wc = U.wordCount(s);
      if (wc < 5 || wc > limit) return;
      if (U.startsWithFiller(s)) return;
      if (NS.HEDGE_RE && NS.HEDGE_RE.test(s)) return;
      let score = limit - Math.abs(wc - 18);
      if (/\d/.test(s)) score += 8;
      if (/ is an? | are | means | refers to /.test(' ' + s + ' ')) score += 6;
      if (/^(it|this|that|they|these|those|he|she)\b/i.test(s)) score -= 10;
      if (i === 0) score -= 2; // prefer promoting a later sentence
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    });

    if (bestIdx > 0) {
      const reordered = [sentences[bestIdx]].concat(
        sentences.filter(function (_, i) { return i !== bestIdx; })
      );
      return {
        label: 'Answer-first rewrite (promotes sentence ' + (bestIdx + 1) + ')',
        format: 'text',
        text: reordered.join(' '),
      };
    }

    // No sentence in the paragraph can serve as the answer — emit a skeleton.
    const subject = subjectOf(data.heading);
    return {
      label: 'Answer skeleton — no sentence in this paragraph is short enough to promote',
      format: 'text',
      text: cap(subject) + ' is [one-sentence answer, under 30 words].\n\n' + data.paragraph,
    };
  }

  // ---- 3. Hoist a buried definition --------------------------------------
  function hoistDefinition(data) {
    const U = NS.util;
    const sentences = U.splitSentences(data.paragraph);
    const i = data.index;
    if (!sentences.length || i == null || i < 0 || i >= sentences.length) return null;
    const reordered = [sentences[i]].concat(
      sentences.filter(function (_, k) { return k !== i; })
    );
    return {
      label: 'Definition-first rewrite',
      format: 'text',
      text: reordered.join(' '),
    };
  }

  // ---- 4. TL;DR skeleton --------------------------------------------------
  function tldr(data) {
    const title = stripTrailingPunct(data.title || '');
    const lines = ['**TL;DR:** ' + title + ' — [one-sentence answer to the page’s core question].'];
    if (data.sections && data.sections.length) {
      lines.push('');
      data.sections.forEach(function (s) {
        lines.push('- **' + stripTrailingPunct(s) + ':** [one line]');
      });
    }
    return {
      label: 'TL;DR skeleton — fill the bracketed lines and place it directly under the H1',
      format: 'markdown',
      text: lines.join('\n'),
    };
  }

  // ---- 5. Comma enumeration -> list markup --------------------------------
  function enumerationToList(data) {
    const sentence = (data.sentence || '').trim();
    if (!sentence) return null;

    let lead = '';
    let body = sentence;
    const colon = sentence.indexOf(':');
    if (colon > 0 && colon < sentence.length - 1) {
      lead = sentence.slice(0, colon).trim();
      body = sentence.slice(colon + 1).trim();
    }

    const items = body
      .split(/,\s*/)
      .map(function (part) {
        return stripTrailingPunct(part.replace(/^(and|or)\s+/i, '').trim());
      })
      .filter(Boolean);

    if (items.length < 3) return null;

    const html =
      (lead ? '<p>' + escapeHtml(lead) + ':</p>\n' : '') +
      '<ul>\n' +
      items.map(function (it) { return '  <li>' + escapeHtml(cap(it)) + '</li>'; }).join('\n') +
      '\n</ul>';

    return {
      label: lead
        ? 'List markup (' + items.length + ' items)'
        : 'List markup (' + items.length + ' items) — check the first item, it still carries the lead-in',
      format: 'html',
      text: html,
    };
  }

  // ---- 6. Comparison table skeleton ---------------------------------------
  function comparisonTable(data) {
    const src = data.source || '';
    let a = '';
    let b = '';
    let m =
      src.match(/difference between\s+(.+?)\s+and\s+(.+)$/i) ||
      src.match(/(.+?)\s+(?:vs\.?|versus)\s+(.+)$/i) ||
      src.match(/(.+?)\s+compared to\s+(.+)$/i);
    if (m) {
      a = stripTrailingPunct(m[1]).replace(/^.*?[:—-]\s*/, '').trim();
      b = stripTrailingPunct(m[2]).trim();
    }
    if (!a || !b) { a = '[Option A]'; b = '[Option B]'; }
    // Keep option labels short — a captured clause can run long.
    if (a.split(/\s+/).length > 6) a = '[Option A]';
    if (b.split(/\s+/).length > 6) b = '[Option B]';

    const html =
      '<table>\n' +
      '  <thead>\n' +
      '    <tr><th>Criterion</th><th>' + escapeHtml(cap(a)) + '</th><th>' + escapeHtml(cap(b)) + '</th></tr>\n' +
      '  </thead>\n' +
      '  <tbody>\n' +
      '    <tr><td>[Criterion 1]</td><td>[value]</td><td>[value]</td></tr>\n' +
      '    <tr><td>[Criterion 2]</td><td>[value]</td><td>[value]</td></tr>\n' +
      '    <tr><td>[Criterion 3]</td><td>[value]</td><td>[value]</td></tr>\n' +
      '  </tbody>\n' +
      '</table>';

    return {
      label: 'Comparison table skeleton (' + cap(a) + ' vs ' + cap(b) + ')',
      format: 'html',
      text: html,
    };
  }

  // ---- 7. Table of contents from the page's own headings ------------------
  function toc(data) {
    const heads = (data.headings || []).filter(function (h) { return h.text; });
    if (heads.length < 3) return null;

    const lines = ['<nav class="toc" aria-label="On this page">', '  <ul>'];
    let openSub = false;
    heads.forEach(function (h) {
      const link = '<a href="#' + slugify(h.text) + '">' + escapeHtml(stripTrailingPunct(h.text)) + '</a>';
      if (h.level === 3) {
        if (!openSub) { lines.push('      <ul>'); openSub = true; }
        lines.push('        <li>' + link + '</li>');
      } else {
        if (openSub) { lines.push('      </ul>'); lines.push('    </li>'); openSub = false; }
        else if (lines.length > 2) lines.push('    </li>');
        lines.push('    <li>' + link);
      }
    });
    if (openSub) { lines.push('      </ul>'); }
    lines.push('    </li>');
    lines.push('  </ul>');
    lines.push('</nav>');

    return {
      label: 'Table of contents (' + heads.length + ' sections) — add matching id attributes to each heading',
      format: 'html',
      text: lines.join('\n'),
    };
  }

  // ---- 8. Statement headings -> question headings -------------------------
  function questionHeadings(data) {
    const heads = (data.headings || []).filter(Boolean);
    if (!heads.length) return null;
    const U = NS.util;

    const rewrites = [];
    heads.forEach(function (h) {
      if (U.isQuestionHeading(h)) return;
      const q = toQuestion(h);
      if (q) rewrites.push(stripTrailingPunct(h) + '  →  ' + q);
    });
    if (!rewrites.length) return null;

    return {
      label: 'Question-heading rewrites (' + rewrites.length + ')',
      format: 'text',
      text: rewrites.join('\n'),
    };
  }

  function toQuestion(heading) {
    const t = stripTrailingPunct(heading || '').trim();
    if (!t) return '';
    let m;
    if ((m = t.match(/^how to\s+(.+)$/i))) return 'How do you ' + m[1].toLowerCase() + '?';
    if ((m = t.match(/^(benefits|advantages|features|types|examples|reasons|steps|risks|drawbacks|use cases|alternatives)\s+of\s+(.+)$/i))) {
      return 'What are the ' + m[1].toLowerCase() + ' of ' + m[2] + '?';
    }
    if ((m = t.match(/^(.+?)\s+(benefits|advantages|features|examples|alternatives)$/i))) {
      return 'What are the ' + m[2].toLowerCase() + ' of ' + m[1] + '?';
    }
    if ((m = t.match(/^(.+?)\s+explained$/i))) return 'What is ' + m[1] + '?';
    if (/^(pros and cons)\b/i.test(t)) return 'What are the ' + t.toLowerCase() + '?';
    return (/s$/i.test(t) && !/ss$/i.test(t) ? 'What are ' : 'What is ') + t + '?';
  }

  // ---- 9. Attach a source to an unsourced claim ---------------------------
  function citeClaim(data) {
    const s = stripTrailingPunct(data.sentence || '');
    if (!s) return null;
    return {
      label: 'Sourced version — replace the bracketed source',
      format: 'html',
      text: escapeHtml(s) + ' (<a href="[SOURCE URL]">[Source name, year]</a>).',
    };
  }

  // ---- 10. Replace a vague quantifier with a figure -----------------------
  function replaceVague(data) {
    const s = data.sentence || '';
    const term = data.term || '';
    if (!s || !term) return null;
    const re = new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '\\b', 'i');
    const out = s.replace(re, '[specific figure]');
    if (out === s) return null;
    return {
      label: 'Replace "' + term + '" with a real number',
      format: 'text',
      text: out,
    };
  }

  // ---- 11. Strip a hedge prefix ------------------------------------------
  function unhedge(data) {
    const s = (data.sentence || '').trim();
    if (!s || !NS.HEDGE_RE) return null;
    const stripped = s.replace(NS.HEDGE_RE, '').trim();
    if (!stripped || stripped === s) return null;
    return {
      label: 'Direct version (hedge removed)',
      format: 'text',
      text: cap(stripped),
    };
  }

  // ---- 12. Name the primary entity in the opening -------------------------
  function nameEntity(data) {
    const entity = data.entity || '';
    const para = data.paragraph || '';
    if (!entity || !para) return null;
    return {
      label: 'Opening that names "' + entity + '" — fill the bracketed clause',
      format: 'text',
      text: cap(entity) + ' is [one-line definition of ' + entity + '].\n\n' + para,
    };
  }

  // ---- 13 & 14. Experience / stat-sentence skeletons ----------------------
  function firstPerson(data) {
    const e = data.entity || '[the product]';
    return {
      label: 'First-hand experience block — replace every bracketed span',
      format: 'markdown',
      text:
        'We tested ' + e + ' over [duration] on [what you ran it against].\n' +
        'Across [N] runs we measured [metric]: [result].\n' +
        'The clearest limitation we hit was [limitation].',
    };
  }

  function statSentence(data) {
    const e = data.entity || '[the subject]';
    return {
      label: 'Citable stat-sentence patterns — replace every bracketed span',
      format: 'markdown',
      text:
        e + ' costs [figure] per [unit] as of [month year].\n' +
        e + ' is [one-clause definition].\n' +
        '[N]% of [population] [did what], according to [source].',
    };
  }

  // ---- dispatcher ---------------------------------------------------------
  const HANDLERS = {
    splitParagraph: splitParagraph,
    directAnswer: directAnswer,
    hoistDefinition: hoistDefinition,
    tldr: tldr,
    enumerationToList: enumerationToList,
    comparisonTable: comparisonTable,
    toc: toc,
    questionHeadings: questionHeadings,
    citeClaim: citeClaim,
    replaceVague: replaceVague,
    unhedge: unhedge,
    nameEntity: nameEntity,
    firstPerson: firstPerson,
    statSentence: statSentence,
  };

  function generate(issue, ctx) {
    const data = issue && issue.rewriteData;
    if (!data || !data.kind) return null;
    const fn = HANDLERS[data.kind];
    if (!fn) return null;
    try {
      return fn(data, ctx) || null;
    } catch (e) {
      // A failing fixer must never break the scan — the issue still lists.
      console.warn('GEO Lens: fixer "' + data.kind + '" failed', e);
      return null;
    }
  }

  NS.fixers = { generate: generate, toQuestion: toQuestion, subjectOf: subjectOf, slugify: slugify };
})();
