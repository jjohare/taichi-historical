# DPMesh integration status

The requested estimator is [EternalEvan/DPMesh](https://github.com/EternalEvan/DPMesh), CVPR 2024. The inspected source revision is `721191bef45c81f35ea0608cfeae94ff0666fb8b`.

**No mesh estimates have been produced or bound to the site.** The website's avatar is an independently authored illustrative model.

## Inputs and dependencies

`inputs.json` deduplicates the historical photographs used by the catalogue and retains every associated occurrence, source URL and mapping qualification. Run `cargo run --manifest-path tools/catalogue/Cargo.toml --bin pose_inputs` to regenerate it. The modern drawings are excluded from this first estimation batch.

The upstream code takes a person image plus 2D joints and their validity masks. Its PW3D loader transforms input joints into a 32 × 32 heatmap frame and uses a 256 × 256 image crop. Feeding untransformed pixel coordinates, fabricated zero joints or a whole image without the expected crop would not reproduce that pipeline.

The published model setup requires:

- A DPMesh checkpoint; the project's Tsinghua download directory was reachable during setup.
- SMPL neutral, male and female model data for the upstream `SMPL_Layer` initialiser, plus its `smplpytorch` implementation.
- VPoser model configuration and weights.
- The extra and Human3.6M joint regressors expected by the source.
- Its Python/PyTorch environment and reviewed 2D joint detections for these photographs.

These body-model assets were not found in the local workspace. Their location has been requested. GPU hardware is available, but an available GPU alone is not a runnable model. Model weights and licensed body-model data belong outside the public repository and Pages artifact.

## Review before binding

Keep raw estimates and their exact input image, crop transform, checkpoint hash, source revision and joint convention together. Compare a rendered projection against the photograph before accepting an estimate. Check left/right, standing leg, hand and foot placement, depth ambiguity, clothing occlusion and crop truncation. Low-resolution archival scans can leave substantial uncertainty; an inferred mesh is not historical evidence of unseen anatomy.

Only reviewed estimates should become selectable historical poses. A reused photograph should retain one estimate with several catalogue occurrences, rather than several apparently independent reconstructions. Historical variants must keep their own source labels. Retargeting must account for the avatar's rest matrices and coordinate system, not merely match bone names. There is currently no positional binding to remove or conceal.
