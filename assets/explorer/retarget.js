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

// Design §5.3: L = L_rest · (W_rest⁻¹ · Q · W_rest), with Q the delta in rest-world axes. Null for a joint without rest data.
// bendQuaternion is the special case Q = axisAngle(+X, θ).
export function retargetJoint(rest, name, delta) {
  const basis = rest.get(name);
  if (!basis) return null;
  const world = new Quaternion().fromArray(basis.world);
  const inWorld = new Quaternion().fromArray(delta).normalize();
  return new Quaternion().fromArray(basis.local).multiply(world.clone().invert().multiply(inWorld).multiply(world)).toArray();
}

// Pure. Every rest joint gets a local quaternion; joints the pose omits stay at rest. The pelvis takes root.rotation.
export function applyPose(rest, pose) {
  const locals = new Map();
  for (const name of rest.keys()) {
    const delta = name === 'pelvis' ? pose.root?.rotation : pose.joints?.[name]?.rotation;
    locals.set(name, delta ? retargetJoint(rest, name, delta) : [...rest.get(name).local]);
  }
  return {locals, rootTranslation: pose.root?.translation ? [...pose.root.translation] : [0, 0, 0]};
}

const PARENT = {spine1: 'pelvis', spine2: 'spine1', spine3: 'spine2', neck: 'spine3', head: 'neck'};
for (const side of ['left', 'right']) {
  Object.assign(PARENT, {[`${side}_hip`]: 'pelvis', [`${side}_knee`]: `${side}_hip`, [`${side}_ankle`]: `${side}_knee`, [`${side}_foot`]: `${side}_ankle`,
    [`${side}_collar`]: 'spine3', [`${side}_shoulder`]: `${side}_collar`, [`${side}_elbow`]: `${side}_shoulder`, [`${side}_wrist`]: `${side}_elbow`, [`${side}_hand`]: `${side}_wrist`});
}

// Joint positions in avatar world space: G = G_parent · L, p = p_parent + G_parent · position. Rest data supplies the offsets.
export function forwardKinematics(rest, locals, rootTranslation = [0, 0, 0]) {
  const globals = new Map(), points = new Map(), shift = new Vector3().fromArray(rootTranslation);
  const solve = name => {
    if (points.has(name)) return;
    const parent = PARENT[name], basis = rest.get(name);
    const local = new Quaternion().fromArray(locals.get(name) ?? basis.local), offset = new Vector3().fromArray(basis.position);
    if (!parent || !rest.has(parent)) { globals.set(name, local); points.set(name, offset.add(shift)); return; }
    solve(parent);
    globals.set(name, globals.get(parent).clone().multiply(local));
    points.set(name, offset.applyQuaternion(globals.get(parent)).add(points.get(parent)));
  };
  for (const name of rest.keys()) solve(name);
  return new Map([...points].map(([name, point]) => [name, point.toArray()]));
}

// PE-33. Compares the posed wrist and ankle with the estimator's own landmarks, same side against crossed.
// Differences under 0.05 m are inconclusive (reported, not an error). Catches swapped map entries, not a mirrored photograph.
export function checkLeftRight(rest, pose) {
  const {locals, rootTranslation} = applyPose(rest, pose), posed = forwardKinematics(rest, locals, rootTranslation);
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const pairs = {}, errors = [];
  for (const part of ['wrist', 'ankle']) {
    const left = `left_${part}`, right = `right_${part}`, lm = pose.landmarks;
    const same = distance(posed.get(left), lm[left]) + distance(posed.get(right), lm[right]);
    const swap = distance(posed.get(left), lm[right]) + distance(posed.get(right), lm[left]);
    pairs[part] = Math.abs(same - swap) < 0.05 ? 'inconclusive' : same < swap ? 'consistent' : 'swapped';
    if (pairs[part] === 'swapped') errors.push({code: 'E_LEFT_RIGHT', path: `landmarks.${left}`, message: `The posed ${part}s sit closer to the opposite side's landmarks, so left and right look swapped.`});
  }
  return {ok: !errors.length, errors, pairs};
}
