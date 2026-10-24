// Slice S6, browser half: PE-42, PE-45, PE-47, PE-49 to PE-59, on a scratch fixture tree (distinct estimates per image).
// Timing and continuity are read from a page-side per-frame recorder, never from CDP polling (which cannot resolve 50 ms).
import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {browserTest, cdpSkipReason} from '../helpers/cdp.mjs';
import {selectJoint} from '../helpers/s2.mjs';
import {dot, dist} from '../helpers/page-expr.mjs';
import {
  serveS6, openS6Page, chooseSource, settled, settledNeutral, go, startRecording, stopRecording, expectedAngle,
  firstImage, angleOf, YANG_IDS, CHEN_ID, ELBOW, stable, atMidHop,
} from '../helpers/s6.mjs';

const site = cdpSkipReason ? null : await serveS6();
after(() => site?.close());

const TAG = 'TRANSITION · INTERPOLATED', MID = 'Interpolating between reviewed estimates — not a photograph', ESTIMATED = 'ESTIMATED POSE';
const via = (n, skipped = 0) => `Via ${n} reviewed estimates in sequence order${skipped ? ` · ${skipped} more skipped to keep the transition short` : ''}`;
const FRAME_MS = 1000 / 60;

async function withPage(options, fn, server = site) {
  const page = await openS6Page(server, options);
  try { return await fn(page); } finally { await page.close(); }
}
/** Record while `action` runs, until the rig shows an applied estimate for `target`, plus `tail` ms of idle frames. */
async function recordNavigation(page, action, target) {
  await startRecording(page);
  await page.waitFor('window.__rec.length > 3', {what: 'recorder running'});
  await action();
  await settled(page, target);
  await tailFrames(page);
  return stopRecording(page);
}
/** Wait for three more recorded frames (frame-based, so a loaded sidecar cannot starve the assertions of post-arrival frames). */
async function tailFrames(page, n = 3) {
  const seen = await page.evaluate('window.__rec.length');
  await page.waitFor(`window.__rec.length >= ${seen + n}`, {what: `${n} frames after arrival`, timeout: 15000});
}
/** Longest gap between consecutive recorded frames across [from, to]. */
const maxGap = (rec, from = 0, to = rec.length - 1) => Math.max(0, ...rec.slice(from + 1, to + 1).map((f, i) => f.t - rec[from + i].t));
/**
 * A shared sidecar can stall frames for a second or more. Repeat a navigation (returning to `home` between attempts) until the
 * active span has no frame gap above 100 ms, at most five times; the timing assertions still allow for the remaining gap.
 */
