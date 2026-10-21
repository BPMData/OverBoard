#!/usr/bin/env python3
"""Ink Overlay Installer

Adds the smartboard ink overlay (ink_overlay.html, kept next to this script) to HTML files,
or upgrades an older overlay already in them while keeping any ink saved inside the file.

Window:        python3 ink_overlay_installer.py
Command line:  python3 ink_overlay_installer.py FILE_OR_FOLDER ... [--in-place] [--open]
Works on Mac and Windows. Double-click "Ink Overlay Installer.command" (Mac) or "Ink Overlay Installer.bat" (Windows).

By default each file gets a "_board" copy (Worksheet.html -> Worksheet_board.html) and the
original is left alone, because "Save ink into file" writes ink into the board copy.
If the _board copy already exists, it is upgraded instead of replaced, so its ink is kept.
"""
import os
import re
import subprocess
import sys

MAX_OPEN = 8   # don't open dozens of browser tabs when you run it on a whole folder

HERE = os.path.dirname(os.path.abspath(__file__))
OVERLAY_PATH = os.path.join(HERE, 'ink_overlay.html')

BLOCK_RE = re.compile(r'<!-- ===== INK OVERLAY START.*?<!-- ===== INK OVERLAY END ===== -->', re.S)
DATA_RE = re.compile(r'<script\b[^>]*\bid\s*=\s*["\']ink-data["\'][^>]*>.*?</script>', re.S | re.I)   # any attribute order or quotes
VERSION_RE = re.compile(r'INK OVERLAY START \((v[\d.]+)\)')


def load_overlay():
    with open(OVERLAY_PATH, encoding='utf-8') as f:
        text = f.read().strip()
    if not BLOCK_RE.fullmatch(text):
        raise RuntimeError('ink_overlay.html does not look like the overlay block.')
    return text


def layout_warnings(html):
    """Signs that the page scrolls inside a box instead of scrolling the whole page.
    The overlay sticks to the page, so ink would drift on those."""
    warns = []
    css = ' '.join(re.findall(r'<style[^>]*>(.*?)</style>', html, re.S | re.I))
    css += ' ' + ' '.join(re.findall(r'style="([^"]*)"', html, re.I))
    css = re.sub(r'\s+', ' ', css.lower())
    if re.search(r'(^|[\s,}])(html|body)\s*(,\s*(html|body)\s*)?\{[^}]*overflow(-y)?\s*:\s*hidden', css):
        warns.append('the page turns off normal scrolling (overflow:hidden on html/body)')
    if re.search(r'height\s*:\s*100(vh|%)[^}]*overflow(-y)?\s*:\s*(auto|scroll)', css) or \
       re.search(r'overflow(-y)?\s*:\s*(auto|scroll)[^}]*height\s*:\s*100(vh|%)', css):
        warns.append('a full-screen box scrolls by itself (height:100vh + overflow:auto)')
    if re.search(r'<iframe', html, re.I):
        warns.append('it has an iframe; ink cannot draw inside it')
    return warns


def board_name(path):
    root, ext = os.path.splitext(path)
    if root.endswith('_board'):
        return path
    return root + '_board' + (ext or '.html')


def install(path, overlay, in_place=False):
    """Returns (status, message, warnings, finished_file)."""
    if os.path.abspath(path) == os.path.abspath(OVERLAY_PATH):
        return 'skip', 'this is the overlay file itself', [], None
    target = path if in_place else board_name(path)
    source = target if os.path.exists(target) else path   # upgrade an existing board copy instead of replacing it
    with open(source, encoding='utf-8', errors='surrogateescape') as f:
        html = f.read()
    new_version = (VERSION_RE.search(overlay) or [None, '?'])[1]
    page_html = BLOCK_RE.sub('', html)   # check the page itself, not the overlay's own code
    has_pages = re.search(r'class\s*=\s*["\'][^"\']*\bpage\b', page_html, re.I) is not None

    m = BLOCK_RE.search(html)
    if m:
        old_block = m.group(0)
        old_version = (VERSION_RE.search(old_block) or [None, 'old'])[1]
        old_data = DATA_RE.search(old_block)
        block = overlay
        if old_data:
            block = DATA_RE.sub(lambda _: old_data.group(0), overlay, count=1)
        if old_block == block:
            status, msg = 'same', 'already has the current overlay'
        else:
            html = html[:m.start()] + block + html[m.end():]
            kept = old_data and old_data.group(0).split('>', 1)[1] not in ('{}</script>',)
            status, msg = 'upgraded', 'upgraded %s -> %s%s' % (old_version, new_version, ', saved ink kept' if kept else '')
    else:
        idx = html.lower().rfind('</body>')
        if idx == -1:
            html = html.rstrip('\n') + '\n' + overlay + '\n'
            status, msg = 'added', 'added overlay %s (no </body> tag, put at the end)' % new_version
        else:
            html = html[:idx] + overlay + '\n' + html[idx:]
            status, msg = 'added', 'added overlay %s' % new_version

    if status != 'same' or source != target:
        with open(target, 'w', encoding='utf-8', errors='surrogateescape') as f:
            f.write(html)
    if target != path:
        msg += ' -> ' + os.path.basename(target)
    if not has_pages:
        msg += ' (no .page sheets: whole page prints as one sheet)'
    return status, msg, layout_warnings(html), target


