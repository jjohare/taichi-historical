// Regenerates every pose fixture in this directory: `node tests/fixtures/poses/generate.mjs`.
// Landmarks come from an independent forward-kinematics implementation (tests/helpers/poses.mjs), never from retarget.js.
// Not generated here: invalid-E_SIZE (built at test time, > 64 KiB), invalid-E_JSON.json and invalid-proto-pollution.json (hand-written text).
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {FIXTURE_DIR, makePose, axisAngle, POSE_JOINTS} from '../../helpers/poses.mjs';

const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const write = (name, value) => writeFileSync(path.join(FIXTURE_DIR, name), JSON.stringify(value, null, 2) + '\n');
const clone = v => JSON.parse(JSON.stringify(v));

// valid-minimal: one joint.
write('valid-minimal.json', makePose({left_elbow: axisAngle(X, -40)}, {overlay: false}));

// valid-full: all 23 non-root joints, each rotated by a distinct modest amount; notes and an overlay hash.
const axes = [X, Y, Z], full = {};
POSE_JOINTS.forEach((name, i) => { full[name] = axisAngle(axes[i % 3], (i % 2 ? -1 : 1) * (6 + 2 * i)); });
write('valid-full.json', makePose(full, {notes: 'Sleeve hides the left elbow; elbow angle uncertain.'}));

// valid-crossed-hands: the wrists meet at the midline (mirror-symmetric arms), so the wrist pair is inconclusive.
write('valid-crossed-hands.json', makePose({
  left_collar: axisAngle(Y, -30), left_shoulder: axisAngle(Y, -105), left_elbow: axisAngle(Y, -30),
  right_collar: axisAngle(Y, 30), right_shoulder: axisAngle(Y, 105), right_elbow: axisAngle(Y, 30),
}, {imageId: 'chen-002'}));

// invalid-mirrored: an asymmetric pose (left arm raised, right leg stepped forward). Landmarks describe the true pose;
// the joint rotations are then swapped between sides, as a wrong jointMap would do.
const truth = {left_shoulder: axisAngle(Z, 80), right_hip: axisAngle(X, -40)};
const mirrored = makePose(truth, {imageId: 'chen-003'});
mirrored.joints = {
  right_shoulder: mirrored.joints.left_shoulder,
  left_hip: mirrored.joints.right_hip,
};
write('invalid-mirrored.json', mirrored);

// One single-fault fixture per error code, each derived from valid-full.
const base = makePose(full, {notes: 'Sleeve hides the left elbow; elbow angle uncertain.'});
const fault = (name, edit) => { const p = clone(base); edit(p); write(name, p); };
fault('invalid-E_SCHEMA_ID.json', p => { p.schema = 'yang-form/pose'; });
fault('invalid-E_VERSION.json', p => { p.schemaVersion = 2; });
fault('invalid-E_UNKNOWN_KEY.json', p => { p.extra = true; });
fault('invalid-E_MISSING.json', p => { delete p.review; });
fault('invalid-E_MISSING-landmark.json', p => { delete p.landmarks.right_ankle; });
fault('invalid-E_IMAGE_ID.json', p => { p.imageId = 'panel-001'; p.sourceImage.path = 'extracted/historical/panel-001.png'; });
fault('invalid-E_HASH.json', p => { p.sourceImage.sha256 = 'not-a-sha256'; });
fault('invalid-E_REVISION.json', p => { p.estimator.revision = 'abc123'; });
fault('invalid-E_JOINT_NAME.json', p => { p.joints.left_toe = {rotation: [0, 0, 0, 1]}; });
fault('invalid-E_QUAT.json', p => { p.joints.left_elbow.rotation = [0, 0, 0, 0.5]; });
fault('invalid-E_RANGE.json', p => { p.confidence.overall = 1.2; });
fault('invalid-E_DATE.json', p => { p.review.date = '2026-13-01'; });
fault('invalid-E_STATUS.json', p => { p.review.status = 'draft'; });
fault('invalid-E_FRAME.json', p => { p.frame.up = '+Z'; });
fault('invalid-E_CONVENTION.json', p => { p.jointConvention = 'yang-form-24/rest-world-delta@2'; });
fault('invalid-E_TYPE.json', p => { p.estimator.name = 'Some Other Estimator'; });
