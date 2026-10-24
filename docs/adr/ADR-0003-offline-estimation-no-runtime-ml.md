# ADR-0003: Offline pose estimation with SAM 3D Body and MHR; no runtime GPU or ML; DPMesh abandoned

Status: proposed · 24 October 2026 · Supersedes the DPMesh plan in `research/dpmesh/README.md` · Spec: PE-28, PE-29

## Context

The site is a static archive that must work on any device without WebGL (C9), and it has no build step (C10). In-browser inference would need large weights, GPU access and network or CDN downloads. All of these are excluded.

DPMesh (CVPR 2024) was prepared first. Its checkpoint was verified (SHA-256 `dbb565c0…bff7`). But it depends on SMPL body-model data, and SMPL is obtained only through a registration-gated licence ([smpl.is.tue.mpg.de](https://smpl.is.tue.mpg.de/modellicense.html)) with non-commercial terms. The operator judged that unsuitable for an openly published project. This ADR records that decision; it does not re-audit the SMPL terms. The model data was never obtained, and no DPMesh estimate was produced.

Meta's SAM 3D Body (`facebookresearch/sam-3d-body`, revision inspected `b5c765a0d89d789985e186d396315e7590887b94`) estimates single-image full-body pose, including feet and hands, on the Momentum Human Rig. Its code and checkpoints are under the "SAM License" (last updated 19 November 2025). That licence grants a royalty-free right to use, reproduce, distribute and modify the materials. Derivatives that are distributed must carry the agreement, and published research must acknowledge SAM. Checkpoints on Hugging Face are access-gated. MHR (`facebookresearch/MHR`, revision `877cba5ee61a5f77d1457bf4de93a66695132bd9`) is Apache-2.0. Both licences were read from the repositories on 24 October 2026, not recalled.

## Decision

- No ML model, GPU computation or network inference at runtime. The page only reads small, reviewed JSON files from its own origin.
- Estimation runs offline, in a separate Python environment (the converter must run MHR forward kinematics in torch, so it stays in Python under the operator's Rust-first rule's exception for thin wrappers over Python-only modules): SAM 3D Body → MHR skeleton → converter to `yang-form-24/rest-world-delta@1` → human review → pose JSON (ADR-0002).
- DPMesh is abandoned. `research/dpmesh/` remains as a historical record of the attempt; its inputs list is reusable as the image work-list. The DPMesh checkpoint is not used.
- Weights, the MHR model file, raw outputs, meshes and review renders stay **outside the repository**. That keeps them out of the Pages artifact too, because `pages.yml` copies `research/` and `assets/` wholesale. Only the derived pose JSON is committed.
- Treat the pose JSON as possibly derived from the SAM Materials. Ship `assets/pose-estimates/SAM-LICENSE.txt` (an unmodified copy) beside it, record `estimator.licence`, and acknowledge SAM 3D Body on the site and in the README when the first estimate is published.

## Consequences

- The page stays fast and dependency-free, and works offline once cached. Estimation cost falls on the maintainer once per photograph.
- Results are reproducible from the recorded revisions and hashes. Changing the checkpoint means re-estimating and re-reviewing.
- Hand pose estimates become possible (SAM 3D Body covers hands). The 24-bone avatar has no finger bones, so finger articulation is out of scope for schema v1.
- Whether pose parameters are "derivative works" under the SAM License is an open legal question. This ADR takes the cautious reading. The operator should confirm before the first publication.
