/* OverBoard shared ink core.
   Used two ways:
   - as an ES module by the PDF app (app/*.js imports it), and
   - inlined into the paste-in overlay (overlay/ink_overlay.html) by tools/build_overlay.py.
   So: plain ES5 function declarations only, no imports, no top-level state.
   The export line at the bottom is stripped when it is inlined.

   Stroke: { c: color, w: width, e: 1 if eraser, h: 1 if highlight, o: 1 if cover (opaque highlight), p: [x0,y0,x1,y1,...] }  */

/* mix a #rrggbb color toward white (amt 0..1) */
function tint(hex, amt){
  var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  function m(c){ return Math.round(c + (255 - c) * amt); }
  return '#' + ((1 << 24) | (m(r) << 16) | (m(g) << 8) | m(b)).toString(16).slice(1);
}

/* SMART Board on macOS: pen tip = "pen"; palm/fist/side of hand = "pen" with the eraser button (32);
   finger and the pen's round end = "mouse". Touch screens report "touch". */
function pointerKind(e){
  if (e.pointerType === 'pen' && ((e.buttons & 32) || e.button === 5)) return 'palm';
  if (e.pointerType === 'mouse' || e.pointerType === 'touch') return 'finger';
  return 'pen';
}

function inkStyle(g, s, sc, ox, oy){
  g.setTransform(sc, 0, 0, sc, ox, oy);
  g.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
  g.strokeStyle = s.c; g.fillStyle = s.c; g.lineWidth = s.w;
  g.lineCap = 'round'; g.lineJoin = 'round';
}

/* one whole stroke onto one canvas: quadratic curves through the midpoints between samples,
   so corners come out round instead of jagged. Ink coordinates map to canvas px as x*sc+ox. */
function paintStroke(g, s, sc, ox, oy){
  var p = s.p; g.save(); inkStyle(g, s, sc, ox, oy);
  g.beginPath();
  if (p.length < 4) { g.arc(p[0], p[1], s.w/2, 0, 6.2832); g.fill(); }
  else {
    g.moveTo(p[0], p[1]);
    for (var i = 2; i < p.length - 2; i += 2) g.quadraticCurveTo(p[i], p[i+1], (p[i] + p[i+2]) / 2, (p[i+1] + p[i+3]) / 2);
    g.lineTo(p[p.length-2], p[p.length-1]);
    g.stroke();
  }
  g.restore();
}

/* ---- live drawing: draws the same curve as paintStroke, piece by piece as points arrive ----
   live = { fx, fy: smoothed pen position; ex, ey: where the drawn line ends; k: points drawn so far } */
function liveStart(x, y){ return { fx: x, fy: y, ex: x, ey: y, k: 1 }; }

/* add one raw sample through the smoothing filter (level 0-8). Returns true if a point was kept. */
function liveAdd(s, live, x, y, level){
  var k = level / 10, n = s.p.length;
  live.fx = live.fx * k + x * (1 - k);
  live.fy = live.fy * k + y * (1 - k);
  var px = Math.round(live.fx * 10) / 10, py = Math.round(live.fy * 10) / 10;
  if (Math.abs(px - s.p[n-2]) + Math.abs(py - s.p[n-1]) < 0.5) return false;
  s.p.push(px, py);
  return true;
}

/* pieces not drawn yet: [x0,y0,cx,cy,x1,y1] (cx null = straight line) */
function livePieces(s, live){
  var p = s.p, n = p.length / 2, pieces = [];
  while (live.k < n) {
    var k = live.k;
    if (k >= 2) {
      var bx = p[2*k-2], by = p[2*k-1], mx = (bx + p[2*k]) / 2, my = (by + p[2*k+1]) / 2;
      pieces.push([live.ex, live.ey, bx, by, mx, my]);
      live.ex = mx; live.ey = my;
    }
    live.k++;
  }
  return pieces;
}

/* the last straight bit to where the pen lifted; call once at the end of a stroke */
function liveEndPieces(s, live){
  var p = s.p, n = p.length;
  if (n < 4) return [];
  var pieces = livePieces(s, live);
  pieces.push([live.ex, live.ey, null, null, p[n-2], p[n-1]]);
  return pieces;
}

