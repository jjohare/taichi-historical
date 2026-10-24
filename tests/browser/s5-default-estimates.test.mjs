// Slice S5 (ADR-0007): reviewed estimates are shown by default. PE-16, PE-18 to PE-21, PE-26, PE-28, PE-35, PE-36, PE-41,
// and the `yang:image-shown` contract (design §7). The shipped index is empty, so fixture-index cases serve the real tree
// with an in-memory index (tests/helpers/fixture-site.mjs); nothing is written under assets/.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {ROOT} from '../helpers/files.mjs';
import {cdpSkipReason, withExplorer} from '../helpers/cdp.mjs';
import {serveSite, SUBTLE_SHIM} from '../helpers/fixture-site.mjs';
import {fixture} from '../helpers/poses.mjs';
import {setSlider, click} from '../helpers/page-expr.mjs';
import {NEUTRAL_TEXT, selectJoint, selectMove, clickPreset} from '../helpers/s2.mjs';

const catalogue = JSON.parse(readFileSync(path.join(ROOT, 'assets/catalogue.json'), 'utf8'));
const entry = id => catalogue.find(m => m.id === id);
const imageOf = (id, source) => entry(id).images.find(i => i.source === source);
const idOf = image => image.file.replace(/\.png$/, '');
const CHEN1 = imageOf(1, 'chen'), YANG1 = imageOf(1, 'yang');
assert.equal(idOf(CHEN1), 'chen-001'); assert.equal(idOf(YANG1), 'yang-001');

const REVIEWED = 'ESTIMATED POSE';
const provenanceText = (image) => `Estimated pose — from ${image.label} (${idOf(image)}), reviewed 24 October 2026`;
const DETAIL = 'SAM 3D Body · confidence 0.72 · an estimate, not a measurement';
const SLIDER_NOTE = 'Choose “Show neutral avatar” to use the joint checks.';
const LOCAL = {label: 'LOCAL FILE · NOT REVIEWED', text: 'Unpublished pose file — local preview, not reviewed for this site'};

// Records every yang:image-shown event from before any page script runs. The microtask snapshot sees the synchronous
// effects of the explorer's own listener, i.e. the state at the end of the task in which the event fired.
const CAPTURE = `window.__shown = [];
document.addEventListener('yang:image-shown', e => {
  const detail = {...e.detail};
  queueMicrotask(() => {
    const x = window.__explorer;
    window.__shown.push({detail, label: document.getElementById('model-label').textContent, provenance: document.getElementById('model-provenance').textContent,
      kind: x ? x.state.pose.kind : null, maxAngle: x && x.state.rig === 'avatar' ? Math.max(...x.rig.jointNames.map(n => Math.abs(x.jointAngle(n)))) : null});
  });
});`;

const STATE = `(() => { const s = __explorer.state; return {kind: s.pose.kind, imageId: s.pose.imageId ?? null, origin: s.pose.origin ?? null, showNeutral: s.showNeutral, label: s.label}; })()`;
const SHOWN = `window.__shown`;
const VISIBLE = id => `(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0; })()`;
const NEUTRAL_UI = `(() => ({label: document.getElementById('model-label').textContent, text: document.getElementById('model-provenance').textContent.trim()}))()`;
const SLIDERS = `(() => ({elbow: document.getElementById('elbow-angle').disabled, crouch: document.getElementById('stance-angle').disabled, elbowValue: document.getElementById('elbow-angle').value, crouchValue: document.getElementById('stance-angle').value}))()`;
const clickSource = source => `document.querySelector('#source-filters [data-source="${source}"]').click()`;
const setNeutral = on => `(() => { const c = document.getElementById('show-neutral'); c.checked = ${on}; c.dispatchEvent(new Event('change', {bubbles: true})); return c.checked; })()`;

