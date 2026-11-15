// @ts-nocheck  (build script, not part of the app)
// Generates the OverBoard / AllAboard / OverHeard icon family.
//
// Source of truth: the geometry in this file. `node generate-icons.mjs` rewrites
//   src/<app>.svg        master art (used for 32px and up)
//   src/<app>-16.svg     simplified art for 16px (no rim, ink or caption lines)
//   src/<app>-mono.svg   one-color silhouette test
//   exports/<app>/...    PNGs, favicon.svg and a 16/32/48 favicon.ico
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';

export const APPS = {
  overboard: { name: 'OverBoard', bg: '#145DA0' },
  allaboard: { name: 'AllAboard', bg: '#087F73' },
  overheard: { name: 'OverHeard', bg: '#5843A5' },
  'overheard-megaphone': { name: 'OverHeard', bg: '#5843A5' },   // alternate rig
};
const FG = '#FFFFFF';
const CORNER = 13;

// ---------- the whiteboard boat, in its own local coordinates ----------
// Origin = top-left of the whiteboard hull. Everything above it has negative y.
const B = {
  hullW: 40, hullH: 18, hullR: 4, rim: 3.2,
  mastX: 9, mastW: 3.5, mastTop: -24,
  sailX: 14, sailTop: -22, sailFoot: -4, sailReach: 22,
};

const rect = (x, y, w, h, r, attrs) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ${attrs}/>`;

// The board is a parallelogram: its top edge sits ahead of its bottom edge,
// like a raked cutter prow. SKEW is in degrees; the shift is split evenly so
// the board stays centered under the mast.
const SKEW = 16;
const skewBoard = (inner) => {
  const shift = (B.hullH * Math.tan((SKEW * Math.PI) / 180)) / 2;
  return `<g transform="translate(${f(shift)} 0) skewX(${-SKEW})">${inner}</g>`;
};

const hullShape = (c, grow = 0) =>
  rect(-grow, -grow, B.hullW + 2 * grow, B.hullH + 2 * grow, B.hullR + grow, `fill="${c}"`);

const mastShape = (c, grow = 0, top = B.mastTop) =>
  rect(B.mastX - grow, top - grow, B.mastW + 2 * grow, -top + 2 + 2 * grow, B.mastW / 2 + grow, `fill="${c}"`);

// Main sail: a true triangle. Straight luff beside the mast, foot parallel to
// the board, and a leech with only a slight outward belly (`belly` units).
function sailShape(c, grow = 0, { top = B.sailTop, reach = B.sailReach, belly = 1.2 } = {}) {
  const x0 = B.sailX, x1 = x0 + reach, y1 = B.sailFoot, h = y1 - top;
  const len = Math.hypot(reach, h), nx = h / len, ny = -reach / len;    // outward normal
  const cx = (x0 + x1) / 2 + nx * belly * 2, cy = (top + y1) / 2 + ny * belly * 2;
  const d = `M${x0} ${top} Q${f(cx)} ${f(cy)} ${x1} ${y1} L${x0} ${y1} Z`;
  return `<path d="${d}" fill="${c}" stroke="${c}" stroke-width="${1.5 + 2 * grow}" stroke-linejoin="round"/>`;
}
const f = (n) => +n.toFixed(2);

// OverHeard's signal pennant: tapered flag flying from the masthead, with a
// speech-bubble tail dropping from its lower edge back toward the mast.
function signalFlagShape(c, grow = 0) {
  const x0 = B.mastX + B.mastW + 1.5, top = -24, hMast = 16, len = 23, hFly = 10;
  const yB = top + hMast, yF = top + (hMast - hFly) / 2, xF = x0 + len;
  const d = [
    `M${x0} ${top}`,
    `L${xF} ${yF}`, `L${xF - 5} ${yF + hFly / 2}`, `L${xF} ${yF + hFly}`,  // swallowtail fly
    `L${x0 + 9} ${yB - 1.6}`,                                               // lower edge
    `L${x0 + 1.5} ${yB + 6}`,                                               // speech tail tip
    `L${x0 + 3.2} ${yB - 0.3}`, `L${x0} ${yB} Z`,
  ].join(' ');
  return `<path d="${d}" fill="${c}" stroke="${c}" stroke-width="${1.5 + 2 * grow}" stroke-linejoin="round"/>`;
}

// Alternate OverHeard rig: a megaphone mounted on the mast, bell facing forward,
// with sound lines (master size only).
function megaphoneShape(c, grow = 0, small = false) {
  const x0 = B.mastX + B.mastW, cy = -15.5;
  const d = `M${x0} ${cy - 2.5} L${x0 + 4} ${cy - 3} L${x0 + 17} ${cy - 9} L${x0 + 17} ${cy + 9} L${x0 + 4} ${cy + 3} L${x0} ${cy + 2.5} Z`;
  let out = `<path d="${d}" fill="${c}" stroke="${c}" stroke-width="${2 + 2 * grow}" stroke-linejoin="round"/>`;
  if (!small && !grow) {
    const sx = x0 + 20;
    out += `<path d="M${sx} ${cy - 6.5} l3 -2.2 M${sx + 0.5} ${cy} h4 M${sx} ${cy + 6.5} l3 2.2" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
  }
  return out;
}

