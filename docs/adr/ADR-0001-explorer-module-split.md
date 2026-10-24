# ADR-0001: Split the explorer into ES modules with no bundler

Status: proposed · 24 October 2026 · Spec: PE-01, PE-08, PE-28

## Context

The spatial study panel is a single 83-line file, `assets/viewer.js`. Long, dense lines mix the renderer, the fallback rig, avatar loading, controls and failure handling. The next features are presets, joint inspection, provenance labelling, context restore and pose estimates. Each would grow that file. Its pure logic (rotation maths, label strings, schema checks) cannot be tested without a browser.

The site is static GitHub Pages, and it has a binding rule against a frontend build step or bundler (README). Three.js 0.186.1 is vendored and resolved through an import map in `index.html`, and import maps do not exist under Node.

## Decision

- Split the viewer into plain ES modules under `assets/explorer/`: `main.js` (composition root), plus `scene.js`, `rig.js`, `controls.js` and `poses.js` (DOM), plus `retarget.js`, `pose-schema.js`, `provenance.js` and `presets.js` (pure). Browsers load them natively and nothing transforms them.
- Pure modules never touch the DOM. They import three.js maths only through the relative path `../vendor/three.core.js`, so they run unchanged under `node --test`. That is the same URL `three.module.js` imports, so the browser holds one three.js instance.
- `assets/viewer.js` stays as a one-line shim (`import './explorer/main.js';`). `site.js`'s dynamic import and `tools/check-site.mjs` keep working without edits.
- A root `package.json` containing only `{"private": true, "type": "module"}` tells Node that `.js` files are ESM. It has no dependencies and no scripts, so it is not a build: nothing is generated, and the deployed bytes are the authored bytes.
- The first slice (S1) changes structure only, and parity criteria PE-01 to PE-09 must pass before and after it.

## Consequences

- Each module is small and has one job. Pure modules get fast `node:test` coverage with no browser.
- Seven or eight extra HTTP requests on first load, served same-origin and cached. They are acceptable within the 48 KiB budget (PE-28); HTTP/2 on Pages multiplexes them.
- Adding a module means adding an `import` line and nothing else. There is no bundler config to drift.
- Contributors must keep pure modules free of `three` bare imports. A node static check enforces this.
