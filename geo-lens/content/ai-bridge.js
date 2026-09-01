/*
 * ai-bridge.js — content-side half of the intelligence layer.
 *
 * The model runs in the service worker (content scripts cannot reach
 * `LanguageModel`), so this file does three things: build a compact,
 * serializable job list from the scan result, post it, and merge the reply back
 * into the live result before asking the panel to re-render.
 *
 * The scan NEVER waits on this. run() renders the deterministic result
 * immediately and the enhancement lands a moment later — a first-run model
 * download can take minutes, and a blank panel for that long would be worse
 * than no AI at all.
 *
 * Attaches window.__GEOLens.aiBridge.
 */
(function () {
  'use strict';
  const NS = (window.__GEOLens = window.__GEOLens || {});
  if (NS.aiBridge) return;

  const ARTICLE_CHARS = 4000;
  const MAX_VERIFY = 4;      // semantic answer checks per scan
  const PASSAGE_CHARS = 1200;

  // Rewrite kinds worth handing to the model. The others (splitParagraph,
  // hoistDefinition, unhedge, enumerationToList, comparisonTable, toc,
  // replaceVague, citeClaim) are exact mechanical transforms — the
  // deterministic fixer is already correct and a model could only degrade it.
  const AI_KINDS = { directAnswer: 1, tldr: 1, nameEntity: 1, questionHeadings: 1 };

  function clip(text, max) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
  }

  function buildJobs(result, ctx) {
    const U = NS.util;
    const jobs = [];
    const nodes = {};

    // 1) Issues whose deterministic output is only a skeleton.
    result.issues.forEach(function (iss) {
      const data = iss.rewriteData;
      if (!data || !AI_KINDS[data.kind]) return;
      const job = { id: iss.id, kind: data.kind };
      if (data.kind === 'directAnswer') {
        job.heading = data.heading;
        job.passage = clip(data.paragraph, PASSAGE_CHARS);
      } else if (data.kind === 'tldr') {
        job.heading = data.title;
        job.sections = data.sections || [];
        job.passage = clip(data.paragraph, PASSAGE_CHARS);
      } else if (data.kind === 'nameEntity') {
        job.heading = data.entity;
        job.passage = clip(data.paragraph, PASSAGE_CHARS);
      } else if (data.kind === 'questionHeadings') {
        job.sections = data.headings || [];
        job.passage = '';
      }
      jobs.push(job);
      nodes[iss.id] = iss.node;
    });

    // 2) Semantic answer verification.
    //
    // This is the check a regex fundamentally cannot make. The deterministic
    // rule fires on a first sentence over 35 words or a filler opener — it
    // measures shape, not meaning. A crisp 18-word sentence that talks around
    // the question sails through it. So every question heading gets checked,
    // including the ones the heuristic already passed.
    let verified = 0;
    for (let i = 0; i < ctx.headings.length && verified < MAX_VERIFY; i++) {
      const h = ctx.headings[i];
      if (h.level !== 2 && h.level !== 3) continue;
      if (!U.isQuestionHeading(h.text)) continue;
      const p = U.firstParagraphAfter(h.el, ctx.root);
      if (!p) continue;
      const ref = 'verify-' + i;
      jobs.push({
        id: ref,
        kind: 'verifyAnswer',
        heading: h.text,
        passage: clip(U.textOf(p), PASSAGE_CHARS),
        nodeRef: ref,
      });
      nodes[ref] = p;
      verified++;
    }

    return { jobs: jobs, nodes: nodes };
  }

  function buildPayload(result, ctx) {
    const built = buildJobs(result, ctx);
    return {
      payload: {
        title: result.title,
        url: result.url,
        entity: result.primaryEntity,
        profile: result.profile.id,
        articleText: clip(ctx.plainText, ARTICLE_CHARS),
        sections: ctx.headings
          .filter(function (h) { return h.level === 2 || h.level === 3; })
          .slice(0, 15)
          .map(function (h) { return h.text; }),
        jobs: built.jobs,
      },
      nodes: built.nodes,
    };
  }

  // Merge the worker's reply into the live result object.
  function merge(result, reply, nodes) {
    result.ai = {
      available: !!reply.available,
      state: reply.state || 'unknown',
      error: reply.error || null,
      stats: reply.stats || null,
      insights: [],
    };
    if (!reply.available) return result;

    let replaced = 0;
    const rw = reply.rewrites || {};
    result.issues.forEach(function (iss) {
      const better = rw[iss.id];
      if (!better || !better.text) return;
      iss.deterministicRewrite = iss.rewrite; // keep the fallback visible
      iss.rewrite = better;
      replaced++;
    });
    result.ai.replaced = replaced;

    (reply.insights || []).forEach(function (ins) {
      const item = Object.assign({}, ins);
      if (ins.nodeRef && nodes[ins.nodeRef]) item.node = nodes[ins.nodeRef];
      result.ai.insights.push(item);
    });
    return result;
  }

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

  // Fire-and-forget: render already happened, this repaints when it lands.
  function request(result, ctx) {
    const built = buildPayload(result, ctx);
    if (!built.payload.jobs.length) return;

    if (NS.panel && NS.panel.setAiState) NS.panel.setAiState('working');

    send({ type: 'GEO_AI_ENHANCE', payload: built.payload }).then(function (reply) {
      if (!reply) {
        if (NS.panel && NS.panel.setAiState) NS.panel.setAiState('unavailable');
        return;
      }
      // A scan that finished after this one owns the panel now.
      if (NS.lastResult !== result) return;
      merge(result, reply, built.nodes);
      if (NS.panel && NS.panel.refresh) NS.panel.refresh(result);
    });
  }

  // Download progress from the worker, so a first-run model fetch is visible.
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (!msg || msg.type !== 'GEO_AI_PROGRESS') return;
      if (NS.panel && NS.panel.setAiState) {
        NS.panel.setAiState('downloading', msg.loaded);
      }
    });
  } catch (e) { /* messaging unavailable; AI simply never reports */ }

  NS.aiBridge = { request: request, buildPayload: buildPayload, merge: merge, AI_KINDS: AI_KINDS };
})();
