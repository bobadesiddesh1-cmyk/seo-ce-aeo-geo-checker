/* geo-lens/test/harness.js — acceptance harness.
 *
 * Run with:  cd geo-lens/test && npm install jsdom && node harness.js
 *
 * Original note: loads the REAL content scripts into jsdom and runs the
   full pipeline, exactly as chrome.scripting.executeScript would. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

const FILES = [
  'content/highlighter.js', 'content/util.js', 'content/settings.js',
  'content/profiles.js', 'content/rules/extractability.js',
  'content/rules/structure.js', 'content/rules/entity.js',
  'content/rules/citability.js', 'content/fixers.js', 'content/quotables.js',
  'content/chunks.js', 'report/report-template.js', 'content/panel.js',
  'content/scanner.js',
];

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

function makeWindow(html, url) {
  const dom = new JSDOM(html, { url: url || 'https://example.com/blog/guide', pretendToBeVisual: true });
  const w = dom.window;
  w.chrome = {
    runtime: { getURL: (p) => 'chrome-extension://test/' + p, sendMessage: () => {} },
  };
  // Panel styles are fetched; make it resolve to the real stylesheet.
  w.fetch = () => Promise.resolve({
    ok: true, text: () => Promise.resolve(fs.readFileSync(path.join(ROOT, 'content/panel.css'), 'utf8')),
  });
  if (!w.CSSStyleSheet.prototype.replaceSync) {
    w.CSSStyleSheet.prototype.replaceSync = function () {};
  }
  return { dom, w };
}

function load(w) {
  const ctx = vm.createContext(w);
  FILES.forEach((f) => {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  });
}

function scan(html, url, opts) {
  const { dom, w } = makeWindow(html, url);
  load(w);
  const summary = w.__GEOLens.run(opts || {});
  return { w, dom, summary, result: w.__GEOLens.lastResult };
}

// ---------------------------------------------------------------- fixtures
const LONG_PARA = Array.from({ length: 14 }, (_, i) =>
  `Sentence number ${i + 1} adds another clause about the migration process and its many downstream consequences for the team.`).join(' ');

const ARTICLE = `<!doctype html><html lang="en"><head><title>Database Migration Guide</title></head><body>
<nav><a href="/">Home</a></nav>
<article>
  <h1>Database Migration Guide</h1>
  <p>In today's fast-moving world of engineering, there are many considerations that teams weigh carefully before they finally commit to any migration effort at all.</p>
  <h2>What is a database migration?</h2>
  <p>When it comes to migrations, the topic is broad and covers a great many different scenarios that all deserve careful handling. A database migration is a controlled change to a schema. It could be argued that planning matters most.</p>
  <h2>Migration benefits</h2>
  <p>${LONG_PARA}</p>
  <h2>Postgres vs MySQL</h2>
  <p>Teams pick between engines for reasons including cost, tooling, replication, extensions, and community support.</p>
  <p>Many teams report significantly faster queries after the move, according to research from several vendors.</p>
  <h3>Rollback</h3>
  <p>It reduces risk by 30% in our experience.</p>
</article></body></html>`;

const CLEAN = `<!doctype html><html lang="en"><head><title>What is DNS?</title></head><body>
<main>
  <h1>What is DNS?</h1>
  <p>DNS is the system that turns a domain name into an IP address. It was standardised in 1983.</p>
  <h2>How does DNS resolution work?</h2>
  <p>A resolver queries 4 server types in order. DNS caching cuts lookup time to 20 milliseconds.</p>
  <p>See the <a href="https://www.rfc-editor.org/rfc/rfc1035">RFC 1035 specification</a> for the wire format.</p>
  <h2>Why does DNS matter?</h2>
  <p>DNS failures take down 8% of monitored sites each year. DNS is a single point of failure.</p>
  <table><tr><th>Record</th><th>Use</th></tr><tr><td>A</td><td>IPv4</td></tr></table>
</main></body></html>`;

const PRODUCT = `<!doctype html><html lang="en"><head><title>Acme Widget</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Acme Widget"}</script>
</head><body><main>
<h1>Acme Widget</h1>
<p>${LONG_PARA}</p>
<h2>Specifications</h2><p>The Acme Widget weighs 2kg.</p>
</main></body></html>`;

console.log('\n=== 1. Article scan: full pipeline ===');
{
  const { summary, result, w } = scan(ARTICLE);
  check('returns a score', typeof summary.score === 'number', 'got ' + summary.score);
  check('has a grade', /^[A-F]$/.test(summary.grade), summary.grade);
  check('found issues', summary.issueCount > 0, String(summary.issueCount));
  check('schema category is GONE', !('schema' in result.scoring.categories),
        Object.keys(result.scoring.categories).join(','));
  check('exactly 4 categories', Object.keys(result.scoring.categories).length === 4);
  check('detected Article profile', result.profile.id === 'article', result.profile.id);
  check('every issue has a ruleId', result.issues.every(i => !!i.ruleId));
  check('every issue has a fingerprint', result.issues.every(i => /:/.test(i.fingerprint)));
  check('weights sum to 1.0', Math.abs(Object.values(result.profile.weights).reduce((a,b)=>a+b,0) - 1) < 1e-9);

  const rules = new Set(result.issues.map(i => i.ruleId));
  check('no H1 rule fires (moved to Sidekick)', ![...rules].some(r => /h1|hierarchy/i.test(r)));
  check('flags the wall of text', rules.has('extractability.longParagraph'));
  check('flags the missing opening summary', rules.has('extractability.noOpeningSummary'));
  check('flags an unanswered question heading', rules.has('extractability.unansweredQuestion'));
  check('flags the hedge', rules.has('citability.hedgedClaim'));
  check('flags a vague quantifier', rules.has('citability.vagueQuantifier'));
  check('flags the missing comparison table', rules.has('structure.noComparisonTable'));

  const withRewrite = result.issues.filter(i => i.rewrite);
  check('generated rewrites', withRewrite.length > 0, withRewrite.length + ' of ' + result.issues.length);
  check('every rewrite has text', withRewrite.every(r => r.rewrite.text && r.rewrite.text.length > 3));
  check('every rewrite has a label', withRewrite.every(r => !!r.rewrite.label));
  check('rewrite formats are valid',
        withRewrite.every(r => ['text','html','markdown'].includes(r.rewrite.format)));

  // Named transforms
  const split = result.issues.find(i => i.ruleId === 'extractability.longParagraph');
  check('paragraph split produced multiple blocks',
        split && split.rewrite && split.rewrite.text.split('\n\n').length >= 2);
  const hedge = result.issues.find(i => i.ruleId === 'citability.hedgedClaim');
  check('unhedge stripped the hedge prefix',
        hedge && hedge.rewrite && !/could be argued/i.test(hedge.rewrite.text), hedge && hedge.rewrite && hedge.rewrite.text);
  const table = result.issues.find(i => i.ruleId === 'structure.noComparisonTable');
  check('comparison table names both options',
        table && /Postgres/i.test(table.rewrite.text) && /MySQL/i.test(table.rewrite.text),
        table && table.rewrite.text.slice(0,120));
  const enumIss = result.issues.find(i => i.ruleId === 'structure.proseEnumeration');
  check('enumeration became <ul>', enumIss && /<ul>/.test(enumIss.rewrite.text));
  check('enumeration produced >=3 <li>', enumIss && (enumIss.rewrite.text.match(/<li>/g)||[]).length >= 3);

  check('score breakdown recorded', !!result.scoring.breakdown.extractability);
  check('quotables ran', Array.isArray(result.quotables.candidates));
  check('retrieval chunks built', result.retrieval.chunks.length > 0, String(result.retrieval.chunks.length));
  check('chunks carry token estimates', result.retrieval.chunks.every(c => c.tokens > 0));
  check('panel rendered', !!w.document.getElementById('geo-lens-panel-host'));
  check('highlights drawn', w.document.querySelectorAll('[data-geo-hl]').length > 0);
}

console.log('\n=== 2. Byte-for-byte DOM restoration ===');
{
  const { w } = (() => {
    const { dom, w } = makeWindow(ARTICLE);
    load(w);
    return { w };
  })();
  const before = w.document.querySelector('article').innerHTML;
  w.__GEOLens.run({});
  const during = w.document.querySelector('article').innerHTML;
  w.__GEOLens.highlighter.clearAll();
  const after = w.document.querySelector('article').innerHTML;
  check('highlighting mutated the DOM', before !== during);
  check('clearAll restored it byte-for-byte', before === after);
}

console.log('\n=== 3. Well-optimised page does not over-flag ===');
{
  const { summary, result } = scan(CLEAN, 'https://example.com/dns');
  check('scores high', summary.score >= 70, String(summary.score));
  check('few issues', summary.issueCount <= 4, String(summary.issueCount));
  check('finds quotable passages', result.quotables.candidates.length >= 1,
        String(result.quotables.candidates.length));
  check('quotables ranked descending',
        result.quotables.candidates.every((c,i,a) => i===0 || a[i-1].score >= c.score));
}

console.log('\n=== 4. Content-type profiles ===');
{
  const { result } = scan(PRODUCT, 'https://shop.example.com/products/widget');
  check('detects Product from schema', result.profile.id === 'product', result.profile.id);
  check('profile suppressed rules', result.suppressed.profile >= 0);
  const rules = new Set(result.issues.map(i => i.ruleId));
  check('TOC rule suppressed on product', !rules.has('structure.noToc'));
  check('question-heading rule suppressed on product', !rules.has('structure.questionHeadingRatio'));

  const home = scan(CLEAN, 'https://example.com/');
  check('detects Homepage at root', home.result.profile.id === 'homepage', home.result.profile.id);
  const docs = scan(CLEAN, 'https://example.com/docs/dns');
  check('detects Docs from URL path', docs.result.profile.id === 'docs', docs.result.profile.id);
  check('docs profile drops outbound-link rule',
        !new Set(docs.result.issues.map(i=>i.ruleId)).has('citability.noOutboundLinks'));
}

console.log('\n=== 5. Dismissals ===');
{
  const base = scan(ARTICLE);
  const target = base.result.issues[0];
  const byRule = scan(ARTICLE, undefined, { dismissedRules: [target.ruleId] });
  check('dismissed rule is suppressed',
        !byRule.result.issues.some(i => i.ruleId === target.ruleId));
  check('suppression counted', byRule.result.suppressed.rule > 0);
  const byIssue = scan(ARTICLE, undefined, { dismissedIssues: [target.fingerprint] });
  check('dismissed fingerprint is suppressed',
        !byIssue.result.issues.some(i => i.fingerprint === target.fingerprint));
  check('fingerprints are stable across scans',
        base.result.issues[0].fingerprint === scan(ARTICLE).result.issues[0].fingerprint);
}

console.log('\n=== 6. Revision delta ===');
{
  const first = scan(ARTICLE);
  const prev = {
    score: first.summary.score - 20, grade: 'D', timestamp: Date.now() - 86400000,
    fingerprints: first.summary.fingerprints.concat(['extractability.gone:zzz']),
  };
  const second = scan(ARTICLE, undefined, { previous: prev });
  check('delta computed', !!second.result.delta);
  check('score delta correct', second.result.delta.scoreDelta === 20, String(second.result.delta.scoreDelta));
  check('counts the fixed issue', second.result.delta.fixedCount === 1,
        String(second.result.delta.fixedCount));
  check('no delta on first ever scan', scan(ARTICLE).result.delta === null);
}

console.log('\n=== 7. Custom settings are honoured ===');
{
  const strict = scan(ARTICLE, undefined, { settings: { longParagraphWords: 20 } });
  const loose  = scan(ARTICLE, undefined, { settings: { longParagraphWords: 5000 } });
  const nStrict = strict.result.issues.filter(i => i.ruleId === 'extractability.longParagraph').length;
  const nLoose  = loose.result.issues.filter(i => i.ruleId === 'extractability.longParagraph').length;
  check('lower threshold flags more paragraphs', nStrict > nLoose, nStrict + ' vs ' + nLoose);
  const dedu = scan(ARTICLE, undefined, { settings: { deductions: { High: 1, Medium: 1, Low: 1 } } });
  check('custom deductions raise the score', dedu.summary.score > scan(ARTICLE).summary.score);
  const cap = scan(ARTICLE, undefined, { settings: { maxHighlights: 1 } });
  check('highlight cap honoured', cap.summary.highlightedCount <= 1, String(cap.summary.highlightedCount));
  const forced = scan(ARTICLE, undefined, { settings: { profile: 'docs' } });
  check('manual profile override wins', forced.result.profile.id === 'docs');
}

console.log('\n=== 8. Language guard ===');
{
  const de = scan(ARTICLE.replace('lang="en"', 'lang="de-DE"'));
  check('non-English detected', de.result.language.english === false, de.result.language.lang);
  const en = scan(ARTICLE);
  check('English passes', en.result.language.english === true);
  const none = scan(ARTICLE.replace(' lang="en"', ''));
  check('undeclared lang is not warned about', none.result.language.declared === false);
}

console.log('\n=== 9. Orphan chunk detection ===');
{
  const orphaned = `<!doctype html><html lang="en"><head><title>Widget Report</title></head><body><main>
   <h1>Widget Report</h1>
   <p>The Widget shipped in March 2024 to 12 markets across three continents, and adoption has been tracked closely by the operations team since launch day.</p>
   <h2>Results</h2>
   <p>It reduced costs by 30% across the board, which exceeded the original internal target that had been agreed at the start of the programme.</p>
   <p>They also reported faster onboarding times overall, with the median new-account setup dropping from several hours to well under one hour.</p>
   </main></body></html>`;
  const { result } = scan(orphaned);
  check('chunks produced', result.retrieval.chunks.length > 0);
  check('orphan count is a number', typeof result.retrieval.orphanCount === 'number');
  check('orphans carry reasons',
        result.retrieval.chunks.filter(c=>c.orphan).every(c => c.reasons.length > 0));
}

console.log('\n=== 9b. Primary-entity detection ===');
{
  const page = (title) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main>
    <h1>${title}</h1>
    <p>An opening paragraph that runs long enough to clear the two hundred character minimum the content extractor enforces before it will treat a block as real article content worth auditing at all.</p>
    <p>A second paragraph so the page has enough substance to be scanned properly by the rules.</p>
    </main></body></html>`;
  const entityOf = (title) => scan(page(title), 'https://example.com/blog/x').result.primaryEntity;

  check('acronym beats leading gerund', entityOf('Choosing a CDN') === 'CDN', entityOf('Choosing a CDN'));
  check('acronym beats question words', entityOf('What is DNS?') === 'DNS', entityOf('What is DNS?'));
  check('picks the proper noun', entityOf('Acme Widget') === 'Widget', entityOf('Acme Widget'));
  check('ignores stock title words', ['Migration','Database'].includes(entityOf('The Complete Guide to Database Migration')),
        entityOf('The Complete Guide to Database Migration'));
  check('short acronym survives', entityOf('Understanding AI Search') === 'AI', entityOf('Understanding AI Search'));
  check('never empty on a normal title', entityOf('Postgres Replication') !== '');
}

console.log('\n=== 10. Report export ===');
{
  const { w, result } = scan(ARTICLE);
  const html = w.__GEOLens.buildReport(result);
  check('is a full document', html.startsWith('<!doctype html>'));
  check('contains the score', html.includes(String(result.scoring.overall)));
  check('contains rewrites section', html.includes('Issues, fixes'));
  check('contains quotable section', html.includes('Most citable passages'));
  check('contains retrieval section', html.includes('Retrieval preview'));
  check('no unescaped script tag from page text', !/<script(?![^>]*application\/ld)/i.test(html));
  check('report is substantial', html.length > 8000, html.length + ' bytes');

  const branded = w.__GEOLens.buildReport(Object.assign({}, result, {
    branding: { agency: 'Acme SEO', client: 'Globex', accent: '#FF0000' },
  }));
  check('agency name appears', branded.includes('Acme SEO'));
  check('client name appears', branded.includes('Globex'));
  check('accent colour applied', branded.includes('#FF0000'));
  const evil = w.__GEOLens.buildReport(Object.assign({}, result, {
    branding: { agency: '<img onerror=alert(1)>', client: '', accent: 'javascript:alert(1)' },
  }));
  check('branding is HTML-escaped', !evil.includes('<img onerror'));
  check('bad accent colour rejected', !evil.includes('javascript:alert'));
}

console.log('\n=== 11. Edge cases ===');
{
  const empty = scan('<!doctype html><html lang="en"><body></body></html>');
  check('empty page reports noContent', empty.summary.noContent === true);
  check('no highlights on empty page',
        empty.w.document.querySelectorAll('[data-geo-hl]').length === 0);

  const { w } = (() => { const { w } = makeWindow(ARTICLE); load(w); return { w }; })();
  w.__GEOLens.run({});
  const firstCount = w.document.querySelectorAll('[data-geo-hl]').length;
  w.__GEOLens.run({});
  const secondCount = w.document.querySelectorAll('[data-geo-hl]').length;
  check('re-scan is idempotent (no highlight pile-up)', firstCount === secondCount,
        firstCount + ' then ' + secondCount);

  const noH1 = scan(ARTICLE.replace(/<h1>.*?<\/h1>/, ''));
  check('page without H1 still scans', typeof noH1.summary.score === 'number');
}

console.log('\n=== 12. Settings mirror (content vs service worker) ===');
{
  const contentSrc = fs.readFileSync(path.join(ROOT, 'content/settings.js'), 'utf8');
  const bgSrc = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const grab = (src) => {
    const m = src.match(/DEFAULT_SETTINGS = \{([\s\S]*?)\n\s*\};/);
    if (!m) return null;
    return m[1].split('\n')
      .map(l => l.replace(/\/\/.*$/, '').trim())
      .filter(l => /^[a-zA-Z]/.test(l))
      .map(l => l.split(':')[0].trim()).sort();
  };
  const a = grab(contentSrc), b = grab(bgSrc);
  check('both files declare DEFAULT_SETTINGS', !!a && !!b);
  check('keys match exactly', JSON.stringify(a) === JSON.stringify(b),
        '\n      content: ' + JSON.stringify(a) + '\n      worker:  ' + JSON.stringify(b));
}

console.log('\n=== 13. Injection list matches disk ===');
{
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const listed = (bg.match(/'((?:content|report)\/[^']+\.js)'/g) || []).map(s => s.replace(/'/g, ''));
  check('background lists every harness file', FILES.every(f => listed.includes(f)),
        'missing: ' + FILES.filter(f => !listed.includes(f)).join(','));
  check('every listed file exists on disk',
        listed.every(f => fs.existsSync(path.join(ROOT, f))),
        'missing: ' + listed.filter(f => !fs.existsSync(path.join(ROOT, f))).join(','));
  check('deleted schema rule is not referenced', !bg.includes('rules/schema.js'));
  check('schema.js is gone from disk', !fs.existsSync(path.join(ROOT, 'content/rules/schema.js')));
}

console.log('\n' + '='.repeat(52));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(52) + '\n');
process.exit(fail ? 1 : 0);
