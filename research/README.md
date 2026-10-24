# Sources, identification and limits

This is a historical image study. It describes the pattern as documented in these records, not a universal modern teaching standard. Taijiquan continues to evolve; present-day teachers may use different names, sequences, alignments and explanations.

## Primary records

- [Yang Chengfu, *Methods of Applying Taiji Boxing*, published 1931](https://brennantranslation.wordpress.com/2011/11/24/methods-of-applying-taiji-boxing-taiji-quan-shiyong-fa/): 122 solo photographs. [Photo registry](yang-1931.tsv) records the source URL and numbered section for each plate. Publication year is not an asserted exposure date.
- [Chen Weiming, *Additional Taiji Photos*, published 1933](https://brennantranslation.wordpress.com/2020/06/05/chen-weimings-additional-taiji-photos/): the introduction dates the photographs to 1932. The web presentation reuses images across its sequence; [the registry](chen-1933.tsv) identifies 118 distinct caption-numbered images.
- [Matthias Wagner, *Yang Chengfu Form*, 2010](https://commons.wikimedia.org/wiki/File:Yang_Chengfu_Form.jpg): 104 modern pencil drawings, **not 104 historical photographs**. Author credit: Matthias Wagner, Baden-Baden. [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Changes: individual panels cropped, CMYK converted to sRGB PNG; no stretching, mirroring, retouching or reconstructed limbs. Original montage retained at the repository root.
- [Yang Family association forms worksheet, 2020 edition](https://yangfamilytaichi.com/wp-content/uploads/2021/03/Forms-Worksheets_2020_.pdf): modern 103-movement sequence used to check the supplied names. It is a comparative reference, not a claim that the historical manuals share its exact counting system.

Historical scans are accessed through Paul Brennan's translation pages, which are linked throughout. The modern English translations are not reproduced wholesale. No blanket licence is asserted for all externally sourced material. The drawing licence and Three.js MIT licence are preserved separately.

## Sequence reconciliation

The repository provides `moves.md`, not `names.md`. It contains 103 entries numbered 0–54 and 56–103. Local 0–54 correspond to official 1–55; numbering agrees from 56 onwards. The absent local 55 is therefore a numbering discontinuity, not a missing named posture. The original file is unchanged.

The montage is a visual sequence with expanded compound actions and condensed repeats. Every one of its 104 panels is accounted for in [move-map.tsv](move-map.tsv). Mapping does not assume one panel per named entry.

- Panel 1 is standing preparation. Panel 2 is ward-off, not Opening. No separate moving Opening panel survives here.
- Three Cloud Hands entries can share one representative panel. Reused Repulse Monkey and Parting Mane references are marked.
- Four Shuttle directions belong to one supplied entry.
- Final Cross Hands has no distinct montage panel; an earlier image is explicitly reused.
- Closing and Return share the standing endpoint; no intermediate frame has been invented.
- Golden Rooster labels can name either the standing or raised leg. Local 70 stands on the left, with the right knee lifted; local 71 reverses this. Chen's caption numbers 185 and 186 have image URLs with the opposite suffix. The caption and visible leg position take precedence over the filename.
- Yang's Cross Kick and Chen's pressing-kick example remain a variant comparison. The White Snake comparison has different placement in Chen's sequence. These are not labelled exact mechanical equivalents.

## Lineage

The Chen supplement explicitly compares his photographs with Yang Chengfu's, giving direct historical context for a Yang-lineage comparison. Resemblance to a posture in Chee Soo's Lee style is insufficient to identify the pictured sequence as Lee style. This catalogue does not combine Lee-style instruction with Yang-lineage imagery.

## What the notes mean

Position notes describe visible relationships. Transitions combine sequence order with explicitly interpretive reading between still images. Application studies are editorial possibilities, not recovered quotations, demonstrated partner techniques or unique authoritative meanings. Name notes retain traditional titles without inventing origin legends.

Breathing and attention notes are present-day editorial suggestions. They do not prescribe a fixed inhale/exhale for each move. For broader teaching context, see [Yang Family journal 31](https://www.journals.yangfamilytaichi.com/journal-31.pdf) and [journal 28](https://www.journals.yangfamilytaichi.com/journal-28.pdf). Those later teaching sources are distinct from the historical photographic evidence.

## Reproduction

Run `cargo run --manifest-path tools/catalogue/Cargo.toml` from the repository root with ImageMagick installed. The generator reads the names, reviewed mapping, family notes and source registries, converts photographs at their native dimensions, writes one directory per entry, and emits the site's catalogue JSON. [Panel bounds](panel-bounds.txt) are in row order: `y x WIDTHxHEIGHT+X+Y`, measured in original pixels. Final images retain native proportions; display previews may scale proportionately.

The neutral viewer rig is an illustrative spatial aid, independent of the selected image. It contains no estimated historical pose. Any later DPMesh output must remain identifiable as an estimate and be visually reviewed before use as a navigation-linked pose.
