// Slice S7, browser half: PE-60 (browser), PE-61, PE-65 to PE-71 on the fixture tree. Frame-level facts come from a page-side
// recorder; the "settle window" is read from the hook's lag snapshot, never from CDP polling (which cannot resolve 16 ms).
import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {browserTest, cdpSkipReason} from '../helpers/cdp.mjs';
import {dot} from '../helpers/page-expr.mjs';
import {openS6Page, settled, go, firstImage, atMidHop, stable, catalogue} from '../helpers/s6.mjs';
import {logLagWrites, lagWrites, serveS7, glbWithoutLagNodes, glbAtRevision, startLagRecording, stopLagRecording, maxAbs, allZero, PIECE_MESH, HIDDEN_BY_SKELETON} from '../helpers/s7.mjs';

const site = cdpSkipReason ? null : await serveS7();
after(() => site?.close());
const HOME = 3, NEXT = 4;
const NODES = ['lag:left_cuff', 'lag:right_cuff', 'lag:hem_front', 'lag:hem_back', 'lag:hem_left', 'lag:hem_right'];

async function withPage(options, fn, server = site) {
  // The shared sidecar sometimes fails to answer while a tab opens; opening is retried once, test bodies never are.
  const page = await openS6Page(server, options).catch(error => (/no CDP response|settled rig/.test(error.message) ? openS6Page(server, options) : Promise.reject(error)));
  try { return await fn(page); } finally { await page.close(); }
}
const clickNext = page => page.evaluate("document.getElementById('next').click()");
const lagNow = page => page.evaluate('__explorer.state.lag');
function assertShape(lag, where) {
  assert.ok(lag && typeof lag === 'object', `${where}: state.lag is missing`);
  assert.deepEqual(Object.keys(lag).sort(), ['active', 'angles', 'capMs', 'settling'], where);
  assert.equal(typeof lag.active, 'boolean', where); assert.equal(typeof lag.settling, 'boolean', where);
  assert.equal(typeof lag.capMs, 'number', where);
  assert.ok(lag.angles && typeof lag.angles === 'object', where);
  assert.ok(Object.values(lag.angles).every(a => typeof a === 'number' && Number.isFinite(a)), `${where}: angles are finite numbers`);
}
/** Record a whole adjacent navigation (HOME → NEXT) including the settle window and `tail` ms after the last render change. */
async function recordNext(page, {tail = 1000} = {}) {
  await startLagRecording(page);
  await page.waitFor('window.__lagRec.length > 3', {what: 'recorder running'});
  await clickNext(page);
  await settled(page, firstImage(NEXT));
  await page.waitFor(`(() => { const r = window.__lagRec, last = r[r.length - 1]; return !last.active && !last.lag.settling && !last.lag.active; })()`, {what: 'the settle window to end', timeout: 15000, interval: 20});
  const frames = await page.evaluate('window.__lagRec.length');
  await page.quiet(tail);
  const rec = await stopLagRecording(page);
  return {rec, endIndex: frames - 1};
}
const gaps = rec => Math.max(0, ...rec.slice(1).map((f, i) => f.t - rec[i].t));

