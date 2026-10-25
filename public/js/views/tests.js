import { api, esc, fmtDay, toast } from '../core.js';

let quiz = null;
let result = null;
let lock = false;

export async function render(root) {
  quiz = null;
  result = null;
  await entry(root);
}

/* ---------------- 入口 ---------------- */

async function entry(root) {
  const [tests, writings] = await Promise.all([api('/api/tests'), api('/api/writings')]);
  const writingTests = writings.filter((w) => w.mode === 'test' && w.status !== 'draft');
  const rows = [
    ...tests.map((t) => {
      let r = null;
      try { r = JSON.parse(t.result_json || 'null'); } catch { r = null; }
      const done = t.status === 'finished';
      return {
        at: t.finished_at || t.started_at || '',
        day: String(t.finished_at || t.started_at || '').slice(0, 10),
        type: '词汇量',
        item: done && r ? `${r.low}–${r.high} 词 · ${r.cefr}` : (t.status === 'active' ? '未完成' : '已作废'),
        ok: done && r ? r.valid !== false : false,
        note: done && r && r.valid === false ? '伪词误判过多' : ''
      };
    }),
    ...writingTests.map((w) => ({
      at: w.submitted_at || w.created_at || '',
      day: w.day,
      type: '写作',
      item: `${w.word_count} 词 · ${({ submitted: '已提交', reviewed: '已批改', review_failed: '批改失败' }[w.status] || w.status)}`,
      ok: w.status === 'reviewed',
      note: '',
      href: `#/writing?id=${w.id}`
    }))
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 12);

  const lastVocab = tests.find((t) => t.status === 'finished' && t.result_json);
  let lastVocabCefr = '';
  try { lastVocabCefr = JSON.parse(lastVocab?.result_json || '{}').cefr || ''; } catch { lastVocabCefr = ''; }

  root.innerHTML = `
    <section class="page">
      <header class="page-head">
        <div class="page-index">05</div>
        <div class="page-head-main">
          <div class="eyebrow">LEVEL CHECK</div>
          <h1 class="display">先知道自己<br>站在<em>哪里</em>。</h1>
          <p class="page-sub">词汇量只给区间，不给漂亮整数。写作测试限时 30 分钟，四维评分后映射 CEFR。测试稿不计入连续天数。</p>
        </div>
        <div class="page-stamp">TESTS<b>${rows.length}</b>DONE</div>
      </header>

      <div class="test-grid">
        <article class="card test-card">
          <div class="tape"></div>
          <div class="tc-num">A</div>
          <h2 class="card-title">词汇量测试</h2>
          <p class="card-sub">自适应抽题，答对升段，答错降段。</p>
          <ul>
            <li>20 题，覆盖 6 个频率段</li>
            <li>每 10 题混入 1 个伪词，检测是否“假装认识”</li>
            <li>结果给区间与 CEFR 映射，不承诺精确值</li>
          </ul>
          <div class="spacer"></div>
          <button class="btn btn--ink btn--wide" id="start-vocab">开始词汇测试 →</button>
        </article>

        <article class="card test-card">
          <div class="tape tape--right"></div>
          <div class="tc-num">B</div>
          <h2 class="card-title">写作能力测试</h2>
          <p class="card-sub">限时 30 分钟，从测试题库抽题。</p>
          <ul>
            <li>任务完成 / 组织衔接 / 词汇资源 / 语法准确</li>
            <li>每项 1–5 分，均分映射 CEFR</li>
            <li>测试稿单独存档，不混入日常写作统计</li>
          </ul>
          <div class="spacer"></div>
          <button class="btn btn--wide" id="start-writing">开始写作测试 →</button>
        </article>
      </div>

      <div class="card" style="margin-top:30px">
        <div class="card-top">
          <div>
            <div class="eyebrow">HISTORY</div>
            <h2 class="card-title">测试记录</h2>
          </div>
          ${lastVocabCefr ? `<span class="tag tag--blue">最近词汇 ${esc(lastVocabCefr)}</span>` : ''}
        </div>
        ${rows.length ? `
          <table class="stat-table">
            <thead><tr><th>日期</th><th>类型</th><th>结果</th><th>状态</th><th></th></tr></thead>
            <tbody>
              ${rows.map((r) => `<tr>
                <td>${esc(r.day ? fmtDay(r.day, false) : '—')}</td>
                <td>${esc(r.type)}</td>
                <td>${esc(r.item)}</td>
                <td>${r.ok ? '<span class="tag tag--mastered">有效</span>' : `<span class="tag tag--archived">${esc(r.note || '未完成')}</span>`}</td>
                <td class="num">${r.href ? `<a href="${r.href}" style="color:var(--verm-deep)">查看</a>` : ''}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        ` : `<div class="empty"><div class="big">还没有测试记录</div><p>先做一次词汇量测试，作为基线。</p></div>`}
      </div>
    </section>`;

  root.querySelector('#start-vocab').addEventListener('click', () => startVocab(root));
  root.querySelector('#start-writing').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '正在抽题…';
    try {
      const w = await api('/api/writings', { method: 'POST', body: { mode: 'test' } });
      location.hash = `#/writing?id=${w.id}`;
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
      btn.textContent = '开始写作测试 →';
    }
  });
}

