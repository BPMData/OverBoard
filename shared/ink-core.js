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
  var covers = [['#111111', 'Cover: black', 'hides answers', 'cover_black'], ['#5f5f5f', 'Cover: dark gray', '', 'cover_dark'], ['#a6a6a6', 'Cover: light gray', '', 'cover_light']];
  var m = document.createElement('div');
  m.id = 'ob-hlmenu'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', 'Highlighter'); m.setAttribute('data-ta', 'highlighter'); m.hidden = true;
  // data-t / data-ta: words translated by obTranslate (shared/strings.js)
  var html = '<button data-mode="hl"><span class="sw hl"></span><span data-t="highlight">Highlight</span><small data-t="see_through">see-through</small></button>' +
    '<label class="strength"><span><span data-t="hl_strength">Highlight strength</span> <b id="ob-hl-pct"></b></span>' +
    '<input type="range" id="ob-hl-strength" min="10" max="100" step="5" aria-label="Highlight strength" data-ta="hl_strength"></label>';
  for (var i = 0; i < covers.length; i++)
    html += '<button data-mode="cover" data-cover="' + covers[i][0] + '"><span class="sw" style="background:' + covers[i][0] + '"></span>' +
      '<span data-t="' + covers[i][3] + '">' + covers[i][1] + '</span>' + (covers[i][2] ? '<small data-t="hides_answers">' + covers[i][2] + '</small>' : '') + '</button>';
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

/* A word that is too wide for its button (longer languages: "Desplazar", "Défiler") gets smaller text,
   down to 10px, instead of stretching the toolbar. Call after the words or the layout change. */
function fitLabels(root){
  var bs = root.querySelectorAll('button');
  for (var i = 0; i < bs.length; i++) {
    var b = bs[i];
    b.style.fontSize = '';
    if (!b.offsetParent || !b.textContent.trim()) continue;
    var px = parseFloat(getComputedStyle(b).fontSize);
    while (b.scrollWidth > b.clientWidth + 0.5 && px > 10) { px -= 1; b.style.fontSize = px + 'px'; }
  }
}

/* Shrink the toolbar (and its popouts) to fit a short window, such as a laptop screen, instead of making it
   scroll. base is the zoom that shows them at normal size: 1, or 1/Z in the overlay while the page is zoomed.
   Call it after the window, the zoom or the toolbar's contents change. Returns the scale used (1 = full size). */
function fitTools(bar, popouts, base){
  var els = [bar].concat(popouts.filter(Boolean)), s = 1;
  fitLabels(bar);
  els.forEach(function(el){ el.style.zoom = base === 1 ? '' : String(base); });
  bar.style.maxHeight = 'none';
  if (bar.hidden || bar.style.display === 'none') { bar.style.maxHeight = ''; return 1; }
  var room = innerHeight * 0.96;
  for (var i = 0; i < 2; i++) {   // text doesn't shrink exactly in proportion, so check once more after scaling
    var h = bar.getBoundingClientRect().height;
    if (h <= room + 0.5 && i === 0) break;
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
         langs: [[code, name], …] and setLang(code) for the Language buttons, t(): the current translator }
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

export { fitLabels, periodPreset, cleanPeriods, loadPeriods, startPen, remapPeriods, makePeriodPicker, makeSettings, fitTools, makePopMenu, historyKey, seeThrough, hlInk, placeMenu, makeHlMenu, tint, pointerKind, inkStyle, paintStroke, liveStart, liveAdd, livePieces, liveEndPieces, paintPieces, liveLift, holdRepeat, confirmTap, flashBtn };   // @strip-inline
