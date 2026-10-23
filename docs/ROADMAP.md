# Roadmap

What's planned next, most useful first. How things work today is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Next

- **Native speakers check the machine translations** (`shared/strings.js`, and the two emails in `tools/report-relay.gs`), Tagalog and Arabic first.
- **Generic touch mode** for non-SMART boards (Windows touch screens report `pointerType: "touch"` with real contact sizes, so palm detection can use `width`/`height`). Board reports should bring in the data for this.
- **Pinch-zoom on touch screens** (trackpad pinch and the toolbar buttons work).
- **Export all periods at once** (one PDF per period, or layers).

## Later

- **Splitter tool**: split a PDF by its outline (chapters) or every N pages, with pdf-lib, entirely in the browser.
- **Word (.docx) import**, labeled experimental (e.g. docx-preview). Until then: "In Word, File → Save as PDF."
- **"Remove covered text" export** (opt-in, clearly labeled, original file untouched): would need rewriting page content streams to drop text under covers. Until then: print on paper to hand out answer-free copies.
- **Large-document HTML mode**: per-`.page` canvases in the overlay too, so very long HTML packets stay sharp.
- **Split `app/main.js`** (about 820 lines): move the menus and the start screen into their own modules the next time a feature touches them.
