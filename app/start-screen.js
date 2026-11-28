// The start screen: choosing or dropping a file, and the "Open again" list.

import * as store from './store.js';
import { openFile, showError } from './open.js';
import { $, doc, tr } from './state.js';
import { importInk } from './exporting.js';

export function initStartScreen() {
  $('#ob-file').addEventListener('change', (e) => {
    openFile(e.target.files[0]);
    e.target.value = '';
  });
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      chooseFile();
    }
  });
  dropZone.addEventListener('click', (e) => {
    if (window.showOpenFilePicker && e.target !== $('#ob-file')) {
      e.preventDefault();
      chooseFile();
    }
  });
  window.addEventListener('dragenter', (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
      dragDepth++;
      cover.hidden = false;
      dropZone.classList.add('over');
    }
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      cover.hidden = true;
      dropZone.classList.remove('over');
    }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    cover.hidden = true;
    dropZone.classList.remove('over');
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (!f) return;
    // Chrome/Edge: a handle to the dropped file lets the board copy be saved next to it (must be asked for during the drop)
    const item = e.dataTransfer.items && e.dataTransfer.items[0];
    const handle = item && item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : null;
    if (/\.json$/i.test(f.name)) {
      if (doc) importInk(f);
      else showError(tr('err_open_pdf_first'));
    } else openFile(f, handle);
  });
}

const dropZone = $('#ob-drop');
/* Chrome/Edge: choose with showOpenFilePicker, which gives a handle to the file, so save windows can start in
   its folder (Save ink into PDF, an HTML board copy). Other browsers use the plain file input. */
function chooseFile() {
  if (!window.showOpenFilePicker) {
    $('#ob-file').click();
    return;
  }
  window
    .showOpenFilePicker({
      id: 'overboard-open',
      types: [
        {
          description: 'PDF, picture or HTML worksheet',
          accept: {
            'application/pdf': ['.pdf'],
            'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
            'text/html': ['.html', '.htm'],
          },
        },
      ],
    })
    .then(async ([h]) => openFile(await h.getFile(), Promise.resolve(h)))
    .catch((err) => {
      if (!err || err.name !== 'AbortError') $('#ob-file').click();
    });
}

// drop a PDF (or an .overboard.json ink file) anywhere
const cover = $('#ob-dropcover');
let dragDepth = 0;

/* ---------- recent files ---------- */
export async function renderRecent() {
  const sec = $('#ob-recent'),
    ul = $('ul', sec);
  let list = [];
  try {
    list = await store.listFiles();
  } catch (e) {
    /* storage blocked */
  }
  ul.textContent = '';
  sec.hidden = !list.length;
  for (const r of list) {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.className = 'open';
    const b = document.createElement('b');
    b.textContent = r.name;
    const sm = document.createElement('small');
    sm.textContent =
      tr(r.pages === 1 ? 'n_page' : 'n_pages', { n: r.pages }) +
      ' · ' +
      tr('opened_on', { d: new Date(r.opened).toLocaleDateString(tr.lang, { month: 'short', day: 'numeric' }) });
    open.append(b, sm);
    open.addEventListener('click', async () => {
      const rec = await store.getFile(r.hash).catch(() => null);
      if (!rec || !rec.blob) {
        showError(tr('err_no_longer_stored'));
        renderRecent();
        return;
      }
      openFile(new File([rec.blob], rec.name, { type: 'application/pdf' }));
    });
    const forget = document.createElement('button');
    forget.className = 'forget';
    forget.textContent = '×';
    forget.title = forget.ariaLabel = tr('forget_tip');
    forget.addEventListener('click', async () => {
      await store.forgetFile(r.hash).catch(() => {});
      renderRecent();
    });
    li.append(open, forget);
    ul.appendChild(li);
  }
}
