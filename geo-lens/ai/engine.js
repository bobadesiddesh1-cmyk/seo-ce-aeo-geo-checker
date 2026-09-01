/*
 * ai/engine.js — the intelligence layer, running on Chrome's built-in
 * Prompt API (Gemini Nano, on-device).
 *
 * WHY THE SERVICE WORKER: `LanguageModel` is exposed to extension contexts
 * (service worker, popup, side panel) but NOT to content scripts. The content
 * script therefore posts its scan result here and gets enhancements back.
 *
 * WHY ON-DEVICE: the model ships with Chrome and runs locally. No API key, no
 * account, and — critically for this extension — no network request. The "100%
 * local, nothing leaves your browser" promise survives the addition of AI,
 * which a hosted model would have broken.
 *
 * GROUNDING IS THE WHOLE GAME. This tool's output gets pasted onto real client
 * pages. A plausible invented statistic is far worse than no rewrite at all, so
 * every generation is constrained three ways:
 *   1. The system prompt forbids introducing any fact not in the passage.
 *   2. Output is schema-constrained via `responseConstraint`.
 *   3. `groundingViolation()` rejects any rewrite that introduces a number,
 *      percentage or currency figure the source text did not contain.
 * A rejected generation falls back to the deterministic fixer. Silence beats
 * fabrication.
 *
 * Loaded into background.js via importScripts(). Attaches self.GEO_AI.
 */
'use strict';

