// The drawing tools on the toolbar: pen, highlighter, eraser, Select, Type, colors, size, smoothing and class periods.

import { holdRepeat, makePeriodPicker, setPalette, showLaser } from '../shared/ink-core.js';
import { ink, setStatus, typing, viewer } from './core.js';
import { closeMenus, hlMenu } from './menus.js';
import { refreshZoom, zoomBy } from './page-view.js';
import {
  $,
  bar,
  customFill,
  D,
  pagesEl,
  periodsEl,
  picker,
  setLS,
  sizeDot,
  sizeNum,
  smoothNum,
  T,
  tr,
} from './state.js';

/* ---------- class periods ---------- */
// one button per period, or a "P5 ▾" list when they don't fit (shared with the overlay)
export let periodPicker;
export function initPeriods() {
  periodPicker = makePeriodPicker(
    bar,
    periodsEl,
    (name) => {
      if (ink.switchTo(name)) renderPeriods();
      refresh();
    },
    () => closeMenus('periods'),
    (k, v) => tr(k, v)
  );
}
export function renderPeriods() {
  periodPicker.render(Object.keys(D.periods), D.active);
}

/* ---------- toolbar ---------- */
const isPreset = (c) => !!bar.querySelector('[data-color="' + c + '"]');
export function refresh() {
  setPalette(bar, T.hiliting ? (T.covering ? 'cover' : 'hl') : 'pen', tr); // the swatches change with the tool
  for (const b of bar.querySelectorAll('[data-color]'))
    b.classList.toggle('on', !T.erasing && b.dataset.color === T.color);
  showLaser(bar, T.laser, laserReady(), tr);
  $('[data-act="custom"]', bar).classList.toggle(
    'on',
    !T.erasing && !!T.customColor && T.color === T.customColor && !isPreset(T.color)
  );
  customFill.style.background = T.customColor || 'transparent';
  const w = T.hiliting ? T.hlWidth : T.width,
    shown = T.hiliting && !T.covering ? T.hlInk() : T.color;
  sizeNum.textContent = w;
  sizeDot.style.width = sizeDot.style.height = Math.min(w, 26) + 'px';
  sizeDot.style.background = shown;
  smoothNum.textContent = T.smooth ? T.smooth : tr('off');
  $('[data-act="erase"]', bar).classList.toggle('on', T.erasing);
  $('[data-act="select"]', bar).classList.toggle('on', T.selecting);
  $('[data-act="type"]', bar).classList.toggle('on', T.typing);
  pagesEl.classList.toggle('type-mode', T.typing);
  const hb = $('[data-act="hilite"]', bar);
  hb.classList.toggle('on', T.hiliting && !T.erasing && !T.selecting);
  hb.classList.toggle('cover', T.covering);
  hb.textContent = tr(T.covering ? 'cover' : 'highlighter'); // the ▾ choice shows on the button
  hlMenu.sync();
  $('[data-act="finger"]', bar).textContent = tr(T.fingerScrolls ? 'finger_scrolls' : 'finger_draws');
  refreshZoom();
}
/* Type: tap the page to type a note (makeTyping in shared/ink-core.js). Eraser, Highlighter and Select turn it off. */
export function typeOff() {
  if (T.typing) {
    T.typing = false;
    typing.close();
  }
}
export function typeOn() {
  T.typing = true;
  T.erasing = false;
  selectOff();
  if (T.hiliting) {
    T.hiliting = false;
    T.color = toolColor();
  } // notes use the pen color
  setStatus(tr('st_type_how'));
}
export function selectOff() {
  if (T.selecting) {
    T.selecting = false;
    ink.dropSel();
  }
}
export function toolColor() {
  return T.hiliting ? (T.covering ? T.coverColor : T.hlColor) : T.penColor;
}
function laserReady() {
  return !T.erasing && !T.selecting && !T.typing && !(T.hiliting && T.covering);
} // pen and highlighter colors only
/* a tap on a color swatch: the color you already have selected turns the laser pointer on or off; any other color just picks it */
export function tapColor(c) {
  const again = c === T.color && laserReady(),
    was = T.laser;
  pickColor(c);
  if (again) {
    T.laser = !was;
    if (T.laser) ink.laser.sound();
    setStatus(tr(T.laser ? 'st_laser_on' : 'st_laser_off'));
  }
}
export function pickColor(c) {
  T.color = c;
  T.laser = false;
  if (T.hiliting && T.covering) {
    T.coverColor = c;
    setLS('ink-cover-color', c);
  } else if (T.hiliting) {
    T.hlColor = c;
    setLS('ink-hl-color', c);
  } else T.penColor = c;
  T.erasing = false;
  selectOff();
  if (T.typing) typing.restyle();
  refresh();
}
/* - / + : size controls the highlighter width while it's on */
function stepSize(dir) {
  if (T.hiliting) {
    const hv = Math.min(40, Math.max(8, T.hlWidth + dir * 2));
    if (hv === T.hlWidth && !T.erasing) return false;
    T.hlWidth = hv;
    setLS('ink-hl-width', hv);
  } else {
    const w = Math.min(14, Math.max(1, T.width + dir * 0.5));
    if (w === T.width && !T.erasing) return false;
    T.width = w;
    setLS('ink-width', w);
  }
  T.erasing = false;
  selectOff();
  if (T.typing) typing.restyle();
  refresh();
  return true;
}
function stepSmooth(dir) {
  const s = Math.min(8, Math.max(0, T.smooth + dir));
  if (s === T.smooth) return false;
  T.smooth = s;
  refresh();
  setLS('ink-smooth', s);
  return true;
}
export const STEPPERS = {
  thinner: [stepSize, -1],
  thicker: [stepSize, 1],
  rougher: [stepSmooth, -1],
  smoother: [stepSmooth, 1],
};
export function initTools() {
  for (const [act, [step, dir]] of Object.entries(STEPPERS))
    holdRepeat($('[data-act="' + act + '"]', bar), () => step(dir));
  holdRepeat($('[data-act="zoom-in"]', bar), () => {
    if (viewer.zoom >= 6) return false;
    zoomBy(1.1);
    return true;
  });
  holdRepeat($('[data-act="zoom-out"]', bar), () => {
    if (viewer.zoom <= 0.2) return false;
    zoomBy(1 / 1.1);
    return true;
  });

  picker.addEventListener('input', () => {
    T.customColor = picker.value;
    setLS('ink-custom', T.customColor);
    pickColor(T.customColor);
  });
}