function paintPieces(g, s, pieces, sc, ox, oy){
  if (!pieces.length) return;
  g.save(); inkStyle(g, s, sc, ox, oy);
  for (var i = 0; i < pieces.length; i++) {
    var q = pieces[i];
    g.beginPath(); g.moveTo(q[0], q[1]);
    if (q[2] === null) g.lineTo(q[4], q[5]); else g.quadraticCurveTo(q[2], q[3], q[4], q[5]);
    g.stroke();
  }
  g.restore();
}

/* finish the stroke where the pen lifted (smoothing trails slightly behind) */
function liveLift(s, x, y){
  var n = s.p.length;
  if (n >= 4 && Math.abs(x - s.p[n-2]) + Math.abs(y - s.p[n-1]) >= 0.5) s.p.push(x, y);
}

/* ---- toolbar helpers ---- */

/* - / + buttons: tap = one step; hold = keeps stepping, speeding up, until step() returns false */
function holdRepeat(b, step){
  var timer = null;
  function stop(){ clearTimeout(timer); timer = null; }
  b.addEventListener('pointerdown', function(e){
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); stop();
    try { b.setPointerCapture(e.pointerId); } catch(_){}
    step();
    var delay = 160, n = 0;
    timer = setTimeout(function tick(){
      if (!step()) return stop();               // stop at the end of the range
      n++; if (n === 6) delay = 80;             // speed up after a few steps
      timer = setTimeout(tick, delay);
    }, 450);                                    // hold this long before it starts repeating
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function(t){ b.addEventListener(t, stop); });
  b.addEventListener('contextmenu', function(e){ e.preventDefault(); });
}

/* first tap arms ("Sure?"), second tap within 3s does it */
function confirmTap(btn, fn){
  if (!btn.classList.contains('warn')) {
    btn._label = btn.textContent; btn.classList.add('warn'); btn.textContent = 'Sure?';
    btn._timer = setTimeout(function(){ btn.classList.remove('warn'); btn.textContent = btn._label; }, 3000);
    return;
  }
  clearTimeout(btn._timer); btn.classList.remove('warn'); btn.textContent = btn._label; fn();
}

/* show a result on the button itself, then put the label back */
function flashBtn(btn, text, cls){
  clearTimeout(btn._flash); btn.classList.remove('good', 'warn');
  if (!btn._label) btn._label = btn.textContent;
  btn.textContent = text; btn.classList.add(cls);
  btn._flash = setTimeout(function(){ btn.classList.remove(cls); btn.textContent = btn._label; }, 3000);
}

/* ---- Highlighter ▾ menu: Highlight (with a strength slider) or Cover ---- */

/* highlights go on the multiply layer under the ink; covers (o: 1) and pen ink go on the top layer */
function seeThrough(s){ return !!s.h && !s.o; }

/* highlight color at a strength in % (10-100): mixed toward white. It multiplies, so printed text stays black. */
function hlInk(color, strength){ return tint(color, 1 - strength / 100); }

/* put a popout beside the toolbar, next to btn (alignTop: tops line up; otherwise bottoms) */
function placeMenu(menu, btn, bar, alignTop){
  var r = btn.getBoundingClientRect(), b = bar.getBoundingClientRect(), h = menu.offsetHeight;
  menu.style.top = Math.max(10, Math.min(alignTop ? r.top : r.bottom - h, innerHeight - h - 10)) + 'px';
  if (bar.classList.contains('right')) { menu.style.left = ''; menu.style.right = (innerWidth - b.left + 8) + 'px'; }
  else { menu.style.right = ''; menu.style.left = (b.right + 8) + 'px'; }
}

/* The ▾ beside the Highlighter button opens this menu. It stays open until a choice is tapped, a tap lands
   anywhere else, or Escape; lifting the pen or finger never closes it (no long-press: nobody finds one, and
   the SMART driver holds back a finger that stays still). The slider isn't a final choice, so it keeps it open.
   S: { covering, coverColor, hlStrength, hlColor }. The menu changes S, then calls onPick() so the caller
   turns the highlighter on, saves the settings and refreshes. onOpen() closes the caller's other popouts.
   Returns { el, show(open), sync() }. */
