/* popup.js — scan trigger, last-score display, recent-scan history. */
'use strict';

const GRADE_COLOR = { A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444' };
const RESTRICTED = /^(chrome|edge|brave|about|view-source|chrome-extension|moz-extension|devtools|data):|^https?:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i;

const els = {
  scanBtn: document.getElementById('scanBtn'),
  status: document.getElementById('status'),
  current: document.getElementById('current'),
  ring: document.getElementById('ring'),
  ringGrade: document.getElementById('ringGrade'),
  ringScore: document.getElementById('ringScore'),
  currentTitle: document.getElementById('currentTitle'),
  currentWhen: document.getElementById('currentWhen'),
  recentList: document.getElementById('recentList'),
  recentEmpty: document.getElementById('recentEmpty'),
  currentBadges: document.getElementById('currentBadges'),
  openOptions: document.getElementById('openOptions'),
};

let activeTab = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  activeTab = await getActiveTab();
  const url = activeTab && activeTab.url ? activeTab.url : '';

  if (!activeTab || RESTRICTED.test(url)) {
    els.scanBtn.disabled = true;
    setStatus('This page can’t be scanned. Open a normal web page (http/https) and try again.', 'error');
  }

  els.scanBtn.addEventListener('click', doScan);
  els.openOptions.addEventListener('click', function (e) {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });

  const data = await sendMessage({ type: 'GEO_GET_RECENT', url: url });
  if (data) {
    renderCurrent(data.current);
    renderRecent(data.recent || []);
  }
}

function getActiveTab() {
  return new Promise(function (resolve) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

function sendMessage(msg) {
  return new Promise(function (resolve) {
    try {
      chrome.runtime.sendMessage(msg, function (resp) {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(resp);
      });
    } catch (e) { resolve(null); }
  });
}

async function doScan() {
  if (!activeTab) return;
  els.scanBtn.disabled = true;
  els.scanBtn.textContent = 'Scanning…';
  setStatus('Analysing the page locally…', '');

  const resp = await sendMessage({ type: 'GEO_SCAN', tabId: activeTab.id });

  els.scanBtn.textContent = 'Scan this page';
  els.scanBtn.disabled = false;

  if (!resp || !resp.ok) {
    const err = resp && resp.error ? resp.error : 'Unknown error';
    setStatus('Could not scan this page. ' + friendlyError(err), 'error');
    return;
  }
  const s = resp.summary;
  if (!s) { setStatus('No result returned.', 'error'); return; }
  if (s.noContent) {
    setStatus('No article content detected on this page.', 'error');
    renderCurrent(null);
    return;
  }
  const bits = [s.issueCount + ' issue' + (s.issueCount === 1 ? '' : 's')];
  if (s.quotableCount != null) bits.push(s.quotableCount + ' quotable');
  if (s.orphanCount) bits.push(s.orphanCount + ' orphan chunk' + (s.orphanCount === 1 ? '' : 's'));
  setStatus('Scan complete — ' + bits.join(', ') + '. See the panel on the page.', 'ok');
  renderCurrent(s);
  const data = await sendMessage({ type: 'GEO_GET_RECENT', url: activeTab.url });
  if (data) renderRecent(data.recent || []);
}

function friendlyError(err) {
  if (/Cannot access|Missing host permission|extension manifest|chrome:\/\/|blocked/i.test(err)) {
    return 'Chrome blocks extensions on this page.';
  }
  return err;
}

function setStatus(text, kind) {
  els.status.textContent = text;
  els.status.className = 'status' + (kind ? ' ' + kind : '');
  els.status.classList.remove('hidden');
}

function renderCurrent(s) {
  if (!s || s.score == null) { els.current.classList.add('hidden'); return; }
  const color = GRADE_COLOR[s.grade] || '#4F46E5';
  els.ring.style.background = 'conic-gradient(' + color + ' ' + (s.score * 3.6) + 'deg, var(--bg-elev2) 0deg)';
  els.ringGrade.textContent = s.grade;
  els.ringScore.textContent = s.score + '/100';
  els.currentTitle.textContent = s.title || s.url || '';
  els.currentWhen.textContent = relTime(s.timestamp);
  renderBadges(s);
  els.current.classList.remove('hidden');
}

function renderBadges(s) {
  els.currentBadges.textContent = '';
  if (s.profileLabel || s.profile) {
    els.currentBadges.appendChild(badge('profile', s.profileLabel || s.profile));
  }
  const d = s.delta ? s.delta.scoreDelta : (typeof s.delta === 'number' ? s.delta : null);
  if (d != null && d !== 0) {
    els.currentBadges.appendChild(badge(d > 0 ? 'up' : 'down', (d > 0 ? '+' : '') + d + ' vs last scan'));
  }
}

function badge(kind, text) {
  const b = document.createElement('span');
  b.className = 'badge ' + kind;
  b.textContent = text;
  return b;
}

function renderRecent(list) {
  els.recentList.textContent = '';
  if (!list.length) { els.recentEmpty.classList.remove('hidden'); return; }
  els.recentEmpty.classList.add('hidden');
  list.forEach(function (r) {
    const li = document.createElement('li');
    li.className = 'recent-item';

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.style.background = GRADE_COLOR[r.grade] || '#4F46E5';
    badge.textContent = r.grade || '?';
    li.appendChild(badge);

    const info = document.createElement('div');
    info.className = 'recent-info';
    const t = document.createElement('div');
    t.className = 'r-title';
    t.textContent = r.title || hostOf(r.url);
    const u = document.createElement('div');
    u.className = 'r-url';
    u.textContent = hostOf(r.url) + ' · ' + relTime(r.timestamp);
    info.appendChild(t);
    info.appendChild(u);
    li.appendChild(info);

    const sc = document.createElement('span');
    sc.className = 'recent-score';
    sc.textContent = (r.score != null ? r.score : '–') + '/100';
    li.appendChild(sc);

    li.title = r.url || '';
    li.addEventListener('click', function () {
      if (r.url) chrome.tabs.create({ url: r.url });
    });
    els.recentList.appendChild(li);
  });
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url || ''; }
}

function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.round(h / 24);
  if (d < 30) return d + 'd ago';
  try { return new Date(ts).toLocaleDateString(); } catch (e) { return ''; }
}
