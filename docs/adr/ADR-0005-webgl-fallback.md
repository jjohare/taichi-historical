# ADR-0005: WebGL failure and fallback policy

Status: Accepted (2026-10-24) · 24 October 2026 · Spec: PE-22, PE-23, PE-24, PE-26

## Context

Three.js 0.186.1 needs WebGL2. Some browsers, kiosks, privacy modes and remote desktops have none. Mobile GPUs drop contexts under memory pressure. Today a lost context shows "Reload to restore" and makes no restore attempt. If the viewer module fails to import, `site.js` shows a generic sentence. The archive itself (images and notes) must stay usable whatever happens to 3D.

## Decision

- Before constructing the renderer, probe for `webgl2` on a detached canvas. If it is unavailable, or `WebGLRenderer` throws, use the **still** path: show `assets/model/avatar-neutral.png` with descriptive alt text and the sentence `3D view unavailable in this browser. This still image shows the neutral illustrative avatar, not the selected position.` Hide every control that would do nothing.
- On `webglcontextlost`, call `preventDefault()` so the browser may restore, show `The 3D view was interrupted. Trying to restore it…` and stop rendering. On `webglcontextrestored`, three.js re-initialises, the explorer re-renders with its state intact and the message hides.
- If there is no restore within 5 seconds, switch to the still path with `The 3D view could not be restored. Reload the page to try again; the image archive is unaffected.` Do not try to rebuild the renderer automatically. A loop of lost contexts is worse than a clear message.
- None of these paths logs `console.error`. The only expected error remains a failed avatar fetch.
- `?explorer-test=no-webgl` forces the still path, for deterministic testing.

## Consequences

- Every browser gets a truthful view of the avatar, and the catalogue never depends on WebGL.
- The neutral PNG becomes a runtime asset. It must be regenerated whenever the avatar changes (`tools/build_avatar.py` already produces it).
- The 5-second timeout is a judgement call. It is long enough for a tab switch on mobile, and short enough that nobody stares at a blank panel.
