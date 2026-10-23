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
function confirmTap(btn, fn, sure){
  if (!btn.classList.contains('warn')) {
    btn._label = btn.textContent; btn.classList.add('warn'); btn.textContent = sure || 'Sure?';
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

/* The five color swatches change with the tool: pen colors you can read, highlighter colors that are light
   enough to read through, and cover colors. [color, strings.js key for its name, English name] */
function paletteColors(mode){
  if (mode === 'hl') return [['#fdd835', 'yellow', 'Yellow'], ['#2e7d32', 'green', 'Green'], ['#e0218a', 'pink', 'Barbie pink'], ['#1565c0', 'blue', 'Blue'], ['#e8441a', 'orange', 'Sunset orange']];
  if (mode === 'cover') return [['#111111', 'cover_black', 'Cover: black'], ['#a6a6a6', 'cover_light', 'Cover: light gray'], ['#ffffff', 'cover_white', 'Cover: white'], ['#fdd835', 'cover_yellow', 'Cover: yellow'], ['#e0218a', 'cover_pink', 'Cover: pink']];
  return [['#111111', 'black', 'Black'], ['#1565c0', 'blue', 'Blue'], ['#d32f2f', 'red', 'Red'], ['#e0218a', 'pink', 'Barbie pink'], ['#2e7d32', 'green', 'Green']];
}
/* show the swatches for mode ('pen', 'hl' or 'cover') in the toolbar; t (optional) is the translator */
function setPalette(bar, mode, t){
  var box = bar.querySelector('#ink-colors'); if (!box || box.dataset.mode === mode && !t) return;
  var bs = box.querySelectorAll('[data-color]'), cs = paletteColors(mode);
  box.dataset.mode = mode;
  for (var i = 0; i < bs.length && i < cs.length; i++) {
    var b = bs[i], c = cs[i], name = t ? t(c[1]) : c[2];
    b.dataset.color = c[0]; b.style.background = c[0];
    b.setAttribute('data-ta', c[1]); b.setAttribute('data-tt', c[1]);
    b.setAttribute('aria-label', name); b.title = name;
  }
}

/* put a popout beside the toolbar, next to btn (alignTop: tops line up; otherwise bottoms) */
function placeMenu(menu, btn, bar, alignTop){
  var r = btn.getBoundingClientRect(), b = bar.getBoundingClientRect(), m = menu.getBoundingClientRect();
  var k = menu.offsetWidth ? m.width / menu.offsetWidth : 1, h = m.height;   // the menu may be zoomed (fitTools): its px are k screen px
  menu.style.top = Math.max(10, Math.min(alignTop ? r.top : r.bottom - h, innerHeight - h - 10)) / k + 'px';
  if (bar.classList.contains('right')) { menu.style.left = ''; menu.style.right = (innerWidth - b.left + 8) / k + 'px'; }
  else { menu.style.right = ''; menu.style.left = (b.right + 8) / k + 'px'; }
}

/* The ▾ beside the Highlighter button opens this menu. It stays open until a choice is tapped, a tap lands
   anywhere else, or Escape; lifting the pen or finger never closes it (no long-press: nobody finds one, and
   the SMART driver holds back a finger that stays still). The slider isn't a final choice, so it keeps it open.
   S: { covering, coverColor, hlStrength, hlColor }. The menu changes S, then calls onPick() so the caller
   turns the highlighter on, saves the settings and refreshes. onOpen() closes the caller's other popouts.
   Returns { el, show(open), sync() }. */
function makeHlMenu(bar, S, onPick, onOpen){
  var btn = bar.querySelector('[data-act="hl-menu"]');
  // the last one opens the color picker (the toolbar's own), for a cover in any color
  var covers = [['#111111', 'Cover: black', 'cover_black'], ['#a6a6a6', 'Cover: light gray', 'cover_light'], ['#ffffff', 'Cover: white', 'cover_white'], ['pick', 'Cover: any color…', 'cover_any']];
  var m = document.createElement('div');
  m.id = 'ob-hlmenu'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', 'Highlighter'); m.setAttribute('data-ta', 'highlighter'); m.hidden = true;
  // data-t / data-ta: words translated by obTranslate (shared/strings.js)
  var html = '<button data-mode="hl"><span class="sw hl"></span><span data-t="highlight">Highlight</span><small data-t="see_through">see-through</small></button>' +
    '<label class="strength"><span><span data-t="hl_strength">Highlight strength</span> <b id="ob-hl-pct"></b></span>' +
    '<input type="range" id="ob-hl-strength" min="10" max="100" step="5" aria-label="Highlight strength" data-ta="hl_strength"></label>';
  for (var i = 0; i < covers.length; i++)
    html += '<button data-mode="cover" data-cover="' + covers[i][0] + '"><span class="sw' + (covers[i][0] === 'pick' ? ' pick"' : '" style="background:' + covers[i][0] + '"') + '></span>' +
      '<span data-t="' + covers[i][2] + '">' + covers[i][1] + '</span><small data-t="hides_answers">hides answers</small></button>';
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
    var fixed = covers.map(function(c){ return c[0]; });
    for (var i = 0; i < bs.length; i++) {
      var c = bs[i].dataset.cover;
      bs[i].classList.toggle('on', bs[i].dataset.mode === 'cover' ? S.covering && (c === S.coverColor || (c === 'pick' && fixed.indexOf(S.coverColor) < 0)) : !S.covering);
    }
  }
  btn.addEventListener('click', function(){ show(m.hidden); });
  m.addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    S.covering = b.dataset.mode === 'cover';
    var pick = b.dataset.cover === 'pick', picker = bar.querySelector('#ink-picker');
    if (S.covering && !pick) S.coverColor = b.dataset.cover;
    show(false); onPick();
    if (pick && picker) {   // a picked color becomes the cover's color (the toolbar's picker handles it while covering)
      picker.value = S.coverColor;
      try { if (picker.showPicker) picker.showPicker(); else picker.click(); } catch(_){ picker.click(); }
    }
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

/* A word that is too wide for its button (longer languages: "Desplazar", "Défiler") gets smaller text,
   down to 10px, instead of stretching the toolbar. Call after the words or the layout change. */
function fitLabels(root){
  var bs = root.querySelectorAll('button');
  for (var i = 0; i < bs.length; i++) {
    var b = bs[i];
    b.style.fontSize = '';
    if (!b.offsetParent || !b.textContent.trim()) continue;
    var px = parseFloat(getComputedStyle(b).fontSize);
    while (b.scrollWidth > b.clientWidth && px > 10) { px -= 1; b.style.fontSize = px + 'px'; }
  }
}

/* Shrink the toolbar (and its popouts) to fit a short window, such as a laptop screen, instead of making it
   scroll. base is the zoom that shows them at normal size: 1, or 1/Z in the overlay while the page is zoomed.
   Call it after the window, the zoom or the toolbar's contents change. Returns the scale used (1 = full size). */
function fitTools(bar, popouts, base){
  var els = [bar].concat(popouts.filter(Boolean)), s = 1;
  els.forEach(function(el){ el.style.zoom = base === 1 ? '' : String(base); });
  fitLabels(bar);   // at full size, so rounding at a smaller zoom can't hide a word that's a pixel too wide
  bar.style.maxHeight = 'none';
  if (bar.hidden || bar.style.display === 'none') { bar.style.maxHeight = ''; return 1; }
  var room = Math.floor(innerHeight * 0.96) - 1;   // whole pixels, with 1px to spare: a toolbar a fraction of a pixel too tall would scroll
  for (var i = 0; i < 2; i++) {   // text doesn't shrink exactly in proportion, so check once more after scaling
    var h = bar.getBoundingClientRect().height;
    if (h <= room && i === 0) break;
    s = Math.min(1, s * room / h);
    els.forEach(function(el){ el.style.zoom = String(base * s); });
  }
  if (s >= 0.999) bar.style.maxHeight = '';
  return s;
}

/* ---- class periods and File ▸ Settings…, the same in the PDF app and the overlay ----
   Saved per browser (localStorage), so every worksheet and PDF opened in this browser shares them. */

/* tap-only name styles for n periods */
function periodPreset(style, n){
  var out = [], half = Math.ceil(n / 2);
  for (var i = 0; i < n; i++) {
    if (style === 'period') out.push('Period ' + (i + 1));
    else if (style === 'block') out.push('Block ' + String.fromCharCode(65 + i));
    else if (style === 'ab') out.push(i < half ? 'A' + (i + 1) : 'B' + (i - half + 1));   // A/B day schedules
    else out.push('P' + (i + 1));
  }
  return out;
}
function periodStyles(){ return [['p', 'P1, P2…'], ['period', 'Period 1, 2…'], ['block', 'Block A, B…'], ['ab', 'A1… B1… (A/B days)']]; }

/* trimmed, not empty, all different, at most 20 characters; null if the list can't be used */
function cleanPeriods(list){
  if (!list || !list.length || list.length > 12) return null;
  var seen = {}, out = [];
  for (var i = 0; i < list.length; i++) {
    var n = String(list[i] == null ? '' : list[i]).replace(/\s+/g, ' ').trim().slice(0, 20), k = n.toLowerCase();
    if (!n || seen[k]) return null;
    seen[k] = 1; out.push(n);
  }
  return out;
}
/* the period list new documents start with (def until the teacher sets one) */
function loadPeriods(def){
  try { return cleanPeriods(JSON.parse(localStorage.getItem('ob-periods'))) || def.slice(); } catch(e){ return def.slice(); }
}
/* the pen color each document starts with */
function startPen(def){
  var c = null; try { c = localStorage.getItem('ob-pen-color'); } catch(e){}
  return /^#[0-9a-f]{6}$/i.test(c || '') ? c : def;
}

/* Give a document a new period list. Names replace the document's periods in order, keeping their ink
   (so renaming never loses ink); periods past the end of the list are removed. Returns
   { periods, active, lost, same }: lost = removed periods that had ink; same = nothing would change. */
function remapPeriods(periods, active, names){
  var old = Object.keys(periods), out = {}, lost = [], act = names[0], i;
  for (i = 0; i < names.length; i++) {
    out[names[i]] = i < old.length ? periods[old[i]] : [];
    if (i < old.length && old[i] === active) act = names[i];
  }
  for (i = names.length; i < old.length; i++) if (periods[old[i]].length) lost.push(old[i]);
  return { periods: out, active: act, lost: lost, same: old.join('\n') === names.join('\n') };
}

/* The Class period row on the toolbar: one button per period when they fit (up to 4 short names), otherwise
   one wide "P5 ▾" button that opens a list beside the toolbar. Period buttons carry data-period, so the
   toolbar's own click handler switches; buttons in the list call onPick(name). onOpen() closes other popouts.
   t (optional) is the translator from shared/strings.js. Returns { el, render(names, active), show(open) }. */
function makePeriodPicker(bar, row, onPick, onOpen, t){
  var m = document.createElement('div'), toggle = null;
  m.id = 'ob-permenu'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', 'Class period'); m.hidden = true;
  document.body.appendChild(m);
  function show(open){
    if (open && !toggle) return;
    m.hidden = !open;
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    if (open) { if (onOpen) onOpen(); placeMenu(m, toggle, bar, true); }
  }
  function periodBtn(name, on){
    var b = document.createElement('button');
    b.className = 'sm' + (on ? ' on' : ''); b.dataset.period = name; b.textContent = name; b.title = name;
    return b;
  }
  function render(names, active){
    row.textContent = ''; m.textContent = ''; toggle = null;
    var fits = names.length <= 4;
    for (var i = 0; i < names.length; i++) if (names[i].length > 4) fits = false;
    row.classList.toggle('menu', !fits);
    row.style.gridTemplateColumns = fits ? 'repeat(' + names.length + ',1fr)' : '';
    if (fits) {
      for (i = 0; i < names.length; i++) row.appendChild(periodBtn(names[i], names[i] === active));
      m.hidden = true;
      return;
    }
    toggle = document.createElement('button');
    toggle.className = 'sm'; toggle.dataset.act = 'period-menu';
    toggle.setAttribute('aria-haspopup', 'true'); toggle.setAttribute('aria-expanded', String(!m.hidden));
    toggle.textContent = active + ' ▾'; toggle.title = t ? t('period_menu_tip', { p: active }) : 'Class period: ' + active + ' (tap to change)';
    row.appendChild(toggle);
    for (i = 0; i < names.length; i++) m.appendChild(periodBtn(names[i], names[i] === active));
  }
  row.addEventListener('click', function(e){ if (toggle && toggle.contains(e.target)) show(m.hidden); });
  m.addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    show(false); onPick(b.dataset.period);
  });
  document.addEventListener('pointerdown', function(e){ if (!m.hidden && !m.contains(e.target) && !(toggle && toggle.contains(e.target))) show(false); }, true);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !m.hidden) show(false); });
  return { el: m, render: render, show: show };
}

