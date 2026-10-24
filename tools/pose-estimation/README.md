# pose-estimation: SAM 3D Body → yang-form pose estimates

An offline converter. It turns SAM 3D Body output, which uses the Momentum Human Rig (MHR), into `yang-form/pose-estimate` schema v1 files (design §8.3, ADR-0002). The crate is private (`publish = false`) and project-specific.

## Usage

Run it from anywhere in the repository:

```sh
cargo run --manifest-path tools/pose-estimation/Cargo.toml -- \
  --batch <dir>/batch-dinov3 --batch-alt <dir>/batch-vith \
  --review <dir>/pose-review-first-pass.md --out tools/pose-estimation/out \
  [--only yang-001,yang-043] [--bones] [--tentative-draft] [--publish]
```

| Flag | Meaning |
|---|---|
| `--batch` | Directory of raw SAM 3D Body JSON files, `<imageId>.json` (default checkpoint, dinov3) |
| `--batch-alt` | The vith batch, used only for rows whose `preferred` column says `vith` |
| `--review` | Review table: `\| id \| dinov3 \| vith \| preferred \| note \|`, exactly 240 rows |
| `--out` | Accepted files and `index.json` go here; drafts go to `<out>/draft/`. `tools/pose-estimation/out/` is gitignored |
| `--publish` | Write accepted files and `index.json` to `assets/pose-estimates/` instead of `--out` |
| `--only` | Convert only these ids |
| `--bones` | Print the per-bone direction check (below) |
| `--tentative-draft` | Treat tentative grades (`A?`, `B?`) as drafts too |

Grades map to `confidence.overall` as A or A? → 0.9 and B or B? → 0.7. A bare `?` (ungradeable) or any C makes the file a draft (`review.status: "draft"`, all checks false), and a draft is never published. `converter.revision` is the repository's `HEAD`, so commit converter changes before a run that will be published.

The tool asserts these preconditions:

- The PNG's SHA-256 equals the estimator's `source_image_sha256`.
- The image size matches `image_size_hw`.
- The checkpoint hash is 64 hex characters.
- The run used the whole image.
- The MHR model hash equals the one the reference skeleton was derived from.

## The maths in brief

Full derivation: the crate documentation at the top of `src/main.rs`.

- **Frames.** `pred_joint_coords` and `pred_keypoints_3d` are in the camera frame (+X right, +Y down, +Z into the scene). `pred_global_rots` are in MHR's body axes (+Y up, +Z forward, +X left), which are the avatar's axes. So positions use `C = diag(1, −1, −1)` (180° about X), and rotations use `C = I`.
- **World deltas.** `D_j = G_posed,m · G_rest,m⁻¹` for each mapped joint. The rest values come from `reference/mhr-rest-skeleton.json`.
- **Rest alignment.** The rigs rest in different A-poses, so `D'_j = D_j · A_j⁻¹`, where `A_j` is the shortest arc taking MHR's rest bone direction onto the avatar's. MHR's rest bone direction is taken per identity as `D_j⁻¹ · d_j`, where `d_j` is the posed bone from `pred_joint_coords` through `C`, so shape offsets are included. Then `D'_j · b_avatar = d_j`: every avatar bone points exactly where MHR's does. The twist about the bone comes from `D_j`, because a shortest arc adds none. The pelvis has three child bones, so it is aligned as a frame: the hip line maps exactly and the spine as closely as the rigs allow (TRIAD).
- **Parent-relative deltas.** `Q_j = D'_parent⁻¹ · D'_j`, as in design §5.3. The explorer's `L_j = L_r · (W_r⁻¹ · Q_j · W_r)` then reproduces `G_j = D'_j · W_r,j`.
- **Root translation.** SAM pins MHR's root at its template height, so the source pelvis measures nothing. `root.translation = (0, t, 0)`, where `t` keeps the lower avatar ankle at its rest height after the pose.
- **Landmarks.** The MHR70 keypoints 62, 41, 13 and 14 are taken relative to the MHR root, transformed by `C` and scaled so that pelvis-to-head is 0.73 m. They are placed at the posed avatar pelvis and never pass through the joint map.

## Joint map `mhr-to-yang24@1`

The map is `mhr-to-yang24.json`, embedded at compile time.

- 22 of the 24 avatar joints are mapped. The pelvis goes in `root.rotation` and 21 joints go in `joints`.
- `c_spine0` folds into the pelvis.
- The avatar ankle takes `l_subtalar`/`r_subtalar`. MHR's ankle hinge (`talocrural`) and subtalar joint sit below `l_foot`, so `l_foot`'s own rotation misses plantar flexion. With `l_foot`, yang-001's foot bone was 16° off.
- The hands have no reviewed counterpart and stay at rest relative to the wrists. The wrist bone is aimed at the middle-finger base.
- Every unmapped joint is a leaf, so the even-share chain rule of design §5.3 is never needed.

## Checks

- `cargo test` covers:
  - `C`;
  - quaternion maths (shortest arc, TRIAD, delta composition round trip);
  - the joint map against the GLB hierarchy;
  - §5.3 FK preserving world deltas;
  - SHA-256 test vectors.
- A golden test converts raw SAM output. Raw output stays outside the repository (ADR-0003), so the test is ignored by default. Run it with `SAM_SAMPLE_DIR=<batch-dinov3> cargo test -- --include-ignored`.
- `--bones` compares each avatar bone's posed direction, from FK on the GLB rest with the written `Q_j`, against MHR's posed bone from `pred_joint_coords`:
  - Aligned bones come out at 0.000°.
  - Bones that only join two rigs' differing rest offsets show their structural difference: pelvis→hip, pelvis→spine1 and spine3→collar. That difference moves joint positions, not limb aim.

## Licence requirement

Treat the outputs as possibly derived from the SAM Materials (ADR-0003). `assets/pose-estimates/SAM-LICENSE.txt`, an unmodified copy of the SAM License, must ship beside every published pose file, and `estimator.licence` records it. The MHR rest skeleton in `reference/` is derived from Apache-2.0 MHR assets; its provenance is inside the file. Raw SAM outputs, weights, meshes and overlays never enter the repository.
