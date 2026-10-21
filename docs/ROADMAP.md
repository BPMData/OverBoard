# Roadmap

## Done: v1 (HTML overlay)

`overlay/ink_overlay.html` is a self-contained block pasted before `</body>`. Key facts for contributors:

- **Coordinates.** Ink is stored in CSS px relative to the *page column*: a band `CW` wide (widest `.page` + 96 px margin), centered in the body. The canvas spans the full window; `OX` is where the column starts inside it. This keeps ink aligned across zoom and resize.
- **Stroke format.** `{ c: color, w: width, e: 1 if eraser, h: 1 if highlight, p: [x0,y0,x1,y1,...] }`. Data is `{ v: 2, t: savedAtMs, active: "P1", periods: { P1: [strokes], ... } }`.
- **Layers.** Pen ink on `#ink-canvas`; highlights on `#ink-hl` underneath with `mix-blend-mode: multiply`; eraser strokes cut through both.
- **Rendering.** Strokes are quadratic curves through sample midpoints, with an exponential smoothing filter on input (`SMOOTHING` level 0–8). Live drawing renders the identical curve piece by piece.
- **Input (SMART Board on macOS, observed with `tools/board-probe.html`).** Pen tip → `pointerType: "pen"`, `buttons: 1`. Palm/fist/side of hand → `"pen"` with `buttons: 32` (eraser). Finger and the pen's round end → `"mouse"`. Contact size is always 1×1. Only one pointer reaches the browser at a time. A still finger is held back by the driver until it moves.
- **Saving.** Browser `localStorage` (key `ink-v2:<path>:<title>`), plus optional File System Access write into the `<script id="ink-data">` block of the .html file.
- **Print.** `beforeprint` redraws each page's strokes as vectors at `PRINT_SCALE` onto per-page canvases.

## Next: v2, the PDF viewer (main project)

Goal: a teacher opens the GitHub Pages site, drops in a PDF (worksheet or whole textbook), and annotates it on the board with the same toolbar and behavior as v1.

1. **App shell** at `app/index.html` (linked from the demo page): drop zone / file picker, no build step required (plain ES modules; libraries from a pinned CDN version).
2. **Render with PDF.js** (pinned version). Each PDF page becomes a `.page` element sized to the page's aspect ratio.
3. **One ink canvas per page** instead of one giant canvas. Strokes store `{ page: n, ... }` with coordinates in *page units* (fraction of page width, or PDF points) so zoom changes never misalign ink. Keep the margin/side-space idea if practical (a per-page gutter), or drop it for PDFs.
4. **Lazy rendering for books.** Only render the PDF page images and ink canvases for pages within ~2 screens of the viewport (IntersectionObserver); free the rest. A 600-page book must scroll smoothly and stay under ~500 MB of memory.
5. **Reuse the v1 toolbar and input logic.** Factor the shared parts (toolbar, input handling, smoothing, palm/finger rules, periods) out of `ink_overlay.html` into a module both v1 and v2 can use, without breaking the paste-in snippet (the snippet can stay a generated, self-contained build artifact).
6. **Persistence.** Key ink by a hash of the PDF file (SHA-256 of the bytes, or of the first few MB + size). Store in IndexedDB (not localStorage: books are big). **Export / import ink** as a small `.overboard.json` sidecar file.
7. **Export annotated PDF** with pdf-lib: draw each page's strokes into the original PDF as vector paths (highlights with multiply blend or opacity), so the result is small and crisp. This is the headline teacher feature.
8. **Page navigation** for long documents: page number box, jump to page, and the PDF's outline (chapters) in a side list.

## Later

- **Splitter tool**: split a PDF by its outline (chapters) or every N pages, with pdf-lib, entirely in the browser.
- **Generic touch mode** for non-SMART boards (Windows touch screens report `pointerType: "touch"` with real contact sizes, so palm detection can use `width`/`height`). Ask contributors for probe logs.
- **Word (.docx) import**, labeled experimental (e.g. docx-preview). Until then: "In Word, File → Save as PDF."
- **Large-document HTML mode**: per-`.page` canvases in the v1 overlay too, so very long HTML packets stay sharp.
