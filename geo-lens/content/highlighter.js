/*
 * highlighter.js — non-destructive inline highlighting with a reversible
 * registry. Wraps text nodes in <span data-geo-hl> markers and records an
 * exact "undo" thunk for every mutation, so clear() restores the page DOM
 * byte-for-byte. Loaded first; owns the shared window.__GEOLens namespace and
 * the category palette used across the extension.
 *
 * Idempotent: re-injecting this file on a second scan is a no-op.
 */
(function () {
  'use strict';

  const NS = (window.__GEOLens = window.__GEOLens || {});
  if (NS.highlighter) return; // already injected

  // ---- shared category palette / weights (single source of truth) ---------
  // Schema/on-page/technical checks deliberately live in SEO Sidekick, not here.
  // GEO Lens owns the passage-level, editorial layer only. `weight` is the
  // default (article) weighting; a content-type profile may override it.
  const CATEGORY_META = {
    extractability: { label: 'Extractability', color: '#EF4444', bgAlpha: 0.18, weight: 0.30 },
    structure:      { label: 'Structure',      color: '#F97316', bgAlpha: 0.18, weight: 0.20 },
    entity:         { label: 'Entity & E-E-A-T', color: '#EAB308', bgAlpha: 0.22, weight: 0.20 },
    citability:     { label: 'Citability',     color: '#A855F7', bgAlpha: 0.18, weight: 0.30 },
  };
  NS.CATEGORY_META = CATEGORY_META;
  NS.CATEGORY_ORDER = ['extractability', 'structure', 'entity', 'citability'];

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function onCssFor(category) {
    const m = CATEGORY_META[category];
    const bg = hexToRgba(m.color, m.bgAlpha);
    return (
      `background-color:${bg};` +
      `border-bottom:2px solid ${m.color};` +
      `border-radius:2px;` +
      `padding:0 1px;` +
      `box-decoration-break:clone;-webkit-box-decoration-break:clone;`
    );
  }

  // ---- registry -----------------------------------------------------------
  // spans: [{ span, category, issueId, onCss }]
  // undos: reverse-ordered thunks that exactly reverse each DOM mutation.
  let spans = [];
  let undos = [];

  function makeSpan(category, issueId) {
    const span = document.createElement('span');
    span.setAttribute('data-geo-hl', '');
    span.setAttribute('data-geo-cat', category);
    span.setAttribute('data-geo-id', String(issueId));
    const onCss = onCssFor(category);
    span.style.cssText = onCss;
    spans.push({ span, category, issueId: String(issueId), onCss });
    return span;
  }

  // Mode A: wrap a single text node whole (no splitting) -> bulletproof undo.
  function wrapWholeTextNode(textNode, category, issueId) {
    const parent = textNode.parentNode;
    if (!parent) return null;
    const span = makeSpan(category, issueId);
    parent.replaceChild(span, textNode);
    span.appendChild(textNode);
    undos.push(function () {
      if (span.parentNode) span.parentNode.replaceChild(textNode, span);
    });
    return span;
  }

  // Mode B: highlight [start,end) chars of a single text node by replacing it
  // with (left?, span(mid), right?) fresh nodes; keep the ORIGINAL node object
  // aside so undo reinserts it verbatim and removes the fresh nodes.
  function wrapTextRange(textNode, start, end, category, issueId) {
    const parent = textNode.parentNode;
    if (!parent) return null;
    const data = textNode.data;
    const left = data.slice(0, start);
    const mid = data.slice(start, end);
    const right = data.slice(end);
    if (!mid) return null;

    const inserted = [];
    const span = makeSpan(category, issueId);
    span.appendChild(document.createTextNode(mid));

    const ref = textNode.nextSibling;
    parent.removeChild(textNode);
    if (left) { const n = document.createTextNode(left); parent.insertBefore(n, ref); inserted.push(n); }
    parent.insertBefore(span, ref); inserted.push(span);
    if (right) { const n = document.createTextNode(right); parent.insertBefore(n, ref); inserted.push(n); }

    undos.push(function () {
      const first = inserted[0];
      const p = first && first.parentNode;
      if (!p) return;
      p.insertBefore(textNode, first);
      inserted.forEach(function (n) { if (n.parentNode === p) p.removeChild(n); });
    });
    return span;
  }

  // ---- public helpers -----------------------------------------------------
  const MAX_TEXTNODES_PER_ELEMENT = 400;

  function textNodesUnder(el) {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.data || !n.data.trim()) return NodeFilter.FILTER_REJECT;
        const p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        if (p.getAttribute && p.getAttribute('data-geo-hl') !== null) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      out.push(node);
      if (out.length >= MAX_TEXTNODES_PER_ELEMENT) break;
    }
    return out;
  }

  // Highlight the whole text content of an element (paragraph/heading/block).
  function highlightElementText(el, category, issueId) {
    if (!el) return false;
    const nodes = textNodesUnder(el);
    if (!nodes.length) return false;
    let any = false;
    nodes.forEach(function (t) { if (wrapWholeTextNode(t, category, issueId)) any = true; });
    return any;
  }

  // Highlight the first occurrence of `snippet` inside `el`. Falls back to
  // whole-element highlight when the snippet is not contained in one text node.
  function highlightSnippetInElement(el, snippet, category, issueId) {
    if (!el) return false;
    const needle = (snippet || '').trim();
    if (needle.length >= 3) {
      const probe = needle.slice(0, 80);
      const nodes = textNodesUnder(el);
      for (let i = 0; i < nodes.length; i++) {
        const t = nodes[i];
        const idx = t.data.indexOf(probe);
        if (idx !== -1) {
          const end = Math.min(t.data.length, idx + needle.length);
          if (wrapTextRange(t, idx, end, category, issueId)) return true;
        }
      }
    }
    return highlightElementText(el, category, issueId);
  }

  function count() { return spans.length; }

  function setCategoryVisible(category, visible) {
    spans.forEach(function (rec) {
      if (rec.category !== category) return;
      rec.span.style.cssText = visible ? rec.onCss : 'background-color:transparent;border-bottom:none;padding:0;';
    });
  }

  function getElementForIssue(issueId) {
    const id = String(issueId);
    for (let i = 0; i < spans.length; i++) if (spans[i].issueId === id) return spans[i].span;
    return null;
  }

  function pulse(el) {
    if (!el || typeof el.animate !== 'function') return;
    const m = CATEGORY_META[el.getAttribute && el.getAttribute('data-geo-cat')] || CATEGORY_META.extractability;
    const ring = hexToRgba(m.color, 0.55);
    try {
      el.animate(
        [
          { boxShadow: `0 0 0 0px ${ring}`, offset: 0 },
          { boxShadow: `0 0 0 6px ${ring}`, offset: 0.4 },
          { boxShadow: `0 0 0 0px ${ring}`, offset: 1 },
        ],
        { duration: 1100, easing: 'ease-out' }
      );
    } catch (e) { /* animation unsupported: silent */ }
  }

  function clearAll() {
    // Reverse every mutation in strict reverse order for exact restoration.
    for (let i = undos.length - 1; i >= 0; i--) {
      try { undos[i](); } catch (e) { /* keep unwinding */ }
    }
    undos = [];
    spans = [];
  }

  NS.highlighter = {
    CATEGORY_META,
    highlightElementText,
    highlightSnippetInElement,
    setCategoryVisible,
    getElementForIssue,
    pulse,
    clearAll,
    count,
  };
})();