async function recordSteady(page, {home, action, target}) {
  let rec, steady = false;
  for (let attempt = 0; attempt < 5 && !steady; attempt++) {
    rec = await recordNavigation(page, action, target);
    const first = rec.findIndex(f => f.active && f.progress > 0), last = rec.findLastIndex(f => f.active);
    // A stall before the first progress frame hides in the gap to the frame before it: that frame must be an early tick (p < 0.05).
    steady = first >= 0 && last + 1 < rec.length && rec[first].progress < 0.05 && maxGap(rec, Math.max(0, first - 2), last + 1) <= 100;
    if (!steady && attempt < 4) { await go(page, home); await settled(page, firstImage(home)); }
  }
  return {rec, steady};
}
const NOT_STEADY = 'the sidecar stalled frames by more than 100 ms inside the transition on five attempts, so its duration cannot be measured at ±50 ms';
const activeFrames = rec => rec.filter(f => f.active);
/** First frame with progress > 0 and the first frame after the last active one: the span PE-47 times. */
function motionSpan(rec) {
  const first = rec.findIndex(f => f.active && f.progress > 0);
  const lastActive = rec.findLastIndex(f => f.active);
  assert.ok(first >= 0, 'a transition with progress > 0 was recorded');
  assert.ok(lastActive + 1 < rec.length, 'a frame after arrival was recorded');
  // A frame can only be observed after the clock has run: allow the frame gap that brackets the end of the span, and add back the
  // part of the route that elapsed before the first frame with progress > 0 was drawn (read from that frame's own eased progress).
  const slackEnd = rec[lastActive + 1].t - rec[lastActive].t;
  return {first, arrival: lastActive + 1, ms: rec[lastActive + 1].t - rec[first].t, firstProgress: rec[first].progress, slackEnd};
}
/** PE-47: the span lasts `want` ms ± 50 (plus the frame gap that can hide the true end), measured from the clock's start. */
async function assertDuration(rec, want, what = 'transition') {
  const {easeInOutCubic} = await import('../../assets/explorer/transition.js');
  const {ms, firstProgress, slackEnd} = motionSpan(rec);
  let lo = 0, hi = 1;
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (easeInOutCubic(mid) < firstProgress) lo = mid; else hi = mid; }
  const elapsed = ms + want * lo;
  assert.ok(elapsed >= want - 50 && elapsed <= want + 50 + slackEnd, `${what} lasted ${elapsed.toFixed(0)} ms from its clock start (frames ${ms.toFixed(0)} ms apart, first progress ${firstProgress.toFixed(3)}), want ${want} ± 50; frame gap at arrival ${slackEnd.toFixed(0)} ms`);
}
const constants = page => page.evaluate('(({hopMs, capMs, maxKeyframes}) => ({hopMs, capMs, maxKeyframes}))(__explorer.state.transition)');
const bonesNow = page => page.evaluate(`(() => { const r = __explorer.rig; return Object.fromEntries(r.jointNames.map(n => [n, {q: r.localOf(n), p: r.worldPositionOf(n)}])); })()`);
function assertSameBones(a, b, what) {
  for (const name of Object.keys(a)) {
    assert.ok(dot(a[name].q, b[name].q) >= 1 - 1e-9, `${what}: ${name} rotation`);
    assert.ok(dist(a[name].p, b[name].p) < 1e-4, `${what}: ${name} position`);
  }
}
/** The state a snap gives for the displayed estimate: switch to Drawings and back (two image changes). */
async function snapReference(page, target) {
  await chooseSource(page, 'montage'); await settledNeutral(page);
  await chooseSource(page, 'yang'); await settled(page, target);
  return page.evaluate(`(() => ({label: __explorer.state.label, provenance: document.getElementById('model-provenance').textContent, detail: document.getElementById('model-provenance-detail')?.textContent ?? '', readout: __explorer.state.readout}))()`);
}
/** Page-side: let queued microtasks run (the same task, as PE-16/PE-56 mean it) before the next read. */
const MICROTASKS = 'for (let i = 0; i < 20; i++) await Promise.resolve();';
/** Run `attempt()` until it returns a non-null result (it returns null when the sidecar skipped the mid-hop window), at most five times. */
async function retrying(page, home, attempt) {
  for (let n = 0; n < 5; n++) {
    const result = await attempt();
    if (result !== null) return result;
    await go(page, home); await settled(page, firstImage(home)); await page.quiet(200);
  }
  return null;
}
const clickNext = page => page.evaluate("document.getElementById('next').click()");
const clickPrevious = page => page.evaluate("document.getElementById('previous').click()");
const route = (from, to) => { const ids = []; const step = to > from ? 1 : -1; for (let id = from + step; id !== to + step; id += step) ids.push(firstImage(id)); return ids; };
const angles = (startId, targetId) => [firstImage(startId), ...route(startId, targetId)].map(angleOf);

// ------------------------------------------------------------------------------------------------ PE-42
browserTest('PE-42 on load nothing moves: the default source shows the neutral rig and no transition is ever active', () =>
  withPage({yang: false}, async page => {
    const s = await page.evaluate('__explorer.state');
    assert.equal(s.pose.kind, 'neutral');
    assert.equal(s.transition.active, false);
    await stable(page);
    const before = await page.evaluate('__explorer.state.renderCount');
    await page.quiet(3000);
    assert.equal(await page.evaluate('__explorer.state.renderCount'), before, 'renderCount is static for 3 s');
    assert.equal(await page.evaluate('window.__everActive'), false);
  }));

browserTest('PE-42 an image change onto a reviewed Yang photograph applies the estimate at once: never active, then static for 3 s', () =>
  withPage({}, async page => {
    await settled(page, firstImage(3));
    await stable(page);
    const before = await page.evaluate('__explorer.state.renderCount');
    await page.quiet(3000);
    assert.equal(await page.evaluate('__explorer.state.renderCount'), before);
    assert.equal(await page.evaluate('window.__everActive'), false, 'transition.active was never true');
    assert.ok(Math.abs(await page.evaluate(`__explorer.jointAngle('${ELBOW}')`) - angleOf(firstImage(3))) < 0.5);
  }));

