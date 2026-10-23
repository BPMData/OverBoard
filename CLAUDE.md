# OverBoard: notes for Claude

- **The PDF app (`app/`) and the HTML overlay (`overlay/ink_overlay.html`) should work the same wherever the document type allows.** The owner mainly uses the HTML overlay. Any toolbar button, shortcut or behavior added to one goes into the other in the same PR. Put shared logic in `shared/ink-core.js` / `shared/toolbar.css`.
- **Every PR bumps the version number** (`vN` in the first line of `overlay/ink_overlay.html`), even if the overlay itself didn't change. It's one number for the whole project: `tools/build.py` copies it to the app's start screen (bottom, grey) so the owner can tell the newest version loaded, and CI fails if it didn't go up.
  - Differences the owner has approved, because the documents differ: only PDFs have **Chapters** (and Find text, Export PDF, Save ink into PDF, ink files); so a PDF with chapters shows **Chapters | Clear ▸** (a This page / All pages menu), while the overlay and a PDF without chapters show **Clear page | Clear all**. The overlay keeps ▲ Page / ▼ Page and its own Settings & help ▸ items (Save PDF, Save ink into file, Change linked file).
  - If a new difference seems needed, ask the owner first.
- **All words the teacher sees go in `shared/strings.js`**, in all 8 languages (English, Spanish, Mandarin, Tagalog, Vietnamese, French, Brazilian Portuguese, Arabic). Mark HTML with `data-t` (text), `data-tt` (tooltip), `data-ta` (aria-label); in JS use `tr('key', { vars })`. Every toolbar control needs a tooltip. Check that each language still fits a 1080p board (`tests/i18n.spec.js`).
- After editing `app/`, `shared/` or the overlay, run `python3 tools/build.py` (CI runs `--check`).
- The toolbar must fit a 1080p board (`tests/site.spec.js`); there is about 10 px to spare, so split an existing cell rather than adding a row.
- Tests: `npm install && npx playwright install chromium && npm test`.
- Plain-language commit messages and docs; the owner is a teacher, not a full-time developer.
