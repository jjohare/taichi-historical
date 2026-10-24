# ADR-0004: Provenance labelling rules for the avatar

Status: proposed · 24 October 2026 · Spec: PE-17–PE-21, PE-24, PE-36, PE-41

## Context

DESIGN.md forbids implying that the neutral rig demonstrates the selected movement, and requires visible evidence labels. Estimated poses are inferences from low-resolution archival scans, not measurements, and must never look like recovered historical fact. There are four ways a misleading label could appear: a pose left over after the user moves to another entry, a reviewed pose modified by sliders, a local file mistaken for a reviewed one, and a still image shown without context.

## Decision

- The label is a pure function of explorer state (`provenanceFor(pose, context)`). Nothing sets it imperatively. Exact strings:
  - Neutral, or diagnostics only: tag `ILLUSTRATIVE AVATAR`, text `Illustrative avatar — not this movement`.
  - Published estimate: tag `ESTIMATED POSE`, text `Estimated pose — from <imageLabel> (<imageId>), reviewed <D Month YYYY>`, detail `<estimator> · confidence <0.00> · an estimate, not a measurement`.
  - Local file: tag `LOCAL FILE · NOT REVIEWED`, text `Unpublished pose file — local preview, not reviewed for this site`. This applies even when the file claims `accepted`.
  - Still image: tag `ILLUSTRATIVE AVATAR · STILL IMAGE`. Avatar failed to load: tag `JOINT RIG · AVATAR UNAVAILABLE` (as today).
- Estimates are applied only by explicit user action (`Apply estimated pose`) and only for the displayed photograph. They are never applied automatically on navigation.
- Changing the displayed image or the catalogue entry, pressing reset, or a failed context restore all return the rig to neutral in the same task.
- The diagnostic sliders are disabled while an estimate is applied, so a reviewed pose is never shown in a modified state under the reviewed label.
- Reviewed dates are stored as ISO `YYYY-MM-DD` and shown as `24 October 2026`.
- A rejected file leaves the neutral state and its label untouched, explains the rejection in a status line, and logs through `console.warn`.

## Consequences

- Each label state has an exact string, so tests can assert it and copy changes are deliberate (they require spec updates).
- Users cannot tweak an estimate in place. A reviewer who wants to compare uses a local file, which is always labelled unreviewed.
- The catalogue gains one outbound event (`yang:image-shown`). The rig still never mutates the catalogue.
