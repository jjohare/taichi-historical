# Pose explorer — design

Status: proposed · 24 October 2026 · Requirements: [pose-explorer-spec.md](pose-explorer-spec.md) · Decisions: [ADR-0001](../adr/ADR-0001-explorer-module-split.md) to [ADR-0007](../adr/ADR-0007-sequence-transitions.md). §12 (slice S6) was added by ADR-0007

## 1. Scope and starting point

Today the spatial study panel is one 83-line module, `assets/viewer.js`. `assets/site.js` loads it with `import('./viewer.js')` after the catalogue. It holds these parts:

- a procedural fallback rig;
- the GLB avatar loaded with `GLTFLoader`;
- `OrbitControls` with four camera buttons and a reset;
- two diagnostic sliders (elbow and crouch) and a skeleton toggle;
- a context-loss message;
- render-on-demand driven by `ResizeObserver`, `IntersectionObserver` and the controls' `change` event.

The catalogue (`site.js`) and the rig never talk to each other. That separation is a design rule (DESIGN.md: "independent of the catalogue selection").

This design splits the viewer into small ES modules with no bundler. The first slice behaves exactly as today. The later slices add presets, joint inspection, failure handling and an explicit, labelled path for reviewed pose estimates. The catalogue and the rig only ever meet through one documented DOM event (§7), and only to *offer* an estimate.

## 2. Avatar facts the design relies on

These were measured from `assets/model/archive-avatar.glb` by forward kinematics with `three.core.js`:

| Fact | Value |
|---|---|
| Skin | one skin, 24 joints: `pelvis, left_hip, left_knee, left_ankle, left_foot, right_hip, right_knee, right_ankle, right_foot, spine1, spine2, spine3, left_collar, left_shoulder, left_elbow, left_wrist, left_hand, neck, head, right_collar, right_shoulder, right_elbow, right_wrist, right_hand` |
| Hierarchy | `pelvis → {left_hip → knee → ankle → foot, right_hip → …, spine1 → spine2 → spine3 → {left_collar → shoulder → elbow → wrist → hand, neck → head, right_collar → …}}`. The scene root is `ArchiveAvatar`, with an identity transform. |
| Units and up | metres, +Y up. Pelvis rest at `(0, 0.94, 0)`; head joint at `y = 1.67`. |
| Facing | **+Z**: the foot joints sit at `z = +0.10` in front of the ankles at `z = 0`. |
| Character's left | **+X**: `left_hip` is at `x = +0.14` and `left_hand` at `x = +0.59`. |
| Rest orientations | Not identity. For example, the `left_hip` rest local quaternion is about `(−0.9998, −0.0125, −0.0125, 0.0002)`: limb bones point along their local +Y down the limb. Names alone therefore do not define a retarget. |
| Animations | none. `tools/check-site.mjs` asserts this. |

The frame is right-handed: +X is the character's left, +Y is up and +Z is the character's forward, towards the default camera.

## 3. Module boundaries (`assets/explorer/`)

Every file is a plain ES module, loaded through the existing import map (`"three": "./assets/vendor/three.module.js"`). There are two kinds:

- **Pure modules** must also run under `node --test`, where there is no import map. They import three.js maths only through the relative path `../vendor/three.core.js`. The browser resolves that to the same URL `three.module.js` re-exports from, so there is a single three.js instance. Pure modules never touch `document`, `window` or WebGL.
- **DOM modules** may import `three`, the vendored add-ons and the pure modules.

| Module | Kind | Responsibility | Approx. size |
|---|---|---|---|
| `main.js` | DOM | Composition root. Detects WebGL, builds the scene, loads the avatar, wires controls, owns `state`, installs the test hook. The only module with side effects at import. | ≤ 120 lines |
| `scene.js` | DOM | Renderer, camera, lights, floor, `OrbitControls`. Owns render-on-demand (`requestRender`), resize and visibility observers, and context loss and restore. | ≤ 120 |
| `rig.js` | DOM | Fallback procedural rig and GLB avatar. Captures rest data. Applies joint quaternions. Owns the skeleton helper and the joint marker. | ≤ 140 |
| `controls.js` | DOM | Binds buttons, sliders, the joint select, the file input and the estimate buttons to actions. Reflects `state` into the DOM (`aria-pressed`, `disabled`, readouts). | ≤ 150 |
| `provenance.js` | pure | `provenanceFor(pose, context) → {tag, text, detail}`, `formatReviewDate(iso)`. Holds the exact label strings. | ≤ 60 |
| `presets.js` | pure | Camera preset table and `presetPosition(name)`. | ≤ 40 |
| `retarget.js` | pure | `bendQuaternion`, `retargetJoint`, `applyPose`, `jointAngleDegrees`, `forwardKinematics`, `checkLeftRight`. | ≤ 120 |
| `pose-schema.js` | pure | `validatePose(input, {origin})`, `validateIndex(input)`, `JOINT_NAMES`, error codes. No three.js import. | ≤ 200 |
| `poses.js` | DOM | Fetches `pose-estimates/index.json`, fetches allowlisted files on demand, runs validation, and reads local files through `FileReader`. | ≤ 80 |
| `transition.js` | pure | (S6) Keyframe sequence, route planning, interpolation and frame driver. See §12.2. | ≤ 140 |

