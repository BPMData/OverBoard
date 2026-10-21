#!/usr/bin/env python3
"""Inline the shared ink code into the paste-in overlay.

The PDF app imports shared/ink-core.js and links shared/toolbar.css. The overlay must stay one
self-contained block, so this script copies both files into overlay/ink_overlay.html between
marker comments, then copies the finished block into the demo page (index.html).

    python3 tools/build_overlay.py          # rebuild
    python3 tools/build_overlay.py --check  # exit 1 if anything is out of date
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORE = os.path.join(ROOT, 'shared', 'ink-core.js')
CSS = os.path.join(ROOT, 'shared', 'toolbar.css')
OVERLAY = os.path.join(ROOT, 'overlay', 'ink_overlay.html')
DEMO = os.path.join(ROOT, 'index.html')

JS_RE = re.compile(r'(  /\* ===== SHARED CORE: generated from shared/ink-core\.js[^\n]*\n).*?(  /\* ===== END SHARED CORE ===== \*/)', re.S)
CSS_RE = re.compile(r'(/\* ===== SHARED TOOLBAR CSS: generated from shared/toolbar\.css[^\n]*\n).*?(/\* ===== END SHARED TOOLBAR CSS ===== \*/)', re.S)
BLOCK_RE = re.compile(r'<!-- ===== INK OVERLAY START.*?<!-- ===== INK OVERLAY END ===== -->', re.S)


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def core_js():
    lines = []
    for line in read(CORE).splitlines():
        if '@strip-inline' in line:
            continue
        lines.append(('  ' + line) if line.strip() else '')
    return '\n'.join(lines).strip('\n') + '\n'


def toolbar_css():
    css = read(CSS)
    css = re.sub(r'^/\*.*?\*/\n', '', css, count=1, flags=re.S)   # drop the file's header comment
    return css.strip('\n') + '\n'


def build():
    overlay = read(OVERLAY)
    if not JS_RE.search(overlay) or not CSS_RE.search(overlay):
        sys.exit('overlay/ink_overlay.html is missing the SHARED CORE / SHARED TOOLBAR CSS markers')
    js, css = core_js(), toolbar_css()
    overlay = JS_RE.sub(lambda m: m.group(1) + js + m.group(2), overlay)
    overlay = CSS_RE.sub(lambda m: m.group(1) + css + m.group(2), overlay)
    demo = read(DEMO)
    if not BLOCK_RE.search(demo):
        sys.exit('index.html has no overlay block')
    block = overlay.strip()
    demo = BLOCK_RE.sub(lambda m: block, demo, count=1)
    return {OVERLAY: overlay, DEMO: demo}


def main():
    out = build()
    stale = [p for p, text in out.items() if read(p) != text]
    if '--check' in sys.argv:
        for p in stale:
            print('out of date:', os.path.relpath(p, ROOT))
        sys.exit(1 if stale else 0)
    for p in stale:
        with open(p, 'w', encoding='utf-8', newline='\n') as f:
            f.write(out[p])
        print('updated', os.path.relpath(p, ROOT))
    if not stale:
        print('already up to date')


if __name__ == '__main__':
    main()
