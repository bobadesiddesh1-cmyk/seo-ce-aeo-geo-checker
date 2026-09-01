# Acceptance harness

`harness.js` loads the **real** content scripts into jsdom in the same order the
service worker injects them, and runs the full pipeline end to end — extraction,
profile detection, rules, dismissals, scoring, rewrite generation, quotables,
retrieval chunking, panel render and report export.

```sh
cd geo-lens/test
npm install jsdom
node harness.js
```

Exit code is non-zero if any check fails.

`jsdom` is a dev-only dependency of this harness. The extension itself has no
dependencies and no build step.