`#model-still` is created by `main.js` only on the still path, so normal loads never fetch `avatar-neutral.png` (PE-28). Total budget: 48 KiB (PE-28). Each file stays under 500 lines, and well under in practice.

Dependency direction: `main → {scene, rig, controls, poses} → {retarget, presets, provenance, pose-schema}`. Pure modules import nothing from DOM modules. `controls.js` does not import `scene.js` or `rig.js`. It receives an `actions` object from `main.js` (constructor injection), which makes it testable in a browser against a stub.

`assets/viewer.js` becomes `import './explorer/main.js';` (PE-01). `site.js` and `tools/check-site.mjs` therefore need no change in S1.

## 4. Interfaces

```js
// scene.js
export function createScene({host, statusEl, colour}) → {
  scene, camera, controls, renderer,       // three objects, for rig.js and main.js
  requestRender(),                          // coalesced to one rAF; no-op while hidden or lost
  orbit(radians), zoom(factor),             // today's behaviour exactly (PE-06)
  setCameraPosition(vec3Array),             // instant; controls.update(); requestRender()
  resetCamera(),                            // controls.reset()
  onContextChange(cb)                       // cb('lost' | 'webgl' | 'failed')
}
export function webglAvailable(doc) → boolean  // tries getContext('webgl2') on a detached canvas

// rig.js
export function createFallbackRig(scene, colour) → Rig
export async function loadAvatar(scene, url, colour) → Rig     // throws on fetch or parse failure
// Rig: { kind: 'avatar' | 'fallback-rig', jointNames: string[],
//        rest: Map<name, {local:[x,y,z,w], world:[x,y,z,w], position:[x,y,z]}>,
//        setLocal(name, quatArray), setRootTranslation([x,y,z]), resetToRest(),
//        localOf(name) → [x,y,z,w], worldPositionOf(name) → [x,y,z],
//        setSkeletonVisible(bool), setMarker(name|null) }

// presets.js
export const TARGET = [0, 0.95, 0];
export const PRESETS = {front, side, back, 'three-quarter', top};  // §5.4
export function presetPosition(name) → [x,y,z]

// retarget.js  (imports ../vendor/three.core.js)
export function bendQuaternion(rest, name, degrees) → [x,y,z,w]          // §5.2, parity with today
export function retargetJoint(rest, name, deltaQuat) → [x,y,z,w]          // §5.3
export function applyPose(rest, pose) → {locals: Map, rootTranslation}    // pure; rig applies it
export function jointAngleDegrees(restLocal, currentLocal) → number
export function forwardKinematics(restNodes, locals, rootTranslation) → Map<name, [x,y,z]>
export function checkLeftRight(restNodes, pose) → {ok, errors}            // PE-33

// pose-schema.js  (no imports)
export const JOINT_NAMES            // the 24 bone names, in skin order
export const POSE_JOINTS            // JOINT_NAMES without 'pelvis'
export function validatePose(input, {origin: 'published' | 'local'}) → {ok:true, pose} | {ok:false, errors:[{code, path, message}]}
export function validateIndex(input) → same shape
// input may be a string (parsed here, size-checked first) or an already-parsed value. Never throws.

// provenance.js
export const TEXT = { neutral, estimate(...), local, still, unavailable, lost, failed, slidersLocked, rejected(msg) }
export function provenanceFor(pose, {imageLabel}) → {tag, text, detail}
export function formatReviewDate('2026-10-24') → '24 October 2026'

// poses.js
export async function loadIndex(baseUrl) → {ok, entries: Map<imageId, {file, sha256}>}
export async function fetchEstimate(baseUrl, entry) → validatePose result (origin 'published')
export async function readLocalFile(file) → validatePose result (origin 'local')

// controls.js
export function bindControls(doc, actions, getState) → { sync() }   // sync() reflects state into the DOM
```

`colour(name)` is `getComputedStyle(document.documentElement).getPropertyValue(name).trim()`. It is passed in rather than imported, so every colour is a CSS token (PE-40).

## 5. Rig mathematics

Notation: quaternions are `[x, y, z, w]`, the three.js and glTF order. `L` is a bone's local (parent-relative) quaternion. `W` is its world quaternion. A subscript `r` means rest. Products compose right to left on vectors.

### 5.1 Rest capture

After the GLB loads and `updateMatrixWorld(true)` runs, record `{local: L_r, world: W_r, position}` for every bone. This is what `viewer.js` does today.

### 5.2 `bend()`: today's single-axis diagnostic

```
bend(name, θ):  L = L_r · axisAngle(W_r⁻¹ · X̂, θ)
```

The identity `axisAngle(W⁻¹v, θ) = W⁻¹ · axisAngle(v, θ) · W` means this is the special case `Q = axisAngle(X̂, θ)` of the general rule below. It is a rotation about the avatar's world X axis *as that axis was at rest*, applied in the bone's own frame. Because it composes with whatever the parent is doing, it is **parent-relative**.

### 5.3 The general retarget rule