/* File ▸ Settings…: class periods, the pen color at start, and the tool settings the toolbar remembers.
   Typing is only needed for custom period names; everything else is taps.
   O = { defaults: ['P1', …], colors: [[hex, name], …], pen: the pen color before one is picked here,
         periods(): the open document's period names (or null),
         applyPeriods(names): use them on the open document; return false if the teacher said no,
         tools(): { finger, width, smooth, hlColor, hlStrength }, setPen(hex), resetTools(), onOpen(),
         langs: [[code, name], …] and setLang(code) for the Language buttons, t(): the current translator,
         extra: an element to show above Toolbar settings (optional) }
   colors may carry a third item, the strings.js key for the color's name.
   Returns { el, show(open) }. */
function makeSettings(O){
  var el = document.createElement('div');
  el.id = 'ob-settings'; el.hidden = true;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Settings'); el.setAttribute('data-ta', 'settings');
  var tr = function(){ return O.t ? O.t() : function(k, v){ return k; }; };   // the current translator (the language can change while open)
  var styles = periodStyles(), html = '';
  for (var i = 0; i < styles.length; i++) html += '<button data-style="' + styles[i][0] + '" dir="auto">' + styles[i][1] + '</button>';   // dir=auto: reads right in Arabic too
  var pens = '';
  for (i = 0; i < O.colors.length; i++) {
    var ck = O.colors[i][2] ? ' data-ta="' + O.colors[i][2] + '" data-tt="' + O.colors[i][2] + '"' : '';
    pens += '<button data-pen="' + O.colors[i][0] + '" style="background:' + O.colors[i][0] + '" aria-label="' + O.colors[i][1] + '" title="' + O.colors[i][1] + '"' + ck + '></button>';
  }
  var langs = '', L = O.langs || [];
  for (i = 0; i < L.length; i++) langs += '<button data-lang="' + L[i][0] + '" lang="' + L[i][0] + '">' + L[i][1] + '</button>';
  el.innerHTML = '<div class="ob-box">' +
    '<div class="ob-head"><strong data-t="settings">Settings</strong><button data-s="done" data-t="done">Done</button></div>' +
    (langs ? '<h3><span aria-hidden="true">🌐 </span><span data-t="language">Language</span></h3><div class="ob-langs">' + langs + '</div>' +
      '<p class="ob-hint" data-t="lang_hint"></p>' : '') +
    '<h3 data-t="class_periods">Class periods</h3>' +
    '<div class="ob-count"><button data-s="fewer" aria-label="Fewer periods" data-ta="fewer_periods" data-tt="fewer_periods">&minus;</button><span><b></b></span><button data-s="more" aria-label="More periods" data-ta="more_periods" data-tt="more_periods">+</button></div>' +
    '<div class="ob-styles">' + html + '</div>' +
    '<div class="ob-names"></div>' +
    '<p class="ob-hint" data-t="names_hint">Tap a name to type your own. Renaming keeps the ink. New worksheets and PDFs start with these, and Done uses them on this one too.</p>' +
    '<p class="ob-err" role="alert" hidden></p>' +
    '<h3 data-t="pen_at_start">Pen color at start</h3><div class="ob-pens">' + pens + '</div>' +
    '<h3 data-t="toolbar_settings">Toolbar settings</h3><p class="ob-tools"></p>' +
    '<p class="ob-hint" data-t="remembers_hint">The toolbar remembers these when you change them.</p>' +
    '<button data-s="reset" class="ob-reset" data-t="reset_tools">Reset tools to defaults</button>' +
    '</div>';
  if (O.extra) el.querySelector('.ob-box').insertBefore(O.extra, el.querySelector('[data-t="toolbar_settings"]'));   // e.g. the Timer sound section (makeTimer)
  document.body.appendChild(el);
  var namesEl = el.querySelector('.ob-names'), err = el.querySelector('.ob-err');
  var names = [], touched = false;
  function draw(){
    var t = tr();
    el.querySelector('.ob-count b').textContent = O.t ? t(names.length === 1 ? 'n_period' : 'n_periods', { n: names.length }) : names.length + (names.length === 1 ? ' period' : ' periods');
    el.querySelector('[data-s="fewer"]').disabled = names.length <= 1;
    el.querySelector('[data-s="more"]').disabled = names.length >= 12;
    var bs = el.querySelectorAll('[data-style]');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', periodPreset(bs[i].dataset.style, names.length).join('\n') === names.join('\n'));
    namesEl.textContent = '';
    for (i = 0; i < names.length; i++) {
      var f = document.createElement('input');
      f.type = 'text'; f.value = names[i]; f.maxLength = 20; f.dataset.i = i; f.dir = 'auto';
      f.setAttribute('aria-label', O.t ? t('period_name_n', { n: i + 1 }) : 'Name of period ' + (i + 1)); f.setAttribute('enterkeyhint', 'done');
      f.autocomplete = 'off'; f.spellcheck = false;
      namesEl.appendChild(f);
    }
  }
  function drawTools(){
    var t = O.tools(), pen = startPen(O.pen), ps = el.querySelectorAll('[data-pen]');
    for (var i = 0; i < ps.length; i++) ps[i].classList.toggle('on', ps[i].dataset.pen === pen);
    var w = tr(), esc = function(x){ return String(x).replace(/[&<]/g, function(c){ return c === '&' ? '&amp;' : '&lt;'; }); };
    var ls = el.querySelectorAll('[data-lang]');
    for (i = 0; i < ls.length; i++) ls[i].classList.toggle('on', ls[i].dataset.lang === w.lang);
    el.querySelector('.ob-tools').innerHTML = O.t ?
      esc(w(t.finger ? 'finger_scrolls' : 'finger_draws')) + ' · ' + esc(w('pen_size')) + ' ' + t.width + ' · ' + esc(w('smoothing')) + ' ' + (t.smooth || esc(w('off'))) +
        ' · ' + esc(w('highlighter')) + ' <span class="ob-sw" style="background:' + t.hlColor + '"></span> ' + t.hlStrength + '%' :
      'Finger ' + (t.finger ? 'scrolls' : 'draws') + ' · Pen size ' + t.width +
      ' · Smoothing ' + (t.smooth || 'off') + ' · Highlighter <span class="ob-sw" style="background:' + t.hlColor + '"></span> ' + t.hlStrength + '%';
  }
  function show(open){
    if (open) {
      names = (O.periods && O.periods()) || loadPeriods(O.defaults);
      touched = false; err.hidden = true;
      draw(); drawTools();
      if (O.onOpen) O.onOpen();
    }
    el.hidden = !open;
  }
  function done(){
    if (touched) {
      var clean = cleanPeriods(names);
      if (!clean) { err.textContent = O.t ? tr()('name_err') : 'Each period needs a name, and no two can be the same.'; err.hidden = false; return; }
      if (O.applyPeriods(clean) === false) return;
      try { localStorage.setItem('ob-periods', JSON.stringify(clean)); } catch(e){}
    }
    if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
    show(false);
  }
  function change(next){ names = next; touched = true; err.hidden = true; draw(); }
  el.addEventListener('click', function(e){
    if (e.target === el) return done();   // a tap outside the box
    var b = e.target.closest('button'); if (!b) return;
    var s = b.dataset.s;
    if (s === 'done') done();
    else if (s === 'fewer' && names.length > 1) change(names.slice(0, -1));
    else if (s === 'more' && names.length < 12) {
      var style = null, bs = el.querySelectorAll('[data-style].on');
      if (bs.length) style = bs[0].dataset.style;
      if (style) change(periodPreset(style, names.length + 1));
      else { var k = names.length + 1; while (names.indexOf('P' + k) >= 0) k++; change(names.concat('P' + k)); }
    }
    else if (b.dataset.style) change(periodPreset(b.dataset.style, names.length));
    else if (b.dataset.lang) {   // language: the caller saves it and re-translates everything, this box included
      if (O.setLang) O.setLang(b.dataset.lang);
      draw(); drawTools();
    }
    else if (b.dataset.pen) {
      try { localStorage.setItem('ob-pen-color', b.dataset.pen); } catch(e2){}
      O.setPen(b.dataset.pen); drawTools();
    }
    else if (s === 'reset') confirmTap(b, function(){
      ['ink-width', 'ink-hl-width', 'ink-hl-color', 'ink-custom', 'ink-hl-mode', 'ink-hl-strength', 'ink-cover-color', 'ink-smooth', 'ink-finger', 'ob-pen-color']
        .forEach(function(k){ try { localStorage.removeItem(k); } catch(e3){} });
      O.resetTools(); drawTools();
    }, O.t ? tr()('sure') : 'Sure?');
  });
  namesEl.addEventListener('input', function(e){
    var i = +e.target.dataset.i; names = names.slice(); names[i] = e.target.value; touched = true; err.hidden = true;
    var bs = el.querySelectorAll('[data-style]');   // a typed name means none of the styles any more (redrawing would drop the keyboard)
    for (var j = 0; j < bs.length; j++) bs[j].classList.toggle('on', periodPreset(bs[j].dataset.style, names.length).join('\n') === names.join('\n'));
  });
  namesEl.addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });   // closes the on-screen keyboard
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !el.hidden) done(); });
  return { el: el, show: show };
}

