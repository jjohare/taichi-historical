// Slice S6, node half: PE-43 to PE-48, PE-50 (strings), PE-53 (fake-clock driver), PE-59 (static). Failing first:
// assets/explorer/transition.js does not exist until the slice lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {EXPLORER_DIR, stripComments} from '../helpers/files.mjs';
import {restData, POSE_JOINTS, axisAngle} from '../helpers/poses.mjs';
import {Quaternion} from '../../assets/vendor/three.core.js';
import {catalogue, bySequence} from '../helpers/s6.mjs';

const T = () => import('../../assets/explorer/transition.js');
const TRANSITION_JS = path.join(EXPLORER_DIR, 'transition.js');
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);
const qdot = (a, b) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) / (Math.hypot(...a) * Math.hypot(...b));
const IDENT = [0, 0, 0, 1];
const pose = (joints = {}, root = {}) => ({joints: Object.fromEntries(Object.entries(joints).map(([k, v]) => [k, {rotation: v}])), root: {translation: [0, 0, 0], rotation: IDENT, ...root}});

// A synthetic sequence: element i has image `img<i>` unless overridden.
const seq = (ids) => ids.map((imageId, i) => ({moveId: i, imageId}));

test('PE-47/48 transition.js exists and exports the documented names', async () => {
  assert.ok(existsSync(TRANSITION_JS), 'assets/explorer/transition.js is missing');
  const m = await T();
  for (const name of ['HOP_MS', 'CAP_MS', 'MAX_KEYFRAMES', 'keyframeSequence', 'planRoute', 'routeTiming', 'easeInOutCubic', 'interpolatePose', 'sampleRoute', 'createDriver']) {
    assert.ok(name in m, `missing export ${name}`);
  }
});

test('PE-47/48 the shipped constants are 1600, 3000 and 24', async () => {
  const {HOP_MS, CAP_MS, MAX_KEYFRAMES} = await T();
  assert.deepEqual([HOP_MS, CAP_MS, MAX_KEYFRAMES], [1600, 3000, 24]);
});

// ------------------------------------------------------------------------------------------------ PE-43
test('PE-43 keyframeSequence: one element per entry in ordinal order; yang always has an image; chen has exactly one null; montage is all null', async () => {
  const {keyframeSequence} = await T();
  const yang = keyframeSequence(catalogue, 'yang'), chen = keyframeSequence(catalogue, 'chen'), montage = keyframeSequence(catalogue, 'montage');
  for (const s of [yang, chen, montage]) {
    assert.equal(s.length, 103);
    assert.deepEqual(s.map(e => e.moveId), bySequence.map(e => e.id), 'ascending ordinal order');
    assert.ok(s.every(e => Object.keys(e).sort().join() === 'imageId,moveId'));
  }
  assert.ok(yang.every(e => /^yang-\d{3}$/.test(e.imageId)));
  assert.equal(chen.filter(e => e.imageId === null).length, 1);
  assert.ok(chen.filter(e => e.imageId !== null).every(e => /^chen-\d{3}$/.test(e.imageId)));
  assert.ok(montage.every(e => e.imageId === null));
});

test('PE-43 keyframeSequence follows what site.js shows: the first image of that source', async () => {
  const {keyframeSequence} = await T();
  const yang = keyframeSequence(catalogue, 'yang');
  for (const entry of bySequence.slice(0, 20)) {
    const first = entry.images.find(i => i.source === 'yang').file.replace(/\.png$/, '');
    assert.equal(yang.find(e => e.moveId === entry.id).imageId, first, `entry ${entry.id}`);
  }
});

test('PE-43 sequenceIndexOf finds a move id and returns −1 for an absent one', async () => {
  const {keyframeSequence, sequenceIndexOf} = await T();
  const s = keyframeSequence(catalogue, 'yang');
  assert.equal(sequenceIndexOf(s, bySequence[7].id), 7);
  assert.equal(sequenceIndexOf(s, 99999), -1);
});