A pose assigns each joint `j` a delta quaternion `Q_j`, expressed in the avatar's **rest-world axes** (+X left, +Y up, +Z forward) and **relative to its parent's posed frame**. The local quaternion is:

```
L_j = L_r,j · (W_r,j⁻¹ · Q_j · W_r,j)
```

Joints absent from the file get `Q = identity`, that is, rest. The pelvis follows the same rule, because its parent is the identity scene root. Root translation adds the file's `root.translation` to the pelvis rest position.

Derivation, which the offline converter must follow. Let `D_j` be the world-frame rotation that takes joint `j` from its rest orientation to its posed orientation (`G_j = D_j · W_r,j`). Then:

```
Q_j = D_parent(j)⁻¹ · D_j
```

Here `parent(j)` is the nearest ancestor *in the avatar hierarchy*. Substituting into `G_j = G_p · L_j` reproduces the rule above. Two consequences:

1. A source skeleton with identity rest orientations (SMPL-like) gives `Q_j` directly from its parent-relative local rotations, *after* conversion into the avatar frame.
2. A source skeleton with non-identity rest orientations, such as MHR, must go through world-frame deltas `D_j`. Copying its local rotations by name is wrong. The README of the avatar model already warns about this, and PE-32 and PE-33 test it.

The converter computes `D_j` for each mapped joint from the estimator's posed and rest global orientations. It changes basis into the avatar frame with a fixed, recorded matrix `C` (`D_avatar = C · D_source · C⁻¹`), then forms `Q_j`. Avatar joints with no source counterpart (for example `spine2` when the source has fewer spine joints) take an even share of the parent-to-child delta along that chain. The share method is recorded in `jointMap`.

### 5.4 Camera presets

Target `(0, 0.95, 0)`. The distance is the default `d = 3.3392`, with elevation 8.61° (horizontal radius 3.3015). The camera is placed instantly and never animated.

| Preset | Position | Note |
|---|---|---|
| `three-quarter` | `(1.9, 1.45, 2.7)` | today's default and the reset target |
| `front` | `(0, 1.45, 3.3015)` | faces the character (+Z) |
| `side` | `(3.3015, 1.45, 0)` | the character's left flank (+X). Button label "Side (left)" |
| `back` | `(0, 1.45, −3.3015)` | |
| `top` | `(0, 4.2765, 0.2910)` | 5° from vertical towards +Z. The exact zenith is avoided because `lookAt` is degenerate with `up = +Y` |

`controls.update()` after placement keeps the presets inside `minDistance`/`maxDistance`/`maxPolarAngle`. The top preset's polar angle of 5° is well within the limits.

### 5.5 Angle readout

`jointAngleDegrees = 2·acos(min(1, |w|))` of `L_r⁻¹ · L`, in degrees, rounded to an integer for display. It is the size of the rotation from rest, whatever the axis, so it reads the same for diagnostics and estimates.

## 6. State model

`main.js` owns one plain object. Only actions mutate it, and `controls.sync()` re-renders the DOM after each one. The provenance label is **always derived** from `state.pose` and `state.renderer`, never set on its own. That one rule is what stops a reset, an image change or a context loss from leaving a stale "estimated" badge.

```js
state = {
  renderer: 'pending' | 'webgl' | 'lost' | 'failed' | 'still',
  rig: 'pending' | 'avatar' | 'fallback-rig',
  camera: { preset: 'three-quarter' | 'front' | 'side' | 'back' | 'top' | 'custom' },
  checks: { elbow: 0, crouch: 0, skeleton: false },
  selectedJoint: null | jointName,
  displayedImage: null | { imageId, label },    // from the yang:image-shown event (§7)
  availableEstimate: null | imageId,            // displayedImage has an index entry
  pose: { kind: 'neutral' }
      | { kind: 'estimate', origin: 'published' | 'local', imageId, file /* validated */ },
  poseError: null | string,
  renderCount: 0
}
```

| Action | Effect |
|---|---|
| `setPreset(name)` | camera to `presetPosition(name)`; `camera.preset = name` |
| `orbit`, `zoom` (set explicitly), user drag (OrbitControls `start` event; never `change`, which also fires on programmatic `update()`) | `camera.preset = 'custom'` |
| `setElbow(v)` / `setCrouch(v)` | only when `pose.kind === 'neutral'`; diagnostics as today |
| `setSkeleton(b)` | as today |
| `selectJoint(name \| null)` | marker and readout |
| `applyEstimate()` | fetch → validate → `checkLeftRight` → `rig.resetToRest()` → apply. `pose = estimate`; sliders reset to 0 and disabled |
| `loadPoseObject(obj, {origin})` | same path for local files and the test hook. Rejection sets `poseError` and `console.warn`s, and leaves `pose` untouched |
| `clearPose()` | `rig.resetToRest()`; `pose = neutral`; sliders enabled at 0 |
| `reset()` | camera reset, `preset = 'three-quarter'`, `clearPose()`, checks to 0, skeleton off. `selectedJoint` is kept |
| `imageShown({imageId, label})` | if `pose.kind === 'estimate'` and `imageId ≠ pose.imageId`, then `clearPose()`; recompute `availableEstimate` |
| context `lost` / `webgl` / `failed` | `renderer` changes. `failed` swaps in the still image; rig state is kept for `webgl` |

