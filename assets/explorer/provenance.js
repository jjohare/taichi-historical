// Pure: every user-facing label and message string for the spatial study, and the rule that derives the
// model label from state. The label is always derived, never set on its own (design §6).
export const TEXT = {
  neutral: 'Illustrative avatar — not this movement',
  avatar: 'ILLUSTRATIVE AVATAR',
  unavailable: 'JOINT RIG · AVATAR UNAVAILABLE',
  lost: 'The 3D graphics context was interrupted. Reload to restore the viewer.',
};

// Pure function of state (ADR-0004): nothing sets the label on its own. `pose` is state.pose; `context` carries
// the rig kind ('pending' while the avatar loads). Returns {tag, text, detail}; tag is null only while pending, so the markup's own NEUTRAL RIG label stands.
// Only the neutral pose exists until S5; any other kind falls back to the conservative neutral wording.
export function provenanceFor(pose, {rig} = {}) {
  const tag = rig === 'pending' ? null : rig === 'fallback-rig' ? TEXT.unavailable : TEXT.avatar;
  return {tag, text: TEXT.neutral, detail: ''};
}
