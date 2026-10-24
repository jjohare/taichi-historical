// Pure: every user-facing label and message string for the spatial study, and the rule that derives the
// model label from state. The label is always derived, never set on its own (design §6).
export const TEXT = {
  avatar: 'ILLUSTRATIVE AVATAR',
  unavailable: 'JOINT RIG · AVATAR UNAVAILABLE',
  lost: 'The 3D graphics context was interrupted. Reload to restore the viewer.',
};

// S1 only distinguishes the rig; estimate provenance joins this in later slices.
// Returns {tag}; tag is null while the markup's own NEUTRAL RIG label should stand.
export function provenanceFor(state) {
  if (state.rig === 'avatar') return {tag: TEXT.avatar};
  if (state.rig === 'fallback-rig') return {tag: TEXT.unavailable};
  return {tag: null};
}