browserTest('PE-42 with the empty index #move=60 gives the neutral rig and a static renderCount', async () => {
  const empty = await serveS6({ids: []});
  try {
    await withPage({hash: '#move=60', yang: false}, async page => {
      assert.equal(await page.evaluate('__explorer.state.pose.kind'), 'neutral');
      await stable(page);
      const before = await page.evaluate('__explorer.state.renderCount');
      await page.quiet(3000);
      assert.equal(await page.evaluate('__explorer.state.renderCount'), before);
      assert.equal(await page.evaluate('window.__everActive'), false);
    }, empty);
  } finally { await empty.close(); }
});

browserTest('PE-42 with #show-neutral checked, navigating leaves the bones unchanged and never transitions', () =>
  withPage({}, async page => {
    await settled(page, firstImage(3));
    await page.evaluate("document.getElementById('show-neutral').click()");
    await settledNeutral(page);
    const before = await bonesNow(page);
    await go(page, 4);
    await page.waitFor("document.getElementById('pose-image').dataset.moveId === '4'", {what: 'entry 4'});
    await page.quiet(2200);
    assertSameBones(await bonesNow(page), before, 'after navigating with Show neutral avatar on');
    assert.equal(await page.evaluate('window.__everActive'), false);
    assert.equal(await page.evaluate('__explorer.state.showNeutral'), true, 'survives navigation');
  }));

// ------------------------------------------------------------------------------------------------ PE-45 / PE-47 / PE-50 / PE-53
browserTest('PE-45/47 an adjacent Next starts a transition lasting transition.hopMs ± 50 ms; PE-58 hopsTotal is 1', t =>
  withPage({}, async page => {
    await settled(page, firstImage(3));
    const {hopMs} = await constants(page);
    const {rec, steady} = await recordSteady(page, {home: 3, action: () => clickNext(page), target: firstImage(4)});
    assert.ok(activeFrames(rec).every(f => f.to === firstImage(4) && (f.hopsTotal === 1 || f.hopsTotal === 0)), 'one hop (0 only before the route is planned)');
    assert.ok(activeFrames(rec).some(f => f.hopsTotal === 1));
    assert.equal(rec.at(-1).kind, 'estimate');
    assert.equal(rec.at(-1).imageId, firstImage(4));
    if (!steady) return t.skip(NOT_STEADY);
    await assertDuration(rec, hopMs, 'an adjacent hop');
  }));

browserTest('PE-50 labels are the transition strings from the first frame after navigation until arrival, then the PE-18 strings of a snap', () =>
  withPage({}, async page => {
    await settled(page, firstImage(3));
    const rec = await recordNavigation(page, () => clickNext(page), firstImage(4));
    const firstActive = rec.findIndex(f => f.active), arrival = rec.findLastIndex(f => f.active) + 1;
    assert.ok(firstActive >= 0);
    for (const f of rec.slice(firstActive, arrival)) {
      assert.equal(f.label, TAG); assert.equal(f.provenance, MID); assert.equal(f.kind, 'interpolated');
      if (f.hopsTotal > 0) assert.equal(f.detail, via(1), 'the count line, once the route is planned');
    }
    assert.ok(rec.slice(firstActive, arrival).some(f => f.hopsTotal > 0 && f.detail === via(1)), 'the count line appeared');
    assert.ok(rec.slice(firstActive).every(f => f.active || f.label !== ESTIMATED || f.imageId === firstImage(4)), 'the previous image never shows ESTIMATED POSE after the navigation');
    const arrived = rec[arrival];
    assert.equal(arrived.label, ESTIMATED);
    const reference = await snapReference(page, firstImage(4));
    assert.equal(arrived.provenance, reference.provenance);
    assert.equal(arrived.detail, reference.detail);
    assert.equal(arrived.label, reference.label);
    assert.notEqual(arrived.provenance, MID);
  }));