function makeHlMenu(bar, S, onPick, onOpen){
  var btn = bar.querySelector('[data-act="hl-menu"]');
  var covers = [['#111111', 'Cover: black', 'hides answers'], ['#5f5f5f', 'Cover: dark gray', ''], ['#a6a6a6', 'Cover: light gray', '']];
  var m = document.createElement('div');
  m.id = 'ob-hlmenu'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', 'Highlighter'); m.hidden = true;
  var html = '<button data-mode="hl"><span class="sw hl"></span>Highlight<small>see-through</small></button>' +
    '<label class="strength"><span>Highlight strength <b id="ob-hl-pct"></b></span>' +
    '<input type="range" id="ob-hl-strength" min="10" max="100" step="5" aria-label="Highlight strength (percent)"></label>';
  for (var i = 0; i < covers.length; i++)
    html += '<button data-mode="cover" data-cover="' + covers[i][0] + '"><span class="sw" style="background:' + covers[i][0] + '"></span>' +
      covers[i][1] + (covers[i][2] ? '<small>' + covers[i][2] + '</small>' : '') + '</button>';
  m.innerHTML = html;
  document.body.appendChild(m);
  var slider = m.querySelector('input'), pct = m.querySelector('b');
  function show(open){
    m.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) { if (onOpen) onOpen(); placeMenu(m, btn, bar, true); }
  }
  function sync(){
    slider.value = S.hlStrength; pct.textContent = S.hlStrength + '%';
    slider.style.setProperty('--fill', hlInk(S.hlColor, S.hlStrength));
    var bs = m.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++)
      bs[i].classList.toggle('on', bs[i].dataset.mode === 'cover' ? S.covering && bs[i].dataset.cover === S.coverColor : !S.covering);
  }
  btn.addEventListener('click', function(){ show(m.hidden); });
  m.addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    S.covering = b.dataset.mode === 'cover';
    if (S.covering) S.coverColor = b.dataset.cover;
    show(false); onPick();
  });
  slider.addEventListener('input', function(){ S.hlStrength = +slider.value; S.covering = false; onPick(); });
  document.addEventListener('pointerdown', function(e){ if (!m.hidden && !m.contains(e.target) && !btn.contains(e.target)) show(false); }, true);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !m.hidden) show(false); });
  return { el: m, show: show, sync: sync };
}

/* A popout menu beside the toolbar (File ▸, Clear ▸), the same in the PDF app and the overlay. It opens on a
   tap of its button and stays open until a choice, a tap anywhere else, or Escape. onOpen() closes the
   caller's other popouts. Returns { el, show(open), place() }. */
function makePopMenu(menu, btn, bar, onOpen){
  function place(){ placeMenu(menu, btn, bar, false); }
  function show(open){
    menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    if (open) { if (onOpen) onOpen(); place(); }
  }
  document.addEventListener('pointerdown', function(e){
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) show(false);
  }, true);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') show(false); });
  return { el: menu, show: show, place: place };
}

/* Keyboard history keys, the same in the PDF app and the overlay:
   Ctrl/⌘+Z undo; Ctrl/⌘+Shift+Z, Ctrl/⌘+Y or Ctrl/⌘+R redo. Reloading from the keyboard (F5, Ctrl/⌘+Shift+R)
   is turned off, so a slip can't throw the page away; the browser's reload button still works.
   Returns 'undo', 'redo', 'block' or null; the caller calls preventDefault for any non-null result. */
function historyKey(e) {
  if (e.key === 'F5') return 'block';
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  var k = (e.key || '').toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y') return 'redo';
  if (k === 'r') return e.shiftKey ? 'block' : 'redo';
  return null;
}

export { makePopMenu, historyKey, seeThrough, hlInk, placeMenu, makeHlMenu, tint, pointerKind, inkStyle, paintStroke, liveStart, liveAdd, livePieces, liveEndPieces, paintPieces, liveLift, holdRepeat, confirmTap, flashBtn };   // @strip-inline
