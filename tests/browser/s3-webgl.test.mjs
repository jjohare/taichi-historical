// Slice S3, browser half: PE-22 (context loss and restore), PE-23 (no restore), PE-24 (no WebGL: still fallback),
// PE-25 (360 px viewport, 44 px targets) and the 'failed' half of PE-56 (a loss mid-transition with no restore).
// Every wait is a bounded poll on page state; the only intentional waits are the 5 s restore window of PE-23.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import {browserTest, cdpSkipReason, openPage, withExplorer, SITE_URL} from '../helpers/cdp.mjs';
import {serveS6, openS6Page, settled, go, firstImage, FIRST_ID, ELBOW, angleOf} from '../helpers/s6.mjs';

const INTERRUPTED = 'The 3D view was interrupted. Trying to restore it…';
const FAILED = 'The 3D view could not be restored. Reload the page to try again; the image archive is unaffected.';
const UNAVAILABLE = '3D view unavailable in this browser. This still image shows the neutral illustrative avatar, not the selected position.';
const STILL_LABEL = 'ILLUSTRATIVE AVATAR · STILL IMAGE';

// Page-side helpers (strings, evaluated in the page).
const LOSE = `(() => { const c = document.querySelector('#model-view canvas'); const gl = c.getContext('webgl2'); window.__lose = gl.getExtension('WEBGL_lose_context'); window.__lose.loseContext(); })()`;
const RESTORE = `window.__lose.restoreContext()`;
const shown = selector => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); return !!e && e.checkVisibility(); })()`;
const text = id => `document.getElementById('${id}').textContent`;
const NO_WEBGL_STUB = `(() => { const real = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /^(experimental-)?webgl2?$/.test(type) ? null : real.call(this, type, ...rest); }; })();`;
const snapshot = page => page.evaluate(`(() => { const s = __explorer.state; return {camera: s.cameraPosition, bones: s.bones, label: s.label, renderCount: s.renderCount}; })()`);
const errorsOf = page => [...page.consoleErrors, ...page.logErrors, ...page.exceptions];

/** The controls PE-24 hides, as selectors; each must be absent or not rendered on the still path. */
const HIDDEN_ON_STILL = ['.preset-group', '.model-controls', '#joint-select', '#joint-readout', '#elbow-angle', '#stance-angle', '#avatar-controls', '#show-neutral', '#pose-file'];

// ---------------------------------------------------------------------------------------------------- PE-22
browserTest('PE-22 loseContext() shows the interrupted text with state.renderer "lost"; restoreContext() hides it within 2 s and keeps camera, bones and label', () =>
  withExplorer({}, async page => {
    // Make the pre-loss state non-trivial: a non-default preset, so "state is kept" means more than "returned to defaults".
    await page.evaluate(`document.getElementById('preset-front').click()`);
    await page.waitFor(`__explorer.state.camera.preset === 'front'`, {what: 'front preset'});
    const before = await snapshot(page);
    await page.evaluate(LOSE);
    await page.waitFor(`__explorer.state.renderer === 'lost'`, {what: 'renderer "lost"', timeout: 4000});
    assert.equal(await page.evaluate(shown('#model-status')), true, '#model-status is visible');
    assert.equal(await page.evaluate(text('model-status')), INTERRUPTED);
    await page.evaluate(RESTORE);
    await page.waitFor(`__explorer.state.renderer === 'webgl'`, {what: 'renderer "webgl" after restore', timeout: 2000});
    await page.waitFor(`!document.getElementById('model-status').checkVisibility()`, {what: 'status hidden', timeout: 2000});
    await page.waitFor(`__explorer.state.renderCount > ${before.renderCount}`, {what: 'renderCount to rise', timeout: 2000});
    const after = await snapshot(page);
    assert.deepEqual(after.camera, before.camera, 'camera position');
    assert.deepEqual(after.bones, before.bones, 'bone snapshot');
    assert.equal(after.label, before.label, 'model label');
    assert.deepEqual(errorsOf(page), []);
  }));

browserTest('PE-22 the page cancels the lost event: a restore is possible at all (no restore is attempted by the test until after "lost")', () =>
  withExplorer({}, async page => {
    // If webglcontextlost were not preventDefault()ed, restoreContext() would be a no-op and the renderer would stay lost.
    await page.evaluate(LOSE);
    await page.waitFor(`__explorer.state.renderer === 'lost'`, {what: 'lost'});
    await page.evaluate(RESTORE);
    await page.waitFor(`__explorer.state.renderer === 'webgl'`, {what: 'restored', timeout: 2000});
  }));

// ---------------------------------------------------------------------------------------------------- PE-23
browserTest('PE-23 with no restore, after 5.5 s state.renderer is "failed", #model-still shows, the text matches and the camera controls are hidden', () =>
  withExplorer({}, async page => {
    await page.evaluate(LOSE);
    await page.waitFor(`__explorer.state.renderer === 'lost'`, {what: 'lost', timeout: 4000});
    const lostAt = Date.now();
    await page.quiet(4500);
    assert.equal(await page.evaluate(`__explorer.state.renderer`), 'lost', 'still waiting for a restore at 4.5 s');
    await page.waitFor(`__explorer.state.renderer === 'failed'`, {what: 'renderer "failed"', timeout: 5000});
    assert.ok(Date.now() - lostAt >= 4800, 'the page waited out its restore window before giving up');
    assert.equal(await page.evaluate(shown('#model-still')), true, '#model-still is visible');
    assert.equal(await page.evaluate(text('model-status')), FAILED);
    assert.equal(await page.evaluate(shown('#model-status')), true);
    for (const selector of ['.preset-group', '.model-controls']) assert.equal(await page.evaluate(shown(selector)), false, `${selector} is hidden`);
  }));

// ---------------------------------------------------------------------------------------------------- PE-24
async function openStill({query, init}) {
  const page = await openPage();
  try {
    if (init) await page.send('Page.addScriptToEvaluateOnNewDocument', {source: init});
    await page.navigate(`${SITE_URL}${query}`);
    await page.waitFor(`(() => { const i = document.getElementById('model-still'); return !!i && i.complete && i.naturalWidth > 0; })()`, {what: '#model-still loaded'});
    return page;
  } catch (error) { await page.close(); throw error; }
}
/** The design (state machine, section 6) names the state 'still'; the spec's PE-24 row does not, so this is its own test. */
const rendererOf = page => page.evaluate(`window.__explorer ? __explorer.state.renderer : null`);
const stillRoutes = [
  ['?explorer-test=no-webgl', 'the ?explorer-test=no-webgl route', {query: '?explorer-test=no-webgl'}],
  ['getContext stub', 'an init script that makes getContext return null for webgl and webgl2', {query: '?explorer-test=1', init: NO_WEBGL_STUB}],
];
for (const [, how, options] of stillRoutes) {
  browserTest(`PE-24 no WebGL via ${how}: the still loads, the texts and label match, the listed controls are hidden, zero console errors`, async () => {
    const page = await openStill(options);
    try {
      await page.quiet(500);
      assert.equal(await page.evaluate(shown('#model-still')), true);
      assert.ok(await page.evaluate(`document.getElementById('model-still').naturalWidth`) > 0);
      assert.match(await page.evaluate(`document.getElementById('model-still').getAttribute('src')`), /(^|\/)assets\/model\/avatar-neutral\.png$/);
      assert.match(await page.evaluate(`document.getElementById('model-still').alt`), /neutral.*illustrative.*avatar|illustrative.*neutral.*avatar/i, 'alt says it is the neutral illustrative avatar');
      assert.equal(await page.evaluate(text('model-status')), UNAVAILABLE);
      assert.equal(await page.evaluate(text('model-label')), STILL_LABEL);
      for (const selector of HIDDEN_ON_STILL) assert.equal(await page.evaluate(shown(selector)), false, `${selector} is hidden`);
      assert.deepEqual(errorsOf(page), [], 'zero console errors');
    } finally { await page.close(); }
  });

  browserTest(`PE-24 no WebGL via ${how}: the hook (when installed) reports state.renderer "still" (design §6)`, async () => {
    const page = await openStill(options);
    try { assert.equal(await rendererOf(page), 'still'); } finally { await page.close(); }
  });

  browserTest(`PE-24 no WebGL via ${how}: the catalogue still navigates (#move=13 updates #move-title)`, async () => {
    const page = await openStill(options);
    try {
      await page.evaluate(`location.hash = 'move=2'`);
      await page.waitFor(`document.getElementById('move-title').textContent.trim() !== ''`, {what: 'a title for move 2'});
      const first = await page.evaluate(text('move-title'));
      await page.evaluate(`location.hash = 'move=13'`);
      await page.waitFor(`document.getElementById('move-title').textContent !== ${JSON.stringify(first)}`, {what: 'the title to change for move 13'});
      assert.notEqual((await page.evaluate(text('move-title'))).trim(), '');
      assert.deepEqual(errorsOf(page), [], 'zero console errors');
    } finally { await page.close(); }
  });
}

