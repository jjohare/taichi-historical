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
| `--border-strong` | #7A7D73 | Borders of interactive controls (button, select, input, file-selector button); 3.7:1 on `--bg`, 3.3:1 on `--floor` |
| `--jade` | #33594D | Navigation, interactive states and rig |
| `--accent` | #A34432 | Vermilion seal and principal action |
| `--floor` | #E4E5D9 | Three-dimensional study floor |

## Typography
Georgia / Noto Serif SC / serif for display, regular weight, 30–86px, line-height 1.08. System sans-serif for body and controls, 16–18px, line-height 1.65. Compact image metadata uses 12–14px, and no text is set under 12px (control labels 14px; tags and eyebrows 12px); reading text uses 15–19px. Two font stacks; a local Noto subset supplies the five Chinese characters without remote font requests. Tabular numerals for position numbers. Negative tracking only on large headings.

## Components
Square image mounts and fine horizontal rules. Buttons have 2px corner radii and a 44px minimum target; standard buttons use 12px by 18px padding, compact panel controls 8px by 12px. Control and stack gaps follow a 4 / 8 / 12 / 16 / 24px scale. A **tab link** (the tradition navigation) is a 2px-radius link with a `--border-strong` outline, `--floor` on hover, and a 3px jade underline when current. A **callout** is a 2px left rule (jade, or accent for errors) with 14px text and 4px by 12px padding, used by evidence, the slider note and pose errors. Jade focus outlines. Links are underlined in prose. No decorative shadows. Source and evidence labels remain visible beside the associated image.

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