browserTest('PE-53 renderCount rises at most once per frame during a transition and stops within a frame of arrival, for 3 s', () =>
  withPage({}, async page => {
    await settled(page, firstImage(3));
    await startRecording(page);
    await page.waitFor('window.__rec.length > 3', {what: 'recorder'});
    await clickNext(page);
    await settled(page, firstImage(4));
    await page.quiet(3000);
    await tailFrames(page);
    const rec = await stopRecording(page);
    const first = rec.findIndex(f => f.active), arrival = rec.findLastIndex(f => f.active) + 1;
    for (let i = first + 1; i < arrival; i++) assert.ok(rec[i].renderCount - rec[i - 1].renderCount <= 1, `frame ${i}: renders ${rec[i - 1].renderCount} → ${rec[i].renderCount}`);
    assert.ok(rec[arrival].renderCount - rec[arrival - 1].renderCount <= 1, 'at most one render on the arrival frame');
    const after = rec.slice(arrival);
    assert.ok(after.at(-1).t - after[0].t >= 2500, `only ${(after.at(-1).t - after[0].t).toFixed(0)} ms of idle frames recorded`);
    // ADR-0008 amends PE-53: with lag nodes the driver may keep drawing, at most once per frame, while lag.settling (≤ lag.capMs), then once more
    // for the rest frame. Without lag nodes lag.settling is never true and the original wording (stop within a frame of arrival) holds.
    const capMs = await page.evaluate('__explorer.state.lag?.capMs ?? 0');
    for (let i = 1; i < after.length; i++) assert.ok(after[i].renderCount - after[i - 1].renderCount <= 1, `frame ${i} after arrival drew twice`);
    const settledAt = after.findIndex(f => !f.settling);
    assert.ok(settledAt >= 0, 'the settle window ended');
    const frameGap = maxGap(after, 0, settledAt);
    assert.ok(after[settledAt].t - after[0].t <= capMs + frameGap + 50, `settled ${(after[settledAt].t - after[0].t).toFixed(0)} ms after arrival; cap ${capMs} ms + one frame`);
    assert.ok(after.slice(settledAt).every(f => f.renderCount <= after[settledAt].renderCount + 1), 'at most one rest frame after the window');
    assert.equal(after.at(-1).renderCount, after[Math.min(after.length - 1, settledAt + 2)].renderCount, 'no render from the second frame after the window until 3 s later');
    if (!capMs) assert.ok(after.at(-1).renderCount - after[2].renderCount === 0, 'no lag: no render after the frame following arrival');
  }));

browserTest('PE-47 a 3-hop jump lasts transition.capMs ± 50 ms and passes through each keyframe at p = k/N', t =>
  withPage({hash: '#move=2'}, async page => {
    await settled(page, firstImage(2));
    const {capMs} = await constants(page);
    const ang = angles(2, 5);
    const {rec, steady} = await recordSteady(page, {home: 2, action: () => go(page, 5), target: firstImage(5)});
    const act = activeFrames(rec);
    assert.ok(act.every(f => f.hopsTotal === 3 || f.hopsTotal === 0));
    if (steady) {
      await assertDuration(rec, capMs, 'a 3-hop jump');
      assert.deepEqual([...new Set(act.map(f => f.hopIndex))], [0, 1, 2], 'every hop index in order');
    }
    const mid = act.filter(f => f.progress > 0 && f.progress < 1);
    for (const f of mid) assert.ok(Math.abs(f.angle - expectedAngle(ang, f.progress)) <= 2, `p = ${f.progress.toFixed(3)}: angle ${f.angle.toFixed(1)}, route says ${expectedAngle(ang, f.progress).toFixed(1)}`);
    assert.ok(Math.abs(rec.at(-1).angle - ang[3]) < 0.5, 'ends on the target');
    if (!steady || mid.length < 8) return t.skip(`${NOT_STEADY} (${mid.length} frames between the ends); the per-frame route-angle check above still passed`);
    for (const k of [1, 2]) {
      const nearest = mid.reduce((best, f) => (Math.abs(f.progress - k / 3) < Math.abs(best.progress - k / 3) ? f : best));
      const slope = Math.max(...[0, 1, 2].map(h => Math.abs(ang[h + 1] - ang[h]))) * 3;          // degrees per unit of p
      assert.ok(Math.abs(nearest.angle - ang[k]) <= slope * Math.abs(nearest.progress - k / 3) + 3, `near keyframe ${k} (p = ${nearest.progress.toFixed(3)}): ${nearest.angle.toFixed(1)}° vs ${ang[k]}°`);
    }
  }));

browserTest('PE-47 a jump beyond MAX_KEYFRAMES is thinned: hopsTotal ≤ maxKeyframes and the route still ends on the target', () =>
  withPage({hash: '#move=2'}, async page => {
    await settled(page, firstImage(2));
    const {maxKeyframes} = await constants(page);
    const rec = await recordNavigation(page, () => go(page, 17), firstImage(17));
    const act = activeFrames(rec);
    assert.ok(act.length > 0);
    const total = Math.max(...act.map(f => f.hopsTotal));
    assert.ok(total >= 1 && total <= maxKeyframes, `hopsTotal ${total}`);
    assert.ok(Math.abs(rec.at(-1).angle - angleOf(firstImage(17))) < 0.5);
  }));

