# Pose explorer — requirements and acceptance criteria

Status: proposed · 24 October 2026 · Companion to [pose-explorer-design.md](pose-explorer-design.md) and [ADR-0001 to ADR-0006](../adr/).

This specification covers the spatial study panel ("Spatial study") on the explorer page. It replaces the single file `assets/viewer.js` with ES modules under `assets/explorer/`, then adds camera presets, joint inspection, provenance labelling, failure handling and reviewed pose estimates.

## Conventions

- **ID**: `PE-nn`. IDs are stable. Withdrawn criteria keep their number and are marked withdrawn.
- **Slice**: the delivery slice the criterion belongs to (see design §9). **S1** is the behaviour-preserving refactor. A criterion tagged S1 describes today's behaviour and must pass before and after the refactor. Criteria tagged S2–S5 are new behaviour and are expected to fail until their slice lands.
- **Method**:
  - **node**: `node --test tests/` against pure modules, fixtures and repository files, with no browser and no network.
  - **browser**: the `browser-gpu` MCP (`navigate_page`, `evaluate_script`, `list_console_messages`, `list_network_requests`, `resize_page`, `take_screenshot`) against `python -m http.server` serving the repository root.
  - **manual**: a person checks it and records the result in the pull request.
- **Test hook**: browser checks read `window.__explorer`, which exists only when the page URL carries `?explorer-test=1`. See design §6. Production URLs never expose it (PE-37).
- **Base URL**: in the steps below, `BASE` means `http://localhost:8080/?explorer-test=1`.
- **Angles** are in degrees and **distances** in metres. Quaternion comparisons use `|dot(a,b)| ≥ 1 − 1e-9`, which treats `q` and `−q` as equal. Position comparisons use a tolerance of 1e-4 unless stated.

## Hard constraints (from DESIGN.md, README.md and the model and DPMesh notes)

C1 colours only via CSS tokens · C2 44 px minimum targets · C3 no auto-rotation, respect reduced motion · C4 a keyboard alternative to every drag · C5 never imply the neutral rig demonstrates the selected movement · C6 no runtime GPU or ML dependency · C7 estimates visibly labelled as estimates, never as measurements · C8 no CDN, everything vendored · C9 works without WebGL · C10 no frontend build or bundler · C11 UK English.

---

## A. Refactor parity (slice S1)

| ID | Requirement | Acceptance check | Method |
|---|---|---|---|
| PE-01 | `assets/viewer.js` remains the entry point. After S1 it is a one-line shim, `import './explorer/main.js';`, so `site.js`'s `import('./viewer.js')` and `tools/check-site.mjs` keep working unchanged. | `node tools/check-site.mjs` exits 0. `assets/viewer.js` has no more than 3 non-blank lines and imports `./explorer/main.js`. Every file in `assets/explorer/` is imported, directly or transitively, from `main.js`. | node |
| PE-02 | The model label states match today's. | After load, `#model-label` text is `ILLUSTRATIVE AVATAR` and `#avatar-controls` is not hidden. With the GLB request blocked (`evaluate_script` cannot do this, so serve with the file renamed), the label reads `JOINT RIG · AVATAR UNAVAILABLE`, the procedural rig is visible and exactly one `console.error` begins `Avatar could not be loaded`. That error is the only permitted console error, and only in this scenario. | browser (load) · manual (unavailable) |
| PE-03 | The elbow "Joint check" slider bends both elbows exactly as today. | Set `#elbow-angle` to 40 and dispatch `input`. `#joint-value` reads `40°`. The `left_elbow` and `right_elbow` local quaternions equal `bend(name, −40)` as defined in design §5.2, within tolerance. In node, `retarget.bendQuaternion` reproduces the same quaternions from GLB rest data. | browser + node |
| PE-04 | The crouch slider is unchanged. | Set `#stance-angle` to 30. Hips are bent −30, knees +60 and ankles −30, per `bend()`. Pelvis local `y` = `0.94 − 0.8·(1 − cos 30°)` ± 1e-4. `#stance-value` reads `30°`. | browser |
| PE-05 | The skeleton toggle is unchanged. | Check `#show-skeleton`. The skeleton helper is visible. Only meshes whose names match `/palm\|finger\|thumb\|shoe\|Head/` stay visible. Uncheck it and all meshes are visible again. | browser |
| PE-06 | The orbit and zoom buttons are unchanged. | `#orbit-left` and `#orbit-right` rotate the camera offset by ∓π/8 about +Y around the target `(0, 0.95, 0)`. `#zoom-in` scales the distance by 0.85 and `#zoom-out` by 1.15, clamped to [2.2, 7]. | browser |
| PE-07 | Reset restores everything that reset restores today. | After moving both sliders, toggling the skeleton and orbiting, click `#reset-view`. The camera returns to `(1.9, 1.45, 2.7)`. Every bone has its rest local quaternion and position. Both sliders read 0 and their outputs `0°`. The skeleton is off and all meshes are visible. | browser |
| PE-08 | Rendering stays on demand. | Static: no `setAnimationLoop` or self-rescheduling `requestAnimationFrame` loop in `assets/explorer/` (node grep). Runtime: with no interaction for 3 s, `__explorer.state.renderCount` does not change. Scrolled out of view, a programmatic `orbit` does not raise `renderCount` until the panel is visible again. | node + browser |
| PE-09 | Selecting a catalogue entry never changes the rig in S1. | Snapshot every bone quaternion. Navigate `#move=2` → `#move=13` → `#move=60`. The quaternions are unchanged and the label is unchanged. | browser |