// ------------------------------------------------------------------------------------------------ PE-60 / PE-71 at rest
browserTest('PE-60/71 at rest the rig still has 24 joints and 25 select options, and lag has the documented shape with one zero angle per piece', () =>
  withPage({}, async page => {
    assert.equal(await page.evaluate('__explorer.rig.jointNames.length'), 24);
    assert.equal(await page.evaluate("document.getElementById('joint-select').options.length"), 25);
    assert.equal(await page.evaluate('__explorer.rig.rest.size'), 24);
    await settled(page, firstImage(HOME));
    const lag = await lagNow(page);
    assertShape(lag, 'at rest');
    assert.equal(lag.active, false); assert.equal(lag.settling, false); assert.equal(lag.capMs, 600);
    for (const name of NODES) assert.equal(lag.angles[name], 0, `${name} present and 0`);
    assert.equal(Object.keys(lag.angles).length, (await import('node:fs')).readFileSync(new URL('../../assets/model/build-report.json', import.meta.url), 'utf8').match(/"node": "lag:/g).length);
  }));

// ------------------------------------------------------------------------------------------------ PE-65 / PE-59 / PE-69 / PE-71
browserTest('PE-65 an adjacent Next moves the pieces: lag active from the first moving frame, settles within the cap, then renderCount is fixed and every angle is exactly 0', () =>
  withPage({hash: `#move=${HOME}`}, async page => {
    await settled(page, firstImage(HOME)); await stable(page);
    assert.ok(await logLagWrites(page) >= 6, 'the rig reports its lag nodes');
    const {rec, endIndex} = await recordNext(page, {tail: 150});
    const writes = await lagWrites(page);
    assert.ok(writes.some(w => w.moved), 'at least one piece was rotated away from its rest pose during the navigation');
    rec.forEach((f, i) => assertShape(f.lag, `frame ${i}`));
    const first = rec.findIndex(f => f.active && f.progress > 0);
    assert.ok(first >= 0, 'a transition with progress > 0 was recorded');
    assert.equal(rec[first].lag.active, true, 'lag.active from the first frame with progress > 0');
    const lastActive = rec.findLastIndex(f => f.active);
    assert.ok(rec.slice(first, lastActive + 1).every(f => f.lag.active), 'lag.active on every transition frame');
    assert.ok(rec.slice(first, rec.findIndex((f, i) => i > lastActive && !f.lag.settling) + 1).some(f => maxAbs(f.lag.angles) > 0), 'a sampled frame shows a non-zero piece angle');
    assert.ok(rec.slice(0, first).every(f => !f.lag.active && allZero(f.lag.angles)), 'nothing moves before the transition');

    // The settle window opens in the arrival task. A slow sidecar can skip the whole window between two recorded frames (the
    // pieces are at rest again by the next frame), so settling is required of the first non-active frame only when it still moves.
    const arrival = lastActive + 1;
    assert.ok(rec[arrival].lag.settling || (!rec[arrival].lag.active && allZero(rec[arrival].lag.angles)), 'lag.settling is true when transition.active has become false, unless the window had already ended');
    const capMs = rec[arrival].lag.capMs, settledAt = rec.findIndex((f, i) => i >= arrival && !f.lag.settling);
    const frameGap = Math.max(...rec.slice(arrival - 1, settledAt + 1).map((f, i, a) => (i ? f.t - a[i - 1].t : 0)));
    assert.ok(rec[settledAt].t - rec[arrival].t <= capMs + 2 * frameGap + 17, `settle took ${(rec[settledAt].t - rec[arrival].t).toFixed(0)} ms, cap ${capMs} ms, largest frame gap ${frameGap.toFixed(0)} ms; frames: ${rec.slice(arrival - 1, settledAt + 2).map(f => `${f.t.toFixed(0)}:${f.lag.settling}:${maxAbs(f.lag.angles).toFixed(2)}`).join(' ')}`);
    assert.ok(rec.slice(arrival, settledAt).every(f => f.lag.active && f.lag.settling));

    // After settling: exactly 0, inactive, and renderCount rises by at most one more (the final rest frame) then stays fixed for the tail.
    const after = rec.slice(settledAt);
    assert.ok(after.every(f => allZero(f.lag.angles) && !f.lag.active && !f.lag.settling), 'every angle is exactly 0 once settled');
    assert.ok(after.at(-1).renderCount - rec[settledAt].renderCount <= 1, 'at most one render after the window ends');
    // Flatness is checked with two samples a second apart, not by frame timing: a loaded sidecar can starve the recorder of frames.
    const settledCount = await page.evaluate('__explorer.state.renderCount');
    await page.quiet(1000);
    assert.equal(await page.evaluate('__explorer.state.renderCount'), settledCount, 'renderCount is fixed for 1 s after the window ends');
    assert.equal((await lagWrites(page)).length, writes.length, 'no piece is written after the window ends');
    for (const n of NODES) assert.equal(writes.findLast(w => w.node === n)?.moved, false, `${n} was last written at its rest rotation (PE-59 extension)`);
    assert.ok(endIndex >= settledAt - 1);
  }));

browserTest('PE-65 renderCount rises at most once per animation frame in the settle window, so the window costs at most capMs of frames', () =>
  withPage({hash: `#move=${HOME}`}, async page => {
    await settled(page, firstImage(HOME)); await stable(page);
    const {rec} = await recordNext(page, {tail: 300});
    const arrival = rec.findLastIndex(f => f.active) + 1, settledAt = rec.findIndex((f, i) => i >= arrival && !f.lag.settling);
    for (let i = arrival + 1; i <= settledAt; i++) assert.ok(rec[i].renderCount - rec[i - 1].renderCount <= 2, `frame ${i}: renderCount +${rec[i].renderCount - rec[i - 1].renderCount}`);
    assert.ok(gaps(rec) < 2000);
  }));

browserTest('PE-59/69 only the pieces move: bones equal the target applied alone on every settle frame, no storage is written, the hash is #move=<target> and the state carries no lag in the pose', () =>
  withPage({hash: `#move=${HOME}`}, async page => {
    await settled(page, firstImage(HOME)); await stable(page);
    const keysBefore = await page.evaluate('JSON.stringify([Object.keys(localStorage), Object.keys(sessionStorage)])');
    const {rec} = await recordNext(page, {tail: 200});
    const arrival = rec.findLastIndex(f => f.active) + 1, settledAt = rec.findIndex((f, i) => i >= arrival && !f.lag.settling);
    const target = await page.evaluate('(() => { const r = __explorer.rig; return Object.fromEntries(r.jointNames.map(n => [n, r.localOf(n)])); })()');
    for (let i = arrival; i < settledAt; i++) for (const [name, q] of Object.entries(rec[i].bones)) assert.ok(dot(q, target[name]) >= 1 - 1e-9, `frame ${i}: ${name} moved during the settle window`);
    assert.equal(await page.evaluate('JSON.stringify([Object.keys(localStorage), Object.keys(sessionStorage)])'), keysBefore, 'no storage keys appeared');
    assert.ok(rec.every(f => f.storage === JSON.parse(keysBefore).flat().length), 'storage count is constant on every frame');
    assert.equal(await page.evaluate('location.hash'), `#move=${NEXT}`);
    const state = await page.evaluate('JSON.stringify(__explorer.state.pose)');
    assert.ok(!/lag|cuff|trouser|hem_/i.test(state), `the pose object carries no lag data: ${state.slice(0, 300)}`);
    assert.equal(await page.evaluate('__explorer.state.pose.kind'), 'estimate');
    const { SETTLE_CAP_MS } = await import('../../assets/explorer/lag.js');
    assert.equal((await lagNow(page)).capMs, SETTLE_CAP_MS);
  }));

browserTest('PE-71 the hook shape holds mid-hop, mid-settle and after settling, and no request names build-report.json', () =>
  withPage({hash: `#move=${HOME}`}, async page => {
    await settled(page, firstImage(HOME));
    let mid = null;
    for (let n = 0; n < 8 && !mid; n++) {
      mid = await atMidHop(page, {begin: "document.getElementById('next').click()", script: 'return __explorer.state.lag;'});
      if (!mid) { await go(page, HOME); await settled(page, firstImage(HOME)); await page.quiet(200); }
    }
    assert.ok(mid, 'a mid-hop frame was observed within eight attempts');
    assertShape(mid, 'mid-hop'); assert.equal(mid.active, true);
    await settled(page, firstImage(NEXT));
    assertShape(await lagNow(page), 'after');
    assert.ok(!page.requests.some(u => /build-report/.test(u)), 'build-report.json is never requested');
  }));

// ------------------------------------------------------------------------------------------------ PE-66
browserTest('PE-66 with reduced motion the lag never runs: every sampled frame is inactive with all angles 0, and renderCount is static after the snap', () =>
  withPage({hash: `#move=${HOME}`, reducedMotion: true}, async page => {
    assert.equal(await page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), true);
    await settled(page, firstImage(HOME)); await stable(page);
    await logLagWrites(page);
    await startLagRecording(page);
    await page.waitFor('window.__lagRec.length > 3', {what: 'recorder running'});
    for (let k = 0; k < 5; k++) {
      await clickNext(page);
      await settled(page, firstImage(HOME + 1 + k));
    }
    await stable(page, 1000);
    const rec = await stopLagRecording(page);
    assert.ok(rec.length >= 3, `${rec.length} frames recorded`);
    { const w = await lagWrites(page); assert.ok(w.every(x => !x.moved), `no piece is ever rotated away from rest: ${w.length} writes, first moved ${JSON.stringify(w.find(x => x.moved))}, recorder ${rec.length} frames`); }
    for (const f of rec) { assertShape(f.lag, 'reduced motion'); assert.equal(f.lag.active, false); assert.equal(f.lag.settling, false); assert.ok(allZero(f.lag.angles)); }
    const before = await page.evaluate('__explorer.state.renderCount');
    await page.quiet(3000);
    assert.equal(await page.evaluate('__explorer.state.renderCount'), before);
  }));

// ------------------------------------------------------------------------------------------------ PE-67
browserTest('PE-67 dragging the crouch and elbow sliders never activates the lag; angles stay 0 and renderCount is static afterwards', () =>
  withPage({hash: `#move=${HOME}`}, async page => {
    await settled(page, firstImage(HOME));
    await page.evaluate("document.getElementById('show-neutral').click()");
    await page.waitFor("__explorer.state.pose.kind === 'neutral' && !document.getElementById('stance-angle').disabled", {what: 'neutral rig with enabled sliders'});
    await stable(page);
    await logLagWrites(page);
    await startLagRecording(page);
    for (const [id, max] of [['stance-angle', 40], ['elbow-angle', 60]]) {
      for (let v = 0; v <= max; v += 4) {
        await page.evaluate(`(() => { const el = document.getElementById('${id}'); el.value = ${v}; el.dispatchEvent(new Event('input', {bubbles: true})); })()`);
        await page.quiet(16);
      }
    }
    await stable(page, 1000);
    const rec = await stopLagRecording(page);
    assert.ok(rec.length >= 3, `${rec.length} frames recorded`);
    assert.ok((await lagWrites(page)).every(w => !w.moved), 'no piece is ever rotated away from rest');
    for (const f of rec) { assert.equal(f.lag.active, false); assert.equal(f.lag.settling, false); assert.ok(allZero(f.lag.angles)); }
    assert.ok(Math.abs(await page.evaluate("__explorer.jointAngle('left_elbow')")) > 1, 'the slider did move the bone');
    const before = await page.evaluate('__explorer.state.renderCount');
    await page.quiet(3000);
    assert.equal(await page.evaluate('__explorer.state.renderCount'), before);
  }));

// ------------------------------------------------------------------------------------------------ PE-68
const zeroNow = `(() => { const l = __explorer.state.lag; return {active: l.active, settling: l.settling, angles: Object.values(l.angles)}; })()`;
browserTest('PE-68 reset pressed mid-transition: in the same task lag is inactive, not settling, and every angle is exactly 0', () =>
  withPage({hash: `#move=${HOME}`}, async page => {
    await settled(page, firstImage(HOME));
    let result = null;
    for (let n = 0; n < 5 && !result; n++) {
      result = await atMidHop(page, {
        begin: "document.getElementById('next').click()", lo: 0.3, hi: 0.8,
        script: `const before = __explorer.state.lag; if (!Object.values(before.angles).some(a => a !== 0)) return null; document.getElementById('reset-view').click(); return {before, after: ${zeroNow}};`,
      });
      if (!result) { await page.evaluate("document.getElementById('reset-view').click()"); await go(page, HOME); await settled(page, firstImage(HOME)); await page.quiet(200); }
    }
    assert.ok(result, 'a mid-hop frame with moving pieces was caught within five attempts');
    assert.equal(result.before.active, true);
    assert.equal(result.after.active, false); assert.equal(result.after.settling, false);
    assert.ok(result.after.angles.every(a => a === 0));
    await stable(page);
    assert.ok(allZero((await lagNow(page)).angles));
  }));

browserTest('PE-68 reset pressed during the settle window: not settling and every angle exactly 0 in the same task, then no more renders', () =>
  withPage({hash: `#move=${HOME}`}, async page => {
    await settled(page, firstImage(HOME));
    let result = null;
    for (let n = 0; n < 5 && !result; n++) {
      result = await page.evaluate(`new Promise(resolve => {
        const t0 = performance.now(); document.getElementById('next').click();
        (function poll() {
          const l = __explorer.state.lag;
          if (l.settling && Object.values(l.angles).some(a => a !== 0)) { document.getElementById('reset-view').click(); return resolve(${zeroNow}); }
          if (performance.now() - t0 > 9000) return resolve(null);
          requestAnimationFrame(poll);
        })();
      })`);
      if (!result) { await page.evaluate("document.getElementById('reset-view').click()"); await go(page, HOME); await settled(page, firstImage(HOME)); await page.quiet(200); }
    }
    assert.ok(result, 'a settle frame with moving pieces was caught within five attempts');
    assert.equal(result.active, false); assert.equal(result.settling, false);
    assert.ok(result.angles.every(a => a === 0));
    await stable(page, 500);
    const before = await page.evaluate('__explorer.state.renderCount');
    await page.quiet(1500);
    assert.equal(await page.evaluate('__explorer.state.renderCount'), before);
  }));

browserTest('PE-68 checking "Show neutral avatar" mid-transition also ends the lag at once', () =>
  withPage({hash: `#move=${HOME}`}, async page => {
    await settled(page, firstImage(HOME));
    let result = null;
    for (let n = 0; n < 8 && !result; n++) {
      result = await atMidHop(page, {
        begin: "document.getElementById('next').click()", lo: 0.3, hi: 0.8,
        script: `if (!Object.values(__explorer.state.lag.angles).some(a => a !== 0)) return null; document.getElementById('show-neutral').click(); return ${zeroNow};`,
      });
      if (!result) { await go(page, HOME); await settled(page, firstImage(HOME)); await page.quiet(200); }
    }
    assert.ok(result, 'a mid-hop frame with moving pieces was caught');
    assert.equal(result.active, false); assert.equal(result.settling, false); assert.ok(result.angles.every(a => a === 0));
  }));

browserTest('PE-68 a context loss during the settle window zeroes the pieces and renders no further frame', () =>
  withPage({hash: `#move=${HOME}`}, async page => {
    await settled(page, firstImage(HOME));
    let caught = null;
    for (let n = 0; n < 5 && !caught; n++) {
      caught = await page.evaluate(`new Promise(resolve => {
        const t0 = performance.now(); document.getElementById('next').click();
        (function poll() {
          const l = __explorer.state.lag;
          if (l.settling && Object.values(l.angles).some(a => a !== 0)) {
            const c = document.querySelector('#model-view canvas'); window.__lose = c.getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lose.loseContext();
            return resolve(true);
          }
          if (performance.now() - t0 > 9000) return resolve(null);
          requestAnimationFrame(poll);
        })();
      })`);
      if (!caught) { await go(page, HOME); await settled(page, firstImage(HOME)); await page.quiet(200); }
    }
    assert.ok(caught, 'a settle frame with moving pieces was caught within five attempts');
    await page.waitFor("__explorer.state.renderer === 'lost'", {what: 'context loss to be noticed'});
    const lag = await lagNow(page);
    assert.equal(lag.active, false); assert.equal(lag.settling, false); assert.ok(allZero(lag.angles));
    const before = await page.evaluate('__explorer.state.renderCount');
    await page.quiet(1500);
    assert.equal(await page.evaluate('__explorer.state.renderCount'), before);
  }));

// A real click reaches the explorer only after the new image has loaded (`yang:image-shown`), which on a loaded sidecar can be after the
// settle window is over. The test therefore raises that same event itself, inside a frame where the pieces are moving.
const NEXT_IMAGE = {imageId: firstImage(HOME + 2), label: 'Fixture', moveId: HOME + 2, ordinal: catalogue.find(e => e.id === HOME + 2).ordinal, source: 'yang'};
browserTest('PE-68 a navigation during the settle window does not reset the pieces: the first new frames continue from where the angles were', () =>
  withPage({hash: `#move=${HOME}`}, async page => {
    await settled(page, firstImage(HOME)); await stable(page);
    let rec = null, clickIdx = -1;
    for (let n = 0; n < 6 && !rec; n++) {
      await startLagRecording(page);
      await page.waitFor('window.__lagRec.length > 8', {what: 'recorder running'});
      clickIdx = await page.evaluate(`new Promise(resolve => {
        const t0 = performance.now(); document.getElementById('next').click();
        (function poll() {
          const l = __explorer.state.lag;
          if (l.settling && Object.values(l.angles).some(a => a !== 0)) {
            document.dispatchEvent(new CustomEvent('yang:image-shown', {detail: ${JSON.stringify(NEXT_IMAGE)}}));
            return resolve(window.__lagRec.length);
          }
          if (performance.now() - t0 > 9000) return resolve(-1);
          requestAnimationFrame(poll);
        })();
      })`);
      if (clickIdx > 6) { await settled(page, NEXT_IMAGE.imageId); await page.quiet(300); }
      const r = await stopLagRecording(page);
      if (clickIdx > 6) rec = r; else { await go(page, HOME); await settled(page, firstImage(HOME)); await page.quiet(200); }
    }
    assert.ok(rec, 'a settle frame with moving pieces was caught within six attempts');
    const vec = f => NODES.map(k => f.lag.angles[k]);
    const jump = (a, b) => Math.max(...vec(a).map((x, i) => Math.abs(x - vec(b)[i])));
    const before = Math.max(...rec.slice(clickIdx - 6, clickIdx).map((f, i, a) => (i ? jump(f, a[i - 1]) : 0)));
    // The first frame after the navigation must continue from the old angles (a reset would be a jump down to 0, and `active` would drop).
    assert.ok(jump(rec[clickIdx], rec[clickIdx - 1]) <= 1.5 * before + 0.1, `first new frame jumped ${jump(rec[clickIdx], rec[clickIdx - 1]).toFixed(3)}°, largest earlier per-frame change ${before.toFixed(3)}°`);
    assert.ok(!allZero(rec[clickIdx].lag.angles) && rec[clickIdx].lag.active, 'the angles were not reset to 0 by the navigation');
  }));

// ------------------------------------------------------------------------------------------------ PE-70
browserTest('PE-70 skeleton view hides every garment-piece mesh and leaving it shows them again', () =>
  withPage({}, async page => {
    await settled(page, firstImage(HOME));
    const pieces = async () => page.evaluate(`Object.entries(__explorer.state.meshVisibility).filter(([n]) => ${PIECE_MESH}.test(n) && !${HIDDEN_BY_SKELETON}.test(n))`);
    const names = (await pieces()).map(([n]) => n);
    assert.ok(names.length >= 6, `piece meshes found: ${names.join(', ')}`);
    assert.ok((await pieces()).every(([, v]) => v === true), 'visible with the skeleton off');
    await page.evaluate("document.getElementById('show-skeleton').click()");
    await page.waitFor('__explorer.state.skeletonVisible === true', {what: 'skeleton on'});
    assert.ok((await pieces()).every(([, v]) => v === false), 'hidden with the skeleton on');
    await page.evaluate("document.getElementById('show-skeleton').click()");
    await page.waitFor('__explorer.state.skeletonVisible === false', {what: 'skeleton off'});
    assert.ok((await pieces()).every(([, v]) => v === true), 'visible again');
    assert.equal(await page.evaluate('__explorer.state.marker.visible'), false);
  }));

// ------------------------------------------------------------------------------------------------ PE-61
async function assertNoLagSession(page, description) {
  const expected = {active: false, settling: false, angles: {}, capMs: 600};
  assert.deepEqual(await lagNow(page), expected, `${description}: at rest`);
  await settled(page, firstImage(HOME)); await stable(page);
  await startLagRecording(page);
  await page.waitFor('window.__lagRec.length > 3', {what: 'recorder running'});
  await clickNext(page);
  await settled(page, firstImage(NEXT));
  await stable(page, 800);
  const rec = await stopLagRecording(page);
  assert.ok(rec.some(f => f.active && f.progress > 0), `${description}: the transition still runs`);
  for (const f of rec) assert.deepEqual(f.lag, expected, `${description}: lag throughout`);
  const arrival = rec.findLastIndex(f => f.active) + 1, last = rec.at(-1).renderCount;
  assert.ok(rec.slice(arrival + 2).every(f => f.renderCount === last), `${description}: renderCount stops within one frame of arrival`);
  assert.deepEqual([page.consoleErrors, page.consoleWarnings, page.exceptions, page.logErrors], [[], [], [], []], `${description}: no errors or warnings`);
}
browserTest('PE-61 an avatar with no valid lag node is inert: S7 is off, no console output, the transition behaves as before', async () => {
  const old = await serveS7({glb: glbWithoutLagNodes()});
  try { await withPage({hash: `#move=${HOME}`}, page => assertNoLagSession(page, 'renamed lag nodes'), old); } finally { await old.close(); }
});
const preS7 = glbAtRevision('dd3fa5d');
test('PE-61 the last pre-S7 archive-avatar.glb (dd3fa5d) is inert too', {skip: cdpSkipReason ?? (preS7 ? false : 'git history for dd3fa5d is not available')}, async () => {
  const old = await serveS7({glb: preS7});
  try { await withPage({hash: `#move=${HOME}`}, page => assertNoLagSession(page, 'pre-S7 GLB'), old); } finally { await old.close(); }
});
