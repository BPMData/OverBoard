# Roadmap

## Done: v1 (HTML overlay)

`overlay/ink_overlay.html` is a self-contained block pasted before `</body>`. Key facts for contributors:

- **Coordinates.** Ink is stored in CSS px relative to the *page column*: a band `CW` wide (widest `.page` + 96 px margin), centered in the body. The canvas spans the full window; `OX` is where the column starts inside it. This keeps ink aligned across zoom and resize.
- **Stroke format.** `{ c: color, w: width, e: 1 if eraser, h: 1 if highlight, p: [x0,y0,x1,y1,...] }`. Data is `{ v: 2, t: savedAtMs, active: "P1", periods: { P1: [strokes], ... } }`.
- **Colors.** Pen and highlighter each remember their own color (`penColor`, `hlColor`; highlighter starts yellow `#fdd835`, saved as `ink-hl-color`). Toggling the highlighter swaps between them.
- **Layers.** Pen ink on `#ink-canvas`; highlights on `#ink-hl` underneath with `mix-blend-mode: multiply`; eraser strokes cut through both.
- **Rendering.** Strokes are quadratic curves through sample midpoints, with an exponential smoothing filter on input (`SMOOTHING` level 0–8). Live drawing renders the identical curve piece by piece.
- **Input (SMART Board on macOS, observed with `tools/board-probe.html`).** Pen tip → `pointerType: "pen"`, `buttons: 1`. Palm/fist/side of hand → `"pen"` with `buttons: 32` (eraser). Finger and the pen's round end → `"mouse"`. Contact size is always 1×1. Only one pointer reaches the browser at a time. A still finger is held back by the driver until it moves.
- **Saving.** Browser `localStorage` (key `ink-v2:<path>:<title>`), plus optional File System Access write into the `<script id="ink-data">` block of the .html file.
- **Print.** `beforeprint` redraws each page's strokes as vectors at `PRINT_SCALE` onto per-page canvases.

## Done: v2 (PDF app)

`app/index.html` opens a PDF in the browser (no server, no build step; plain ES modules). Status of the original v2 plan:

1. ✅ **App shell** at `app/` (linked from the demo page): drop zone, file picker, drop anywhere, "Open again" list.
2. ✅ **Render with PDF.js** `4.10.38` from jsDelivr (pinned in `app/libs.js`). Each page is a `.pg` element sized to the page.
3. ✅ **One ink canvas per page** (plus a highlighter canvas under it, only when the page has highlights). Kept the side space: each page has a 36 pt writable gutter left and right; it doesn't export.
4. ✅ **Lazy rendering.** Page images render within 1 screen of the viewport and are freed 2 screens away; ink canvases exist only for nearby pages that have ink. Page sizes start at page 1's size and are corrected in the background.
5. ✅ **Shared code.** `shared/ink-core.js` (curve drawing, live drawing, smoothing, pen/palm/finger classification, hold-to-repeat, confirm tap) and `shared/toolbar.css` are imported by the app and inlined into the overlay by `tools/build_overlay.py` (overlay v15). The overlay is still one self-contained paste-in block.
6. ✅ **Persistence** in IndexedDB (`overboard` database: `ink` and `files` stores) keyed by the SHA-256 of the PDF bytes. **Save ink / Load ink** uses an `.overboard.json` sidecar.
7. ✅ **Export PDF** with pdf-lib `1.17.1`: strokes become vector Bézier paths in the original PDF; highlights use the Multiply blend mode under the pen ink.
8. ✅ **Page navigation:** page number box, ▲/▼ Page, and the PDF outline as a Chapters panel (current chapter marked).

Key facts for contributors:

- **Coordinates.** Ink is in PDF points measured from the top-left of the page *as shown* (PDF.js viewport at scale 1, so `/Rotate` and the crop box are already applied). Screen px = points × `zoom` (+ the gutter). Zoom never moves ink.
- **Stroke format.** v1's stroke plus `page` (1-based): `{ page, c, w, e, h, p }`, with `w` and `p` in points. Data is `{ v: 3, t, active, at: lastPage, periods: { P1: [strokes in drawing order] } }`. The sidecar wraps the same periods: `{ app: "OverBoard", kind: "pdf-ink", v: 3, pdf: { sha256, name, pages }, t, active, periods }`.
- **Sizes.** Toolbar sizes keep v1's units (1/96 in), stored as points (× 0.75), so pen and highlighter scale with the page. Eraser and palm widths are screen px ÷ zoom, so the palm feels the same at any zoom.
- **Colors.** Same as v1: `penColor` / `hlColor`, highlighter starts yellow, saved as `ink-hl-color` (shared with the overlay on the same site).
- **Clear** clears only the current page in the PDF app (Undo restores it).
- **Export.** Each page's ink is mapped back with the inverse of the PDF.js viewport transform. PDFs have no eraser, so erasers are applied geometrically on export: sample points of earlier strokes under the eraser path are dropped and the strokes split there. Only the active period is exported.
- **Memory** (measured headless at 1920×1080, devicePixelRatio 2, 320-page book): page process peaks around 640 MB while fast-scrolling, about 450 MB above the empty app, and settles near 520 MB. Each page image is capped at 12 MP.

Added after v2:

- **HTML in the app.** Dropping an `.html` worksheet makes a `Name_board.html` copy with the overlay, the same as the installer (`app/html.js` mirrors `ink_overlay_installer.py`; output is byte-identical).
- **Save ink into PDF** (opt-in, `app/embed.js`). The ink (sidecar format) is stored as the attachment `overboard-ink.json`, written as one standard incremental update after the original bytes: new embedded-file, filespec, name-tree and Names objects, a new version of the catalog, and an xref section of the same kind as the original's (table or stream) with `/Prev`. The trailer carries `/OverBoardBase <original length>`, so each save writes *original + a fresh update* (the file doesn't grow) and OverBoard hashes only the original bytes (same ink key as the plain PDF). If another app saves after us, the whole file counts as the original. Encrypted PDFs are refused. Export PDF uses the original bytes, so exports don't carry the stored ink. The chosen file handle is remembered in IndexedDB (`links` store); after a browser restart the button asks for permission again.

Left for later from v2:

- Export all periods at once (one PDF per period, or layers).
- Pinch-zoom on touch screens (trackpad pinch and the toolbar buttons work).
- Text selection / links inside the PDF (no text layer yet).
- Offline use without the CDN (vendor the two libraries or add a service worker).

## Later

- **Splitter tool**: split a PDF by its outline (chapters) or every N pages, with pdf-lib, entirely in the browser.
- **Generic touch mode** for non-SMART boards (Windows touch screens report `pointerType: "touch"` with real contact sizes, so palm detection can use `width`/`height`). Ask contributors for probe logs.
- **Word (.docx) import**, labeled experimental (e.g. docx-preview). Until then: "In Word, File → Save as PDF."
- **Highlighter opacity / redaction**: long-press the Highlighter button for an opacity control, so a dark highlight can black out answers and be erased later. Must not add toolbar clutter.
- **Large-document HTML mode**: per-`.page` canvases in the v1 overlay too, so very long HTML packets stay sharp.