/* ---------------- 词汇测试 ---------------- */

async function startVocab(root) {
  const res = await api('/api/tests/vocab/start', { method: 'POST' });
  quiz = {
    testId: res.test_id,
    question: res.question,
    index: res.index,
    total: res.total,
    correct: 0,
    shownAt: Date.now()
  };
  drawQuestion(root);
}

function drawQuestion(root) {
  const q = quiz.question;
  const pct = Math.round((quiz.index / quiz.total) * 100);

  root.innerHTML = `
    <section class="page review-wrap">
      <div class="eyebrow" style="display:flex;justify-content:space-between">
        <span>VOCAB TEST · ${quiz.index + 1} / ${quiz.total}</span>
        <span>已答对 ${quiz.correct}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>

      <article class="flashcard quiz-card">
        <div class="quiz-band">BAND ${q.band} · 选出最接近的释义</div>
        <div class="quiz-word">${esc(q.word)}</div>
        <div class="opt-list">
          ${q.options.map((opt, i) => `
            <button class="opt" data-opt="${i}">
              <span class="idx">${String.fromCharCode(65 + i)}</span>${esc(opt)}
            </button>`).join('')}
        </div>
      </article>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px;gap:12px">
        <button class="btn btn--ghost btn--sm" id="abort-test">结束测试</button>
        <span class="hint">不确定就选“不认识该词”，猜对不算会。</span>
      </div>
    </section>`;

  lock = false;
  root.querySelectorAll('.opt').forEach((btn) => {
    btn.addEventListener('click', () => pickOption(root, btn, q.options[Number(btn.dataset.opt)]));
  });
  root.querySelector('#abort-test').addEventListener('click', async () => {
    if (!confirm('结束本次测试？已答题目不会计入结果。')) return;
    await api('/api/tests/vocab/abort', { method: 'POST', body: { test_id: quiz.testId } });
    toast('测试已作废');
    quiz = null;
    entry(root);
  });
}

