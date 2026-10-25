import { api, errorBox, fmtDay, loading, parseHash, toast } from './core.js';
import * as today from './views/today.js';
import * as inbox from './views/inbox.js';
import * as review from './views/review.js';
import * as writing from './views/writing.js';
import * as tests from './views/tests.js';
import * as stats from './views/stats.js';
import * as settings from './views/settings.js';

const ROUTES = { today, inbox, review, writing, tests, stats, settings };
const DEFAULT_SETTINGS = { min_words: 50, post_min_words: 30 };

let ctx = { settings: DEFAULT_SETTINGS, today: '' };
let current = 'today';
let bootWarned = false;

async function syncTopline() {
  try {
    const boot = await api('/api/bootstrap');
    ctx = { ...ctx, ...boot, settings: boot.settings || ctx.settings };
    const dayEl = document.getElementById('top-day');
    const streakEl = document.getElementById('top-streak');
    if (dayEl) dayEl.textContent = fmtDay(boot.today);
    if (streakEl) streakEl.textContent = `连续 ${boot.streak.current} 天`;
    bootWarned = false;
  } catch (e) {
    if (!bootWarned) { toast(e.message); bootWarned = true; }
  }
}

async function route() {
  if (typeof window.__viewCleanup === 'function') {
    window.__viewCleanup();
    window.__viewCleanup = null;
  }

  const { view, params } = parseHash();
  const name = ROUTES[view] ? view : 'today';
  current = name;

  document.querySelectorAll('.rail-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.view === name);
  });

  const root = document.getElementById('view');
  loading(root);
  window.scrollTo(0, 0);

  await syncTopline();

  try {
    await ROUTES[name].render(root, ctx, params);
  } catch (e) {
    console.error(e);
    errorBox(root, e);
  }
}

/* ---------------- 快速收集 ---------------- */

const modal = document.getElementById('capture-modal');
const capContent = document.getElementById('cap-content');
const capSave = document.getElementById('cap-save');

function openCapture() {
  modal.hidden = false;
  setTimeout(() => capContent.focus(), 30);
}

function closeCapture() {
  modal.hidden = true;
}

async function saveCapture(keepOpen) {
  const content = capContent.value.trim();
  if (!content) { toast('先写点什么'); return; }
  capSave.disabled = true;
  try {
    await api('/api/materials', {
      method: 'POST',
      body: {
        content,
        type: document.getElementById('cap-type').value,
        source_type: document.getElementById('cap-source').value,
        source_name: document.getElementById('cap-source-name').value.trim(),
        locator: document.getElementById('cap-locator').value.trim(),
        context: document.getElementById('cap-context').value.trim()
      }
    });
    toast('已存入收集箱');
    capContent.value = '';
    document.getElementById('cap-context').value = '';
    document.getElementById('cap-locator').value = '';
    if (!keepOpen) closeCapture();
    if (['inbox', 'today', 'stats'].includes(current)) route();
  } catch (e) {
    if (e.status === 409) toast(`已存在：${e.data?.existing?.content || '重复条目'}`);
    else toast(e.message);
  } finally {
    capSave.disabled = false;
  }
}

document.getElementById('btn-capture')?.addEventListener('click', openCapture);
document.querySelectorAll('#capture-modal [data-close]').forEach((el) => {
  el.addEventListener('click', closeCapture);
});
capSave?.addEventListener('click', () => saveCapture(false));
capContent?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    saveCapture(e.ctrlKey || e.metaKey);
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openCapture();
  }
  if (e.key === 'Escape' && !modal.hidden) closeCapture();
});

/* ---------------- 备份 ---------------- */

document.getElementById('btn-backup')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '备份中…';
  try {
    const res = await api('/api/backup', { method: 'POST' });
    toast(`已备份：${res.name}`);
    if (current === 'settings') route();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

/* ---------------- 启动 ---------------- */

window.addEventListener('hashchange', route);
route();
