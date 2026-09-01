/*
 * report-template.js — builds a self-contained, standalone HTML report from a
 * scan result. No external resources; all styles inline; every page-derived
 * string HTML-escaped. Carries the generated rewrites, the quotable passages,
 * the retrieval preview and the revision delta, so the file works as a
 * client-facing deliverable rather than a screenshot of the panel.
 *
 * White-labelled from settings.branding (agency, client, accent).
 *
 * Attaches window.__GEOLens.buildReport(result) -> string.
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

  // Only ever emit a colour we recognise as a hex triplet.
  function safeColor(c, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : fallback;
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
    const branding = result.branding || {};
    const accent = safeColor(branding.accent, '#4F46E5');

    const counts = {};
    result.issues.forEach(function (i) { counts[i.category] = (counts[i.category] || 0) + 1; });

    // ---- category cards
    const catCards = order.map(function (cat) {
      const m = meta[cat];
      const s = result.scoring.categories[cat];
      const w = result.scoring.weights[cat] != null ? result.scoring.weights[cat] : m.weight;
      return (
        '<div class="cat">' +
        '<div class="cat-top"><span class="swatch" style="background:' + m.color + '"></span>' +
        '<span class="cat-name">' + esc(m.label) + '</span>' +
        '<span class="cat-score">' + s + '<small>/100</small></span></div>' +
        '<div class="bar"><i style="width:' + s + '%;background:' + m.color + '"></i></div>' +
        '<div class="cat-meta">' + (counts[cat] || 0) + ' issue' + ((counts[cat] || 0) === 1 ? '' : 's') +
        ' · ' + Math.round(w * 100) + '% of overall</div>' +
        '</div>'
      );
    }).join('');

    // ---- issues with their rewrites
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
          (iss.rewrite
            ? '<div class="rw"><div class="rw-label">' +
              (iss.rewrite.ai ? '<span class="rw-ai">AI</span> ' : '') + esc(iss.rewrite.label) +
              ' <span class="rw-fmt">' + esc(iss.rewrite.format) + '</span></div>' +
              '<pre>' + esc(iss.rewrite.text) + '</pre></div>'
            : '') +
          '</div>'
        );
      }).join('');
      return (
        '<section class="group">' +
        '<h2><span class="dot" style="background:' + m.color + '"></span>' + esc(m.label) +
        ' <span class="gn">' + list.length + '</span></h2>' + cards + '</section>'
      );
    }).join('');

    // ---- quotable passages
    const q = result.quotables || { candidates: [], considered: 0 };
    const quoteBlock = q.candidates.length
      ? q.candidates.map(function (c, i) {
          return (
            '<div class="quote"><div class="q-head"><b>#' + (i + 1) + '</b>' +
            '<span class="q-score">score ' + c.score + '</span></div>' +
            '<div class="q-text">&ldquo;' + esc(c.text) + '&rdquo;</div>' +
            (c.reasons && c.reasons.length ? '<div class="q-why">' + esc(c.reasons.join(' · ')) + '</div>' : '') +
            '</div>'
          );
        }).join('')
      : '<p class="none"><b>No strong citation candidate on this page.</b> None of the ' + q.considered +
        ' sentences scored high enough to be quoted on their own.</p>';

    // ---- AI insights
    const ai = result.ai;
    const AI_LABEL = {
      unanswered: 'Question not actually answered',
      unsupported: 'Claim asserted without support',
      gap: 'Question the page never answers',
    };
    let insightBlock = '';
    if (ai && ai.available && ai.insights && ai.insights.length) {
      insightBlock =
        '<p class="lead">Findings that need reading comprehension rather than pattern matching, ' +
        'produced by an on-device model.</p>' +
        ai.insights.map(function (ins) {
          const subject = ins.kind === 'unanswered' ? ins.heading
            : ins.kind === 'gap' ? ins.question
            : ins.quote;
          return (
            '<div class="insight"><div class="i-kind">' + esc(AI_LABEL[ins.kind] || ins.kind) + '</div>' +
            '<div class="i-subject">' + esc(String(subject || '').slice(0, 300)) + '</div>' +
            (ins.detail ? '<div class="i-detail">' + esc(ins.detail) + '</div>' : '') +
            '</div>'
          );
        }).join('');
    } else if (ai && ai.available) {
      insightBlock = '<p class="none">Nothing flagged: every question heading is genuinely answered, ' +
        'no unsupported claims stood out, and no obvious reader question is missing.</p>';
    }

    // ---- retrieval preview
    const r = result.retrieval || { chunks: [], orphanCount: 0, tokenBudget: 500 };
    const orphans = r.chunks.filter(function (c) { return c.orphan; });
    const chunkBlock =
      '<p class="lead">Split at ~' + r.tokenBudget + ' tokens, heading-bounded: <b>' + r.chunks.length +
      '</b> chunks, <b class="' + (r.orphanCount ? 'bad' : 'good') + '">' + r.orphanCount + '</b> orphaned.</p>' +
      (orphans.length
        ? orphans.map(function (c) {
            return (
              '<div class="chunk"><div class="c-head"><b>#' + c.index + '</b> ' +
              esc(c.heading || '(no heading)') + ' <span class="c-tok">~' + c.tokens + ' tok</span></div>' +
              '<div class="c-text">' + esc((c.text || '').slice(0, 220)) + '</div>' +
              '<div class="c-flag">Orphan: ' + esc((c.reasons || []).join('; ')) + '.</div></div>'
            );
          }).join('')
        : '<p class="none">Every chunk stands on its own.</p>');

    // ---- delta
    const d = result.delta;
    const deltaBlock = d
      ? '<div class="delta-card"><b>' + (d.scoreDelta > 0 ? '+' : '') + d.scoreDelta + '</b> since the previous scan on ' +
        esc(fmtDate(d.previousTimestamp)) + ' (' + d.previousScore + '/100 → ' + result.scoring.overall + '/100). ' +
        d.fixedCount + ' issue' + (d.fixedCount === 1 ? '' : 's') + ' fixed.</div>'
      : '';

    // ---- branding
    const brandLine = branding.agency ? esc(branding.agency) : 'GEO Lens';
    const clientLine = branding.client
      ? '<div class="client">Prepared for ' + esc(branding.client) + '</div>'
      : '';

    const style =
      'body{margin:0;background:#f3f4f6;color:#16181d;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.5}' +
      '.wrap{max-width:860px;margin:0 auto;padding:32px 20px 64px}' +
      '.card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:22px 24px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.05)}' +
      '.brand{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:' + accent + ';font-weight:700}' +
      '.client{font-size:13px;color:#6b7280;margin-top:2px}' +
      '.hero{display:flex;gap:22px;align-items:center}' +
      '.ring{width:104px;height:104px;border-radius:50%;flex:0 0 auto;position:relative;background:conic-gradient(' + gradeColor + ' ' + (result.scoring.overall * 3.6) + 'deg,#e5e7eb 0)}' +
      '.ring .hole{position:absolute;inset:9px;background:#fff;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center}' +
      '.ring .hole b{font-size:30px}.ring .hole span{font-size:12px;color:#6b7280}' +
      '.hero h1{font-size:22px;margin:6px 0 2px}.hero .url{font-size:13px;color:#6b7280;word-break:break-all}' +
      '.hero .date{font-size:12px;color:#9ca3af;margin-top:4px}' +
      '.pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:' + accent + '22;color:' + accent + ';margin-top:6px}' +
      '.delta-card{margin-top:12px;padding:9px 12px;border-radius:8px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);font-size:13px}' +
      '.delta-card b{font-size:15px}' +
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
      '.rw{margin-top:10px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;padding:9px 11px}' +
      '.rw-label{font-size:11.5px;font-weight:700;color:#16a34a;margin-bottom:6px}' +
      '.rw-ai{font-size:9px;font-weight:800;letter-spacing:.06em;padding:1px 5px;border-radius:4px;background:#4F46E5;color:#fff}' +
      '.insight{border:1px solid #e5e7eb;border-left:3px solid #4F46E5;border-radius:9px;padding:10px 12px;margin:10px 0;background:#fff}' +
      '.i-kind{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}' +
      '.i-subject{font-size:14px;font-weight:600;margin-top:4px}' +
      '.i-detail{font-size:12.5px;color:#4b5563;margin-top:5px}' +
      '.rw-fmt{font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;border:1px solid #e5e7eb;border-radius:4px;padding:0 4px;font-weight:600}' +
      '.rw pre{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word}' +
      '.quote{border:1px solid #e5e7eb;border-left:3px solid #A855F7;border-radius:9px;padding:11px 13px;margin:10px 0;background:#fff}' +
      '.q-head{display:flex;gap:9px;align-items:baseline}.q-head b{color:#A855F7;font-size:13px}' +
      '.q-score{font-size:11px;color:#9ca3af}.q-text{font-size:14px;margin-top:5px}.q-why{font-size:11px;color:#6b7280;margin-top:6px}' +
      '.lead{font-size:13.5px;color:#4b5563;margin-top:10px}.lead b{color:#16181d}.lead b.bad{color:#dc2626}.lead b.good{color:#16a34a}' +
      '.chunk{border:1px solid #e5e7eb;border-left:3px solid #ef4444;border-radius:9px;padding:10px 12px;margin:10px 0;background:#fff}' +
      '.c-head{font-size:13px;font-weight:600}.c-tok{font-size:11px;color:#9ca3af;font-weight:400}' +
      '.c-text{font-size:12.5px;color:#6b7280;margin-top:5px}.c-flag{font-size:12px;color:#dc2626;margin-top:6px;font-weight:600}' +
      '.none{font-size:13.5px;color:#6b7280;margin-top:12px}.none b{color:#16181d}' +
      '.foot{text-align:center;color:#9ca3af;font-size:12px;margin-top:30px}' +
      '.notice{background:rgba(234,179,8,.14);border:1px solid rgba(234,179,8,.3);color:#92700a;border-radius:8px;padding:8px 10px;font-size:12.5px;margin-top:10px}';

    const langNotice =
      result.language && result.language.declared && !result.language.english
        ? '<div class="notice">This page declares lang="' + esc(result.language.lang) +
          '". GEO Lens&rsquo;s prose rules are English-only, so these scores are unreliable.</div>'
        : '';

    return (
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + esc(brandLine) + ' — AEO/GEO audit — ' + esc(result.title || result.url) + '</title>' +
      '<style>' + style + '</style></head><body><div class="wrap">' +

      '<div class="card"><div class="brand">' + esc(brandLine) + ' — AEO/GEO audit</div>' + clientLine +
      '<div class="hero" style="margin-top:14px">' +
      '<div class="ring"><div class="hole"><b>' + esc(grade) + '</b><span>' + result.scoring.overall + '/100</span></div></div>' +
      '<div><h1>' + esc(result.title || 'Untitled page') + '</h1>' +
      '<div class="url">' + esc(result.url) + '</div>' +
      '<div class="date">Scanned ' + esc(fmtDate(result.timestamp)) + ' · ' + (result.wordCount || 0) + ' words · ' + result.issues.length + ' issues</div>' +
      '<span class="pill">' + esc(result.profile.label) + ' profile</span>' +
      '</div></div>' +
      deltaBlock +
      (result.truncated ? '<div class="notice">This page is very long — only the first 50,000 words were analysed.</div>' : '') +
      langNotice +
      '</div>' +

      '<div class="card"><div class="brand">Category scores</div><div class="cats" style="margin-top:12px">' + catCards + '</div></div>' +

      '<div class="card"><div class="brand">Issues, fixes &amp; rewrites</div>' +
      (sections || '<p class="none">No issues detected.</p>') + '</div>' +

      (insightBlock ? '<div class="card"><div class="brand">Editorial insights</div>' + insightBlock + '</div>' : '') +

      '<div class="card"><div class="brand">Most citable passages</div>' + quoteBlock + '</div>' +

      '<div class="card"><div class="brand">Retrieval preview</div>' + chunkBlock + '</div>' +

      '<div class="foot">Generated by ' + esc(brandLine) + ' with GEO Lens · 100% local analysis · no data left the browser</div>' +
      '</div></body></html>'
    );
  }

  NS.buildReport = buildReport;
})();