// ------------------------------------------------------------------------------------------------ PE-44
for (const [kind, make] of [['Set', ids => new Set(ids)], ['Map', ids => new Map(ids.map(i => [i, {}]))]]) {
  test(`PE-44 planRoute (${kind} index): forward, backward, skipping, collapsing, empty, unreviewed target`, async () => {
    const {planRoute} = await T();
    const s = seq(['a', 'b', 'c', 'd', 'e', 'f']);
    const all = make(['a', 'b', 'c', 'd', 'e', 'f']);
    assert.deepEqual(planRoute(s, 0, 3, all), {keyframes: ['b', 'c', 'd'], skipped: 0}, 'forward');
    assert.deepEqual(planRoute(s, 4, 1, all), {keyframes: ['d', 'c', 'b'], skipped: 0}, 'backward gives the reversed route');
    assert.deepEqual(planRoute(s, 2, 2, all).keyframes, [], 'from === to');
    assert.deepEqual(planRoute(s, 0, 4, make(['a', 'b', 'e'])).keyframes, ['b', 'e'], 'unreviewed c, d are skipped');
    assert.deepEqual(planRoute(s, 0, 3, make(['a', 'b', 'c'])), {keyframes: [], skipped: 0}, 'an unreviewed target gives no transition');
    const withNull = seq(['a', null, 'c', 'd']);
    assert.deepEqual(planRoute(withNull, 0, 3, make(['a', 'c', 'd'])).keyframes, ['c', 'd'], 'null images are skipped');
    assert.deepEqual(planRoute(withNull, 0, 1, make(['a'])).keyframes, [], 'a null target gives no transition');
    assert.equal(planRoute(s, 0, 5, all).skipped, 0);
  });

  test(`PE-44 planRoute (${kind} index): the keyframes are strictly after fromIndex and the target is last`, async () => {
    const {planRoute} = await T();
    const s = seq(['a', 'b', 'c', 'd']), idx = make(['a', 'b', 'c', 'd']);
    const forward = planRoute(s, 1, 3, idx).keyframes;
    assert.deepEqual(forward, ['c', 'd']);
    assert.equal(forward.at(-1), 'd');
    assert.equal(planRoute(s, 3, 1, idx).keyframes.at(-1), 'b');
  });

  test(`PE-44 planRoute (${kind} index): consecutive equal ids collapse, including one equal to the start image`, async () => {
    const {planRoute} = await T();
    const idx = make(['a', 'b', 'c']);
    assert.deepEqual(planRoute(seq(['a', 'b', 'b', 'b', 'c']), 0, 4, idx).keyframes, ['b', 'c'], 'a run of three equal ids is one keyframe');
    assert.deepEqual(planRoute(seq(['a', 'a', 'b']), 0, 2, idx, {startImageId: 'a'}).keyframes, ['b'], 'a repeat of the start image costs no hop');
    assert.deepEqual(planRoute(seq(['x', 'a', 'b']), 0, 2, idx, {startImageId: 'a'}).keyframes, ['b'], 'startImageId overrides the sequence element at fromIndex');
    assert.deepEqual(planRoute(seq(['a', 'b', 'a']), 0, 2, idx).keyframes, ['b', 'a'], 'non-adjacent repeats stay');
    assert.deepEqual(planRoute(seq(['a', 'a']), 0, 1, idx, {startImageId: 'a'}).keyframes, [], 'the same photograph at both ends: nothing to move through');
  });
}

test('PE-44 planRoute against the real catalogue with a full index: the Yang route ordinal 1 → 103 has no adjacent equal ids', async () => {
  const {keyframeSequence, planRoute} = await T();
  const s = keyframeSequence(catalogue, 'yang');
  const route = planRoute(s, 0, 102, new Set(s.map(e => e.imageId)));
  assert.ok(route.keyframes.length > 24 - 1, 'a long route');
  for (let i = 1; i < route.keyframes.length; i++) assert.notEqual(route.keyframes[i], route.keyframes[i - 1], `adjacent equal at ${i}`);
  assert.equal(route.keyframes.at(-1), s[102].imageId, 'ends on the target');
});

