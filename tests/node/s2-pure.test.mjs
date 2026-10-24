// Slice S2, node half: PE-10 (preset table), PE-13 (joint list vs GLB), PE-15 (angle function), PE-17 (neutral provenance), PE-38.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRest} from '../helpers/glb.mjs';
import {read, explorerFiles, stripComments} from '../helpers/files.mjs';
import {Quaternion, Vector3} from '../../assets/vendor/three.core.js';
import {PRESET_POSITIONS, NEUTRAL_TEXT} from '../helpers/s2.mjs';

const {jointNames} = loadRest();

test('PE-10 presets.js places every preset where design §5.4 says, looking at (0, 0.95, 0)', async () => {
  const {PRESETS, TARGET, presetPosition} = await import('../../assets/explorer/presets.js');
  assert.deepEqual([...TARGET], [0, 0.95, 0]);
  assert.deepEqual(Object.keys(PRESETS).sort(), Object.keys(PRESET_POSITIONS).sort());
  for (const [name, want] of Object.entries(PRESET_POSITIONS)) {
    const got = presetPosition(name);
    assert.ok(Math.hypot(...got.map((v, i) => v - want[i])) < 1e-3, `${name}: got ${got}, want ${want}`);
  }
});

test('PE-13 index.html has a native <select id="joint-select">', () => {
  assert.match(read('index.html'), /<select\b[^>]*\bid="joint-select"/);
});

test('PE-13 any statically written joint options equal the GLB skin joint names (runtime-built lists are covered by the browser test)', t => {
  const html = read('index.html');
  const select = html.match(/<select\b[^>]*\bid="joint-select"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(select, 'no #joint-select');
  const values = [...select[1].matchAll(/<option\b[^>]*\bvalue="([^"]*)"/g)].map(m => m[1]).filter(v => v !== '' && v !== 'none');
  if (!values.length) return t.skip('options are built at runtime; asserted against the GLB in the browser test');
  assert.deepEqual([...values].sort(), [...jointNames].sort());
});

test('PE-15 jointAngleDegrees returns the size of the rotation from rest for any axis', async () => {
  const {jointAngleDegrees} = await import('../../assets/explorer/retarget.js');
  const rad = d => d * Math.PI / 180;
  const restQ = new Quaternion().setFromAxisAngle(new Vector3(0.3, 0.5, -0.8).normalize(), rad(70));   // non-identity rest
  for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [-2, 0.5, 3]]) {
    for (const degrees of [0, 40, 90, 170]) {
      const current = restQ.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(...axis).normalize(), rad(degrees)));
      const got = jointAngleDegrees(restQ.toArray(), current.toArray());
      assert.ok(Math.abs(got - degrees) < 0.5, `axis ${axis}, ${degrees}°: got ${got}`);
    }
  }
  const identity = [0, 0, 0, 1];
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rad(40));
  assert.ok(Math.abs(jointAngleDegrees(identity, q.toArray()) - 40) < 0.5);
  assert.ok(Math.abs(jointAngleDegrees(identity, q.toArray().map(v => -v)) - 40) < 0.5, 'q and −q are the same rotation');
});

test('PE-17 provenanceFor({kind:"neutral"}) returns the neutral wording', async () => {
  const {provenanceFor} = await import('../../assets/explorer/provenance.js');
  const result = provenanceFor({kind: 'neutral'}, {imageLabel: ''});
  assert.equal(result.text, NEUTRAL_TEXT);
  assert.equal(result.tag, 'ILLUSTRATIVE AVATAR');
});

test('PE-38 no American spellings in string literals of assets/explorer/*.js', () => {
  const words = /\b(color|colors|center|centers|gray|behavior|normalize)\b/i;
  for (const f of explorerFiles()) {
    const code = stripComments(f.source);
    for (const m of code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)) {
      const text = m[0].replace(/\$\{[^}]*\}/g, '');   // template expressions are code (property names), not copy
      assert.ok(!words.test(text), `${f.name}: ${m[0]}`);
    }
  }
});
