# Changelog

## Unreleased

- **Board not working?** (v24; PDF app File menu and start screen, HTML overlay File menu). A big-text, step-by-step check for any teacher: draw two lines with a finger, two with the pen, wipe with your hand, rub out with the board's eraser, drag two fingers. Each step records whatever the board actually sends, even when it's not what the step asked for (that's what needs fixing). Then pick the board's brand, tick what goes wrong, and press **Send**. Reports open a GitHub issue and email OverBoard's reports inbox; the teacher's email and comments stay private. If the school network blocks sending, the teacher can download the report and email it.
- **File ▸ Settings…** (PDF app and HTML overlay v23), for teachers at other schools:
  - **Class periods:** 1–12 periods with any names. Tap a style (*P1, P2…*, *Period 1, 2…*, *Block A, B…*, *A1… B1…* for A/B days) or type your own. New worksheets and PDFs start with this list, and **Done** uses it on the one you have open. Renaming keeps the ink; removing a period that has ink asks first.
  - **Pen color at start**, so the pen doesn't always start pink.
  - The tool settings the toolbar remembers (finger, pen size, smoothing, highlighter), with **Reset tools to defaults**.
  - Saved in the browser, so all worksheets on one computer share them. The website and worksheets opened from your computer keep separate settings.
- **More than 4 periods, or long names,** show as one **"P5 ▾"** button on the toolbar that opens a list, so the toolbar still fits a 1080p board.
- **Version number on the start screen** (v22): a small grey **v22** at the bottom of the PDF app's start screen, so you can tell the newest version loaded. It goes up with every change. The HTML overlay's number (first line of the overlay) is the same number.
- **Long file names in Open again** now shorten with … instead of pushing the list past the edge of the card.
- **HTML overlay v21: no more 5 MB limit on ink saved in the browser.** The overlay now keeps ink in the browser's database (IndexedDB), like the PDF app, instead of the small shared space (localStorage) that every worksheet used to share. Ink saved by older versions moves over by itself the first time a worksheet opens. Closing the tab right after writing still keeps the last strokes. Rerun the installer (or the PDF app's HTML option) on existing board copies to upgrade them; their ink is kept.
- **Save windows open next to the original** (Chrome/Edge): the HTML board copy and Save ink into PDF now start in the folder of the file you dropped, chose by tapping the drop box, or opened from Finder, instead of the last folder used. Tapping the drop box now uses Chrome's own file chooser, which tells OverBoard where the file is.
- **The pen starts Barbie pink** (PDF app and HTML overlay v20), for high visibility on the board. Tap any color to change it; `PEN_COLOR` at the top of `app/main.js` and of the overlay sets the starting color.
- **PDF text is selectable and links work** (in Scroll mode): copy text, follow contents-page links, open web links. Write mode is unchanged. Exports keep the original text.
- **Find text** searches the whole PDF (File ▸ Find text…, or Ctrl/⌘+F).
- **Cover** (Highlighter ▾): solid black or gray bars that hide answers on the board and erase like any ink. Export PDF keeps them and warns that covered text can still be copied.
- **Highlight strength** slider (10–100%) in the same ▾ menu.
- **Install the PDF app and use it offline.** After one visit it opens, opens PDFs, takes ink and exports with no internet. Chrome and Edge offer **Install app** on the start screen; the installed app opens PDFs from Finder (Open With). Updates download in full in the background and switch in one step the next time OverBoard opens.
- **Clear page / Clear all** in the PDF app and the HTML overlay (v19). HTML worksheets and PDFs without chapters get the two buttons side by side; a PDF with chapters keeps **Chapters** there and gets **Clear ▸** (this page / all pages) on the side its menu opens. Clear all asks "Sure?". HTML worksheets can now clear one page; PDFs can now clear every page. Undo brings either back.
- **The toolbar shrinks to fit a laptop screen** (both apps) instead of scrolling, and the zoom % is no longer cut off.
- **HTML overlay: − / Fit / + zoom** like the PDF app: the worksheet zooms, the toolbar stays the same size, and ink stays on the page. Ctrl+scroll and trackpad pinch zoom the worksheet too. Printing always happens at 100%.
- **HTML overlay: File ▸ menu** like the PDF app's, with Save PDF, Save ink into file, Change linked file and Move toolbar. The overlay's toolbar now fits a 1080p board without scrolling (it was 56 px too tall).
- **Redo** (PDF app and HTML overlay v17): Undo and Redo share the Undo spot on the toolbar (↶ ↷). Ctrl/⌘+Z undoes; Ctrl/⌘+Y, Ctrl/⌘+R or Ctrl/⌘+Shift+Z redoes. Typing boxes keep their own undo.
- **Keyboard reload is off** (F5, Ctrl/⌘+R, Ctrl/⌘+Shift+R), in the PDF app and the overlay. The browser's reload button still works.
- **Reloading the PDF app no longer loses ink.** Strokes from the last few seconds used to be lost on a reload; now they're kept, and the PDF reopens where you were.
- **HTML board copies work offline** too (the app's offline copy now includes the overlay).
- **HTML overlay v16**: the same Highlighter ▾ menu (Cover and strength). Save PDF warns when covered text can still be copied.

## v1.0.0 (2026-10-21)

- **Write on PDFs in the browser**, from one-page worksheets to whole textbooks: same toolbar as the board overlay, chapter list, Export PDF with your ink, and ink saved in the browser or (optionally) inside the PDF.
- **HTML worksheets**: the paste-in overlay (v15), or drop a worksheet on the web app to get a board copy, with nothing to install.
