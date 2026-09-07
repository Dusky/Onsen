# App icons

The installed app's mark: a stylised silhouette of a woman in a bikini, in the
amber (`--onsen-color-amber`, `#d99a3f`) the design reserves for the live state,
on the `Midnight` ground (`#0e0f11`). Generated with the NanoGPT image API and
flattened to one solid shape, so it survives a 48px launcher the way the serif
`O` never did.

| File | Purpose |
| --- | --- |
| `onsen-256.png`, `onsen-512.png` | `purpose: "any"` — shown as drawn |
| `onsen-maskable-512.png` | `purpose: "maskable"` — the mark held inside the safe radius, so a launcher may crop it to any shape |
| `apple-touch-icon.png` | iOS home screen, which reads the `<link>` rather than the manifest |

The master is `client/public/logo.png` (the transparent amber silhouette, 58×128).
To redraw, run:

```sh
magick -size 512x512 xc:"#0e0f11" \( ../logo.png -resize 'x370' \) -gravity center -composite onsen-512.png
magick -size 256x256 xc:"#0e0f11" \( ../logo.png -resize 'x185' \) -gravity center -composite onsen-256.png
magick -size 512x512 xc:"#0e0f11" \( ../logo.png -resize 'x260' \) -gravity center -composite onsen-maskable-512.png
magick -size 180x180 xc:"#0e0f11" \( ../logo.png -resize 'x126' \) -gravity center -composite apple-touch-icon.png
```
