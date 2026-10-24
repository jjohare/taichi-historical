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

## Decision

- **Opt-in estimate mode.** Activating "Apply estimated pose" (PE-36) enters estimate mode `'follow'`. Only then does navigation carry estimates forward. Clear, reset, context failure and the fallback rig leave the mode. It starts `'off'` on every load and is never persisted. This amends ADR-0004's rule that estimates "are never applied automatically on navigation": they still never are until the user has opted in on this page load.
- **Sequence and keyframes.** Adjacency is ascending catalogue `ordinal`. An entry's keyframe is the photograph `site.js` would show there with the route source selected: the first image of that source. A keyframe counts only if it has a reviewed estimate. Consecutive repeats collapse. The explorer reads `catalogue.json` itself, once, when it first enters estimate mode. The `yang:image-shown` event (design §7) is not widened.
- **Triggers.** A transition runs only on a user navigation (`#previous`, `#next`, a list link or a `#move=` hash), in `follow` mode, from a published applied estimate, to an entry whose displayed photograph has a reviewed estimate. It never runs on load or on its own, and never from or to a local file. An image change within one entry snaps.
- **Motion.** Per-joint shortest-arc slerp of the file's delta quaternions, including `root.rotation`, and a lerp of `root.translation`. Each hop takes `min(HOP_MS, CAP_MS / N)` for `N` hops, with `HOP_MS = 1600` and `CAP_MS = 3000`, so the total is `min(1600·N, 3000)` ms (see *Timing* below). One ease-in-out-cubic runs across the whole route, so the figure passes through each reviewed keyframe without stopping. Routes longer than `MAX_KEYFRAMES = 30` are sub-sampled evenly, always keeping the target, and the detail line says how many poses were skipped. Reduced motion snaps to the target.
- **Timing.** The operator asked for an adjacent move to be slow and deliberate, at Tai Chi pace, while far jumps still cycle quickly through the intermediate poses.
  - **Why not the form's real tempo.** The traditional long form is commonly performed in roughly 20–25 minutes, about 12–15 s per named entry. That figure is an estimate from common practice and is not sourced in this repository. Real tempo cannot be matched: a whole-form jump would take minutes, and an interpolation timed like a recording would claim a fidelity it does not have. The shortest-arc path is not the form's movement (*Context*).
  - **Why 1.6 s.** It is long enough for a single, continuous ease-in and ease-out with no visible snap. A typical 60° change at one joint peaks at about 56°/s, which is slow, even motion. It is short enough that stepping with *Next* stays responsive, and a press mid-hop retargets rather than queueing.
  - **No breath timing.** The number is deliberately not tied to breathing, because the site declines to prescribe breath for any movement (catalogue `breathing` notes).
  - **The cap.** A 2-hop move stays unhurried at 1.5 s per hop. The 3 s cap makes long jumps stream: 20 hops at 150 ms each, never more than 3 s in total.
  - **The thinning limit.** At 30 keyframes the mean hop reaches 100 ms, and with global easing the fastest hop is about 67 ms, roughly 4 frames at 60 Hz. Any shorter and individual poses stop being visible, so longer routes are thinned.
  - **Testable.** All three numbers are named constants exposed in the test snapshot (`transition.hopMs`, `capMs`, `maxKeyframes`), so tests and later tuning read one source.
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
- **More requests.** One `catalogue.json` fetch, usually from cache, and up to 30 pose files of at most 64 KiB each per navigation, all after opt-in. PE-28's on-load request set is unchanged.
- **Budget pressure.** `transition.js` adds about 5 KiB. The explorer is already at 36.2 KiB of PE-28's 48 KiB before S3–S5. If S3–S5 come in near their line caps, the budget needs a superseding decision, not a silent rise.
- **Accepted inaccuracy.** In-between frames can look anatomically wrong on large posture changes. The label carries that; nothing corrects it. Foot locking or inverse kinematics would make the frames *look* more authoritative without making them any more historical, so they are out of scope.
- **Ruled out:** precomputed transition clips. They would have to be reviewed too, would multiply the pose data by the number of edges, and would still be synthetic.
- **Rejected alternative:** showing every intermediate photograph's pose as a timed slideshow with no interpolation. It needs no synthetic frames, but it gives no "plausible transition" for adjacent entries. That was the operator's first requirement.
- **Coupling.** The keyframe rule repeats `site.js`'s image choice. The target always comes from the event's actual `imageId`, so arrival is never wrong. A drift would only change intermediate keyframes, and PE-43's browser half checks for it.
