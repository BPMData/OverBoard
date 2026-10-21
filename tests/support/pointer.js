// Injected into test pages: draw with synthetic pointer events at page coordinates (PDF points), read ink pixels.
window.__t = {
  client(n, x, y) {
    const { viewer } = window.__overboard, P = viewer.pages[n - 1], r = P.el.getBoundingClientRect(), z = viewer.zoom;
    return [r.left + (x + 36) * z, r.top + y * z];
  },
  async stroke(n, pts, o = {}) {
    const type = o.type || 'pen', buttons = o.buttons || 1, id = o.id || 7;
    const box = document.getElementById('ob-pages');
    const ev = (t, x, y) => {
      const target = document.elementFromPoint(x, y) || box;
      target.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, composed: true, pointerType: type, pointerId: id, isPrimary: true, buttons: t === 'pointerup' ? 0 : buttons, button: t === 'pointermove' ? -1 : (buttons & 32 ? 5 : 0), clientX: x, clientY: y, screenX: x, screenY: y }));
    };
    let c = this.client(n, pts[0][0], pts[0][1]);
    ev('pointerdown', c[0], c[1]);
    for (const p of pts.slice(1)) { await new Promise(r => setTimeout(r, 4)); const k = o.fixedScreen ? null : this.client(n, p[0], p[1]); c = k || c; ev('pointermove', c[0], c[1]); }
    await new Promise(r => setTimeout(r, 20));
    ev('pointerup', c[0], c[1]);
  },
  line(x0, y0, x1, y1, k = 30) { const a = []; for (let i = 0; i <= k; i++) a.push([x0 + (x1 - x0) * i / k, y0 + (y1 - y0) * i / k]); return a; },
  // read a pixel's alpha/color off a page's ink canvas at page point (x,y)
  px(n, x, y, layer = 'ink') {
    const P = window.__overboard.viewer.pages[n - 1], c = P[layer];
    if (!c) return null;
    const d = c.getContext('2d').getImageData(Math.round(c._ox + x * c._sc), Math.round(y * c._sc), 1, 1).data;
    return Array.from(d);
  },
};
