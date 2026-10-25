import { api, esc, toast, sourceLabel, typeLabel, similarity } from '../core.js';

let session = null;

export async function render(root) {
  const queue = await api('/api/review/queue');
  const items = [...queue.due, ...queue.fresh];

  if (!items.length) {
    root.innerHTML = `
      <section class="page">
        <header class="page-head">
          <div class="page-index">03</div>
          <div class="page-head-main">
            <div class="eyebrow">REVIEW SESSION</div>
            <h1 class="display">今天没有<br>要叫醒的东西。</h1>
            <p class="page-sub">到期卡片已经清零。可以去写一篇，或者提前看看材料库里的新条目。</p>
          </div>
        </header>
        <div class="empty">
          <div class="big">队列为空</div>
          <p>新卡会在明天按时出现。现在去写点东西吧。</p>
          <div style="display:flex;gap:10px;justify-content:center">
            <button class="btn btn--verm" onclick="location.hash='#/writing'">去写作 →</button>
            <button class="btn" onclick="location.hash='#/inbox'">去材料库</button>
          </div>
        </div>
      </section>`;
    return;
  }

  session = { items, idx: 0, correct: 0, startedAt: Date.now(), cardAt: Date.now() };
  draw(root);
}

function draw(root) {
  const item = session.items[session.idx];
  if (!item) return finish(root);
  const q = makeQuestion(item);
  const pct = Math.round((session.idx / session.items.length) * 100);

  root.innerHTML = `
    <section class="page review-wrap">
      <div class="eyebrow" style="display:flex;justify-content:space-between">
        <span>REVIEW · ${session.idx + 1} / ${session.items.length}</span>
        <span>正确 ${session.correct}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>

      <article class="flashcard">
        <div class="fc-meta">
          <span>${esc(typeLabel(item.mtype))} · ${esc(sourceLabel(item.source_type))}</span>
          <span>${esc(item.cefr || '')}</span>
        </div>
        <div class="fc-context">${q.html}</div>
        <div class="fc-prompt">${esc(q.hint)}</div>

        <input class="fc-input" id="fc-input" autocomplete="off" spellcheck="false" placeholder="写出你的答案…">

        <div class="fc-actions">
          <button class="btn btn--ink" id="fc-check">检查</button>
          <button class="btn btn--ghost" id="fc-skip">不会，直接看答案</button>
        </div>

        <div id="fc-result"></div>
      </article>
    </section>`;

  const input = root.querySelector('#fc-input');
  input.focus();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      check(root, item, q, input.value);
    }
  });
  root.querySelector('#fc-check').addEventListener('click', () => check(root, item, q, input.value));
  root.querySelector('#fc-skip').addEventListener('click', () => reveal(root, item, q, false, ''));
}

function makeQuestion(item) {
  const content = item.content || '';
  const context = item.context || '';
  let html = '';
  let hint = '';
  if (context) {
    const re = new RegExp(escapeRe(content), 'ig');
    if (re.test(context)) {
      html = esc(context).replace(new RegExp(escapeRe(esc(content)), 'ig'), '<mark>______</mark>');
      hint = '补全划线处的表达';
      return { html, hint, answer: content };
    }
  }
  if (item.meaning) {
    html = `${esc(item.meaning)}<br><span style="font-size:15px;color:var(--muted)">写出对应的英文</span>`;
    hint = '根据中文写出英文表达';
    return { html, hint, answer: content };
  }
  html = `<span style="color:var(--muted)">回忆这条材料的原文</span>`;
  hint = '写出你收集时的内容';
  return { html, hint, answer: content };
}

function check(root, item, q, value) {
  if (!value.trim()) { toast('先写点什么'); return; }
  const ok = similarity(value, q.answer) >= 0.8;
  reveal(root, item, q, ok, value);
}

function reveal(root, item, q, ok, value) {
  if (ok) session.correct += 1;
  const elapsed = Date.now() - session.cardAt;
  const res = root.querySelector('#fc-result');
  root.querySelector('#fc-input').disabled = true;
  root.querySelector('#fc-check').disabled = true;
  root.querySelector('#fc-skip').disabled = true;

  res.innerHTML = `
    <div class="fc-answer">
      <div class="verdict ${ok ? 'ok' : 'no'}">${ok ? '✓ 正确' : '✕ 再记一次'}</div>
      <div class="ans">${esc(q.answer)}</div>
      <div class="mean">${esc(item.meaning || '')}</div>
      ${item.context ? `<div class="quote" style="margin-top:14px">${esc(item.context)}</div>` : ''}
      <div class="hint" style="margin-top:10px">
        来源：${esc(sourceLabel(item.source_type))}${item.source_name ? ' · ' + esc(item.source_name) : ''}${item.locator ? ' · ' + esc(item.locator) : ''}
        ${value ? `<br>你的答案：${esc(value)}` : ''}
      </div>
    </div>
    <div class="rating-row">
      <button class="rating" data-r="1"><b>完全忘记</b><span>AGAIN</span></button>
      <button class="rating" data-r="2"><b>困难</b><span>HARD</span></button>
      <button class="rating" data-r="3"><b>一般</b><span>GOOD</span></button>
      <button class="rating" data-r="4"><b>简单</b><span>EASY</span></button>
    </div>`;

  res.querySelectorAll('.rating').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api('/api/review/grade', {
          method: 'POST',
          body: { card_id: item.id, rating: Number(btn.dataset.r), elapsed_ms: elapsed, manual: 0 }
        });
        session.idx += 1;
        session.cardAt = Date.now();
        draw(root);
      } catch (e) {
        toast(e.message);
        btn.disabled = false;
      }
    });
  });
}

function finish(root) {
  const total = session.items.length;
  const rate = total ? Math.round((session.correct / total) * 100) : 0;
  const mins = Math.max(1, Math.round((Date.now() - session.startedAt) / 60000));
  root.innerHTML = `
    <section class="page review-wrap">
      <header class="page-head">
        <div class="page-index">03</div>
        <div class="page-head-main">
          <div class="eyebrow">SESSION COMPLETE</div>
          <h1 class="display">旧的都<br>叫醒了。</h1>
          <p class="page-sub">${total} 张卡片，用时 ${mins} 分钟。现在把闭环的另一半补上。</p>
        </div>
      </header>

      <div class="kpi-row" style="grid-template-columns:repeat(3,1fr)">
        <div class="kpi"><div class="k">本轮正确率</div><div class="v">${rate}<small>%</small></div></div>
        <div class="kpi"><div class="k">复习张数</div><div class="v">${total}</div></div>
        <div class="kpi kpi--dark"><div class="k">用时</div><div class="v">${mins}<small> min</small></div></div>
      </div>

      <div style="display:flex;gap:12px;margin-top:26px">
        <button class="btn btn--verm" onclick="location.hash='#/writing'">去写今天的稿子 →</button>
        <button class="btn" onclick="location.hash='#/today'">回到今日</button>
      </div>
    </section>`;
  session = null;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
