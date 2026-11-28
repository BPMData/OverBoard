# Plan: Split `app/main.js` into focused modules

> **For Codex 6.1 Terra:** Read `CLAUDE.md`, `docs/ARCHITECTURE.md` (the "PDF app (v2)" part) and this whole plan first. Do exactly what each step says and nothing else.
> **Behavior-preserving refactor only.** Nothing a teacher sees or does may change. Keep every DOM id, `data-act` / `data-t` / `data-tt` / `data-ta` / `data-paper` / `data-color` / `data-period` attribute, button text and tooltip, every `localStorage` / `sessionStorage` / IndexedDB key (`ink-width`, `ink-hl-width`, `ink-hl-color`, `ink-custom`, `ink-hl-mode`, `ink-hl-strength`, `ink-cover-color`, `ink-smooth`, `ink-finger`, `ob-lang`, `ob-unsaved:<hash>`, `ob-open`, `ob-timer-sound`), every keyboard shortcut (Ctrl/⌘+Z / Y / R / Shift+Z, F5 and Ctrl/⌘+Shift+R swallowed, Ctrl/⌘+F, Escape, Select's Ctrl/⌘+C / V / Delete / Backspace), the `history.state.obPdf` steps, and `window.__overboard` (`viewer`, `ink`, `doc`, `data`, `flush`), which the Playwright tests use.
> **Do not change** `shared/` (`ink-core.js`, `strings.js`, `toolbar.css`), `overlay/`, `index.html`, `app/index.html`, `app/sw.js`, `app/version.json`, or any other file in `app/` except `app/main.js`, the new files listed below and two comments in `app/ink.js` (Phase 9). `app/sw.js` and `app/version.json` change only by running `python3 tools/build.py`.
> **Keep the loading model.** The app is plain ES modules with no build step: `app/index.html` loads `main.js` with `<script type="module">` through an import map from `app/version.json`. Every new file goes in `app/` itself (not a subfolder), uses `import` / `export`, and is picked up by `tools/build.py` (it lists every `app/*.js` for the version stamp and the offline copy). Do not add a bundler, npm package, `<script>` tag or subfolder.
> **Nothing moves into or out of `shared/`.** Everything in `app/main.js` is PDF-app-only wiring; the overlay has its own copy of the toolbar wiring. Moving it into `shared/ink-core.js` would change the overlay, which is out of scope.
> **Run the checkpoint after EVERY phase**, not just at the end, and commit after each green checkpoint (one commit per phase, plain-language message, ending with the `Co-Authored-By` line the owner uses).

## Before you start

- Line numbers in this plan are from `app/main.js` at commit `0603cec` (v59, 1,829 lines). Check it is still that file:

  ```sh
  git diff --stat 0603cec -- app/main.js   # must print nothing
  ```

  If it prints anything, **stop** and ask the owner for a refreshed plan. Do not guess new line numbers.
- Phases 0 and 1 change `main.js` in place, so the numbers shift. From Phase 2 on, find each block by the **first line** quoted in this plan (or read the original with `git show 0603cec:app/main.js | sed -n 'A,Bp'`), and move the whole block as it is now.
- Work on one branch (e.g. `split-app-main`) and open **one** pull request into `main` at the end. Do not merge it.

## Goal

Break `app/main.js` (1,829 lines) into 12 focused modules of about 70–330 lines each, so a change to saving, menus, the start screen or a toolbar tool touches one small file. `main.js` ends up as a short list of imports, the `initX()` calls in their original order, and the existing "start" block.

## Why the plan has two prep phases

Two things make a straight cut-and-paste unsafe in ES modules. Phases 0 and 1 fix both while everything is still in one file, so each fix gets its own test run.

1. **An imported variable can't be assigned.** `doc`, `D`, `tr`, `dirty`, `outline` and `hasChapters` are `let`s that code in other future modules assigns (`doc = null` in `closeDoc`, `tr = obT(code)` in `setLang`, and so on). After the split that would throw `TypeError: Assignment to constant variable.` Phase 0 routes those assignments through small setter functions, which move together with the variable.
2. **Listener order and load order.** The new modules import each other in a circle (e.g. the toolbar calls open, open calls the toolbar). With circular imports, the order in which module top-level code runs is not the order of the old file, and a top-level `const` read too early throws `ReferenceError`. Several shared widgets also add `document` `keydown` / `pointerdown` and `window` `resize` / `scroll` listeners, and listeners run in the order they were added. Phase 1 moves **every top-level statement with a side effect** (creating the viewer, ink, menus, timer, settings and period picker; every `addEventListener`; `holdRepeat`; the language list fill) into `initX()` functions, called at the bottom of `main.js` **in the original order**. After that, module top levels only declare things, and the split cannot change what runs when.

## The target layout

All new files are in `app/`. "Lines" are the original (`0603cec`) line ranges that end up in each file.

| File | What it holds | Original lines |
|---|---|---|
| `state.js` | Settings constants, `tr`, `$`, toolbar/page DOM lookups, `getLS` / `setLS` / `isHex`, tool state `T` (and reading it from `localStorage`), `doc`, `D`, `findPanel`, `PDF_OPTS`, and the setters `setTr` / `setDoc` / `setInkData` | 37–131, 133–135, 146 (`findPanel` only), 511–516 |
| `core.js` | The viewer, finder, ink layer, Select and Type objects, `window.__overboard`, `setStatus`, `isOnScreen`, `initCore()` | 139–145, 146–147 (`finder` only), 148–190, 192–197, 1553–1556 |
| `saving.js` | `fresh` / `validData`, IndexedDB autosave, the `localStorage` reload backup, `rememberOpen`, `pagehide` / `visibilitychange` / `beforeunload`, Save ink into PDF, `setDirty`, `initSaving()` | 136–137, 198–277, 316–508 |
| `open.js` | Back/Forward steps (`pdfStep`, `toStart`, `popstate`, `reopen`), `showError` / `showMsg`, HTML board copies, `openFile`, `closeDoc`, `initOpen()` | 278–315, 510, 517–527, 529–739 |
| `start-screen.js` | File picker, drop zone, drag-and-drop anywhere, the Open again list (`renderRecent`), `initStartScreen()` | 741–863 |
| `page-view.js` | Chapters panel, page number box, ▲/▼ Page (`jump`), zoom, Turn page, `clearChapters`, `initPageView()` | 869, 896–1038, 1671–1705 |
| `menus.js` | Clear buttons layout (`layoutClear`), `fitToolbar`, the popout menus (File, Clear, Pages, Highlighter ▾), `closeMenus`, `initMenus()` | 865–868, 870–894, 1299–1343 |
| `tools.js` | Class period buttons, toolbar `refresh`, Type / Select / Eraser / color / size / smoothing state, the hold-to-repeat steppers, the color picker, `initPeriods()`, `initTools()` | 1040–1054, 1163–1298 |
| `settings.js` | Timer, Settings dialog, language (`translateAll`, `setLang`), `initSettings()` | 1056–1161 |
| `toolbar.js` | `onToolbarClick` (every `data-act`), Hide / Show, Chapters / Find close buttons, `openFind`, the keyboard shortcuts, Undo / Redo (`historyStep`, `refreshRedo`), `initToolbar()` | 1345–1552 |
| `notebook-ui.js` | Blank notebooks: start-screen paper buttons, add-page buttons, Pages ▸ menu, `changePages`, `initNotebook()` | 1558–1669 |
| `exporting.js` | Export PDF (with the covers warning), Save ink / Load ink (`.overboard.json`), `initExporting()` | 1707–1807 |
| `main.js` | Imports, the `initX()` calls, and the "start" block | 1–35 (rewritten), 1809–1829 |

Names to avoid: `app/export.js` already exists (the PDF writer, loaded with `import('./export.js')`), so the export UI goes in `exporting.js`; `app/notebook.js` already exists (pdf-lib page code), so the notebook UI goes in `notebook-ui.js`.

## Checkpoint (run after every phase)

```sh
npx prettier --write app/*.js        # .prettierignore keeps app/sw.js out
python3 tools/build.py               # after prettier: it hashes the files into app/version.json and app/sw.js
python3 tools/build.py --check
npx prettier --check .
# no top-level side effects in the new files (must print nothing):
grep -nE "^[A-Za-z_$][A-Za-z0-9_$.]*\.addEventListener|^holdRepeat|^for \(|^ink\.|^window\.__overboard" app/state.js app/core.js app/saving.js app/open.js app/start-screen.js app/page-view.js app/menus.js app/tools.js app/settings.js app/toolbar.js app/notebook-ui.js app/exporting.js 2>/dev/null
npx playwright test
```

(`npx playwright test` needs `npm install && npx playwright install chromium` once. If the owner prefers, push the branch and let the GitHub Actions run do the browser tests; don't start the next phase until they pass.) A missing import shows up as `ReferenceError: X is not defined` or `SyntaxError: The requested module './x.js' does not provide an export named 'X'` in the test output: fix the import line, don't change the code.

---

## Phase 0: setters for the shared variables (in place, `app/main.js` only)

No code moves. Only the assignments listed here change.

1. **Version bump.** Raise `vN` in the first line of `overlay/ink_overlay.html` by one (`<!-- ===== INK OVERLAY START (vN) =====`) above whatever `main` has at the time, and add a line under `## Unreleased` in `CHANGELOG.md`: `- **Tidier PDF app code** (vN, PDF app). app/main.js is split into smaller files. Nothing changes for teachers.` This is the only version bump for the whole PR.
2. Add these functions, each directly below the declaration it names:
   - below line 48 (`let tr = obT(obLang());`): `function setTr(t) { tr = t; }`
   - below line 135 (`let D = null;`): `function setDoc(v) { doc = v; }` and `function setInkData(v) { D = v; }`
   - below line 137 (`dirty = false;`): `function setDirty(v) { dirty = v; }`
   - below line 897 (`let outline = [];`): `function clearChapters() { outline = []; hasChapters = false; }`
3. Replace these assignments (and only these):

   | Line | Now | Becomes |
   |---|---|---|
   | 637 | `D = fromPdf ? inPdf : saved \|\| fresh();` | `setInkData(fromPdf ? inPdf : saved \|\| fresh());` |
   | 638–649 | `doc = { hash, … notebook: !!nb, };` | `setDoc({ hash, … notebook: !!nb, });` (same object literal inside) |
   | 691–692 | `doc = null;` `D = null;` | `setDoc(null);` `setInkData(null);` |
   | 712 | `dirty = true;` (in `closeDoc`) | `setDirty(true);` |
   | 721–722 | `doc = null;` `D = null;` | `setDoc(null);` `setInkData(null);` |
   | 724–725 | `outline = [];` `hasChapters = false;` | `clearChapters();` |
   | 1148 | `tr = obT(code);` | `setTr(obT(code));` |
   | 1790 | `D = data;` (in `importInk`) | `setInkData(data);` |

   Leave the other assignments to `dirty` (lines 216, 230, 238, 320, 327), `outline` (901) and `hasChapters` (909) as they are: they move into the same file as their variable.
4. Check that no other assignment is left (must print only the lines named in the note above, the declarations and the new setters):

   ```sh
   grep -nE '(^|[^.\w])(doc|D|tr|dirty|outline|hasChapters)\s*=[^=>]' app/main.js
   ```

### Phase 0 Checkpoint

Run the checkpoint. Commit: `Split main.js, step 0: setters for doc, ink data, language and save state`.

---

## Phase 1: every side effect into an `initX()` function (in place, `app/main.js` only)

Still one file. For each group below:

- declare the listed `let`s at the position of the group's first block (no initial value);
- write `function initX() { … }` at that same position, and cut the listed statements into its body **in the order listed**, unchanged except where a step says `const X =` → `X =`;
- leave every other declaration where it is.

Then, directly above the `/* ---------- start ---------- */` comment (line 1809), call the init functions in exactly this order:

```js
initCore();
initOpen();
initSaving();
initStartScreen();
initPageView();
initPeriods();
initSettings();
initTools();
initMenus();
initToolbar();
initNotebook();
initExporting();
```

This is the order the statements run in today, so every listener is still added in the same order.

The groups (original line numbers):

1. **`initCore`** — `let viewer, finder, ink, typing;`
   - 139–145: `const viewer = new Viewer(pagesEl, {` … `});` → `viewer = new Viewer(pagesEl, {` … `});`
   - 146–147: split `const findPanel = $('#ob-find'), finder = new Finder(…);` into `const findPanel = $('#ob-find');` (stays at top level, above the `let`) and, in the body, `finder = new Finder(viewer, findPanel, setStatus, () => tr);`
   - 148–151: `const ink = new Ink(` → `ink = new Ink(`
   - 152 (`ink.onTextCopied = …`), 153 (`ink.attach(pagesEl);`), 154–168 (the Select comment and `ink.sel = makeSelect({…});`)
   - 169–179: `const typing = (ink.typing = makeTyping({` … `}));` → `typing = ink.typing = makeTyping({` … `});` (Prettier may put the parentheses back; keep whatever `npx prettier --write` produces)
   - 180–190: `window.__overboard = {…}; // for tests and the curious`
2. **`initOpen`** — 297–308: the `window.addEventListener('popstate', …)` listener.
3. **`initSaving`** — 316–324 (`pagehide`), 325–331 (`visibilitychange`), 332–337 (`beforeunload`, with its trailing comment), 469–493 (`dlg.addEventListener('click', …)`). Put the function where line 469 was.
4. **`initStartScreen`** — 741–744 (`$('#ob-file').addEventListener('change', …)`), 746–751 (`dropZone.addEventListener('keydown', …)`), 778–783 (`dropZone.addEventListener('click', …)`), 788–794 (`dragenter`), 795–801 (`dragleave`), 802 (`dragover`), 803–817 (`drop`). `const dropZone`, `const cover`, `let dragDepth` and `function chooseFile` stay at top level.
5. **`initPageView`** — 968–979 (`scroll`), 985–990, 991, 992 (the three `pageInput` listeners), 1016–1025 (`wheel`), 1027–1038 (`resize`). `let scrollRaf` and `let resizeRaf` stay at top level.
6. **`initPeriods`** — `let periodPicker;` — 1042–1051: `const periodPicker = makePeriodPicker(` → `periodPicker = makePeriodPicker(`.
7. **`initSettings`** — `let timer, settings;`
   - 1058–1068: `const timer = makeTimer({` → `timer = makeTimer({`
   - 1071–1128: `const settings = makeSettings({` → `settings = makeSettings({`
   - 1132 (`for (const [code, name] of obLangs()) langPick.append(…);`), 1133 (`langPick.addEventListener('change', …)`)
   - `const SOUND_KEY` and `const langPick` stay at top level.
8. **`initTools`** — 1281–1282 (the `for … of Object.entries(STEPPERS)` `holdRepeat` loop), 1283–1287 and 1288–1292 (the zoom-in / zoom-out `holdRepeat`s), 1294–1298 (`picker.addEventListener('input', …)`). `const STEPPERS` stays at top level.
9. **`initMenus`** — `let clearMenu, pageMenu, hlMenu, showFileMenu;` and, on its own line, `let file, placeFileMenu;`
   - 1301–1302: split `const fileMenu = $('#ob-filemenu'), clearMenu = makePopMenu(…);` into `const fileMenu = $('#ob-filemenu');` (top level) and, in the body, `clearMenu = makePopMenu($('#ob-clearmenu'), $('[data-act="clear"]', bar), bar, () => closeMenus('clear'));`
   - 1303: `const pageMenu =` → `pageMenu =`
   - 1304: `const file =` → `file =`
   - 1305–1306: `const placeFileMenu = file.place, showFileMenu = file.show;` → `placeFileMenu = file.place;` `showFileMenu = file.show;`
   - 1315–1333: the two Highlighter comment lines, then `const hlMenu = makeHlMenu(` → `hlMenu = makeHlMenu(`
   - 1334–1343: the `for (const m of [fileMenu, clearMenu.el]) m.addEventListener('click', …)` loop
   - `function closeMenus` (1307–1314) stays at top level.
10. **`initToolbar`** — 1345 (`bar.addEventListener('click', onToolbarClick);`), 1507–1515 (`showBtn.addEventListener`), 1516–1518 (`toc-close`), 1519 (`find-close`), 1526–1542 (`document.addEventListener('keydown', …)`).
11. **`initNotebook`** — 1586 (`for (const b of blankBtns) …`), 1644–1647 (the `addPageEl` paper buttons loop), 1648–1669 (`pageMenu.el.addEventListener('click', …)`). `const blankBtns` and `let paging` stay at top level.
12. **`initExporting`** — 1803–1807 (`$('#ob-inkfile').addEventListener('change', …)`).

Left at top level on purpose: the `T` block that reads `localStorage` (112–131, it only reads storage and must run before everything else, as now) and the whole "start" block (1809–1829).

Check (must print nothing; every listener is now inside a function):

```sh
grep -nE "^[A-Za-z_$][A-Za-z0-9_$.()'\"#\[\]= -]*\.addEventListener|^holdRepeat|^for \(|^ink\.|^window\.__overboard|^const [a-zA-Z]+ = (new |make)" app/main.js
```

### Phase 1 Checkpoint

Run the checkpoint. Commit: `Split main.js, step 1: start-up code in init functions, same order`.

---

## How to do each move (Phases 2–8)

For every new file in a phase:

1. Create the file with a one-line header comment (given in the phase), then the import block given in the phase, then the blocks listed for it, **cut from `main.js` and pasted in their original order**, unchanged.
2. Put `export` in front of each declaration named in the file's **Exports** line (`export function`, `export async function`, `export const`, `export let`). Do not export anything else. Do not rename anything.
3. Some imports in a phase come `from './main.js'`: those names have not moved yet. Put `export` in front of each of those declarations in `main.js` (the phase lists them). Later phases move them out, and the last check makes sure no `./main.js` import is left.
4. Replace the whole import block at the top of `main.js` with the one given in the phase (keep the two header comment lines).
5. For each earlier file the phase lists as "(update)", replace its import block with the one given.

Import order inside a block doesn't matter to the browser; use the order given so diffs stay readable. Prettier will wrap long import lines.

The **Exports** line of each file is final: it doesn't change in later phases.

---

## Phase 2: `app/state.js`

Header: `// The PDF app's settings, shared state and the toolbar's page elements (used by every other app/ module).`

Blocks, in this order:

- 37–131: from `/* ===== SETTINGS (same meaning as in the overlay) ===== */` through the end of the `T` block (`T.penColor = T.color = startPen(PEN_COLOR);` `}`), including `let tr` and the `setTr` added in Phase 0. (The `T` block stays a bare top-level `{ … }` block: it only reads `localStorage`.)
- 133–135 plus `setDoc` / `setInkData`: `/* ---------- the open document ---------- */`, `let doc = null;`, `let D = null;` and the two setters. (`let saveTimer = null, dirty = false;` and `setDirty` stay in `main.js` for Phase 3.)
- `const findPanel = $('#ob-find');` (split off in Phase 1)
- 511–516: `const PDF_OPTS = {` … `};`

Imports:

```js
import { obLang, obT } from '../shared/strings.js';
import { hlInk, startPen } from '../shared/ink-core.js';
import { PDFJS_CMAPS_URL, PDFJS_FONTS_URL } from './libs.js';
```

Exports: **every** top-level declaration in this file (it is the shared-state module): `PERIODS`, `SAVE_DELAY_MS`, `PDF_SAVE_DELAY_MS`, `FINGER_SCROLLS`, `PALM_ERASER_W`, `ERASER_W`, `SMOOTHING`, `HIGHLIGHT_COLOR`, `HIGHLIGHT_W`, `HIGHLIGHT_STRENGTH`, `tr`, `setTr`, `PEN_COLOR`, `COVER_COLOR`, `$`, `bar`, `showBtn`, `statusEl`, `periodsEl`, `pagesEl`, `pageInput`, `pagesTotal`, `picker`, `customFill`, `sizeNum`, `sizeDot`, `smoothNum`, `pagesBtn`, `addPageEl`, `toc`, `tocBtn`, `fitBtn`, `getLS`, `setLS`, `isHex`, `T`, `doc`, `setDoc`, `D`, `setInkData`, `findPanel`, `PDF_OPTS`. (For a `const a = …, b = …;` list, one `export` in front of `const` exports all of them.)

`main.js` import block after Phase 2:

```js
import { obLangs, obT, obTranslate } from '../shared/strings.js';
import { confirmTap, fitTools, flashBtn, historyKey, holdRepeat, loadPeriods, makeHlMenu, makePeriodPicker, makePopMenu, makeSelect, makeSettings, makeTimer, makeTyping, paletteColors, remapPeriods, setPalette, showLaser } from '../shared/ink-core.js';
import { loadPdfjs, pdfWorker, dropPdfWorker, warmPdfjs } from './libs.js';
import { Viewer } from './viewer.js';
import { Ink, PT_PER_UNIT } from './ink.js';
import { Finder } from './find.js';
import * as store from './store.js';
import { isHtml, boardName, addOverlay, layoutWarnings, localFiles, saveBoardCopy } from './html.js';
import { findBase, readEmbeddedInk, inspectBase, buildUpdate, writeInto } from './embed.js';
import { setupOffline } from './offline.js';
import { isImage, imageToPdf, IMG_RE, stripExt } from './image.js';
import { NB_RE, newNotebook, addPage, removePage, shiftInk, shiftTurns } from './notebook.js';
import { $, addPageEl, bar, COVER_COLOR, customFill, D, doc, findPanel, FINGER_SCROLLS, fitBtn, HIGHLIGHT_COLOR, HIGHLIGHT_STRENGTH, HIGHLIGHT_W, pageInput, pagesBtn, pagesEl, pagesTotal, PDF_OPTS, PDF_SAVE_DELAY_MS, PEN_COLOR, PERIODS, periodsEl, picker, SAVE_DELAY_MS, setDoc, setInkData, setLS, setTr, showBtn, sizeDot, sizeNum, SMOOTHING, smoothNum, statusEl, T, toc, tocBtn, tr } from './state.js';
```

`main.js` exports needed: none.

### Phase 2 Checkpoint

Run the checkpoint. Commit: `Split main.js, step 2: settings and shared state in app/state.js`.

---

## Phase 3: `app/core.js` and `app/saving.js`

### `app/core.js`

Header: `// The PDF app's main objects: the page viewer, the ink layer, Find, Select and Type, plus the status line.`

Blocks, in this order:

- `let viewer, finder, ink, typing;` and `function initCore() { … }` (from Phase 1; original 139–190)
- 192–197: `function setStatus(msg) {` … `}`
- 1553–1556: `function isOnScreen(n) {` … `}`

Imports:

```js
import { makeSelect, makeTyping } from '../shared/ink-core.js';
import { Finder } from './find.js';
import { Ink, PT_PER_UNIT } from './ink.js';
import { Viewer } from './viewer.js';
import { markDirty, writeNow } from './saving.js';
import { D, doc, findPanel, pagesEl, statusEl, T, tr } from './state.js';
import { closeMenus, fitToolbar, refreshRedo } from './main.js';
```

Exports: `viewer`, `finder`, `ink`, `typing`, `initCore`, `setStatus`, `isOnScreen`.

### `app/saving.js`

Header: `// Keeping the ink: the browser's copy (IndexedDB, plus a localStorage backup on the way out) and "Save ink into PDF".`

Blocks, in this order:

- 136–137 plus `setDirty`: `let saveTimer = null, dirty = false;` and `function setDirty(v) { dirty = v; }`
- 198–277: from `function fresh() {` through `function rememberOpen(hash) {` … `}` (includes `validData`, `/* ---------- saving (IndexedDB, keyed by the PDF's SHA-256) ---------- */`, `markDirty`, `writeNow`, the backup comment, `const BACKUP = 'ob-unsaved:', OPEN_KEY = 'ob-open';`, `backupNow`, `dropBackup`, `readBackup`)
- 339–508: from `/* ---------- "Save ink into PDF" (opt-in): …` through `async function reconnectLink() {` … `}`, with `function initSaving() { … }` (from Phase 1) where line 469 was

Imports:

```js
import { confirmTap, flashBtn, loadPeriods } from '../shared/ink-core.js';
import { buildUpdate, inspectBase, writeInto } from './embed.js';
import { stripExt } from './image.js';
import * as store from './store.js';
import { setStatus, viewer } from './core.js';
import { $, D, doc, PDF_SAVE_DELAY_MS, PERIODS, SAVE_DELAY_MS, tr } from './state.js';
```

Exports: `setDirty`, `fresh`, `validData`, `markDirty`, `writeNow`, `OPEN_KEY`, `dropBackup`, `readBackup`, `rememberOpen`, `refreshLink`, `baseBlob`, `writePdf`, `onLinkButton`, `reconnectLink`, `initSaving`. (`OPEN_KEY` shares one `const` with `BACKUP`; `export const BACKUP = …, OPEN_KEY = …;` exports both, which is fine. Leave `let saveTimer = null, dirty = false;` unexported.)

### `main.js` after Phase 3

Put `export` on: `closeMenus`, `fitToolbar`, `refreshRedo`.

Import block:

```js
import { obLangs, obT, obTranslate } from '../shared/strings.js';
import { confirmTap, fitTools, flashBtn, historyKey, holdRepeat, makeHlMenu, makePeriodPicker, makePopMenu, makeSettings, makeTimer, paletteColors, remapPeriods, setPalette, showLaser } from '../shared/ink-core.js';
import { findBase, readEmbeddedInk } from './embed.js';
import { addOverlay, boardName, isHtml, layoutWarnings, localFiles, saveBoardCopy } from './html.js';
import { imageToPdf, IMG_RE, isImage, stripExt } from './image.js';
import { dropPdfWorker, loadPdfjs, pdfWorker, warmPdfjs } from './libs.js';
import { addPage, NB_RE, newNotebook, removePage, shiftInk, shiftTurns } from './notebook.js';
import { setupOffline } from './offline.js';
import * as store from './store.js';
import { finder, initCore, ink, isOnScreen, setStatus, typing, viewer } from './core.js';
import { baseBlob, dropBackup, fresh, initSaving, markDirty, onLinkButton, OPEN_KEY, readBackup, reconnectLink, refreshLink, rememberOpen, setDirty, validData, writeNow, writePdf } from './saving.js';
import { $, addPageEl, bar, COVER_COLOR, customFill, D, doc, findPanel, FINGER_SCROLLS, fitBtn, HIGHLIGHT_COLOR, HIGHLIGHT_STRENGTH, HIGHLIGHT_W, pageInput, pagesBtn, pagesEl, pagesTotal, PDF_OPTS, PEN_COLOR, PERIODS, periodsEl, picker, setDoc, setInkData, setLS, setTr, showBtn, sizeDot, sizeNum, SMOOTHING, smoothNum, T, toc, tocBtn, tr } from './state.js';
```

### Phase 3 Checkpoint

Run the checkpoint. Commit: `Split main.js, step 3: app/core.js and app/saving.js`.

---

## Phase 4: `app/open.js` and `app/start-screen.js`

### `app/open.js`

Header: `// Opening and closing a document: PDFs, pictures, HTML worksheets (board copies), and the browser's Back / Forward steps.`

Blocks, in this order:

- 278–315: from `/* The browser's Back button: …` through `async function reopen(hash) {` … `}`, with `function initOpen() { … }` (from Phase 1) where the `popstate` listener was
- 510: `/* ---------- opening a PDF ---------- */`
- 517–527: `const errorEl = $('#ob-error');`, `function showError`, `const msgEl = $('#ob-msg');`, `function showMsg`
- 529–739: from `/* an .html worksheet: make a board copy with the overlay, like the installer */` through `async function closeDoc(showStart = true) {` … `}`

Imports:

```js
import { findBase, readEmbeddedInk } from './embed.js';
import { addOverlay, boardName, isHtml, layoutWarnings, localFiles, saveBoardCopy } from './html.js';
import { imageToPdf, IMG_RE, isImage, stripExt } from './image.js';
import { dropPdfWorker, loadPdfjs, pdfWorker } from './libs.js';
import { NB_RE } from './notebook.js';
import * as store from './store.js';
import { finder, ink, setStatus, viewer } from './core.js';
import { dropBackup, fresh, readBackup, reconnectLink, refreshLink, rememberOpen, setDirty, validData, writeNow, writePdf } from './saving.js';
import { renderRecent } from './start-screen.js';
import { $, addPageEl, bar, D, doc, pagesTotal, PDF_OPTS, setDoc, setInkData, showBtn, toc, tr } from './state.js';
import { clearChapters, fitSpace, fitToolbar, layoutClear, loadOutline, pageMenu, refresh, refreshRedo, renderPeriods } from './main.js';
```

Exports: `inPdfStep`, `toStart`, `reopen`, `initOpen`, `showError`, `openFile`.

### `app/start-screen.js`

Header: `// The start screen: choosing or dropping a file, and the "Open again" list.`

Blocks, in this order: 741–863, from the `#ob-file` change listener (now inside `initStartScreen`) through `async function renderRecent() {` … `}`: `function initStartScreen() { … }`, `const dropZone`, `chooseFile`, `const cover`, `let dragDepth`, `/* ---------- recent files ---------- */`, `renderRecent`.

Imports:

```js
import * as store from './store.js';
import { openFile, showError } from './open.js';
import { $, doc, tr } from './state.js';
import { importInk } from './main.js';
```

Exports: `initStartScreen`, `renderRecent`.

### `main.js` after Phase 4

Put `export` on: `clearChapters`, `closeMenus`, `fitSpace`, `fitToolbar`, `importInk`, `layoutClear`, `loadOutline`, `pageMenu` (it is in `let clearMenu, pageMenu, hlMenu, showFileMenu;`, so that line becomes `export let …`), `refresh`, `refreshRedo`, `renderPeriods`.

Import block:

```js
import { obLangs, obT, obTranslate } from '../shared/strings.js';
import { confirmTap, fitTools, flashBtn, historyKey, holdRepeat, makeHlMenu, makePeriodPicker, makePopMenu, makeSettings, makeTimer, paletteColors, remapPeriods, setPalette, showLaser } from '../shared/ink-core.js';
import { stripExt } from './image.js';
import { loadPdfjs, pdfWorker, warmPdfjs } from './libs.js';
import { addPage, newNotebook, removePage, shiftInk, shiftTurns } from './notebook.js';
import { setupOffline } from './offline.js';
import * as store from './store.js';
import { finder, initCore, ink, isOnScreen, setStatus, typing, viewer } from './core.js';
import { initOpen, inPdfStep, openFile, reopen, showError, toStart } from './open.js';
import { baseBlob, initSaving, markDirty, onLinkButton, OPEN_KEY, refreshLink, writeNow } from './saving.js';
import { initStartScreen, renderRecent } from './start-screen.js';
import { $, addPageEl, bar, COVER_COLOR, customFill, D, doc, findPanel, FINGER_SCROLLS, fitBtn, HIGHLIGHT_COLOR, HIGHLIGHT_STRENGTH, HIGHLIGHT_W, pageInput, pagesBtn, pagesEl, pagesTotal, PDF_OPTS, PEN_COLOR, PERIODS, periodsEl, picker, setInkData, setLS, setTr, showBtn, sizeDot, sizeNum, SMOOTHING, smoothNum, T, toc, tocBtn, tr } from './state.js';
```

### Phase 4 Checkpoint

Run the checkpoint. Commit: `Split main.js, step 4: app/open.js and app/start-screen.js`.

---

## Phase 5: `app/page-view.js` and `app/menus.js`

### `app/page-view.js`

Header: `// Moving around the document: Chapters, the page number box, ▲ / ▼ Page, zoom and Turn page.`

Blocks, in this order:

- 869: `let hasChapters = false;`
- 896–1038: from `/* ---------- chapters (PDF outline) ---------- */` through the `/* ---------- zoom ---------- */` section (`ZOOM_100`, `fitSpace`, `zoomBy`, `refreshZoom`, `let resizeRaf`), including `let outline`, the `clearChapters` added in Phase 0, `loadOutline`, `markChapter`, `toggleToc`, `/* ---------- page number box ---------- */`, `let scrollRaf`, `goToTyped`, `jump`, and `function initPageView() { … }` from Phase 1
- 1671–1705: from `/* ---------- Turn page (for PDFs scanned or saved upside down or sideways) ----------` through `async function turnPages(all) {` … `}`

Imports:

```js
import { finder, ink, setStatus, viewer } from './core.js';
import { fitToolbar, layoutClear } from './menus.js';
import { markDirty } from './saving.js';
import { $, bar, D, doc, findPanel, fitBtn, pageInput, toc, tr } from './state.js';
import { refreshRedo } from './main.js';
```

Exports: `hasChapters`, `clearChapters`, `loadOutline`, `toggleToc`, `jump`, `fitSpace`, `zoomBy`, `refreshZoom`, `turnPages`, `initPageView`.

### `app/menus.js`

Header: `// The popout menus beside the toolbar (Settings & help, Clear, Pages, Highlighter ▾) and fitting the toolbar to the screen.`

Blocks, in this order:

- 865–868 and 870–894: the `/* ---------- the Clear buttons ----------` comment, `function layoutClear() {` … `}`, the `/* the toolbar and its popouts shrink to fit … */` comment and `const fitToolbar = () => …;` (without line 869, which went to `page-view.js`)
- 1299–1343: from `/* Popout menus beside the toolbar. …` through `function closeMenus(except) {` … `}`: `const fileMenu`, `let clearMenu, pageMenu, hlMenu, showFileMenu;`, `let file, placeFileMenu;`, `function initMenus() { … }` from Phase 1 (it holds the menus, the Highlighter menu and the menu click loop), `closeMenus`

Imports:

```js
import { fitTools, makeHlMenu, makePopMenu } from '../shared/ink-core.js';
import { ink } from './core.js';
import { hasChapters } from './page-view.js';
import { $, bar, doc, pagesBtn, setLS, T, tocBtn, tr } from './state.js';
import { onToolbarClick, periodPicker, refresh, selectOff, toolColor, typeOff } from './main.js';
```

Exports: `layoutClear`, `fitToolbar`, `fileMenu`, `clearMenu`, `pageMenu`, `hlMenu`, `showFileMenu`, `closeMenus`, `initMenus`. Write the `let` lines as `export let clearMenu, pageMenu, hlMenu, showFileMenu;` and `let file, placeFileMenu;` (not exported).

### Updated imports in earlier files

`app/core.js`:

```js
import { makeSelect, makeTyping } from '../shared/ink-core.js';
import { Finder } from './find.js';
import { Ink, PT_PER_UNIT } from './ink.js';
import { Viewer } from './viewer.js';
import { closeMenus, fitToolbar } from './menus.js';
import { markDirty, writeNow } from './saving.js';
import { D, doc, findPanel, pagesEl, statusEl, T, tr } from './state.js';
import { refreshRedo } from './main.js';
```

`app/open.js`:

```js
import { findBase, readEmbeddedInk } from './embed.js';
import { addOverlay, boardName, isHtml, layoutWarnings, localFiles, saveBoardCopy } from './html.js';
import { imageToPdf, IMG_RE, isImage, stripExt } from './image.js';
import { dropPdfWorker, loadPdfjs, pdfWorker } from './libs.js';
import { NB_RE } from './notebook.js';
import * as store from './store.js';
import { finder, ink, setStatus, viewer } from './core.js';
import { fitToolbar, layoutClear, pageMenu } from './menus.js';
import { clearChapters, fitSpace, loadOutline } from './page-view.js';
import { dropBackup, fresh, readBackup, reconnectLink, refreshLink, rememberOpen, setDirty, validData, writeNow, writePdf } from './saving.js';
import { renderRecent } from './start-screen.js';
import { $, addPageEl, bar, D, doc, pagesTotal, PDF_OPTS, setDoc, setInkData, showBtn, toc, tr } from './state.js';
import { refresh, refreshRedo, renderPeriods } from './main.js';
```

### `main.js` after Phase 5

Put `export` on: `importInk`, `onToolbarClick`, `periodPicker` (`export let periodPicker;`), `refresh`, `refreshRedo`, `renderPeriods`, `selectOff`, `toolColor`, `typeOff`. (`closeMenus`, `fitToolbar`, `layoutClear`, `pageMenu`, `clearChapters`, `fitSpace`, `loadOutline` have left `main.js`.)

Import block:

```js
import { obLangs, obT, obTranslate } from '../shared/strings.js';
import { confirmTap, flashBtn, historyKey, holdRepeat, makePeriodPicker, makeSettings, makeTimer, paletteColors, remapPeriods, setPalette, showLaser } from '../shared/ink-core.js';
import { stripExt } from './image.js';
import { loadPdfjs, pdfWorker, warmPdfjs } from './libs.js';
import { addPage, newNotebook, removePage, shiftInk, shiftTurns } from './notebook.js';
import { setupOffline } from './offline.js';
import * as store from './store.js';
import { finder, initCore, ink, isOnScreen, setStatus, typing, viewer } from './core.js';
import { clearMenu, closeMenus, fileMenu, fitToolbar, hlMenu, initMenus, layoutClear, pageMenu, showFileMenu } from './menus.js';
import { initOpen, inPdfStep, openFile, reopen, showError, toStart } from './open.js';
import { fitSpace, initPageView, jump, refreshZoom, toggleToc, turnPages, zoomBy } from './page-view.js';
import { baseBlob, initSaving, markDirty, onLinkButton, OPEN_KEY, refreshLink, writeNow } from './saving.js';
import { initStartScreen, renderRecent } from './start-screen.js';
import { $, addPageEl, bar, COVER_COLOR, customFill, D, doc, findPanel, FINGER_SCROLLS, HIGHLIGHT_COLOR, HIGHLIGHT_STRENGTH, HIGHLIGHT_W, pageInput, pagesBtn, pagesEl, pagesTotal, PDF_OPTS, PEN_COLOR, PERIODS, periodsEl, picker, setInkData, setLS, setTr, showBtn, sizeDot, sizeNum, SMOOTHING, smoothNum, T, toc, tr } from './state.js';
```

### Phase 5 Checkpoint

Run the checkpoint. Commit: `Split main.js, step 5: app/page-view.js and app/menus.js`.

---

## Phase 6: `app/tools.js` and `app/settings.js`

### `app/tools.js`

Header: `// The drawing tools on the toolbar: pen, highlighter, eraser, Select, Type, colors, size, smoothing and class periods.`

Blocks, in this order:

- 1040–1054: `/* ---------- class periods ---------- */`, its comment, `let periodPicker;`, `function initPeriods() { … }` (from Phase 1), `function renderPeriods() {` … `}`
- 1163–1298: from `/* ---------- toolbar ---------- */` through `function initTools() { … }` from Phase 1 (it comes right after `const STEPPERS`), including `isPreset`, `refresh`, `typeOff`, `typeOn`, `selectOff`, `toolColor`, `laserReady`, `tapColor`, `pickColor`, `stepSize`, `stepSmooth`, `STEPPERS`

Imports:

```js
import { holdRepeat, makePeriodPicker, setPalette, showLaser } from '../shared/ink-core.js';
import { ink, setStatus, typing, viewer } from './core.js';
import { closeMenus, hlMenu } from './menus.js';
import { refreshZoom, zoomBy } from './page-view.js';
import { $, bar, customFill, D, pagesEl, periodsEl, picker, setLS, sizeDot, sizeNum, smoothNum, T, tr } from './state.js';
```

Exports: `periodPicker`, `initPeriods`, `renderPeriods`, `refresh`, `typeOff`, `typeOn`, `selectOff`, `toolColor`, `tapColor`, `pickColor`, `STEPPERS`, `initTools`.

### `app/settings.js`

Header: `// Settings & help ▸ Settings…, the Timer and the language list (all shared with the overlay through shared/ink-core.js).`

Blocks, in this order: 1056–1161, from `/* ---------- ⏱ Timer (shared with the overlay). …` through `function setLang(code) {` … `}`: `const SOUND_KEY`, `let timer, settings;`, `function initSettings() { … }` (from Phase 1), the `/* ---------- File ▸ Settings… …` and language comments, `const langPick`, `translateAll`, `setLang`.

Imports:

```js
import { obLangs, obT, obTranslate } from '../shared/strings.js';
import { makeSettings, makeTimer, paletteColors, remapPeriods } from '../shared/ink-core.js';
import * as store from './store.js';
import { ink, setStatus, typing } from './core.js';
import { closeMenus, fitToolbar, layoutClear } from './menus.js';
import { refreshZoom } from './page-view.js';
import { refreshLink } from './saving.js';
import { renderRecent } from './start-screen.js';
import { $, bar, COVER_COLOR, D, doc, FINGER_SCROLLS, HIGHLIGHT_COLOR, HIGHLIGHT_STRENGTH, HIGHLIGHT_W, pagesBtn, pagesTotal, PEN_COLOR, PERIODS, setTr, SMOOTHING, T, tr } from './state.js';
import { refresh, renderPeriods, toolColor } from './tools.js';
import { refreshRedo } from './main.js';
```

Exports: `timer`, `settings`, `initSettings`, `translateAll`.

### Updated imports in earlier files

`app/open.js`: same as Phase 5, except that its last line (`import { refresh, refreshRedo, renderPeriods } from './main.js';`) is replaced by these two:

```js
import { refresh, renderPeriods } from './tools.js';
import { refreshRedo } from './main.js';
```

`app/menus.js`:

```js
import { fitTools, makeHlMenu, makePopMenu } from '../shared/ink-core.js';
import { ink } from './core.js';
import { hasChapters } from './page-view.js';
import { $, bar, doc, pagesBtn, setLS, T, tocBtn, tr } from './state.js';
import { periodPicker, refresh, selectOff, toolColor, typeOff } from './tools.js';
import { onToolbarClick } from './main.js';
```

### `main.js` after Phase 6

Put `export` on: `importInk`, `onToolbarClick`, `refreshRedo`.

Import block:

```js
import { confirmTap, flashBtn, historyKey } from '../shared/ink-core.js';
import { stripExt } from './image.js';
import { loadPdfjs, pdfWorker, warmPdfjs } from './libs.js';
import { addPage, newNotebook, removePage, shiftInk, shiftTurns } from './notebook.js';
import { setupOffline } from './offline.js';
import * as store from './store.js';
import { finder, initCore, ink, isOnScreen, setStatus, typing, viewer } from './core.js';
import { clearMenu, closeMenus, fileMenu, fitToolbar, initMenus, layoutClear, pageMenu, showFileMenu } from './menus.js';
import { initOpen, inPdfStep, openFile, reopen, showError, toStart } from './open.js';
import { fitSpace, initPageView, jump, toggleToc, turnPages, zoomBy } from './page-view.js';
import { baseBlob, initSaving, markDirty, onLinkButton, OPEN_KEY, writeNow } from './saving.js';
import { initSettings, settings, timer, translateAll } from './settings.js';
import { initStartScreen, renderRecent } from './start-screen.js';
import { $, addPageEl, bar, D, doc, findPanel, pageInput, pagesTotal, PDF_OPTS, picker, setInkData, setLS, showBtn, T, toc, tr } from './state.js';
import { initPeriods, initTools, pickColor, refresh, renderPeriods, selectOff, STEPPERS, tapColor, toolColor, typeOff, typeOn } from './tools.js';
```

### Phase 6 Checkpoint

Run the checkpoint. Commit: `Split main.js, step 6: app/tools.js and app/settings.js`.

---

## Phase 7: `app/toolbar.js`

Header: `// What each toolbar and menu button does (data-act), the keyboard shortcuts, and Undo / Redo.`

Blocks, in this order: 1345–1552, from `function initToolbar() { … }` (Phase 1; it replaced `bar.addEventListener('click', onToolbarClick);`) through `function refreshRedo() {` … `}`: `onToolbarClick`, `openFind`, `historyStep`, `const redoBtn`, `refreshRedo`. (`isOnScreen` already went to `core.js`.)

Imports:

```js
import { confirmTap, historyKey } from '../shared/ink-core.js';
import { finder, ink, isOnScreen, setStatus, typing, viewer } from './core.js';
import { clearMenu, closeMenus, fileMenu, fitToolbar, layoutClear, pageMenu, showFileMenu } from './menus.js';
import { toStart } from './open.js';
import { fitSpace, jump, toggleToc, turnPages, zoomBy } from './page-view.js';
import { onLinkButton } from './saving.js';
import { settings, timer } from './settings.js';
import { $, bar, D, doc, findPanel, picker, setLS, showBtn, T, toc, tr } from './state.js';
import { pickColor, refresh, renderPeriods, selectOff, STEPPERS, tapColor, toolColor, typeOff, typeOn } from './tools.js';
import { exportPdf, saveInkFile } from './main.js';
```

Exports: `initToolbar`, `onToolbarClick`, `refreshRedo`.

### Updated imports in earlier files

In each of these, change `import { refreshRedo } from './main.js';` to `import { refreshRedo } from './toolbar.js';`: `app/core.js`, `app/open.js`, `app/page-view.js`, `app/settings.js`. In `app/menus.js`, change `import { onToolbarClick } from './main.js';` to `import { onToolbarClick } from './toolbar.js';`.

### `main.js` after Phase 7

Put `export` on: `exportPdf`, `importInk`, `saveInkFile`.

Import block:

```js
import { confirmTap, flashBtn } from '../shared/ink-core.js';
import { stripExt } from './image.js';
import { loadPdfjs, pdfWorker, warmPdfjs } from './libs.js';
import { addPage, newNotebook, removePage, shiftInk, shiftTurns } from './notebook.js';
import { setupOffline } from './offline.js';
import * as store from './store.js';
import { finder, initCore, ink, setStatus, viewer } from './core.js';
import { fitToolbar, initMenus, layoutClear, pageMenu } from './menus.js';
import { initOpen, inPdfStep, openFile, reopen, showError } from './open.js';
import { initPageView } from './page-view.js';
import { baseBlob, initSaving, markDirty, OPEN_KEY, writeNow } from './saving.js';
import { initSettings, translateAll } from './settings.js';
import { initStartScreen, renderRecent } from './start-screen.js';
import { $, addPageEl, D, doc, pageInput, pagesTotal, PDF_OPTS, setInkData, tr } from './state.js';
import { initToolbar, refreshRedo } from './toolbar.js';
import { initPeriods, initTools, refresh, renderPeriods } from './tools.js';
```

### Phase 7 Checkpoint

Run the checkpoint. Commit: `Split main.js, step 7: app/toolbar.js`.

---

## Phase 8: `app/notebook-ui.js` and `app/exporting.js`

### `app/notebook-ui.js`

Header: `// Blank notebooks: the start screen's paper buttons, adding and removing pages (the PDF work is in app/notebook.js).`

Blocks, in this order: 1558–1669, from `/* ---------- blank notebooks (app/notebook.js) ---------- */` through `function removeThisPage() {` … `}`: `notebookName`, `startBlank`, `const blankBtns`, `function initNotebook() { … }` (from Phase 1, where the `blankBtns` loop was), `let paging`, `changePages`, `addPageAfter`, `removeThisPage`.

Imports:

```js
import { confirmTap, flashBtn } from '../shared/ink-core.js';
import { loadPdfjs, pdfWorker } from './libs.js';
import { addPage, newNotebook, removePage, shiftInk, shiftTurns } from './notebook.js';
import * as store from './store.js';
import { finder, ink, setStatus, viewer } from './core.js';
import { fitToolbar, layoutClear, pageMenu } from './menus.js';
import { openFile, showError } from './open.js';
import { baseBlob, markDirty } from './saving.js';
import { addPageEl, D, doc, pageInput, pagesTotal, PDF_OPTS, tr } from './state.js';
import { refreshRedo } from './toolbar.js';
```

Exports: `initNotebook`. Only `main.js` imports this file; keep it that way.

### `app/exporting.js`

Header: `// Export PDF (with the warning about covers) and the .overboard.json ink file (Save ink / Load ink).`

Blocks, in this order: 1707–1807, from `/* ---------- export annotated PDF ---------- */` through `function initExporting() { … }` (from Phase 1): `baseName`, `exportName`, `const coverWarn`, `ask`, `exportPdf`, `/* ---------- ink sidecar file (.overboard.json) ---------- */`, `saveInkFile`, `importInk`, `initExporting`. Keep `await import('./export.js')` exactly as it is (same folder, so the path still works).

Imports:

```js
import { flashBtn } from '../shared/ink-core.js';
import { stripExt } from './image.js';
import * as store from './store.js';
import { ink, setStatus, viewer } from './core.js';
import { markDirty, writeNow } from './saving.js';
import { $, D, doc, setInkData, tr } from './state.js';
import { refreshRedo } from './toolbar.js';
import { refresh, renderPeriods } from './tools.js';
```

Exports: `exportPdf`, `saveInkFile`, `importInk`, `initExporting`.

### Updated imports in earlier files

- `app/start-screen.js`: `import { importInk } from './main.js';` → `import { importInk } from './exporting.js';`
- `app/toolbar.js`: `import { exportPdf, saveInkFile } from './main.js';` → `import { exportPdf, saveInkFile } from './exporting.js';`

### `main.js` after Phase 8

`main.js` now holds only: the two header comment lines, the import block below, the twelve `initX();` calls from Phase 1 (same order), and the original "start" block (1809–1829) unchanged. It exports nothing.

```js
import { warmPdfjs } from './libs.js';
import { setupOffline } from './offline.js';
import { initCore } from './core.js';
import { initExporting } from './exporting.js';
import { initMenus } from './menus.js';
import { initNotebook } from './notebook-ui.js';
import { initOpen, inPdfStep, openFile, reopen } from './open.js';
import { initPageView } from './page-view.js';
import { initSaving, OPEN_KEY } from './saving.js';
import { initSettings, translateAll } from './settings.js';
import { initStartScreen, renderRecent } from './start-screen.js';
import { doc } from './state.js';
import { initToolbar } from './toolbar.js';
import { initPeriods, initTools, refresh } from './tools.js';
```

Checks (each must print nothing):

```sh
grep -n "from './main.js'" app/*.js
grep -n "^export" app/main.js
```

### Phase 8 Checkpoint

Run the checkpoint. Commit: `Split main.js, step 8: app/notebook-ui.js and app/exporting.js`.

---

## Phase 9: docs and final check

1. `app/ink.js` lines 45–46: in the two comments, change `set by main.js` to `set by core.js`. No code change.
2. `docs/ARCHITECTURE.md`, in "The PDF app (v2)", after the "Key facts for contributors" list, add a short list headed `Where the PDF app's code is` with one line per file from "The target layout" table (file name and what it holds), plus: `Start-up: main.js calls each file's initX() in a fixed order, so menus, shortcuts and listeners are set up in the same order every time. A new feature's start-up code goes in its file's initX(), not at the top level.`
3. `docs/ROADMAP.md`: delete the `**Split app/main.js**` line under "Later".
4. Run the final checks:

   ```sh
   wc -l app/main.js app/state.js app/core.js app/saving.js app/open.js app/start-screen.js app/page-view.js app/menus.js app/tools.js app/settings.js app/toolbar.js app/notebook-ui.js app/exporting.js
   git diff --stat main -- shared/ overlay/ index.html app/index.html   # only overlay/ink_overlay.html and index.html (version number) and app/index.html (version stamp) may change
   ```

   `main.js` should be about 60 lines and no other file over about 350.

### Phase 9 Checkpoint

Run the checkpoint. Commit: `Split main.js, step 9: docs`. Push the branch and open **one** pull request into `main` titled `vN: split app/main.js into smaller files (no changes for teachers)`, listing the new files. Do not merge it.

---

## If something goes wrong

- **`ReferenceError: X is not defined`** in a test: the file using `X` is missing it in its import line. Look up who exports `X` in the **Exports** lines above and add it to that import. Don't move code to fix it.
- **`does not provide an export named 'X'`**: the file named in the message is missing `export` on `X`, or `X` is imported from the wrong file. Check the **Exports** lines.
- **`Assignment to constant variable`**: an assignment from Phase 0's table was missed. Use the setter.
- **`Cannot access 'X' before initialization`**: a statement with a side effect was left at a module's top level. Move it into that file's `initX()` (see Phase 1).
- **A test about menus, Escape, the toolbar or shortcuts fails** but nothing errors: an `initX()` call is out of order, or a block landed in the wrong `initX()`. Compare with the Phase 1 lists.
- Anything else: stop and ask the owner. Don't change behavior to make a test pass.
