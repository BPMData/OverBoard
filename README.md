# OverBoard

**Smartboard ink that sticks to the page.**

![Writing an answer, circling, highlighting and graphing on a PDF worksheet, then scrolling: the ink scrolls with the page](docs/media/overboard-demo.gif)

OverBoard is a free writing layer for interactive whiteboards. Write on a worksheet with the board pen, scroll, and your ink scrolls with the page instead of floating on top of the screen. Wipe with your palm to erase. Highlight without covering the words. Save a PDF with the ink on it.

It runs in the browser. No accounts, no uploads; your ink stays on your machine.

**[Try the demo →](https://bpmdata.github.io/OverBoard/)** · **[Write on a PDF or HTML worksheet →](https://bpmdata.github.io/OverBoard/app/)**

## Why this exists

The ink tool that ships with a lot of classroom smartboards draws on a see-through layer over the whole screen. It has no idea what's underneath, so when you scroll a worksheet, the ink stays put and ends up on top of the wrong question. OverBoard draws *inside* the page, so ink always stays where you wrote it.

## Features

- **Ink that scrolls with the page**, and stays lined up when you zoom or resize the window
- **Write in the margins**: the blank space beside the page is writable too (it just doesn't print)
- **Palm eraser** on SMART Boards: wipe with your palm, fist or the side of your hand
- **Finger scrolls, pen writes**, with a toolbar switch if you lose the pen
- **Highlighter** that sits behind the printed text, so words stay readable
- **8 colors + a custom color picker**, pen size and smoothing controls (hold − / + to repeat)
- **Separate ink for each class period** (P1–P4) on the same worksheet
- **Save PDF** with crisp ink, page by page
- **PDFs too**: worksheets or whole textbooks, with a chapter list, page jump, and **Export PDF** with your ink drawn in
- **The PDF's text stays text**: select and copy it, follow its links, and search the whole book (great with OCR'd scans). Exports keep it.
- **Autosave** in the browser, plus optional **save ink into the .html file** itself (Chrome/Edge)
- **Hide the toolbar** down to a small button when you want the whole screen

## Use it on a PDF

Open **[bpmdata.github.io/OverBoard/app](https://bpmdata.github.io/OverBoard/app/)** and drop in a PDF (or tap to choose one). The PDF opens in the browser; nothing is uploaded.

- **Same toolbar** as the HTML overlay: pen, highlighter, palm eraser, finger scrolls, colors, size, smoothing, class periods P1–P4, undo.
- **Clear page** clears the page you're looking at (Undo brings it back), so a textbook's other pages are safe.
- **Big books are fine.** Only the pages near the screen are drawn, so a 600-page textbook scrolls smoothly. Type a page number in the box, or tap **Chapters** if the PDF has a table of contents.
- **Zoom** with − / Fit / +, or pinch on a trackpad. Ink stays on the page at any zoom.
- **Text and links work like a normal PDF reader** in **Scroll** mode: drag across text to select and copy it (scanned PDFs too, if they were OCR'd), tap a link in a contents page to jump there, and web links open in a new tab. In **Write** mode the pen, palm and finger work exactly as before; the text never gets in the way.
- **Find text** (File ▸ Find text…, or Ctrl/⌘+F) searches every page of the PDF, not just the ones on screen. Tap a result to jump to it.
- **Ink saves automatically** in this browser, matched to the exact PDF file. The PDF is kept too, so it's under **Open again** next time.
- **Export PDF** downloads a copy of the PDF with the current period's ink drawn in as sharp vector lines, named for the period (`Moby_Dick_annotated_P1.pdf`). Share it, print it, or post it to your class. The original text and links stay in it, so it can still be searched and copied.
- **Save ink / Load ink** moves your ink between computers as a small `.overboard.json` file. Open the same PDF on the other computer, then load (or drop) the ink file.
- **Save ink into PDF** (optional, off until you turn it on) keeps all periods' ink inside a PDF file you choose, by default a new `Name_board.pdf`. The pages aren't changed: the ink is added at the end of the file, so other apps show the plain PDF. Open that file in OverBoard on any computer and keep writing. In Chrome or Edge it then saves into the file automatically; tap the button again to stop. Other browsers get a one-time download.

Word files: in Word, choose File → Save as PDF, then open the PDF.

Everything the app needs, including the PDF reader ([PDF.js](https://mozilla.github.io/pdf.js/)) and [pdf-lib](https://pdf-lib.js.org/) for Export PDF, comes from this site (bpmdata.github.io), so it works behind school web filters that block other sites.

## Use it on your own worksheets (HTML)

**Option 1: in the browser (easiest, works on school laptops).** Open the [app](https://bpmdata.github.io/OverBoard/app/) and drop your `.html` file on it. It saves a `Name_board.html` copy with OverBoard added (or upgraded, keeping saved ink), and your original is left alone. Double-click the copy to open it. Nothing to install, so it works on locked-down Windows laptops. (If the worksheet uses pictures stored as separate files, the app tells you to keep the copy in the same folder as the original.)

**Option 2: the desktop installer**, for converting a whole folder at once. Download this repo, then double-click:

- Mac: `overlay/Ink Overlay Installer.command`
- Windows: `overlay/Ink Overlay Installer.bat` (needs [Python 3](https://www.python.org/downloads/), which many district laptops don't allow; use Option 1 instead)

Pick your `.html` files. By default the installer makes a `Name_board.html` copy for the board and leaves your original alone. If a file already has an older OverBoard, it upgrades it and keeps any ink saved inside.

From a terminal:

```bash
python3 overlay/ink_overlay_installer.py worksheet.html --open
```

**Option 3: paste it in.** Copy everything in [`overlay/ink_overlay.html`](overlay/ink_overlay.html) and paste it just before `</body>` in any HTML file.

Worksheets built from fixed-size `.page` elements (like `<div class="page">` at 8.5×11 in) get page-by-page jumping and PDF output. Other pages still work and print as one long sheet.

## For contributors

- `app/` is the PDF app: plain ES modules, served as-is (open `http://localhost:8000/app/` after `python3 -m http.server`).
- `shared/ink-core.js` (drawing, smoothing, pen/palm/finger rules, toolbar helpers) and `shared/toolbar.css` are used by both the PDF app and the overlay.
- **After editing anything in `app/` or `shared/`, run `python3 tools/build.py`.** It copies the shared code into the paste-in overlay (which must stay one self-contained file) and the demo page, and updates the app's version stamp (`app/version.json`), so browsers never mix old and new files after an update. `--check` fails if you forgot.
- **Libraries** (PDF.js, pdf-lib) live in `app/vendor/`, so the app works behind school web filters that block CDNs. Versions are pinned in `app/libs.js`; after changing one, run `python3 tools/vendor_libs.py` (downloads from npm and verifies checksums).
- **Tests** run in a real browser (Playwright): pen, palm, finger, highlighter, zoom alignment, text selection and links, search, saving, ink files, Export PDF (and that it keeps the PDF's text), Save ink into PDF, HTML board copies and the overlay.

  ```bash
  npm install
  npx playwright install chromium
  npm test
  ```

  They run on every pull request (`.github/workflows/test.yml`), along with both `--check`s. Test PDFs are in `tests/fixtures/`.

## Smartboard tips

- **Turn off the board's own ink tool** so it doesn't fight OverBoard. On a Mac with SMART software, this stops SMART Ink from starting:

  ```bash
  launchctl disable gui/$(id -u)/com.smarttech.ink
  ```

  Keep the board's **drivers** installed. They're what let OverBoard tell your palm apart from the pen.
- **Test your board** with [`tools/board-probe.html`](tools/board-probe.html). It shows what the browser (and the SMART driver, if present) report for pen, finger and palm. If OverBoard misbehaves on your board, paste the probe's log into an issue.
- Holding a finger still on some SMART Boards is swallowed by the driver until you move. Pen holds work everywhere.

## Privacy

No accounts, no uploads; your ink stays on your machine.

- OverBoard has no server. Ink, and PDFs you open in the app, are stored in your browser, and inside your own file if you choose.
- What does get downloaded: the web pages and the two open-source libraries the PDF app uses ([PDF.js](https://mozilla.github.io/pdf.js/) and [pdf-lib](https://pdf-lib.js.org/)), all from GitHub Pages (bpmdata.github.io). Your PDFs, worksheets and ink are never sent anywhere. (The board-probe diagnostic page also loads one script from cdnjs.)
- The optional desktop installer is a Python script that runs on your computer and only edits the files you pick.

## Contributing

Issues and pull requests are welcome, especially reports from boards other than SMART (Promethean, ViewSonic, Surface, iPad). Include the output of the board probe.

## License

[MIT](LICENSE). SMART Board is a trademark of SMART Technologies. OverBoard is an independent project and is not affiliated with or endorsed by them.
