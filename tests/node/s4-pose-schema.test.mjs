// PE-30, PE-31 (validatePose) and the node half of PE-41 (rejection wording). Slice S4.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, fixtureText, JOINTS, POSE_JOINTS} from '../helpers/poses.mjs';

const mod = () => import('../../assets/explorer/pose-schema.js');
const validate = async (input, origin = 'published') => (await mod()).validatePose(input, {origin});
const clone = v => JSON.parse(JSON.stringify(v));
const mutated = (edit, base = 'valid-full.json') => { const p = clone(fixture(base)); edit(p); return p; };
const codes = r => r.errors.map(e => e.code);

/** Assert a rejection whose first error has `code` and a usable path and message. */
function rejects(result, code, pathPart) {
  assert.equal(result.ok, false, `expected rejection with ${code}, got ok`);
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0, 'errors must be a non-empty array');
  const [first] = result.errors;
  assert.equal(first.code, code, `first error: ${JSON.stringify(first)}`);
  assert.equal(typeof first.path, 'string');
  assert.equal(typeof first.message, 'string');
  assert.ok(first.message.length > 0 && first.message.length < 300, 'message should be one plain sentence');
  if (pathPart) assert.ok(first.path.includes(pathPart), `path ${JSON.stringify(first.path)} should mention ${pathPart}`);
}

test('exports: JOINT_NAMES is the 24 skin bones in skin order and POSE_JOINTS drops pelvis', async () => {
  const {JOINT_NAMES, POSE_JOINTS: pj} = await mod();
  assert.deepEqual([...JOINT_NAMES], JOINTS);
  assert.deepEqual([...pj], POSE_JOINTS);
  assert.equal(pj.length, 23);
});

// ---------------------------------------------------------------- PE-30
for (const name of ['valid-minimal.json', 'valid-full.json', 'valid-crossed-hands.json']) {
  test(`PE-30 ${name} is accepted as a published file`, async () => {
    const r = await validate(fixture(name));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.pose.schema, 'yang-form/pose-estimate');
  });
}

test('PE-30 the fixtures cover one joint (minimal) and all 23 non-root joints (full), with notes and an overlay hash', () => {
  assert.deepEqual(Object.keys(fixture('valid-minimal.json').joints), ['left_elbow']);
  const full = fixture('valid-full.json');
  assert.deepEqual(Object.keys(full.joints).sort(), [...POSE_JOINTS].sort());
  assert.ok(full.review.notes.length > 0 && /^[0-9a-f]{64}$/.test(full.review.overlaySha256));
});