browserTest('PE-24 a normal load never requests avatar-neutral.png and creates no #model-still', () =>
  withExplorer({}, async page => {
    await page.quiet(500);
    assert.deepEqual(page.requests.filter(u => u.includes('avatar-neutral.png')), []);
    assert.equal(await page.evaluate(`document.getElementById('model-still')`), null);
  }));

// ---------------------------------------------------------------------------------------------------- PE-25
browserTest('PE-25 at 360 × 740 nothing overflows horizontally', () =>
  withExplorer({}, async page => {
    await page.send('Emulation.setDeviceMetricsOverride', {width: 360, height: 740, deviceScaleFactor: 1, mobile: false});
    await page.waitFor(`innerWidth === 360`, {what: 'the viewport to be 360 px wide'});
    const {scroll, inner} = await page.evaluate(`({scroll: document.documentElement.scrollWidth, inner: innerWidth})`);
    assert.ok(scroll <= inner, `scrollWidth ${scroll} > innerWidth ${inner}`);
  }));

browserTest('PE-25 at 360 × 740 every visible button, input, select and standalone link in .model-panel is at least 44 × 44', () =>
  withExplorer({}, async page => {
    await page.send('Emulation.setDeviceMetricsOverride', {width: 360, height: 740, deviceScaleFactor: 1, mobile: false});
    await page.waitFor(`innerWidth === 360`, {what: 'the viewport to be 360 px wide'});
    const measured = await page.evaluate(`(() => {
      const out = [];
      for (const el of document.querySelectorAll('.model-panel button, .model-panel input, .model-panel select, .model-panel a')) {
        if (!el.checkVisibility()) continue;
        if (el.tagName === 'A') {   // inline links inside a sentence are exempt (WCAG 2.5.8); a standalone link is the whole text of its parent
          const parent = el.parentElement; if (parent.textContent.trim() !== el.textContent.trim()) continue;
        }
        // The checkbox is measured through its label; a range input by its own box, which is its track.
        const target = el.type === 'checkbox' || el.type === 'radio' ? (el.closest('label') ?? document.querySelector('label[for="' + el.id + '"]') ?? el) : el;
        const r = target.getBoundingClientRect();
        out.push({what: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.type ? '[' + el.type + ']' : ''), via: target === el ? 'self' : 'label', width: r.width, height: r.height});
      }
      return out;
    })()`);
    assert.ok(measured.length >= 12, `expected the preset, orbit, zoom, select, slider and reset controls to be measured, got ${measured.length}`);
    const small = measured.filter(m => m.width < 44 || m.height < 44).map(m => `${m.what} (${m.via}) ${m.width.toFixed(1)}×${m.height.toFixed(1)}`);
    assert.deepEqual(small, [], 'targets smaller than 44 × 44');
  }));

