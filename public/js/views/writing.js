import { api, esc, toast, countWords, fmtDay, statusTag } from '../core.js';

let timerHandle = null;
let autoHandle = null;

export async function render(root, ctx, params) {
  clearInterval(timerHandle);
  clearInterval(autoHandle);
  const id = params.get('id');
  const mode = params.get('mode');

  if (id) return openWriting(root, ctx, Number(id));
  if (mode === 'test') {
    const created = await api('/api/writings', { method: 'POST', body: { mode: 'test' } });
    history.replaceState(null, '', `#/writing?id=${created.id}`);
    return openWriting(root, ctx, created.id, true);
  }
  return startScreen(root, ctx);
}

async function startScreen(root, ctx) {
  const writings = await api('/api/writings');
  const todayKey = new Date().toISOString().slice(0, 10);
  const drafts = writings.filter((w) => w.status === 'draft');
  const todayDone = writings.filter((w) => w.day === todayKey && w.mode !== 'test' && w.status !== 'draft');

  root.innerHTML = `
    <section class="page">
      <header class="page-head">
        <div class="page-index">04</div>
        <div class="page-head-main">
          <div class="eyebrow">DAILY WRITING</div>
          <h1 class="display">今天写点<br>能用的东西。</h1>
          <p class="page-sub">跟题、自由写、发帖，三种口吻三套标准。写完会得到四维反馈和可收集的表达。</p>
        </div>
        ${todayDone.length ? `<div class="page-stamp">TODAY<b>✓</b>DONE</div>` : ''}
      </header>

      ${drafts.length ? `
        <div class="card" style="margin-bottom:24px">
          <div class="eyebrow">UNFINISHED</div>
          <h2 class="card-title">有一篇没写完的草稿</h2>
          <p class="card-sub">${esc(drafts[0].title || '自由写作')} · ${drafts[0].word_count} 词</p>
          <button class="btn btn--verm" data-open="${drafts[0].id}">继续写 →</button>
        </div>` : ''}

      <div class="test-grid">
        <article class="card test-card">
          <div class="tape"></div>
          <div class="tc-num">A</div>
          <h2 class="card-title">跟题写作</h2>
          <p class="card-sub">从日常题库抽题，体裁轮换。</p>
          <ul>
            <li>日记 / 观点 / 描述 / 邮件 / 社媒回复</li>
            <li>建议 15 分钟，不少于 50 词</li>
            <li>每周一会出现「必用表达」题</li>
          </ul>
          <div class="spacer"></div>
          <button class="btn btn--ink btn--wide" data-mode="prompt">抽一道题 →</button>
        </article>

        <article class="card test-card">
          <div class="tape tape--right"></div>
          <div class="tc-num">B</div>
          <h2 class="card-title">自由写作</h2>
          <p class="card-sub">不选题，想到什么写什么。</p>
          <ul>
            <li>适合复盘、日记、随手记录</li>
            <li>同样会得到四维评分</li>
            <li>不计入题库轮换</li>
          </ul>
          <div class="spacer"></div>
          <button class="btn btn--wide" data-mode="free">直接开写 →</button>
        </article>
      </div>

      <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap">
        <button class="btn" data-mode="social">发帖模式 →</button>
        <button class="btn btn--ghost" onclick="location.hash='#/tests'">去做写作能力测试</button>
      </div>

      <div class="card" style="margin-top:30px">
        <div class="eyebrow">ARCHIVE</div>
        <h2 class="card-title">写过的稿子</h2>
        ${writings.length ? `<table class="stat-table">
          <thead><tr><th>日期</th><th>题目</th><th>模式</th><th>词数</th><th>状态</th><th></th></tr></thead>
          <tbody>
          ${writings.slice(0, 20).map((w) => `<tr>
            <td>${esc(w.day)}</td>
            <td>${esc(w.title || '自由写作')}</td>
            <td>${esc({ prompt: '跟题', free: '自由', social: '发帖', test: '测试' }[w.mode] || w.mode)}</td>
            <td class="num">${w.word_count}</td>
            <td>${statusTag(w.status === 'reviewed' ? 'mastered' : 'inbox')}</td>
            <td class="num"><a href="#/writing?id=${w.id}" style="color:var(--verm-deep)">打开</a></td>
          </tr>`).join('')}
          </tbody>
        </table>` : `<div class="hint">还没有稿子。</div>`}
      </div>
    </section>`;

  root.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const created = await api('/api/writings', { method: 'POST', body: { mode: btn.dataset.mode } });
      location.hash = `#/writing?id=${created.id}`;
    });
  });
  root.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => { location.hash = `#/writing?id=${btn.dataset.open}`; });
  });
}

