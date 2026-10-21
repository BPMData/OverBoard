#!/usr/bin/env python3
"""Copy the PDF app's two libraries into app/vendor/, so the app loads them from this site
instead of a CDN (school web filters sometimes block CDNs).

Versions come from app/libs.js. Packages are downloaded from the npm registry and checked
against npm's published sha512 before anything is copied.

    python3 tools/vendor_libs.py          # download and copy
    python3 tools/vendor_libs.py --check  # exit 1 if app/vendor/ doesn't match app/libs.js
"""
import base64
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tarfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIBS = os.path.join(ROOT, 'app', 'libs.js')
VENDOR = os.path.join(ROOT, 'app', 'vendor')

# package -> (version constant in libs.js, files/folders to keep, relative to the package root)
PACKAGES = {
    'pdfjs-dist': ('PDFJS_VERSION', ['build/pdf.min.mjs', 'build/pdf.worker.min.mjs', 'cmaps/', 'standard_fonts/', 'LICENSE']),
    'pdf-lib': ('PDFLIB_VERSION', ['dist/pdf-lib.esm.min.js', 'LICENSE.md']),
}


def versions():
    with open(LIBS, encoding='utf-8') as f:
        src = f.read()
    out = {}
    for pkg, (const, _) in PACKAGES.items():
        m = re.search(r"export const %s = '([^']+)'" % const, src)
        if not m:
            sys.exit('app/libs.js has no %s' % const)
        out[pkg] = m.group(1)
    return out


def folder(pkg, ver):
    return os.path.join(VENDOR, '%s@%s' % (pkg, ver))


def fetch(pkg, ver):
    meta = json.load(urllib.request.urlopen('https://registry.npmjs.org/%s/%s' % (pkg, ver)))
    data = urllib.request.urlopen(meta['dist']['tarball']).read()
    algo, want = meta['dist']['integrity'].split('-', 1)
    got = base64.b64encode(hashlib.new(algo, data).digest()).decode()
    if got != want:
        sys.exit('%s@%s: checksum mismatch, not copying' % (pkg, ver))
    return tarfile.open(fileobj=io.BytesIO(data), mode='r:gz')


def keep(name, wanted):
    return any(name == w or (w.endswith('/') and name.startswith(w)) for w in wanted)


def install(pkg, ver, wanted):
    dest = folder(pkg, ver)
    shutil.rmtree(dest, ignore_errors=True)
    tar = fetch(pkg, ver)
    count = 0
    for m in tar.getmembers():
        name = m.name.split('/', 1)[1] if '/' in m.name else m.name   # strip "package/"
        if not m.isfile() or not keep(name, wanted) or '..' in name.split('/'):
            continue
        data = tar.extractfile(m).read()
        if name.endswith(('.js', '.mjs')):   # source maps aren't shipped
            data = re.sub(rb'\n//# sourceMappingURL=\S+\s*$', b'\n', data)
        path = os.path.join(dest, name.replace('dist/', '').replace('build/', ''))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(data)
        count += 1
    print('%s@%s: %d files -> %s' % (pkg, ver, count, os.path.relpath(dest, ROOT)))


def main():
    vers = versions()
    if '--check' in sys.argv:
        bad = [p for p, v in vers.items() if not os.path.isdir(folder(p, v))]
        extra = [d for d in (os.listdir(VENDOR) if os.path.isdir(VENDOR) else [])
                 if d not in ['%s@%s' % pv for pv in vers.items()] and not d.startswith('README')]
        for p in bad:
            print('missing: app/vendor/%s@%s (run python3 tools/vendor_libs.py)' % (p, vers[p]))
        for d in extra:
            print('left over: app/vendor/%s' % d)
        sys.exit(1 if bad or extra else 0)
    for pkg, (_, wanted) in PACKAGES.items():
        install(pkg, vers[pkg], wanted)
    for d in os.listdir(VENDOR):   # drop old versions
        if d not in ['%s@%s' % pv for pv in vers.items()] and not d.startswith('README'):
            shutil.rmtree(os.path.join(VENDOR, d))
            print('removed old app/vendor/' + d)


if __name__ == '__main__':
    main()
