// Pure: the 24 avatar bones with plain-English labels, in the five groups the joint list shows (spec PE-13).
export const JOINT_GROUPS = [
  ['Torso and head', [['pelvis', 'Pelvis'], ['spine1', 'Lower spine'], ['spine2', 'Middle spine'], ['spine3', 'Upper spine'], ['neck', 'Neck'], ['head', 'Head']]],
  ['Left arm', [['left_collar', 'Left collarbone'], ['left_shoulder', 'Left shoulder'], ['left_elbow', 'Left elbow'], ['left_wrist', 'Left wrist'], ['left_hand', 'Left hand']]],
  ['Right arm', [['right_collar', 'Right collarbone'], ['right_shoulder', 'Right shoulder'], ['right_elbow', 'Right elbow'], ['right_wrist', 'Right wrist'], ['right_hand', 'Right hand']]],
  ['Left leg', [['left_hip', 'Left hip'], ['left_knee', 'Left knee'], ['left_ankle', 'Left ankle'], ['left_foot', 'Left foot']]],
  ['Right leg', [['right_hip', 'Right hip'], ['right_knee', 'Right knee'], ['right_ankle', 'Right ankle'], ['right_foot', 'Right foot']]],
];
export const JOINT_LABELS = Object.fromEntries(JOINT_GROUPS.flatMap(([, joints]) => joints));

export const readoutText = (name, degrees) => `${JOINT_LABELS[name]}: ${Math.round(degrees)}° from rest`;
