# App icons

The installed app's mark (SPEC §16): a Spectral 300 `O` in `--onsen-text`
(`#e8e2d6`) on `--onsen-bg` (`#14120f`), with the red hairline the design
reserves for *live, active, now* set beneath it. The wordmark itself does not
survive a 48px launcher, so the icon keeps the two things that are unmistakably
Onsen — the serif and the red rule — and drops the rest.

| File | Purpose |
| --- | --- |
| `onsen-256.png`, `onsen-512.png` | `purpose: "any"` — shown as drawn |
| `onsen-maskable-512.png` | `purpose: "maskable"` — the mark held inside the 40% safe radius, so a launcher may crop it to any shape |
| `apple-touch-icon.png` | iOS home screen, which reads the `<link>` rather than the manifest |

These are committed rather than generated at build time: they change roughly
never, and a build step that needs a browser to draw four PNGs is a dependency
the project does not otherwise have. To redraw them, render the mark in
Chromium at 512×512 (`--headless --screenshot --window-size=512,512`) and again
at half scale (`--force-device-scale-factor=0.5`) for the 256. Chromium clamps
its window below roughly 350px, so a 192 asked for directly comes back as a
downscaled 512 with the rule cropped off — which is why the small size here is
256.
