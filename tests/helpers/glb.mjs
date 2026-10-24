// Parses rest data straight from the GLB JSON chunk, independent of GLTFLoader and of any explorer module.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {ROOT} from './files.mjs';
import {Quaternion, Vector3} from '../../assets/vendor/three.core.js';

export function loadGlbJson(rel = 'assets/model/archive-avatar.glb') {
  const glb = readFileSync(path.join(ROOT, rel));
  if (glb.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB');
  return JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)).trim());
}

/** Rest data keyed by joint name: local/world quaternions and local position, as three.js objects. */
export function loadRest() {
  const json = loadGlbJson();
  const nodes = json.nodes;
  const parent = new Map();
  nodes.forEach((n, i) => (n.children ?? []).forEach(c => parent.set(c, i)));
  const localQ = i => {
    if (nodes[i].matrix) throw new Error('matrix nodes are not supported by this fixture loader');
    const r = nodes[i].rotation ?? [0, 0, 0, 1];
    return new Quaternion(r[0], r[1], r[2], r[3]);
  };
  const worldQ = i => (parent.has(i) ? worldQ(parent.get(i)).multiply(localQ(i)) : localQ(i));
  const jointIndexes = json.skins[0].joints;
  const rest = new Map();
  for (const i of jointIndexes) {
    const t = nodes[i].translation ?? [0, 0, 0];
    rest.set(nodes[i].name, {local: localQ(i), world: worldQ(i), position: new Vector3(t[0], t[1], t[2])});
  }
  return {rest, jointNames: jointIndexes.map(i => nodes[i].name), json};
}

export const toArray = q => [q.x, q.y, q.z, q.w];

/** The formula at assets/viewer.js L58 (design §5.2): L = L_r · axisAngle(W_r⁻¹ · X̂, θ). */
export function expectedBend(rest, name, degrees) {
  const basis = rest.get(name);
  const axis = new Vector3(1, 0, 0).applyQuaternion(basis.world.clone().invert());
  return basis.local.clone().multiply(new Quaternion().setFromAxisAngle(axis, degrees * Math.PI / 180));
}

/** Quaternion equivalence used by the spec: |dot| ≥ 1 − 1e-9 (q and −q are the same rotation). */
export const quatClose = (a, b) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) / (Math.hypot(...a) * Math.hypot(...b)) >= 1 - 1e-9;