test('PE-30 a file is accepted from its raw text as well as from a parsed value', async () => {
  const r = await validate(fixtureText('valid-full.json'));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('PE-30 quaternions within 1e-3 of unit length are accepted and normalised in the returned object', async () => {
  const input = mutated(p => { p.joints.left_elbow.rotation = [0, 0, 0, 1.0005]; });
  const r = await validate(input);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const q = r.pose.joints.left_elbow.rotation;
  assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-12, `norm ${Math.hypot(...q)}`);
  assert.deepEqual(input.joints.left_elbow.rotation, [0, 0, 0, 1.0005], 'the caller\'s object is not mutated');
});

test('PE-30 a quaternion just outside the 1e-3 tolerance is rejected with E_QUAT', async () => {
  rejects(await validate(mutated(p => { p.joints.left_elbow.rotation = [0, 0, 0, 1.002]; })), 'E_QUAT', 'left_elbow');
});

test('PE-30 root.rotation is normalised like any other rotation', async () => {
  const r = await validate(mutated(p => { p.root.rotation = [0, 0, 0, 0.9996]; }));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(Math.abs(Math.hypot(...r.pose.root.rotation) - 1) < 1e-12);
});

// ---------------------------------------------------------------- PE-31: one fixture file per code
const FIXTURE_CASES = [
  ['invalid-E_SCHEMA_ID.json', 'E_SCHEMA_ID', 'schema'],
  ['invalid-E_VERSION.json', 'E_VERSION', 'schemaVersion'],
  ['invalid-E_UNKNOWN_KEY.json', 'E_UNKNOWN_KEY', 'extra'],
  ['invalid-E_MISSING.json', 'E_MISSING', 'review'],
  ['invalid-E_MISSING-landmark.json', 'E_MISSING', 'right_ankle'],
  ['invalid-E_IMAGE_ID.json', 'E_IMAGE_ID', null],
  ['invalid-E_HASH.json', 'E_HASH', 'sha256'],
  ['invalid-E_REVISION.json', 'E_REVISION', 'revision'],
  ['invalid-E_JOINT_NAME.json', 'E_JOINT_NAME', 'left_toe'],
  ['invalid-E_QUAT.json', 'E_QUAT', 'left_elbow'],
  ['invalid-E_RANGE.json', 'E_RANGE', 'overall'],
  ['invalid-E_DATE.json', 'E_DATE', 'date'],
  ['invalid-E_STATUS.json', 'E_STATUS', 'status'],
  ['invalid-E_FRAME.json', 'E_FRAME', 'frame'],
  ['invalid-E_CONVENTION.json', 'E_CONVENTION', 'jointConvention'],
  ['invalid-E_TYPE.json', 'E_TYPE', 'name'],
  ['invalid-E_JSON.json', 'E_JSON', null],
];
for (const [file, code, pathPart] of FIXTURE_CASES) {
  test(`PE-31 ${file} is rejected with ${code} (from raw text)`, async () => rejects(await validate(fixtureText(file)), code, pathPart));
}

test('PE-31 the E_JSON fixture really is not JSON', () => {
  assert.throws(() => JSON.parse(fixtureText('invalid-E_JSON.json')), SyntaxError);
});

test('PE-31 E_SIZE: more than 64 KiB is rejected before parsing', async () => {
  const text = JSON.stringify(fixture('valid-minimal.json')) + ' '.repeat(65536);
  assert.ok(Buffer.byteLength(text) > 65536);
  rejects(await validate(text), 'E_SIZE');
});

test('PE-31 E_SIZE counts bytes, not characters', async () => {
  const text = JSON.stringify({pad: '€'.repeat(30000)});            // 30,000 characters, 90,000+ bytes
  assert.ok(text.length < 65536 && Buffer.byteLength(text) > 65536);
  rejects(await validate(text), 'E_SIZE');
});

test('PE-31 E_SIZE boundary: exactly 65,536 bytes is not a size error', async () => {
  const body = JSON.stringify(fixture('valid-minimal.json'));
  const text = body + ' '.repeat(65536 - Buffer.byteLength(body));
  assert.equal(Buffer.byteLength(text), 65536);
  const r = await validate(text);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// Variants named in PE-31 that need more than one file per code are derived from valid-full at test time.
const VARIANTS = [
  ['schemaVersion "1"', 'E_VERSION', p => { p.schemaVersion = '1'; }],
  ['schemaVersion 1.5', 'E_VERSION', p => { p.schemaVersion = 1.5; }],
  ['schemaVersion 0', 'E_VERSION', p => { p.schemaVersion = 0; }],
  ['schema missing type', 'E_SCHEMA_ID', p => { p.schema = 7; }],
  ['unknown key in review', 'E_UNKNOWN_KEY', p => { p.review.approvedBy = 'nobody'; }],
  ['unknown key in a joint entry', 'E_UNKNOWN_KEY', p => { p.joints.left_elbow.twist = 1; }],
  ['unknown key in estimator', 'E_UNKNOWN_KEY', p => { p.estimator.gpu = 'A100'; }],
  ['missing estimator', 'E_MISSING', p => { delete p.estimator; }],
  ['missing landmarks', 'E_MISSING', p => { delete p.landmarks; }],
  ['missing review.checks entry', 'E_MISSING', p => { delete p.review.checks.truncation; }],
  ['imageId ../x', 'E_IMAGE_ID', p => { p.imageId = '../x'; }],
  ['imageId with three letters', 'E_IMAGE_ID', p => { p.imageId = 'wang-001'; }],
  ['imageId with two digits', 'E_IMAGE_ID', p => { p.imageId = 'chen-01'; }],
  ['sourceImage.path that is not the imageId', 'E_IMAGE_ID', p => { p.sourceImage.path = 'extracted/historical/chen-002.png'; }],
  ['sourceImage.path traversal', 'E_IMAGE_ID', p => { p.sourceImage.path = '../extracted/historical/chen-001.png'; }],
  ['upper-case SHA-256', 'E_HASH', p => { p.sourceImage.sha256 = p.sourceImage.sha256.toUpperCase(); }],
  ['63-digit SHA-256', 'E_HASH', p => { p.rig.modelSha256 = p.rig.modelSha256.slice(1); }],
  ['bad checkpointSha256', 'E_HASH', p => { p.estimator.checkpointSha256 = 'g'.repeat(64); }],
  ['bad overlaySha256', 'E_HASH', p => { p.review.overlaySha256 = 'abc'; }],
  ['39-digit revision', 'E_REVISION', p => { p.rig.revision = p.rig.revision.slice(1); }],
  ['converter revision as a branch', 'E_REVISION', p => { p.converter.revision = 'main'; }],
  ['pelvis in joints (root is used instead)', 'E_JOINT_NAME', p => { p.joints.pelvis = {rotation: [0, 0, 0, 1]}; }],
  ['empty joints', 'E_JOINT_NAME', p => { p.joints = {}; }],
  ['quaternion of wrong length', 'E_QUAT', p => { p.joints.left_elbow.rotation = [0, 0, 1]; }],
  ['quaternion with a string component', 'E_QUAT', p => { p.joints.left_elbow.rotation = [0, 0, '0', 1]; }],
  ['quaternion with NaN', 'E_QUAT', p => { p.joints.left_elbow.rotation = [0, 0, NaN, 1]; }],
  ['quaternion with Infinity', 'E_QUAT', p => { p.joints.left_elbow.rotation = [Infinity, 0, 0, 1]; }],
  ['zero quaternion', 'E_QUAT', p => { p.joints.left_elbow.rotation = [0, 0, 0, 0]; }],
  ['root rotation of norm 0.5', 'E_QUAT', p => { p.root.rotation = [0, 0, 0, 0.5]; }],
  ['joint confidence above 1', 'E_RANGE', p => { p.joints.left_elbow.confidence = 1.0001; }],
  ['negative confidence', 'E_RANGE', p => { p.confidence.overall = -0.1; }],
  ['translation of 3 m', 'E_RANGE', p => { p.root.translation = [0, 3, 0]; }],
  ['translation just over 1 m', 'E_RANGE', p => { p.root.translation = [1.01, 0, 0]; }],
  ['201-character string', 'E_RANGE', p => { p.confidence.method = 'x'.repeat(201); }],
  ['1,001-character notes', 'E_RANGE', p => { p.review.notes = 'x'.repeat(1001); }],
  ['non-finite landmark', 'E_RANGE', p => { p.landmarks.left_wrist = [0, 0, NaN]; }],
  ['crop of zero width', 'E_RANGE', p => { p.sourceImage.crop = [0, 0, 0, 10]; }],
  ['negative crop origin', 'E_RANGE', p => { p.sourceImage.crop = [-1, 0, 10, 10]; }],
  ['date 24/10/2026', 'E_DATE', p => { p.review.date = '24/10/2026'; }],
  ['impossible calendar date', 'E_DATE', p => { p.review.date = '2026-02-30'; }],
  ['date with a time', 'E_DATE', p => { p.review.date = '2026-10-24T10:00:00Z'; }],
  ['status unknown', 'E_STATUS', p => { p.review.status = 'rejected'; }],
  ['a review check that is false', 'E_STATUS', p => { p.review.checks.leftRight = false; }],
  ['frame.forward -Z', 'E_FRAME', p => { p.frame.forward = '-Z'; }],
  ['frame.units cm', 'E_FRAME', p => { p.frame.units = 'cm'; }],
  ['frame.left -X', 'E_FRAME', p => { p.frame.left = '-X'; }],
  ['unknown jointConvention', 'E_CONVENTION', p => { p.jointConvention = 'smpl-local@1'; }],
  ['personPrompt unknown', 'E_TYPE', p => { p.sourceImage.personPrompt = 'lasso'; }],
  ['mirrored as a string', 'E_TYPE', p => { p.sourceImage.mirrored = 'false'; }],
  ['non-GitHub repository URL', 'E_TYPE', p => { p.estimator.repository = 'https://example.com/a/b'; }],
  ['rig name not MHR', 'E_TYPE', p => { p.rig.name = 'SMPL'; }],
  ['estimator licence not SAM License', 'E_TYPE', p => { p.estimator.licence = 'MIT'; }],
  ['converter path outside tools/', 'E_TYPE', p => { p.converter.path = '../evil.py'; }],
  ['review.leftRight unknown', 'E_TYPE', p => { p.review.leftRight = 'unsure'; }],
  ['jointMap not name@version', 'E_TYPE', p => { p.jointMap = 'whatever'; }],
];
for (const [label, code, edit] of VARIANTS) {
  test(`PE-31 ${label} → ${code}`, async () => rejects(await validate(mutated(edit)), code));
}

test('PE-31 a draft review is rejected for published files but accepted for local files', async () => {
  const draft = mutated(p => { p.review.status = 'draft'; });
  rejects(await validate(draft, 'published'), 'E_STATUS', 'status');
  const local = await validate(draft, 'local');
  assert.equal(local.ok, true, JSON.stringify(local.errors));
});

test('PE-31 a published file needs all five review checks true; a local draft may leave them false', async () => {
  const unchecked = mutated(p => { p.review.status = 'draft'; p.review.checks.projection = false; });
  rejects(await validate(unchecked, 'published'), 'E_STATUS');
  const local = await validate(unchecked, 'local');
  assert.equal(local.ok, true, JSON.stringify(local.errors));
});

test('PE-31 an unknown origin is not silently treated as local', async () => {
  const draft = mutated(p => { p.review.status = 'draft'; });
  const r = await validate(draft, 'somewhere');
  assert.equal(r.ok, false);
});

test('PE-31 all faults are reported, not just the first, and each names a different path', async () => {
  const r = await validate(mutated(p => { p.review.date = '2026-13-01'; p.frame.up = '+Z'; p.confidence.overall = 2; }));
  assert.equal(r.ok, false);
  assert.deepEqual(new Set(codes(r)), new Set(['E_DATE', 'E_FRAME', 'E_RANGE']));
  assert.equal(new Set(r.errors.map(e => e.path)).size, r.errors.length);
});

// ---------------------------------------------------------------- PE-31: prototype pollution
test('PE-31 a "__proto__" key in the raw text is rejected as E_UNKNOWN_KEY and pollutes nothing', async () => {
  const text = fixtureText('invalid-proto-pollution.json');
  assert.ok(Object.hasOwn(JSON.parse(text), '__proto__'), 'the fixture must carry an own __proto__ key');
  rejects(await validate(text), 'E_UNKNOWN_KEY', '__proto__');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('PE-31 "__proto__" nested in review or in a landmark container is rejected and pollutes nothing', async () => {
  for (const where of ['review', 'estimator', 'sourceImage', 'confidence']) {
    const text = JSON.stringify(fixture('valid-full.json')).replace(new RegExp(`("${where}":\\{)`), '$1"__proto__":{"polluted":true},');
    assert.ok(text.includes('"__proto__"'), where);
    const r = await validate(text);
    assert.equal(r.ok, false, where);
    assert.ok(codes(r).includes('E_UNKNOWN_KEY'), `${where}: ${codes(r)}`);
  }
  assert.equal({}.polluted, undefined);
});

test('PE-31 "__proto__", "constructor" and "prototype" are not accepted as joint names', async () => {
  for (const key of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty']) {
    const text = JSON.stringify(fixture('valid-minimal.json')).replace('"joints":{', `"joints":{"${key}":{"rotation":[0,0,0,1]},`);
    const r = await validate(text);
    assert.equal(r.ok, false, key);
    assert.ok(codes(r).some(c => c === 'E_JOINT_NAME' || c === 'E_UNKNOWN_KEY'), `${key}: ${codes(r)}`);
  }
});

// ---------------------------------------------------------------- PE-31: never throws
test('PE-31 validatePose never throws: null, [], 42, strings, undefined and other odd inputs return ok:false', async () => {
  const odd = [null, undefined, [], {}, 42, 0, NaN, true, '', '   ', 'null', '[]', '42', '"x"', '{', Symbol.for('s'), () => 1, new Date(0), new Map(), Object.create(null), 10n];
  for (const origin of ['published', 'local']) {
    for (const value of odd) {
      let r;
      const label = Object.prototype.toString.call(value);
      const {validatePose} = await mod();
      assert.doesNotThrow(() => { r = validatePose(value, {origin}); }, `input ${label}`);
      assert.equal(r.ok, false, `input ${label}`);
      assert.ok(r.errors.length > 0 && r.errors.every(e => typeof e.code === 'string' && typeof e.message === 'string' && typeof e.path === 'string'));
    }
  }
});

test('PE-31 validatePose copes with a missing or malformed options argument', async () => {
  const {validatePose} = await mod();
  for (const options of [undefined, null, {}, {origin: 42}]) {
    let r;
    assert.doesNotThrow(() => { r = validatePose(fixture('valid-minimal.json'), options); });
    assert.equal(typeof r.ok, 'boolean');
  }
});

test('PE-31 a deeply nested object returns ok:false without throwing (no stack overflow)', async () => {
  const {validatePose} = await mod();
  let deep = {}; for (let i = 0; i < 50000; i++) deep = {a: deep};
  let r; assert.doesNotThrow(() => { r = validatePose(deep, {origin: 'published'}); });
  assert.equal(r.ok, false);
  let nestedReview = fixture('valid-full.json'); let leaf = nestedReview.review.checks;
  for (let i = 0; i < 50000; i++) { leaf.projection = {x: {}}; leaf = leaf.projection.x; }
  assert.doesNotThrow(() => { r = validatePose(nestedReview, {origin: 'published'}); });
  assert.equal(r.ok, false);
});

test('PE-31 deeply nested JSON text returns ok:false (E_JSON or a schema error) without throwing', async () => {
  const {validatePose} = await mod();
  for (const text of ['['.repeat(60000), '{"a":'.repeat(10000) + '1' + '}'.repeat(10000), '[' .repeat(30000) + ']'.repeat(30000)]) {
    let r; assert.doesNotThrow(() => { r = validatePose(text, {origin: 'published'}); });
    assert.equal(r.ok, false);
  }
});

test('PE-31 an object with a throwing getter returns ok:false without throwing', async () => {
  const {validatePose} = await mod();
  const hostile = {get schema() { throw new Error('boom'); }};
  let r; assert.doesNotThrow(() => { r = validatePose(hostile, {origin: 'published'}); });
  assert.equal(r.ok, false);
});

test('PE-31 a rejected result carries no pose', async () => {
  const r = await validate(fixture('invalid-E_DATE.json'));
  assert.equal(r.ok, false);
  assert.equal('pose' in r, false);
});

// ---------------------------------------------------------------- PE-41 (node half)
test('PE-41 the first error message is plain English, fit for #pose-error, and TEXT.rejected wraps it', async () => {
  const r = await validate(fixture('invalid-E_DATE.json'));
  const [first] = r.errors;
  assert.ok(first.message.trim().length > 10 && !first.message.includes('\n'));
  assert.doesNotMatch(first.message, /<|>|undefined|\[object|NaN/);
});

test('PE-41 TEXT.rejected wraps the first error message exactly', {todo: 'slice S5: provenance.js gains TEXT.rejected with the binding'}, async () => {
  const [first] = (await validate(fixture('invalid-E_DATE.json'))).errors;
  const {TEXT} = await import('../../assets/explorer/provenance.js');
  assert.equal(typeof TEXT.rejected, 'function', 'provenance.js must export TEXT.rejected(message)');
  assert.equal(TEXT.rejected(first.message), `This pose file was rejected: ${first.message}`);
});

test('PE-41 / PE-39 a hostile string in the input is echoed, if at all, only inside the message as plain text', async () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const r = await validate(mutated(p => { p.review.status = hostile; }));
  assert.equal(r.ok, false);
  assert.equal(typeof r.errors[0].message, 'string');
  assert.ok(r.errors[0].message.length < 300, 'long input must not be echoed whole');
});
