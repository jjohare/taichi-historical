// Pure: every user-facing label and message string for the spatial study, and the rule that derives the
// model label from state. The label is always derived, never set on its own (design §6).
export const TEXT = {
  neutral: 'Illustrative avatar — not this movement',
  avatar: 'ILLUSTRATIVE AVATAR',
  unavailable: 'JOINT RIG · AVATAR UNAVAILABLE',
  lost: 'The 3D graphics context was interrupted. Reload to restore the viewer.',
  estimated: 'ESTIMATED POSE',
  interpolated: 'TRANSITION · INTERPOLATED',
  interpolatedText: 'Interpolating between reviewed estimates — not a photograph',
  local: 'LOCAL FILE · NOT REVIEWED',
  localText: 'Unpublished pose file — local preview, not reviewed for this site',
  slidersLocked: 'Choose “Show neutral avatar” to use the joint checks.',
  rejected: message => `This pose file was rejected: ${message}`,
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** '2026-10-24' → '24 October 2026': no leading zero, no ordinal. */
export const formatReviewDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

// Pure function of state (ADR-0004): nothing sets the label on its own. `pose` is state.pose; the context carries the rig kind
// ('pending' while the avatar loads) and the displayed image's label. Returns {tag, text, detail}; tag is null only while pending,
// so the markup's own NEUTRAL RIG label stands. Every estimate string is built from the validated file alone.
export function provenanceFor(pose, {rig, imageLabel, transition} = {}) {
  if (pose?.kind === 'interpolated') {
    const {hopsTotal, skipped} = transition ?? {};
    return {tag: TEXT.interpolated, text: TEXT.interpolatedText, detail: hopsTotal ? `Via ${hopsTotal} reviewed estimates in sequence order${skipped ? ` · ${skipped} more skipped to keep the transition short` : ''}` : ''};
  }
  if (pose?.kind === 'estimate' && pose.origin === 'local') return {tag: TEXT.local, text: TEXT.localText, detail: ''};
  if (pose?.kind === 'estimate') {
    const {file} = pose;
    return {
      tag: TEXT.estimated,
      text: `Estimated pose — from ${imageLabel ?? file.imageId} (${file.imageId}), reviewed ${formatReviewDate(file.review.date)}`,
      detail: `${file.estimator.name} · confidence ${file.confidence.overall.toFixed(2)} · an estimate, not a measurement`,
    };
  }
  const tag = rig === 'pending' ? null : rig === 'fallback-rig' ? TEXT.unavailable : TEXT.avatar;
  return {tag, text: TEXT.neutral, detail: ''};
}