## B. Camera (slice S2)

| ID | Requirement | Acceptance check | Method |
|---|---|---|---|
| PE-10 | Five camera presets: Front, Side (left), Back, Three-quarter and Top. They are `<button>` elements in a `role="group"` labelled "Camera presets". The active preset has `aria-pressed="true"`. | Clicking each preset sets `camera.position` to the value in design §5.4, within 1e-3, with the target `(0, 0.95, 0)`. Exactly one preset is `aria-pressed="true"` afterwards. Preset detection must not use OrbitControls' `change` event, which also fires on programmatic `controls.update()`. Drags are detected with the `start` event, and `orbit()`/`zoom()` set `custom` explicitly. After an orbit button, a zoom button or a drag, every preset reads `aria-pressed="false"` and `state.camera.preset === 'custom'`. | browser |
| PE-11 | Presets jump instantly. Nothing animates or rotates on its own (C3). | `controls.autoRotate === false` and `controls.enableDamping === false`. After clicking a preset, `renderCount` rises by at most 2 and the camera is stable for 2 s. The page behaves the same with `prefers-reduced-motion: reduce` emulated. | browser |
| PE-12 | Every pointer action has a keyboard equivalent (C4). | Tabbing from `#move-title` reaches, in DOM order: presets, orbit and zoom buttons, reset, joint select, both sliders, the skeleton toggle, then the estimate controls when present. Each one operates with Enter, Space or the arrow keys. Dragging is never the only way to change view, zoom, joint or pose. | browser + manual |

## C. Joints (slice S2)

| ID | Requirement | Acceptance check | Method |
|---|---|---|---|
| PE-13 | A joint list: a native `<select id="joint-select">` with the option "None" plus all 24 avatar bones. Labels are in plain English ("Left elbow"), grouped with `<optgroup>` into Torso and head, Left arm, Right arm, Left leg and Right leg. | The `option` count is 25. The set of option values equals the GLB skin's joint names (node reads them from the GLB; browser reads the DOM). Every label is unique. | node + browser |
| PE-14 | The selected joint is highlighted. | After selecting `left_elbow`, a marker object is visible and its world position equals the bone's world position. Its material colour equals the computed `--accent` token. Choosing "None" hides the marker. The marker is drawn with `depthTest: false`, so it is never hidden inside the mesh. | browser |
| PE-15 | An angle readout for the selected joint: `#joint-readout` (`aria-live="polite"`) reads `<Label>: <N>° from rest`. N is the rounded rotation angle of `restLocal⁻¹ · currentLocal`. | Left elbow with the elbow slider at 40 → `Left elbow: 40° from rest`. Left knee with the crouch at 30 → `Left knee: 60° from rest`. Pelvis at rest → `Pelvis: 0° from rest`. With nothing selected the readout is empty. Node unit test: `jointAngleDegrees(rest, current)` returns 40 ± 0.5 for a 40° axis-angle in any axis. | browser + node |
| PE-16 | Reset (PE-07) also returns the preset to Three-quarter, clears any applied estimate (PE-19) and keeps the selected joint, whose readout drops to 0°. | After selecting the left elbow, applying the elbow slider and choosing the Front preset, reset gives `state.camera.preset === 'three-quarter'`, `state.pose.kind === 'neutral'` and readout `Left elbow: 0° from rest`. | browser |

## D. Provenance (slices S2 and S5)