async function openWriting(root, ctx, id, isTestEntry = false) {
  const w = await api('/api/writings/' + id);
  if (w.status === 'draft') return editor(root, ctx, w, isTestEntry);
  return feedback(root, ctx, w);
}

function editor(root, ctx, w) {
  const isTest = w.mode === 'test';
  const minWords = isTest ? 0 : (w.mode === 'social' ? ctx.settings.post_min_words : ctx.settings.min_words);
  const startedAt = Date.now();
  const already = w.duration_s || 0;

  root.innerHTML = `
    <section class="page">
      <header class="page-head">
        <div class="page-index">04</div>
        <div class="page-head-main">
          <div class="eyebrow">${isTest ? 'WRITING TEST · 30 MIN' : 'DAILY WRITING'}</div>
          <h1 class="display">${isTest ? '限时写作。' : '写下来，才算发生。'}</h1>
          <p class="page-sub">${isTest ? '计时结束会自动提交，期间不能暂停。' : '不用追求完美，先把意思写清楚。'}</p>
        </div>
        ${isTest ? `<div class="page-stamp" id="test-timer">TEST<b>30:00</b>LEFT</div>` : ''}
      </header>

      <div class="write-layout">
        <div>
          <div class="prompt-card">
            <div class="tape"></div>
            <div class="genre">${esc(w.prompt?.genre || (w.mode === 'social' ? '社媒发帖' : '自由写作'))} · ${esc(w.prompt?.cefr || 'B1')}</div>
            <div class="ptext">${esc(w.prompt?.text || '自由写作：写下此刻你想说的事。')}</div>
          </div>

          <textarea class="editor" id="editor" placeholder="Start writing here...">${esc(w.body || '')}</textarea>

          <div class="write-bar">
            <div class="meter"><b id="wc">${w.word_count || 0}</b> 词 ${minWords ? `· 最低 ${minWords}` : ''}</div>
            <div class="meter" id="clock">00:00</div>
            <div style="display:flex;gap:10px">
              <button class="btn btn--ghost" id="save-btn">保存草稿</button>
              <button class="btn btn--verm" id="submit-btn">提交批改 →</button>
            </div>
          </div>
        </div>

        <aside class="write-side">
          <div class="card">
            <div class="eyebrow">TIPS</div>
            <h3 class="card-title" style="font-size:18px">写之前</h3>
            <ul class="mini-list">
              <li><span>先用 1 句说清观点</span></li>
              <li><span>每段只做一件事</span></li>
              <li><span>至少用 1 条已学表达</span></li>
              <li><span>写完念一遍再提交</span></li>
            </ul>
          </div>
          ${isTest ? `<div class="card" style="margin-top:18px">
            <div class="eyebrow">TEST MODE</div>
            <p class="hint">测试稿不计入连续天数，提交后进入双评与校准流程。</p>
          </div>` : ''}
        </aside>
      </div>
    </section>`;

  const editorEl = root.querySelector('#editor');
  const wcEl = root.querySelector('#wc');
  const clockEl = root.querySelector('#clock');
  let dirty = false;

  const tick = () => {
    const secs = already + Math.floor((Date.now() - startedAt) / 1000);
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    clockEl.textContent = `${m}:${s}`;
    if (isTest) {
      const left = Math.max(0, 30 * 60 - secs);
      const lm = String(Math.floor(left / 60)).padStart(2, '0');
      const ls = String(left % 60).padStart(2, '0');
      const el = root.querySelector('#test-timer b');
      if (el) el.textContent = `${lm}:${ls}`;
      if (left === 0) submit(true);
    }
  };
  timerHandle = setInterval(tick, 1000);
  tick();

  window.__viewCleanup = () => {
    clearInterval(timerHandle);
    clearInterval(autoHandle);
    autoHandle = null;
  };

  editorEl.addEventListener('input', () => {
    wcEl.textContent = countWords(editorEl.value);
    dirty = true;
  });
  editorEl.focus();

  root.querySelector('#save-btn').addEventListener('click', async () => {
    await saveDraft(w, editorEl.value, secs());
    dirty = false;
    toast('草稿已保存');
  });

  async function submit(force) {
    clearInterval(timerHandle);
    clearInterval(autoHandle);
    const btn = root.querySelector('#submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = '批改中…'; }
    try {
      const res = await api(`/api/writings/${w.id}/submit`, {
        method: 'POST',
        body: { body: editorEl.value, duration_s: secs(), force }
      });
      location.hash = `#/writing?id=${w.id}`;
      toast('提交成功');
      // hash 相同不会触发重渲染
      openWriting(document.getElementById('view'), ctx, w.id);
    } catch (e) {
      if (e.data?.need_words) {
        const ok = confirm(`至少需要 ${e.data.need_words} 词，仍然提交？`);
        if (ok) return submit(true);
      }
      toast(e.message);
      if (btn) { btn.disabled = false; btn.textContent = '提交批改 →'; }
      timerHandle = setInterval(tick, 1000);
    }
  }
  root.querySelector('#submit-btn').addEventListener('click', () => submit(false));

  function secs() {
    return already + Math.round((Date.now() - startedAt) / 1000);
  }

  // 自动保存
  autoHandle = setInterval(() => {
    if (dirty && w.status === 'draft') {
      saveDraft(w, editorEl.value, secs()).catch(() => {});
      dirty = false;
    }
  }, 20000);
}

function saveDraft(w, body, duration) {
  return api('/api/writings/' + w.id, { method: 'PATCH', body: { body, duration_s: duration } });
}

function feedback(root, ctx, w) {
  let fb = {};
  try { fb = JSON.parse(w.feedback_json || '{}'); } catch { fb = {}; }
  const r = fb.rubric || {};
  const cells = [
    ['任务完成', 'task'], ['组织衔接', 'organization'], ['词汇资源', 'lexical'], ['语法准确', 'grammar']
  ];
  const vals = cells.map(([, k]) => r[k]?.score).filter(Boolean);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;

  root.innerHTML = `
    <section class="page">
      <header class="page-head">
        <div class="page-index">04</div>
        <div class="page-head-main">
          <div class="eyebrow">FEEDBACK · ${esc(fmtDay(w.day))} · ${esc(w.title || '自由写作')}</div>
          <h1 class="display">${avg ? `均分 ${avg.toFixed(1)}<span style="font-size:.45em"> / 5</span>` : '批改结果'}</h1>
          <p class="page-sub">
            ${w.mode === 'test' ? '写作能力测试 · 双评结果需校准后计入趋势。' : `共 ${w.word_count} 词，用时 ${Math.round((w.duration_s || 0) / 60)} 分钟。`}
            ${fb.mode === 'local' ? '<br><b>当前为本地规则反馈</b>，配置 AI 后可获得逐句改写建议。' : ''}
          </p>
        </div>
        <div class="page-stamp">${esc(String(w.model || 'LOCAL').toUpperCase().slice(0, 12))}<b>${avg ? avg.toFixed(1) : '—'}</b>SCORE</div>
      </header>

      <div class="score-grid">
        ${cells.map(([label, key]) => `
          <div class="score-cell">
            <div class="s">${r[key]?.score ?? '—'}</div>
            <div class="n">${esc(label)}</div>
            <div class="note">${esc(r[key]?.note || '')}</div>
          </div>`).join('')}
      </div>

      <div class="grid-12" style="margin-top:26px">
        <article class="card span-7">
          <div class="eyebrow">LINE BY LINE</div>
          <h2 class="card-title">逐句建议</h2>
          ${fb.corrections?.length
            ? fb.corrections.map((c) => `<div class="corr">
                <div><span class="orig">${esc(c.original)}</span> → <span class="fix">${esc(c.suggestion)}</span></div>
                <div class="why">${esc(c.reason || '')} ${c.type ? `· ${esc(c.type)}` : ''}</div>
              </div>`).join('')
            : `<div class="hint">本地模式不提供逐句改写。配置 AI 后，这里会列出原句、建议与原因。</div>`}

          <div class="dashed"></div>
          <div class="eyebrow">PRIORITIES</div>
          <ol class="priority-list">
            ${(fb.priorities || []).map((p) => `<li>${esc(p)}</li>`).join('') || '<li>暂无可执行建议。</li>'}
          </ol>

          ${fb.used?.length ? `
            <div class="dashed"></div>
            <div class="eyebrow">ACTIVE USE</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${fb.used.map((u) => `<span class="tag tag--blue">${esc(u.content)}</span>`).join('')}
            </div>` : ''}
        </article>

        <div class="span-5">
          <article class="card">
            <div class="eyebrow">REWRITE</div>
            <h2 class="card-title">保意重写</h2>
            <div class="rewrite-box">${esc(fb.rewrite || w.body)}</div>
          </article>

          ${fb.suggestions?.length ? `
            <article class="card" style="margin-top:24px">
              <div class="eyebrow">COLLECT</div>
              <h2 class="card-title">值得收集</h2>
              ${fb.suggestions.map((s, i) => `
                <div class="sugg-row">
                  <div>
                    <div class="w">${esc(s.content)}</div>
                    <div class="m">${esc(s.meaning || '')}</div>
                  </div>
                  <button class="btn btn--sm" data-sugg="${i}">入库</button>
                </div>`).join('')}
            </article>` : ''}
        </div>
      </div>

      <div style="display:flex;gap:12px;margin-top:26px;flex-wrap:wrap">
        <a class="btn btn--verm" href="#/writing">写下一篇 →</a>
        <a class="btn" href="#/today">回到今日</a>
        <a class="btn btn--ghost" href="#/writing?id=${w.id}" data-rewrite>基于此稿重写</a>
      </div>

      <div class="card" style="margin-top:30px">
        <div class="eyebrow">ORIGINAL</div>
        <h2 class="card-title">原稿</h2>
        <div class="rewrite-box" style="background:var(--cream)">${esc(w.body)}</div>
      </div>
    </section>`;

  root.querySelectorAll('[data-sugg]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const s = fb.suggestions[Number(btn.dataset.sugg)];
      try {
        await api('/api/materials', {
          method: 'POST',
          body: {
            content: s.content,
            meaning: s.meaning,
            type: 'expression',
            source_type: 'other',
            source_name: '写作批改 ' + w.day,
            context: ''
          }
        });
        btn.textContent = '已加入';
        btn.disabled = true;
        toast('已存入收集箱');
      } catch (e) {
        if (e.status === 409) { toast('这条已经在收集箱里了'); btn.textContent = '已存在'; }
        else toast(e.message);
      }
    });
  });

  root.querySelector('[data-rewrite]')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const created = await api('/api/writings', { method: 'POST', body: { mode: w.mode === 'test' ? 'free' : w.mode } });
    toast('已创建可编辑的新草稿');
    location.hash = `#/writing?id=${created.id}`;
  });
}