// ------------------------------------------------------------------------------------------------ PE-49
browserTest('PE-49 with prefers-reduced-motion the target is applied with no intermediate frame', () =>
  withPage({reducedMotion: true, hash: '#move=3'}, async page => {
    assert.equal(await page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), true, 'emulation took effect');
    await settled(page, firstImage(3));
    const start = angleOf(firstImage(3)), target = angleOf(firstImage(8));
    const rec = await recordNavigation(page, () => go(page, 8), firstImage(8));
    for (const f of rec) {
      assert.ok(!(f.progress > 0 && f.progress < 1), `progress ${f.progress}`);
      const nearStart = Math.abs(f.angle - start) < 0.5, nearTarget = Math.abs(f.angle - target) < 0.5;
      assert.ok(nearStart || nearTarget, `an intermediate pose was drawn: ${f.angle.toFixed(1)}° (start ${start}, target ${target})`);
    }
    assert.equal(rec.at(-1).label, ESTIMATED);
    assert.equal(rec.at(-1).imageId, firstImage(8));
    assert.equal(await page.evaluate('__explorer.state.transition.active'), false);
  }));

// ------------------------------------------------------------------------------------------------ PE-52
browserTest('PE-52 navigating back by one mid-jump retargets from the current pose with no jump', t =>
  withPage({hash: '#move=3'}, async page => {
    await settled(page, firstImage(3));
    const newTarget = firstImage(12);
    // The pose on screen is read in the very task that clicks #previous. The retargeted route must start from exactly that pose, so its
    // first frame (progress 0) shows it: this is the PE-52 "no jump" check without depending on how far apart the frames fell.
    // #previous only sets location.hash; the navigation runs in the hashchange task, so the pose is read in a yang:image-shown listener that
    // site.js's event reaches after the explorer's own (which has already cancelled the driver and left the rig as the last frame drew it).
    const capture = `const done = new Promise(resolve => document.addEventListener('yang:image-shown', () => { const rig = __explorer.rig;
        resolve({angle: __explorer.jointAngle('${ELBOW}'), pelvis: rig.worldPositionOf('pelvis'), progress: __explorer.state.transition.progress}); }, {once: true}));
      document.getElementById('previous').click(); return done;`;
    let rec = null, before = null, i = -1;
    for (let attempt = 0; attempt < 5 && i < 0; attempt++) {
      if (attempt) { await go(page, 3); await settled(page, firstImage(3)); }
      await startRecording(page);
      await page.waitFor('window.__rec.length > 3', {what: 'recorder'});
      before = await atMidHop(page, {begin: "location.hash = 'move=13'", lo: 0.2, hi: 0.9, script: capture});
      await settled(page, before ? newTarget : firstImage(13));
      await tailFrames(page);
      rec = await stopRecording(page);
      if (!before) continue;
      const at = rec.findIndex(f => f.active && f.to === newTarget && f.hopsTotal > 0);
      if (at >= 0 && rec[at].progress < 0.01) i = at;               // the first frame of the new route, drawn before its clock got going
    }
    if (i < 0) return t.skip('no attempt caught the first frame of a retargeted route (the jump ended first, or frames stalled past it)');
    assert.ok(Math.abs(rec[i].angle - before.angle) < 0.5, `elbow ${before.angle.toFixed(2)}° on screen at the click, ${rec[i].angle.toFixed(2)}° in the first retargeted frame`);
    assert.ok(dist(rec[i].pelvis, before.pelvis) < 0.002, `pelvis ${before.pelvis} on screen at the click, ${rec[i].pelvis} in the first retargeted frame`);
    assert.ok(rec.slice(i).every(f => !f.active || f.to === newTarget), 'the route now ends at the new target');
    const last = rec.at(-1);
    assert.equal(last.label, ESTIMATED);
    assert.equal(last.imageId, newTarget);
    assert.ok(Math.abs(last.angle - angleOf(newTarget)) < 0.5);
    assert.equal(await page.evaluate('location.hash'), '#move=12');
  }));

