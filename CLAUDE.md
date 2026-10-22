# OverBoard: notes for Claude

- **The PDF app (`app/`) and the HTML overlay (`overlay/ink_overlay.html`) must always have identical functionality.** The owner mainly uses the HTML overlay. Any toolbar button, shortcut or behavior added to one goes into the other in the same PR. Put shared logic in `shared/ink-core.js` / `shared/toolbar.css`, and bump the overlay version in its first line.
- After editing `app/`, `shared/` or the overlay, run `python3 tools/build.py` (CI runs `--check`).
- The toolbar must fit a 1080p board (`tests/site.spec.js`); there is about 10 px to spare, so split an existing cell rather than adding a row.
- Tests: `npm install && npx playwright install chromium && npm test`.
- Plain-language commit messages and docs; the owner is a teacher, not a full-time developer.
