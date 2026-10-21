# OverBoard

**Smartboard ink that sticks to the page.**

OverBoard is a free writing layer for interactive whiteboards. Write on a worksheet with the board pen, scroll, and your ink scrolls with the page instead of floating on top of the screen. Wipe with your palm to erase. Highlight without covering the words. Save a PDF with the ink on it.

It runs in the browser, needs no account, and nothing leaves your computer.

**[Try the demo →](https://bpmdata.github.io/OverBoard/)**

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
- **Autosave** in the browser, plus optional **save ink into the .html file** itself (Chrome/Edge)
- **Hide the toolbar** down to a small button when you want the whole screen

## Use it on your own worksheets (HTML)

OverBoard currently works on HTML worksheets. PDF support is next; see the [roadmap](docs/ROADMAP.md).

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

## Smartboard tips

- **Turn off the board's own ink tool** so it doesn't fight OverBoard. On a Mac with SMART software, this stops SMART Ink from starting:

  ```bash
  launchctl disable gui/$(id -u)/com.smarttech.ink
  ```

  Keep the board's **drivers** installed. They're what let OverBoard tell your palm apart from the pen.
- **Test your board** with [`tools/board-probe.html`](tools/board-probe.html). It shows what the browser (and the SMART driver, if present) report for pen, finger and palm. If OverBoard misbehaves on your board, paste the probe's log into an issue.
- Holding a finger still on some SMART Boards is swallowed by the driver until you move. Pen holds work everywhere.

## Privacy

OverBoard has no server. Ink is stored in your browser (and, if you choose, inside your own file). Nothing is uploaded.

## Contributing

Issues and pull requests are welcome, especially reports from boards other than SMART (Promethean, ViewSonic, Surface, iPad). Include the output of the board probe.

## License

[MIT](LICENSE). SMART Board is a trademark of SMART Technologies. OverBoard is an independent project and is not affiliated with or endorsed by them.
