# ADR-0008: Secondary cloth lag on rigid hinge pieces, driven only by S6 transitions

Status: proposed · 24 October 2026 · Builds on ADR-0007 · Spec: PE-60–PE-71; amends PE-08, PE-11, PE-28 and PE-53, and extends PE-59 · Design §13

## Context

The avatar's training clothes are loose, as in the 1931 and 1933 photographs, but the mesh is skinned rigidly to 24 joints. During an S6 transition the sleeves and jacket hem therefore move as if starched onto the body. The avatar rebuild adds rigid loose-cloth pieces: sleeve cuffs, four jacket hem flaps and, optionally, trouser cuffs. Each is parented to a plain glTF node `lag:<part>` under a joint, with its origin on the hinge line and its local +X along the hinge. The question is what moves them.

**Why not a cloth simulation library.**

- **Collision against a deforming body.** Believable cloth has to collide with the skinned torso and legs, which change shape every frame. That needs body proxies kept in sync with the skin, plus collision and constraint solving, for a garment the photographs show only in silhouette. Without collision, cloth sinks into the body on the first crouch, which looks worse than starch.
- **A continuous loop.** Simulated cloth never quite stops. It needs a fixed-step solver running every frame, and it sags under gravity even at rest. That breaks render-on-demand (PE-08) and C3 (no motion on its own). The page would always be animating.
- **Nondeterminism.** Iterative solvers with frame-rate-dependent substeps give different cloth for the same navigation on different machines. They cannot be tested against exact values under `node --test`, and they cannot be held to a "the same input gives the same frames" contract like S6's.
- **WebGPU-only or heavyweight options.** The maintained browser cloth paths are WebGPU compute (three's TSL and compute examples) or WASM physics engines (Ammo, Rapier and others). WebGPU breaks C9 and ADR-0005's WebGL2 baseline. A WASM engine is hundreds of KiB to vendor and pin (ADR-0006), against an explorer budget measured in single KiB, and adds a runtime dependency C6 is meant to keep out.

The budget is already tight. `wc -c assets/explorer/*.js` totals **56,060 B** against PE-28's 57,344 B (56 KiB), which leaves 1,284 B.

## Decision

- **Rigid hinge pieces, one degree of freedom each.** A lag node rotates only about its local +X. Its angle `θ` is clamped to `[−max_degrees, +inward_degrees]`, read from the node's glTF `extras`. Outward is `θ < 0` under the convention local −Y towards the free edge and local +Z away from the body (PE-60, PE-63).
- **A closed-form critically damped spring per piece.** Over each frame step, `θ` and `v` take the exact analytic solution towards an equilibrium `c` held constant across the step (PE-62). There is no iteration, no substepping and no frame-rate dependence: one 32 ms step equals two 16 ms steps. With `OMEGA = 20` rad/s, a 10° deflection reaches rest in about 370 ms and a 45° one in about 450 ms.
- **Drive from motion the rig already has.** `c = −K_SPIN·ω_h`, where `ω_h` is the parent joint's angular velocity about the hinge, measured from consecutive driver frames. Hem flaps (`drop: true`) add `K_DROP·v_y` from the pelvis's vertical velocity, so a crouch flares the hem and rising tucks it in (PE-63).
- **Runs only inside S6.** The lag steps inside the S6 driver's ticks. After arrival it continues for a settle window, which ends when every piece is at rest (`|θ| < 0.2°` and `|v| < 1°/s`) or after a 600 ms hard cap, and then snaps to exactly 0. There is no second loop, and no lag on load, image change, reset or the diagnostic sliders. Reduced motion turns it off (PE-65 to PE-67).
- **Discovery from the GLB, not a sidecar file.** GLTFLoader strips `:` from object names, so lag nodes are found by the glTF name it keeps in `userData.name`. Their parameters come from `extras`. `build-report.json` mirrors the same values for a node check, and the page never fetches it (PE-60, PE-71). An avatar with no valid lag node turns S7 off silently (PE-61).
- **Cloth is not pose.** Lag angles never enter a pose, a file, the retarget, the URL, storage or the hook's actions. Bones are never touched by `lag.js` (PE-69).
- **Sliders stay lag-free.** They are diagnostics. A joint reading must not depend on the slider's history, lag on input would need a frame loop on every drag, and PE-51 already keeps sliders and transitions apart.
- **Budget raised to 60 KiB (61,440 B).** `lag.js` gets ≤ 2,560 B, and the wiring in `main.js`, `rig.js` and `transition.js` gets ≤ 1,280 B (PE-71).

## Consequences

- **A stylised look, on purpose.** Hinged plates swinging on damped springs read as "loose cloth" at a glance, but they do not fold, drape or collide. That fits an avatar the model notes already call stylised and illustrative, and it claims nothing about how 1930s garments moved. Nobody will mistake it for simulation.
- **Amended criteria:**
  - PE-08: the S6 driver's loop may continue through the settle window, while `lag.settling` is true, and for no more than 600 ms after arrival.
  - PE-11: secondary lag is the one motion besides a transition, and only immediately after one.
  - PE-28: the budget is now 60 KiB, and no request is added. *Amended 24 October 2026:* 64 KiB (65,536 B), because slice S3 landed after this forecast and used the headroom; see ADR-0001's second amendment.
  - PE-53: `renderCount` may rise once per frame for at most 600 ms after arrival, then stops; the original wording holds when there are no lag nodes.
  - PE-59 is extended: lag angles are transient and exactly 0 once settled.
- **Motion under a reviewed label.** For up to 600 ms after arrival the `ESTIMATED POSE` label is on screen while sleeves and hem still swing. PE-20 forbids showing a reviewed estimate *modified*. That still holds, because the estimate is the bones and they are bit-for-bit the target file throughout. Garment pieces are not pose data (PE-69). The ADR-0004 label rule is unaffected.
- **Determinism and testability.** `lag.js` is pure, takes `dt` from the driver's injected clock, and is tested on a fake clock to bitwise equality (PE-64).
- **Contract with the avatar build.** The rebuild must emit the following, and avatar-upgrade must confirm them:
  - `extras` (`hinge_axis`, `max_degrees`, optional `inward_degrees` and `drop`) on each `lag:*` node;
  - the −Y/+Z axis convention;
  - piece mesh names that avoid the skeleton-view rule `/palm|finger|thumb|shoe|Head/`;
  - unskinned piece meshes outside `skins[0].joints`.
  The 24-joint skin contract is unchanged.
- **Budget.** This is the second raise in a day, after 48 → 56 KiB under ADR-0007. It is taken here as an explicit superseding decision, not a silent one. After S7 the explorer forecast is at most 59,900 B (about 58.5 KiB) of 61,440 B, which leaves about 1.5 KiB. A further feature needs either trimming or another ADR.
- **Ruled out:** cloth simulation in any form; skinning the pieces to extra bones, which would change the 24-joint skin contract, the joint select and the pose schema; and an always-on idle sway, which C3 forbids.
- **Rejected alternative:** baking the lag into each S6 frame by sampling a fixed offset curve per piece, keyed to transition progress. It needs no state and no settle window. But it cannot respond to how fast a particular joint actually turns, so a slow adjacent hop and a 20-hop sweep would flap identically. It also cannot continue smoothly through an interrupted route (PE-52), because the curve restarts with each new route.