| ID | Requirement | Acceptance check | Method |
|---|---|---|---|
| PE-17 | (S2) While the rig is neutral, or only diagnostics are applied, `#model-provenance` shows exactly `Illustrative avatar — not this movement`, and `#model-label` reads `ILLUSTRATIVE AVATAR`. | Check the text after load, after each slider move, after the skeleton toggle and after each catalogue navigation. Node: `provenanceFor({kind:'neutral'})` returns that string. | browser + node |
| PE-18 | (S5) While a published estimate is applied: `#model-label` = `ESTIMATED POSE`. `#model-provenance` = `Estimated pose — from <imageLabel> (<imageId>), reviewed <D Month YYYY>`. `#model-provenance-detail` = `<estimator name> · confidence <0.00> · an estimate, not a measurement`. | Node: `provenanceFor` on fixture `valid-full.json` with imageLabel `Chen Weiming 1933, photograph 1` gives `Estimated pose — from Chen Weiming 1933, photograph 1 (chen-001), reviewed 24 October 2026`. Dates use no leading zero, an English month name and no ordinal. The label is never derived from anything except the validated file. Browser: apply the fixture via the hook and compare strings exactly. | node + browser |
| PE-19 | (S5) No stale estimate. When the displayed image changes to a different image id, or the catalogue entry changes, an applied estimate is removed. Bones return to rest and the PE-17 label returns in the same task. | Apply an estimate for `chen-001`, then navigate to an entry whose displayed image is not `chen-001`. `state.pose.kind === 'neutral'`, the bones are at rest and the PE-17 text shows. Apply, then press reset, and get the same result. | browser |
| PE-20 | (S5) While an estimate is applied, the elbow and crouch sliders are `disabled`. A visible note reads `Clear the estimate to use the joint checks.` A reviewed estimate can never be shown in a modified state under the reviewed label. | Apply → both sliders `disabled === true`, note present. Clear → sliders enabled with value 0. | browser |
| PE-21 | (S5) A pose file the user opens locally (`#pose-file`, `<input type="file" accept="application/json">`) is labelled `LOCAL FILE · NOT REVIEWED`, with the text `Unpublished pose file — local preview, not reviewed for this site`. This applies even when the file's `review.status` is `accepted`. | Load `valid-full.json` through `__explorer.loadPoseObject(obj, {origin:'local'})` and through the file input. Compare the strings exactly. | browser + node |
| PE-36 | (S5) An estimate is never applied automatically. `#apply-estimate` appears only when the displayed image id has an entry in `assets/pose-estimates/index.json`. It applies the estimate only on activation. | With an empty index: no button, and no request for any `assets/pose-estimates/*.json` except `index.json`. With a fixture index listing `chen-001`: the button appears on an entry showing `chen-001`, is absent on the drawings, and no pose file is fetched until it is clicked. | browser |

## E. Failure handling (slice S3)

| ID | Requirement | Acceptance check | Method |
|---|---|---|---|
| PE-22 | When the WebGL context is lost, the page tries to restore it. `webglcontextlost` calls `preventDefault()` and `#model-status` shows `The 3D view was interrupted. Trying to restore it…`. On `webglcontextrestored` the message hides, the scene renders again and the state is kept (camera, bones, label). | `evaluate_script`: `ext = renderer.getContext().getExtension('WEBGL_lose_context'); ext.loseContext();` → message visible and `state.renderer === 'lost'`. Then `ext.restoreContext()` → within 2 s the message is hidden, `state.renderer === 'webgl'`, `renderCount` has risen, and the camera and bone snapshots equal those taken before the loss. | browser |
| PE-23 | If the context is not restored within 5 s, show the still fallback (PE-24) with the text `The 3D view could not be restored. Reload the page to try again; the image archive is unaffected.` | `loseContext()` with no restore → after 5.5 s `state.renderer === 'failed'`, `#model-still` is visible and the text matches. The camera controls are hidden. | browser |
| PE-24 | No WebGL: if a WebGL2 context cannot be created, or `WebGLRenderer` throws, show `<img id="model-still" src="assets/model/avatar-neutral.png">`. Its alt text says it is the neutral illustrative avatar. Show the text `3D view unavailable in this browser. This still image shows the neutral illustrative avatar, not the selected position.` Label: `ILLUSTRATIVE AVATAR · STILL IMAGE`. Hide orbit, zoom, presets, sliders, joint select and estimate controls. The catalogue keeps working. The `<img>` is created only on this path; normal loads never request the PNG. | Load `http://localhost:8080/?explorer-test=no-webgl` (not appended to `BASE`: `URLSearchParams.get` returns the first value), or use an init script that stubs `HTMLCanvasElement.prototype.getContext` to return `null` for `webgl`/`webgl2`. Check that: the image has loaded (`naturalWidth > 0`); the texts and label match; the controls are hidden; `#move=13` still updates `#move-title`; and there are zero console errors. | browser |

