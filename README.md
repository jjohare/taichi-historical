# The Yang long form

A static historical image archive for [GitHub Pages](https://jjohare.github.io/yang-form/): 103 named entries, 104 extracted drawings and photographic comparisons from Yang Chengfu and Chen Weiming.

The landing page explains the historical scope and the possibility of differences in modern teaching. Every position includes source links, mapping qualifications and editorial notes. The orbitable Three.js rig is independent of the selected position.

## Browse locally

Serve the repository root over HTTP, for example `python -m http.server 8080`, then open `http://localhost:8080`. No frontend build or CDN is required; Three.js 0.186.1 and OrbitControls are vendored with their MIT licence.

## Rebuild the catalogue

With Rust and ImageMagick installed:

```sh
cargo run --manifest-path tools/catalogue/Cargo.toml
node tools/check-site.mjs
```

`moves.md` preserves the supplied numbering and spelling. `research/move-map.tsv` is the explicit correspondence table; `research/position-notes.tsv` holds the editorial notes. `poses/` contains one directory per named entry, with PNGs and a README. See [sources and method](research/README.md) for image attribution, historical differences and interpretation limits.

## Publishing

GitHub Pages uses GitHub Actions. A push to `main` runs `.github/workflows/pages.yml`, validates catalogue references, stages only the public site assets and deploys the Pages artifact. The workflow can also be run manually. Raw research downloads, build tools and local experiments are excluded from the Pages artifact.
