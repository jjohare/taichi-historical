// Pose-fixture helpers for slice S4. The forward kinematics here is an independent implementation of design §5.3
// (L = L_r · (W_r⁻¹ · Q · W_r)), written against the GLB rest data, so it can check retarget.js rather than mirror it.
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {ROOT} from './files.mjs';
import {loadRest, toArray} from './glb.mjs';
import {Quaternion, Vector3} from '../../assets/vendor/three.core.js';

export const FIXTURE_DIR = path.join(ROOT, 'tests/fixtures/poses');
export const fixtureText = name => readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
export const fixture = name => JSON.parse(fixtureText(name));
export const fixtureNames = () => readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.json')).sort();

const glb = loadRest();
export const JOINTS = glb.jointNames;                 // skin order
export const POSE_JOINTS = JOINTS.filter(n => n !== 'pelvis');

/** Rest data in the plain-array shape design §4 hands to retarget.js. */
export const restData = new Map([...glb.rest].map(([n, r]) => [n, {local: toArray(r.local), world: toArray(r.world), position: r.position.toArray()}]));

const nodes = glb.json.nodes, parentIndex = new Map();
nodes.forEach((n, i) => (n.children ?? []).forEach(c => parentIndex.set(c, i)));
const nameOf = i => nodes[i].name;
export const PARENT = new Map(JOINTS.map(n => [n, parentIndex.has(nodes.findIndex(x => x.name === n)) ? nameOf(parentIndex.get(nodes.findIndex(x => x.name === n))) : null]));

/** Independent §5.3 local quaternion for a delta Q given in rest-world axes. */
export function localFor(name, q) {
  const r = glb.rest.get(name), Q = new Quaternion().fromArray(q).normalize();
  const inner = r.world.clone().invert().multiply(Q).multiply(r.world);
  return r.local.clone().multiply(inner);
}

/** World positions of all joints for a map of deltas {name: [x,y,z,w]} (rest for absent) and a root translation offset. */
export function fkPositions(deltas, root = {rotation: [0, 0, 0, 1], translation: [0, 0, 0]}) {
  const world = new Map(), pos = new Map();
  for (const name of JOINTS) {                       // skin order lists parents before children
    const q = name === 'pelvis' ? root.rotation : deltas[name] ?? [0, 0, 0, 1];
    const L = localFor(name, q), p = PARENT.get(name), t = glb.rest.get(name).position;
    if (!world.has(p)) { world.set(name, L.clone()); pos.set(name, t.clone().add(new Vector3(...(name === 'pelvis' ? root.translation : [0, 0, 0])))); continue; }
    world.set(name, world.get(p).clone().multiply(L));
    pos.set(name, pos.get(p).clone().add(t.clone().applyQuaternion(world.get(p))));
  }
  return pos;
}

export const axisAngle = (axis, degrees) => toArray(new Quaternion().setFromAxisAngle(new Vector3(...axis).normalize(), degrees * Math.PI / 180));
const r4 = v => v.map(x => Math.round(x * 1e4) / 1e4);
const r4unit = q => { const n = Math.hypot(...q); return r4(q.map(x => x / n)); };

export const HASH_A = '3ca6f2ac01fccc002e4f04deeec6fa3f65442c0e6d4db0e3943609b87dab032f';
export const HASH_B = '9f2b1c7d5e8a4036b1d2c3e4f5a60718293a4b5c6d7e8f90a1b2c3d4e5f60718';
export const REV_A = '0123456789abcdef0123456789abcdef01234567';
export const REV_B = 'fedcba9876543210fedcba9876543210fedcba98';

/** A complete, valid published pose around the given deltas; landmarks come from the independent FK. */
export function makePose(deltas, {imageId = 'chen-001', notes, overlay = true} = {}) {
  const q = Object.fromEntries(Object.entries(deltas).map(([k, v]) => [k, r4unit(v)]));
  const pos = fkPositions(q);
  const lm = n => r4(pos.get(n).toArray());
  return {
    schema: 'yang-form/pose-estimate', schemaVersion: 1, imageId,
    sourceImage: {path: `extracted/historical/${imageId}.png`, sha256: HASH_A, crop: [10, 20, 300, 480], personPrompt: 'box', mirrored: false},
    estimator: {name: 'SAM 3D Body', repository: 'https://github.com/facebookresearch/sam-3d-body', revision: REV_A,
      checkpoint: 'facebook/sam-3d-body-dinov3', checkpointSha256: HASH_B, licence: 'SAM License', outputFrame: 'camera frame: +X right, +Y down, +Z forward'},
    rig: {name: 'MHR', repository: 'https://github.com/facebookresearch/MHR', revision: REV_B, modelSha256: HASH_A},
    converter: {path: 'tools/pose-estimation/convert.py', revision: REV_A},
    jointConvention: 'yang-form-24/rest-world-delta@1', jointMap: 'mhr-to-yang24@1',
    frame: {up: '+Y', forward: '+Z', left: '+X', units: 'm'},
    root: {translation: [0, 0, 0], rotation: [0, 0, 0, 1]},
    joints: Object.fromEntries(Object.entries(q).map(([k, v]) => [k, {rotation: v, confidence: 0.8}])),
    landmarks: {left_wrist: lm('left_wrist'), right_wrist: lm('right_wrist'), left_ankle: lm('left_ankle'), right_ankle: lm('right_ankle')},
    confidence: {overall: 0.72, method: 'mean keypoint visibility × reviewer grade'},
    review: {status: 'accepted', reviewer: 'jjohare', date: '2026-10-24', leftRight: 'as-photographed',
      checks: {projection: true, leftRight: true, standingLeg: true, handsFeet: true, truncation: true},
      ...(overlay ? {overlaySha256: HASH_B} : {}), ...(notes ? {notes} : {})},
  };
}
