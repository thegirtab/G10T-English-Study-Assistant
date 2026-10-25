import { api, esc, toast, statusTag, typeLabel, sourceLabel, fmtDay } from '../core.js';

let filterStatus = '';
let keyword = '';

export async function render(root) {
  root.innerHTML = `
    <section class="page">
      <header class="page-head">
        <div class="page-index">02</div>
        <div class="page-head-main">
          <div class="eyebrow">MATERIAL LIBRARY</div>
          <h1 class="display">所有捡到的，<br>都在这儿。</h1>
          <p class="page-sub">来源可以不同，出口只有一个：被用进写作。14 天没排进复习的，会自动归档。</p>
        </div>
        <div class="page-stamp">INBOX<b id="inbox-count">—</b>ITEMS</div>
      </header>

      <div class="toolbar">
        <button class="chip ${filterStatus === '' ? 'active' : ''}" data-status="">全部</button>
        <button class="chip ${filterStatus === 'inbox' ? 'active' : ''}" data-status="inbox">收件箱</button>
        <button class="chip ${filterStatus === 'learning' ? 'active' : ''}" data-status="learning">学习中</button>
        <button class="chip ${filterStatus === 'mastered' ? 'active' : ''}" data-status="mastered">已掌握</button>
        <button class="chip ${filterStatus === 'archived' ? 'active' : ''}" data-status="archived">已归档</button>
        <input class="search-input" id="mat-search" placeholder="搜索内容 / 释义 / 语境" value="${esc(keyword)}">
      </div>

      <div id="mat-list"><div class="loading">LOADING ···</div></div>
    </section>
    <div id="drawer-root"></div>
  `;

  root.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      filterStatus = chip.dataset.status;
      root.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
      loadList(root);
    });
  });

  let timer;
  const search = root.querySelector('#mat-search');
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { keyword = search.value.trim(); loadList(root); }, 220);
  });

  loadList(root);
}