async function pickOption(root, btn, chosen) {
  if (lock) return;
  lock = true;
  root.querySelectorAll('.opt').forEach((b) => { b.disabled = true; });

  const q = quiz.question;
  const latency = Date.now() - quiz.shownAt;
  btn.classList.add(chosen === q.answer ? 'correct' : 'wrong');
  if (chosen !== q.answer) {
    root.querySelectorAll('.opt').forEach((b, i) => {
      if (q.options[i] === q.answer) b.classList.add('correct');
    });
  }
  if (chosen === q.answer) quiz.correct += 1;

  await new Promise((r) => setTimeout(r, 420));

  try {
    const res = await api('/api/tests/vocab/answer', {
      method: 'POST',
      body: { test_id: quiz.testId, question: q, chosen, latency_ms: latency }
    });
    if (res.done) {
      result = res.result;
      return showResult(root);
    }
    quiz.question = res.question;
    quiz.index = res.index;
    quiz.total = res.total;
    quiz.shownAt = Date.now();
    drawQuestion(root);
  } catch (e) {
    toast(e.message);
    lock = false;
    root.querySelectorAll('.opt').forEach((b) => { b.disabled = false; });
  }
}

function showResult(root) {
  const r = result;
  const accuracy = r.total ? Math.round((r.correct / r.total) * 100) : 0;
  const bands = [1, 2, 3, 4, 5, 6];

  root.innerHTML = `
    <section class="page">
      <header class="page-head">
        <div class="page-index">05</div>
        <div class="page-head-main">
          <div class="eyebrow">VOCAB RESULT · ${esc(fmtDay(new Date().toISOString().slice(0, 10)))}</div>
          <h1 class="display">${r.low}–${r.high}<span style="font-size:.4em"> 词</span></h1>
          <p class="page-sub">
            这是区间估计，不是精确值。本次共 ${r.total} 题，答对 ${r.correct} 题。
            ${r.valid ? '' : '<br><b>伪词误判率过高，本次结果不可靠</b>，建议休息后重测。'}
          </p>
        </div>
        <div class="page-stamp">CEFR<b>${esc(r.cefr)}</b>LEVEL</div>
      </header>

      <div class="grid-12">
        <article class="card span-7">
          <div class="eyebrow">ESTIMATE</div>
          <h2 class="card-title">估计区间与分段表现</h2>
          <div class="range-display">
            <span class="lo">${r.low}</span><span class="dash">—</span><span class="hi">${r.high}</span>
            <span class="hint" style="font-family:var(--sans)">词</span>
          </div>
          <div class="band-bars" style="margin-bottom:26px">
            ${bands.map((b) => {
              const s = r.bands?.[b] || r.bands?.[String(b)];
              const h = s && s.asked ? Math.max(6, Math.round((s.correct / s.asked) * 100)) : 3;
              return `<div class="bb" style="height:${h}%" title="Band ${b}: ${s ? `${s.correct}/${s.asked}` : '未测'}">
                <span>B${b}</span></div>`;
            }).join('')}
          </div>
          <div class="legend">
            <span><i style="background:var(--mustard)"></i>各频率段正确率</span>
            <span>Band 1 = 高频基础词，Band 6 = 低频难词</span>
          </div>
        </article>

        <article class="card span-5">
          <div class="eyebrow">RELIABILITY</div>
          <h2 class="card-title">这份结果可信吗</h2>
          <ul class="mini-list">
            <li><span>整体正确率</span><span>${accuracy}%</span></li>
            <li><span>伪词误判率</span><span>${Math.round((r.pseudoRate || 0) * 100)}%</span></li>
            <li><span>判定阈值</span><span>≤ 30%</span></li>
            <li><span>结论</span><span>${r.valid ? '有效' : '不可靠'}</span></li>
          </ul>
          <div class="dashed"></div>
          <p class="hint">伪词误判率高，说明存在“看着眼熟就选”的倾向。结果已记录，但不计入能力趋势。</p>
          <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn--verm" id="retest">再测一次</button>
            <a class="btn btn--ghost" href="#/stats">查看趋势</a>
          </div>
        </article>
      </div>

      <div style="display:flex;gap:12px;margin-top:26px;flex-wrap:wrap">
        <a class="btn btn--ink" href="#/tests">回到测试页</a>
        <a class="btn" href="#/today">回到今日</a>
      </div>
    </section>`;

  root.querySelector('#retest').addEventListener('click', () => {
    result = null;
    startVocab(root);
  });
}