/* ---- the ⏱ Timer, the same in the PDF app and the overlay ----
   Setting the time is all big taps: presets and − / + minutes (hold to go faster). No typing.
   The countdown floats over the page in its own box: drag it aside, shrink it to a small box, or close it.
   It never touches the ink: drawing listens on the page itself, and a stroke that passes under the box keeps
   going (the page holds on to the pen until it lifts).
   At zero the box flashes and a sound plays: a short chime made on the spot (Web Audio, no sound file), or the
   teacher's own .wav / .mp3 from Settings ▸ Timer sound, kept in this browser's database. Browsers only allow
   sound after a tap, so tapping Start (or Test sound) switches sound on.
   O = { t(): the current translator, bar: the toolbar, btn: the toolbar's Timer button (shows the time left),
         loadSound(): Promise of { name, type, data: ArrayBuffer } or null, saveSound(rec or null): Promise of true / false }
   Returns { open(), soundEl: the section for Settings, syncSound(), refresh(), els: [setup box, timer box] }. */
function makeTimer(O){
  var PRESETS = [1, 2, 3, 5, 10, 15], MAX = 99, SOUND_MAX = 5 * 1024 * 1024;
  function tr(k, v){ return O.t ? O.t()(k, v) : k; }
  function ls(k, v){ try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch(e){} return null; }
  var mins = parseInt(ls('ob-timer-min'), 10); if (!(mins >= 1 && mins <= MAX)) mins = 5;
  var total = 0, left = 0, endAt = 0, running = false, up = false, tick = null, pos = null;
  try { pos = JSON.parse(ls('ob-timer-pos')); } catch(e){}

  /* the setup box: − / + minutes, presets, Start */
  var set = document.createElement('div'), pre = '';
  set.id = 'ob-timerset'; set.hidden = true;
  set.setAttribute('role', 'dialog'); set.setAttribute('aria-modal', 'true'); set.setAttribute('aria-label', 'Timer'); set.setAttribute('data-ta', 'timer');
  for (var i = 0; i < PRESETS.length; i++) pre += '<button data-min="' + PRESETS[i] + '"></button>';
  set.innerHTML = '<div class="ob-box"><div class="ob-head"><strong data-t="timer">Timer</strong><button data-ts="cancel" data-t="cancel">Cancel</button></div>' +
    '<div class="ob-tm-pick"><button data-ts="less" aria-label="One minute less" title="One minute less" data-ta="timer_less" data-tt="timer_less">&minus;</button>' +
    '<b class="ob-tm-val" dir="ltr"></b>' +
    '<button data-ts="more" aria-label="One minute more" title="One minute more" data-ta="timer_more" data-tt="timer_more">+</button></div>' +
    '<div class="ob-tm-presets">' + pre + '</div>' +
    '<button data-ts="start" class="ob-tm-start" data-t="timer_start">Start</button></div>';
  document.body.appendChild(set);
  var val = set.querySelector('.ob-tm-val');
  function drawSet(){
    val.textContent = mins + ':00';
    var bs = set.querySelectorAll('[data-min]');
    for (var i = 0; i < bs.length; i++) { bs[i].textContent = tr('n_min', { n: bs[i].dataset.min }); bs[i].classList.toggle('on', +bs[i].dataset.min === mins); }
    set.querySelector('[data-ts="less"]').disabled = mins <= 1;
    set.querySelector('[data-ts="more"]').disabled = mins >= MAX;
  }
  function stepMin(d){ var m = Math.min(MAX, Math.max(1, mins + d)); if (m === mins) return false; mins = m; drawSet(); return true; }
  holdRepeat(set.querySelector('[data-ts="less"]'), function(){ return stepMin(-1); });
  holdRepeat(set.querySelector('[data-ts="more"]'), function(){ return stepMin(1); });
  function showSet(open){ if (open) drawSet(); set.hidden = !open; }
  set.addEventListener('click', function(e){
    if (e.target === set) return showSet(false);   // a tap outside the box
    var b = e.target.closest('button'); if (!b) return;
    var a = b.dataset.ts;
    if (b.dataset.min) { mins = +b.dataset.min; drawSet(); }
    else if (a === 'cancel') showSet(false);
    else if (a === 'start') start();
    else if ((a === 'less' || a === 'more') && e.detail === 0) stepMin(a === 'less' ? -1 : 1);   // keyboard only; taps are handled on pointerdown
  });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !set.hidden) showSet(false); });

  /* the countdown box */
  var box = document.createElement('div');
  box.id = 'ob-timer'; box.hidden = true;
  box.setAttribute('role', 'timer'); box.setAttribute('aria-label', 'Timer'); box.setAttribute('data-ta', 'timer');
  box.innerHTML = '<div class="ob-tm-face" title="Drag to move the timer. When it\'s small, tap to make it big." data-tt="timer_drag">' +
      '<span class="ob-tm-msg" data-t="times_up">Time\'s up!</span><b dir="ltr"></b></div>' +
    '<div class="ob-tm-btns">' +
      '<button data-tm="pause" title="Pause the countdown, or start it again" data-tt="timer_pause_tip"></button>' +
      '<button data-tm="reset" aria-label="Reset" data-ta="timer_reset" title="Back to the start time (paused)" data-tt="timer_reset_tip">&#8634;</button>' +
      '<button data-tm="plus" aria-label="Add a minute" data-ta="timer_plus" title="Add a minute" data-tt="timer_plus">+1</button>' +
      '<button data-tm="small" aria-label="Make the timer small" data-ta="timer_small" title="Shrink the timer out of the way; tap it to make it big again" data-tt="timer_small_tip">&#9601;</button>' +
      '<button data-tm="close" aria-label="Close the timer" data-ta="timer_close" title="Close the timer (tap twice while it\'s running)" data-tt="timer_close_tip">&times;</button>' +
    '</div>';
  document.body.appendChild(box);
  var face = box.querySelector('.ob-tm-face'), digits = face.querySelector('b'), pauseBtn = box.querySelector('[data-tm="pause"]');

  function fmt(ms){ var s = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(s / 60); s %= 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function remaining(){ return running ? endAt - Date.now() : left; }
  function draw(){
    var ms = remaining(), k = running ? 'timer_pause' : left < total ? 'timer_resume' : 'timer_start';
    digits.textContent = fmt(ms);
    box.classList.toggle('up', up);
    box.classList.toggle('soon', running && ms <= 10000);   // the last ten seconds turn yellow
    box.classList.toggle('paused', !running && !up);
    pauseBtn.setAttribute('data-t', k); pauseBtn.textContent = tr(k); pauseBtn.disabled = up;
    if (O.btn) O.btn.textContent = box.hidden ? tr('timer_btn') : '⏱ ' + fmt(ms);
  }
  function loop(on){
    clearInterval(tick); tick = null;
    if (on) tick = setInterval(function(){ if (endAt - Date.now() <= 0) finish(); else draw(); }, 200);
  }
  function run(){ endAt = Date.now() + left; running = true; up = false; loop(true); draw(); }
  function pause(){ left = Math.max(0, endAt - Date.now()); running = false; loop(false); draw(); }
  function finish(){ running = false; up = true; left = 0; loop(false); setSmall(false); draw(); ring(); }
  function reset(){ stopSound(); running = false; up = false; left = total; loop(false); draw(); }
  function plus(){
    stopSound();
    if (up) { up = false; left = 60000; return run(); }
    if (running) endAt = Math.min(endAt + 60000, Date.now() + MAX * 60000);
    else left = Math.min(left + 60000, MAX * 60000);
    draw();
  }
  function close(){ stopSound(); running = false; up = false; loop(false); box.hidden = true; draw(); }
  function start(){
    audio();   // this tap is what lets the page make a sound at zero
    loadBuffer();
    ls('ob-timer-min', String(mins));
    total = left = mins * 60000;
    showSet(false);
    var was = box.hidden;
    box.hidden = false; box.classList.remove('small');
    if (was) place();
    run(); fitLabels(box);
  }

  /* moving it: drag the numbers with a finger or the pen (a palm on it does nothing) */
  function moveTo(x, y){
    var w = box.offsetWidth, h = box.offsetHeight;
    x = Math.max(4, Math.min(x, innerWidth - w - 4)); y = Math.max(4, Math.min(y, innerHeight - h - 4));
    box.style.left = x + 'px'; box.style.top = y + 'px';
    pos = { x: Math.round(x), y: Math.round(y) };
  }
  function place(){   // where it was left last time, else the top corner away from the toolbar
    if (pos && typeof pos.x === 'number') return moveTo(pos.x, pos.y);
    var right = O.bar && O.bar.classList.contains('right');
    moveTo(right ? 24 : innerWidth - box.offsetWidth - 24, 24);
  }
  function setSmall(small){
    if (box.hidden || box.classList.contains('small') === small) return;
    var r = box.getBoundingClientRect(), keepRight = r.left + r.width / 2 > innerWidth / 2;   // stay against the nearer side
    box.classList.toggle('small', small);
    moveTo(keepRight ? r.right - box.offsetWidth : r.left, r.top);
    ls('ob-timer-pos', JSON.stringify(pos));
  }
  var drag = null;
  face.addEventListener('pointerdown', function(e){
    if (pointerKind(e) === 'palm' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    var r = box.getBoundingClientRect();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, l: r.left, t: r.top, moved: false };
    try { face.setPointerCapture(e.pointerId); } catch(_){}
  });
  face.addEventListener('pointermove', function(e){
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 8) return;   // a tap wobbles a little
    drag.moved = true; moveTo(drag.l + dx, drag.t + dy);
  });
  function endDrag(e){
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag; drag = null;
    if (d.moved) return ls('ob-timer-pos', JSON.stringify(pos));
    if (e.type !== 'pointerup') return;
    if (up) reset();                                     // a tap on a flashing timer stops the alert
    else if (box.classList.contains('small')) setSmall(false);
  }
  face.addEventListener('pointerup', endDrag);
  face.addEventListener('pointercancel', endDrag);
  face.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  window.addEventListener('resize', function(){ if (!box.hidden) moveTo(parseFloat(box.style.left) || 0, parseFloat(box.style.top) || 0); });
  box.addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    audio();
    var a = b.dataset.tm;
    if (a === 'pause') { if (running) pause(); else run(); }
    else if (a === 'reset') reset();
    else if (a === 'plus') plus();
    else if (a === 'small') setSmall(true);
    else if (a === 'close') { if (running) confirmTap(b, close, tr('sure')); else close(); }
  });

  /* sound: the built-in chime, or the teacher's own file */
  var actx = null, rec, buf = null, playing = null;   // rec: { name, type, data } or null for the chime; undefined until read
  function audio(){
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { if (!actx) actx = new C(); if (actx.state === 'suspended') actx.resume(); } catch(e){ return null; }
    return actx;
  }
  function chime(ctx){   // three bell notes, twice: each a sine tone plus a faint higher one, struck and fading out
    var t0 = ctx.currentTime + 0.05, notes = [784, 988, 1319];
    for (var r = 0; r < 2; r++) for (var i = 0; i < notes.length; i++) {
      var at = t0 + r * 1.1 + i * 0.25;
      [[notes[i], 0.3], [notes[i] * 2.76, 0.05]].forEach(function(p){
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = p[0];
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(p[1], at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 1.4);
        o.connect(g); g.connect(ctx.destination);
        o.start(at); o.stop(at + 1.5);
      });
    }
  }
  function getRec(){
    if (rec !== undefined) return Promise.resolve(rec);
    return Promise.resolve(O.loadSound ? O.loadSound() : null).then(function(r){ rec = r && r.data ? r : null; return rec; }, function(){ rec = null; return null; });
  }
  function decode(ctx, data){
    return new Promise(function(ok, bad){
      try { var p = ctx.decodeAudioData(data.slice(0), ok, bad); if (p && p.then) p.then(ok, bad); } catch(e){ bad(e); }
    });
  }
  function loadBuffer(){   // get the teacher's sound ready to play
    var ctx = audio(); if (!ctx) return Promise.resolve(null);
    return getRec().then(function(r){
      if (!r) return null;
      if (buf && buf.rec === r) return buf.b;
      return decode(ctx, r.data).then(function(b){ buf = { rec: r, b: b }; return b; }, function(){ return null; });
    });
  }
  function stopSound(){ if (playing) { try { playing.stop(); } catch(e){} playing = null; } }
  function ring(){
    var ctx = audio(); if (!ctx) return;
    stopSound();
    var b = rec && buf && buf.rec === rec ? buf.b : null;
    if (!b) return chime(ctx);
    var s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(); playing = s;
  }

  /* Settings ▸ Timer sound */
  var snd = document.createElement('div');
  snd.className = 'ob-tm-sound';
  snd.innerHTML = '<h3 data-t="timer_sound">Timer sound</h3><p class="ob-tm-now"></p>' +
    '<div class="ob-tm-sbtns"><button data-snd="test" data-t="test_sound">&#9654; Test sound</button><button data-snd="pick" data-t="choose_sound">Choose a sound…</button></div>' +
    '<button data-snd="chime" class="ob-tm-chime" data-t="use_chime" hidden>Back to the built-in chime</button>' +
    '<p class="ob-hint" data-t="sound_hint">Your own sound: a .wav or .mp3 file, up to 5 MB. It stays in this browser.</p>' +
    '<p class="ob-err" role="alert" hidden></p>' +
    '<input type="file" accept=".wav,.mp3,audio/wav,audio/x-wav,audio/wave,audio/mpeg" hidden>';
  var now = snd.querySelector('.ob-tm-now'), err = snd.querySelector('.ob-err'), file = snd.querySelector('input');
  function syncSound(){
    return getRec().then(function(r){
      now.textContent = tr('sound_now', { name: r ? r.name : tr('chime') });
      snd.querySelector('[data-snd="chime"]').hidden = !r;
    });
  }
  function oops(k){ err.textContent = tr(k); err.hidden = false; }
  function keep(r){
    stopSound();
    return Promise.resolve(O.saveSound ? O.saveSound(r) : false).then(function(ok){
      if (!ok) return oops('sound_save_fail');
      rec = r; buf = null; return syncSound();
    });
  }
  snd.addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    err.hidden = true;
    if (b.dataset.snd === 'test') { audio(); stopSound(); loadBuffer().then(ring); }
    else if (b.dataset.snd === 'pick') { file.value = ''; file.click(); }
    else if (b.dataset.snd === 'chime') keep(null);
  });
  file.addEventListener('change', function(){
    var f = file.files && file.files[0]; if (!f) return;
    err.hidden = true;
    if (!/\.(wav|mp3)$/i.test(f.name) && !/^audio\/(wav|x-wav|wave|mpeg|mp3)$/.test(f.type)) return oops('sound_bad');
    if (f.size > SOUND_MAX) return oops('sound_too_big');
    var ctx = audio();
    (f.arrayBuffer ? f.arrayBuffer() : new Response(f).arrayBuffer()).then(function(data){
      var r = { name: f.name, type: f.type, data: data };
      return (ctx ? decode(ctx, data) : Promise.resolve(null)).then(function(b){   // only keep a file this browser can play
        return keep(r).then(function(){ if (b && rec === r) buf = { rec: r, b: b }; });
      }, function(){ oops('sound_bad'); });
    });
  });

  draw();
  return {
    open: function(){ showSet(true); },
    soundEl: snd, syncSound: syncSound, els: [set, box],
    refresh: function(){ if (!set.hidden) drawSet(); draw(); if (!snd.offsetParent) return; syncSound(); },   // after the language changes
  };
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

export { makeTimer, paletteColors, setPalette, fitLabels, periodPreset, cleanPeriods, loadPeriods, startPen, remapPeriods, makePeriodPicker, makeSettings, fitTools, makePopMenu, historyKey, seeThrough, hlInk, placeMenu, makeHlMenu, tint, pointerKind, inkStyle, paintStroke, liveStart, liveAdd, livePieces, liveEndPieces, paintPieces, liveLift, holdRepeat, confirmTap, flashBtn };   // @strip-inline
