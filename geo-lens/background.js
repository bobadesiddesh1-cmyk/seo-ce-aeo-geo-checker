/*
 * background.js — MV3 service worker.
 *
 * Jobs: inject the content scripts and run a scan on user request; broker every
 * piece of persisted state (settings, per-URL scan history, dismissals) so the
 * content world never has to await storage; and download the exported report.
 *
 * All storage is chrome.storage.local. Nothing is synced or sent anywhere.
 *
 * The AI layer lives here too, because Chrome's `LanguageModel` (Gemini Nano,
 * on-device) is exposed to extension contexts but NOT to content scripts. The
 * content script posts its scan result to GEO_AI_ENHANCE and merges the reply.
 */
'use strict';

// Chrome's built-in Prompt API runs on-device, so loading this keeps the
// extension's "no network" guarantee intact. importScripts is top-level and
// synchronous, as MV3 classic service workers require.
importScripts('ai/engine.js');

// Injection order matters: highlighter (owns the namespace + palette) → util →
// settings → profiles → rules → fixers → quotables → chunks → report → panel →
// scanner (calls everything).
const CONTENT_FILES = [
  'content/highlighter.js',
  'content/util.js',
  'content/settings.js',
  'content/profiles.js',
  'content/rules/extractability.js',
  'content/rules/structure.js',
  'content/rules/entity.js',
  'content/rules/citability.js',
  'content/fixers.js',
  'content/ai-bridge.js',
  'content/quotables.js',
  'content/chunks.js',
  'report/report-template.js',
  'content/panel.js',
  'content/scanner.js',
];

const MAX_RECENT = 10;
const MAX_HISTORY_PER_URL = 20;
const MAX_HISTORY_URLS = 60;

// Mirror of content/settings.js DEFAULT_SETTINGS. A service worker cannot
// import the content-world file, so the two are kept in step by hand and the
// acceptance harness asserts they match.
const DEFAULT_SETTINGS = {
  longParagraphWords: 120,
  answerSentenceWords: 35,
  questionHeadingRatio: 0.30,
  tocMinWords: 1500,
  maxHighlights: 60,
  chunkTokens: 500,
  quotableCount: 5,
  deductions: { High: 15, Medium: 8, Low: 3 },
  branding: { agency: '', client: '', accent: '#4F46E5' },
  profile: 'auto',
  ai: true,
};

const RESTRICTED = /^(chrome|edge|brave|about|view-source|chrome-extension|moz-extension|devtools|data):|^https?:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i;

// ---- url keys -------------------------------------------------------------
function pageKey(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch (e) { return url || ''; }
}

function hostKey(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch (e) { return ''; }
}

// ---- storage helpers ------------------------------------------------------
async function get(key, fallback) {
  try {
    const data = await chrome.storage.local.get(key);
    return data && key in data ? data[key] : fallback;
  } catch (e) { return fallback; }
}

async function set(key, value) {
  try { await chrome.storage.local.set({ [key]: value }); return true; }
  catch (e) { return false; }
}

async function getSettings() {
  const saved = await get('settings', {});
  const out = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    const d = DEFAULT_SETTINGS[k];
    if (d && typeof d === 'object' && !Array.isArray(d)) out[k] = Object.assign({}, d, saved[k] || {});
    else out[k] = saved[k] != null ? saved[k] : d;
  });
  return out;
}

