# Bundled typefaces

Both families are bundled rather than loaded from Google Fonts: the app is
self-hosted and expected to run on hardware without reliable outbound internet.

| Family | Role | Licence |
| --- | --- | --- |
| Spectral | The user's material — prose, titles, field content | SIL Open Font License 1.1 |
| IBM Plex Mono | The app speaking — labels, attribution, chrome | SIL Open Font License 1.1 |

Only the `latin` and `latin-ext` subsets are included. Regenerate with
`bun run scripts/fetch-fonts.ts`, which rewrites `fonts.css` alongside the
`.woff2` files.