// Details drawn on the board surface (master size only).
const rimShape = (bg) =>
  rect(B.rim, B.rim, B.hullW - 2 * B.rim, B.hullH - 2 * B.rim, 1.5,
    `fill="none" stroke="${bg}" stroke-opacity="0.32" stroke-width="1.3"`);
const inkShape = (bg) =>
  `<path d="M8 12.5 C11 8 14.5 5.5 16.5 7.5 C18 9 15.5 13.5 18.5 13 C21.5 12.5 23 8 26 8.5 C28.5 9 27 12.5 30 12 C31.5 11.8 32.5 11 33 10.5" fill="none" stroke="${bg}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
const captionShape = (bg) =>
  `<path d="M8 7.5h24M8 12.5h14" stroke="${bg}" stroke-width="3" stroke-linecap="round"/>`;

// A whole boat. `rig` picks the sail; `grow` > 0 draws a background-colored
// halo version (drawn under nearer boats so overlaps stay crisp).
function boat({ bg, small, rig = 'sail', detail = 'none', sail = {}, mastTop, fg = FG }) {
  const parts = (c, g) =>
    mastShape(c, g, mastTop) +
    (rig === 'flag' ? signalFlagShape(c, g)
      : rig === 'megaphone' ? megaphoneShape(c, g, small)
      : sailShape(c, g, sail)) +
    skewBoard(hullShape(c, g));
  let out = parts(fg, 0);
  if (!small)
    out += skewBoard(rimShape(bg) +
      (detail === 'ink' ? inkShape(bg) : '') + (detail === 'captions' ? captionShape(bg) : ''));
  return { body: out, halo: parts(bg, 2.4) };
}

// Position a boat. `tilt` (degrees) rotates it about the middle of the hull's
// bottom edge, so the boat rocks on the water instead of swinging.
const TILT = Number(process.env.TILT ?? -3.5);   // degrees; negative leans left, 0 = level
const place = (x, y, s, inner, tilt = TILT) =>
  `<g transform="translate(${x} ${y}) scale(${s}) rotate(${tilt} ${B.hullW / 2} ${B.hullH})">${inner}</g>`;

// Three separate breaking waves: a rising curve that hooks over at the crest.
const WAVES = [[7.5, 52], [24, 53.5], [40.5, 52]];   // left x, crest y of each wave
function wave(small) {
  const w = small ? 3.8 : 3.2;
  // rise from the trough, roll over the crest, curl the lip forward and down
  const one = ([x, y]) =>
    `M${x} ${y + 7} C${x + 4} ${y + 6} ${x + 6} ${y} ${x + 10} ${y} C${x + 13} ${y} ${x + 14.5} ${y + 2.5} ${x + 12.5} ${y + 4.5}`;
  return `<path d="${WAVES.map(one).join(' ')}" fill="none" stroke="${FG}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// Blend a hex color toward white (t = 0..1); used for the rear boats.