// ------------------------------------------------------------------------------------------------ PE-48
test('PE-48 thinning: 24 keyframes are all kept; 25 give 24 including the target and skipped 1; 80 give 24 evenly spaced', async () => {
  const {planRoute, MAX_KEYFRAMES} = await T();
  const mk = n => { const ids = Array.from({length: n + 1}, (_, i) => `k${i}`); return {s: seq(ids), idx: new Set(ids)}; };
  for (const [m, expectedSkipped] of [[MAX_KEYFRAMES, 0], [MAX_KEYFRAMES + 1, 1], [MAX_KEYFRAMES + 56, 56]]) {
    const {s, idx} = mk(m);
    const r = planRoute(s, 0, m, idx);
    assert.equal(r.keyframes.length, MAX_KEYFRAMES, `M = ${m}`);
    assert.equal(r.skipped, expectedSkipped, `M = ${m}`);
    assert.equal(r.keyframes.at(-1), `k${m}`, 'the target is kept');
    const positions = r.keyframes.map(k => Number(k.slice(1)));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'in travel order');
    assert.equal(new Set(positions).size, MAX_KEYFRAMES, 'distinct');
    const gaps = positions.map((p, i) => p - (positions[i - 1] ?? 0));
    assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `M = ${m}: gaps differ by at most 1 (${gaps})`);
  }
});

test('PE-48 thinning counts only reviewed keyframes: skipped = M − 24 where M is the post-collapse, post-skip count', async () => {
  const {planRoute, MAX_KEYFRAMES} = await T();
  const ids = Array.from({length: 61}, (_, i) => `k${i}`);
  const s = seq(ids), idx = new Set(ids.filter((_, i) => i % 2 === 0 || i === 60));
  const m = ids.filter((_, i) => i > 0 && (i % 2 === 0)).length;       // reviewed after the start, target 60 included
  const r = planRoute(s, 0, 60, idx);
  assert.equal(r.keyframes.length, MAX_KEYFRAMES);
  assert.equal(r.skipped, m - MAX_KEYFRAMES);
  assert.equal(r.keyframes.at(-1), 'k60');
});

// ------------------------------------------------------------------------------------------------ PE-47
test('PE-47 routeTiming: total = min(HOP_MS·N, CAP_MS), perHop = min(HOP_MS, CAP_MS/N), from the exports', async () => {
  const {routeTiming, HOP_MS, CAP_MS} = await T();
  assert.deepEqual(routeTiming(1), {total: HOP_MS, perHop: HOP_MS});
  assert.deepEqual(routeTiming(2), {total: CAP_MS, perHop: CAP_MS / 2});
  assert.deepEqual(routeTiming(20), {total: CAP_MS, perHop: CAP_MS / 20});
  for (const n of [1, 2, 3, 5, 24]) {
    const t = routeTiming(n);
    assert.equal(t.total, Math.min(HOP_MS * n, CAP_MS), `N = ${n}`);
    near(t.perHop, Math.min(HOP_MS, CAP_MS / n), 1e-9, `perHop N = ${n}`);
  }
});

test('PE-47 easeInOutCubic: x<0.5 ? 4x³ : 1 − (−2x+2)³/2, fixed ends, midpoint 0.5, monotone', async () => {
  const {easeInOutCubic} = await T();
  const ref = x => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  near(easeInOutCubic(0.5), 0.5, 1e-12, 'midpoint');
  let last = -1;
  for (let i = 0; i <= 100; i++) {
    const x = i / 100, y = easeInOutCubic(x);
    near(y, ref(x), 1e-12, `x = ${x}`);
    assert.ok(y >= last, 'monotone');
    last = y;
  }
});

