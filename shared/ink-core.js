/* OverBoard shared ink core.
   Used two ways:
   - as an ES module by the PDF app (app/*.js imports it), and
   - inlined into the paste-in overlay (overlay/ink_overlay.html) by tools/build_overlay.py.
   So: plain ES5 function declarations only, no imports, no top-level state.
   The export line at the bottom is stripped when it is inlined.

   Stroke: { c: color, w: width, e: 1 if eraser, h: 1 if highlight, p: [x0,y0,x1,y1,...] }  */

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

export { tint, pointerKind, inkStyle, paintStroke, liveStart, liveAdd, livePieces, liveEndPieces, paintPieces, liveLift, holdRepeat, confirmTap, flashBtn };   // @strip-inline
