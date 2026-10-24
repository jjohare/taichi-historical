// Pure (ADR-0008): damped hinge per garment piece; bones untouched.
import {Quaternion, Vector3} from '../vendor/three.core.js';

export const OMEGA = 20, K_SPIN = .12, K_DROP = 120, SETTLE_MS = 400, SETTLE_CAP_MS = 600, REST_DEG = .2, REST_DPS = 1, RAD = Math.PI / 180;

// Closed-form critically damped step towards c (PE-62).
export function springStep(theta, v, c, dt) {
  const e = theta - c, b = v + OMEGA * e, k = Math.exp(-OMEGA * dt);
  return [c + (e + b * dt) * k, (v - OMEGA * b * dt) * k];
}
export {springStep as step};

// report: [{node, parent, maxDegrees, inwardDegrees, drop, restLocal}]; empty = inert (PE-61).
export function createLag(rig, report) {
  const S = report.map(n => ({n, th: 0, v: 0, prev: null, rest: new Quaternion().fromArray(n.restLocal)}));
  const q = new Quaternion(), d = new Quaternion(), r = new Quaternion(), a = new Vector3();
  let active = false, py = null;
  const busy = () => S.some(s => Math.abs(s.th) >= REST_DEG || Math.abs(s.v) >= REST_DPS);
  const put = s => rig.setLagLocal(s.n.node, r.copy(s.rest).multiply(d.setFromAxisAngle(a.set(1, 0, 0), s.th * RAD)).toArray());
  return {
    get active() { return active; },
    begin() { py = null; for (const s of S) s.prev = null; },
    // quats: Map<parent, world xyzw>; true while a piece moves
    step(dt, quats, pelvis) {
      if (!(dt > 0) || !S.length) return busy();
      active = true;
      const vy = py === null ? 0 : (pelvis[1] - py) / dt; py = pelvis[1];
      for (const s of S) {
        const {n} = s, hi = n.inwardDegrees ?? n.maxDegrees; let w = 0;
        q.fromArray(quats.get(n.parent));
        if (s.prev) { // twist of q*q0^-1 about the world hinge
          d.copy(q).multiply(s.prev.invert()); if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w);
          a.set(1, 0, 0).applyQuaternion(r.copy(q).multiply(s.rest));
          w = 2 * Math.atan2(d.x * a.x + d.y * a.y + d.z * a.z, d.w) / dt / RAD;
        }
        (s.prev ??= new Quaternion()).copy(q);
        [s.th, s.v] = springStep(s.th, s.v, Math.min(hi, Math.max(-n.maxDegrees, n.drop ? K_DROP * vy - K_SPIN * w : -K_SPIN * w)), dt);
        if (s.th < -n.maxDegrees) { s.th = -n.maxDegrees; s.v = Math.max(0, s.v); } else if (s.th > hi) { s.th = hi; s.v = Math.min(0, s.v); }
        put(s);
      }
      return busy();
    },
    reset() { active = false; py = null; for (const s of S) { s.th = s.v = 0; s.prev = null; put(s); } },
    angles: () => Object.fromEntries(S.map(s => [s.n.node, s.th])),
  };
}
