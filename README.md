# The Yang long form

A static historical image archive for [GitHub Pages](https://jjohare.github.io/yang-form/): 103 named entries, 104 extracted drawings and photographic comparisons from Yang Chengfu and Chen Weiming.

The landing page explains the historical scope and the possibility of differences in modern teaching. Every position includes source links, mapping qualifications and editorial notes. The orbitable Three.js avatar is independent of the selected position, with joint and crouch controls and a skeleton view that retains the hands and feet.

## Browse locally

Serve the repository root over HTTP, for example `python -m http.server 8080`, then open `http://localhost:8080`. No frontend build or CDN is required; Three.js 0.186.1 and OrbitControls are vendored with their MIT licence.

The [avatar](assets/model/README.md) is an original illustrative Blender model, not a recovered historical pose. [DPMesh preparation](research/dpmesh/README.md) records the separate estimation workflow and its remaining dependencies. No inferred poses are currently bound to the website.

## Rebuild the catalogue

With Rust and ImageMagick installed:

```sh
cargo run --manifest-path tools/catalogue/Cargo.toml
node tools/check-site.mjs
```

`moves.md` preserves the supplied numbering and spelling. `research/move-map.tsv` is the explicit correspondence table; `research/position-notes.tsv` holds the editorial notes. `poses/` contains one directory per named entry, with PNGs and a README. See [sources and method](research/README.md) for image attribution, historical differences and interpretation limits.

## Publishing

GitHub Pages uses GitHub Actions. A push to `main` runs `.github/workflows/pages.yml`, validates catalogue references, stages only the public site assets and deploys the Pages artifact. The workflow can also be run manually. Raw research downloads, build tools and local experiments are excluded from the Pages artifact.
