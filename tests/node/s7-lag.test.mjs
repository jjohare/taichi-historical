// Slice S7, node half: PE-60 (GLB), PE-62/63/64 (dynamics), PE-69/70/71 (static). Failing first: assets/explorer/lag.js
// does not exist until the slice lands. Constants are always read from the module's exports, never written as literals.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {EXPLORER_DIR, ROOT, stripComments} from '../helpers/files.mjs';
import {loadGlbJson} from '../helpers/glb.mjs';

const LAG_JS = path.join(EXPLORER_DIR, 'lag.js');
const L = () => import('../../assets/explorer/lag.js');
const REPORT = JSON.parse(readFileSync(path.join(ROOT, 'assets/model/build-report.json'), 'utf8'));
const glb = loadGlbJson();
const parentOf = new Map();
glb.nodes.forEach((n, i) => (n.children ?? []).forEach(c => parentOf.set(c, i)));
const lagIndexes = glb.nodes.map((n, i) => (n.name?.startsWith('lag:') ? i : -1)).filter(i => i >= 0);
const subtree = i => [i, ...(glb.nodes[i].children ?? []).flatMap(subtree)];

// ------------------------------------------------------------------------------------------------ PE-60
test('PE-60 the GLB has exactly the lag nodes build-report.json lists, with identical extras', () => {
  assert.ok(REPORT.lag.length >= 6, 'at least the cuffs and hems');
  assert.equal(lagIndexes.length, REPORT.lag.length);
  const fromGlb = lagIndexes.map(i => ({node: glb.nodes[i].name, parent: glb.nodes[parentOf.get(i)].name, ...glb.nodes[i].extras}));
  const key = e => e.node;
  assert.deepEqual([...fromGlb].sort((a, b) => key(a).localeCompare(key(b))), [...REPORT.lag].sort((a, b) => key(a).localeCompare(key(b))));
});

test('PE-60 every lag node is a direct child of a skin joint and is not itself a joint', () => {
  const joints = new Set(glb.skins[0].joints);
  assert.equal(joints.size, 24);
  for (const i of lagIndexes) {
    assert.ok(joints.has(parentOf.get(i)), `${glb.nodes[i].name}: parent ${glb.nodes[parentOf.get(i)]?.name} is not a skin joint`);
    assert.ok(!joints.has(i), `${glb.nodes[i].name} is in skins[0].joints`);
    assert.deepEqual(glb.nodes[i].extras.hinge_axis, [1, 0, 0]);
  }
  assert.equal(glb.skins.length, 1, 'one skin only');
});

test('PE-60 every mesh in a lag subtree is unskinned, and each node hangs from the parent the report names', () => {
  const parents = Object.fromEntries(lagIndexes.map(i => [glb.nodes[i].name, glb.nodes[parentOf.get(i)].name]));
  assert.deepEqual(parents, Object.fromEntries(REPORT.lag.map(l => [l.node, l.parent])));
  for (const must of ['lag:left_cuff', 'lag:right_cuff', 'lag:hem_front', 'lag:hem_back', 'lag:hem_left', 'lag:hem_right']) assert.ok(must in parents, `${must} present`);
  for (const i of lagIndexes) {
    const meshes = subtree(i).filter(n => glb.nodes[n].mesh !== undefined);
    assert.ok(meshes.length >= 1, `${glb.nodes[i].name} carries a mesh`);
    for (const n of meshes) assert.equal(glb.nodes[n].skin, undefined, `${glb.nodes[n].name} is unskinned`);
  }
});

test('PE-60 extras: cuffs max_degrees 35; hems max_degrees 25, inward_degrees 6, drop true; every node has a positive max_degrees', () => {
  for (const i of lagIndexes) {
    const {name, extras} = glb.nodes[i];
    assert.ok(extras.max_degrees > 0, `${name} max_degrees`);
    if (name.endsWith('cuff')) assert.deepEqual(extras, {hinge_axis: [1, 0, 0], max_degrees: 35});
    if (name.startsWith('lag:hem_')) assert.deepEqual(extras, {hinge_axis: [1, 0, 0], max_degrees: 25, inward_degrees: 6, drop: true});
  }
});