// ------------------------------------------------------------------------------------------------ PE-46
test('PE-46 interpolatePose: t = 0 and t = 1 return the endpoints; output keys are only {joints, root}', async () => {
  const {interpolatePose} = await T();
  const a = pose({left_elbow: axisAngle([1, 0, 0], 20), right_knee: axisAngle([0, 0, 1], -30)}, {translation: [0, 0.1, 0.2], rotation: axisAngle([0, 1, 0], 10)});
  const b = pose({left_elbow: axisAngle([1, 0, 0], 80), left_hip: axisAngle([0, 1, 0], 40)}, {translation: [0.3, -0.2, 0], rotation: axisAngle([0, 1, 0], 50)});
  for (const [t, from] of [[0, a], [1, b]]) {
    const r = interpolatePose(a, b, t);
    assert.deepEqual(Object.keys(r).sort(), ['joints', 'root']);
    for (const joint of POSE_JOINTS) {
      const want = from.joints[joint]?.rotation ?? IDENT;
      assert.ok(qdot(r.joints[joint]?.rotation ?? IDENT, want) >= 1 - 1e-9, `${joint} at t = ${t}`);
    }
    assert.ok(qdot(r.root.rotation, from.root.rotation) >= 1 - 1e-9, `root rotation at t = ${t}`);
    r.root.translation.forEach((v, i) => near(v, from.root.translation[i], 1e-4, `translation ${i} at t = ${t}`));
  }
});

test('PE-46 interpolatePose: 90° about +Y at t = 0.5 is 45° about +Y; translation midpoint is exact', async () => {
  const {interpolatePose} = await T();
  const a = pose({left_elbow: IDENT}, {translation: [0, 0, 0]}), b = pose({left_elbow: axisAngle([0, 1, 0], 90)}, {translation: [0.2, -0.4, 0.6]});
  const r = interpolatePose(a, b, 0.5);
  assert.ok(qdot(r.joints.left_elbow.rotation, axisAngle([0, 1, 0], 45)) >= 1 - 1e-9);
  assert.deepEqual(r.root.translation.map(v => Math.round(v * 1e9) / 1e9), [0.1, -0.2, 0.3]);
});

test('PE-46 interpolatePose takes the shortest arc: b = −a gives a at every t', async () => {
  const {interpolatePose} = await T();
  const q = axisAngle([1, 1, 0], 70), negated = q.map(v => -v);
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const r = interpolatePose(pose({left_elbow: q}), pose({left_elbow: negated}), t);
    assert.ok(qdot(r.joints.left_elbow.rotation, q) >= 1 - 1e-9, `t = ${t}`);
  }
  // 300° the long way round is 60° the short way.
  const r = interpolatePose(pose({left_elbow: axisAngle([0, 0, 1], 0)}), pose({left_elbow: axisAngle([0, 0, 1], 300)}), 0.5);
  assert.ok(qdot(r.joints.left_elbow.rotation, axisAngle([0, 0, 1], -30)) >= 1 - 1e-9, 'the midpoint of a 300° pair is −30°');
});

test('PE-46 a joint missing from one file counts as identity and moves from or to it', async () => {
  const {interpolatePose} = await T();
  const only = pose({left_hip: axisAngle([1, 0, 0], 60)}), none = pose({});
  assert.ok(qdot(interpolatePose(none, only, 0.5).joints.left_hip.rotation, axisAngle([1, 0, 0], 30)) >= 1 - 1e-9);
  assert.ok(qdot(interpolatePose(only, none, 0.5).joints.left_hip.rotation, axisAngle([1, 0, 0], 30)) >= 1 - 1e-9);
});

test('PE-46 interpolatePose is pure: the inputs are not modified', async () => {
  const {interpolatePose} = await T();
  const a = pose({left_elbow: axisAngle([1, 0, 0], 10)}), b = pose({left_elbow: axisAngle([1, 0, 0], 70)}, {translation: [1, 2, 3]});
  const before = JSON.stringify([a, b]);
  interpolatePose(a, b, 0.3);
  assert.equal(JSON.stringify([a, b]), before);
});

