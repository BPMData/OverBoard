// HTML worksheets: the same job as overlay/ink_overlay_installer.py, in the browser.
// Adds the overlay to an .html file (or upgrades an older one, keeping ink saved inside it)
// and saves the result as Name_board.html. The original file is never changed.

const OVERLAY_URL = new URL('../overlay/ink_overlay.html', import.meta.url);
const BLOCK_RE = /<!-- ===== INK OVERLAY START[\s\S]*?<!-- ===== INK OVERLAY END ===== -->/;
const DATA_RE = /<script\b[^>]*\bid\s*=\s*["']ink-data["'][^>]*>[\s\S]*?<\/script>/i;   // any attribute order or quotes
const VERSION_RE = /INK OVERLAY START \((v[\d.]+)\)/;

export const isHtml = (file) => /\.html?$/i.test(file.name) || file.type === 'text/html';

export function boardName(name) {
  const m = /^(.*?)(\.html?)?$/i.exec(name), root = m[1], ext = m[2] || '.html';
  return /_board$/.test(root) ? name : root + '_board' + ext;
}

/* returns { status: 'added' | 'upgraded' | 'same', html, message } */
export async function addOverlay(html) {
  const res = await fetch(OVERLAY_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error('could not load the overlay (' + res.status + ')');
  const overlay = (await res.text()).trim();
  if (!BLOCK_RE.test(overlay)) throw new Error('the overlay file looks wrong');
  const version = (VERSION_RE.exec(overlay) || [0, '?'])[1];
  const m = BLOCK_RE.exec(html);
  if (m) {
    const old = m[0], oldVersion = (VERSION_RE.exec(old) || [0, 'old'])[1];
    const oldData = DATA_RE.exec(old);
    const block = oldData ? overlay.replace(DATA_RE, () => oldData[0]) : overlay;
    if (block === old) return { status: 'same', html, message: 'already has the current overlay (' + version + ')' };
    const kept = oldData && !/>\s*\{\s*\}\s*<\/script>$/.test(oldData[0]);
    return {
      status: 'upgraded',
      html: html.slice(0, m.index) + block + html.slice(m.index + old.length),
      message: 'upgraded ' + oldVersion + ' → ' + version + (kept ? ', saved ink kept' : ''),
    };
  }
  const i = html.toLowerCase().lastIndexOf('</body>');
  if (i === -1) return { status: 'added', html: html.replace(/\n*$/, '\n') + overlay + '\n', message: 'added overlay ' + version };
  return { status: 'added', html: html.slice(0, i) + overlay + '\n' + html.slice(i), message: 'added overlay ' + version };
}

/* Signs that ink would drift: the page scrolls inside a box instead of scrolling the whole page. Mirrors the installer. */
export function layoutWarnings(html) {
  const page = html.replace(BLOCK_RE, '');
  let css = [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((x) => x[1]).join(' ');
  css += ' ' + [...page.matchAll(/style="([^"]*)"/gi)].map((x) => x[1]).join(' ');
  css = css.toLowerCase().replace(/\s+/g, ' ');
  const w = [];
  if (/(^|[\s,}])(html|body)\s*(,\s*(html|body)\s*)?\{[^}]*overflow(-y)?\s*:\s*hidden/.test(css)) w.push('the page turns off normal scrolling');
  if (/height\s*:\s*100(vh|%)[^}]*overflow(-y)?\s*:\s*(auto|scroll)/.test(css) || /overflow(-y)?\s*:\s*(auto|scroll)[^}]*height\s*:\s*100(vh|%)/.test(css)) w.push('a full-screen box scrolls by itself');
  if (/<iframe/i.test(page)) w.push('it has an iframe; ink cannot draw inside it');
  return w;
}

/* Save next to the original when the browser allows it (Chrome/Edge), else as a download.
   Returns where it went, or null if the save window was cancelled. */
export async function saveBoardCopy(text, name, startIn) {
  const blob = new Blob([text], { type: 'text/html' });
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({
        id: 'overboard-html', suggestedName: name, ...(startIn ? { startIn } : {}),
        types: [{ description: 'Board copy (.html)', accept: { 'text/html': ['.html', '.htm'] } }],
      });
      const w = await h.createWritable();
      await w.write(blob); await w.close();
      return 'saved as ' + h.name;
    } catch (e) {
      if (e && e.name === 'AbortError') return null;
      // fall through to a plain download
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return 'downloaded ' + name;
}

/* Files the worksheet loads from next to itself (pictures, stylesheets, scripts, fonts), e.g. "images/diagram.png".
   Those break if the board copy is saved in a different folder. Web links, data: URLs and drawn/inline SVG are fine. */
export function localFiles(html) {
  const page = html.replace(BLOCK_RE, '').replace(/<!--[\s\S]*?-->/g, '');
  const found = new Set();
  const local = (u) => u && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u.trim()) && u.trim() !== '';
  const add = (u) => { u = (u || '').trim().replace(/^["']|["']$/g, ''); if (local(u)) found.add(u.split(/[?#]/)[0]); };
  for (const m of page.matchAll(/<(?:img|source|script|video|audio|track|embed|iframe|input)\b[^>]*?\s(?:src|poster)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)) add(m[1]);
  for (const m of page.matchAll(/<(?:img|source)\b[^>]*?\ssrcset\s*=\s*("[^"]*"|'[^']*')/gi)) m[1].slice(1, -1).split(',').forEach((c) => add(c.trim().split(/\s+/)[0]));
  for (const m of page.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']?[^"'>]*(?:stylesheet|icon|preload)/i.test(m[0])) continue;
    const h = /\shref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.exec(m[0]); if (h) add(h[1]);
  }
  for (const m of page.matchAll(/url\(\s*("[^"]*"|'[^']*'|[^)]*)\s*\)/gi)) add(m[1]);
  return [...found];
}
