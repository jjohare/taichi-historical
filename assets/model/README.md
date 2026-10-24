# Illustrative training avatar

This is an original stylised model inspired by the loose training garments visible in the [Yang Chengfu 1931 plates](https://brennantranslation.wordpress.com/2011/11/24/methods-of-applying-taiji-boxing-taiji-quan-shiyong-fa/) and [Chen Weiming supplement](https://brennantranslation.wordpress.com/2020/06/05/chen-weimings-additional-taiji-photos/). It is not a portrait, body scan, historical clothing reconstruction or DPMesh result. Colours were chosen for this site's palette; the monochrome photographs do not establish them.

The short jacket, shortened sleeves and raised trouser cuffs are deliberate visibility adaptations. The hands have four separate fingers and a thumb; the feet have distinct shoes and soles. Wrists and ankles remain exposed. The skeleton view retains hands and feet so their orientation can be inspected.

The 24 named bones use a SMPL-style hierarchy, but the geometry and rest positions were authored independently. Matching bone names alone does not establish a correct retargeting: future pose estimates need coordinate, rest-pose, scale and left/right checks.

The two sliders are isolated joint and crouch diagnostics. Neither represents a named historical movement, and catalogue navigation does not change the avatar. No recovered pose or automatic positional binding is present.

Rebuild with `tools/build_avatar.py` in Blender. The builder exports the GLB, an editable blend file, a neutral preview and a machine-generated report. `archive-avatar.glb` is the browser asset. The small model uses 24 bones, 62 mesh objects and 8,016 source vertices; glTF may split vertices at primitive boundaries.