// ---- messaging ------------------------------------------------------------
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;
  const tabId = msg.tabId != null ? msg.tabId : (sender.tab ? sender.tab.id : null);

  switch (msg.type) {
    case 'GEO_SCAN':
      handleScan(tabId).then(sendResponse);
      return true;
    case 'GEO_RESCAN':
      handleScan(tabId).then(sendResponse);
      return true;
    case 'GEO_DOWNLOAD':
      handleDownload(msg).then(sendResponse);
      return true;
    case 'GEO_GET_RECENT':
      handleGetRecent(msg.url).then(sendResponse);
      return true;
    case 'GEO_GET_SETTINGS':
      getSettings().then(function (s) { sendResponse({ settings: s, defaults: DEFAULT_SETTINGS }); });
      return true;
    case 'GEO_SET_SETTINGS':
      set('settings', msg.settings || {}).then(function (ok) { sendResponse({ ok: ok }); });
      return true;
    case 'GEO_DISMISS_ISSUE':
      dismissIssue(msg.url, msg.fingerprint).then(sendResponse);
      return true;
    case 'GEO_DISMISS_RULE':
      dismissRule(msg.url, msg.ruleId).then(sendResponse);
      return true;
    case 'GEO_GET_DISMISSALS':
      getDismissals(msg.url).then(sendResponse);
      return true;
    case 'GEO_CLEAR_DISMISSALS':
      clearDismissals().then(function () { sendResponse({ ok: true }); });
      return true;
    case 'GEO_GET_HISTORY':
      getHistoryFor(msg.url).then(function (h) { sendResponse({ history: h }); });
      return true;
    case 'GEO_AI_ENHANCE':
      handleAiEnhance(msg.payload, tabId).then(sendResponse);
      return true;
    case 'GEO_AI_STATUS':
      aiStatus().then(sendResponse);
      return true;
    default:
      return;
  }
});

// ---- scan -----------------------------------------------------------------
async function handleScan(tabId) {
  if (tabId == null) return { ok: false, error: 'No active tab.' };
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url && RESTRICTED.test(tab.url)) {
      return { ok: false, error: 'Chrome blocks extensions on this page.' };
    }

    const url = (tab && tab.url) || '';
    const [settings, dismissals, history] = await Promise.all([
      getSettings(),
      getDismissals(url),
      getHistoryFor(url),
    ]);

    await chrome.scripting.executeScript({ target: { tabId: tabId }, files: CONTENT_FILES });

    const opts = {
      settings: settings,
      dismissedRules: dismissals.rules,
      dismissedIssues: dismissals.issues,
      previous: history.length ? history[0] : null,
    };

    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function (o) { return window.__GEOLens.run(o); },
      args: [opts],
    });

    const summary = results && results[0] ? results[0].result : null;
    if (summary && !summary.noContent) {
      await storeResult(summary);
      await pushHistory(summary);
    }
    return { ok: true, summary: summary };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// ---- download -------------------------------------------------------------