const withSite = (estimates, options, fn) => (cdpSkipReason ? test(options.name, {skip: cdpSkipReason}) : test(options.name, {timeout: 90000}, async () => {
  const site = await serveSite({estimates});
  try { await withExplorer({base: site.base, init: `${SUBTLE_SHIM}\n${CAPTURE}`, ...options.open}, page => fn(page, site)); } finally { await site.close(); }
}));

const awaitEstimate = (page, imageId) => page.waitFor(`__explorer.state.pose.kind === 'estimate' && __explorer.state.pose.imageId === ${JSON.stringify(imageId)}`, {what: `the ${imageId} estimate to be applied`});
const awaitIndexed = page => page.waitFor('__explorer.state.indexed === true', {what: 'the index to list an estimate'});
const awaitNeutral = page => page.waitFor(`__explorer.state.pose.kind === 'neutral'`, {what: 'the neutral rig'});

// ---- PE-35: the shipped, empty index ----------------------------------------------------------------------------
withSite([], {name: 'PE-35 empty index: exactly one index.json request (200), no 404, no #show-neutral, no pose file, PE-17 labels', open: {}}, async page => {
    assert.deepEqual(JSON.parse(readFileSync(path.join(ROOT, 'assets/pose-estimates/index.json'), 'utf8')).estimates, [], 'the shipped index is empty');
    await page.until(() => page.requests.some(u => /\/assets\/pose-estimates\/index\.json/.test(u)), {what: 'the index request', timeout: 8000});
    await page.quiet(500);
    const poseRequests = page.requests.filter(u => /\/assets\/pose-estimates\//.test(u));
    assert.equal(poseRequests.length, 1, poseRequests.join('\n'));
    assert.ok(poseRequests[0].endsWith('/assets/pose-estimates/index.json'));
    const entries = await page.evaluate(`performance.getEntriesByType('resource').map(e => ({url: e.name, status: e.responseStatus}))`);
    assert.equal(entries.find(e => e.url === poseRequests[0]).status, 200);
    assert.deepEqual(entries.filter(e => e.status === 404).map(e => e.url), []);
    assert.deepEqual([...page.consoleErrors, ...page.logErrors], []);
    assert.equal(await page.evaluate(VISIBLE('show-neutral')), false, '#show-neutral must not appear');
    assert.equal(await page.evaluate(`document.getElementById('apply-estimate')`), null, '#apply-estimate is withdrawn');
    assert.deepEqual(await page.evaluate(NEUTRAL_UI), {label: 'ILLUSTRATIVE AVATAR', text: NEUTRAL_TEXT});
    assert.equal((await page.evaluate(STATE)).kind, 'neutral');
});

// ---- PE-16 with the empty index ---------------------------------------------------------------------------------
withSite([], {name: 'PE-16 (empty index) reset returns to three-quarter and neutral, keeps the joint, readout 0°', open: {}}, async page => {
    await page.evaluate(selectJoint('left_elbow'));
    await page.evaluate(setSlider('elbow-angle', 60));
    await page.evaluate(clickPreset('Front'));
    await page.evaluate(click('reset-view'));
    assert.equal(await page.evaluate('__explorer.state.camera.preset'), 'three-quarter');
    assert.equal(await page.evaluate('__explorer.state.pose.kind'), 'neutral');
    assert.equal(await page.evaluate('__explorer.state.selectedJoint'), 'left_elbow');
    assert.equal(await page.evaluate(`document.getElementById('joint-readout').textContent.trim()`), 'Left elbow: 0° from rest');
});

// ---- PE-21: local files -----------------------------------------------------------------------------------------
withSite([], {name: 'PE-21 loadPoseObject(valid-full, local) shows LOCAL FILE · NOT REVIEWED even though review.status is accepted', open: {}}, async page => {
    const object = fixture('valid-full.json');
    assert.equal(object.review.status, 'accepted');
    const result = await page.evaluate(`__explorer.loadPoseObject(${JSON.stringify(object)}, {origin: 'local'})`);
    assert.equal(result.ok, true);
    assert.deepEqual(await page.evaluate(NEUTRAL_UI), {label: LOCAL.label, text: LOCAL.text});
    assert.equal((await page.evaluate(STATE)).origin, 'local');
});

withSite([], {name: 'PE-21 a file chosen in #pose-file (accept=application/json) is labelled LOCAL FILE · NOT REVIEWED', open: {}}, async page => {
    assert.deepEqual(await page.evaluate(`(() => { const i = document.getElementById('pose-file'); return {tag: i.tagName, type: i.type, accept: i.accept}; })()`), {tag: 'INPUT', type: 'file', accept: 'application/json'});
    await page.evaluate(`(() => {
      const input = document.getElementById('pose-file'), data = new DataTransfer();
      data.items.add(new File([${JSON.stringify(JSON.stringify(fixture('valid-full.json')))}], 'mine.json', {type: 'application/json'}));
      input.files = data.files; input.dispatchEvent(new Event('change', {bubbles: true}));
    })()`);
    await page.waitFor(`document.getElementById('model-label').textContent === ${JSON.stringify(LOCAL.label)}`, {what: 'the local-file label'});
    assert.deepEqual(await page.evaluate(NEUTRAL_UI), {label: LOCAL.label, text: LOCAL.text});
    assert.equal(await page.evaluate('__explorer.state.pose.origin'), 'local');
});

// ---- PE-41 ------------------------------------------------------------------------------------------------------
withSite([], {name: 'PE-41 a malformed file is rejected: ok:false, state unchanged, #pose-error text, one console.warn, no error', open: {}}, async page => {
    const bad = fixture('invalid-E_QUAT.json');
    const before = await page.evaluate(STATE);
    const result = await page.evaluate(`__explorer.loadPoseObject(${JSON.stringify(bad)}, {origin: 'local'})`);
    assert.equal(result.ok, false);
    assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
    assert.deepEqual(await page.evaluate(STATE), before);
    assert.deepEqual(await page.evaluate(NEUTRAL_UI), {label: 'ILLUSTRATIVE AVATAR', text: NEUTRAL_TEXT});
    const error = await page.evaluate(`(() => { const e = document.getElementById('pose-error'); return {text: e.textContent.trim(), role: e.getAttribute('role')}; })()`);
    assert.equal(error.role, 'status');
    assert.equal(error.text, `This pose file was rejected: ${result.errors[0].message}`);
    await page.until(() => page.consoleWarnings.length >= 1, {what: 'the console.warn'});
    assert.equal(page.consoleWarnings.length, 1, page.consoleWarnings.join('\n'));
    assert.deepEqual([...page.consoleErrors, ...page.logErrors], []);
});

// ---- PE-28 / PE-36: requests ------------------------------------------------------------------------------------
// No catalogue entry shows chen-001 first, so "applied on load" is exercised with yang-001, which entry 1 shows first.
withSite(['yang-001'], {name: 'PE-28 start-up request set: only assets/explorer/*.js, index.json once, and yang-001.json once, nothing else new', open: {hash: '#move=1'}}, async (page, site) => {
  await awaitEstimate(page, 'yang-001');
  await page.quiet(500);
  const paths = site.requests.map(r => r.path);
  assert.deepEqual(site.poseRequests(), ['index.json', 'yang-001.json']);
  assert.equal(paths.filter(p => p.endsWith('/catalogue.json')).length, 1, 'catalogue.json is requested by site.js only');
  assert.deepEqual(site.requests.filter(r => r.status >= 400), []);
  const outside = page.requests.filter(u => /^https?:/.test(u) && !u.startsWith(site.base));
  assert.deepEqual(outside, [], 'every request is same-origin');
  assert.ok(page.requests.filter(u => u.includes('/assets/explorer/')).every(u => /\/assets\/explorer\/[\w-]+\.js(\?|$)/.test(u)));
  assert.deepEqual([...page.consoleErrors, ...page.logErrors], []);
});

withSite(['yang-001'], {name: 'PE-36 an indexed image displayed at start-up is applied at once: PE-18 strings, visible provenance, sliders disabled with the PE-20 note', open: {hash: '#move=1'}}, async page => {
  await awaitEstimate(page, 'yang-001');
  const ui = await page.evaluate(`(() => ({label: document.getElementById('model-label').textContent, provenance: document.getElementById('model-provenance').textContent.trim(), detail: document.getElementById('model-provenance-detail').textContent.trim()}))()`);
  assert.deepEqual(ui, {label: REVIEWED, provenance: provenanceText(YANG1), detail: DETAIL});
  assert.equal(await page.evaluate(VISIBLE('model-provenance')), true);
  assert.equal(await page.evaluate(VISIBLE('model-provenance-detail')), true);
  const sliders = await page.evaluate(SLIDERS);
  assert.equal(sliders.elbow, true); assert.equal(sliders.crouch, true);
  assert.equal(await page.evaluate(VISIBLE('slider-note')), true);
  assert.equal(await page.evaluate(`document.getElementById('slider-note').textContent.trim()`), SLIDER_NOTE);
  assert.equal(await page.evaluate('__explorer.state.showNeutral'), false);
  assert.ok(await page.evaluate(`Math.max(...__explorer.rig.jointNames.map(n => Math.abs(__explorer.jointAngle(n))))`) > 1, 'the bones moved off rest');
});

withSite(['chen-001'], {name: 'PE-36 chen-only index: Yang source is neutral with PE-17 labels; choosing Chen applies chen-001; the Drawings source is neutral; only index.json and chen-001.json are requested', open: {hash: '#move=0'}}, async (page, site) => {
  await awaitIndexed(page);
  assert.equal(await page.evaluate(VISIBLE('show-neutral')), true, '#show-neutral is present once the index lists an estimate');
  assert.equal(await page.evaluate(`document.getElementById('show-neutral').checked`), false);
  assert.equal(await page.evaluate(`document.getElementById('show-neutral').closest('label').textContent.trim()`), 'Show neutral avatar');
  assert.deepEqual(await page.evaluate(NEUTRAL_UI), {label: 'ILLUSTRATIVE AVATAR', text: NEUTRAL_TEXT});
  await page.evaluate(clickSource('chen'));
  await awaitEstimate(page, 'chen-001');
  assert.deepEqual(await page.evaluate(`(() => ({label: document.getElementById('model-label').textContent, provenance: document.getElementById('model-provenance').textContent.trim(), detail: document.getElementById('model-provenance-detail').textContent.trim()}))()`), {label: REVIEWED, provenance: provenanceText(CHEN1), detail: DETAIL});
  await page.evaluate(clickSource('montage'));
  assert.equal((await page.evaluate(STATE)).kind, 'neutral', 'a drawing never has an estimate');
  assert.deepEqual(await page.evaluate(NEUTRAL_UI), {label: 'ILLUSTRATIVE AVATAR', text: NEUTRAL_TEXT});
  await page.evaluate(clickSource('chen'));
  await awaitEstimate(page, 'chen-001');
  assert.deepEqual([...new Set(site.poseRequests())].sort(), ['chen-001.json', 'index.json']);
});

withSite(['chen-001'], {name: 'PE-20 / PE-36 #show-neutral on gives neutral with enabled zeroed sliders; off applies the estimate again', open: {hash: '#move=1'}}, async page => {
  await awaitIndexed(page);
  await page.evaluate(clickSource('chen'));
  await awaitEstimate(page, 'chen-001');
  assert.equal((await page.evaluate(SLIDERS)).elbow, true);
  assert.equal(await page.evaluate(setNeutral(true)), true);
  assert.equal((await page.evaluate(STATE)).kind, 'neutral', 'neutral at once');
  assert.deepEqual(await page.evaluate(NEUTRAL_UI), {label: 'ILLUSTRATIVE AVATAR', text: NEUTRAL_TEXT});
  assert.deepEqual(await page.evaluate(SLIDERS), {elbow: false, crouch: false, elbowValue: '0', crouchValue: '0'});
  assert.equal(await page.evaluate(VISIBLE('slider-note')), false);
  assert.ok(await page.evaluate(`Math.max(...__explorer.rig.jointNames.map(n => Math.abs(__explorer.jointAngle(n))))`) < 0.1, 'bones at rest (angles are float32 acos, good to ~0.03°)');
  await page.evaluate(setSlider('elbow-angle', 50));
  assert.ok(await page.evaluate(`Math.abs(__explorer.jointAngle('left_elbow'))`) > 1, 'the joint check works while neutral');
  await page.evaluate(setNeutral(false));
  await awaitEstimate(page, 'chen-001');
  assert.deepEqual(await page.evaluate(SLIDERS), {elbow: true, crouch: true, elbowValue: '0', crouchValue: '0'});
  assert.equal((await page.evaluate(NEUTRAL_UI)).label, REVIEWED);
});

withSite(['chen-001'], {name: 'PE-36 #show-neutral survives navigation, never transitions, is off after a reload; reset turns it off and re-applies the estimate (PE-16)', open: {hash: '#move=1'}}, async (page, site) => {
  await awaitIndexed(page);
  await page.evaluate(clickSource('chen'));
  await awaitEstimate(page, 'chen-001');
  await page.evaluate(setNeutral(true));
  await page.evaluate(`location.hash = 'move=0'`);
  await page.waitFor(`document.getElementById('move-number').textContent.startsWith('No. 000')`, {what: 'entry 0'});
  await page.evaluate(clickSource('chen'));
  await page.quiet(400);
  assert.deepEqual(await page.evaluate(`(() => ({checked: document.getElementById('show-neutral').checked, ...${STATE}}))()`), {checked: true, kind: 'neutral', imageId: null, origin: null, showNeutral: true, label: 'ILLUSTRATIVE AVATAR'});
  assert.equal(await page.evaluate(`!!__explorer.state.transition?.active`), false, 'no transition while neutral is forced');
  // reset turns it off and re-applies the displayed image's estimate; the readout equals the estimate's angle
  await page.evaluate(selectJoint('left_elbow'));
  await page.evaluate(click('reset-view'));
  await awaitEstimate(page, 'chen-001');
  const after = await page.evaluate(`(() => ({checked: document.getElementById('show-neutral').checked, showNeutral: __explorer.state.showNeutral, preset: __explorer.state.camera.preset, joint: __explorer.state.selectedJoint, readout: document.getElementById('joint-readout').textContent.trim(), angle: __explorer.jointAngle('left_elbow')}))()`);
  assert.deepEqual({checked: after.checked, showNeutral: after.showNeutral, preset: after.preset, joint: after.joint}, {checked: false, showNeutral: false, preset: 'three-quarter', joint: 'left_elbow'});
  const shown = Number(after.readout.match(/^Left elbow: (-?[\d.]+)°/)?.[1]);
  assert.ok(Math.abs(shown - after.angle) <= 0.51, `readout "${after.readout}" vs estimate angle ${after.angle}`);
  assert.ok(Math.abs(after.angle) > 1, 'the fixture elbow is bent');
  // never persisted: on again, reload, off
  await page.evaluate(setNeutral(true));
  const url = await page.evaluate('location.href');
  assert.ok(!/neutral/i.test(url), 'not in the URL');
  assert.equal(await page.evaluate(`JSON.stringify([localStorage, sessionStorage, document.cookie]).toLowerCase().includes('neutral')`), false);
  const reloaded = page.once('Page.loadEventFired'); await page.send('Page.reload'); await reloaded;
  await page.waitFor("window.__explorer && __explorer.state.rig === 'avatar'", {what: 'reloaded explorer'});
  await awaitIndexed(page);
  assert.equal(await page.evaluate('__explorer.state.showNeutral'), false);
  assert.equal(await page.evaluate(`document.getElementById('show-neutral').checked`), false);
  assert.ok(site.poseRequests().every(f => f === 'index.json' || f === 'chen-001.json'));
});

withSite(['chen-001'], {name: 'PE-19 an applied estimate never outlives its image: unindexed target is neutral with PE-17 labels in the same task', open: {hash: '#move=1'}}, async page => {
  await awaitIndexed(page);
  await page.evaluate(clickSource('chen'));
  await awaitEstimate(page, 'chen-001');
  const before = (await page.evaluate(SHOWN)).length;
  await page.evaluate(`location.hash = 'move=2'`);
  await page.waitFor(`window.__shown.length > ${before}`, {what: 'the image-shown event for entry 2'});
  const event = (await page.evaluate(SHOWN))[before];
  assert.equal(event.detail.moveId, 2);
  assert.notEqual(event.detail.imageId, 'chen-001');
  assert.deepEqual({kind: event.kind, label: event.label, provenance: event.provenance}, {kind: 'neutral', label: 'ILLUSTRATIVE AVATAR', provenance: NEUTRAL_TEXT}, 'by the end of the task that fired the event');
  assert.ok(event.maxAngle < 0.1, `bones at rest in the same task, max angle ${event.maxAngle}`);
  await page.quiet(500);
  assert.equal((await page.evaluate(STATE)).kind, 'neutral');
  // a thumbnail/source change within an entry also drops it: Chen estimate, then the Yang photograph of the same entry
  await page.evaluate(`location.hash = 'move=1'`);
  await page.waitFor(`document.getElementById('move-number').textContent.startsWith('No. 001')`);
  await page.evaluate(clickSource('chen'));
  await awaitEstimate(page, 'chen-001');
  const n = (await page.evaluate(SHOWN)).length;
  await page.evaluate(clickSource('yang'));
  const change = (await page.evaluate(SHOWN))[n];
  assert.deepEqual({kind: change.kind, label: change.label}, {kind: 'neutral', label: 'ILLUSTRATIVE AVATAR'}, 'image change within one entry');
});

withSite(['chen-001', 'yang-001'], {name: 'PE-19 the estimate for the new image replaces the old one: pose.imageId is the new image on arrival', open: {hash: '#move=1'}}, async page => {
  await awaitEstimate(page, 'yang-001');
  await page.evaluate(clickSource('chen'));        // an image change inside one entry: applied at once, never a stale yang-001
  await awaitEstimate(page, 'chen-001');
  const events = await page.evaluate(SHOWN);
  const last = events.at(-1);
  assert.equal(last.detail.imageId, 'chen-001');
  assert.notEqual(last.label, REVIEWED + ' yang-001');
  assert.equal(await page.evaluate(`document.getElementById('model-provenance').textContent.includes('(yang-001)')`), false);
  assert.equal(await page.evaluate(`document.getElementById('model-provenance').textContent.includes('(chen-001)')`), true);
});

// ---- the yang:image-shown contract (design §7) -----------------------------------------------------------------
withSite([], {name: 'yang:image-shown fires on initial selection and on every navigation with {moveId, imageId, ordinal}', open: {}}, async page => {
    const expected = (id, source = 'montage', index = 0) => { const m = entry(id), im = m.images.filter(i => i.source === source)[index]; return {moveId: m.id, imageId: idOf(im), ordinal: m.ordinal}; };
    const pick = events => events.map(e => ({moveId: e.detail.moveId, imageId: e.detail.imageId, ordinal: e.detail.ordinal}));
    const first = pick(await page.evaluate(SHOWN));
    assert.ok(first.length >= 1, 'an event for the initial selection must be observable from a script that runs before the page');
    assert.deepEqual(first.at(-1), expected(2));
    const seen = async () => pick(await page.evaluate(SHOWN)).at(-1);
    const next = async (action, want) => {
      const n = (await page.evaluate(SHOWN)).length;
      await page.evaluate(action);
      await page.waitFor(`window.__shown.length > ${n}`, {what: 'a new image-shown event'});
      assert.deepEqual(await seen(), want);
    };
    await next(`location.hash = 'move=5'`, expected(5));
    await next(click('next'), expected(6));
    await next(click('previous'), expected(5));
    await next(`document.querySelector('#position-list a[data-id="30"]').click()`, expected(30));
    await next(clickSource('yang'), expected(30, 'yang'));
    await next(`document.querySelectorAll('#thumbnails button')[1]?.click() ?? document.getElementById('next').click()`, (await page.evaluate(`document.querySelectorAll('#thumbnails button').length`)) > 1 ? expected(30, 'yang', 1) : expected(31, 'yang'));
    for (const e of await page.evaluate(SHOWN)) {
      assert.equal(typeof e.detail.moveId, 'number'); assert.equal(typeof e.detail.imageId, 'string'); assert.equal(typeof e.detail.ordinal, 'number');
    }
});

// ---- PE-26 session ----------------------------------------------------------------------------------------------
withSite(['chen-001'], {name: 'PE-26 scripted session with an estimate shown: no console errors, one warning (the malformed file), same-origin only', open: {hash: '#move=1'}}, async (page, site) => {
  await awaitIndexed(page);
  await page.evaluate(clickSource('chen'));
  await awaitEstimate(page, 'chen-001');
  for (const id of [2, 3, 4, 5, 1]) await selectMove(page, id);
  for (const label of ['Front', 'Side (left)', 'Back', 'Top', 'Three-quarter']) await page.evaluate(clickPreset(label));
  for (const joint of ['left_elbow', 'right_knee', 'pelvis']) await page.evaluate(selectJoint(joint));
  await page.evaluate(click('show-skeleton')); await page.evaluate(click('show-skeleton'));
  await page.evaluate(setNeutral(true));
  await page.evaluate(setSlider('elbow-angle', 40)); await page.evaluate(setSlider('stance-angle', 30));
  await page.evaluate(setNeutral(false));
  await page.evaluate(click('reset-view'));
  await page.evaluate(`__explorer.loadPoseObject(${JSON.stringify(fixture('invalid-E_QUAT.json'))}, {origin: 'local'})`);
  await page.quiet(500);
  assert.deepEqual([...page.consoleErrors, ...page.logErrors, ...page.exceptions], []);
  assert.equal(page.consoleWarnings.length, 1, page.consoleWarnings.join('\n'));
  assert.deepEqual(page.requests.filter(u => /^https?:/.test(u) && !u.startsWith(site.base)), []);
});

// ---- PE-16 with a fixture index ---------------------------------------------------------------------------------
withSite(['chen-001'], {name: 'PE-16 (fixture index) after selecting a joint and moving the neutral sliders, reset shows the displayed estimate with showNeutral off', open: {hash: '#move=1'}}, async page => {
  await awaitIndexed(page);
  await page.evaluate(clickSource('chen'));
  await awaitEstimate(page, 'chen-001');
  await page.evaluate(setNeutral(true));
  await page.evaluate(selectJoint('left_elbow'));
  await page.evaluate(setSlider('elbow-angle', 60));
  await page.evaluate(clickPreset('Front'));
  await page.evaluate(click('reset-view'));
  await awaitEstimate(page, 'chen-001');
  const s = await page.evaluate(`(() => ({showNeutral: __explorer.state.showNeutral, preset: __explorer.state.camera.preset, elbow: document.getElementById('elbow-angle').value}))()`);
  assert.deepEqual(s, {showNeutral: false, preset: 'three-quarter', elbow: '0'});
});
