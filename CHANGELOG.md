# Changelog

## Unreleased

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
