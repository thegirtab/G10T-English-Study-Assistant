import { api, esc, toast } from '../core.js';

export async function render(root, ctx) {
  const [s, backups, stats] = await Promise.all([
    api('/api/settings'),
    api('/api/backups'),
    api('/api/stats')
  ]);
  const totalMaterials = (stats.sources || []).reduce((a, x) => a + x.value, 0);
  const counts = ctx?.counts || {};

  root.innerHTML = `
    <section class="page">
      <header class="page-head">
        <div class="page-index">07</div>
        <div class="page-head-main">
          <div class="eyebrow">SETTINGS · LOCAL ONLY</div>
          <h1 class="display">你的数据，<br>只在这台机器上。</h1>
          <p class="page-sub">所有内容存在本地 SQLite，每天自动备份。配置 AI 后才会把作文发出去批改；不配置也能用，只是反馈会退化成规则判断。</p>
        </div>
        <div class="page-stamp">LOCAL<b>${s.has_key ? 'AI' : 'OFF'}</b>MODE</div>
      </header>

      <div class="settings-grid">
        <article class="card">
          <div class="eyebrow">AI PROVIDER</div>
          <h2 class="card-title">批改与补全</h2>
          <label class="field">
            <span class="lbl">API Base</span>
            <input id="ai-base" value="${esc(s.ai_base || '')}" placeholder="https://api.openai.com/v1">
          </label>
          <label class="field">
            <span class="lbl">API Key</span>
            <input id="ai-key" type="password" autocomplete="off" placeholder="${s.has_key ? '已设置 · 留空不修改' : 'sk-...'}">
          </label>
          <label class="field">
            <span class="lbl">模型</span>
            <input id="ai-model" value="${esc(s.ai_model || '')}" placeholder="gpt-4o-mini">
          </label>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <button class="btn btn--verm" id="save-ai">保存配置</button>
            <button class="btn btn--ghost" id="test-ai">测试连接</button>
            ${s.has_key ? `<button class="btn btn--ghost btn--sm" id="clear-key" style="margin-left:auto;color:var(--verm-deep)">清除 Key</button>` : ''}
          </div>
          <div id="ai-test-result" class="hint" style="margin-top:12px"></div>
          <div class="dashed"></div>
          <p class="hint">支持任意 OpenAI 兼容接口（/chat/completions）。请求超时 60 秒，输出强制 JSON。未配置或调用失败时，自动降级为本地启发式反馈。</p>
        </article>

        <article class="card">
          <div class="eyebrow">LEARNING RULES</div>
          <h2 class="card-title">每天的量</h2>
          <div class="field-row">
            <label class="field">
              <span class="lbl">新卡上限 / 天</span>
              <input id="new-limit" type="number" min="0" max="200" value="${Number(s.new_limit)}">
            </label>
            <label class="field">
              <span class="lbl">复习上限 / 次</span>
              <input id="review-limit" type="number" min="1" max="300" value="${Number(s.review_limit)}">
            </label>
          </div>
          <div class="field-row">
            <label class="field">
              <span class="lbl">短文最低词数</span>
              <input id="min-words" type="number" min="1" max="1000" value="${Number(s.min_words)}">
            </label>
            <label class="field">
              <span class="lbl">发帖最低词数</span>
              <input id="post-min-words" type="number" min="1" max="1000" value="${Number(s.post_min_words)}">
            </label>
          </div>
          <div class="field-row">
            <label class="field">
              <span class="lbl">日界（几点算新的一天）</span>
              <select id="day-boundary">
                ${[0, 1, 2, 3, 4, 5, 6].map((h) => `<option value="${h}" ${Number(s.day_boundary) === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}
              </select>
            </label>
            <label class="field">
              <span class="lbl">月度 AI 预算（备注）</span>
              <input id="budget" value="${esc(s.budget || '')}" placeholder="例如 $5">
            </label>
          </div>
          <button class="btn btn--ink" id="save-rules">保存参数</button>
          <div class="dashed"></div>
          <div class="mini-list">
            <li><span>今日闭环判定</span><span>到期清零 + 写作提交</span></li>
            <li><span>连续天数</span><span>按 ${String(Number(s.day_boundary)).padStart(2, '0')}:00 日界</span></li>
          </div>
        </article>
      </div>

      <div class="grid-12" style="margin-top:26px">
        <article class="card span-6">
          <div class="eyebrow">DATA</div>
          <h2 class="card-title">本地数据概况</h2>
          <ul class="mini-list">
            <li><span>材料</span><span>${totalMaterials} 条</span></li>
            <li><span>收件箱 / 学习中</span><span>${counts.inbox || 0} / ${counts.learning || 0}</span></li>
            <li><span>写作</span><span>${stats.writings} 篇 · ${stats.totalWords} 词</span></li>
            <li><span>能力快照</span><span>${stats.snapshots.length} 条</span></li>
          </ul>
          <div class="dashed"></div>
          <div class="card-top" style="margin-bottom:10px">
            <div class="eyebrow" style="margin:0">BACKUPS</div>
            <button class="btn btn--sm" id="s-backup">立即备份</button>
          </div>
          ${backups.length ? `<table class="stat-table">
            <thead><tr><th>文件</th><th>大小</th><th>时间</th></tr></thead>
            <tbody>
              ${backups.slice(0, 6).map((b) => `<tr>
                <td>${esc(b.name)}</td>
                <td class="num">${(b.size / 1024).toFixed(0)} KB</td>
                <td class="num">${esc(new Date(b.mtime).toLocaleString('zh-CN', { hour12: false }))}</td>
              </tr>`).join('')}
            </tbody>
          </table>` : `<div class="hint">还没有备份文件。</div>`}
          <p class="hint" style="margin-top:10px">备份保留最近 30 份，位置：data/backups。</p>
        </article>

        <article class="card span-6">
          <div class="eyebrow">EXPORT</div>
          <h2 class="card-title">带走你的数据</h2>
          <p class="card-sub">导出到 data/exports，文件名带时间戳。</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn" id="export-json">导出全部 JSON</button>
            <button class="btn" id="export-csv">导出材料 CSV</button>
          </div>

          <div class="danger-zone">
            <div class="dz-title">Danger Zone</div>
            <p class="hint" style="margin:0 0 12px">清空所有材料、卡片、复习记录、写作、测试与快照。操作不可撤销，建议先备份。</p>
            <button class="btn btn--verm btn--sm" id="wipe">清空全部数据</button>
          </div>
        </article>
      </div>
    </section>`;

  const val = (sel) => root.querySelector(sel)?.value.trim() ?? '';

  root.querySelector('#save-ai').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const body = { ai_base: val('#ai-base'), ai_model: val('#ai-model') };
      const key = val('#ai-key');
      if (key) body.ai_key = key;
      const saved = await api('/api/settings', { method: 'PUT', body });
      if (ctx) ctx.settings = saved;
      toast('AI 配置已保存');
      const keyInput = root.querySelector('#ai-key');
      if (keyInput) keyInput.value = '';
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  root.querySelector('#test-ai').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const out = root.querySelector('#ai-test-result');
    btn.disabled = true;
    out.textContent = '正在连接…';
    try {
      const body = { ai_base: val('#ai-base'), ai_model: val('#ai-model') };
      const key = val('#ai-key');
      if (key) body.ai_key = key;
      await api('/api/settings', { method: 'PUT', body });
      const res = await api('/api/settings/test', { method: 'POST' });
      out.innerHTML = res.ok
        ? `<span style="color:var(--sage)">连接成功</span> · 返回：${esc(String(res.sample || '').slice(0, 80))}`
        : `<span style="color:var(--verm-deep)">连接失败</span> · ${esc(res.error || '未知错误')}`;
    } catch (err) {
      out.innerHTML = `<span style="color:var(--verm-deep)">连接失败</span> · ${esc(err.message)}`;
    } finally {
      btn.disabled = false;
    }
  });

  root.querySelector('#clear-key')?.addEventListener('click', async () => {
    if (!confirm('清除后 AI 批改与补全会停用，确定？')) return;
    try {
      const saved = await api('/api/settings', { method: 'PUT', body: { ai_key: '' } });
      if (ctx) ctx.settings = saved;
      toast('Key 已清除');
      render(root, ctx);
    } catch (err) {
      toast(err.message);
    }
  });

  root.querySelector('#save-rules').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const num = (sel, fallback) => {
        const n = Number(val(sel));
        return Number.isFinite(n) && n >= 0 ? n : fallback;
      };
      const body = {
        new_limit: num('#new-limit', 15),
        review_limit: num('#review-limit', 60),
        min_words: num('#min-words', 50),
        post_min_words: num('#post-min-words', 30),
        day_boundary: Number(val('#day-boundary')),
        budget: val('#budget')
      };
      const saved = await api('/api/settings', { method: 'PUT', body });
      if (ctx) ctx.settings = saved;
      toast('学习参数已保存');
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  root.querySelector('#s-backup').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const res = await api('/api/backup', { method: 'POST' });
      toast(`已备份：${res.name}`);
      render(root, ctx);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });

  root.querySelector('#export-json').addEventListener('click', () => doExport('json'));
  root.querySelector('#export-csv').addEventListener('click', () => doExport('csv'));

  async function doExport(type) {
    try {
      const res = await api('/api/export', { method: 'POST', body: { type } });
      toast(`已导出：data/exports/${res.file}`);
    } catch (err) {
      toast(err.message);
    }
  }

  root.querySelector('#wipe').addEventListener('click', async () => {
    if (!confirm('这会删除所有材料、卡片、写作、测试与快照，且无法撤销。确定继续？')) return;
    if (!confirm('最后确认：要清空全部本地数据吗？')) return;
    try {
      await api('/api/demo/clear', { method: 'POST' });
      toast('数据已清空');
      location.hash = '#/today';
    } catch (err) {
      toast(err.message);
    }
  });
}