// ------------------------------------------------------------------------------------------------ PE-51
browserTest('PE-51 during a hop the sliders are disabled, the readout speaks twice at most and the marker follows its bone', () =>
  withPage({}, async page => {
    await settled(page, firstImage(3));
    await page.evaluate(selectJoint(ELBOW));
    const readoutBefore = await page.evaluate('__explorer.state.readout');
    const rec = await recordNavigation(page, () => clickNext(page), firstImage(4));
    const act = activeFrames(rec);
    assert.ok(act.length >= 1);
    for (const f of act) {
      assert.deepEqual(f.sliders, [true, true], 'both sliders disabled');
      assert.equal(f.note, false, 'the PE-20 note is visible');
      assert.equal(f.readout, readoutBefore, 'the readout keeps its pre-transition text');
      assert.ok(f.marker && dist(f.marker, f.selectedPosition) < 1e-3, 'marker at the selected bone');
    }
    const distinct = new Set(rec.map(f => f.readout));
    assert.ok(distinct.size <= 2, [...distinct].join(' | '));
    assert.notEqual(rec.at(-1).readout, readoutBefore, 'it updates once on arrival');
    assert.deepEqual(rec.at(-1).sliders, [true, true]);
  }));

browserTest('PE-51 checking #show-neutral mid-hop cancels the transition in the same task and leaves the rig at rest', () =>
  withPage({}, async page => {
    await settled(page, firstImage(3));
    await startRecording(page);
    const s = await retrying(page, 3, () => atMidHop(page, {begin: "document.getElementById('next').click()", script: `document.getElementById('show-neutral').click(); const s = __explorer.state; return {active: s.transition.active, kind: s.pose.kind, angle: __explorer.jointAngle('${ELBOW}'), neutral: s.showNeutral};`}));
    assert.ok(s, 'the sidecar never showed the middle of a hop in five attempts');
    assert.deepEqual([s.active, s.kind, s.neutral], [false, 'neutral', true]);
    assert.ok(s.angle < 0.5, `at rest, got ${s.angle}°`);
    await page.quiet(2000);
    await tailFrames(page);
    const rec = await stopRecording(page);
    const cancelled = rec.findLastIndex(f => f.active);
    assert.ok(rec.slice(cancelled + 1).every(f => f.angle < 0.5 && f.kind === 'neutral'), 'no frame after the cancellation draws the old or an intermediate pose');
  }));

// ------------------------------------------------------------------------------------------------ PE-54 / PE-45 (c)(d)
browserTest('PE-54 an image change on one entry never transitions: Chen applies at once, Drawings gives neutral at once', () =>
  withPage({}, async page => {
    await settled(page, firstImage(3));
    await startRecording(page);
    await page.waitFor('window.__rec.length > 3', {what: 'recorder'});
    await chooseSource(page, 'chen');
    const stale = await page.evaluate('__explorer.state');
    assert.ok(stale.pose.kind === 'neutral' || stale.pose.imageId === CHEN_ID, `the label never outlives its image (PE-19): ${stale.label} for ${stale.pose.imageId}`);
    await settled(page, CHEN_ID);
    const chen = await page.evaluate('__explorer.state');
    assert.equal(chen.pose.kind, 'estimate');
    assert.equal(chen.pose.imageId, CHEN_ID);
    assert.equal(chen.label, ESTIMATED);
    assert.equal(chen.transition.active, false);
    assert.ok(Math.abs(await page.evaluate(`__explorer.jointAngle('${ELBOW}')`) - angleOf(CHEN_ID)) < 0.5);
    await chooseSource(page, 'montage');
    const drawing = await page.evaluate(`({kind: __explorer.state.pose.kind, angle: __explorer.jointAngle('${ELBOW}'), active: __explorer.state.transition.active})`);
    assert.deepEqual([drawing.kind, drawing.active], ['neutral', false]);
    assert.ok(drawing.angle < 0.5);
    await page.quiet(300);
    assert.ok((await stopRecording(page)).every(f => !f.active), 'never active');
  }));