test('PE-46 interpolatePose then applyPose matches slerping the local quaternions L to 1e-9', async () => {
  const {interpolatePose} = await T();
  const {applyPose} = await import('../../assets/explorer/retarget.js');
  const a = pose({left_elbow: axisAngle([1, 0, 0], 20), left_hip: axisAngle([0, 1, 0], -35), spine2: axisAngle([0, 0, 1], 15)}, {rotation: axisAngle([0, 1, 0], 10), translation: [0, 0, 0]});
  const b = pose({left_elbow: axisAngle([1, 0, 0], 90), left_hip: axisAngle([0, 1, 0], 25), right_knee: axisAngle([1, 0, 0], 40)}, {rotation: axisAngle([0, 1, 0], 70), translation: [0.2, 0.1, 0]});
  const La = applyPose(restData, a).locals, Lb = applyPose(restData, b).locals;
  for (const t of [0.2, 0.5, 0.85]) {
    const got = applyPose(restData, interpolatePose(a, b, t)).locals;
    for (const [name, local] of got) {
      const want = new Quaternion().fromArray(La.get(name)).slerp(new Quaternion().fromArray(Lb.get(name)), t).toArray();
      assert.ok(qdot(local, want) >= 1 - 1e-9, `${name} at t = ${t}`);
    }
  }
});

// ------------------------------------------------------------------------------------------------ sampleRoute
test('PE-47 sampleRoute: keyframe k is reached exactly at p = k/N and hop = min(N−1, floor(p·N))', async () => {
  const {sampleRoute} = await T();
  const poses = [0, 40, 10, 70].map(deg => pose({left_elbow: axisAngle([1, 0, 0], deg)}));
  const angle = p => { const r = sampleRoute(poses, p); const q = r.pose.joints.left_elbow.rotation; return {deg: 2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180 / Math.PI, hop: r.hopIndex}; };
  near(angle(0).deg, 0, 1e-6, 'p = 0');
  near(angle(1 / 3).deg, 40, 1e-6, 'p = 1/3');
  near(angle(2 / 3).deg, 10, 1e-6, 'p = 2/3');
  near(angle(1).deg, 70, 1e-6, 'p = 1');
  near(angle(1 / 6).deg, 20, 1e-6, 'halfway through hop 0');
  assert.deepEqual([0, 0.2, 0.5, 0.9, 1].map(p => angle(p).hop), [0, 0, 1, 2, 2]);
});

// ------------------------------------------------------------------------------------------------ driver
function fakeClock() {
  let time = 0, next = 1;
  const queue = new Map();
  return {
    now: () => time,
    requestFrame: fn => { const id = next++; queue.set(id, fn); return id; },
    cancelFrame: id => queue.delete(id),
    pending: () => queue.size,
    /** Advance by `ms` and run the callbacks that were queued before the advance. */
    step(ms) { time += ms; const run = [...queue.values()]; queue.clear(); run.forEach(fn => fn(time)); },
  };
}

function driverRun(createDriver, clock, hops, extra = {}) {
  const frames = [], arrivals = [];
  let requestsAfterArrival = 0;
  const driver = createDriver({
    requestFrame: fn => { if (arrivals.length) requestsAfterArrival++; return clock.requestFrame(fn); }, cancelFrame: clock.cancelFrame, now: clock.now,
    onFrame: (sample, p) => frames.push({hop: sample.hopIndex, p, pose: sample.pose}),
    onArrive: () => arrivals.push(clock.now()),
    ...extra,
  });
  const poses = Array.from({length: hops + 1}, (_, i) => pose({left_elbow: axisAngle([1, 0, 0], i * 15)}));
  return {driver, frames, arrivals, poses, requestsAfterArrival: () => requestsAfterArrival};
}

