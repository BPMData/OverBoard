// Settings & help ▸ Settings…, the Timer and the language list (all shared with the overlay through shared/ink-core.js).

import { obLangs, obT, obTranslate } from '../shared/strings.js';
import { makeSettings, makeTimer, paletteColors, remapPeriods } from '../shared/ink-core.js';
import * as store from './store.js';
import { ink, setStatus, typing } from './core.js';
import { closeMenus, fitToolbar, layoutClear } from './menus.js';
import { refreshZoom } from './page-view.js';
import { refreshLink } from './saving.js';
import { renderRecent } from './start-screen.js';
import {
  $,
  bar,
  COVER_COLOR,
  D,
  doc,
  FINGER_SCROLLS,
  HIGHLIGHT_COLOR,
  HIGHLIGHT_STRENGTH,
  HIGHLIGHT_W,
  pagesBtn,
  pagesTotal,
  PEN_COLOR,
  PERIODS,
  setTr,
  SMOOTHING,
  T,
  tr,
} from './state.js';
import { refresh, renderPeriods, toolColor } from './tools.js';
import { refreshRedo } from './main.js';

/* ---------- ⏱ Timer (shared with the overlay). Its own sound (Settings ▸ Timer sound) is kept beside the ink. ---------- */
const SOUND_KEY = 'ob-timer-sound';
export let timer, settings;
export function initSettings() {
  timer = makeTimer({
    t: () => tr,
    bar,
    btn: $('[data-act="timer"]', bar),
    loadSound: () => store.loadExtra(SOUND_KEY).catch(() => null),
    saveSound: (rec) =>
      (rec ? store.saveExtra(SOUND_KEY, rec) : store.dropExtra(SOUND_KEY)).then(
        () => true,
        () => false
      ),
  });
  settings = makeSettings({
    defaults: PERIODS,
    pen: PEN_COLOR,
    extra: timer.soundEl,
    colors: paletteColors('pen').map((c) => [c[0], c[2], c[1]]),
    langs: obLangs(),
    setLang,
    t: () => tr,
    periods: () => (D ? Object.keys(D.periods) : null),
    applyPeriods(names) {
      if (!D) return true;
      const r = remapPeriods(D.periods, D.active, names);
      if (r.same) return true;
      if (r.lost.length && !confirm(tr('confirm_remove_pdf', { list: r.lost.join(', ') }))) return false;
      ink.setPeriods(r.periods, r.active);
      renderPeriods();
      refreshRedo();
      setStatus(tr('st_periods_changed', { p: D.active }));
      return true;
    },
    tools: () => ({
      finger: T.fingerScrolls,
      width: T.width,
      smooth: T.smooth,
      hlColor: T.hlColor,
      hlStrength: T.hlStrength,
    }),
    setPen(c) {
      T.penColor = c;
      if (!T.hiliting) T.color = c;
      T.erasing = false;
      T.laser = false;
      if (T.typing) typing.restyle();
      refresh();
    },
    resetTools() {
      Object.assign(T, {
        width: 2.5,
        hlWidth: HIGHLIGHT_W,
        hlColor: HIGHLIGHT_COLOR,
        customColor: '',
        covering: false,
        hlStrength: HIGHLIGHT_STRENGTH,
        coverColor: COVER_COLOR,
        smooth: SMOOTHING,
        fingerScrolls: FINGER_SCROLLS,
        penColor: PEN_COLOR,
        erasing: false,
        laser: false,
      });
      T.color = toolColor();
      refresh();
    },
    onOpen: () => {
      closeMenus();
      timer.syncSound();
    },
  });
  for (const [code, name] of obLangs()) langPick.append(new Option(name, code));
  langPick.addEventListener('change', () => setLang(langPick.value));
}

/* ---------- File ▸ Settings… (shared with the overlay) ---------- */

/* ---------- language (Settings ▸ Language, or the 🌐 list on the start screen; shared/strings.js) ---------- */
const langPick = $('#ob-lang');
export function translateAll() {
  obTranslate(document.body, tr); // everything marked data-t / data-th / data-tt / data-ta / data-tp
  $('[data-act="clear"]', bar).textContent = tr('clear') + ' ▸';
  pagesBtn.textContent = tr('pages') + ' ▸';
  langPick.value = tr.lang;
  $('#ob-start a[href^="report/"]').href = 'report/?from=start&lang=' + tr.lang;
}
function setLang(code) {
  // remember the choice and put the new words everywhere at once (no reload)
  try {
    localStorage.setItem('ob-lang', code);
  } catch (e) {
    /* blocked */
  }
  setTr(obT(code));
  translateAll();
  renderRecent();
  timer.refresh();
  if (!doc) return;
  refresh();
  refreshLink();
  layoutClear();
  renderPeriods();
  refreshZoom();
  pagesTotal.textContent = tr('of_n', { n: doc.pages });
  fitToolbar();
  setStatus(tr('st_ready', { p: D.active }));
}