// ------------------------------------------------------------------------------------------------ PE-70 (GLB half)
test('PE-70 no mesh under a lag node has a name the skeleton-view rule hides', () => {
  for (const i of lagIndexes) for (const n of subtree(i).filter(n => glb.nodes[n].mesh !== undefined)) {
    assert.doesNotMatch(glb.nodes[n].name, /palm|finger|thumb|shoe|Head/, glb.nodes[n].name);
    assert.match(glb.nodes[n].name, /cuff|flap|trouser/i);
  }
});

// ------------------------------------------------------------------------------------------------ PE-62 / PE-63 / PE-64
test('PE-62 lag.js exists and exports the documented constants', async () => {
  assert.ok(existsSync(LAG_JS), 'assets/explorer/lag.js is missing');
  const m = await L();
  for (const name of ['OMEGA', 'K_SPIN', 'K_DROP', 'SETTLE_MS', 'SETTLE_CAP_MS', 'createLag']) assert.ok(name in m, `missing export ${name}`);
  assert.equal(m.OMEGA, 20); assert.equal(m.SETTLE_CAP_MS, 600); assert.equal(m.K_SPIN, 0.12); assert.equal(m.K_DROP, 120);
});

/** The closed-form solution of PE-62, written out independently of lag.js. */
const reference = (theta, v, c, dt, omega) => {
  const e = theta - c, b = v + omega * e, k = Math.exp(-omega * dt);
  return {theta: c + (e + b * dt) * k, v: (v - omega * b * dt) * k};
};
const unpack = r => (Array.isArray(r) ? {theta: r[0], v: r[1]} : {theta: r.theta ?? r.angle ?? r.t, v: r.v ?? r.velocity});
/** The pure step export. Called as step(theta, v, c, dt) in degrees and seconds; see the report for the signature assumption. */
async function stepFn() {
  const m = await L();
  const fn = m.step ?? m.stepSpring ?? m.spring;
  assert.equal(typeof fn, 'function', 'lag.js exports no spring step function (expected `step`)');
  return (theta, v, c, dt) => unpack(fn(theta, v, c, dt));
}

test('PE-62 the step matches the closed-form solution of the spec', async () => {
  const {OMEGA} = await L(), step = await stepFn();
  for (const [theta, v, c, dt] of [[10, 0, 0, 0.016], [-7, 30, 2, 0.032], [3, -50, -4, 0.005]]) {
    const got = step(theta, v, c, dt), want = reference(theta, v, c, dt, OMEGA);
    assert.ok(Math.abs(got.theta - want.theta) < 1e-9 && Math.abs(got.v - want.v) < 1e-9, JSON.stringify({got, want}));
  }
});

test('PE-62 one 32 ms step equals two 16 ms steps to 1e-9 (unclamped)', async () => {
  const step = await stepFn();
  for (const [theta, v, c] of [[10, 0, 0], [-4, 25, 1.5], [5, -40, -2]]) {
    const one = step(theta, v, c, 0.032), a = step(theta, v, c, 0.016), two = step(a.theta, a.v, c, 0.016);
    assert.ok(Math.abs(one.theta - two.theta) < 1e-9, `theta ${one.theta} vs ${two.theta}`);
    assert.ok(Math.abs(one.v - two.v) < 1e-9, `v ${one.v} vs ${two.v}`);
  }
});

test('PE-62 dt = 0 returns the input unchanged', async () => {
  const step = await stepFn();
  assert.deepEqual(step(7.5, -3, 1, 0), {theta: 7.5, v: -3});
});

test('PE-62 from 10° at rest, c = 0, the step never overshoots 0 and settles below 0.2° within 600 ms at 60 Hz', async () => {
  const {OMEGA, SETTLE_CAP_MS} = await L(), step = await stepFn();
  assert.ok(OMEGA > 0);
  let s = {theta: 10, v: 0}, t = 0;
  while (t < SETTLE_CAP_MS) {
    s = step(s.theta, s.v, 0, 1 / 60); t += 1000 / 60;
    assert.ok(s.theta >= 0, `overshoot to ${s.theta} at ${t.toFixed(0)} ms`);
  }
  assert.ok(Math.abs(s.theta) < 0.2, `still at ${s.theta}° after ${SETTLE_CAP_MS} ms`);
});