async function loadList(root) {
  const list = root.querySelector('#mat-list');
  if (!list) return;
  const params = new URLSearchParams();
  if (filterStatus) params.set('status', filterStatus);
  if (keyword) params.set('q', keyword);
  try {
    const rows = await api('/api/materials?' + params.toString());
    const countEl = root.querySelector('#inbox-count');
    if (countEl) countEl.textContent = rows.filter((r) => r.status === 'inbox').length || rows.length || 0;
    if (!rows.length) {
      list.innerHTML = `<div class="empty">
        <div class="big">这里还是空的</div>
        <p>按 Ctrl+K 把刚看到的表达丢进来，剩下的事交给后台。</p>
        <button class="btn btn--verm" id="empty-add">+ 收集第一条</button>
      </div>`;
      list.querySelector('#empty-add')?.addEventListener('click', () => {
        document.getElementById('btn-capture')?.click();
      });
      return;
    }
    list.innerHTML = `<div class="mat-list">
      ${rows.map((m, i) => `
        <div class="mat-row" data-id="${m.id}">
          <div class="mat-idx">${String(i + 1).padStart(3, '0')}</div>
          <div>
            <div class="mat-content">${esc(m.content)}</div>
            <div class="mat-meta">${esc(typeLabel(m.type))} · ${esc(sourceLabel(m.source_type))}${m.source_name ? ' · ' + esc(m.source_name) : ''}${m.cefr ? ' · ' + esc(m.cefr) : ''}</div>
          </div>
          <div class="mat-meaning">${esc(m.meaning || '待补全')}</div>
          <div class="mat-tags">
            ${statusTag(m.status)}
            ${m.use_count > 0 ? `<span class="tag tag--blue">用过 ${m.use_count}</span>` : ''}
          </div>
        </div>
      `).join('')}
    </div>`;
    list.querySelectorAll('.mat-row').forEach((row) => {
      row.addEventListener('click', () => openDrawer(Number(row.dataset.id), root));
    });
  } catch (e) {
    list.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
}

async function openDrawer(id, root) {
  const host = document.getElementById('drawer-root');
  host.innerHTML = `<div class="drawer"><div class="drawer-backdrop" data-close></div>
    <div class="drawer-panel"><div class="loading">LOADING ···</div></div></div>`;
  host.querySelector('[data-close]').addEventListener('click', () => { host.innerHTML = ''; });

  try {
    const m = await api('/api/materials/' + id);
    const panel = host.querySelector('.drawer-panel');
    panel.innerHTML = `
      <div class="eyebrow">${esc(typeLabel(m.type))} · ${esc(sourceLabel(m.source_type))}</div>
      <h2>${esc(m.content)}</h2>
      <div>${statusTag(m.status)} ${m.cefr ? `<span class="tag">${esc(m.cefr)}</span>` : ''} ${m.use_count ? `<span class="tag tag--blue">写作中使用 ${m.use_count} 次</span>` : ''}</div>

      ${m.context ? `<div class="quote">${esc(m.context)}</div>` : ''}

      <dl class="kv">
        <dt>释义</dt><dd>${esc(m.meaning || '—')}</dd>
        <dt>词性</dt><dd>${esc(m.pos || '—')}</dd>
        <dt>来源</dt><dd>${esc(m.source_name || '—')}</dd>
        <dt>位置</dt><dd>${esc(m.locator || '—')}</dd>
        <dt>收集于</dt><dd>${esc(fmtDay((m.created_at || '').slice(0, 10), false))}</dd>
        <dt>补全</dt><dd>${renderEnrich(m.enrich_status)}</dd>
        <dt>复习</dt><dd>${m.card ? `已复习 ${m.logs.length} 次 · 下次 ${String(m.card.due_at).slice(0, 10)}` : '尚未加入复习'}</dd>
      </dl>

      <div class="dashed"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${m.status === 'inbox' || m.status === 'archived'
          ? `<button class="btn btn--verm" id="d-learn">加入复习</button>`
          : `<button class="btn" id="d-review">去复习</button>`}
        <button class="btn btn--ghost" id="d-enrich">重新补全</button>
        <button class="btn btn--ghost" id="d-delete" style="margin-left:auto;color:var(--verm-deep)">删除</button>
      </div>

      <div class="dashed"></div>
      <div class="eyebrow">REVIEW HISTORY</div>
      ${m.logs.length ? `<table class="stat-table">
        <thead><tr><th>时间</th><th>评分</th><th>结果</th></tr></thead>
        <tbody>${m.logs.map((l) => `<tr>
          <td>${esc(String(l.reviewed_at).slice(0, 10))}</td>
          <td class="num">${['', '忘记', '困难', '一般', '简单'][l.rating] || l.rating}</td>
          <td class="num">${l.correct ? '✓' : '✕'}</td>
        </tr>`).join('')}</tbody>
      </table>` : `<div class="hint">还没有复习记录。</div>`}
    `;

    panel.querySelector('#d-learn')?.addEventListener('click', async () => {
      await api(`/api/materials/${id}/learn`, { method: 'POST' });
      toast('已加入复习队列');
      host.innerHTML = '';
      loadList(root);
    });
    panel.querySelector('#d-review')?.addEventListener('click', () => {
      host.innerHTML = '';
      location.hash = '#/review';
    });
    panel.querySelector('#d-enrich')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = '补全中…';
      const updated = await api(`/api/materials/${id}/enrich`, { method: 'POST' });
      toast(updated.enrich_status === 'ready' ? '补全完成' : '未配置 AI，请手动填写');
      host.innerHTML = '';
      openDrawer(id, root);
      loadList(root);
    });
    panel.querySelector('#d-delete')?.addEventListener('click', async () => {
      if (!confirm('删除后 7 天内可在设置中恢复，确定？')) return;
      await api('/api/materials/' + id, { method: 'DELETE' });
      toast('已删除（软删除）');
      host.innerHTML = '';
      loadList(root);
    });
  } catch (e) {
    host.querySelector('.drawer-panel').innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
}

function renderEnrich(status) {
  if (status === 'ready') return '<span style="color:var(--sage)">已自动补全</span>';
  if (status === 'manual') return '<span style="color:var(--muted)">待手动补全（未配置 AI）</span>';
  if (status === 'failed') return '<span style="color:var(--verm-deep)">补全失败</span>';
  return '处理中';
}