## F. Layout and accessibility (slice S3)

| ID | Requirement | Acceptance check | Method |
|---|---|---|---|
| PE-25 | Works at a 360 px viewport. | `resize_page(360, 740)`: `document.documentElement.scrollWidth <= innerWidth`. Every visible `button`, `input`, `select` and standalone `a` inside `.model-panel` (inline links within a sentence, such as "Model notes", are exempt, as in WCAG 2.5.8) has a `getBoundingClientRect()` of at least 44 × 44. Range inputs measure the track's box. The checkbox is measured through its label. The preset group wraps and nothing is clipped (screenshot reviewed). Note: today's sliders (`min-height:30px`) and checkbox fail this. Fixing them is part of S3, not parity. | browser + manual |
| PE-38 | UK English in all new user-visible strings (C11). | Node: no `/\b(color\|center\|gray\|behavior\|normalize)\b/i` in string literals in `assets/explorer/*.js`. CSS property names are excluded. Copy is checked by hand. | node + manual |
| PE-40 | All colours come from CSS tokens (C1). | Node: `assets/explorer/*.js` has no hex, `rgb(` or `hsl(` colour literals. Every colour is read with `getComputedStyle(...).getPropertyValue('--token')`. | node |

## G. Hygiene, performance and network (all slices)

| ID | Requirement | Acceptance check | Method |
|---|---|---|---|
| PE-26 | No console errors in normal use. | Scripted session: load; navigate 5 entries; each preset; select 3 joints; move both sliders; skeleton on and off; reset; apply and clear an estimate (S5); load one malformed file (S5). `list_console_messages` shows 0 messages of type `error`. Rejected pose files log through `console.warn` only. | browser |
| PE-27 | Vendored libraries are pinned and unchanged (ADR-0006). | Node: `assets/vendor/MANIFEST.sha256` (created in S1 with the hashes recorded in ADR-0006) matches `sha256sum` of every file in `assets/vendor/` except `MANIFEST.sha256` itself. No other file is unlisted and no listed file is missing. Those listed files total 2,337,350 bytes unless an ADR supersedes ADR-0006. | node |
| PE-28 | Performance budget. Explorer modules stay small and add no dependencies. | Node: the sum of `assets/explorer/*.js` is ≤ 48 KiB. Imports are limited to `./*.js`, `../vendor/*.js` and `three`. No `import()` of absolute URLs. On load the page makes no new requests compared with today, apart from `explorer/*.js` and (S5) `pose-estimates/index.json`. Each pose file is ≤ 64 KiB (validator `E_SIZE`). | node + browser |
| PE-29 | Nothing reaches the network except same-origin assets. | Browser: across the PE-26 session, every entry in `list_network_requests` has the page's origin. External `<a href>` links in `index.html` are not requests and are out of scope. Node: `assets/explorer/*.js` has no `https?://` string literal and every `fetch(` argument is built with `new URL(<relative>, import.meta.url)`. | browser + node |
| PE-37 | The test hook is gated. | Without `?explorer-test` in the URL, `window.__explorer === undefined`. With `?explorer-test=1` it is defined, and `state` is a read-only snapshot (assigning to it throws in strict mode or has no effect). | browser |
| PE-39 | Pose content is never interpreted as HTML. | Node: no `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` in `assets/explorer/`. Browser: a valid fixture whose `review.notes` contains `<img src=x onerror=alert(1)>` renders as literal text and raises no dialog. | node + browser |

## H. Pose data (slice S4: pure modules and data; slice S5: binding)

