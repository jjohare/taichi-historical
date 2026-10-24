# Lee main hand form: research and integration

Scope: Chee Soo’s main hand form only. The dance / Flying Hands, weapons, Feng Shou, dietary and therapeutic systems are outside this catalogue. Research checked 24 October 2026.

## What the evidence supports

- Chee Soo’s edited April 1992 interview with John R. Jones states a 140-movement main form, separately from Flying Hands. The available document is a 2005 TAO reprint, not the original recording. [Interview, page 2](https://www.taoistarts.org/wp-content/uploads/2012/08/interview_with_chee_soo.pdf).
- Seahorse lists English book editions in 1976, 1984 and 2003. It describes its reprint as preserving the Aquarian edition’s photographs, text and pagination. Publication dates are not exposure dates. [Bibliography](https://seahorsebooks.co.uk/chee-soo-biography/) · [Current edition](https://www.seahorsebooks.co.uk/product/the-chinese-art-of-tai-chi-chuan-by-chee-soo/).
- The [West Yorkshire Tai Chi index](https://westyorkshiretaichi.weebly.com/videos.html) supplies a complete ordered series of 41 lessons spanning 1–140. [Angie Wood’s course list](https://taichiworkshops.co.uk/tai-chi-shop/) corroborates the 42 named sets, with separate gathering and finishing entries. The factual name/range index is in `sequence-index.json`.
- [Tony Swanson’s later interview](https://www.ffaemc.fr/yimag/tony-swanson-presente-le-taichi-chuan-style-li/) corroborates 140 movements / 42 sequences and the first 50 movements / 15 sets as the opening teaching division. Later divisions in a particular commercial course are not treated as ancient structural divisions.
- Gibbon’s freely distributed photographic manual covers the first five sets. The unaltered PDF and visual checks are documented in [the media register](../sources/README.md).
- Concise movement descriptions are attributed to Gibbon, Wood or Ewers. Detailed spoken video instruction has not been transcribed or independently verified. The complete set of lessons is linked for further exploration.

## Differences retained

| Issue | Evidence | Catalogue decision |
| --- | --- | --- |
| Final two sets | West Yorkshire combines movements 138–140; Wood lists Gathering and Finish separately, without numbered boundary | Both entries retain the shared range. No assumed 138–139 / 140 split. |
| Count variant | An [archived TAO page](https://community.fortunecity.ws/westwood/carving/737/business/tao/taichi.htm) states 142 / 41 | Record the conflict; do not merge it into the attributed 140 index. |
| Stork spelling | Wood’s set 9 page says “Stalk”; West Yorkshire says “Stork” | Display Stork and record the difference. |
| Double Whip palms | Ewers recollects upright versus downward-facing palms in different periods | Attributed comparison, not an adjudicated historical chronology. |
| Play the Guitar | Ewers distinguishes palm orientation and arm level across versions | Preserve Gibbon and Ewers as separate records. |
| Tiger withdrawal | Gibbon labels Duck; Ewers describes Monkey | Keep the source’s own stance name. |
| Cobra / Large Snake | Related wording appears in Ewers’s writing, but numbered correspondence not established | Do not claim a pose match. |
| Similar Yang names | Bird’s Tail, Brush Knee, Monkey and Whip names recur | No cross-style pose mapping inferred from a title or silhouette. |

Earlier lineage claims are recorded as tradition and personal testimony. This research has not independently established the ancient genealogy or identified documentation authenticating Chan Lee. [Carl Pearson’s discussion](https://carlpearson.org/faqs/) is relevant practitioner commentary, not conclusive proof either way. Modern “Lee”, “Li” and “Lishi” labels require attention to the particular teacher; they do not guarantee identical execution.

## Evidence limits

Historical pose matching remains unverified for every entry. Full Chee Soo book plates and reuse permission would be needed before creating a historical image catalogue or binding meshes to it. The catalogue contains no fabricated historic photographs, movement endpoints, application lineage, Chinese names, organ correspondences or breath assignments.

Sets 11, 12, 13, 16 and 27 have a named lesson but lack sufficiently verified detailed written mechanics in this research. Other later summaries are deliberately brief, and are not complete instruction. Most sets have no verified sequence-specific historical martial application. The interface explicitly identifies these gaps. Attention prompts are editorial observation aids; they are not attributed to Chee Soo. Form-wide breathing notes are attributed to Gibbon only.

This is a complete navigation and source index, with uneven explanatory evidence. It is not a complete historical reconstruction or a claim to have exhausted every archive.

### Source availability

The source ledger records retrieval problems as well as authorship. On 24 October 2026, direct publisher requests returned HTTP 503; the TAO interview PDF returned HTTP 404 despite its two pages being readable through the search index; and the FFAEMC article redirected to the federation homepage despite its article text remaining indexed. These records support attributed historical discussion but should not be described as reliably available live downloads. A [5 January 2026 publisher biography snapshot](https://web.archive.org/web/20260105142505/https://www.seahorsebooks.co.uk/chee-soo-biography/) is listed as available by the Internet Archive. Current teaching sources and Gibbon’s original PDF returned HTTP 200.

## Updating the site

Edit `sequence-index.json`, `annotations.json` and `sources.json`, then run from the repository root:

```sh
cargo run --manifest-path tools/catalogue/Cargo.toml --bin lee_catalogue
node tools/check-lee.mjs
node tools/check-site.mjs
```

The Rust generator produces `lee/catalogue.json`, `lee/sequence.html` and one static entry directory for each of the 42 named sets. Shared closing ranges are intentional; they must not be counted as six separate numbered movements. All source URLs and kinds remain available in the JSON ledger.
