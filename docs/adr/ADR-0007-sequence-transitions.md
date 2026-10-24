# ADR-0007: Labelled transitions between reviewed poses along the sequence

Status: proposed · 24 October 2026 · Amends ADR-0004 (the "never applied on navigation" rule) · Spec: PE-42–PE-59; amends PE-08, PE-11, PE-19, PE-36 · Design §12

## Context

The operator asked for "a smooth transition between poses such that moving between adjacent poses gives a plausible transition, and selecting a pose further out quickly cycles through all intermediate pose points to the new target".

SAM 3D Body estimates now exist offline for all 240 photographs. They are waiting for human review. Under ADR-0003 and ADR-0004 only reviewed estimates, published as `assets/pose-estimates/<imageId>.json`, may appear on the avatar. They are keyed by source image, not by catalogue entry. An entry has up to 17 images across the drawings and the Yang and Chen photographs. The default source is the drawings, which never have estimates. Neighbouring entries often reuse one photograph.

**Interpolated frames are synthetic.** Nobody photographed them and nobody reviewed them. A per-joint slerp is the shortest rotation between two postures. It is not the movement the form prescribes, which the catalogue's own `transition` notes describe in words: turns, steps and weight shifts that joint-space interpolation does not reproduce. Limbs may cut through the body and feet may slide. Shown as poses, these frames would be exactly the "invented historical claim" DESIGN.md forbids.

They are still acceptable here, under four conditions:

1. **They connect reviewed endpoints only.** Every keyframe is a published, validated, reviewed estimate. Unreviewed entries are skipped, never filled in.
2. **They are labelled for what they are,** for every frame they are on screen: `TRANSITION · INTERPOLATED` and "Interpolating between reviewed estimates — not a photograph". The label is derived from state, as ADR-0004 requires.
3. **They are transient.** They exist only while motion lasts, at most 3 s. They always end on a reviewed file shown under its normal label. They are never stored, linked, exported or validated as poses.
4. **They serve orientation, not instruction.** They show the spatial relationship between two reviewed postures, the way a cross-fade between photographs would. They do not claim to show how the form moves between them.

**Tempo.** The Yang long form takes about 20 minutes over its 103 named positions. That is roughly 12 s per position in practice, and often slower. The operator asked for an adjacent move at that slow, deliberate pace, while a far jump should still cycle quickly through the intermediate poses. Matching the real tempo is impossible: a whole-form jump would last minutes, and a synthetic path timed like a recording would claim a fidelity it lacks. 1.6 s per adjacent hop is therefore already a brisk abstraction, about an eighth of the real pace. It was chosen so the eye reads a movement rather than a morph. One ease-in and ease-out over 1.6 s has no visible snap: a typical 60° joint change peaks at about 56°/s. Shorter durations, such as 350 ms, read as a cross-fade between two shapes. The number is deliberately not tied to breathing, because the site declines to prescribe breath for any movement (the catalogue's `breathing` notes).

## Decision

- **Opt-in estimate mode.** Activating "Apply estimated pose" (PE-36) enters estimate mode `'follow'`. Only then does navigation carry estimates forward. Clear, reset, context failure and the fallback rig leave the mode. It starts `'off'` on every load and is never persisted. This amends ADR-0004's rule that estimates "are never applied automatically on navigation": they still never are until the user has opted in on this page load.
- **Sequence and keyframes.** Adjacency is ascending catalogue `ordinal`. An entry's keyframe is the photograph `site.js` would show there with the route source selected: the first image of that source. A keyframe counts only if it has a reviewed estimate. Consecutive repeats collapse. The explorer reads `catalogue.json` itself, once, when it first enters estimate mode. The `yang:image-shown` event (design §7) is not widened.
- **Triggers.** A transition runs only on a user navigation (`#previous`, `#next`, a list link or a `#move=` hash), in `follow` mode, from a published applied estimate, to an entry whose displayed photograph has a reviewed estimate. It never runs on load or on its own, and never from or to a local file. An image change within one entry snaps.
- **Motion.** Per-joint shortest-arc slerp of the file's delta quaternions, including `root.rotation`, and a lerp of `root.translation`. A route of `N` hops lasts `T = min(HOP_MS·N, CAP_MS)`, with `HOP_MS = 1600` and `CAP_MS = 3000` as named exports of `transition.js`, also exposed in the test snapshot as `transition.hopMs` and `transition.capMs`. An adjacent move takes 1.6 s, 2 hops take 3.0 s, and 20 hops stream at 150 ms per keyframe. One ease-in-out-cubic runs across the whole route, so the figure passes through each reviewed keyframe without stopping. Routes longer than `MAX_KEYFRAMES = 24` are sub-sampled evenly, always keeping the target, and the detail line says how many poses were skipped. Reduced motion snaps to the target.
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
- **Waiting.** With a 3 s cap, someone moving across the whole form waits up to 3 s per jump, and 1.6 s for each *Next*. That is acceptable only because every transition can be interrupted (PE-52): a new navigation retargets at once from the current pose with a fresh duration, so waits never stack and the user is never locked out. The catalogue text and photograph update immediately; only the avatar takes the time. Reduced motion removes the wait entirely.
- **The 24-keyframe thinning rule still makes sense.** At the 3 s cap its mean hop is 125 ms, and the fastest eased hop is about 83 ms, 5 frames at 60 Hz. Each reviewed keyframe stays visible for several frames, and a whole-form jump still shows 24 distinct reviewed poses. A higher limit would show more poses for a shorter time each, and under about 4 frames they blur into a morph.
- **Budget pressure.** `transition.js` adds about 5 KiB. The explorer is already at 36.2 KiB of PE-28's 48 KiB before S3–S5. If S3–S5 come in near their line caps, the budget needs a superseding decision, not a silent rise.
- **Accepted inaccuracy.** In-between frames can look anatomically wrong on large posture changes. The label carries that; nothing corrects it. Foot locking or inverse kinematics would make the frames *look* more authoritative without making them any more historical, so they are out of scope.
- **Ruled out:** precomputed transition clips. They would have to be reviewed too, would multiply the pose data by the number of edges, and would still be synthetic.
- **Rejected alternative:** showing every intermediate photograph's pose as a timed slideshow with no interpolation. It needs no synthetic frames, but it gives no "plausible transition" for adjacent entries. That was the operator's first requirement.
- **Coupling.** The keyframe rule repeats `site.js`'s image choice. The target always comes from the event's actual `imageId`, so arrival is never wrong. A drift would only change intermediate keyframes, and PE-43's browser half checks for it.
