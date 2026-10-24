# DPMesh integration status

The requested estimator is [EternalEvan/DPMesh](https://github.com/EternalEvan/DPMesh), CVPR 2024. The inspected source revision is `721191bef45c81f35ea0608cfeae94ff0666fb8b`.

**No mesh estimates have been produced or bound to the site.** The website's avatar is an independently authored illustrative model.

## Inputs and dependencies

`inputs.json` deduplicates the historical photographs used by the catalogue and retains every associated occurrence, source URL and mapping qualification. Run `cargo run --manifest-path tools/catalogue/Cargo.toml --bin pose_inputs` to regenerate it. The modern drawings are excluded from this first estimation batch.

The upstream code takes a person image plus 2D joints and their validity masks. Its PW3D loader transforms input joints into a 32 × 32 heatmap frame and uses a 256 × 256 image crop. Feeding untransformed pixel coordinates, fabricated zero joints or a whole image without the expected crop would not reproduce that pipeline.

This is body-mesh estimation, not detailed finger reconstruction. The source's VPoser wrapper appends zero terminal hand rotations; the SMPL body representation does not infer the individual finger articulations shown in the photographs. Visible fingers on the illustrative avatar are authored geometry, not measured hand poses.

The published model setup requires:

- A DPMesh checkpoint. `3dpw_best_ckpt.pth.tar` has been downloaded from the project's Tsinghua directory outside this repository: 5,727,074,287 bytes, ZIP integrity verified, SHA-256 `dbb565c0ec49ee9eef3ed450028f4597ee23801398bab507b06cb9d94af0bff7`.
- SMPL neutral, male and female model data for the upstream `SMPL_Layer` initialiser, plus its `smplpytorch` implementation.
- VPoser model configuration and weights.
- The extra and Human3.6M joint regressors expected by the source.
- Its Python/PyTorch environment and reviewed 2D joint detections for these photographs.

These body-model assets were not found in the local workspace. Their location has been requested. GPU hardware is available, but an available GPU alone is not a runnable model. Model weights and licensed body-model data belong outside the public repository and Pages artifact.

An isolated Python 3.10 / PyTorch 1.12.1+cu113 / torchvision 0.13.1+cu113 environment has passed a GPU arithmetic smoke check. This verifies the numerical runtime only, not a complete DPMesh installation or inference. SMPL's official download endpoint requires a registered account; see the [upstream asset instructions](https://github.com/hongsukchoi/3DCrowdNet_RELEASE/blob/main/assets/directory.md#pytorch-smpl-layer-and-vposer) for the requested files.

## Review before binding

Keep raw estimates and their exact input image, crop transform, checkpoint hash, source revision and joint convention together. Compare a rendered projection against the photograph before accepting an estimate. Check left/right, standing leg, hand and foot placement, depth ambiguity, clothing occlusion and crop truncation. Low-resolution archival scans can leave substantial uncertainty; an inferred mesh is not historical evidence of unseen anatomy.

Only reviewed estimates should become selectable historical poses. A reused photograph should retain one estimate with several catalogue occurrences, rather than several apparently independent reconstructions. Historical variants must keep their own source labels. Retargeting must account for the avatar's rest matrices and coordinate system, not merely match bone names. There is currently no positional binding to remove or conceal.