(function () {
  const SYSTEM_PROMPT =
    'You are an editor improving web content so AI answer engines can quote it accurately. ' +
    'You rewrite for clarity and directness. ' +
    'CRITICAL RULE: use only facts that appear in the text you are given. ' +
    'Never invent statistics, dates, prices, percentages, company names, or study citations. ' +
    'If a specific figure would be needed and the text does not supply one, write the placeholder ' +
    '[specific figure] instead of guessing. Keep the original meaning exactly. Reply with the ' +
    'requested output only, no preamble and no explanation.';

  // Total generations per scan. Gemini Nano is small and on-device; an
  // unbounded pass over a long article would take minutes and exhaust context.
  const MAX_GENERATIONS = 14;
  const PASSAGE_CHARS = 1200;   // per-passage cap sent to the model
  const ARTICLE_CHARS = 4000;   // document-level cap for whole-page prompts

  let cachedAvailability = null;

  function has() {
    return typeof LanguageModel !== 'undefined' && LanguageModel !== null;
  }

  // ---- availability -------------------------------------------------------
  // "readily" | "after-download" | "downloading" | "unavailable", plus our own
  // "unsupported" for a Chrome without the API at all.
  async function availability(force) {
    if (!has()) return 'unsupported';
    if (cachedAvailability && !force) return cachedAvailability;
    try {
      cachedAvailability = await LanguageModel.availability();
    } catch (e) {
      cachedAvailability = 'unavailable';
    }
    return cachedAvailability;
  }

  async function createSession(onProgress) {
    const opts = {
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
    };
    // temperature and topK must be supplied together or not at all. Low
    // temperature: this is editing, not creative writing.
    try {
      const params = await LanguageModel.params();
      if (params && params.defaultTopK != null) {
        opts.temperature = 0.2;
        opts.topK = Math.min(3, params.maxTopK || 3);
      }
    } catch (e) { /* fall back to model defaults */ }

    if (typeof onProgress === 'function') {
      opts.monitor = function (m) {
        m.addEventListener('downloadprogress', function (e) {
          try { onProgress(e.loaded); } catch (err) { /* reporting only */ }
        });
      };
    }
    return LanguageModel.create(opts);
  }

  // ---- grounding ----------------------------------------------------------
  function numbersIn(text) {
    const out = new Set();
    const re = /\d+(?:[.,]\d+)*\s*%?/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
      out.add(m[0].replace(/\s+/g, '').replace(/,/g, ''));
    }
    return out;
  }

  // True when `generated` asserts a figure absent from `source`. Bracketed
  // placeholders are allowed through — they are the model correctly declining
  // to guess.
  function groundingViolation(generated, source) {
    const stripped = String(generated || '').replace(/\[[^\]]*\]/g, '');
    const src = numbersIn(source);
    const gen = numbersIn(stripped);
    for (const n of gen) {
      if (!src.has(n)) return n;
    }
    return null;
  }

  function clip(text, max) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
  }

  // ---- one guarded generation --------------------------------------------
  async function generate(session, prompt, schema, source, signal) {
    const opts = {};
    if (schema) opts.responseConstraint = schema;
    if (signal) opts.signal = signal;

    let raw;
    try {
      raw = await session.prompt(prompt, opts);
    } catch (e) {
      return { ok: false, reason: 'error', detail: String(e && e.message ? e.message : e) };
    }

    let value = raw;
    if (schema) {
      try { value = JSON.parse(raw); }
      catch (e) { return { ok: false, reason: 'unparseable' }; }
    }

    if (source) {
      const probe = typeof value === 'string' ? value : JSON.stringify(value);
      const bad = groundingViolation(probe, source);
      if (bad) return { ok: false, reason: 'ungrounded', detail: bad };
    }
    return { ok: true, value: value };
  }

  // ---- schemas ------------------------------------------------------------
  const S_TEXT = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };

  const S_ANSWERED = {
    type: 'object',
    properties: {
      answered: { type: 'boolean' },
      why: { type: 'string' },
    },
    required: ['answered', 'why'],
  };

  const S_HEADINGS = {
    type: 'object',
    properties: {
      rewrites: {
        type: 'array',
        items: {
          type: 'object',
          properties: { before: { type: 'string' }, after: { type: 'string' } },
          required: ['before', 'after'],
        },
      },
    },
    required: ['rewrites'],
  };

  const S_CLAIMS = {
    type: 'object',
    properties: {
      claims: {
        type: 'array',
        items: {
          type: 'object',
          properties: { quote: { type: 'string' }, missing: { type: 'string' } },
          required: ['quote', 'missing'],
        },
      },
    },
    required: ['claims'],
  };

  const S_QUESTIONS = {
    type: 'object',
    properties: {
      questions: { type: 'array', items: { type: 'string' } },
    },
    required: ['questions'],
  };

  // ---- the enhancement pass ----------------------------------------------
  /*
   * payload = {
   *   title, url, entity, profile,
   *   articleText,                       // trimmed main content
   *   jobs: [{ id, kind, heading, passage, sections }]
   * }
   * Returns { available, state, rewrites: {id: {...}}, insights: [...], stats }
   */
  async function enhance(payload, onProgress, signal) {
    const state = await availability();
    if (state !== 'readily' && state !== 'after-download') {
      return { available: false, state: state, rewrites: {}, insights: [], stats: null };
    }

    let session;
    try {
      session = await createSession(onProgress);
    } catch (e) {
      return {
        available: false,
        state: 'unavailable',
        error: String(e && e.message ? e.message : e),
        rewrites: {},
        insights: [],
      };
    }

    const rewrites = {};
    const insights = [];
    const stats = { attempted: 0, accepted: 0, ungrounded: 0, failed: 0 };
    let budget = MAX_GENERATIONS;

    function record(res) {
      stats.attempted++;
      if (res.ok) stats.accepted++;
      else if (res.reason === 'ungrounded') stats.ungrounded++;
      else stats.failed++;
    }

    try {
      const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];

      // ---- 1. per-issue rewrites, replacing the deterministic skeletons
      for (let i = 0; i < jobs.length && budget > 0; i++) {
        const job = jobs[i];
        const passage = clip(job.passage, PASSAGE_CHARS);
        let res = null;
        let label = '';

        if (job.kind === 'directAnswer') {
          budget--;
          res = await generate(
            session,
            'Heading: "' + clip(job.heading, 200) + '"\n\n' +
            'Passage:\n' + passage + '\n\n' +
            'Write a direct answer to the heading in one or two sentences, at most 30 words total, ' +
            'using only information stated in the passage. Start with the answer itself, not with ' +
            'context or filler. Return JSON {"text": "..."}.',
            S_TEXT, passage, signal
          );
          label = 'Direct answer, written from this passage';
        } else if (job.kind === 'tldr') {
          budget--;
          res = await generate(
            session,
            'Article title: "' + clip(payload.title, 200) + '"\n\n' +
            'Article:\n' + clip(payload.articleText, ARTICLE_CHARS) + '\n\n' +
            'Write a TL;DR for the top of this article: one sentence answering its core question, ' +
            'then up to four bullet points. Use only facts stated in the article. ' +
            'Format as markdown. Return JSON {"text": "..."}.',
            S_TEXT, payload.articleText, signal
          );
          label = 'TL;DR, written from this article';
        } else if (job.kind === 'nameEntity') {
          budget--;
          res = await generate(
            session,
            'Subject: "' + clip(job.heading || payload.entity, 120) + '"\n\n' +
            'Opening paragraph:\n' + passage + '\n\n' +
            'Rewrite the FIRST sentence only so it names "' + clip(job.heading || payload.entity, 120) +
            '" explicitly and states what it is, using only information from the paragraph. ' +
            'Keep it under 25 words. Return JSON {"text": "..."}.',
            S_TEXT, passage, signal
          );
          label = 'Opening sentence naming the subject';
        } else if (job.kind === 'questionHeadings') {
          budget--;
          const list = (job.sections || []).slice(0, 5);
          res = await generate(
            session,
            'Article topic: "' + clip(payload.title, 200) + '"\n\n' +
            'Headings:\n' + list.map(function (h, n) { return (n + 1) + '. ' + h; }).join('\n') + '\n\n' +
            'Rewrite each heading as the natural question a reader would type into a search engine. ' +
            'Keep the same topic and specificity. Return JSON ' +
            '{"rewrites":[{"before":"...","after":"..."}]}.',
            S_HEADINGS, null, signal
          );
          label = 'Question-heading rewrites';
        }

        if (!res) continue;
        record(res);
        if (!res.ok) continue;

        if (job.kind === 'questionHeadings') {
          const lines = (res.value.rewrites || [])
            .filter(function (r) { return r.before && r.after; })
            .map(function (r) { return r.before + '  →  ' + r.after; });
          if (lines.length) {
            rewrites[job.id] = { label: label, format: 'text', text: lines.join('\n'), ai: true };
          }
        } else if (res.value && res.value.text && res.value.text.trim()) {
          rewrites[job.id] = { label: label, format: job.kind === 'tldr' ? 'markdown' : 'text', text: res.value.text.trim(), ai: true };
        }
      }

      // ---- 2. semantic answer check — a rule regex cannot express
      // The deterministic rule only measures sentence LENGTH. A short, fluent
      // paragraph that never actually answers its heading passes it. This asks
      // whether the question is genuinely answered.
      const qJobs = jobs.filter(function (j) { return j.kind === 'verifyAnswer'; });
      for (let i = 0; i < qJobs.length && budget > 0; i++) {
        const job = qJobs[i];
        budget--;
        const passage = clip(job.passage, PASSAGE_CHARS);
        const res = await generate(
          session,
          'Heading (a question): "' + clip(job.heading, 200) + '"\n\n' +
          'The passage beneath it:\n' + passage + '\n\n' +
          'Does this passage actually answer that question for a reader who reads nothing else? ' +
          'Answer strictly. Return JSON {"answered": true|false, "why": "one short sentence"}.',
          S_ANSWERED, null, signal
        );
        record(res);
        if (res.ok && res.value.answered === false) {
          insights.push({
            kind: 'unanswered',
            heading: job.heading,
            detail: String(res.value.why || '').trim(),
            nodeRef: job.nodeRef,
          });
        }
      }

      // ---- 3. unsupported claims
      if (budget > 0) {
        budget--;
        const res = await generate(
          session,
          'Article:\n' + clip(payload.articleText, ARTICLE_CHARS) + '\n\n' +
          'Find up to 3 statements this article asserts as fact but never supports anywhere in it — ' +
          'no source, no data, no reasoning. Quote each one exactly as written. ' +
          'If every claim is supported, return an empty array. ' +
          'Return JSON {"claims":[{"quote":"...","missing":"what evidence is missing"}]}.',
          S_CLAIMS, null, signal
        );
        record(res);
        if (res.ok) {
          (res.value.claims || []).slice(0, 3).forEach(function (c) {
            if (!c.quote || !String(c.quote).trim()) return;
            insights.push({
              kind: 'unsupported',
              quote: String(c.quote).trim(),
              detail: String(c.missing || '').trim(),
            });
          });
        }
      }

      // ---- 4. reader question gaps — needs world knowledge of the topic
      if (budget > 0) {
        budget--;
        const res = await generate(
          session,
          'Article title: "' + clip(payload.title, 200) + '"\n\n' +
          'Section headings:\n' + (payload.sections || []).slice(0, 15).join('\n') + '\n\n' +
          'Someone searching this topic arrives with questions. Name up to 4 important ones this ' +
          'article does NOT appear to answer. Be specific to the topic, not generic. ' +
          'Return JSON {"questions":["..."]}.',
          S_QUESTIONS, null, signal
        );
        record(res);
        if (res.ok) {
          (res.value.questions || []).slice(0, 4).forEach(function (q) {
            if (!q || !String(q).trim()) return;
            insights.push({ kind: 'gap', question: String(q).trim() });
          });
        }
      }
    } finally {
      try { await session.destroy(); } catch (e) { /* already gone */ }
    }

    return { available: true, state: state, rewrites: rewrites, insights: insights, stats: stats };
  }

  self.GEO_AI = {
    has: has,
    availability: availability,
    enhance: enhance,
    groundingViolation: groundingViolation,
    MAX_GENERATIONS: MAX_GENERATIONS,
  };
})();
