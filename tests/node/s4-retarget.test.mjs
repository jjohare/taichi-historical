// PE-32 (retargetJoint reproduces bend()) and PE-33 (left/right consistency by forward kinematics). Slice S4.
// Rest data is parsed from archive-avatar.glb; the maths comes from assets/vendor/three.core.js; the independent
// forward kinematics used to build the fixtures lives in tests/helpers/poses.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {toArray, quatClose} from '../helpers/glb.mjs';
import {restData, localFor, fkPositions, axisAngle, fixture, POSE_JOINTS} from '../helpers/poses.mjs';
import {Quaternion} from '../../assets/vendor/three.core.js';

const mod = () => import('../../assets/explorer/retarget.js');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------------------------------------------------------------- PE-32
for (const name of ['left_elbow', 'right_knee', 'left_hip']) {
  for (const degrees of [-65, -20, 0, 35, 100]) {
    test(`PE-32 retargetJoint(${name}, axisAngle(+X, ${degrees}°)) equals bendQuaternion (|dot| ≥ 1 − 1e-9)`, async () => {
      const {retargetJoint, bendQuaternion} = await mod();
      const got = retargetJoint(restData, name, axisAngle([1, 0, 0], degrees)), want = bendQuaternion(restData, name, degrees);
      assert.ok(quatClose(got, want), `${name} ${degrees}°: got ${got}, want ${want}`);
    });
  }
}

test('PE-32 an identity delta returns the rest local quaternion for every joint', async () => {
  const {retargetJoint} = await mod();
  for (const [name, r] of restData) assert.ok(quatClose(retargetJoint(restData, name, [0, 0, 0, 1]), r.local), name);
});

test('PE-32 retargetJoint normalises its delta and matches the independent §5.3 formula for an off-axis rotation', async () => {
  const {retargetJoint} = await mod();
  const delta = axisAngle([0.3, -0.5, 0.8], 47).map(v => v * 1.0007);          // slightly off unit length
  for (const name of ['left_shoulder', 'right_knee', 'neck']) {
    assert.ok(quatClose(retargetJoint(restData, name, delta), toArray(localFor(name, delta))), name);
  }
});

test('PE-32 retargetJoint does not mutate the rest data or the delta', async () => {
  const {retargetJoint} = await mod();
  const before = JSON.stringify([...restData]), delta = axisAngle([0, 1, 0], 30), copy = [...delta];
  retargetJoint(restData, 'left_knee', delta);
  assert.equal(JSON.stringify([...restData]), before);
  assert.deepEqual(delta, copy);
});

test('PE-32 a joint without rest data yields null, not an exception', async () => {
  const {retargetJoint} = await mod();
  assert.equal(retargetJoint(restData, 'left_toe', [0, 0, 0, 1]), null);
});

test('PE-32 the delta is expressed in rest-world axes: +90° about +Y turns every limb joint\'s world axis the same way', async () => {
  // L_r · (W⁻¹ Q W) has world orientation Q · W (for the joint alone), i.e. the delta acts in world axes.
  const {retargetJoint} = await mod();
  const Q = new Quaternion().fromArray(axisAngle([0, 1, 0], 90));
  for (const name of ['left_elbow', 'right_hip']) {
    const r = restData.get(name), L = new Quaternion().fromArray(retargetJoint(restData, name, toArray(Q)));
    const parentWorld = new Quaternion().fromArray(r.world).multiply(new Quaternion().fromArray(r.local).invert());
    const posed = parentWorld.multiply(L), want = Q.clone().multiply(new Quaternion().fromArray(r.world));
    assert.ok(quatClose(toArray(posed), toArray(want)), name);
  }
});

// ---------------------------------------------------------------- applyPose / forwardKinematics
test('applyPose gives every one of the 24 joints a local quaternion; omitted joints stay at rest', async () => {
  const {applyPose} = await mod();
  const {locals} = applyPose(restData, fixture('valid-minimal.json'));
  assert.equal(locals.size, 24);
  for (const [name, r] of restData) {
    if (name === 'left_elbow') assert.ok(!quatClose(locals.get(name), r.local), 'the posed elbow moves');
    else assert.ok(quatClose(locals.get(name), r.local), `${name} stays at rest`);
  }
});

