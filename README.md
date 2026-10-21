# OverBoard

**Smartboard ink that sticks to the page.**

OverBoard is a free writing layer for interactive whiteboards. Write on a worksheet with the board pen, scroll, and your ink scrolls with the page instead of floating on top of the screen. Wipe with your palm to erase. Highlight without covering the words. Save a PDF with the ink on it.

It runs in the browser, needs no account, and nothing leaves your computer.

**[Try the demo →](https://bpmdata.github.io/OverBoard/)** · **[Write on a PDF →](https://bpmdata.github.io/OverBoard/app/)**

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
- **Autosave** in the browser, plus optional **save ink into the .html file** itself (Chrome/Edge)
- **Hide the toolbar** down to a small button when you want the whole screen

## Use it on a PDF

Open **[bpmdata.github.io/OverBoard/app](https://bpmdata.github.io/OverBoard/app/)** and drop in a PDF (or tap to choose one). The PDF opens in the browser; nothing is uploaded.

- **Same toolbar** as the HTML overlay: pen, highlighter, palm eraser, finger scrolls, colors, size, smoothing, class periods P1–P4, undo.
- **Clear page** clears the page you're looking at (Undo brings it back), so a textbook's other pages are safe.
- **Big books are fine.** Only the pages near the screen are drawn, so a 600-page textbook scrolls smoothly. Type a page number in the box, or tap **Chapters** if the PDF has a table of contents.
- **Zoom** with − / Fit / +, or pinch on a trackpad. Ink stays on the page at any zoom.
- **Ink saves automatically** in this browser, matched to the exact PDF file. The PDF is kept too, so it's under **Open again** next time.
- **Export PDF** downloads a copy of the PDF with the current period's ink drawn in as sharp vector lines, named for the period (`Moby_Dick_annotated_P1.pdf`). Share it, print it, or post it to your class.
- **Save ink / Load ink** moves your ink between computers as a small `.overboard.json` file. Open the same PDF on the other computer, then load (or drop) the ink file.

Word files: in Word, choose File → Save as PDF, then open the PDF.

The app needs an internet connection the first time it loads, to fetch the PDF reader ([PDF.js](https://mozilla.github.io/pdf.js/)) and, for Export PDF, [pdf-lib](https://pdf-lib.js.org/), both from jsDelivr.

## Use it on your own worksheets (HTML)

**Option 1: the installer (easiest).** Download this repo, then double-click:

- Mac: `overlay/Ink Overlay Installer.command`
- Windows: `overlay/Ink Overlay Installer.bat` (needs [Python 3](https://www.python.org/downloads/); tick "Add python.exe to PATH")

Pick your `.html` files. By default the installer makes a `Name_board.html` copy for the board and leaves your original alone. If a file already has an older OverBoard, it upgrades it and keeps any ink saved inside.

From a terminal:

```bash
python3 overlay/ink_overlay_installer.py worksheet.html --open
```

**Option 2: paste it in.** Copy everything in [`overlay/ink_overlay.html`](overlay/ink_overlay.html) and paste it just before `</body>` in any HTML file.

Worksheets built from fixed-size `.page` elements (like `<div class="page">` at 8.5×11 in) get page-by-page jumping and PDF output. Other pages still work and print as one long sheet.

## For contributors

- `app/` is the PDF app: plain ES modules, no build step. Library versions are pinned in `app/libs.js`.
- `shared/ink-core.js` (drawing, smoothing, pen/palm/finger rules, toolbar helpers) and `shared/toolbar.css` are used by both the PDF app and the overlay. The overlay must stay one paste-in file, so after editing them run:

  ```bash
  python3 tools/build_overlay.py          # copies them into overlay/ink_overlay.html and the demo page
  python3 tools/build_overlay.py --check  # fails if something is out of date
  ```

## Smartboard tips

- **Turn off the board's own ink tool** so it doesn't fight OverBoard. On a Mac with SMART software, this stops SMART Ink from starting:

  ```bash
  launchctl disable gui/$(id -u)/com.smarttech.ink
  ```

  Keep the board's **drivers** installed. They're what let OverBoard tell your palm apart from the pen.
- **Test your board** with [`tools/board-probe.html`](tools/board-probe.html). It shows what the browser (and the SMART driver, if present) report for pen, finger and palm. If OverBoard misbehaves on your board, paste the probe's log into an issue.
- Holding a finger still on some SMART Boards is swallowed by the driver until you move. Pen holds work everywhere.

## Privacy

OverBoard has no server. Ink (and PDFs you open in the app) are stored in your browser (and, if you choose, inside your own file). Nothing is uploaded. The PDF app downloads its two open-source libraries from jsDelivr; your files never go anywhere.

## Contributing

Issues and pull requests are welcome, especially reports from boards other than SMART (Promethean, ViewSonic, Surface, iPad). Include the output of the board probe.

## License

[MIT](LICENSE). SMART Board is a trademark of SMART Technologies. OverBoard is an independent project and is not affiliated with or endorsed by them.
