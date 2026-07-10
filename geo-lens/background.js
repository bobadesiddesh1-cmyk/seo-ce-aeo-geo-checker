/*
 * background.js — MV3 service worker. Two jobs: (1) inject the content scripts
 * into the active tab on user request and run the scan; (2) download the
 * exported HTML report. Also brokers stored scan history for the popup.
 */
'use strict';

// Injection order matters: highlighter (owns namespace + palette) → util →
// rules → report builder → panel → scanner (calls everything).
const CONTENT_FILES = [
  'content/highlighter.js',
  'content/util.js',
  'content/rules/extractability.js',
  'content/rules/structure.js',
  'content/rules/entity.js',
  'content/rules/schema.js',
  'content/rules/citability.js',
  'report/report-template.js',
  'content/panel.js',
  'content/scanner.js',
];

const MAX_RECENT = 10;

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;
  if (msg.type === 'GEO_SCAN') {
    handleScan(msg.tabId).then(sendResponse);
    return true; // async response
  }
  if (msg.type === 'GEO_DOWNLOAD') {
    handleDownload(msg).then(sendResponse);
    return true;
  }
  if (msg.type === 'GEO_GET_RECENT') {
    handleGetRecent(msg.url).then(sendResponse);
    return true;
  }
});

async function handleScan(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tabId }, files: CONTENT_FILES });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function () { return window.__GEOLens.run(); },
    });
    const summary = results && results[0] ? results[0].result : null;
    if (summary && !summary.noContent) await storeResult(summary);
    return { ok: true, summary: summary };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

async function handleDownload(msg) {
  try {
    const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(msg.html);
    await chrome.downloads.download({ url: url, filename: msg.filename || 'geo-lens-report.html', saveAs: false });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

async function handleGetRecent(url) {
  const recent = await getRecent();
  const current = url ? (recent.find(function (r) { return r.url === url; }) || null) : null;
  return { recent: recent, current: current };
}

async function getRecent() {
  const data = await chrome.storage.local.get('recent');
  return Array.isArray(data.recent) ? data.recent : [];
}

async function storeResult(s) {
  let recent = await getRecent();
  recent = recent.filter(function (r) { return r.url !== s.url; });
  recent.unshift({
    url: s.url,
    title: s.title,
    score: s.score,
    grade: s.grade,
    issueCount: s.issueCount,
    timestamp: s.timestamp,
  });
  recent = recent.slice(0, MAX_RECENT);
  await chrome.storage.local.set({ recent: recent });
}