test('PE-47 driver on a fake clock: hopIndex takes every value 0…N−1 in order for N = 5 at 60 Hz; p = 0.5 at T/2; lasts T', async () => {
  const {createDriver, routeTiming, easeInOutCubic} = await T();
  const clock = fakeClock(), N = 5, {total} = routeTiming(N);
  const run = driverRun(createDriver, clock, N);
  run.driver.start(run.poses, {hopsTotal: N, skipped: 0});
  for (let i = 0; i < 400 && !run.arrivals.length; i++) clock.step(1000 / 60);
  assert.equal(run.arrivals.length, 1, 'arrived exactly once');
  near(run.arrivals[0], total, 1000 / 60 + 1, 'arrival time is T to within a frame');
  const order = [...new Set(run.frames.map(f => f.hop))];
  assert.deepEqual(order, [0, 1, 2, 3, 4]);
  assert.deepEqual(run.frames.map(f => f.hop), [...run.frames.map(f => f.hop)].sort((a, b) => a - b), 'monotone');
  const half = run.frames.reduce((best, f) => (Math.abs(f.p - 0.5) < Math.abs(best.p - 0.5) ? f : best));
  near(half.p, 0.5, 0.02, 'a frame near T/2 has p ≈ 0.5');
  const fresh = fakeClock(), second = driverRun(createDriver, fresh, N);
  second.driver.start(second.poses, {hopsTotal: N, skipped: 0});
  fresh.step(total / 2);
  near(second.frames.at(-1).p, easeInOutCubic(0.5), 1e-9, 'p at T/2');
  near(second.frames.at(-1).p, 0.5, 1e-9, 'which is 0.5');
});

test('PE-47 driver: the last frame is the exact last pose, then onArrive, and the figure does not pause at intermediate keyframes', async () => {
  const {createDriver} = await T();
  const clock = fakeClock(), run = driverRun(createDriver, clock, 3);
  run.driver.start(run.poses, {hopsTotal: 3, skipped: 0});
  for (let i = 0; i < 400 && !run.arrivals.length; i++) clock.step(10);
  const last = run.frames.at(-1);
  assert.equal(last.p, 1);
  assert.deepEqual(last.pose.joints.left_elbow.rotation.map(v => Math.round(v * 1e9) / 1e9), run.poses.at(-1).joints.left_elbow.rotation.map(v => Math.round(v * 1e9) / 1e9));
  const speeds = run.frames.slice(1).map((f, i) => f.p - run.frames[i].p);
  assert.ok(speeds.slice(5, -5).every(s => s > 0), 'progress rises on every frame between the eased ends');
});

test('PE-53 driver: no requestFrame after onArrive and none outstanding; cancel stops without onArrive', async () => {
  const {createDriver, routeTiming} = await T();
  const clock = fakeClock(), run = driverRun(createDriver, clock, 2);
  run.driver.start(run.poses, {hopsTotal: 2, skipped: 0});
  clock.step(routeTiming(2).total + 1);
  clock.step(1000);
  assert.equal(run.arrivals.length, 1);
  assert.equal(run.requestsAfterArrival(), 0, 'no frame requested after arrival');
  assert.equal(clock.pending(), 0, 'nothing queued');

  const clock2 = fakeClock(), run2 = driverRun(createDriver, clock2, 2);
  run2.driver.start(run2.poses, {hopsTotal: 2, skipped: 0});
  clock2.step(100);
  run2.driver.cancel();
  clock2.step(5000);
  assert.equal(run2.arrivals.length, 0, 'cancel does not call onArrive');
  assert.equal(clock2.pending(), 0);
});

test('PE-49/56 driver.finish applies the last pose, calls onArrive once and requests no further frame', async () => {
  const {createDriver} = await T();
  const clock = fakeClock(), run = driverRun(createDriver, clock, 4);
  run.driver.start(run.poses, {hopsTotal: 4, skipped: 0});
  run.driver.finish();
  clock.step(5000);
  assert.equal(run.arrivals.length, 1);
  assert.equal(clock.pending(), 0);
  assert.ok(run.frames.every(f => f.p === 0 || f.p === 1), 'no intermediate progress was reported');
});

