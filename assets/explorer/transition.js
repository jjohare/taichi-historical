// Pure (ADR-0007, design §12): route planning, interpolation and the frame driver. Clock and scheduler are injected.
import {Quaternion} from '../vendor/three.core.js';
import {POSE_JOINTS} from './pose-schema.js';

export const HOP_MS = 1600, CAP_MS = 3000, MAX_KEYFRAMES = 24;

// One element per entry in ordinal order: the first image of `source` (what site.js shows), or null. Drawings never have estimates.
export const keyframeSequence = (catalogue, source) => [...catalogue].sort((a, b) => a.ordinal - b.ordinal).map(m => ({
  moveId: m.id, imageId: source === 'montage' ? null : m.images.find(i => i.source === source)?.file.replace(/\.png$/, '') ?? null}));
export const sequenceIndexOf = (sequence, moveId) => sequence.findIndex(e => e.moveId === moveId);

// Reviewed keyframes strictly after fromIndex up to toIndex, in travel order; repeats collapse; thinned evenly, target kept (PE-44, PE-48).
export function planRoute(sequence, fromIndex, toIndex, estimates, {startImageId} = {}) {
  const step = Math.sign(toIndex - fromIndex), ids = [];
  let last = startImageId;
  for (let i = fromIndex + step; step && i !== toIndex + step; i += step) {
    const id = sequence[i].imageId;
    if (id && estimates.has(id) && id !== last) ids.push(last = id);
  }
  if (!estimates.has(sequence[toIndex]?.imageId)) return {keyframes: [], skipped: 0};
  const n = ids.length, skipped = Math.max(0, n - MAX_KEYFRAMES);
  return {keyframes: skipped ? Array.from({length: MAX_KEYFRAMES}, (_, i) => ids[Math.round((i + 1) * n / MAX_KEYFRAMES) - 1]) : ids, skipped};
}

export const routeTiming = hops => ({total: Math.min(HOP_MS * hops, CAP_MS), perHop: Math.min(HOP_MS, CAP_MS / hops)});
export const easeInOutCubic = x => x < .5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;

const qa = new Quaternion(), qb = new Quaternion();
const slerp = (a, b, t) => qa.fromArray(a ?? [0, 0, 0, 1]).slerp(qb.fromArray(b ?? [0, 0, 0, 1]), t).toArray(); // three's slerp takes the shortest arc

// Pure (PE-46): shortest-arc slerp of each joint's delta and of root.rotation, lerp of root.translation. Result has no provenance.
export function interpolatePose(a, b, t) {
  const joints = {}, ta = a.root?.translation ?? [0, 0, 0], tb = b.root?.translation ?? [0, 0, 0];
  for (const name of POSE_JOINTS) if (a.joints?.[name] || b.joints?.[name]) joints[name] = {rotation: slerp(a.joints?.[name]?.rotation, b.joints?.[name]?.rotation, t)};
  return {joints, root: {translation: ta.map((x, i) => x + (tb[i] - x) * t), rotation: slerp(a.root?.rotation, b.root?.rotation, t)}};
}

// The pose at eased progress p along poses = [start, k1…kN]; keyframe k is reached exactly at p = k/N.
export function sampleRoute(poses, p) {
  const n = poses.length - 1, hopIndex = Math.min(n - 1, Math.floor(p * n));
  return {pose: interpolatePose(poses[hopIndex], poses[hopIndex + 1], p * n - hopIndex), hopIndex};
}

// The only self-rescheduling frame loop in the explorer (PE-08, PE-53): it runs only between start() and arrival.
// ADR-0008: after arrival it may run a settle window while onSettle(dt) returns true, for at most settleCapMs (PE-53).
export function createDriver({requestFrame, cancelFrame, now, onFrame, onArrive, onSettle, onSettled, settleCapMs = 0}) {
  let poses = null, handle = null, t0 = 0, total = 0, latest = null, last = 0, t1 = null;
  const stop = () => { if (handle !== null) cancelFrame(handle); handle = poses = t1 = null; };
  const end = () => { t1 = null; onSettled?.(); };
  const tick = () => {
    handle = null;
    const n = now(), dt = (n - last) / 1000; last = n;
    if (t1 !== null) { if (n - t1 < settleCapMs && onSettle(dt)) handle = requestFrame(tick); else end(); return; }
    const x = Math.min(1, (n - t0) / total), p = easeInOutCubic(x);
    latest = {...sampleRoute(poses, p), progress: p}; onFrame(latest, p, dt);
    if (x < 1) handle = requestFrame(tick);
    else {
      stop(); onArrive(); // a cancel inside onArrive must not suppress the window
      if (onSettle && poses === null) { t1 = last = now(); if (onSettle(0)) handle = requestFrame(tick); else end(); }
    }
  };
  const start = list => { stop(); poses = list; total = routeTiming(list.length - 1).total; t0 = last = now(); latest = null; handle = requestFrame(tick); };
  return {
    start, retarget: start, current: () => latest,
    finish() { if (poses) { stop(); onArrive(); } },
    cancel() { stop(); latest = null; },
  };
}
