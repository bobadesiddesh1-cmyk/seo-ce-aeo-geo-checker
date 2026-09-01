/*
 * panel.js — Shadow DOM side panel.
 *
 * Three views behind a tab strip: Issues (each with its generated rewrite),
 * Quotable (the passages most likely to be cited), and Retrieval (how the page
 * chunks, and which chunks orphan). All UI is built with createElement +
 * textContent — never innerHTML with page text — so host-page content cannot
 * inject markup into the panel.
 *
 * Attaches window.__GEOLens.panel.
 */
(function () {
  'use strict';
  const NS = (window.__GEOLens = window.__GEOLens || {});
  if (NS.panel) return;

  const HOST_ID = 'geo-lens-panel-host';
  const GRADE_COLOR = { A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444' };

  const FALLBACK_CSS =
    ':host{position:fixed;top:0;right:0;width:420px;max-width:96vw;height:100vh;z-index:2147483647;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#16181d}" +
    '.panel{height:100%;background:#fff;border-left:1px solid #e2e5ea;display:flex;flex-direction:column;overflow:hidden}' +
    '.body{flex:1;overflow-y:auto}.header,.toolbar,.footer{padding:12px 16px;border-bottom:1px solid #e2e5ea}' +
    '.btn{padding:8px;border:1px solid #e2e5ea;border-radius:8px;background:#f6f7f9;cursor:pointer;margin-right:6px}' +
    '.issue{border:1px solid #e2e5ea;border-radius:8px;padding:10px;margin:8px 16px}';

  let hostEl = null;
  let shadow = null;
  let currentResult = null;
  let activeTab = 'issues';
  const toggleState = {};

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
      fetch(chrome.runtime.getURL('content/panel.css'))
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

  function send(msg) {
    try { chrome.runtime.sendMessage(msg); } catch (e) { /* panel still works without persistence */ }
  }

  // ---- clipboard ----------------------------------------------------------
  function copyText(text, btn) {
    const done = function (ok) {
      if (!btn) return;
      const original = btn.dataset.label || btn.textContent;
      btn.dataset.label = original;
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      btn.classList.toggle('copied', ok);
      setTimeout(function () { btn.textContent = original; btn.classList.remove('copied'); }, 1400);
    };
    try {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
    } catch (e) {
      done(fallbackCopy(text));
    }
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('aria-hidden', 'true');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
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

  // ---- header -------------------------------------------------------------
  function buildHeader(result) {
    const header = el('div', 'header');
    header.appendChild(buildRing(result.scoring.overall, result.scoring.grade));

    const main = el('div', 'head-main');
    main.appendChild(el('div', 'brand', 'GEO LENS'));

    const line = el('div', 'score-line');
    line.appendChild(el('b', null, String(result.scoring.overall)));
    line.appendChild(el('em', null, '/100 · Grade ' + result.scoring.grade));
    if (result.delta) {
      const d = result.delta.scoreDelta;
      const chip = el('span', 'delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'flat'), (d > 0 ? '+' : '') + d);
      chip.title = 'Previous scan: ' + result.delta.previousScore + '/100 (' + relTime(result.delta.previousTimestamp) + ')';
      line.appendChild(chip);
    }
    main.appendChild(line);

    const badges = el('div', 'badges');
    const pb = el('span', 'badge-profile', result.profile.label);
    pb.title = result.profile.note + '\nDetected: ' + result.profileReason;
    badges.appendChild(pb);
    if (result.suppressed.profile) {
      const s = el('span', 'badge-muted', result.suppressed.profile + ' n/a');
      s.title = result.suppressed.profile + ' rule(s) do not apply to a ' + result.profile.label.toLowerCase() + '.';
      badges.appendChild(s);
    }
    if (result.suppressed.rule + result.suppressed.issue) {
      const n = result.suppressed.rule + result.suppressed.issue;
      const s = el('span', 'badge-muted', n + ' dismissed');
      s.title = 'Hidden by your dismissals. Manage them in Options.';
      badges.appendChild(s);
    }
    main.appendChild(badges);
    main.appendChild(el('div', 'doc-title', result.title || result.url));
    header.appendChild(main);

    const close = el('button', 'close-btn', '×');
    close.title = 'Close and restore page';
    close.addEventListener('click', remove);
    header.appendChild(close);
    return header;
  }

  function relTime(ts) {
    if (!ts) return '';
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.round(h / 24);
    return d + 'd ago';
  }

  // ---- toolbar ------------------------------------------------------------
  function buildToolbar(result) {
    const bar = el('div', 'toolbar');

    const rescan = el('button', 'btn', 'Re-scan');
    rescan.addEventListener('click', function () { send({ type: 'GEO_RESCAN' }); });

    const clear = el('button', 'btn', 'Clear');
    clear.title = 'Remove all highlights (page restored exactly)';
    clear.addEventListener('click', function () {
      NS.highlighter.clearAll();
      NS.CATEGORY_ORDER.forEach(function (c) { toggleState[c] = false; });
      markAllTogglesOff();
    });

    const copyAll = el('button', 'btn', 'Copy fixes');
    copyAll.title = 'Copy every generated rewrite as Markdown';
    copyAll.addEventListener('click', function () { copyText(buildFixMarkdown(result), copyAll); });

    const exportBtn = el('button', 'btn primary', 'Export');
    exportBtn.title = 'Download a standalone HTML report';
    exportBtn.addEventListener('click', exportReport);

    bar.appendChild(rescan);
    bar.appendChild(clear);
    bar.appendChild(copyAll);
    bar.appendChild(exportBtn);
    return bar;
  }

  function buildFixMarkdown(result) {
    const lines = ['# GEO Lens fixes — ' + (result.title || result.url), '', result.url, ''];
    lines.push('Score ' + result.scoring.overall + '/100 (' + result.scoring.grade + ') · ' + result.profile.label + ' profile · ' + result.issues.length + ' issues');
    lines.push('');
    NS.CATEGORY_ORDER.forEach(function (cat) {
      const list = result.issues.filter(function (i) { return i.category === cat; });
      if (!list.length) return;
      lines.push('## ' + NS.CATEGORY_META[cat].label);
      lines.push('');
      list.forEach(function (iss) {
        lines.push('### [' + iss.severity + '] ' + iss.message);
        if (iss.snippet) lines.push('> ' + iss.snippet);
        lines.push('');
        lines.push('**Fix:** ' + iss.fix);
        if (iss.rewrite) {
          lines.push('');
          lines.push('**' + iss.rewrite.label + ':**');
          lines.push('');
          const fence = iss.rewrite.format === 'html' ? '```html' : '```';
          lines.push(fence);
          lines.push(iss.rewrite.text);
          lines.push('```');
        }
        lines.push('');
      });
    });
    return lines.join('\n');
  }

  function markAllTogglesOff() {
    if (!shadow) return;
    shadow.querySelectorAll('.cat-row').forEach(function (row) {
      row.classList.add('off');
      const t = row.querySelector('.cat-toggle');
      if (t) t.textContent = 'off';
    });
  }

  // ---- category bars (with score explainability) --------------------------
  function buildCategories(result, counts) {
    const wrap = el('div', 'cats');
    wrap.appendChild(el('h3', null, 'Category scores — click a row to toggle its highlights'));

    NS.CATEGORY_ORDER.forEach(function (cat) {
      const meta = NS.CATEGORY_META[cat];
      const score = result.scoring.categories[cat];
      const weight = result.scoring.weights[cat] != null ? result.scoring.weights[cat] : meta.weight;

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

      // Why this number: the exact arithmetic, not just the result.
      const why = el('div', 'cat-why', explainCategory(result, cat, weight));
      row.appendChild(why);

      row.addEventListener('click', function () {
        const vis = toggleState[cat] === false;
        toggleState[cat] = vis;
        NS.highlighter.setCategoryVisible(cat, vis);
        row.classList.toggle('off', !vis);
        toggle.textContent = vis ? 'on' : 'off';
      });

      wrap.appendChild(row);
    });
    return wrap;
  }

  function explainCategory(result, cat, weight) {
    const list = result.scoring.breakdown[cat] || [];
    const pct = Math.round(weight * 100) + '% of overall';
    if (!list.length) return '100, no deductions · ' + pct;
    const bySev = { High: 0, Medium: 0, Low: 0 };
    let total = 0;
    list.forEach(function (d) { bySev[d.severity] = (bySev[d.severity] || 0) + 1; total += d.points; });
    const parts = [];
    ['High', 'Medium', 'Low'].forEach(function (s) {
      if (!bySev[s]) return;
      const each = list.filter(function (d) { return d.severity === s; })[0].points;
      parts.push('−' + each + (bySev[s] > 1 ? '×' + bySev[s] : '') + ' ' + s);
    });
    const floored = 100 - total < 0;
    return '100 ' + parts.join(' ') + ' = ' + (floored ? '0 (floored from ' + (100 - total) + ')' : String(100 - total)) + ' · ' + pct;
  }

  // ---- tabs ---------------------------------------------------------------
  function buildTabs(result) {
    const strip = el('div', 'tabs');
    const defs = [
      { id: 'issues', label: 'Issues', n: result.issues.length },
      { id: 'quotable', label: 'Quotable', n: result.quotables.candidates.length },
      { id: 'retrieval', label: 'Retrieval', n: result.retrieval.orphanCount || result.retrieval.chunks.length },
    ];
    defs.forEach(function (d) {
      const b = el('button', 'tab' + (activeTab === d.id ? ' active' : ''), d.label);
      b.appendChild(el('span', 'tab-n', String(d.n)));
      b.addEventListener('click', function () { activeTab = d.id; rerender(); });
      strip.appendChild(b);
    });
    return strip;
  }

  // ---- issue list ---------------------------------------------------------
  function buildIssues(result) {
    const wrap = el('div', 'issues');

    if (!result.issues.length) {
      wrap.appendChild(el('div', 'empty', 'No issues detected under the ' + result.profile.label + ' profile. This page reads well for AI answer engines.'));
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
        .forEach(function (iss) { group.appendChild(buildIssueCard(iss, meta, result)); });

      wrap.appendChild(group);
    });
    return wrap;
  }

  function sevRank(s) { return s === 'High' ? 0 : s === 'Medium' ? 1 : 2; }

  function buildIssueCard(iss, meta, result) {
    const card = el('div', 'issue');
    card.style.borderLeftColor = meta.color;

    const top = el('div', 'top');
    top.appendChild(el('span', 'sev ' + iss.severity, iss.severity));
    if (!iss.highlighted) top.appendChild(el('span', 'not-hl', 'not highlighted'));
    card.appendChild(top);

    const msg = el('div', 'msg', iss.message);
    msg.addEventListener('click', function () { scrollToIssue(iss); });
    card.appendChild(msg);

    if (iss.snippet) {
      const sn = el('div', 'snippet', '“' + iss.snippet + '”');
      sn.addEventListener('click', function () { scrollToIssue(iss); });
      card.appendChild(sn);
    }

    const fix = el('div', 'fix');
    fix.appendChild(el('b', null, 'Fix: '));
    fix.appendChild(document.createTextNode(iss.fix));
    card.appendChild(fix);

    // The generated rewrite — the reason this extension exists.
    if (iss.rewrite) card.appendChild(buildRewrite(iss));

    card.appendChild(buildIssueActions(iss, result));
    return card;
  }

  function buildRewrite(iss) {
    const box = el('div', 'rewrite');

    const head = el('div', 'rw-head');
    head.appendChild(el('span', 'rw-label', iss.rewrite.label));
    const fmt = el('span', 'rw-fmt', iss.rewrite.format);
    head.appendChild(fmt);
    box.appendChild(head);

    const pre = el('pre', 'rw-text');
    pre.textContent = iss.rewrite.text;
    box.appendChild(pre);

    const copy = el('button', 'rw-copy', 'Copy');
    copy.addEventListener('click', function (e) {
      e.stopPropagation();
      copyText(iss.rewrite.text, copy);
    });
    box.appendChild(copy);
    return box;
  }

  function buildIssueActions(iss, result) {
    const row = el('div', 'actions');

    const goto = el('button', 'act', 'Show on page');
    goto.addEventListener('click', function (e) { e.stopPropagation(); scrollToIssue(iss); });
    row.appendChild(goto);

    const dismiss = el('button', 'act', 'Dismiss');
    dismiss.title = 'Hide this specific issue on this page';
    dismiss.addEventListener('click', function (e) {
      e.stopPropagation();
      send({ type: 'GEO_DISMISS_ISSUE', url: result.url, fingerprint: iss.fingerprint });
      hideCard(dismiss, 'Dismissed');
    });
    row.appendChild(dismiss);

    const ignore = el('button', 'act', 'Ignore rule here');
    ignore.title = 'Stop reporting ' + iss.ruleId + ' on this whole site';
    ignore.addEventListener('click', function (e) {
      e.stopPropagation();
      send({ type: 'GEO_DISMISS_RULE', url: result.url, ruleId: iss.ruleId });
      hideCard(ignore, 'Ignored on this site');
    });
    row.appendChild(ignore);

    return row;
  }

  function hideCard(btn, label) {
    let card = btn;
    while (card && !card.classList.contains('issue')) card = card.parentElement;
    if (!card) return;
    card.classList.add('dismissed');
    const note = el('div', 'dismissed-note', label + ' — applies from the next scan.');
    card.appendChild(note);
  }

  function scrollToIssue(iss) {
    const target = NS.highlighter.getElementForIssue(iss.id) || iss.node;
    if (!target) return;
    try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    catch (e) { target.scrollIntoView(); }
    if (toggleState[iss.category] === false) {
      toggleState[iss.category] = true;
      NS.highlighter.setCategoryVisible(iss.category, true);
      const row = shadow && shadow.querySelector('.cat-row[data-cat="' + iss.category + '"]');
      if (row) { row.classList.remove('off'); const t = row.querySelector('.cat-toggle'); if (t) t.textContent = 'on'; }
    }
    NS.highlighter.pulse(target);
  }

  // ---- quotable view ------------------------------------------------------
  function buildQuotable(result) {
    const wrap = el('div', 'quotables');
    const q = result.quotables;

    wrap.appendChild(el('div', 'view-intro', 'The sentences an AI engine is most likely to lift verbatim. Each must stand alone once it is separated from the page.'));

    if (!q.candidates.length) {
      const empty = el('div', 'empty');
      empty.appendChild(el('b', null, 'No strong citation candidate on this page'));
      empty.appendChild(document.createTextNode(
        'None of the ' + q.considered + ' sentences scored high enough to be quoted on their own. Add short declaratives that each carry one concrete fact and name the subject.'
      ));
      wrap.appendChild(empty);
      return wrap;
    }

    q.candidates.forEach(function (c, i) {
      const card = el('div', 'quote');
      const head = el('div', 'q-head');
      head.appendChild(el('span', 'q-rank', '#' + (i + 1)));
      head.appendChild(el('span', 'q-score', 'score ' + c.score));
      card.appendChild(head);

      const body = el('div', 'q-text', '“' + c.text + '”');
      body.addEventListener('click', function () {
        if (!c.node) return;
        try { c.node.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { c.node.scrollIntoView(); }
        NS.highlighter.pulse(c.node);
      });
      card.appendChild(body);

      if (c.reasons.length) card.appendChild(el('div', 'q-why', c.reasons.join(' · ')));

      const copy = el('button', 'rw-copy', 'Copy');
      copy.addEventListener('click', function () { copyText(c.text, copy); });
      card.appendChild(copy);

      wrap.appendChild(card);
    });

    return wrap;
  }

  // ---- retrieval view -----------------------------------------------------
  function buildRetrieval(result) {
    const wrap = el('div', 'retrieval');
    const r = result.retrieval;

    wrap.appendChild(el('div', 'view-intro',
      'How this page splits when an AI engine chunks it for retrieval (~' + r.tokenBudget + ' tokens, heading-bounded). ' +
      'An orphan chunk loses its subject once it is retrieved on its own.'));

    const sum = el('div', 'chunk-summary');
    sum.appendChild(el('b', null, String(r.chunks.length)));
    sum.appendChild(document.createTextNode(' chunks · '));
    const orph = el('b', r.orphanCount ? 'bad' : 'good', String(r.orphanCount));
    sum.appendChild(orph);
    sum.appendChild(document.createTextNode(' orphaned'));
    wrap.appendChild(sum);

    if (!r.chunks.length) {
      wrap.appendChild(el('div', 'empty', 'No chunks could be built from this page.'));
      return wrap;
    }

    r.chunks.forEach(function (c) {
      const card = el('div', 'chunk' + (c.orphan ? ' orphan' : ''));

      const head = el('div', 'c-head');
      head.appendChild(el('span', 'c-idx', '#' + c.index));
      head.appendChild(el('span', 'c-heading', c.heading || (c.continued ? '(continued)' : '(no heading)')));
      head.appendChild(el('span', 'c-tokens', '~' + c.tokens + ' tok'));
      card.appendChild(head);

      card.appendChild(el('div', 'c-text', NS.util.snippet(c.text, 220)));

      if (c.orphan) {
        card.appendChild(el('div', 'c-flag', 'Orphan: ' + c.reasons.join('; ') + '.'));
      }

      card.addEventListener('click', function () {
        if (!c.node) return;
        try { c.node.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { c.node.scrollIntoView(); }
        NS.highlighter.pulse(c.node);
      });

      wrap.appendChild(card);
    });

    return wrap;
  }

  // ---- export -------------------------------------------------------------
  function exportReport() {
    if (!NS.lastResult || typeof NS.buildReport !== 'function') return;
    const html = NS.buildReport(NS.lastResult);
    let host = 'page';
    try { host = new URL(NS.lastResult.url).hostname.replace(/^www\./, ''); } catch (e) { /* keep default */ }
    const stamp = new Date(NS.lastResult.timestamp || Date.now()).toISOString().slice(0, 10);
    const filename = 'geo-lens-' + host + '-' + stamp + '.html';
    try {
      chrome.runtime.sendMessage({ type: 'GEO_DOWNLOAD', html: html, filename: filename });
    } catch (e) {
      window.open('data:text/html;charset=utf-8,' + encodeURIComponent(html), '_blank');
    }
  }

  // ---- footer -------------------------------------------------------------
  function buildFooter(result) {
    const f = el('div', 'footer');
    const lock = el('span', 'lock');
    lock.appendChild(el('span', null, '●'));
    lock.appendChild(el('span', null, '100% local analysis'));
    f.appendChild(lock);
    f.appendChild(el('span', null, result.wordCount ? (result.wordCount + ' words scanned') : ''));
    return f;
  }

  // ---- notices ------------------------------------------------------------
  function buildNotices(result) {
    const out = [];
    if (result.truncated) {
      out.push(el('div', 'notice', 'This page is very long — only the first 50,000 words were analysed.'));
    }
    if (result.language && result.language.declared && !result.language.english) {
      out.push(el('div', 'notice',
        'This page declares lang="' + result.language.lang + '". GEO Lens’s prose rules — sentence splitting, question words, hedges, filler openers — are English-only, so scores on this page are unreliable.'));
    }
    if (result.delta && result.delta.fixedCount) {
      out.push(el('div', 'notice good',
        result.delta.fixedCount + ' issue' + (result.delta.fixedCount === 1 ? '' : 's') + ' fixed since the last scan ' +
        relTime(result.delta.previousTimestamp) + ' (' + result.delta.previousScore + ' → ' + result.scoring.overall + ').'));
    }
    return out;
  }

  // ---- render -------------------------------------------------------------
  function rerender() {
    if (currentResult) render(currentResult, true);
  }

  function render(result, keepTab) {
    currentResult = result;
    if (!keepTab) {
      activeTab = 'issues';
      NS.CATEGORY_ORDER.forEach(function (c) { toggleState[c] = true; });
    }

    const root = ensureHost();
    const panel = el('div', 'panel');

    panel.appendChild(buildHeader(result));
    panel.appendChild(buildToolbar(result));

    const body = el('div', 'body');
    buildNotices(result).forEach(function (n) { body.appendChild(n); });

    const counts = {};
    result.issues.forEach(function (i) { counts[i.category] = (counts[i.category] || 0) + 1; });
    body.appendChild(buildCategories(result, counts));
    body.appendChild(buildTabs(result));

    if (activeTab === 'quotable') body.appendChild(buildQuotable(result));
    else if (activeTab === 'retrieval') body.appendChild(buildRetrieval(result));
    else body.appendChild(buildIssues(result));

    panel.appendChild(body);
    panel.appendChild(buildFooter(result));
    root.appendChild(panel);
    openSoon(panel);
  }

  function renderNoContent(summary) {
    currentResult = null;
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
    if (NS.highlighter) NS.highlighter.clearAll();
    removePanelDom();
    currentResult = null;
  }

  NS.panel = { render: render, renderNoContent: renderNoContent, remove: remove };
})();