test('PE-52 driver.retarget restarts the clock with a fresh T for the new route, starting from the supplied pose', async () => {
  const {createDriver, routeTiming} = await T();
  const clock = fakeClock(), run = driverRun(createDriver, clock, 10);
  run.driver.start(run.poses, {hopsTotal: 10, skipped: 0});
  clock.step(1000);
  const here = run.driver.current();
  assert.ok(here && here.progress > 0 && here.progress < 1);
  const next = [here.pose, pose({left_elbow: axisAngle([1, 0, 0], 33)})];
  run.driver.retarget(next, {hopsTotal: 1, skipped: 0});
  const t0 = clock.now();
  for (let i = 0; i < 400 && !run.arrivals.length; i++) clock.step(10);
  near(run.arrivals[0] - t0, routeTiming(1).total, 20, 'the new route lasts its own T, not the remainder of the old one');
  assert.equal(run.arrivals.length, 1);
});

// ------------------------------------------------------------------------------------------------ PE-50
test('PE-50 provenanceFor({kind:"interpolated"}) returns the exact transition strings', async () => {
  const {provenanceFor} = await import('../../assets/explorer/provenance.js');
  const p = {kind: 'interpolated', fromImageId: 'yang-001', toImageId: 'yang-009'};
  const a = provenanceFor(p, {rig: 'avatar', transition: {hopsTotal: 3, skipped: 0}});
  assert.equal(a.tag, 'TRANSITION · INTERPOLATED');
  assert.equal(a.text, 'Interpolating between reviewed estimates — not a photograph');
  assert.equal(a.detail, 'Via 3 reviewed estimates in sequence order');
  const b = provenanceFor(p, {rig: 'avatar', transition: {hopsTotal: 24, skipped: 31}});
  assert.equal(b.detail, 'Via 24 reviewed estimates in sequence order · 31 more skipped to keep the transition short');
  const one = provenanceFor(p, {rig: 'avatar', transition: {hopsTotal: 1, skipped: 0}});
  assert.equal(one.detail, 'Via 1 reviewed estimates in sequence order', 'the literal spec string, plural included');
});

// ------------------------------------------------------------------------------------------------ PE-59 / PE-08
test('PE-59 transition.js has no localStorage, sessionStorage, history or location reference', () => {
  assert.ok(existsSync(TRANSITION_JS), 'assets/explorer/transition.js is missing');
  const code = stripComments(readFileSync(TRANSITION_JS, 'utf8'));
  for (const word of ['localStorage', 'sessionStorage', 'history', 'location', 'document', 'window', 'cookie']) {
    assert.ok(!new RegExp(`\\b${word}\\b`).test(code), `transition.js mentions ${word}`);
  }
});

test('PE-08 (amended) transition.js is the only explorer module that schedules frames, and only through the injected requestFrame', () => {
  assert.ok(existsSync(TRANSITION_JS), 'assets/explorer/transition.js is missing');
  const code = stripComments(readFileSync(TRANSITION_JS, 'utf8'));
  assert.ok(!/\brequestAnimationFrame\b|\bsetAnimationLoop\b|\bsetInterval\b|\bsetTimeout\b/.test(code), 'transition.js must use the injected clock and scheduler');
  assert.match(code, /requestFrame/);
});

test('PE-59 transition.js imports only pure modules (three.core.js, pose-schema.js)', () => {
  assert.ok(existsSync(TRANSITION_JS), 'assets/explorer/transition.js is missing');
  const source = readFileSync(TRANSITION_JS, 'utf8');
  const imports = [...stripComments(source).matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.ok(imports.every(i => /(three\.core|pose-schema)\.js$/.test(i)), `imports: ${imports}`);
});
