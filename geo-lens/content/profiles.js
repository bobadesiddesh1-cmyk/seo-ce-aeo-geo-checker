/*
 * profiles.js — content-type profiles.
 *
 * A product page, a docs page and a long-form article should not be graded by
 * the same rubric: scoring a spec sheet for "walls of text" or a reference doc
 * for "first-hand experience" produces false positives, and false positives are
 * what make an auditing tool untrustworthy. Each profile names the rules that
 * do not apply to it and reweights the four categories.
 *
 * detect(ctx) -> profile object. Attaches window.__GEOLens.profiles.
 */
(function () {
  'use strict';
  const NS = (window.__GEOLens = window.__GEOLens || {});
  if (NS.profiles) return;

  const PROFILES = {
    article: {
      id: 'article',
      label: 'Article',
      note: 'Long-form editorial content — the full rubric applies.',
      disabled: [],
      weights: { extractability: 0.30, structure: 0.20, entity: 0.20, citability: 0.30 },
    },
    product: {
      id: 'product',
      label: 'Product page',
      note: 'Commercial page — jump links and question headings are not expected; sourcing and comparison tables matter more.',
      disabled: ['structure.noToc', 'structure.questionHeadingRatio', 'extractability.buriedDefinition'],
      weights: { extractability: 0.25, structure: 0.20, entity: 0.25, citability: 0.30 },
    },
    docs: {
      id: 'docs',
      label: 'Documentation',
      note: 'Reference material — first-hand experience and outbound citations are not expected; structure and extractability dominate.',
      disabled: ['entity.noFirstPersonExperience', 'citability.noOutboundLinks', 'structure.noComparisonTable'],
      weights: { extractability: 0.35, structure: 0.30, entity: 0.10, citability: 0.25 },
    },
    homepage: {
      id: 'homepage',
      label: 'Homepage',
      note: 'Navigational page — prose-density rules are relaxed; entity clarity and structure carry the score.',
      disabled: ['extractability.longParagraph', 'extractability.buriedDefinition', 'structure.noToc', 'entity.noFirstPersonExperience', 'citability.fewQuotableSentences'],
      weights: { extractability: 0.30, structure: 0.30, entity: 0.20, citability: 0.20 },
    },
  };

  // Deliberately excludes "guide" and "tutorial": they are among the most
  // common blog-post slugs ("/blog/beginners-guide"), and treating every one
  // as documentation would silently disable the outbound-citation and
  // comparison-table rules on ordinary articles.
  const DOC_PATH_RE = /\/(docs?|documentation|reference|api|manual|handbook|kb|knowledge-?base)(\/|$)/i;
  const PRODUCT_PATH_RE = /\/(product|products|shop|store|item|p|pricing|plans|buy)(\/|$)/i;

  function typeSetHas(ctx, names) {
    if (!ctx.jsonLd || !ctx.jsonLd.typeSet) return false;
    for (let i = 0; i < names.length; i++) {
      if (ctx.jsonLd.typeSet.has(names[i])) return true;
    }
    return false;
  }

  function isHomepage(ctx) {
    let path = '/';
    try { path = new URL(ctx.url).pathname || '/'; } catch (e) { /* keep default */ }
    return path === '/' || path === '/index.html';
  }

  // Ordered strongest-signal-first: explicit structured data, then URL shape,
  // then DOM heuristics. Returns { profile, reason }.
  function detect(ctx) {
    if (typeSetHas(ctx, ['product', 'offer', 'aggregateoffer'])) {
      return { profile: PROFILES.product, reason: 'Product schema found' };
    }
    if (typeSetHas(ctx, ['techarticle', 'apireference', 'softwaresourcecode'])) {
      return { profile: PROFILES.docs, reason: 'TechArticle/APIReference schema found' };
    }
    if (isHomepage(ctx)) {
      return { profile: PROFILES.homepage, reason: 'Root URL' };
    }
    let path = '';
    try { path = new URL(ctx.url).pathname || ''; } catch (e) { /* keep default */ }
    if (DOC_PATH_RE.test(path)) return { profile: PROFILES.docs, reason: 'Documentation URL path' };
    if (PRODUCT_PATH_RE.test(path)) return { profile: PROFILES.product, reason: 'Product URL path' };

    // DOM fallbacks: a price + buy control reads as commercial; a docs sidebar
    // with many same-origin jump links reads as reference material.
    const priceish = ctx.doc.querySelector('[itemprop="price"], [class*="price" i], [data-price]');
    const buyish = ctx.doc.querySelector('[class*="add-to-cart" i], [id*="add-to-cart" i], button[name*="add" i]');
    if (priceish && buyish) return { profile: PROFILES.product, reason: 'Price and add-to-cart controls' };

    if (typeSetHas(ctx, ['article', 'blogposting', 'newsarticle'])) {
      return { profile: PROFILES.article, reason: 'Article schema found' };
    }
    return { profile: PROFILES.article, reason: 'Default' };
  }

  function resolve(ctx, settings) {
    const chosen = settings && settings.profile;
    if (chosen && chosen !== 'auto' && PROFILES[chosen]) {
      return { profile: PROFILES[chosen], reason: 'Set manually in options' };
    }
    return detect(ctx);
  }

  NS.profiles = { PROFILES: PROFILES, detect: detect, resolve: resolve };
})();
