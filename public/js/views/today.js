import { api, esc, fmtDay, intensity, statusTag, shortDay } from '../core.js';

export async function render(root) {
  const [boot, stats] = await Promise.all([api('/api/bootstrap'), api('/api/stats')]);
  const weekWords = stats.heat.slice(-7).reduce((a, d) => a + (d.words || 0), 0);
  const todayWriting = stats.recentWritings.filter((w) => w.day === boot.today).pop();
  const loop = boot.loop || {};
  const due = stats.due || 0;
  const recent = stats.recentWritings.slice(-4).reverse();

  root.innerHTML = `
    <section class="page">
      <header class="page-head">
        <div class="page-index">01</div>
        <div class="page-head-main">
          <div class="eyebrow">DAILY LOOP · ${esc(fmtDay(boot.today))}</div>
          <h1 class="display">把旧的捡起来，<br>再写点<em>新的</em>。</h1>
          <p class="page-sub">
            ${due > 0
              ? `今天有 <b>${due}</b> 张卡片到期。复习完，再写一篇 50 词以上的短文，闭环就合上了。`
              : `今天没有到期卡片。可以直接写一篇，或者去收集几条新材料。`}
          </p>
        </div>
        <div class="page-stamp">STREAK<b>${stats.streak.current}</b>DAYS</div>
      </header>

      <div class="loop-bar">
        <div class="loop-step ${loop.review_done ? 'done' : ''}">
          <span class="box">${loop.review_done ? '✓' : ''}</span>
          <span class="lbl">到期复习</span>
          <span class="sub">${loop.review_done ? '已完成' : `${due} 张待处理`}</span>
        </div>
        <div class="loop-step ${loop.writing_done ? 'done' : ''}">
          <span class="box">${loop.writing_done ? '✓' : ''}</span>
          <span class="lbl">今日写作</span>
          <span class="sub">${loop.writing_done ? '已提交' : '尚未开始'}</span>
        </div>
      </div>

      <div class="grid-12">
        <article class="card span-7">
          <div class="tape"></div>
          <div class="card-top">
            <div>
              <div class="eyebrow">REVIEW QUEUE</div>
              <h2 class="card-title">今天要把旧的叫醒</h2>
              <p class="card-sub">先复习，再写作。新卡只在额度内出现。</p>
            </div>
            ${statusTag(due > 0 ? 'learning' : 'mastered')}
          </div>

          <div class="review-cta">
            <div>
              <div class="big-number">${due}<small>张到期</small></div>
              <div class="cta-note">另有 ${stats.newCards} 张新卡在队列外等待</div>
            </div>
            <button class="btn btn--verm" id="go-review">${due > 0 ? '开始复习 →' : '去收集材料 →'}</button>
          </div>

          <div class="divider"></div>
          <ul class="mini-list">
            <li><span>收件箱待处理</span><span>${boot.counts.inbox} 条</span></li>
            <li><span>学习中材料</span><span>${boot.counts.learning} 条</span></li>
            <li><span>本月主动使用率</span><span>${stats.activeUse.rate === null ? '—' : stats.activeUse.rate + '%'}</span></li>
          </ul>
        </article>

        <article class="card span-5">
          <div class="tape tape--right"></div>
          <div class="eyebrow">DAILY WRITING</div>
          <h2 class="card-title">${todayWriting ? '今天的稿子' : '今天还没动笔'}</h2>
          <p class="card-sub">${todayWriting ? esc(todayWriting.title) : '题目会从日常题库里抽，体裁轮换。'}</p>

          ${todayWriting ? `
            <div class="big-number">${todayWriting.word_count}<small>词</small></div>
            <div class="cta-note">状态：${esc(statusLabelOf(todayWriting.status))} · ${todayWriting.score ? '均分 ' + todayWriting.score.toFixed(1) : '等待批改'}</div>
            <div style="margin-top:22px">
              <button class="btn btn--ink btn--wide" id="go-writing">查看批改结果 →</button>
            </div>
          ` : `
            <div class="big-number" style="opacity:.25">000<small>词</small></div>
            <div class="cta-note">最低 50 词，发帖 30 词</div>
            <div style="margin-top:22px">
              <button class="btn btn--ink btn--wide" id="go-writing">开始写作 →</button>
            </div>
          `}

          <div class="divider"></div>
          <div class="streak-strip">
            ${stats.heat.slice(-14).map((d) => `<i class="${d.reviews || d.words ? 'on' : ''}" title="${esc(d.day)} · ${d.reviews} 复习 / ${d.words} 词"></i>`).join('')}
          </div>
          <div class="hint" style="margin-top:6px">最近 14 天的活动</div>
        </article>
      </div>

      <div class="kpi-row">
        <div class="kpi">
          <div class="k">本周写作</div>
          <div class="v">${weekWords}<small> 词</small></div>
          <div class="hint">累计 ${stats.totalWords} 词 / ${stats.writings} 篇</div>
        </div>
        <div class="kpi">
          <div class="k">主动使用率</div>
          <div class="v">${stats.activeUse.rate === null ? '—' : stats.activeUse.rate + '<small>%</small>'}</div>
          <div class="hint">${stats.activeUse.rate === null ? '样本不足 10 条' : `${stats.activeUse.used}/${stats.activeUse.base} 条材料被写进文章`}</div>
        </div>
        <div class="kpi kpi--dark">
          <div class="k">连续闭环</div>
          <div class="v">${stats.streak.current}<small> 天</small></div>
          <div class="hint" style="color:rgba(239,231,215,.65)">最长 ${stats.streak.longest} 天</div>
        </div>
      </div>

      <div class="grid-12" style="margin-top:26px">
        <article class="card span-8">
          <div class="card-top">
            <div>
              <div class="eyebrow">RECENT WRITINGS</div>
              <h2 class="card-title">最近写完的东西</h2>
            </div>
            <button class="btn btn--sm" id="go-writing-2">全部 →</button>
          </div>
          ${recent.length ? `
            <table class="stat-table">
              <thead><tr><th>日期</th><th>题目</th><th>词数</th><th>均分</th></tr></thead>
              <tbody>
                ${recent.map((w) => `
                  <tr>
                    <td>${esc(shortDay(w.day))}</td>
                    <td>${esc(w.title || '自由写作')}</td>
                    <td class="num">${w.word_count}</td>
                    <td class="num">${w.score ? w.score.toFixed(1) : '—'}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          ` : `<div class="empty"><div class="big">还没有稿子</div><p>写完第一篇后，这里会出现记录。</p></div>`}
        </article>

        <article class="card span-4">
          <div class="eyebrow">NEXT ACTION</div>
          <h2 class="card-title">下一步</h2>
          <ul class="mini-list">
            <li><span>复习 ${due} 张到期卡片</span><span>10 min</span></li>
            <li><span>写一篇 50 词短文</span><span>15 min</span></li>
            <li><span>收集 1 条新材料</span><span>1 min</span></li>
          </ul>
          <div class="dashed"></div>
          <button class="btn btn--wide" id="quick-add">+ 快速收集</button>
        </article>
      </div>
    </section>
  `;

  root.querySelector('#go-review')?.addEventListener('click', () => {
    location.hash = due > 0 ? '#/review' : '#/inbox';
  });
  root.querySelector('#go-writing')?.addEventListener('click', () => {
    location.hash = todayWriting ? `#/writing?id=${todayWriting.id}` : '#/writing';
  });
  root.querySelector('#go-writing-2')?.addEventListener('click', () => { location.hash = '#/writing'; });
  root.querySelector('#quick-add')?.addEventListener('click', () => {
    document.getElementById('btn-capture')?.click();
  });
}

function statusLabelOf(status) {
  return { draft: '草稿', submitted: '已提交', reviewed: '已批改', review_failed: '批改失败' }[status] || status;
}
