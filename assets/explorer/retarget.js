// Pure rig mathematics (design §5). Imports three.js maths only through the relative core path so the
// module also runs under node --test, where there is no import map. Quaternions are [x, y, z, w].
import {Quaternion, Vector3, MathUtils} from '../vendor/three.core.js';

const unit = new Vector3(1, 0, 0);

// Today's diagnostic bend: L = L_rest · axisAngle(W_rest⁻¹ · X, degrees). Parent-relative.
// Returns null for a joint that has no rest data, so callers can skip it.
export function bendQuaternion(rest, name, degrees) {
  const basis = rest.get(name);
  if (!basis) return null;
  const world = new Quaternion().fromArray(basis.world).invert();
  const axis = unit.clone().applyQuaternion(world);
  return new Quaternion().fromArray(basis.local)
    .multiply(new Quaternion().setFromAxisAngle(axis, MathUtils.degToRad(degrees))).toArray();
}

// Size of the rotation from rest, in degrees, whatever its axis.
export function jointAngleDegrees(restLocal, currentLocal) {
  const delta = new Quaternion().fromArray(restLocal).invert().multiply(new Quaternion().fromArray(currentLocal));
  return MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(delta.w))));
}
