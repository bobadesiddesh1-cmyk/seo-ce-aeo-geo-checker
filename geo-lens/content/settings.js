/*
 * settings.js — the single source of truth for every tunable threshold, plus
 * the report branding. DEFAULTS is shared by the content world, the options
 * page and the service worker (which re-declares it via importing this file is
 * not possible in MV3, so background.js keeps a mirrored copy — the mirror is
 * asserted by the harness test).
 *
 * The service worker loads the user's saved overrides and passes the merged
 * object into run(), so nothing in the content world has to await storage.
 * Attaches window.__GEOLens.DEFAULT_SETTINGS / .mergeSettings().
 */
(function () {
  'use strict';
  const NS = (window.__GEOLens = window.__GEOLens || {});
  if (NS.DEFAULT_SETTINGS) return;

  const DEFAULT_SETTINGS = {
    // Rule thresholds.
    longParagraphWords: 120,
    answerSentenceWords: 35,
    questionHeadingRatio: 0.30,
    tocMinWords: 1500,
    // Scan behaviour.
    maxHighlights: 60,
    chunkTokens: 500,
    quotableCount: 5,
    // Scoring.
    deductions: { High: 15, Medium: 8, Low: 3 },
    // Report branding (white-label).
    branding: { agency: '', client: '', accent: '#4F46E5' },
    // Content-type profile: 'auto' or an explicit profile id.
    profile: 'auto',
  };

  function mergeSettings(saved) {
    const out = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
      const d = DEFAULT_SETTINGS[k];
      if (d && typeof d === 'object' && !Array.isArray(d)) {
        out[k] = Object.assign({}, d, (saved && saved[k]) || {});
      } else {
        out[k] = saved && saved[k] != null ? saved[k] : d;
      }
    });
    return out;
  }

  NS.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  NS.mergeSettings = mergeSettings;
})();