async function handleDownload(msg) {
  try {
    const mime = msg.mime || 'text/html';
    const url = 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(msg.html);
    await chrome.downloads.download({
      url: url,
      filename: msg.filename || 'geo-lens-report.html',
      saveAs: false,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// ---- recent (popup list) --------------------------------------------------
async function handleGetRecent(url) {
  const recent = await get('recent', []);
  const list = Array.isArray(recent) ? recent : [];
  const current = url ? (list.find(function (r) { return r.url === url; }) || null) : null;
  return { recent: list, current: current };
}

async function storeResult(s) {
  let recent = await get('recent', []);
  if (!Array.isArray(recent)) recent = [];
  recent = recent.filter(function (r) { return r.url !== s.url; });
  recent.unshift({
    url: s.url,
    title: s.title,
    score: s.score,
    grade: s.grade,
    issueCount: s.issueCount,
    profile: s.profile,
    delta: s.delta ? s.delta.scoreDelta : null,
    timestamp: s.timestamp,
  });
  await set('recent', recent.slice(0, MAX_RECENT));
}

// ---- revision history -----------------------------------------------------
// Keyed by origin+pathname so query strings and fragments do not fragment a
// page's timeline. Each entry carries its issue fingerprints so the next scan
// can say exactly which issues were fixed.
async function getHistoryFor(url) {
  const all = await get('history', {});
  const list = all && all[pageKey(url)];
  return Array.isArray(list) ? list : [];
}

async function pushHistory(s) {
  const all = (await get('history', {})) || {};
  const key = pageKey(s.url);
  const list = Array.isArray(all[key]) ? all[key] : [];

  list.unshift({
    timestamp: s.timestamp,
    score: s.score,
    grade: s.grade,
    categories: s.categories,
    issueCount: s.issueCount,
    profile: s.profile,
    wordCount: s.wordCount,
    fingerprints: s.fingerprints || [],
  });
  all[key] = list.slice(0, MAX_HISTORY_PER_URL);

  // Bound total storage: drop the least-recently-scanned pages.
  const keys = Object.keys(all);
  if (keys.length > MAX_HISTORY_URLS) {
    keys
      .sort(function (a, b) {
        const ta = all[a][0] ? all[a][0].timestamp : 0;
        const tb = all[b][0] ? all[b][0].timestamp : 0;
        return tb - ta;
      })
      .slice(MAX_HISTORY_URLS)
      .forEach(function (k) { delete all[k]; });
  }
  await set('history', all);
}

// ---- dismissals -----------------------------------------------------------
async function getDismissals(url) {
  const rulesAll = (await get('dismissedRules', {})) || {};
  const issuesAll = (await get('dismissedIssues', {})) || {};
  return {
    rules: rulesAll[hostKey(url)] || [],
    issues: issuesAll[pageKey(url)] || [],
  };
}

async function dismissIssue(url, fingerprint) {
  if (!fingerprint) return { ok: false };
  const all = (await get('dismissedIssues', {})) || {};
  const key = pageKey(url);
  const list = Array.isArray(all[key]) ? all[key] : [];
  if (list.indexOf(fingerprint) === -1) list.push(fingerprint);
  all[key] = list;
  await set('dismissedIssues', all);
  return { ok: true };
}

async function dismissRule(url, ruleId) {
  if (!ruleId) return { ok: false };
  const all = (await get('dismissedRules', {})) || {};
  const key = hostKey(url);
  const list = Array.isArray(all[key]) ? all[key] : [];
  if (list.indexOf(ruleId) === -1) list.push(ruleId);
  all[key] = list;
  await set('dismissedRules', all);
  return { ok: true };
}

async function clearDismissals() {
  await set('dismissedRules', {});
  await set('dismissedIssues', {});
}

// ---- AI ------------------------------------------------------------------
async function aiStatus() {
  const state = await self.GEO_AI.availability(true);
  return { state: state, supported: self.GEO_AI.has() };
}

async function handleAiEnhance(payload, tabId) {
  try {
    const settings = await getSettings();
    if (settings.ai === false) {
      return { available: false, state: 'off', rewrites: {}, insights: [] };
    }
    // Report the model's first-run download to the panel so a 2GB fetch is
    // never a silent stall.
    const onProgress = function (loaded) {
      if (tabId == null) return;
      try {
        chrome.tabs.sendMessage(tabId, {
          type: 'GEO_AI_PROGRESS',
          loaded: loaded,
        });
      } catch (e) { /* panel closed */ }
    };
    return await self.GEO_AI.enhance(payload, onProgress);
  } catch (e) {
    return {
      available: false,
      state: 'error',
      error: String(e && e.message ? e.message : e),
      rewrites: {},
      insights: [],
    };
  }
}

// ---- entry points: toolbar shortcut + context menu + first run ------------
async function scanActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) await handleScan(tabs[0].id);
  } catch (e) { /* nothing actionable without a tab */ }
}

chrome.commands.onCommand.addListener(function (command) {
  if (command === 'scan-page') scanActiveTab();
});

chrome.runtime.onInstalled.addListener(function (details) {
  try {
    chrome.contextMenus.create({
      id: 'geo-lens-scan',
      title: 'Scan this page with GEO Lens',
      contexts: ['page', 'selection'],
    });
  } catch (e) { /* menu already exists on update */ }

  if (details && details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/welcome.html') });
  }
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId === 'geo-lens-scan' && tab) handleScan(tab.id);
});