const tint = (hex, t) => '#' + [1, 3, 5].map((i) => {
  const c = parseInt(hex.slice(i, i + 2), 16);
  return Math.round(c + (255 - c) * t).toString(16).padStart(2, '0');
}).join('');

// ---------- the three compositions ----------
// OverBoard and OverHeard place the identical boat at the identical spot.
const HERO = { x: 12, y: 29, s: 1 };

const COMPOSE = {
  overboard: (bg, small) =>
    place(HERO.x, HERO.y, HERO.s, boat({ bg, small, detail: 'ink' }).body) + wave(small),

  overheard: (bg, small) =>
    place(HERO.x, HERO.y, HERO.s, boat({ bg, small, rig: 'flag', detail: 'captions' }).body) + wave(small),

  'overheard-megaphone': (bg, small) =>
    place(HERO.x, HERO.y, HERO.s, boat({ bg, small, rig: 'megaphone', detail: 'captions' }).body) + wave(small),

  // Flotilla: one big board-boat, one fainter smaller boat behind it, and two
  // distant sails breaking the horizon (no hulls, no masts).
  allaboard: (bg, small) => {
    const horizon = [[43, 16.5, 0.34], [50.5, 15.5, 0.27]]   // x, horizon y, scale
      .map(([x, y, s]) => place(x - B.sailX * s, y - B.sailFoot * s, s, sailShape(tint(bg, 0.4), 0, { top: -24, reach: 13, belly: 0.4 }), 0))
      .join('') +
      `<path d="M39 16.5H59" stroke="${tint(bg, 0.32)}" stroke-width="1.4" stroke-linecap="round"/>`;
    const mid = boat({ bg, small: true, fg: tint(bg, 0.55) });
    const front = boat({ bg, small, detail: 'ink' });
    return horizon +
      place(35, 33, 0.5, mid.halo) + place(35, 33, 0.5, mid.body) +
      place(5, 34, 0.78, front.halo) + place(5, 34, 0.78, front.body) +
      wave(small);
  },
};

export function svg(id, { small = false, mono = false } = {}) {
  const bg = mono ? '#000000' : APPS[id].bg;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <title>${APPS[id].name}</title>
  <rect width="64" height="64" rx="${CORNER}" fill="${bg}"/>
  ${COMPOSE[id](bg, small)}
</svg>
`;
}

// ---------- ICO with PNG-compressed entries (all modern browsers) ----------
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, buf }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size % 256, e); head.writeUInt8(size % 256, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(buf.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.buf)]);
}

const render = (svgText, px) =>
  sharp(Buffer.from(svgText), { density: Math.ceil((72 * px) / 64) * 4 })
    .resize(px, px).png({ compressionLevel: 9 }).toBuffer();

mkdirSync('src', { recursive: true });
for (const id of Object.keys(APPS)) {
  const big = svg(id), small = svg(id, { small: true });
  writeFileSync(`src/${id}.svg`, big);
  writeFileSync(`src/${id}-16.svg`, small);
  writeFileSync(`src/${id}-mono.svg`, svg(id, { mono: true }));
  const dir = `exports/${id}`;
  mkdirSync(dir, { recursive: true });
  const out = {
    'favicon-16.png': [small, 16], 'favicon-32.png': [big, 32], 'icon-120.png': [big, 120],
    'apple-touch-icon.png': [big, 180], 'icon-192.png': [big, 192], 'icon-512.png': [big, 512],
  };
  const px = {};
  for (const [file, [s, size]] of Object.entries(out))
    writeFileSync(`${dir}/${file}`, (px[size] = await render(s, size)));
  writeFileSync(`${dir}/favicon.svg`, big);
  writeFileSync(`${dir}/favicon.ico`, ico([
    { size: 16, buf: px[16] }, { size: 32, buf: px[32] }, { size: 48, buf: await render(big, 48) },
  ]));
}
console.log('Wrote src/ and exports/');