| ID | Requirement | Acceptance check | Method |
|---|---|---|---|
| PE-30 | The validator accepts well-formed files. | `validatePose(fixture, {origin:'published'})` returns `{ok:true}` for `valid-minimal.json` (one joint) and `valid-full.json` (all 23 non-root joints, notes, overlay hash). Quaternions within 1e-3 of unit length are normalised in the returned object. | node |
| PE-31 | The validator rejects malformed files with a specific code and path, and never throws. | One fixture per case, each returning `ok:false` with the listed code: non-JSON text `E_JSON`; more than 64 KiB `E_SIZE`; wrong `schema` `E_SCHEMA_ID`; `schemaVersion` 2 or `"1"` `E_VERSION`; extra top-level key `E_UNKNOWN_KEY`; missing `review` `E_MISSING`; `imageId` `panel-001` or `../x` `E_IMAGE_ID`; bad SHA-256 `E_HASH`; bad 40-hex revision `E_REVISION`; joint `left_toe` or `pelvis` in `joints` `E_JOINT_NAME`; quaternion with NaN, wrong length or norm 0.5 `E_QUAT`; confidence 1.2, translation 3 m or more than 200-character string `E_RANGE`; date `2026-13-01` or `24/10/2026` `E_DATE`; published file with `review.status:"draft"` `E_STATUS`; frame not `+Y/+Z/+X/m` `E_FRAME`; unknown `jointConvention` `E_CONVENTION`; landmark missing `E_MISSING`. `validatePose` on `null`, `[]`, `42` and a deeply nested object returns `ok:false` without throwing. | node |
| PE-32 | Retargeting reproduces `bend()` exactly. | Node, with GLB rest data parsed from `archive-avatar.glb` and maths from `assets/vendor/three.core.js`: for each of `left_elbow`, `right_knee` and `left_hip` and θ ∈ {−65, −20, 0, 35, 100}, `retargetJoint(rest, name, axisAngle(+X, θ))` equals `bendQuaternion(rest, name, θ)`. | node |
| PE-33 | A joint-map or rotation inconsistency that swaps sides is caught. Scope: this check compares rotations against landmarks that come from the estimator's own named keypoints, transformed only by the basis matrix `C` and never through `jointMap`. It catches swapped or wrong map entries. It **cannot** catch a mirrored photograph or a sign error in `C`, because those mirror rotations and landmarks together. Those failures belong to the reviewer's projection and left/right checks (how-to §4). | Node: apply each fixture to the rest skeleton by forward kinematics. For each pair (`wrist`, `ankle`), let `dSame` = distance from posed `left_*` to `landmarks.left_*` plus distance from posed `right_*` to `landmarks.right_*`, and `dSwap` = the same with the landmarks crossed. If `|dSame − dSwap| < 0.05` m the pair is `inconclusive`, which is reported and is not an error. Cross Hands brings the wrists close together. Otherwise `dSame < dSwap` is required, or the result is `E_LEFT_RIGHT`. Fixture `invalid-mirrored.json` is an **asymmetric** pose (one arm raised, one leg stepped) with left and right joint rotations swapped, and fails with `E_LEFT_RIGHT`. Fixture `valid-crossed-hands.json` returns `inconclusive` for wrists and passes. `tools/check-site.mjs`, or a sibling check, runs this for every published file. | node |
| PE-34 | Published estimates are allowlisted. | Node: `assets/pose-estimates/index.json` validates (`schema: yang-form/pose-estimate-index`, `schemaVersion: 1`). Each entry's `file` matches `^(yang\|chen)-\d{3}\.json$`, equals `<imageId>.json`, exists, validates as published, has an `imageId` equal to the entry's, and has a SHA-256 equal to the index's. `extracted/historical/<imageId>.png` exists and its SHA-256 equals the file's `sourceImage.sha256`. There are no unindexed `*.json` files in the directory. Browser: the page fetches pose files only by index entry and never by a URL taken from the location hash or query. | node + browser |
| PE-35 | An empty index is the shipped default and is silent. | `index.json` has `"estimates": []`. The page issues one `index.json` request with status 200 and no 404s. No apply button appears. | node + browser |
| PE-41 | Rejection leaves the page in its illustrative state. | `__explorer.loadPoseObject(malformed)` returns `{ok:false, errors:[…]}`. `state.pose.kind` is unchanged (neutral), the PE-17 label is shown, `#pose-error` (`role="status"`) reads `This pose file was rejected: <first error message>`, and one `console.warn` is logged. | browser |

## Traceability

| Constraint | Criteria |
|---|---|
| C1 tokens | PE-14, PE-40 |
| C2 44 px | PE-25 |
| C3 motion | PE-11 |
| C4 keyboard | PE-10, PE-12, PE-13 |
| C5 never imply | PE-09, PE-17, PE-19, PE-24, PE-36 |
| C6 no runtime ML | PE-28, PE-29, ADR-0003 |
| C7 estimate labelling | PE-18, PE-20, PE-21 |
| C8 vendored | PE-27, PE-28, PE-29 |
| C9 no WebGL | PE-22, PE-23, PE-24 |
| C10 no build | PE-01, PE-28 |
| C11 UK English | PE-38 |

Criterion IDs in use: PE-01 to PE-41. None are withdrawn.
