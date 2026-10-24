# ADR-0007: Labelled transitions between reviewed poses along the sequence

Status: proposed · 24 October 2026 · Amends ADR-0004 (the "never applied on navigation" rule) · Spec: PE-42–PE-59; amends PE-08, PE-11, PE-19, PE-36 · Design §12

## Context

The operator asked for "a smooth transition between poses such that moving between adjacent poses gives a plausible transition, and selecting a pose further out quickly cycles through all intermediate pose points to the new target".

SAM 3D Body estimates now exist offline for all 240 photographs. They are waiting for human review. Under ADR-0003 and ADR-0004 only reviewed estimates, published as `assets/pose-estimates/<imageId>.json`, may appear on the avatar. They are keyed by source image, not by catalogue entry. An entry has up to 17 images across the drawings and the Yang and Chen photographs. The default source is the drawings, which never have estimates. Neighbouring entries often reuse one photograph.

**Interpolated frames are synthetic.** Nobody photographed them and nobody reviewed them. A per-joint slerp is the shortest rotation between two postures. It is not the movement the form prescribes, which the catalogue's own `transition` notes describe in words: turns, steps and weight shifts that joint-space interpolation does not reproduce. Limbs may cut through the body and feet may slide. Shown as poses, these frames would be exactly the "invented historical claim" DESIGN.md forbids.

They are still acceptable here, under four conditions:

1. **They connect reviewed endpoints only.** Every keyframe is a published, validated, reviewed estimate. Unreviewed entries are skipped, never filled in.
2. **They are labelled for what they are,** for every frame they are on screen: `TRANSITION · INTERPOLATED` and "Interpolating between reviewed estimates — not a photograph". The label is derived from state, as ADR-0004 requires.
3. **They are transient.** They exist only while motion lasts, at most 1.2 s. They always end on a reviewed file shown under its normal label. They are never stored, linked, exported or validated as poses.
4. **They serve orientation, not instruction.** They show the spatial relationship between two reviewed postures, the way a cross-fade between photographs would. They do not claim to show how the form moves between them.

## Decision

- **Opt-in estimate mode.** Activating "Apply estimated pose" (PE-36) enters estimate mode `'follow'`. Only then does navigation carry estimates forward. Clear, reset, context failure and the fallback rig leave the mode. It starts `'off'` on every load and is never persisted. This amends ADR-0004's rule that estimates "are never applied automatically on navigation": they still never are until the user has opted in on this page load.
- **Sequence and keyframes.** Adjacency is ascending catalogue `ordinal`. An entry's keyframe is the photograph `site.js` would show there with the route source selected: the first image of that source. A keyframe counts only if it has a reviewed estimate. Consecutive repeats collapse. The explorer reads `catalogue.json` itself, once, when it first enters estimate mode. The `yang:image-shown` event (design §7) is not widened.
- **Triggers.** A transition runs only on a user navigation (`#previous`, `#next`, a list link or a `#move=` hash), in `follow` mode, from a published applied estimate, to an entry whose displayed photograph has a reviewed estimate. It never runs on load or on its own, and never from or to a local file. An image change within one entry snaps.
- **Motion.** Per-joint shortest-arc slerp of the file's delta quaternions, including `root.rotation`, and a lerp of `root.translation`. The total duration is `min(350·N, 1200)` ms for `N` hops, with one ease-in-out-cubic across the whole route, so the figure passes through each reviewed keyframe without stopping. Routes longer than 24 keyframes are sub-sampled evenly, always keeping the target, and the detail line says how many poses were skipped. Reduced motion snaps to the target.
- **Interruption.** A new navigation retargets from the current interpolated pose. Reset, clear and context failure cancel. A context loss completes to the target without rendering.
- **Rendering.** A new pure module, `assets/explorer/transition.js`, owns the only rAF loop. It has an injected clock and scheduler, and runs only while a transition is active.
- **Arrival** gives exactly the S5 applied-estimate state for the target photograph.

## Consequences

- The operator's request is met for every reviewed photograph. Until reviews land, the index is empty and S6 is invisible (PE-35).
- **Amended criteria:**
  - PE-08: the static ban on rAF loops gains one exception, the S6 driver.
  - PE-11: the only motion is a user-initiated, capped and reduced-motion-aware pose transition. The camera still never animates.
  - PE-19: in `follow` mode navigation replaces the estimate instead of returning to rest.
  - PE-36: activation also enters `follow` mode.
  - ADR-0004 keeps every other rule.
- **More requests.** One `catalogue.json` fetch, usually from cache, and up to 24 pose files of at most 64 KiB each per navigation, all after opt-in. PE-28's on-load request set is unchanged.
- **Budget pressure.** `transition.js` adds about 5 KiB. The explorer is already at 36.2 KiB of PE-28's 48 KiB before S3–S5. If S3–S5 come in near their line caps, the budget needs a superseding decision, not a silent rise.
- **Accepted inaccuracy.** In-between frames can look anatomically wrong on large posture changes. The label carries that; nothing corrects it. Foot locking or inverse kinematics would make the frames *look* more authoritative without making them any more historical, so they are out of scope.
- **Ruled out:** precomputed transition clips. They would have to be reviewed too, would multiply the pose data by the number of edges, and would still be synthetic.
- **Rejected alternative:** showing every intermediate photograph's pose as a timed slideshow with no interpolation. It needs no synthetic frames, but it gives no "plausible transition" for adjacent entries. That was the operator's first requirement.
- **Coupling.** The keyframe rule repeats `site.js`'s image choice. The target always comes from the event's actual `imageId`, so arrival is never wrong. A drift would only change intermediate keyframes, and PE-43's browser half checks for it.