test('applyPose uses the §5.3 rule for every joint of valid-full', async () => {
  const {applyPose} = await mod();
  const pose = fixture('valid-full.json'), {locals} = applyPose(restData, pose);
  for (const name of POSE_JOINTS) assert.ok(quatClose(locals.get(name), toArray(localFor(name, pose.joints[name].rotation))), name);
});

test('applyPose gives the pelvis the file\'s root rotation, and reports the root translation unchanged', async () => {
  const {applyPose} = await mod();
  const pose = {...fixture('valid-minimal.json'), root: {translation: [0.05, -0.03, 0.1], rotation: axisAngle([0, 1, 0], 20)}};
  const {locals, rootTranslation} = applyPose(restData, pose);
  assert.ok(quatClose(locals.get('pelvis'), toArray(localFor('pelvis', pose.root.rotation))));
  assert.deepEqual(rootTranslation, [0.05, -0.03, 0.1]);
});

test('applyPose does not mutate the pose', async () => {
  const {applyPose} = await mod();
  const pose = fixture('valid-full.json'), before = JSON.stringify(pose);
  applyPose(restData, pose);
  assert.equal(JSON.stringify(pose), before);
});

test('forwardKinematics at rest reproduces the GLB rest positions', async () => {
  const {applyPose, forwardKinematics} = await mod();
  const {locals, rootTranslation} = applyPose(restData, {root: {rotation: [0, 0, 0, 1], translation: [0, 0, 0]}, joints: {}});
  const got = forwardKinematics(restData, locals, rootTranslation), want = fkPositions({});
  assert.equal(got.size, 24);
  for (const [name, p] of got) assert.ok(dist(p, want.get(name).toArray()) < 1e-6, `${name}: ${p} vs ${want.get(name).toArray()}`);
  assert.ok(dist(got.get('pelvis'), [0, 0.94, 0]) < 1e-6, 'pelvis rest height');
});

test('forwardKinematics agrees with the independent implementation for valid-full', async () => {
  const {applyPose, forwardKinematics} = await mod();
  const pose = fixture('valid-full.json');
  const {locals, rootTranslation} = applyPose(restData, pose);
  const got = forwardKinematics(restData, locals, rootTranslation);
  const want = fkPositions(Object.fromEntries(Object.entries(pose.joints).map(([k, v]) => [k, v.rotation])));
  for (const [name, p] of got) assert.ok(dist(p, want.get(name).toArray()) < 1e-6, name);
});

test('forwardKinematics moves the whole skeleton by the root translation', async () => {
  const {applyPose, forwardKinematics} = await mod();
  const {locals} = applyPose(restData, fixture('valid-minimal.json'));
  const a = forwardKinematics(restData, locals, [0, 0, 0]), b = forwardKinematics(restData, locals, [0.1, -0.2, 0.3]);
  for (const [name, p] of a) assert.ok(dist(b.get(name).map((v, i) => v - [0.1, -0.2, 0.3][i]), p) < 1e-9, name);
});

test('the landmarks in every valid fixture sit where forward kinematics puts the posed joints (within 2 mm)', async () => {
  const {applyPose, forwardKinematics} = await mod();
  for (const file of ['valid-minimal.json', 'valid-full.json', 'valid-crossed-hands.json']) {
    const pose = fixture(file), {locals, rootTranslation} = applyPose(restData, pose);
    const posed = forwardKinematics(restData, locals, rootTranslation);
    for (const [name, lm] of Object.entries(pose.landmarks)) assert.ok(dist(posed.get(name), lm) < 2e-3, `${file} ${name}`);
  }
});

// ---------------------------------------------------------------- PE-33
test('PE-33 valid-full and valid-minimal pass: both pairs consistent', async () => {
  const {checkLeftRight} = await mod();
  for (const file of ['valid-full.json', 'valid-minimal.json']) {
    const r = checkLeftRight(restData, fixture(file));
    assert.equal(r.ok, true, `${file}: ${JSON.stringify(r)}`);
    assert.deepEqual(r.errors, []);
    assert.equal(r.pairs.wrist, 'consistent', file);
    assert.equal(r.pairs.ankle, 'consistent', file);
  }
});

