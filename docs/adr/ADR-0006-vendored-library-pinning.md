# ADR-0006: Vendored library pinning and integrity manifest

Status: Accepted (2026-10-24) · 24 October 2026 · Spec: PE-27, PE-28, PE-29

## Context

Everything is vendored and there is no CDN (README, C8). Three.js 0.186.1 and its add-ons live in `assets/vendor/`, but nothing records which upstream bytes they are. A silent edit or partial upgrade (for example `three.module.js` from one release and `GLTFLoader.js` from another) would be invisible in review. The add-ons import the bare specifier `three`, which the import map in `index.html` resolves.

## Decision

- Add `assets/vendor/MANIFEST.sha256` in `sha256sum` format, covering every file in `assets/vendor/` except the manifest itself. It is checked by a node test and in CI. An unlisted file, a missing file or a mismatch fails the build. Baseline (24 October 2026, three.js r186 / 0.186.1, 2,337,350 bytes across the listed files):

```
9fb63427ce6641fa14fd0baff9cc4d1b5f9c3d85fd084bf2e90e803c44ec1797  BufferGeometryUtils.js
200cb5621236d83d241662078878de25800b152d091ac63678d74179abb0df6b  GLTFLoader.js
8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc  LICENSE
5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6  NOTO-OFL.txt
3d79d07ecb686b4e5d93232eedab255331c1beef711e13164eaa1f68655a5f2b  OrbitControls.js
b1632a703206c3d830de9fcbe515696770d04b71a15ee6b50afa6d2c3298c86f  SkeletonUtils.js
17f10aa3203f73b64d9b0d52c8a071d7edc32de52d51b0b5e1f2b04d35a55e64  noto-serif-sc-subset.ttf
9edde002b066a9a05676a6127f67735b62baf399bdea529f2f7e31657da769e6  three.core.js
9052042d676cb0fdc1ddfefe193053f34b7ac0513a616fdac4535d49987812ea  three.module.js
```

- Upgrades replace the whole set from one upstream release in one commit. That commit updates the manifest, the version in README and this ADR's baseline (or a superseding ADR). It must then pass the S1 parity checks.
- Explorer code may import only `three`, `../vendor/*.js` and its own modules. No new vendored library without a new ADR.
- Subresource Integrity attributes are not used: the import map and module graph would need an `integrity` map for each dynamic import, which adds upkeep without protecting against a same-origin attacker.

## Consequences

- Vendored bytes are auditable and drift is caught in CI.
- Upgrades are deliberate and cost a little more.
- The manifest guards against accidents, not against an attacker with commit access. That is the realistic threat for a static archive.
