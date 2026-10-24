// PE-03 (node half): retarget.bendQuaternion reproduces today's bend() from GLB rest data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRest, expectedBend, toArray, quatClose} from '../helpers/glb.mjs';

const {rest, jointNames} = loadRest();
// The rest data design §4 hands to retarget.js: Map<name, {local, world, position}> of plain [x,y,z,w] arrays.
const restData = new Map([...rest].map(([n, r]) => [n, {local: toArray(r.local), world: toArray(r.world), position: r.position.toArray()}]));

test('fixture: the GLB has the 24 skin joints this suite relies on', () => {
  assert.equal(jointNames.length, 24);
  for (const n of ['pelvis', 'left_elbow', 'right_elbow', 'left_hip', 'left_knee', 'left_ankle']) assert.ok(rest.has(n), n);
});

test('PE-03 retarget.bendQuaternion equals the viewer.js bend() formula for the diagnostic joints', async () => {
  const {bendQuaternion} = await import('../../assets/explorer/retarget.js');
  for (const name of ['left_elbow', 'right_elbow', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle']) {
    for (const degrees of [-100, -65, -40, 0, 30, 60, 100]) {
      const got = bendQuaternion(restData, name, degrees), want = toArray(expectedBend(rest, name, degrees));
      assert.ok(quatClose(got, want), `${name} ${degrees}°: got ${got}, want ${want}`);
    }
  }
});

test('PE-03 bendQuaternion at 0° is the rest local quaternion', async () => {
  const {bendQuaternion} = await import('../../assets/explorer/retarget.js');
  assert.ok(quatClose(bendQuaternion(restData, 'left_elbow', 0), restData.get('left_elbow').local));
});