test('PE-33 valid-crossed-hands: the wrist pair is inconclusive, which is reported and is not an error', async () => {
  const {checkLeftRight} = await mod();
  const pose = fixture('valid-crossed-hands.json');
  const r = checkLeftRight(restData, pose);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.errors, []);
  assert.equal(r.pairs.wrist, 'inconclusive');
  assert.equal(r.pairs.ankle, 'consistent', 'the legs are at rest, so the ankle pair is conclusive');
  assert.ok(dist(pose.landmarks.left_wrist, pose.landmarks.right_wrist) < 0.025, 'fixture: the wrists meet, so 2d < 0.05 m');
});

test('PE-33 invalid-mirrored: an asymmetric pose with swapped sides fails with E_LEFT_RIGHT', async () => {
  const {checkLeftRight} = await mod();
  const pose = fixture('invalid-mirrored.json');
  const r = checkLeftRight(restData, pose);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0 && r.errors.every(e => e.code === 'E_LEFT_RIGHT'), JSON.stringify(r.errors));
  assert.ok(r.errors.every(e => typeof e.path === 'string' && typeof e.message === 'string'));
  assert.equal(r.pairs.ankle, 'swapped', 'the stepped leg is the decisive pair');
});

test('PE-33 invalid-mirrored is a schema-valid file: only the left/right check can catch it, and it is asymmetric', async () => {
  const {validatePose} = await import('../../assets/explorer/pose-schema.js');
  const pose = fixture('invalid-mirrored.json');
  assert.equal(validatePose(pose, {origin: 'published'}).ok, true);
  const lm = pose.landmarks;
  assert.ok(dist(lm.left_wrist, [-lm.right_wrist[0], lm.right_wrist[1], lm.right_wrist[2]]) > 0.3, 'arms differ');
  assert.ok(dist(lm.left_ankle, [-lm.right_ankle[0], lm.right_ankle[1], lm.right_ankle[2]]) > 0.3, 'legs differ');
});

test('PE-33 swapping the landmarks instead of the joints is also caught', async () => {
  const {checkLeftRight} = await mod();
  const good = structuredClone(fixture('valid-full.json'));
  [good.landmarks.left_ankle, good.landmarks.right_ankle] = [good.landmarks.right_ankle, good.landmarks.left_ankle];
  [good.landmarks.left_wrist, good.landmarks.right_wrist] = [good.landmarks.right_wrist, good.landmarks.left_wrist];
  const r = checkLeftRight(restData, good);
  assert.equal(r.ok, false);
  assert.ok(r.errors.every(e => e.code === 'E_LEFT_RIGHT'));
});

test('PE-33 checkLeftRight does not mutate the pose', async () => {
  const {checkLeftRight} = await mod();
  const pose = fixture('valid-full.json'), before = JSON.stringify(pose);
  checkLeftRight(restData, pose);
  assert.equal(JSON.stringify(pose), before);
});

test('PE-33 the 0.05 m inconclusive margin: a pair just inside it is inconclusive, just outside it is decided', async () => {
  const {checkLeftRight} = await mod();
  // At rest the posed ankles are 0.3 m apart, so with landmarks equal to the posed positions dSame = 0 and dSwap = 0.6 m.
  // Move the landmarks together symmetrically by δ each: dSwap becomes 2·(0.3 − 2δ'), so choose them to land on either side of 0.05.
  const base = structuredClone(fixture('valid-minimal.json'));
  const at = half => { const p = structuredClone(base); p.landmarks.left_ankle = [half, 0.11, 0]; p.landmarks.right_ankle = [-half, 0.11, 0]; return p; };
  // Posed ankles at ±0.15. dSame = 0, dSwap = 4·half when half < 0.15 → 4·half vs 0.05 at half = 0.0125.
  assert.equal(checkLeftRight(restData, at(0.012)).pairs.ankle, 'inconclusive');
  assert.equal(checkLeftRight(restData, at(0.013)).pairs.ankle === 'inconclusive', false);
});
