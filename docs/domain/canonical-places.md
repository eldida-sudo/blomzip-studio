# Canonical Places

This file is the single source of truth for the Blomzip Studio canonical courtyard place registry.

The registry is intentionally small and stable. It defines the authoritative place ids used by Vision Engine, archive storage, Entry Review, publishing, and downstream Story use.

## Canonical registry

| Stable id | Display name | Accepted aliases |
|---|---|---|
| `parking` | The Parking Edge | none |
| `raised-bed` | The Raised Beds | none |
| `seating-area` | The Seating Area | Sittplatsen vid häcken |
| `central-lawn` | The Lawn | none |
| `shade-corner` | The Shade Corner | none |
| `rock-garden` | The Rock Garden | none |
| `garden-border` | The Garden Border | none |
| `house-wall` | The House Wall | Rabatt vid husvägg |
| `entrance` | The Entrance | none |

## Rules

- The stable ids above are the canonical ids. They are the only ids new place assignments should use.
- Accepted aliases are case-insensitive and whitespace-tolerant.
- Image-content labels are not places.
- `Bukett från innergården` and `Courtyard / grönska` are image-content labels and are intentionally excluded from the canonical place registry.
- Inspiration is a future image kind, not a canonical courtyard place.

## Compatibility

- The temporary demo-derived place ids are not canonical.
- `courtyard-rabatt-vid-husvagg` maps to `house-wall`.
- `courtyard-sittplatsen-vid-hacken` maps to `seating-area`.
- The content-label ids `courtyard-bukett-fran-innergarden` and `courtyard-gronska` have no canonical place target and must be re-reviewed or cleared if they exist in old archives.