Renderer states: `pending → webgl` on success. `pending → still` if WebGL2 is unavailable or the renderer constructor throws. `webgl → lost` on `webglcontextlost`, with `preventDefault()`. `lost → webgl` on `webglcontextrestored`. `lost → failed` after 5 s without a restore. `failed` and `still` render the same fallback, with different text.

**Test hook (`window.__explorer`).** It is installed only when `new URLSearchParams(location.search).get('explorer-test')` is `1` or `no-webgl`. `no-webgl` also forces the still path, which gives the browser test a fallback route that doesn't depend on init scripts. Its shape:

```js
window.__explorer = Object.freeze({
  get state() { return structuredClone(state) },       // read-only snapshot, plus the derived fields below
  get renderer() { return renderer }, camera, controls, rig,   // for context-loss and pose checks
  actions: { setPreset, selectJoint, loadPoseObject, applyEstimate, clearPose, reset },
  jointAngle: name => number
})
```

The snapshot adds derived fields that are not part of `state`: `bones` (name → `{quaternion, position}`, local quaternion and world position), `cameraPosition`, `label` (the `#model-label` text), `skeletonVisible` (the `SkeletonHelper`'s `visible`; `false` on the fallback rig) and `meshVisibility` (avatar mesh name → `visible`, for every avatar mesh; empty on the fallback rig). `fallbackVisible` (the procedural rig group's `visible`) and `visible` (the IntersectionObserver flag that gates `render()`). S2 adds `readout` (the `#joint-readout` text), `provenance` (the `#model-provenance` text) and `marker` (`{visible, position, depthTest, colour}`: the joint marker's world position, its material's `depthTest` and its colour as `#rrggbb`; `position` is `null` while no joint is selected). `camera.preset` and `selectedJoint` are part of `state` itself. The hook's `actions` also carry `setPreset(name)` and `selectJoint(name | null)`. The live scene is never exposed.

Exposing actions is safe. They go through the same validation as the UI and cannot reach the network beyond the index allowlist.

## 7. Catalogue to explorer contract (S5)

S5 adds one line to `site.js`'s `showImage()`, which dispatches:

```js
document.dispatchEvent(new CustomEvent('yang:image-shown', {detail: {moveId, imageId, label, source}}))
```

`imageId` is the PNG basename (`chen-001`, `yang-002`, `panel-013`). `site.js` selects the first entry before it imports the viewer, so the first event fires before anyone listens. `site.js` therefore also sets `data-image-id` and `data-move-id` on `#pose-image` in `showImage()`. `main.js` reads those attributes once at start-up, then listens for events. The explorer only listens. It never changes the catalogue. Drawings (`panel-*`) never have estimates. Estimates are keyed by **source image**, not by catalogue entry: a reused photograph has one estimate that appears under each occurrence, as `research/dpmesh/inputs.json` already records.

## 8. Pose estimate data

### 8.1 Location

`assets/pose-estimates/` holds `index.json`, one `<imageId>.json` per reviewed photograph, and `SAM-LICENSE.txt` (ADR-0003). It is deliberately *not* `poses/`, which is the 103 catalogue-entry directories. Raw estimator output, meshes, weights and review renders stay outside the repository (see the how-to).

### 8.2 Index (`index.json`)

```json
{ "schema": "yang-form/pose-estimate-index", "schemaVersion": 1,
  "estimates": [ { "imageId": "chen-001", "file": "chen-001.json", "sha256": "<64 hex of the file bytes>" } ] }
```

It ships with `"estimates": []` (PE-35). The page fetches nothing that is not listed. The file name must equal `<imageId>.json` and match `^(yang|chen)-\d{3}\.json$`.

### 8.3 Pose file, schema version 1

```json
{
  "schema": "yang-form/pose-estimate",
  "schemaVersion": 1,
  "imageId": "chen-001",
  "sourceImage": {
    "path": "extracted/historical/chen-001.png",
    "sha256": "3ca6f2ac01fccc002e4f04deeec6fa3f65442c0e6d4db0e3943609b87dab032f",
    "crop": [0, 0, 0, 0],
    "personPrompt": "box",
    "mirrored": false
  },
  "estimator": {
    "name": "SAM 3D Body",
    "repository": "https://github.com/facebookresearch/sam-3d-body",
    "revision": "<40 hex commit>",
    "checkpoint": "facebook/sam-3d-body-dinov3",
    "checkpointSha256": "<64 hex of model.ckpt>",
    "licence": "SAM License",
    "outputFrame": "<string as documented by that revision, e.g. camera frame axes>"
  },
  "rig": {
    "name": "MHR",
    "repository": "https://github.com/facebookresearch/MHR",
    "revision": "<40 hex commit>",
    "modelSha256": "<64 hex of mhr_model.pt>"
  },
  "converter": { "path": "tools/pose-estimation/convert.py", "revision": "<40 hex commit of this repo>" },
  "jointConvention": "yang-form-24/rest-world-delta@1",
  "jointMap": "mhr-to-yang24@1",
  "frame": { "up": "+Y", "forward": "+Z", "left": "+X", "units": "m" },
  "root": { "translation": [0, -0.03, 0], "rotation": [0, 0, 0, 1] },
  "joints": {
    "left_elbow": { "rotation": [-0.2588, 0, 0, 0.9659], "confidence": 0.81 }
  },
  "landmarks": {
    "left_wrist": [0.31, 0.92, 0.18], "right_wrist": [-0.30, 0.95, 0.16],
    "left_ankle": [0.17, 0.10, 0.02], "right_ankle": [-0.16, 0.10, -0.05]
  },
  "confidence": { "overall": 0.72, "method": "mean keypoint visibility × reviewer grade" },
  "review": {
    "status": "accepted",
    "reviewer": "jjohare",
    "date": "2026-10-24",
    "leftRight": "as-photographed",
    "checks": { "projection": true, "leftRight": true, "standingLeg": true, "handsFeet": true, "truncation": true },
    "overlaySha256": "<optional 64 hex of the review overlay kept outside the repo>",
    "notes": "Sleeve hides the left elbow; elbow angle uncertain."
  }
}
```

