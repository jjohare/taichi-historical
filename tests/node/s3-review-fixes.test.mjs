// Slice S3 review fixes, node half: the TEXT strings that state what the avatar shows (C5: never imply a measurement or a
// photograph), and fetchEstimate binding the file's own imageId to the index entry it was fetched for (E_IMAGE_ID).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture} from '../helpers/poses.mjs';

const provenance = () => import('../../assets/explorer/provenance.js');
const poses = () => import('../../assets/explorer/poses.js');
const sha256 = text => createHash('sha256').update(Buffer.from(text)).digest('hex');
const BASE = new URL('http://localhost/assets/pose-estimates/');

// ---------------------------------------------------------------- provenance.js TEXT
test('PE-24 TEXT: the still-path strings are the exact spec literals', async () => {
  const {TEXT} = await provenance();
  assert.equal(TEXT.lost, 'The 3D view was interrupted. Trying to restore it…');
  assert.equal(TEXT.failed, 'The 3D view could not be restored. Reload the page to try again; the image archive is unaffected.');
  assert.equal(TEXT.none, '3D view unavailable in this browser. This still image shows the neutral illustrative avatar, not the selected position.');
  assert.equal(TEXT.still, 'ILLUSTRATIVE AVATAR · STILL IMAGE');
});

test('C5 TEXT: the estimate-state panel sentence says it is a reviewed estimate, not a measurement', async () => {
  const {TEXT} = await provenance();
  assert.equal(TEXT.estimateNote, 'This avatar shows a reviewed estimate for the displayed photograph, not a measurement.');
  assert.match(TEXT.estimateNote, /estimate/);
  assert.match(TEXT.estimateNote, /not a measurement/);
});

test('C5 TEXT: the non-estimate panel sentence does not claim the avatar is a recovered posture or a measurement', async () => {
  const {TEXT} = await provenance();
  assert.equal(TEXT.otherNote, 'This avatar is not a measurement.');
  assert.equal(TEXT.independent, 'This illustrative avatar is independent of the selected position.');
  assert.doesNotMatch(TEXT.otherNote, /reviewed/i, 'only an applied reviewed estimate may be called reviewed');
});

test('PE-24 TEXT: the canvas aria-label states what is shown, and names the image only for an estimate', async () => {
  const {TEXT} = await provenance();
  assert.equal(TEXT.aria, 'Orbitable neutral human rig. Camera controls are available below.');
  assert.equal(typeof TEXT.ariaEstimate, 'function');
  const label = 'Chen Weiming 1933, photograph 1';
  const aria = TEXT.ariaEstimate(label);
  assert.equal(aria, `Orbitable avatar showing an estimated pose for ${label}`);
  assert.ok(aria.includes(label));
  assert.match(aria, /estimated pose/);
  assert.doesNotMatch(TEXT.aria, /estimate/i, 'the neutral label must not mention an estimate');
});

// ---------------------------------------------------------------- poses.js fetchEstimate: imageId binding
async function withStub(routes, fn) {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    const name = String(url).split('/').pop();
    return name in routes ? new Response(routes[name], {status: 200}) : new Response('no', {status: 404});
  };
  try { return await fn(calls); } finally { globalThis.fetch = original; }
}
/** valid-full.json re-labelled for another image (id and source path together, as a publisher would). */
const poseTextFor = imageId => {
  const object = fixture('valid-full.json');
  object.imageId = imageId; object.sourceImage.path = `extracted/historical/${imageId}.png`;
  return JSON.stringify(object);
};

test('PE-34 fetchEstimate rejects a file whose imageId differs from its index entry with E_IMAGE_ID', async () => {
  const {fetchEstimate} = await poses();
  const wrong = poseTextFor('chen-002');         // a valid, correctly hashed file for another image, served under chen-001.json
  await withStub({'chen-001.json': wrong}, async () => {
    const r = await fetchEstimate(BASE, {file: 'chen-001.json', sha256: sha256(wrong)});
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].code, 'E_IMAGE_ID');
    assert.equal(r.pose, undefined, 'no pose may escape a rejected result');
  });
});

test('PE-34 fetchEstimate rejects a cross-source swap (chen file under a yang entry) with E_IMAGE_ID', async () => {
  const {fetchEstimate} = await poses();
  const wrong = poseTextFor('chen-001');
  await withStub({'yang-001.json': wrong}, async () => {
    const r = await fetchEstimate(BASE, {file: 'yang-001.json', sha256: sha256(wrong)});
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].code, 'E_IMAGE_ID');
  });
});

test('PE-34 fetchEstimate accepts a file whose imageId matches its entry (control for the E_IMAGE_ID checks)', async () => {
  const {fetchEstimate} = await poses();
  const right = poseTextFor('chen-002');
  await withStub({'chen-002.json': right}, async calls => {
    const r = await fetchEstimate(BASE, {file: 'chen-002.json', sha256: sha256(right)});
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.pose.imageId, 'chen-002');
    assert.equal(calls.length, 1);
  });
});

test('PE-34 the hash check still runs first: a mismatching hash on a mislabelled file is E_HASH', async () => {
  const {fetchEstimate} = await poses();
  const wrong = poseTextFor('chen-002');
  await withStub({'chen-001.json': wrong}, async () => {
    const r = await fetchEstimate(BASE, {file: 'chen-001.json', sha256: 'f'.repeat(64)});
    assert.equal(r.errors[0].code, 'E_HASH');
  });
});

test('C5 provenanceFor carries the panel note and canvas aria-label for each state', async () => {
  const {provenanceFor, TEXT} = await provenance();
  const file = fixture('valid-full.json');
  const est = provenanceFor({kind: 'estimate', origin: 'published', file}, {rig: 'avatar', imageLabel: 'Chen Weiming 1933, photograph 1'});
  assert.equal(est.note, TEXT.estimateNote);
  assert.equal(est.aria, TEXT.ariaEstimate('Chen Weiming 1933, photograph 1'));
  const neutral = provenanceFor({kind: 'neutral'}, {rig: 'avatar'});
  assert.deepEqual([neutral.note, neutral.aria], [TEXT.independent, TEXT.aria]);
  const local = provenanceFor({kind: 'estimate', origin: 'local', file}, {rig: 'avatar'});
  assert.equal(local.note, TEXT.otherNote);
  const mid = provenanceFor({kind: 'interpolated'}, {rig: 'avatar', transition: {hopsTotal: 2}});
  assert.equal(mid.note, TEXT.otherNote);
});
