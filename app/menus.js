// The popout menus beside the toolbar (Settings & help, Clear, Pages, Highlighter ▾) and fitting the toolbar to the screen.

import { fitTools, makeHlMenu, makePopMenu } from '../shared/ink-core.js';
import { ink } from './core.js';
import { hasChapters } from './page-view.js';
import { $, bar, doc, pagesBtn, setLS, T, tocBtn, tr } from './state.js';
import { onToolbarClick, periodPicker, refresh, selectOff, toolColor, typeOff } from './main.js';

/* ---------- the Clear buttons ----------
   A PDF with chapters: Chapters | Clear ▸ (a menu: this page or all pages), with Clear on the side the menu
   opens. A blank notebook: Pages ▸ | Clear ▸ the same way. Without chapters: Clear page | Clear all, like the
   HTML overlay. One page: just Clear (beside Pages ▸ in a notebook). */
export function layoutClear() {
  const nb = !!doc && doc.notebook,
    many = !!doc && doc.pages > 1,
    menu = (hasChapters || nb) && many;
  const menuBtn = $('[data-act="clear"]', bar),
    pageBtn = $('[data-act="clear-page"]', bar),
    allBtn = $('[data-act="clear-all"]', bar);
  const partner = nb ? pagesBtn : tocBtn;
  tocBtn.hidden = !hasChapters;
  pagesBtn.hidden = !nb;
  menuBtn.hidden = !menu;
  pageBtn.hidden = menu || !many;
  allBtn.hidden = menu;
  allBtn.classList.toggle('wide', !hasChapters && !nb && !many);
  if (!allBtn.classList.contains('warn')) allBtn.textContent = tr(many ? 'clear_all' : 'clear');
  const right = bar.classList.contains('right');
  if (right) partner.before(menuBtn);
  else partner.after(menuBtn);
  (right ? partner : menuBtn).after(pageBtn, allBtn);
  if (!menu) clearMenu.show(false);
  if (!nb) pageMenu.show(false);
}
/* the toolbar and its popouts shrink to fit a short window, such as a laptop screen */
export const fitToolbar = () =>
  fitTools(bar, [fileMenu, clearMenu.el, pageMenu.el, hlMenu.el, periodPicker.el, ink.sel.els[0]], 1);

/* Popout menus beside the toolbar. They open on a tap and stay open until a choice is tapped, a tap lands
   anywhere else, or Escape. Lifting the pen or finger never closes them. */
export const fileMenu = $('#ob-filemenu');
export let clearMenu, pageMenu, hlMenu, showFileMenu;
let file, placeFileMenu;
export function initMenus() {
  clearMenu = makePopMenu($('#ob-clearmenu'), $('[data-act="clear"]', bar), bar, () => closeMenus('clear'));
  pageMenu = makePopMenu($('#ob-pagemenu'), pagesBtn, bar, () => closeMenus('pages'));
  file = makePopMenu(fileMenu, $('[data-act="file"]', bar), bar, () => closeMenus('file'));
  placeFileMenu = file.place;
  showFileMenu = file.show;
  // Highlighter ▾: Highlight (with strength) or Cover. Shared with the overlay (shared/ink-core.js).
  // A choice, or moving the slider, turns the highlighter on in that mode.
  hlMenu = makeHlMenu(
    bar,
    T,
    () => {
      setLS('ink-hl-mode', T.covering ? 'cover' : 'hl');
      setLS('ink-hl-strength', T.hlStrength);
      if (T.covering) setLS('ink-cover-color', T.coverColor);
      typeOff();
      T.hiliting = true;
      T.erasing = false;
      T.laser = false;
      selectOff();
      T.color = toolColor();
      refresh();
    },
    () => closeMenus('hl')
  );
  for (const m of [fileMenu, clearMenu.el])
    m.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      onToolbarClick(e);
      // keep it open while a two-tap confirm ("Sure?") is waiting, after moving the toolbar, or after a turn (tap again to turn more)
      if (/^turn-/.test(b.dataset.act)) return;
      if (!b.classList.contains('warn') && b.dataset.act !== 'side') closeMenus();
      else if (b.dataset.act === 'side') placeFileMenu();
    });
}
export function closeMenus(except) {
  // only one popout at a time
  if (except !== 'file') file.show(false);
  if (except !== 'clear') clearMenu.show(false);
  if (except !== 'pages') pageMenu.show(false);
  if (except !== 'hl') hlMenu.show(false);
  if (except !== 'periods') periodPicker.show(false);
}
