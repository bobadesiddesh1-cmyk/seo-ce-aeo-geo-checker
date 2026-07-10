/*
 * report-template.js — builds a self-contained, standalone HTML report from a
 * scan result (window.__GEOLens.lastResult). No external resources; all styles
 * inline. All page-derived text is HTML-escaped. Attaches
 * window.__GEOLens.buildReport(result) -> string.
 */
(function () {
  'use strict';
  const NS = (window.__GEOLens = window.__GEOLens || {});
  if (NS.buildReport) return;

  const GRADE_COLOR = { A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444' };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDate(ts) {
    const d = new Date(ts || Date.now());
    try { return d.toLocaleString(); } catch (e) { return d.toISOString(); }
  }

  function buildReport(result) {
    const meta = NS.CATEGORY_META;
    const order = NS.CATEGORY_ORDER;
    const grade = result.scoring.grade;
    const gradeColor = GRADE_COLOR[grade] || '#4F46E5';

    const counts = {};
    result.issues.forEach(function (i) { counts[i.category] = (counts[i.category] || 0) + 1; });

    const catCards = order.map(function (cat) {
      const m = meta[cat];
      const s = result.scoring.categories[cat];
      return (
        '<div class="cat">' +
        '<div class="cat-top"><span class="swatch" style="background:' + m.color + '"></span>' +
        '<span class="cat-name">' + esc(m.label) + '</span>' +
        '<span class="cat-score">' + s + '<small>/100</small></span></div>' +
        '<div class="bar"><i style="width:' + s + '%;background:' + m.color + '"></i></div>' +
        '<div class="cat-meta">' + (counts[cat] || 0) + ' issue' + ((counts[cat] || 0) === 1 ? '' : 's') + '</div>' +
        '</div>'
      );
    }).join('');

    const byCat = {};
    result.issues.forEach(function (i) { (byCat[i.category] = byCat[i.category] || []).push(i); });

    const sevRank = function (s) { return s === 'High' ? 0 : s === 'Medium' ? 1 : 2; };

    const sections = order.map(function (cat) {
      const list = byCat[cat];
      if (!list || !list.length) return '';
      const m = meta[cat];
      const cards = list.slice().sort(function (a, b) { return sevRank(a.severity) - sevRank(b.severity); }).map(function (iss) {
        return (
          '<div class="issue" style="border-left-color:' + m.color + '">' +
          '<div class="issue-top"><span class="sev sev-' + esc(iss.severity) + '">' + esc(iss.severity) + '</span></div>' +
          '<div class="msg">' + esc(iss.message) + '</div>' +
          (iss.snippet ? '<div class="snippet">&ldquo;' + esc(iss.snippet) + '&rdquo;</div>' : '') +
          '<div class="fix"><b>Fix:</b> ' + esc(iss.fix) + '</div>' +
          '</div>'
        );
      }).join('');
      return (
        '<section class="group">' +
        '<h2><span class="dot" style="background:' + m.color + '"></span>' + esc(m.label) +
        ' <span class="gn">' + list.length + '</span></h2>' + cards + '</section>'
      );
    }).join('');

    const style =
      'body{margin:0;background:#f3f4f6;color:#16181d;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.5}' +
      '.wrap{max-width:820px;margin:0 auto;padding:32px 20px 64px}' +
      '.card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:22px 24px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.05)}' +
      '.brand{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;font-weight:700}' +
      '.hero{display:flex;gap:22px;align-items:center}' +
      '.ring{width:104px;height:104px;border-radius:50%;flex:0 0 auto;position:relative;background:conic-gradient(' + gradeColor + ' ' + (result.scoring.overall * 3.6) + 'deg,#e5e7eb 0)}' +
      '.ring .hole{position:absolute;inset:9px;background:#fff;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center}' +
      '.ring .hole b{font-size:30px}.ring .hole span{font-size:12px;color:#6b7280}' +
      '.hero h1{font-size:22px;margin:6px 0 2px}.hero .url{font-size:13px;color:#6b7280;word-break:break-all}' +
      '.hero .date{font-size:12px;color:#9ca3af;margin-top:4px}' +
      '.cats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px}' +
      '.cat{border:1px solid #e5e7eb;border-radius:10px;padding:12px}' +
      '.cat-top{display:flex;align-items:center;gap:8px}.swatch{width:12px;height:12px;border-radius:3px}' +
      '.cat-name{font-weight:600;font-size:13px}.cat-score{margin-left:auto;font-weight:700}.cat-score small{color:#9ca3af;font-weight:400}' +
      '.bar{height:6px;background:#eef0f3;border-radius:3px;margin:8px 0 6px;overflow:hidden}.bar i{display:block;height:100%}' +
      '.cat-meta{font-size:11px;color:#6b7280}' +
      '.group{margin-top:26px}.group h2{font-size:16px;display:flex;align-items:center;gap:8px}' +
      '.dot{width:11px;height:11px;border-radius:3px;display:inline-block}.gn{font-size:12px;color:#6b7280;font-weight:400}' +
      '.issue{background:#fff;border:1px solid #e5e7eb;border-left-width:4px;border-radius:9px;padding:12px 14px;margin:10px 0}' +
      '.sev{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 7px;border-radius:999px}' +
      '.sev-High{background:rgba(239,68,68,.15);color:#dc2626}.sev-Medium{background:rgba(249,115,22,.15);color:#ea580c}.sev-Low{background:rgba(100,116,139,.15);color:#475569}' +
      '.msg{font-size:14px;margin-top:6px}.snippet{font-size:12.5px;color:#4b5563;font-style:italic;background:#f9fafb;border:1px solid #eef0f3;border-radius:6px;padding:7px 9px;margin-top:8px;word-break:break-word}' +
      '.fix{font-size:13px;margin-top:8px}.fix b{color:#16a34a}' +
      '.foot{text-align:center;color:#9ca3af;font-size:12px;margin-top:30px}' +
      '.notice{background:rgba(234,179,8,.14);border:1px solid rgba(234,179,8,.3);color:#92700a;border-radius:8px;padding:8px 10px;font-size:12.5px;margin-top:10px}';

    return (
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>GEO Lens report — ' + esc(result.title || result.url) + '</title>' +
      '<style>' + style + '</style></head><body><div class="wrap">' +
      '<div class="card"><div class="brand">GEO Lens — AEO/GEO audit</div>' +
      '<div class="hero" style="margin-top:14px">' +
      '<div class="ring"><div class="hole"><b>' + esc(grade) + '</b><span>' + result.scoring.overall + '/100</span></div></div>' +
      '<div><h1>' + esc(result.title || 'Untitled page') + '</h1>' +
      '<div class="url">' + esc(result.url) + '</div>' +
      '<div class="date">Scanned ' + esc(fmtDate(result.timestamp)) + ' · ' + (result.wordCount || 0) + ' words · ' + result.issues.length + ' issues</div>' +
      '</div></div>' +
      (result.truncated ? '<div class="notice">This page is very long — only the first 50,000 words were analysed.</div>' : '') +
      '</div>' +
      '<div class="card"><div class="brand">Category scores</div><div class="cats" style="margin-top:12px">' + catCards + '</div></div>' +
      '<div class="card"><div class="brand">Issues &amp; fixes</div>' + (sections || '<p style="color:#6b7280;margin-top:12px">No issues detected.</p>') + '</div>' +
      '<div class="foot">Generated by GEO Lens · 100% local analysis · no data left your browser</div>' +
      '</div></body></html>'
    );
  }

  NS.buildReport = buildReport;
})();
