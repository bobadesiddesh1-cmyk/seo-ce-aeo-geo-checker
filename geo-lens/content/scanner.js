/*
 * scanner.js — orchestrates a scan: extract the main content, build the shared
 * context, run all five rules, score, apply capped highlights, and render the
 * panel. Loaded last. Exposes window.__GEOLens.run() / .clear().
 *
 * run() returns a JSON-serializable summary (no DOM nodes) so the background
 * service worker can store it; the full result (with node refs) lives on
 * window.__GEOLens.lastResult for the panel and the report exporter.
 */
(function () {
  'use strict';
  const NS = (window.__GEOLens = window.__GEOLens || {});
  if (NS.run) return; // idempotent

  const WORD_BUDGET = 50000;
  const MAX_PARAGRAPHS = 1200;
  const SEVERITY_RANK = { High: 0, Medium: 1, Low: 2 };
  const DEDUCTION = { High: 15, Medium: 8, Low: 3 };
  const MAX_HIGHLIGHTS = 60;

  function textLen(el) {
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim().length : 0;
  }

  // ---- content extraction -------------------------------------------------
  const EXCLUDE_TAGS = { NAV: 1, HEADER: 1, FOOTER: 1, ASIDE: 1 };
  const EXCLUDE_RE = /(^|[\s_-])(nav|navbar|header|footer|aside|sidebar|side-bar|menu|comment|advert|ads?|promo|social|share|related|breadcrumb|cookie|newsletter|subscribe|widget|masthead|banner)([\s_-]|$)/i;

  function isExcluded(el) {
    let n = el;
    while (n && n !== document.body && n.nodeType === 1) {
      if (EXCLUDE_TAGS[n.nodeName]) return true;
      const role = n.getAttribute && n.getAttribute('role');
      if (role && /(navigation|banner|complementary|contentinfo|search)/i.test(role)) return true;
      const idc = (n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : '');
      if (EXCLUDE_RE.test(idc)) return true;
      n = n.parentElement;
    }
    return false;
  }

  function largestTextBlock() {
    const els = document.querySelectorAll('div, section, article, main');
    let best = null;
    let bestLen = 0;
    els.forEach(function (el) {
      if (isExcluded(el)) return;
      const ps = el.querySelectorAll('p');
      let len = 0;
      for (let i = 0; i < ps.length; i++) len += textLen(ps[i]);
      if (len > bestLen) { bestLen = len; best = el; }
    });
    if (!best || bestLen < 200) return null;
    // Tighten: descend while a single child still holds ~all of the text.
    let node = best;
    for (let guard = 0; guard < 20; guard++) {
      let chosen = null;
      const kids = node.children;
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (isExcluded(c)) continue;
        const ps = c.querySelectorAll('p');
        let l = 0;
        for (let j = 0; j < ps.length; j++) l += textLen(ps[j]);
        if (l >= bestLen * 0.9) chosen = c;
      }
      if (chosen && chosen !== node) node = chosen; else break;
    }
    return node;
  }

  function extractContent() {
    const articles = document.querySelectorAll('article');
    for (let i = 0; i < articles.length; i++) {
      if (textLen(articles[i]) >= 200) return articles[i];
    }
    const main = document.querySelector('main');
    if (main && textLen(main) >= 200) return main;
    const roleMain = document.querySelector('[role="main"]');
    if (roleMain && textLen(roleMain) >= 200) return roleMain;
    return largestTextBlock();
  }

  // ---- JSON-LD ------------------------------------------------------------
  function parseJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const nodes = [];
    const errors = [];
    const typeSet = new Set();
    let hasAuthor = false;
    let hasDate = false;

    function collect(d) {
      if (!d || typeof d !== 'object') return;
      if (Array.isArray(d)) { d.forEach(collect); return; }
      if (d['@type']) {
        nodes.push(d);
        const t = d['@type'];
        (Array.isArray(t) ? t : [t]).forEach(function (x) { typeSet.add(String(x).toLowerCase()); });
      }
      if (d.author) hasAuthor = true;
      if (d.datePublished || d.dateModified) hasDate = true;
      Object.keys(d).forEach(function (k) {
        if (k === '@type') return;
        if (d[k] && typeof d[k] === 'object') collect(d[k]);
      });
    }

    scripts.forEach(function (s) {
      const raw = (s.textContent || '').trim();
      if (!raw) return;
      let data;
      try { data = JSON.parse(raw); }
      catch (e) { errors.push({ text: raw.slice(0, 200), error: e.message }); return; }
      collect(data);
    });

    return { scriptCount: scripts.length, nodes: nodes, errors: errors, typeSet: typeSet, hasAuthor: hasAuthor, hasDate: hasDate };
  }

  // ---- context ------------------------------------------------------------
  function buildContext(root) {
    const U = NS.util;
    const headingEls = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const headings = [];
    headingEls.forEach(function (el) {
      const text = U.textOf(el);
      if (text) headings.push({ el: el, level: parseInt(el.nodeName.charAt(1), 10), text: text });
    });

    const paragraphs = [];
    let budget = 0;
    let truncated = false;
    const pEls = root.querySelectorAll('p');
    for (let i = 0; i < pEls.length; i++) {
      const text = U.textOf(pEls[i]);
      if (!text) continue;
      const w = U.wordCount(text);
      paragraphs.push({ el: pEls[i], text: text, words: w });
      budget += w;
      if (budget > WORD_BUDGET || paragraphs.length >= MAX_PARAGRAPHS) { truncated = budget > WORD_BUDGET; break; }
    }

    const h1El = root.querySelector('h1') || document.querySelector('h1');
    let openingParagraph = null;
    if (h1El && root.contains(h1El)) openingParagraph = U.firstParagraphAfter(h1El, root);
    if (!openingParagraph && paragraphs.length) openingParagraph = paragraphs[0].el;

    let plainText = U.textOf(root);
    const totalWords = U.wordCount(plainText);
    if (totalWords > WORD_BUDGET) {
      truncated = true;
      plainText = U.words(plainText).slice(0, WORD_BUDGET).join(' ');
    }

    const isArticleLike = !!document.querySelector('article') || (!!h1El && paragraphs.length >= 3);

    return {
      root: root,
      doc: document,
      url: location.href,
      title: document.title || (h1El ? U.textOf(h1El) : ''),
      headings: headings,
      paragraphs: paragraphs,
      h1El: h1El,
      openingParagraph: openingParagraph,
      plainText: plainText,
      wordCount: Math.min(totalWords, WORD_BUDGET),
      truncated: truncated,
      isArticleLike: isArticleLike,
      jsonLd: parseJsonLd(),
    };
  }

  // ---- scoring ------------------------------------------------------------
  function computeScores(issues) {
    const categories = {};
    NS.CATEGORY_ORDER.forEach(function (c) { categories[c] = 100; });
    issues.forEach(function (i) {
      categories[i.category] -= (DEDUCTION[i.severity] || 0);
    });
    let overall = 0;
    NS.CATEGORY_ORDER.forEach(function (c) {
      categories[c] = Math.max(0, categories[c]);
      overall += categories[c] * NS.CATEGORY_META[c].weight;
    });
    overall = Math.round(overall);
    const grade = overall >= 85 ? 'A' : overall >= 70 ? 'B' : overall >= 55 ? 'C' : overall >= 40 ? 'D' : 'F';
    return { overall: overall, grade: grade, categories: categories };
  }

  // ---- highlight application (cap 60, highest severity first) --------------
  function applyHighlights(issues) {
    const order = issues
      .map(function (iss, idx) { return { iss: iss, idx: idx }; })
      .sort(function (a, b) {
        const r = (SEVERITY_RANK[a.iss.severity] || 3) - (SEVERITY_RANK[b.iss.severity] || 3);
        return r !== 0 ? r : a.idx - b.idx;
      });
    let used = 0;
    order.forEach(function (o) {
      const iss = o.iss;
      if (!iss.node) { iss.highlighted = false; return; }
      if (used >= MAX_HIGHLIGHTS) { iss.highlighted = false; return; }
      const ok = NS.highlighter.highlightSnippetInElement(iss.node, iss.snippet, iss.category, iss.id);
      iss.highlighted = !!ok;
      if (ok) used++;
    });
    return used;
  }

  // ---- serializable summary ----------------------------------------------
  function summarize(result) {
    return {
      url: result.url,
      title: result.title,
      timestamp: result.timestamp,
      score: result.scoring.overall,
      grade: result.scoring.grade,
      categories: result.scoring.categories,
      issueCount: result.issues.length,
      highlightedCount: result.issues.filter(function (i) { return i.highlighted; }).length,
      truncated: result.truncated,
      noContent: false,
    };
  }

  // ---- public API ---------------------------------------------------------
  function clear() {
    if (NS.highlighter) NS.highlighter.clearAll();
    if (NS.panel) NS.panel.remove();
    NS.lastResult = null;
  }

  function run() {
    clear();
    const root = extractContent();
    if (!root) {
      const summary = { url: location.href, title: document.title, timestamp: Date.now(), noContent: true };
      if (NS.panel) NS.panel.renderNoContent(summary);
      return summary;
    }
    const ctx = buildContext(root);

    const issues = [];
    NS.CATEGORY_ORDER.forEach(function (cat) {
      const fn = NS.rules[cat];
      if (typeof fn !== 'function') return;
      try {
        const found = fn(ctx) || [];
        found.forEach(function (i) { issues.push(i); });
      } catch (e) {
        // A failing rule must never abort the whole scan.
        console.warn('GEO Lens: rule "' + cat + '" failed', e);
      }
    });
    issues.forEach(function (iss, idx) { iss.id = iss.category + '-' + idx; });

    const scoring = computeScores(issues);
    applyHighlights(issues);

    const result = {
      url: ctx.url,
      title: ctx.title,
      timestamp: Date.now(),
      wordCount: ctx.wordCount,
      truncated: ctx.truncated,
      scoring: scoring,
      issues: issues,
    };
    NS.lastResult = result;
    if (NS.panel) NS.panel.render(result);
    return summarize(result);
  }

  NS.run = run;
  NS.clear = clear;
})();
