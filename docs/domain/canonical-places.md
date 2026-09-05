# Canonical Places

This file is the single source of truth for the Blomzip Studio canonical courtyard place registry.

The registry is intentionally small and stable. It defines the authoritative place ids used by Vision Engine, archive storage, Entry Review, publishing, and downstream Story use.

## Canonical registry

| Stable id | Display name | Accepted aliases |
|---|---|---|
| `parking` | Parking Edge — needs reassignment | none |
| `raised-bed` | The Raised Beds | none |
| `seating-area` | The Seating Area | Sittplatsen vid häcken |
| `central-lawn` | The Lawn | none |
| `shade-corner` | The Shade Corner | none |
| `rock-garden` | The Rock Garden | none |
| `garden-border` | The Garden Border | none |
| `house-wall` | The Bicycle Trellis Bed | Rabatt vid husvägg |
| `entrance` | Under the Pine | none |
| `parking-trellis` | The Parking Trellis | none |
| `miriams-bed` | Miriam's Bed | none |
| `compost-area` | The Compost Area | none |
| `garden-arch` | The Garden Arch | Portalen |
| `under-maple` | Under the Maple | none |
| `parking-peninsula` | The Parking Peninsula | none |

## Rules

- The stable ids above are the canonical ids. They are the only ids new place assignments should use.
- Accepted aliases are case-insensitive and whitespace-tolerant.
- Image-content labels are not places.
- `Bukett från innergården` and `Courtyard / grönska` are image-content labels and are intentionally excluded from the canonical place registry.
- Inspiration is a future image kind, not a canonical courtyard place.
- `house-wall` and `entrance` were renamed to `The Bicycle Trellis Bed` and `Under the Pine` respectively; their stable ids and existing assignments are unchanged.
- `parking` currently mixes photographs from two distinct places (the future `parking-trellis` and `miriams-bed`). Its label reflects this pending manual reassignment; it is not automatically split.

## Compatibility

- The temporary demo-derived place ids are not canonical.
- `courtyard-rabatt-vid-husvagg` maps to `house-wall`.
- `courtyard-sittplatsen-vid-hacken` maps to `seating-area`.
- The content-label ids `courtyard-bukett-fran-innergarden` and `courtyard-gronska` have no canonical place target and must be re-reviewed or cleared if they exist in old archives.