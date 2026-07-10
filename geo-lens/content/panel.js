/*
 * panel.js — Shadow DOM side panel. Renders scan results, wires click-to-scroll
 * (with pulse), per-category highlight toggles, clear, and export. All UI is
 * built with createElement + textContent (never innerHTML with page text) so
 * host-page content can't inject markup into the panel. Attaches
 * window.__GEOLens.panel.
 */
(function () {
  'use strict';
  const NS = (window.__GEOLens = window.__GEOLens || {});
  if (NS.panel) return;

  const HOST_ID = 'geo-lens-panel-host';
  const GRADE_COLOR = { A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444' };

  // Minimal fallback styles if panel.css can't be fetched (offline extension
  // resource is normally always available; this guards the rare failure).
  const FALLBACK_CSS =
    ':host{position:fixed;top:0;right:0;width:400px;max-width:96vw;height:100vh;z-index:2147483647;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#16181d}" +
    '.panel{height:100%;background:#fff;border-left:1px solid #e2e5ea;display:flex;flex-direction:column;overflow:hidden}' +
    '.body{flex:1;overflow-y:auto}.header,.toolbar,.footer{padding:12px 16px;border-bottom:1px solid #e2e5ea}' +
    '.btn{padding:8px;border:1px solid #e2e5ea;border-radius:8px;background:#f6f7f9;cursor:pointer;margin-right:6px}' +
    '.issue{border:1px solid #e2e5ea;border-radius:8px;padding:10px;margin:8px 16px;cursor:pointer}';

  let hostEl = null;
  let shadow = null;
  const toggleState = {}; // category -> visible

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function removePanelDom() {
    const existing = document.getElementById(HOST_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    hostEl = null;
    shadow = null;
  }

  function ensureHost() {
    removePanelDom();
    hostEl = document.createElement('div');
    hostEl.id = HOST_ID;
    // Critical inline positioning so the panel is placed before the sheet loads.
    hostEl.style.cssText = 'position:fixed;top:0;right:0;height:100vh;z-index:2147483647;';
    shadow = hostEl.attachShadow({ mode: 'open' });
    (document.documentElement || document.body).appendChild(hostEl);
    loadStyles(shadow);
    return shadow;
  }

  function loadStyles(root) {
    let applied = false;
    function apply(css) {
      if (applied) return;
      applied = true;
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        root.adoptedStyleSheets = [sheet];
      } catch (e) {
        const style = document.createElement('style');
        style.textContent = css;
        root.appendChild(style);
      }
    }
    try {
      const url = chrome.runtime.getURL('content/panel.css');
      fetch(url)
        .then(function (r) { return r.ok ? r.text() : Promise.reject(); })
        .then(apply)
        .catch(function () { apply(FALLBACK_CSS); });
    } catch (e) {
      apply(FALLBACK_CSS);
    }
  }

  function openSoon(panel) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { panel.classList.add('open'); });
    });
  }

  // ---- ring ---------------------------------------------------------------
  function buildRing(score, grade) {
    const ring = el('div', 'ring');
    const color = GRADE_COLOR[grade] || '#4F46E5';
    ring.style.background = 'conic-gradient(' + color + ' ' + (score * 3.6) + 'deg, var(--bg-elev2) 0deg)';
    ring.appendChild(el('div', 'hole'));
    const g = el('div', 'grade');
    g.appendChild(el('b', null, grade));
    g.appendChild(el('span', null, score + '/100'));
    ring.appendChild(g);
    return ring;
  }

  // ---- header + toolbar ---------------------------------------------------
  function buildHeader(result) {
    const header = el('div', 'header');
    header.appendChild(buildRing(result.scoring.overall, result.scoring.grade));

    const main = el('div', 'head-main');
    main.appendChild(el('div', 'brand', 'GEO LENS'));
    const line = el('div', 'score-line');
    line.appendChild(el('b', null, String(result.scoring.overall)));
    line.appendChild(el('em', null, '/100 · Grade ' + result.scoring.grade));
    main.appendChild(line);
    main.appendChild(el('div', 'doc-title', result.title || result.url));
    header.appendChild(main);

    const close = el('button', 'close-btn', '×');
    close.title = 'Close and restore page';
    close.addEventListener('click', remove);
    header.appendChild(close);
    return header;
  }

  function buildToolbar(result) {
    const bar = el('div', 'toolbar');

    const rescan = el('button', 'btn', 'Re-scan');
    rescan.addEventListener('click', function () { if (NS.run) NS.run(); });

    const clear = el('button', 'btn', 'Clear highlights');
    clear.addEventListener('click', function () {
      NS.highlighter.clearAll();
      NS.CATEGORY_ORDER.forEach(function (c) { toggleState[c] = false; });
      markAllTogglesOff();
    });

    const exportBtn = el('button', 'btn primary', 'Export report');
    exportBtn.addEventListener('click', exportReport);

    bar.appendChild(rescan);
    bar.appendChild(clear);
    bar.appendChild(exportBtn);
    return bar;
  }

  function markAllTogglesOff() {
    if (!shadow) return;
    shadow.querySelectorAll('.cat-row').forEach(function (row) {
      row.classList.add('off');
      const t = row.querySelector('.cat-toggle');
      if (t) t.textContent = 'off';
    });
  }

  // ---- category bars ------------------------------------------------------
  function buildCategories(result, counts) {
    const wrap = el('div', 'cats');
    wrap.appendChild(el('h3', null, 'Category scores — click to toggle highlights'));
    NS.CATEGORY_ORDER.forEach(function (cat) {
      const meta = NS.CATEGORY_META[cat];
      const score = result.scoring.categories[cat];
      const row = el('div', 'cat-row');
      row.dataset.cat = cat;

      const sw = el('span', 'cat-swatch');
      sw.style.background = meta.color;
      row.appendChild(sw);

      row.appendChild(el('span', 'cat-name', meta.label));
      row.appendChild(el('span', 'cat-count', (counts[cat] || 0) + ' · ' + score));

      const toggle = el('span', 'cat-toggle', 'on');
      row.appendChild(toggle);

      const bar = el('div', 'cat-bar');
      const fill = el('i');
      fill.style.width = score + '%';
      fill.style.background = meta.color;
      bar.appendChild(fill);
      row.appendChild(bar);

      row.addEventListener('click', function () {
        const vis = toggleState[cat] === false ? true : false;
        toggleState[cat] = vis;
        NS.highlighter.setCategoryVisible(cat, vis);
        row.classList.toggle('off', !vis);
        toggle.textContent = vis ? 'on' : 'off';
      });

      wrap.appendChild(row);
    });
    return wrap;
  }

  // ---- issue list ---------------------------------------------------------
  function buildIssues(result) {
    const wrap = el('div', 'issues');
    wrap.appendChild(el('h3', 'section', 'Issues (' + result.issues.length + ')'));

    if (!result.issues.length) {
      wrap.appendChild(el('div', 'empty', 'No issues detected. This page is well optimised for AI answer engines.'));
      return wrap;
    }

    const byCat = {};
    result.issues.forEach(function (i) { (byCat[i.category] = byCat[i.category] || []).push(i); });

    NS.CATEGORY_ORDER.forEach(function (cat) {
      const list = byCat[cat];
      if (!list || !list.length) return;
      const meta = NS.CATEGORY_META[cat];

      const group = el('div', 'group');
      const gh = el('div', 'group-head');
      const dot = el('span', 'dot');
      dot.style.background = meta.color;
      gh.appendChild(dot);
      gh.appendChild(el('span', 'label', meta.label));
      gh.appendChild(el('span', 'n', list.length + (list.length === 1 ? ' issue' : ' issues')));
      group.appendChild(gh);

      list
        .slice()
        .sort(function (a, b) { return sevRank(a.severity) - sevRank(b.severity); })
        .forEach(function (iss) { group.appendChild(buildIssueCard(iss, meta)); });

      wrap.appendChild(group);
    });
    return wrap;
  }

  function sevRank(s) { return s === 'High' ? 0 : s === 'Medium' ? 1 : 2; }

  function buildIssueCard(iss, meta) {
    const card = el('div', 'issue');
    card.style.borderLeftColor = meta.color;

    const top = el('div', 'top');
    top.appendChild(el('span', 'sev ' + iss.severity, iss.severity));
    if (!iss.highlighted) top.appendChild(el('span', 'not-hl', 'not highlighted'));
    card.appendChild(top);

    card.appendChild(el('div', 'msg', iss.message));
    if (iss.snippet) card.appendChild(el('div', 'snippet', '“' + iss.snippet + '”'));

    const fix = el('div', 'fix');
    fix.appendChild(el('b', null, 'Fix: '));
    fix.appendChild(document.createTextNode(iss.fix));
    card.appendChild(fix);

    card.addEventListener('click', function () { scrollToIssue(iss); });
    return card;
  }

  function scrollToIssue(iss) {
    const target = (NS.highlighter.getElementForIssue(iss.id)) || iss.node;
    if (!target) return;
    try {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      target.scrollIntoView();
    }
    // Ensure the category is visible before pulsing.
    if (toggleState[iss.category] === false) {
      toggleState[iss.category] = true;
      NS.highlighter.setCategoryVisible(iss.category, true);
      const row = shadow && shadow.querySelector('.cat-row[data-cat="' + iss.category + '"]');
      if (row) { row.classList.remove('off'); const t = row.querySelector('.cat-toggle'); if (t) t.textContent = 'on'; }
    }
    NS.highlighter.pulse(target);
  }

  // ---- export -------------------------------------------------------------
  function exportReport() {
    if (!NS.lastResult || typeof NS.buildReport !== 'function') return;
    const html = NS.buildReport(NS.lastResult);
    let host = 'page';
    try { host = new URL(NS.lastResult.url).hostname.replace(/^www\./, ''); } catch (e) {}
    const stamp = new Date(NS.lastResult.timestamp || Date.now()).toISOString().slice(0, 10);
    const filename = 'geo-lens-' + host + '-' + stamp + '.html';
    try {
      chrome.runtime.sendMessage({ type: 'GEO_DOWNLOAD', html: html, filename: filename });
    } catch (e) {
      // Fallback: open in a new tab via data URL if messaging fails.
      const blob = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
      window.open(blob, '_blank');
    }
  }

  // ---- footer -------------------------------------------------------------
  function buildFooter(result) {
    const f = el('div', 'footer');
    const lock = el('span', 'lock');
    lock.appendChild(el('span', null, '●'));
    lock.appendChild(el('span', null, '100% local analysis'));
    f.appendChild(lock);
    const meta = el('span', null, result.wordCount ? (result.wordCount + ' words scanned') : '');
    f.appendChild(meta);
    return f;
  }

  // ---- public render ------------------------------------------------------
  function render(result) {
    NS.CATEGORY_ORDER.forEach(function (c) { toggleState[c] = true; });
    const root = ensureHost();
    const panel = el('div', 'panel');

    panel.appendChild(buildHeader(result));
    panel.appendChild(buildToolbar(result));

    const body = el('div', 'body');
    if (result.truncated) {
      body.appendChild(el('div', 'notice', 'This page is very long — only the first 50,000 words were analysed.'));
    }
    const counts = {};
    result.issues.forEach(function (i) { counts[i.category] = (counts[i.category] || 0) + 1; });
    body.appendChild(buildCategories(result, counts));
    body.appendChild(buildIssues(result));
    panel.appendChild(body);

    panel.appendChild(buildFooter(result));
    root.appendChild(panel);
    openSoon(panel);
  }

  function renderNoContent(summary) {
    const root = ensureHost();
    const panel = el('div', 'panel');
    const header = el('div', 'header');
    const main = el('div', 'head-main');
    main.appendChild(el('div', 'brand', 'GEO LENS'));
    main.appendChild(el('div', 'doc-title', summary.title || summary.url || ''));
    header.appendChild(main);
    const close = el('button', 'close-btn', '×');
    close.addEventListener('click', remove);
    header.appendChild(close);
    panel.appendChild(header);

    const body = el('div', 'body');
    const nc = el('div', 'nocontent');
    nc.appendChild(el('b', null, 'No article content detected'));
    nc.appendChild(document.createTextNode('GEO Lens looks for an article or main content block to audit. This page does not appear to have one (it may be a home page, app, or empty tab). Open an article or blog post and scan again.'));
    body.appendChild(nc);
    panel.appendChild(body);
    panel.appendChild(buildFooter({ wordCount: 0 }));
    root.appendChild(panel);
    openSoon(panel);
  }

  function remove() {
    // Closing the panel fully restores the page.
    if (NS.highlighter) NS.highlighter.clearAll();
    removePanelDom();
  }

  NS.panel = { render: render, renderNoContent: renderNoContent, remove: remove };
})();
