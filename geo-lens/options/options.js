/* options.js — reads and writes the settings the service worker hands to every
   scan. Percentages are shown as whole numbers and stored as fractions. */
'use strict';

const NUMBER_FIELDS = [
  'longParagraphWords',
  'answerSentenceWords',
  'tocMinWords',
  'maxHighlights',
  'chunkTokens',
  'quotableCount',
];

let defaults = null;

function $(id) { return document.getElementById(id); }

function send(msg) {
  return new Promise(function (resolve) {
    try {
      chrome.runtime.sendMessage(msg, function (resp) {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(resp);
      });
    } catch (e) { resolve(null); }
  });
}

function fill(settings) {
  NUMBER_FIELDS.forEach(function (k) { $(k).value = settings[k]; });
  $('questionHeadingRatio').value = Math.round((settings.questionHeadingRatio || 0) * 100);
  $('profile').value = settings.profile || 'auto';
  $('dedHigh').value = settings.deductions.High;
  $('dedMedium').value = settings.deductions.Medium;
  $('dedLow').value = settings.deductions.Low;
  $('agency').value = settings.branding.agency || '';
  $('client').value = settings.branding.client || '';
  $('accent').value = settings.branding.accent || '#4F46E5';
}

function clampInt(el, fallback) {
  const n = parseInt(el.value, 10);
  if (!isFinite(n)) return fallback;
  const min = parseInt(el.min, 10);
  const max = parseInt(el.max, 10);
  return Math.min(isFinite(max) ? max : n, Math.max(isFinite(min) ? min : n, n));
}

function collect() {
  const out = { deductions: {}, branding: {} };
  NUMBER_FIELDS.forEach(function (k) { out[k] = clampInt($(k), defaults[k]); });
  out.questionHeadingRatio = clampInt($('questionHeadingRatio'), 30) / 100;
  out.profile = $('profile').value;
  out.deductions.High = clampInt($('dedHigh'), defaults.deductions.High);
  out.deductions.Medium = clampInt($('dedMedium'), defaults.deductions.Medium);
  out.deductions.Low = clampInt($('dedLow'), defaults.deductions.Low);
  out.branding.agency = $('agency').value.trim();
  out.branding.client = $('client').value.trim();
  out.branding.accent = $('accent').value || '#4F46E5';
  return out;
}

function status(text, kind) {
  const s = $('status');
  s.textContent = text;
  s.className = 'status' + (kind ? ' ' + kind : '');
  if (text) setTimeout(function () { s.textContent = ''; s.className = 'status'; }, 2600);
}

async function loadDismissSummary() {
  const rules = await new Promise(function (res) {
    chrome.storage.local.get(['dismissedRules', 'dismissedIssues'], function (d) { res(d || {}); });
  });
  let ruleCount = 0;
  let siteCount = 0;
  let issueCount = 0;
  Object.keys(rules.dismissedRules || {}).forEach(function (host) {
    const list = rules.dismissedRules[host] || [];
    if (list.length) { siteCount++; ruleCount += list.length; }
  });
  Object.keys(rules.dismissedIssues || {}).forEach(function (page) {
    issueCount += (rules.dismissedIssues[page] || []).length;
  });
  $('dismissSummary').textContent =
    (ruleCount || issueCount)
      ? ruleCount + ' rule' + (ruleCount === 1 ? '' : 's') + ' ignored across ' + siteCount +
        ' site' + (siteCount === 1 ? '' : 's') + ', and ' + issueCount +
        ' individual issue' + (issueCount === 1 ? '' : 's') + ' dismissed.'
      : 'Nothing dismissed yet.';
}

async function init() {
  const resp = await send({ type: 'GEO_GET_SETTINGS' });
  if (!resp) { status('Could not load settings.', 'err'); return; }
  defaults = resp.defaults;
  fill(resp.settings);
  loadDismissSummary();

  $('save').addEventListener('click', async function () {
    const ok = await send({ type: 'GEO_SET_SETTINGS', settings: collect() });
    status(ok && ok.ok ? 'Saved. Re-scan a page to apply.' : 'Could not save.', ok && ok.ok ? 'ok' : 'err');
  });

  $('reset').addEventListener('click', async function () {
    fill(defaults);
    const ok = await send({ type: 'GEO_SET_SETTINGS', settings: collect() });
    status(ok && ok.ok ? 'Reset to defaults.' : 'Could not save.', ok && ok.ok ? 'ok' : 'err');
  });

  $('clearDismissals').addEventListener('click', async function () {
    await send({ type: 'GEO_CLEAR_DISMISSALS' });
    loadDismissSummary();
    status('All dismissals cleared.', 'ok');
  });
}

document.addEventListener('DOMContentLoaded', init);
