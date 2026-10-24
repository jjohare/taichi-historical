# ADR-0002: Versioned pose-estimate schema with mandatory provenance

Status: proposed · 24 October 2026 · Spec: PE-30–PE-35, PE-41 · Design §8

## Context

Reviewed pose estimates from historical photographs will be shown on the avatar. A pose without its origin can be mistaken for a recovered historical fact. The DPMesh notes already required these to stay together: the exact input image, crop, checkpoint hash, source revision, joint convention and review. Names alone do not define a retarget, because the avatar's rest orientations are not identity. A single photograph can be reused across several catalogue entries.

## Decision

- One JSON file per reviewed **source photograph**, at `assets/pose-estimates/<imageId>.json`, listed in `assets/pose-estimates/index.json` with its SHA-256. The page fetches only files the index lists.
- The file declares `schema: "yang-form/pose-estimate"` and an integer `schemaVersion` (now `1`). Validators accept only the versions they implement. Unknown keys are rejected at every level, so any additive change is a version bump.
- These provenance fields are required: `sourceImage` (path, SHA-256, crop, mirrored flag), `estimator` (name, repository, 40-hex revision, checkpoint id and SHA-256, licence, output frame), `rig` (name, repository, revision, model SHA-256), `converter` (path and revision), `jointConvention`, `jointMap`, `frame`, `confidence` (overall and method), and `review` (status, reviewer, ISO date, left/right verdict, five-item checklist, optional overlay hash and notes).
- Joint data uses the convention `yang-form-24/rest-world-delta@1`. It holds a parent-relative delta quaternion in the avatar's rest-world axes (+X left, +Y up, +Z forward, metres), applied as `L = L_rest · (W_rest⁻¹ · Q · W_rest)`. This generalises today's `bend()` exactly.
- `landmarks` (both wrists and both ankles, in the avatar frame) are required, so a left/right swap is caught mechanically by forward kinematics.
- Validation is a pure function that never throws, returns coded errors, and runs both in CI and in the page.

## Consequences

- An estimate cannot be published without saying where it came from and who reviewed it. CI rejects the omission.
- Strict rejection makes schema evolution deliberate: each version bump needs validator code and fixtures. That is acceptable for a hand-reviewed corpus of at most about 200 files.
- Old files are migrated by re-running the converter from the raw outputs kept outside the repository, never by hand-editing rotations.
- The converter, not the page, carries the complexity of the source rig (MHR). The page stays a small, testable consumer.
