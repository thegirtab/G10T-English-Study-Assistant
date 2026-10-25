const SOURCE_LABEL = {
  show: '剧集', course: '网课', dict: '词典', reading: '阅读', podcast: '播客', other: '其他'
};
const STATUS_LABEL = {
  inbox: '收件箱', learning: '学习中', mastered: '已掌握', archived: '已归档', merged: '已合并'
};
const TYPE_LABEL = {
  word: '单词', phrase: '短语搭配', expression: '地道表达', sentence: '整句', grammar: '语法点'
};

export const sourceLabel = (k) => SOURCE_LABEL[k] || k || '其他';
export const statusLabel = (k) => STATUS_LABEL[k] || k;
export const typeLabel = (k) => TYPE_LABEL[k] || k;

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const err = new Error(data?.error || `请求失败 ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

let toastTimer = null;
export function toast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 220);
  }, 2400);
}

export const go = (hash) => { location.hash = hash; };

export function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function fmtDay(day, withWeek = true) {
  if (!day) return '—';
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const week = ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()];
  const base = `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}`;
  return withWeek ? `${base} · 周${week}` : base;
}

export function shortDay(day) {
  if (!day) return '';
  const [, m, d] = day.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function intensity(reviews, words) {
  const n = (reviews || 0) + (words || 0) / 30;
  if (n === 0) return 0;
  if (n < 4) return 1;
  if (n < 9) return 2;
  if (n < 16) return 3;
  return 4;
}

export function loading(root, text = 'LOADING') {
  root.innerHTML = `<div class="loading">${esc(text)} ···</div>`;
}

export function errorBox(root, err) {
  root.innerHTML = `<div class="error-box">加载失败：${esc(err.message || err)}<br><br>
    <button class="btn btn--sm" onclick="location.reload()">重新加载</button></div>`;
}

export function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, '').replace(/\s+/g, ' ').trim();
}

export function similarity(a, b) {
  const s = normalizeText(a);
  const t = normalizeText(b);
  if (!s && !t) return 1;
  if (!s || !t) return 0;
  const dp = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
  for (let j = 1; j <= t.length; j++) dp[0][j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1)
      );
    }
  }
  return 1 - dp[s.length][t.length] / Math.max(s.length, t.length);
}

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const params = new URLSearchParams(qs || '');
  return { view: path || 'today', params };
}

export function statusTag(status) {
  return `<span class="tag tag--${esc(status)}">${esc(statusLabel(status))}</span>`;
}

export function navTo(view) {
  location.hash = `#/${view}`;
}
