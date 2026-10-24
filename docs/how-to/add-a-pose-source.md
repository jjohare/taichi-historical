# How to add a reviewed pose estimate for a photograph

This SOP adds one `assets/pose-estimates/<imageId>.json` file for one historical photograph. It follows [ADR-0002](../adr/ADR-0002-pose-schema-versioning.md) (schema), [ADR-0003](../adr/ADR-0003-offline-estimation-no-runtime-ml.md) (offline estimation) and [ADR-0004](../adr/ADR-0004-provenance-labelling.md) (labelling). The schema itself is in [design §8](../design/pose-explorer-design.md#8-pose-estimate-data).

**Status:** the converter is the Rust binary `tools/pose-estimation/src/main.rs` ([README](../../tools/pose-estimation/README.md); ADR-0002 amendment). The validator and the explorer binding shipped in slices S4 and S5.

## 0. Before you start

- Read the [SAM License](https://github.com/facebookresearch/sam-3d-body/blob/main/LICENSE) and request checkpoint access on Hugging Face (`facebook/sam-3d-body-dinov3`). Do not commit weights, the MHR model file or raw outputs, anywhere in this repository. `pages.yml` publishes `assets/` and `research/` wholesale.
- Choose a working directory **outside** the repository, for example `~/data/yang-form-estimates/`. Raw outputs, meshes and review renders stay there and are backed up there.
- Pick the photograph by its image id (`chen-001`, `yang-002`). `research/dpmesh/inputs.json` lists every historical photograph with its catalogue occurrences. One photograph gets one estimate, however many entries reuse it. Drawings (`panel-*`) are out of scope.

## 1. Record the environment

```sh
cd ~/src/sam-3d-body && git rev-parse HEAD          # → estimator.revision
cd ~/src/MHR && git rev-parse HEAD                  # → rig.revision
sha256sum checkpoints/sam-3d-body-dinov3/model.ckpt # → estimator.checkpointSha256
sha256sum checkpoints/sam-3d-body-dinov3/assets/mhr_model.pt  # → rig.modelSha256
sha256sum ~/workspace/yang-form/extracted/historical/<imageId>.png  # → sourceImage.sha256
```

Use the Python environment described in the estimator's `INSTALL.md`. Note the output coordinate frame that revision documents. It goes in `estimator.outputFrame`, and the converter's basis-change matrix must match it.

## 2. Run the estimator offline

Run the demo or Python API on the PNG from `extracted/historical/`, never on a re-encoded copy. Give a person box prompt if more than one figure is detected. Record the crop `[x, y, w, h]` and whether you mirrored the image. If you mirrored it, the converter must mirror the joints back (left↔right and X negated), and you set `sourceImage.mirrored: true`. Save the raw output (pose parameters, MHR joint transforms, mesh) under `<workdir>/<imageId>/raw/`.

## 3. Convert to the avatar convention

The converter reads the raw SAM 3D Body JSON (one `<imageId>.json` per photograph, as written by the batch runner, with `pred_global_rots`, `pred_joint_coords`, `pred_keypoints_3d` and a `provenance` block), and a review table with one row per photograph (`| id | dinov3 | vith | preferred | note |`):

```sh
cargo run --manifest-path tools/pose-estimation/Cargo.toml -- \
  --batch <workdir>/batch-dinov3 [--batch-alt <workdir>/batch-vith] \
  --review <workdir>/review.md --out tools/pose-estimation/out \
  [--only <imageId>,…] [--bones] [--tentative-draft] [--publish]
```

Commit converter changes first: `converter.revision` is the repository's `HEAD` at run time, and the tool warns when `tools/pose-estimation` has uncommitted changes. It asserts that the PNG's SHA-256 matches the one the estimator recorded, and that the MHR model hash matches the reference skeleton's.

The converter does three things. First, it computes each mapped joint's world delta `D_j = G_posed · G_rest⁻¹` from MHR's posed and rest global orientations. These are already in the avatar's axes (+X left, +Y up, +Z forward). Camera-frame positions go through `C = diag(1, −1, −1)`. It aligns each MHR bone's rest direction to the avatar's, so that every avatar bone points where MHR's does. Second, it writes `Q_j = D'_parent⁻¹ · D'_j` for the 21 mapped non-root joints and the pelvis (design §5.3). The hands are left at rest. Third, it writes root translation, landmarks, and confidence with its method. The landmarks come from the estimator's own wrist and ankle keypoints, through the basis change only and never through the joint map, so the automated left/right check stays independent of the rotations. Rows graded `?` or C go to `<out>/draft/` with `review.status: "draft"`. Everything else is written as accepted, with `index.json`, into `--out`, or into `assets/pose-estimates/` with `--publish`. **Never copy MHR local rotations by bone name.** The avatar's rest orientations differ, and the result would look plausible but be wrong.

## 4. Review

Open the site locally (`python -m http.server 8080`), go to an entry showing the photograph, and load the converted file (`<out>/<imageId>.json`, or `<out>/draft/<imageId>.json`) with **Review a pose file**. It is labelled `LOCAL FILE · NOT REVIEWED`, which is expected. Compare it with the photograph and the overlay render from several camera presets, and tick each item honestly:

| Check (`review.checks`) | Question |
|---|---|
| `projection` | Does the overlay match the silhouette of the photographed figure, for torso, limbs and head direction? |
| `leftRight` | Is the figure's left side the avatar's left (+X)? The automated check (PE-33) cannot detect a mirrored photograph or a basis sign error, so this question is the only guard against them. Mirrored plates and side-naming caveats (`direct-with-naming-caveat`) are the usual trap. Set `review.leftRight` to `as-photographed` or `side-naming-differs`. |
| `standingLeg` | Is the weight-bearing leg the same as in the photograph? |
| `handsFeet` | Are wrist and ankle orientations plausible? Fingers are not represented: the avatar has no finger bones. |
| `truncation` | Is no estimated joint lying outside the crop or hidden by clothing without a note? |

If any answer is "no" and cannot be fixed by re-prompting or re-cropping, **do not publish**. Write what you found in the image's research notes instead. Record uncertainty in `review.notes` ("sleeve hides the left elbow"). Set `confidence.overall` to reflect the review, not only the model score, and describe how in `confidence.method`. Then record the grade (A, B, C or `?`) and any note in the review table and re-run the converter. It fills `review.status`, `review.reviewer`, `review.date` and `review.notes` from the table.

## 5. Write and index the file

Re-run step 3 with `--publish`. It writes `assets/pose-estimates/<imageId>.json` and rebuilds `assets/pose-estimates/index.json` from every pose file in that directory, hashing the exact bytes. Check that `assets/pose-estimates/SAM-LICENSE.txt` is present. If this is the first published estimate, add the SAM 3D Body acknowledgement to the README and the site's sources section.

## 6. Run the checks

```sh
node --test tests/          # schema, left/right FK check, index allowlist and hashes (PE-30–PE-35)
node tools/check-site.mjs   # catalogue, local links, GLB
```

Then, in the browser: reload, navigate to every catalogue entry that shows this photograph, and press **Apply estimated pose**. Confirm that the label reads `Estimated pose — from … (<imageId>), reviewed <date>` (PE-18). Confirm that moving to another image returns the rig to `Illustrative avatar — not this movement` (PE-19). Confirm the console has no errors (PE-26).

## 7. Rebuild and commit

The catalogue does not need rebuilding for a new estimate. Rebuild it (`cargo run --manifest-path tools/catalogue/Cargo.toml`) only if you also changed mapping notes. Commit the pose file and the index change together, with a message naming the image id, estimator revision and reviewer. Raw outputs stay in the working directory. Record their location in the commit message, never their contents.

## Removing or replacing an estimate

To withdraw an estimate, remove its index entry and its file in one commit. To replace one, re-run steps 1–6 from the stored raw outputs or a new estimate. Never hand-edit rotations in a published file: the hashes and the review would no longer describe its contents.
