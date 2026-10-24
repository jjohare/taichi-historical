// Slice S7 helpers (PE-60 to PE-71): a fixture site that can serve a different avatar GLB, and a per-frame lag recorder.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {ROOT} from './files.mjs';
import {serveSite} from './fixture-site.mjs';
import {YANG_IDS, CHEN_ID, poseTextFor, sha256} from './s6.mjs';

export const GLB_URL_PATH = '/assets/model/archive-avatar.glb';
export const LAG_REST = {active: false, settling: false};
export const PIECE_MESH = /cuff|flap|trouser/i, HIDDEN_BY_SKELETON = /palm|finger|thumb|shoe|Head/;

/** The shipped GLB with every `lag:` node name changed to `lug:` (same length, so the chunk sizes stay valid): an avatar with no valid lag node. */
export function glbWithoutLagNodes() {
  const glb = Buffer.from(readFileSync(path.join(ROOT, GLB_URL_PATH.slice(1))));
  const json = glb.toString('latin1', 20, 20 + glb.readUInt32LE(12));
  const renamed = json.replaceAll('"name":"lag:', '"name":"lug:');
  if (renamed === json) throw new Error('no "name":"lag: found in the GLB JSON chunk; the rename would test nothing');
  glb.write(renamed, 20, 'latin1');
  return glb;
}
/** The GLB committed at `rev` (the pre-S7 avatar when rev is its last commit), or null where git history is not available. */
export function glbAtRevision(rev) {
  try { return execFileSync('git', ['show', `${rev}:assets/model/archive-avatar.glb`], {cwd: ROOT, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore']}); } catch { return null; }
}

/** Same fixture tree as serveS6 (every Yang image has an estimate) with `glb` served in place of the avatar when given. */
export async function serveS7({glb} = {}) {
  const ids = [...new Set([...YANG_IDS, CHEN_ID, 'yang-001'])];
  const texts = new Map(ids.map(id => [id, poseTextFor(id)]));
  const index = JSON.stringify({schema: 'yang-form/pose-estimate-index', schemaVersion: 1, estimates: ids.map(id => ({imageId: id, file: `${id}.json`, sha256: sha256(texts.get(id))}))});
  const files = {'/assets/pose-estimates/index.json': index, ...Object.fromEntries(ids.map(id => [`/assets/pose-estimates/${id}.json`, texts.get(id)]))};
  if (glb) files[GLB_URL_PATH] = glb;
  return serveSite({estimates: [], files});
}

/**
 * Page-side recorder: one entry per animation frame in window.__lagRec until stopped. Each entry carries the lag snapshot, the
 * transition state, renderCount and the hash; frames in a settle window also carry the bone rotations and the storage key counts.
 */
export const startLagRecording = page => page.evaluate(`(() => {
  window.__lagRec = []; window.__lagOn = true; const generation = window.__lagGen = (window.__lagGen ?? 0) + 1;
  (function tick() {
    if (!window.__lagOn || window.__lagGen !== generation) return;
    const s = __explorer.state;
    window.__lagRec.push({t: performance.now(), active: s.transition.active, progress: s.transition.progress, kind: s.pose.kind, renderCount: s.renderCount, hash: location.hash,
      lag: s.lag, storage: localStorage.length + sessionStorage.length, bones: s.lag?.settling || s.transition.active ? Object.fromEntries(Object.entries(s.bones).map(([k, v]) => [k, v.quaternion])) : null});
    requestAnimationFrame(tick);
  })();
})()`);
export const stopLagRecording = page => page.evaluate('(() => { window.__lagOn = false; return window.__lagRec; })()');

export const maxAbs = angles => Math.max(0, ...Object.values(angles).map(Math.abs));
export const allZero = angles => Object.values(angles).every(a => a === 0);

/**
 * Wrap `rig.setLagLocal` page-side so that every write to a lag node is logged in window.__lagWrites with `moved` (the written
 * rotation differs from the node's restLocal). Unlike frame sampling this sees every driver step, however slow the sidecar is.
 */
export const logLagWrites = page => page.evaluate(`(() => {
  const rig = __explorer.rig, rest = new Map(rig.lagNodes.map(n => [n.node, n.restLocal]));
  window.__lagWrites = [];
  if (!rig.__logged) {
    const original = rig.setLagLocal; rig.__logged = true;
    rig.setLagLocal = function (node, q) {
      const r = rest.get(node), dot = Math.abs(q[0] * r[0] + q[1] * r[1] + q[2] * r[2] + q[3] * r[3]) / (Math.hypot(...q) * Math.hypot(...r));
      window.__lagWrites.push({t: performance.now(), node, moved: 1 - dot > 1e-10});
      return original.call(this, node, q);
    };
  }
  return rig.lagNodes.length;
})()`);
export const lagWrites = page => page.evaluate('window.__lagWrites');