browserTest('PE-45 (c)(d) to an unreviewed entry the result is neutral at once; from there to a reviewed one the estimate is applied at once', () =>
  withPage({}, async page => {
    let unreviewed = null;
    for (let id = 18; id < 100 && !unreviewed; id++) { const image = firstImage(id); if (image && ![...YANG_IDS, 'yang-001'].includes(image)) unreviewed = {id, image}; }
    assert.ok(unreviewed, 'a catalogue entry whose Yang photograph is outside the fixture index');
    await settled(page, firstImage(3));
    await startRecording(page);
    await page.waitFor('window.__rec.length > 3', {what: 'recorder'});
    await go(page, unreviewed.id);
    await settledNeutral(page);
    const neutral = await page.evaluate(`({label: __explorer.state.label, angle: __explorer.jointAngle('${ELBOW}'), detail: document.getElementById('model-provenance').textContent})`);
    assert.equal(neutral.label, 'ILLUSTRATIVE AVATAR');
    assert.ok(neutral.angle < 0.5);
    await go(page, 4);
    await settled(page, firstImage(4));
    await tailFrames(page);
    const rec = await stopRecording(page);
    assert.ok(rec.every(f => !f.active), 'transition.active was never true');
    assert.ok(Math.abs(rec.at(-1).angle - angleOf(firstImage(4))) < 0.5);
  }));

// ------------------------------------------------------------------------------------------------ PE-56
browserTest('PE-56 reset mid-hop cancels in the same task and shows the displayed image\'s estimate with no intermediate frame', () =>
  withPage({}, async page => {
    await settled(page, firstImage(3));
    await startRecording(page);
    const s = await retrying(page, 3, () => atMidHop(page, {begin: "document.getElementById('next').click()", script: `document.getElementById('reset-view').click(); ${MICROTASKS} const s = __explorer.state; return {active: s.transition.active, neutral: s.showNeutral, kind: s.pose.kind, imageId: s.pose.imageId, angle: __explorer.jointAngle('${ELBOW}'), label: s.label};`}));
    assert.ok(s, 'the sidecar never showed the middle of a hop in five attempts');
    assert.equal(s.active, false);
    assert.equal(s.neutral, false);
    assert.deepEqual([s.kind, s.imageId, s.label], ['estimate', firstImage(4), ESTIMATED]);
    assert.ok(Math.abs(s.angle - angleOf(firstImage(4))) < 0.5);
    await page.quiet(300);
    await tailFrames(page);
    const rec = await stopRecording(page);
    const cancelled = rec.findLastIndex(f => f.active);
    assert.ok(rec.slice(cancelled + 1).every(f => Math.abs(f.angle - angleOf(firstImage(4))) < 0.5), 'no frame between the mid-hop pose and the target');
  }));

// ------------------------------------------------------------------------------------------------ PE-57
browserTest('PE-57 Enter on #next runs the same transition and focus stays on #next', t =>
  withPage({}, async page => {
    await settled(page, firstImage(3));
    const {hopMs} = await constants(page);
    assert.equal(await page.evaluate("(() => { document.getElementById('next').focus(); return document.activeElement.id; })()"), 'next');
    const enter = async () => {
      await page.evaluate("document.getElementById('next').focus()");
      for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', {type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === 'keyDown' ? {text: '\r'} : {})});
    };
    const {rec, steady} = await recordSteady(page, {home: 3, action: enter, target: firstImage(4)});
    assert.equal(await page.evaluate('document.activeElement.id'), 'next', 'focus did not move');
    assert.ok(activeFrames(rec).length >= 1 && activeFrames(rec).every(f => f.label === TAG));
    if (!steady) return t.skip(NOT_STEADY);
    await assertDuration(rec, hopMs, 'a keyboard-triggered hop');
  }));

browserTest('PE-57 a typed #move= hash runs the same transition', () =>
  withPage({hash: '#move=3'}, async page => {
    await settled(page, firstImage(3));
    const rec = await recordNavigation(page, () => page.evaluate("location.hash = '#move=4'"), firstImage(4));
    const act = activeFrames(rec);
    assert.ok(act.length >= 1 && act.every(f => f.label === TAG), 'the transition label showed');
  }));