browserTest('PE-25 at 360 × 740 the preset group wraps inside the panel and nothing is clipped horizontally', () =>
  withExplorer({}, async page => {
    await page.send('Emulation.setDeviceMetricsOverride', {width: 360, height: 740, deviceScaleFactor: 1, mobile: false});
    await page.waitFor(`innerWidth === 360`, {what: 'the viewport to be 360 px wide'});
    const clipped = await page.evaluate(`(() => {
      const panel = document.querySelector('.model-panel').getBoundingClientRect(), out = [];
      for (const el of document.querySelectorAll('.model-panel button, .model-panel input, .model-panel select')) {
        if (!el.checkVisibility()) continue;
        const r = el.getBoundingClientRect();
        if (r.left < panel.left - 0.5 || r.right > panel.right + 0.5) out.push(el.id || el.tagName);
      }
      return out;
    })()`);
    assert.deepEqual(clipped, [], 'controls outside the panel');
  }));

// ---------------------------------------------------------------------------------------------------- PE-56 ('failed' half)
const site = cdpSkipReason ? null : await serveS6();
after(() => site?.close());

browserTest('PE-56 a context loss mid-transition with no restore ends the transition at its target, then shows the still path', async () => {
  const start = FIRST_ID + 1, target = start + 5, targetImage = firstImage(target);
  const page = await openS6Page(site, {hash: `#move=${start}`});
  try {
    await settled(page, firstImage(start));
    await go(page, target);
    await page.waitFor(`(() => { const t = __explorer.state.transition; return t.active && t.progress > 0.1 && t.progress < 0.9; })()`, {what: 'a mid-hop frame', timeout: 15000});
    await page.evaluate(LOSE);
    await page.waitFor(`__explorer.state.renderer === 'lost'`, {what: 'lost', timeout: 4000});
    // 'lost' completes the transition to its target without rendering.
    const atLoss = await page.evaluate(`(() => { const s = __explorer.state; return {active: s.transition.active, kind: s.pose.kind, imageId: s.pose.imageId ?? null, renders: s.renderCount}; })()`);
    assert.equal(atLoss.active, false, 'transition ended at the loss');
    assert.equal(atLoss.kind, 'estimate');
    assert.equal(atLoss.imageId, targetImage, 'it ended at the target, not an intermediate keyframe');
    const targetAngle = angleOf(targetImage);
    assert.ok(Math.abs(await page.evaluate(`__explorer.jointAngle('${ELBOW}')`) - targetAngle) < 0.5, 'the bones are the target pose');
    // No restore: the still path follows.
    await page.waitFor(`__explorer.state.renderer === 'failed'`, {what: 'renderer "failed"', timeout: 9000});
    assert.equal(await page.evaluate(shown('#model-still')), true);
    const after = await page.evaluate(`(() => { const s = __explorer.state; return {active: s.transition.active, imageId: s.pose.imageId ?? null, renders: s.renderCount}; })()`);
    assert.equal(after.active, false);
    assert.equal(after.imageId, targetImage);
    assert.equal(after.renders, atLoss.renders, 'no frame was rendered after the loss');
    assert.ok(Math.abs(await page.evaluate(`__explorer.jointAngle('${ELBOW}')`) - targetAngle) < 0.5, 'bones still at the target on the still path');
  } finally { await page.close(); }
});