def open_in_browser(path):
    """Chrome or Edge if installed (needed for "Save ink into file"), else the default browser."""
    if sys.platform == 'darwin':
        for app in ('Google Chrome', 'Microsoft Edge'):
            if subprocess.run(['open', '-a', app, path], capture_output=True).returncode == 0:
                return
        subprocess.run(['open', path])
    elif os.name == 'nt':
        for exe in (r'Google\Chrome\Application\chrome.exe', r'Microsoft\Edge\Application\msedge.exe'):
            for base in (os.environ.get('PROGRAMFILES', ''), os.environ.get('PROGRAMFILES(X86)', ''), os.environ.get('LOCALAPPDATA', '')):
                full = os.path.join(base, exe)
                if base and os.path.exists(full):
                    subprocess.Popen([full, path]); return
        os.startfile(path)
    else:
        import webbrowser; webbrowser.open('file://' + os.path.abspath(path))


def collect(paths):
    out = []
    for p in paths:
        if os.path.isdir(p):
            for root, _, files in os.walk(p):
                for n in sorted(files):
                    if n.lower().endswith(('.html', '.htm')) and not n.lower().endswith(('_board.html', '_board.htm')):
                        out.append(os.path.join(root, n))
        elif os.path.isfile(p):
            out.append(p)
    return out


def run(paths, in_place, report, open_after=False):
    try:
        overlay = load_overlay()
    except Exception as e:
        report('ERROR: could not read %s: %s' % (OVERLAY_PATH, e))
        return
    files = collect(paths)
    if not files:
        report('No HTML files found.')
        return
    finished = []
    for f in files:
        try:
            status, msg, warns, target = install(f, overlay, in_place)
            report('%-8s %s: %s' % (status.upper(), os.path.basename(f), msg))
            for w in warns:
                report('         ! check this one: ' + w)
            if target: finished.append(target)
        except Exception as e:
            report('ERROR    %s: %s' % (os.path.basename(f), e))
    if open_after and finished:
        if len(finished) > MAX_OPEN:
            report('Not opening %d files (more than %d). Open the ones you need yourself.' % (len(finished), MAX_OPEN))
        else:
            for t in finished:
                try: open_in_browser(t)
                except Exception as e: report('Could not open %s: %s' % (os.path.basename(t), e))
            report('Opened %d file(s) in the browser.' % len(finished))
    report('Done.')


def gui():
    import tkinter as tk
    from tkinter import filedialog, scrolledtext

    win = tk.Tk()
    win.title('Ink Overlay Installer')
    win.geometry('760x500')
    mono = ('Menlo', 12) if sys.platform == 'darwin' else ('Consolas', 10)
    in_place = tk.BooleanVar(value=False)
    open_after = tk.BooleanVar(value=True)

    top = tk.Frame(win, padx=12, pady=10)
    top.pack(fill='x')
    tk.Label(top, text='Add the smartboard ink overlay to HTML files.', font=('Helvetica', 15, 'bold')).pack(anchor='w')
    tk.Label(top, text='Overlay source: ' + OVERLAY_PATH, fg='#666').pack(anchor='w')
    tk.Checkbutton(top, text='Edit the files themselves (otherwise a _board copy is made and the original is untouched)',
                   variable=in_place).pack(anchor='w', pady=(6, 0))
    tk.Checkbutton(top, text='Open the finished files in Chrome (or Edge) when done', variable=open_after).pack(anchor='w')

    log = scrolledtext.ScrolledText(win, font=mono, wrap='word')

    def report(line):
        log.insert('end', line + '\n'); log.see('end'); win.update_idletasks()

    def pick_files():
        fs = filedialog.askopenfilenames(title='Pick HTML files', filetypes=[('HTML', '*.html *.htm')])
        if fs: run(list(fs), in_place.get(), report, open_after.get())

    def pick_folder():
        d = filedialog.askdirectory(title='Pick a folder (all HTML files inside get the overlay)')
        if d: run([d], in_place.get(), report, open_after.get())

    btns = tk.Frame(win, padx=12)
    btns.pack(fill='x')
    tk.Button(btns, text='Pick files…', command=pick_files, width=16, height=2).pack(side='left')
    tk.Button(btns, text='Pick a folder…', command=pick_folder, width=16, height=2).pack(side='left', padx=8)
    tk.Button(btns, text='Clear log', command=lambda: log.delete('1.0', 'end'), height=2).pack(side='right')
    log.pack(fill='both', expand=True, padx=12, pady=10)
    report('Ready. Files that already have an overlay get upgraded, keeping any ink saved inside them.')
    win.mainloop()


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if args:
        run(args, '--in-place' in sys.argv, print, '--open' in sys.argv)
    else:
        gui()