// ------------------------------------------------------------------------------------------------ PE-58
browserTest('PE-58 the snapshot carries transition {active, from, to, progress, hopsTotal, hopIndex, skipped, hopMs, capMs, maxKeyframes}', () =>
  withPage({}, async page => {
    const {HOP_MS, CAP_MS, MAX_KEYFRAMES} = await import('../../assets/explorer/transition.js');
    const shape = {active: 'boolean', from: 'object', to: 'object', progress: 'number', hopsTotal: 'number', hopIndex: 'number', skipped: 'number', hopMs: 'number', capMs: 'number', maxKeyframes: 'number'};
    await settled(page, firstImage(3));
    const rest = await page.evaluate('__explorer.state.transition');
    assert.deepEqual(rest, {active: false, from: null, to: null, progress: 0, hopsTotal: 0, hopIndex: 0, skipped: 0, hopMs: HOP_MS, capMs: CAP_MS, maxKeyframes: MAX_KEYFRAMES});
    assert.equal(typeof await page.evaluate('__explorer.state.showNeutral'), 'boolean');
    await startRecording(page);
    const mid = await retrying(page, 3, () => atMidHop(page, {begin: "document.getElementById('next').click()", lo: 0.05, script: 'return __explorer.state.transition;'}));
    assert.ok(mid, 'the sidecar never showed the middle of a hop in five attempts');
    for (const [key, type] of Object.entries(shape)) if (!['from', 'to'].includes(key)) assert.equal(typeof mid[key], type, key);
    assert.equal(typeof mid.from, 'string'); assert.equal(typeof mid.to, 'string');
    assert.equal(mid.from, firstImage(3));
    assert.equal(mid.to, firstImage(4));
    assert.ok(mid.hopIndex < mid.hopsTotal);
    assert.ok(mid.progress >= 0 && mid.progress <= 1);
    assert.deepEqual([mid.hopMs, mid.capMs, mid.maxKeyframes], [HOP_MS, CAP_MS, MAX_KEYFRAMES]);
    await settled(page, firstImage(4));
    assert.deepEqual(await page.evaluate('__explorer.state.transition'), rest);
    await stopRecording(page);
  }));

// ------------------------------------------------------------------------------------------------ PE-59
browserTest('PE-59 nothing is persisted and the pose after a 5-hop transition equals the target applied directly', () =>
  withPage({hash: '#move=3'}, async page => {
    await settled(page, firstImage(3));
    const stores = () => page.evaluate('({local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookie: document.cookie})');
    const before = await stores();
    const rec = await recordNavigation(page, () => go(page, 8), firstImage(8));
    assert.equal(Math.max(...activeFrames(rec).map(f => f.hopsTotal)), 5);
    assert.ok(rec.filter(f => f.active).every(f => f.kind === 'interpolated'), 'interpolated only while active');
    assert.ok(rec.filter(f => !f.active).every(f => f.kind !== 'interpolated'));
    assert.deepEqual(await stores(), before);
    assert.equal(await page.evaluate('location.hash'), '#move=8');
    assert.equal(await page.evaluate('location.search'), '?explorer-test=1');
    assert.deepEqual(Object.keys(await page.evaluate('__explorer.actions')).filter(k => /interpol/i.test(k)), []);
    const after = await bonesNow(page);
    await snapReference(page, firstImage(8));
    assertSameBones(after, await bonesNow(page), 'transition arrival vs direct apply');
  }));

// ------------------------------------------------------------------------------------------------ PE-55
browserTest('PE-55 a corrupt intermediate file is dropped with one warning and no error; the route has one hop fewer', async () => {
  const bad = firstImage(5);
  const corrupt = await serveS6({corrupt: [bad]});
  try {
    await withPage({hash: '#move=3'}, async page => {
      await settled(page, firstImage(3));
      const rec = await recordNavigation(page, () => go(page, 7), firstImage(7));
      const act = activeFrames(rec);
      assert.ok(act.length > 0);
      const running = act.filter(f => f.progress > 0);
      assert.ok(running.length > 0);
      assert.deepEqual([...new Set(running.map(f => f.hopsTotal))], [3], 'keyframes 4, 5, 6, 7 minus the corrupt one');
      assert.equal(page.consoleWarnings.length, 1, page.consoleWarnings.join('\n'));
      assert.deepEqual([...page.consoleErrors, ...page.logErrors, ...page.exceptions], []);
      assert.ok(running.every(f => f.detail === via(3)), 'the label counts the hops that really run');
      assert.equal(rec.at(-1).imageId, firstImage(7));
    }, corrupt);
  } finally { await corrupt.close(); }
});

browserTest('PE-55 pose files are requested only by index entry, at most one per route keyframe, and not at all for unreachable entries', () =>
  withPage({hash: '#move=3'}, async page => {
    await settled(page, firstImage(3));
    const mark = site.poseRequests().length;
    await recordNavigation(page, () => go(page, 6), firstImage(6));
    const fetched = site.poseRequests().slice(mark).filter(f => f !== 'index.json');
    const allowed = new Set(route(3, 6).map(id => `${id}.json`));
    assert.ok(fetched.every(f => allowed.has(f)), fetched.join(', '));
    assert.equal(new Set(fetched).size, fetched.length, 'each at most once');
  }));