test('PE-62 10° meets the rest test (|θ| < 0.2°, |v| < 1°/s) within SETTLE_MS and the cap', async () => {
  const {SETTLE_MS, SETTLE_CAP_MS} = await L(), step = await stepFn();
  assert.ok(SETTLE_MS <= SETTLE_CAP_MS);
  let s = {theta: 10, v: 0}, t = 0;
  while (t < SETTLE_MS - 1e-6 && !(Math.abs(s.theta) < 0.2 && Math.abs(s.v) < 1)) { s = step(s.theta, s.v, 0, 1 / 60); t += 1000 / 60; }
  assert.ok(Math.abs(s.theta) < 0.2 && Math.abs(s.v) < 1, `not at rest by ${SETTLE_MS} ms: ${JSON.stringify(s)}`);
});

// Clamping and drive are asserted against createLag with a stub rig; the shape of that API is pinned by lag.js (see report).
test('PE-64 lag.js has no clock, randomness, DOM or storage reference and imports only the vendored three core', () => {
  assert.ok(existsSync(LAG_JS), 'assets/explorer/lag.js is missing');
  const source = stripComments(readFileSync(LAG_JS, 'utf8'));
  for (const word of ['performance', 'Date', 'Math.random', 'requestAnimationFrame', 'window', 'document']) {
    assert.ok(!new RegExp(`\\b${word.replace('.', '\\.')}\\b`).test(source), `lag.js references ${word}`);
  }
  for (const m of source.matchAll(/\bimport\s*(?:[^'"]*?\bfrom\s*)?['"]([^'"]+)['"]/g)) assert.equal(m[1], '../vendor/three.core.js');
});

// ------------------------------------------------------------------------------------------------ PE-69
test('PE-69 lag.js has no storage, history, location or fetch reference; pose-schema, retarget and poses do not mention lag', () => {
  assert.ok(existsSync(LAG_JS), 'assets/explorer/lag.js is missing');
  const source = stripComments(readFileSync(LAG_JS, 'utf8'));
  for (const word of ['localStorage', 'sessionStorage', 'history', 'location', 'fetch']) assert.ok(!new RegExp(`\\b${word}\\b`).test(source), `lag.js references ${word}`);
  for (const f of ['pose-schema.js', 'retarget.js', 'poses.js']) assert.ok(!/lag/i.test(stripComments(readFileSync(path.join(EXPLORER_DIR, f), 'utf8'))), `${f} mentions lag`);
});

// ------------------------------------------------------------------------------------------------ PE-71
test('PE-71 lag.js is at most 2,560 B and the explorer total is at most 64 KiB; the page never names build-report.json', () => {
  assert.ok(existsSync(LAG_JS), 'assets/explorer/lag.js is missing');
  assert.ok(readFileSync(LAG_JS).length <= 2560, `lag.js is ${readFileSync(LAG_JS).length} bytes`);
  const files = readdirSync(EXPLORER_DIR).filter(f => f.endsWith('.js'));
  const total = files.reduce((n, f) => n + readFileSync(path.join(EXPLORER_DIR, f)).length, 0);
  assert.ok(total <= 64 * 1024, `explorer total ${total} bytes`);
  for (const f of files) assert.ok(!/build-report/.test(readFileSync(path.join(EXPLORER_DIR, f), 'utf8')), `${f} names build-report.json`);
});

// ------------------------------------------------------------------------------------------------ PE-61 / PE-63 / PE-64 / PE-65 / PE-69 on createLag with a stub rig
// The stub rig implements only `setLagLocal`: any other call on the rig (a bone, a pose) would throw, which is how PE-69's
// "bones are never touched" is observed.
import {Quaternion} from '../../assets/vendor/three.core.js';
const IDENT = [0, 0, 0, 1], FRAME = 1 / 60;
const report = [
  {node: 'lag:left_cuff', parent: 'left_elbow', hinge_axis: [1, 0, 0], maxDegrees: 35, inwardDegrees: undefined, drop: false, restLocal: IDENT},
  {node: 'lag:hem_front', parent: 'spine1', hinge_axis: [1, 0, 0], maxDegrees: 25, inwardDegrees: 6, drop: true, restLocal: [0.3, 0, 0, Math.sqrt(1 - 0.09)]},
];
const CUFF = 'lag:left_cuff', HEM = 'lag:hem_front';
const aboutX = degrees => { const h = degrees * Math.PI / 360; return [Math.sin(h), 0, 0, Math.cos(h)]; };
function harness(nodes = report) {
  return import('../../assets/explorer/lag.js').then(({createLag}) => {
    const calls = [];
    const rig = {setLagLocal: (node, q) => calls.push({node, q: [...q]})};
    return {lag: createLag(rig, nodes), calls};
  });
}
/** Drive the lag for `frames` frames. `spin(i)` is the parent angle about X in degrees and `y(i)` the pelvis height. */
function run(lag, frames, {spin = () => 0, y = () => 1} = {}) {
  const trace = [];
  lag.begin();
  for (let i = 0; i < frames; i++) {
    const q = aboutX(spin(i));
    lag.step(FRAME, new Map([['left_elbow', q], ['spine1', q]]), [0, y(i), 0]);
    trace.push(lag.angles());
  }
  return trace;
}

test('PE-61 with an empty report createLag is inert: never active, no angles, never touches the rig', async () => {
  const {lag, calls} = await harness([]);
  lag.begin();
  assert.equal(lag.step(FRAME, new Map(), [0, 1, 0]), false);
  assert.equal(lag.active, false);
  assert.deepEqual(lag.angles(), {});
  lag.reset();
  assert.equal(calls.length, 0);
});

test('PE-63 a parent spinning at +60°/s about the hinge drives θ towards −K_SPIN·60', async () => {
  const {K_SPIN} = await L(), {lag} = await harness();
  const trace = run(lag, 120, {spin: i => 60 * (i + 1) * FRAME});
  assert.ok(Math.abs(trace.at(-1)[CUFF] - (-K_SPIN * 60)) < 0.05, `cuff at ${trace.at(-1)[CUFF]}`);
  assert.ok(trace.at(-1)[CUFF] < 0, 'a lag behind the motion');
});

test('PE-63 a pelvis falling at 0.1 m/s drives a drop node towards −K_DROP·0.1 and leaves a non-drop node at 0', async () => {
  const {K_DROP} = await L(), {lag} = await harness();
  const trace = run(lag, 120, {y: i => 1 - 0.1 * (i + 1) * FRAME});
  assert.ok(Math.abs(trace.at(-1)[HEM] - (-K_DROP * 0.1)) < 0.05, `hem at ${trace.at(-1)[HEM]}`);
  assert.ok(trace.every(a => Math.abs(a[CUFF]) < 1e-9), 'the cuff does not respond to the pelvis');
});

test('PE-63 a forced drive never takes θ past −max_degrees or +inward_degrees, and a rise tucks the hem in', async () => {
  const {lag} = await harness();
  const fall = run(lag, 90, {y: i => 1 - 5 * (i + 1) * FRAME, spin: i => 700 * (i + 1) * FRAME % 360});
  assert.ok(fall.every(a => a[HEM] >= -25 && a[CUFF] >= -35 && a[CUFF] <= 35 && a[HEM] <= 6));
  assert.ok(Math.min(...fall.map(a => a[HEM])) < -24, 'the hem reaches its outward bound');
  const {lag: rising} = await harness();
  const rise = run(rising, 90, {y: i => 1 + 5 * (i + 1) * FRAME});
  assert.ok(rise.every(a => a[HEM] <= 6 && a[HEM] >= -25), 'never past +inward_degrees');
  assert.ok(Math.max(...rise.map(a => a[HEM])) > 5.9, 'the hem tucks in to its inward bound');
});

test('PE-63 on the first frame after begin() there is no previous sample: ω_h = 0 and v_y = 0', async () => {
  const {lag} = await harness();
  lag.begin();
  lag.step(FRAME, new Map([['left_elbow', aboutX(170)], ['spine1', aboutX(170)]]), [0, 9, 0]);
  assert.deepEqual(lag.angles(), {[CUFF]: 0, [HEM]: 0});
  const {lag: again} = await harness();
  run(again, 30, {y: i => 1 - 0.5 * (i + 1) * FRAME});
  again.begin();
  const before = again.angles();
  again.step(FRAME, new Map([['left_elbow', aboutX(120)], ['spine1', aboutX(120)]]), [0, 40, 0]);
  assert.ok(Math.abs(again.angles()[HEM] - before[HEM]) < Math.abs(before[HEM]) + 1e-9, 'a restart does not read a jump as a velocity');
  assert.ok(again.angles()[HEM] >= -25 && again.angles()[HEM] <= 6);
});

test('PE-64 the same tick sequence gives bitwise-identical angles at every tick, whatever the frame length', async () => {
  const drive = {spin: i => 40 * Math.sin(i / 7) * 9, y: i => 1 + 0.03 * Math.sin(i / 5)};
  const a = run((await harness()).lag, 150, drive), b = run((await harness()).lag, 150, drive);
  assert.equal(a.length, 150);
  for (let i = 0; i < a.length; i++) for (const k of [CUFF, HEM]) assert.ok(Object.is(a[i][k], b[i][k]), `tick ${i} ${k}`);
});

test('PE-65 step reports motion until the rest test holds, and a hem from −max_degrees is at rest within SETTLE_CAP_MS', async () => {
  const {SETTLE_CAP_MS} = await L(), {lag} = await harness();
  run(lag, 40, {y: i => 1 - 5 * (i + 1) * FRAME});
  assert.ok(lag.angles()[HEM] < -24);
  let moving = true, frames = 0;
  const q = new Map([['left_elbow', IDENT], ['spine1', IDENT]]);
  while (moving && frames < 200) { moving = lag.step(FRAME, q, [0, 1 - 5 * 40 * FRAME, 0]); frames++; }
  assert.equal(moving, false);
  assert.ok(frames * FRAME * 1000 <= SETTLE_CAP_MS, `${frames} frames to rest`);
});

test('PE-65/68 reset() sets every angle to exactly 0, writes every node back to restLocal and ends activity', async () => {
  const {lag, calls} = await harness();
  run(lag, 30, {y: i => 1 - 2 * (i + 1) * FRAME, spin: i => 30 * i});
  assert.ok(Object.values(lag.angles()).some(a => a !== 0));
  assert.equal(lag.active, true);
  calls.length = 0;
  lag.reset();
  assert.equal(lag.active, false);
  assert.deepEqual(lag.angles(), {[CUFF]: 0, [HEM]: 0});
  for (const n of report) {
    const last = calls.findLast(c => c.node === n.node);
    assert.ok(last, `${n.node} written on reset`);
    assert.ok(Math.abs(new Quaternion(...last.q).dot(new Quaternion(...n.restLocal))) > 1 - 1e-12, `${n.node} back at restLocal`);
  }
});

test('PE-62 a lag node is written as restLocal · hinge about X, never as a replacement of restLocal', async () => {
  const {lag, calls} = await harness();
  run(lag, 30, {y: i => 1 - 2 * (i + 1) * FRAME});
  const last = calls.findLast(c => c.node === HEM), theta = lag.angles()[HEM];
  const want = new Quaternion(...report[1].restLocal).multiply(new Quaternion(...aboutX(theta)));
  assert.ok(Math.abs(new Quaternion(...last.q).dot(want)) > 1 - 1e-9);
});

// ------------------------------------------------------------------------------------------------ PE-53 (amended) / PE-65: the driver's settle window on a fake clock
const T = () => import('../../assets/explorer/transition.js');
const bare = () => ({joints: {}, root: {translation: [0, 0, 0], rotation: IDENT}});
/** A driver on a fake clock. Frames fire every 16 ms of fake time; `log` records order: frame requests and callbacks. */
async function fakeDriver({onSettle, settleCapMs}) {
  const {createDriver, routeTiming} = await T();
  let time = 0, queue = [], handle = 0;
  const log = [];
  const driver = createDriver({
    requestFrame: cb => { queue.push({id: ++handle, cb}); log.push({e: 'request', t: time}); return handle; },
    cancelFrame: id => { queue = queue.filter(q => q.id !== id); },
    now: () => time,
    onFrame: () => log.push({e: 'frame', t: time}),
    onArrive: () => log.push({e: 'arrive', t: time}),
    onSettled: () => log.push({e: 'settled', t: time}),
    ...(onSettle ? {onSettle: dt => { log.push({e: 'settle', t: time, dt}); return onSettle(dt); }} : {}),
    settleCapMs,
  });
  const run = ms => { for (let end = time + ms; time < end;) { time += 16; const due = queue; queue = []; for (const q of due) q.cb(); } };
  driver.start([bare(), bare()]);
  return {driver, log, run, total: routeTiming(1).total, pending: () => queue.length};
}
const at = (log, e) => log.filter(x => x.e === e);

test('PE-53 with no onSettle the driver requests no frame after onArrive', async () => {
  const d = await fakeDriver({});
  d.run(d.total + 3000);
  assert.equal(at(d.log, 'arrive').length, 1);
  const arriveAt = d.log.findIndex(x => x.e === 'arrive');
  assert.equal(d.log.slice(arriveAt).filter(x => x.e === 'request').length, 0);
  assert.equal(d.pending(), 0);
});

test('PE-53 an onSettle that returns false at once ends the window with one onSettled and no frame request', async () => {
  const {SETTLE_CAP_MS} = await L();
  const d = await fakeDriver({onSettle: () => false, settleCapMs: SETTLE_CAP_MS});
  d.run(d.total + 3000);
  const arriveAt = d.log.findIndex(x => x.e === 'arrive');
  assert.equal(d.log.slice(arriveAt).filter(x => x.e === 'request').length, 0);
  assert.equal(at(d.log, 'settled').length, 1);
  assert.equal(d.pending(), 0);
});

test('PE-53/65 an onSettle that always returns true runs until settleCapMs on the driver clock, then onSettled fires once and nothing more is requested', async () => {
  const {SETTLE_CAP_MS} = await L();
  const d = await fakeDriver({onSettle: () => true, settleCapMs: SETTLE_CAP_MS});
  d.run(d.total + SETTLE_CAP_MS + 3000);
  const arrive = at(d.log, 'arrive')[0], settled = at(d.log, 'settled');
  assert.equal(at(d.log, 'arrive').length, 1);
  assert.equal(settled.length, 1, 'onSettled fires exactly once');
  assert.ok(at(d.log, 'settle').length >= 5, 'the window ran for several ticks');
  const requestsAfterArrival = d.log.slice(d.log.indexOf(arrive)).filter(x => x.e === 'request');
  assert.ok(requestsAfterArrival.every(r => r.t < arrive.t + SETTLE_CAP_MS), 'the last requestFrame is before arrival + cap');
  assert.ok(settled[0].t >= arrive.t + SETTLE_CAP_MS && settled[0].t < arrive.t + SETTLE_CAP_MS + 32, `ended at +${settled[0].t - arrive.t} ms`);
  assert.equal(d.log.slice(d.log.indexOf(settled[0]) + 1).filter(x => x.e === 'request').length, 0, 'no requestFrame after onSettled');
  assert.equal(d.pending(), 0);
});

test('PE-65 the first onSettle after arrival gets dt = 0 and later ones get the real frame time', async () => {
  const {SETTLE_CAP_MS} = await L();
  const d = await fakeDriver({onSettle: () => true, settleCapMs: SETTLE_CAP_MS});
  d.run(d.total + SETTLE_CAP_MS + 100);
  const settles = at(d.log, 'settle');
  assert.equal(settles[0].dt, 0);
  assert.ok(settles.slice(1).every(s => s.dt > 0 && s.dt <= 0.05));
});
