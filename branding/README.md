# Whiteboat icons

Icons for OverBoard, AllAboard and OverHeard: a classroom whiteboard that has become a sailboat. The same `branding/` folder is in all three repos, so you can edit and rebuild from any of them.

## Rebuild

You need Node 18 or newer.

```bash
cd branding
npm install
npm run build
```

Then open `preview.html` in a browser to check every icon at 128, 64, 32 and 16 px, in mock browser tabs, and as one-color silhouettes.

## Where to edit

Everything is drawn by `generate-icons.mjs`. The SVGs in `src/` and everything in `exports/` are rebuilt from it, so edit the script, not the SVGs.

| Setting | What it changes |
|---|---|
| `APPS` | App names and background colors |
| `B` | The whiteboard boat: board size, mast, sail |
| `SKEW` | How far the board's top edge leans forward, like a raked prow (degrees) |
| `TILT` | How far the whole boat leans. Negative leans left; 0 is level. You can also run `TILT=0 npm run build`. |
| `WAVES` | Position of the three breaking waves |
| `COMPOSE` | Each icon's layout. AllAboard's fleet and the horizon sails are here. |

OverBoard and OverHeard use the identical boat in the identical spot. Only the sail changes.

`overheard-megaphone` is an alternate OverHeard icon (a megaphone instead of the speech-bubble flag). It is built alongside the others but not used.

## Files for each app (`exports/<app>/`)

| File | Use |
|---|---|
| `favicon.svg` | `<link rel="icon" href="favicon.svg" type="image/svg+xml">` |
| `favicon.ico` | 16, 32 and 48 px fallback favicon |
| `favicon-16.png`, `favicon-32.png` | PNG favicons. The 16 px one uses simpler art (`src/<app>-16.svg`). |
| `apple-touch-icon.png` | 180 px, iPhone and iPad home screen |
| `icon-192.png`, `icon-512.png` | Web app manifest icons |
| `icon-120.png` | Google OAuth consent-screen logo (use OverBoard's) |

`src/<app>-mono.svg` is a black-and-white check that each icon still reads without color.
