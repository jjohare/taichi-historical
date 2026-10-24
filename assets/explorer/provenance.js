// Pure: every user-facing label and message string for the spatial study, and the rule that derives the
// model label from state. The label is always derived, never set on its own (design §6).
export const TEXT = {
  neutral: 'Illustrative avatar — not this movement',
  avatar: 'ILLUSTRATIVE AVATAR',
  unavailable: 'JOINT RIG · AVATAR UNAVAILABLE',
  lost: 'The 3D view was interrupted. Trying to restore it…',
  failed: 'The 3D view could not be restored. Reload the page to try again; the image archive is unaffected.',
  none: '3D view unavailable in this browser. This still image shows the neutral illustrative avatar, not the selected position.',
  still: 'ILLUSTRATIVE AVATAR · STILL IMAGE',
  stillAlt: 'The neutral illustrative avatar, shown as a still image',
  independent: 'This illustrative avatar is independent of the selected position.',
  estimateNote: 'This avatar shows a reviewed estimate for the displayed photograph, not a measurement.',
  otherNote: 'This avatar is not a measurement.',
  aria: 'Orbitable neutral human rig. Camera controls are available below.',
  ariaEstimate: label => `Orbitable avatar showing an estimated pose for ${label}`,
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
export function provenanceFor(pose, {rig, imageLabel, transition, renderer} = {}) {
  if (renderer === 'none' || renderer === 'failed') return {tag: TEXT.still, text: TEXT.neutral, detail: '', note: TEXT.independent, aria: TEXT.aria};
  if (pose?.kind === 'interpolated') {
    const {hopsTotal, skipped} = transition ?? {};
    return {tag: TEXT.interpolated, text: TEXT.interpolatedText, detail: hopsTotal ? `Via ${hopsTotal} reviewed estimates in sequence order${skipped ? ` · ${skipped} more skipped to keep the transition short` : ''}` : '', note: TEXT.otherNote, aria: TEXT.ariaEstimate(imageLabel ?? 'the displayed image')};
  }
  if (pose?.kind === 'estimate' && pose.origin === 'local') return {tag: TEXT.local, text: TEXT.localText, detail: '', note: TEXT.otherNote, aria: TEXT.ariaEstimate(imageLabel ?? 'the displayed image')};
  if (pose?.kind === 'estimate') {
    const {file} = pose;
    return {
      tag: TEXT.estimated,
      text: `Estimated pose — from ${imageLabel ?? file.imageId} (${file.imageId}), reviewed ${formatReviewDate(file.review.date)}`,
      detail: `${file.estimator.name} · confidence ${file.confidence.overall.toFixed(2)} · an estimate, not a measurement`,
      note: TEXT.estimateNote, aria: TEXT.ariaEstimate(imageLabel ?? file.imageId),
    };
  }
  const tag = rig === 'pending' ? null : rig === 'fallback-rig' ? TEXT.unavailable : TEXT.avatar;
  return {tag, text: TEXT.neutral, detail: '', note: TEXT.independent, aria: TEXT.aria};
}