Field rules (`validatePose`). Unknown keys are rejected at every level (`E_UNKNOWN_KEY`).

| Field | Rule | Code |
|---|---|---|
| raw input | ≤ 65,536 bytes when given as a string or `File`; must parse as JSON | `E_SIZE`, `E_JSON` |
| `schema` | exactly `yang-form/pose-estimate` | `E_SCHEMA_ID` |
| `schemaVersion` | integer `1`. Any other value is rejected; there is no best-effort reading of future versions | `E_VERSION` |
| `imageId` | `^(yang\|chen)-\d{3}$`; equals the basename of `sourceImage.path` | `E_IMAGE_ID` |
| `sourceImage.path` | `extracted/historical/<imageId>.png` | `E_IMAGE_ID` |
| `*sha256`, `*Sha256` | `^[0-9a-f]{64}$` | `E_HASH` |
| `*.revision` | `^[0-9a-f]{40}$` | `E_REVISION` |
| `sourceImage.crop` | four integers `[x, y, w, h]` in source pixels; `x, y ≥ 0`, `w, h > 0` | `E_RANGE` |
| `sourceImage.personPrompt` | `box`, `point` or `none` | `E_TYPE` |
| `estimator.name` | exactly `SAM 3D Body` for v1 | `E_TYPE` |
| `estimator.licence` | exactly `SAM License` for v1 | `E_TYPE` |
| `estimator.checkpoint` | `^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$` (Hugging Face repo id) | `E_TYPE` |
| `estimator.outputFrame` | non-empty string ≤ 200 | `E_TYPE` |
| `rig.name` | exactly `MHR` for v1 | `E_TYPE` |
| `*.repository` | `^https://github\.com/[\w.-]+/[\w.-]+$`; stored only, never fetched | `E_TYPE` |
| `converter.path` | `^tools/[\w./-]+\.py$` | `E_TYPE` |
| `confidence.method`, `review.reviewer` | non-empty string ≤ 200 | `E_TYPE` |
| `sourceImage.mirrored` | boolean. `true` means the converter mirrored the image before estimation, and the joints have already been mirrored back into as-photographed handedness | `E_TYPE` |
| `jointConvention` | exactly `yang-form-24/rest-world-delta@1` (§5.3) | `E_CONVENTION` |
| `jointMap` | `^[a-z0-9-]+@\d+$` | `E_TYPE` |
| `frame` | exactly `{up:"+Y", forward:"+Z", left:"+X", units:"m"}` | `E_FRAME` |
| `root.translation` | 3 finite numbers, each \|v\| ≤ 1 | `E_RANGE` |
| `*.rotation` | 4 finite numbers; \|‖q‖ − 1\| ≤ 1e-3; normalised on accept | `E_QUAT` |
| `joints` keys | non-empty subset of `POSE_JOINTS` (23 names; `pelvis` uses `root`) | `E_JOINT_NAME` |
| `joints.*.confidence`, `confidence.overall` | number in [0, 1] | `E_RANGE` |
| `landmarks` | all four keys required, each 3 finite numbers in avatar frame (root-relative, scaled so source pelvis-to-head equals 0.73 m). They must come from the estimator's own named keypoints, transformed only by `C`, never through `jointMap` | `E_MISSING`, `E_RANGE` |
| `review.status` | `accepted` for `origin:'published'`; `accepted` or `draft` for `origin:'local'` | `E_STATUS` |
| `review.date` | `^\d{4}-\d{2}-\d{2}$` and a real calendar date | `E_DATE` |
| `review.leftRight` | `as-photographed` or `side-naming-differs` (pairs with the catalogue's `direct-with-naming-caveat`) | `E_TYPE` |
| `review.checks.*` | all five booleans present; all `true` for published files | `E_STATUS` |
| any string | ≤ 200 characters (`notes` ≤ 1,000) | `E_RANGE` |
| required keys | everything shown above except `review.overlaySha256`, `review.notes` and `joints.*.confidence` | `E_MISSING` |

After schema validation, `checkLeftRight` (PE-33) runs forward kinematics on the rest skeleton. It compares the summed same-side and crossed distances for each wrist and ankle pair. A difference under 0.05 m is `inconclusive`, which is reported and not an error. Otherwise the same-side sum must be the smaller, or it returns `E_LEFT_RIGHT`. The check catches joint-map and rotation inconsistencies only. A mirrored photograph or a sign error in `C` moves the landmarks too, so those are the reviewer's job. Error messages are plain English and shown through `textContent` only (PE-39).

**Versioning (ADR-0002).** A change that keeps the meaning of every existing field and adds an optional field still needs a new `schemaVersion`, because unknown keys are rejected. Validators accept only the versions they implement. A new joint convention means a new `jointConvention` tag, not a reinterpretation. Old files are migrated by re-running the converter from the stored raw outputs, never by editing rotations by hand.

## 9. Delivery slices

| Slice | Content | Criteria |
|---|---|---|
| S1 | Split `viewer.js` into `main/scene/rig/controls/provenance` with identical behaviour; shim `viewer.js`; `package.json` `{"type":"module"}`; `assets/vendor/MANIFEST.sha256`; `tests/` scaffold; CI runs `node --test tests/` before `check-site` | PE-01–09, 26–29, 37, 39, 40 |
| S2 | Presets, joint select, highlight and readout, provenance line, extended reset | PE-10–17, 38 |
| S3 | Context restore, still fallback, 44 px and 360 px fixes | PE-22–25 |
| S4 | `pose-schema.js`, `retarget.js`, fixtures, empty `index.json`, `SAM-LICENSE.txt`, check integration | PE-30–35 |
| S5 | `site.js` event, `poses.js`, apply/clear/local-file UI | PE-18–21, 36, 41 |
| S6 | `transition.js`, estimate mode, transition state and label, amended PE-08/11/19/36 (§12, ADR-0007). Depends on S5 | PE-42–59 |

S1 must not change pixels. Compare screenshots of the default view, the elbow at 60, the crouch at 40 and the skeleton on, before and after, with no visible difference.

## 10. Test strategy

- **Layout.** `tests/*.test.mjs` run with `node --test tests/` (Node 22, no dependencies). A root `package.json` containing only `{"private": true, "type": "module"}` lets node treat the vendored `.js` as ESM without a warning. It has no scripts and no dependencies, so it is not a build step (ADR-0001). Fixtures go in `tests/fixtures/poses/` (`valid-minimal`, `valid-full`, `valid-crossed-hands`, `invalid-mirrored` with an asymmetric pose, and one `invalid-*` per PE-31 case).
- **Node (pure).** `pose-schema` (PE-30, 31, 34, 35), `retarget` parity and left/right (PE-32, 33) with rest data parsed straight from the GLB JSON chunk (as `check-site.mjs` already does), `provenance` strings and date format (PE-17, 18, 21), `presets` (PE-10 positions), and static scans (PE-08, 28, 29, 38, 39, 40, 27 manifest).
- **Browser (`browser-gpu`).** One scripted session per section of the spec, against `python -m http.server`, using `?explorer-test=1`. Context loss uses `WEBGL_lose_context`. No WebGL uses `?explorer-test=no-webgl`, or an init script stubbing `getContext`. Network and console checks use `list_network_requests` and `list_console_messages`. Layout checks use `resize_page(360, 740)` plus `getBoundingClientRect`.
- **Manual.** Visual parity screenshots (S1), copy review (PE-38) and the review half of every pose file (how-to).
- **CI.** `.github/workflows/pages.yml` gains `node --test tests/` before staging. Browser checks run locally before merge, because Pages CI has no GPU browser.

## 11. Risks

| Risk | Mitigation |
|---|---|
| A double three.js instance if a pure module imports a different specifier | Pure modules import only `../vendor/three.core.js`, which is the URL `three.module.js` itself imports. A node static check forbids other three paths in pure modules |
| A stale or modified estimate shown under the "reviewed" badge | The label is derived from state; image change, reset and context failure clear it; sliders are locked (PE-19, 20) |
| A mirrored or misnamed side | FK check against keypoint landmarks for map errors (PE-33). Photograph mirroring and basis sign errors are caught only by the reviewer's projection and left/right checks |
| A console 404 for a missing index | The empty index always ships (PE-35) |
| The SAM Licence travelling with derived pose data | Licence copy and acknowledgement shipped beside the data (ADR-0003). Weights and code never in the repository |
| The procedural fallback rig cannot take estimates | Estimate controls are hidden when `state.rig === 'fallback-rig'` |
| Interpolated frames read as a recovered movement (S6) | Their own label and wording (`TRANSITION · INTERPOLATED`, "not a photograph"), transient state, and arrival always at a reviewed file (PE-50, PE-59, ADR-0007) |

## 12. Sequence transitions (S6, ADR-0007)

This section adds to §§3–9 and changes none of them except where marked. Requirements: spec section I, PE-42 to PE-59.

### 12.1 Constraints that shape it

- **Only reviewed poses are poses** (ADR-0003, ADR-0004). Each keyframe is a published, validated estimate. Interpolated frames are synthetic, so they get their own label and are never stored.
- **The catalogue and the rig meet at one event** (§7). S6 adds no new event and does not widen `yang:image-shown`. The explorer tells a navigation from an image change by comparing `moveId` with the previous event. It reads the sequence from `catalogue.json`, the same bytes `site.js` loaded, so normally the HTTP cache serves it.
- **Rendering on demand** (PE-08). An rAF loop exists only while a transition runs.
- **Estimates are keyed by source image, not by entry** (§7). An entry has up to 17 images across three sources, and 8 adjacent pairs per photographic source share their first image. The keyframe rule therefore follows what `site.js` actually shows (spec I, "Keyframe image"), and the route collapses repeats.
- **Budget** (PE-28). The explorer modules are 36.2 KiB of 48 KiB before S3–S5. `transition.js` is capped at 140 lines, about 5 KiB.

### 12.2 Module: `assets/explorer/transition.js` (pure)

It imports only `../vendor/three.core.js` (for `Quaternion.slerpQuaternions`) and has no DOM, `window` or timer access: the driver receives its clock and frame scheduler. That keeps it under `node --test` with a fake clock, and keeps §3's rule that pure modules never touch `window`.

```js
export const HOP_MS = 1600, CAP_MS = 3000, MAX_KEYFRAMES = 30;   // ADR-0007 justifies the values; exposed in the snapshot

// Sequence in ascending ordinal; imageId is the keyframe image for `source`, or null (spec I, PE-43).
export function keyframeSequence(catalogue, source) → [{moveId, imageId: string | null}]
export function sequenceIndexOf(sequence, moveId) → number      // −1 if absent

// Keyframes strictly after fromIndex up to and including toIndex, in travel order. Drops null and unreviewed ids
// (estimatesIndex: Set or Map of reviewed image ids). Collapses consecutive repeats, including one equal to
// startImageId. Sub-samples evenly to MAX_KEYFRAMES, always keeping the target (PE-44, PE-48).
// Returns {keyframes: []} when the target itself is unreviewed.
export function planRoute(sequence, fromIndex, toIndex, estimatesIndex, {startImageId} = {})
  → {keyframes: string[], skipped: number}

export function routeTiming(hops) → {total, perHop}             // perHop = min(HOP_MS, CAP_MS/hops); total = min(HOP_MS·hops, CAP_MS)
export function easeInOutCubic(x) → number

// Per-joint shortest-arc slerp of Q over POSE_JOINTS and root.rotation; lerp of root.translation; a missing
// joint counts as identity. a and b are validated pose files or earlier interpolatePose results.
// Returns {joints: {name: {rotation}}, root: {translation, rotation}}, no provenance fields (PE-46).
export function interpolatePose(a, b, t) → InternalPose

// The pose at eased progress p along [start, k1, …, kN]: hop = min(N−1, floor(p·N)), local t = p·N − hop.
export function sampleRoute(poses, p) → {pose: InternalPose, hopIndex}

// The only self-rescheduling rAF in the explorer (PE-08 amended, PE-53).
export function createDriver({requestFrame, cancelFrame, now, onFrame, onArrive}) → {
  start(poses /* [startPose, ...keyframePoses] */, {hopsTotal, skipped}),  // clock starts here, after fetching
  retarget(poses, meta),     // poses[0] must be the current interpolated pose (PE-52)
  current() → {pose, progress, hopIndex} | null,
  finish(),                  // jump to the last pose, call onArrive, no further frames (context loss, reduced motion)
  cancel()                   // stop without onArrive (reset, clear, fallback)
}
// Each tick: p = easeInOutCubic(min(1, (now() − t0) / total)); onFrame(sampleRoute(poses, p), p).
// At p = 1 it calls onFrame with the exact last pose, then onArrive(), and requests no further frame.
```

`interpolatePose` works on the file's delta `Q_j`, not on bone locals. The retarget rule `L = L_r · (W_r⁻¹ · Q · W_r)` is a fixed left product and a fixed conjugation, and both preserve slerp paths, so this gives the same frames as slerping `L`. It also means the module never needs the rig. `rig.js` gains nothing: `main.js` applies each frame with `applyPose` (§4) and `rig.setLocal` / `setRootTranslation`, as it does for an estimate.

The easing is global, across the route, not per hop. Per-hop easing would stop the figure at every intermediate keyframe and look like stuttering when hops are 100–150 ms. With global easing the figure moves continuously, passes through each reviewed keyframe exactly at `p = k/N`, and starts and ends at rest.

### 12.3 State model changes (amends §6)

```js
state += {
  estimateMode: 'off' | 'follow',
  // transition also carries hopMs, capMs and maxKeyframes, copied from transition.js constants (PE-58)                 // never persisted; 'off' on every load (PE-42)
  transition: { active: false, from: null, to: null, progress: 0, hopsTotal: 0, hopIndex: 0, skipped: 0 },
}
state.pose |= { kind: 'interpolated', fromImageId, toImageId }   // only while transition.active (PE-59)
```

`displayedImage` gains `moveId` and `source`, which are already in the §7 event detail. `main.js` also keeps two private fields, never exposed in the snapshot: `sequenceBySource` (memoised `keyframeSequence` results, filled from `catalogue.json` on first entry to `follow`) and `estimateCache` (a Map from image id to validated pose file, bounded to the files the index lists).

| Action | Effect |
|---|---|
| `applyEstimate()` (S5) | as §6, and also `estimateMode = 'follow'`. On first entry, fetch `catalogue.json` once |
| `clearPose()`, `reset()` | as §6, and also `driver.cancel()`, `transition` inactive, `estimateMode = 'off'` |
| `imageShown(detail)`, navigation (`moveId` changed) | if `estimateMode === 'follow'` and `pose.kind ∈ {estimate (published), interpolated}`: run the route steps below. Otherwise §6 behaviour (PE-19) |
| `imageShown(detail)`, image change (same `moveId`) | `driver.cancel()`. In `follow` with a reviewed estimate for the new image, apply it at once. Otherwise `clearPose()` but leave `estimateMode` alone (PE-54) |
| context `lost` | `driver.finish()`: the target is applied without rendering (PE-56). If the keyframes are still loading, the driver has not started: the target is applied without frames when the fetch settles |
| context `failed`, avatar fallback | `driver.cancel()`, `clearPose()`, `estimateMode = 'off'` |

Route steps on a navigation, all in the event's task until the fetch:

1. Look up `toIndex`. For `fromIndex`, use the sequence index of the previous `displayedImage` when idle. Mid-transition (PE-52), use the endpoint of the current hop on the far side from the target, so the new route's first keyframe is the near one.
2. `planRoute(…)`. Empty, which means the target is unreviewed: `clearPose()`, PE-19. Done.
3. Set `pose = {kind:'interpolated', …}`, `transition = {active: true, progress: 0, hopsTotal, …}`, then `ui.sync()`. The transition label now shows (PE-50) and the sliders are disabled (PE-51). The start pose is the rig's current pose: the applied estimate, or `driver.current().pose` when retargeting.
4. Fetch the keyframes not already in `estimateCache`, in parallel, through `poses.fetchEstimate` (index entries only). Bump a generation counter first. A completion whose generation is stale is discarded.
5. Drop failed or invalid intermediates, with one `console.warn` each. If the target failed: `clearPose()` and the PE-41 status. If the route is now empty but the target is fine, apply the target at once.
6. Reduced motion (checked now): `driver.start(...)` and then `finish()` at once. Otherwise `driver.start(poses, meta)`.
7. `onFrame`: apply the pose to the rig, update `transition.progress` and `hopIndex`, then `requestRender()`. The DOM is **not** synced per frame: only the label and slider state are set at step 3, and `ui.sync()` runs again on arrival. This keeps `aria-live` quiet (PE-51).
8. `onArrive`: `pose = {kind:'estimate', origin:'published', imageId: to, file}` (the normal S5 applied estimate), `transition` inactive, `ui.sync()`. Nothing else renders after this (PE-53).

**How S6 and S5 share the "applied estimate" state.** The state reached on arrival is the same as clicking Apply on that photograph. The same `file` object, label, slider lock and clearing rules apply, and a later reset or image change treats it exactly as an S5 estimate. `interpolated` is a transient third pose kind. Only the driver enters it, and only arrival or cancellation leaves it. It is not in the URL, storage, the hook's `actions` or any validator input. `provenanceFor(pose, {rig, transition})` gains one branch that returns the PE-50 strings. The label stays derived from state (ADR-0004).

### 12.4 Dependencies and budget (amends §3)

| Module | Kind | Responsibility | Approx. size |
|---|---|---|---|
| `transition.js` | pure | Keyframe sequence, route planning, timing, interpolation, frame driver | ≤ 140 |

Dependency direction: `main → transition → three.core`. `controls.js` does not import `transition.js`; it reads `state.transition` through `getState()`. Test-hook additions (§6): `transition` and `estimateMode` in the snapshot (PE-58). No new actions.

### 12.5 Failure modes

| What breaks | First symptom | Detection |
|---|---|---|
| A slow or failed fetch on a far jump | The transition label holds on the old pose until the files arrive | `transition.active && progress === 0` for more than 1 s (before the clock starts, so it is not part of the 1.6–3 s motion); one `console.warn` per dropped intermediate (PE-55) |
| A corrupt target file | Neutral rig and the PE-41 status line, never a half-applied pose | PE-55 browser check; CI already rejects unindexed or invalid files (PE-34) |
| A background tab or throttled rAF | Arrives late or in one step | The driver clamps `elapsed` and completes on the next tick, so the end state is always exact |
| Rapid repeated navigation (holding Enter on `#next`) | Constant retargeting; the figure keeps easing in | The generation counter discards stale fetches; each retarget starts from the current pose, so nothing jumps |
| Context loss mid-hop | No frames; the target is applied silently | PE-56 |
| The keyframe rule drifting from `site.js`'s `showSources` and `showImage` | The keyframe differs from the displayed photograph, so the arrival estimate mismatches | The target always comes from the event's `imageId`, not the rule, so arrival is right. PE-43's browser half catches drift for intermediates |
| Joint-space slerp passing limbs through the body or sliding feet | Implausible in-between frames on large posture changes (turns, steps) | Accepted and labelled (ADR-0007). Reviewers look at long hops by hand; there is no automatic check |
