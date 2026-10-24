# Yang form — design system

## Visual theme and atmosphere
A quiet historical image archive, with the spacing of a museum catalogue and the colours of paper, ink and jade. Evidence and legibility lead the design.

## Colour palette and roles

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | #F4F0E6 | Warm paper background |
| `--surface` | #FBF8F0 | Image and reading surfaces |
| `--fg` | #252E2A | Ink text |
| `--muted` | #62685E | Secondary text |
| `--border` | #CECDBF | Rules and frames |
| `--jade` | #33594D | Navigation, interactive states and rig |
| `--accent` | #A34432 | Vermilion seal and principal action |
| `--floor` | #E4E5D9 | Three-dimensional study floor |

## Typography
Georgia / Noto Serif CJK SC / serif for display, regular weight, 30–76px, line-height 1.08. System sans-serif for body and controls, 16–18px, line-height 1.65. Captions 14px minimum. Two font stacks; no remote font requests. Tabular numerals for position numbers. Negative tracking only on large headings.

## Components
Square image mounts and fine horizontal rules. Buttons have 2px corner radii, 12px by 18px padding and a 44px minimum target. Jade focus outlines. Links are underlined in prose. No decorative shadows. Source and evidence labels remain visible beside the associated image.

## Layout
Maximum width 1440px, 36px desktop gutters. Asymmetric opening followed by an archive index and a two-column study spread. Reading width 65 characters. Section spacing 72px desktop, 40px mobile. The rig occupies a separate study panel, independent of the catalogue selection.

## Depth
Flat surfaces throughout. Depth belongs to the photographs and the three-dimensional viewer, not the interface chrome.

## Do and avoid
Use real drawings, original photographic proportions, generous margins and explicit provenance. Avoid ornamental dragons, decorative calligraphy, invented historical claims, gradients, stock imagery and dashboard-style statistic cards.

## Responsive behaviour
At 920px the study spread becomes a single column. At 600px the archive becomes two columns and the heading scale reduces. No horizontal page scrolling. Viewer buttons provide a keyboard alternative to dragging. Respect reduced motion; no automatic rotation.

## Agent guidance
All colours use CSS tokens. Keep the historical scope statement near the top. Never imply the neutral rig demonstrates the selected movement. Never present editorial practice suggestions as quotations or recovered historical instructions.
