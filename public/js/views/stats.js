import { api, esc, intensity, shortDay, sourceLabel, statusLabel } from '../core.js';

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function vocabCefr(low, high) {
  const mid = (Number(low) + Number(high)) / 2;
  if (mid < 1500) return 'A1';
  if (mid < 2500) return 'A2';
  if (mid < 4000) return 'B1';
  if (mid < 6000) return 'B2';
  if (mid < 9000) return 'C1';
  return 'C2';
}

function scoreCefr(score) {
  if (score < 2) return 'A1';
  if (score < 3) return 'A2';
  if (score < 3.5) return 'B1';
  if (score < 4) return 'B2';
  if (score < 4.5) return 'C1';
  return 'C2';
}

function lowerCefr(a, b) {
  if (!a) return b || '—';
  if (!b) return a;
  return CEFR_ORDER.indexOf(a) <= CEFR_ORDER.indexOf(b) ? a : b;
}

export async function render(root) {
  const s = await api('/api/stats');
  const sources = s.sources || [];
  const totalMaterials = sources.reduce((a, x) => a + x.value, 0);

  const last14 = s.heat.slice(-14);
  const maxWords = Math.max(1, ...last14.map((d) => d.words || 0));
  const week = s.heat.slice(-7);
  const weekReviews = week.reduce((a, d) => a + (d.reviews || 0), 0);
  const weekWords = week.reduce((a, d) => a + (d.words || 0), 0);

  const vocabLow = s.vocab?.vocab_low ?? null;
  const vocabHigh = s.vocab?.vocab_high ?? null;
  const vocabLevel = s.vocab ? (s.vocab.cefr || vocabCefr(vocabLow, vocabHigh)) : '';
  const writingScore = s.writing?.writing_score ?? null;
  const writingLevel = s.writing ? (s.writing.cefr || scoreCefr(writingScore)) : '';
  const combined = lowerCefr(vocabLevel, writingLevel);

  const statusColors = {
    inbox: 'var(--paper-2)',
    learning: 'var(--mustard)',
    mastered: 'var(--sage)',
    archived: 'var(--muted)'
  };
  const sourceColors = ['var(--verm)', 'var(--mustard)', 'var(--blue)', 'var(--sage)', 'var(--ink)', 'var(--paper-2)'];
  const snapshots = s.snapshots.slice(-10).reverse();
  const recent = [...s.recentWritings].reverse();

  root.innerHTML = `
    <section class="page">
      <header class="page-head">
        <div class="page-index">06</div>
        <div class="page-head-main">
          <div class="eyebrow">PROGRESS LEDGER</div>
          <h1 class="display">所有动作<br>都留下<em>痕迹</em>。</h1>
          <p class="page-sub">这里只记录发生过的事：复习了多少张、写了多少词、哪些材料真的被用进了文章。</p>
        </div>
        <div class="page-stamp">CEFR<b>${esc(combined)}</b>NOW</div>
      </header>

      <div class="kpi-grid">
        <div class="kpi"><div class="k">连续闭环</div><div class="v">${s.streak.current}<small> 天</small></div><div class="hint">最长 ${s.streak.longest} 天</div></div>
        <div class="kpi"><div class="k">累计写作</div><div class="v">${s.totalWords.toLocaleString()}<small> 词</small></div><div class="hint">${s.writings} 篇已提交</div></div>
        <div class="kpi"><div class="k">材料总数</div><div class="v">${totalMaterials}<small> 条</small></div><div class="hint">收件箱 ${s.statusCounts.inbox || 0} 条待处理</div></div>
        <div class="kpi kpi--dark"><div class="k">主动使用率</div><div class="v">${s.activeUse.rate === null ? '—' : s.activeUse.rate + '<small>%</small>'}</div><div class="hint" style="color:rgba(239,231,215,.65)">${s.activeUse.rate === null ? '样本不足 10 条' : `${s.activeUse.used}/${s.activeUse.base} 条被写进文章`}</div></div>
      </div>

      <article class="card">
        <div class="card-top">
          <div>
            <div class="eyebrow">LAST 30 DAYS</div>
            <h2 class="card-title">复习与写作的活动密度</h2>
          </div>
          <div class="legend">
            <span><i style="background:#F2D79A"></i>低</span>
            <span><i style="background:var(--mustard)"></i>中</span>
            <span><i style="background:var(--verm)"></i>高</span>
            <span><i style="background:var(--verm-deep)"></i>很高</span>
          </div>
        </div>
        <div class="heat-wrap">
          <div class="heat">
            ${s.heat.map((d) => `<div class="cell" data-l="${intensity(d.reviews, d.words)}" title="${esc(d.day)} · ${d.reviews} 复习 · ${d.words} 词"></div>`).join('')}
          </div>
          <div class="heat-axis">
            <span>${esc(shortDay(s.heat[0]?.day))}</span>
            <span>${esc(shortDay(s.heat[s.heat.length - 1]?.day))}</span>
          </div>
        </div>
      </article>

      <div class="grid-12" style="margin-top:26px">
        <article class="card span-7">
          <div class="eyebrow">WRITING VOLUME</div>
          <h2 class="card-title">最近 14 天写了多少词</h2>
          <div class="bars">
            ${last14.map((d) => `
              <div class="bar-wrap" title="${esc(d.day)} · ${d.words} 词">
                <div class="bar ${d.reviews ? 'alt' : ''}" style="height:${Math.max(2, Math.round((d.words || 0) / maxWords * 100))}%"></div>
                <div class="bar-lbl">${esc(shortDay(d.day))}</div>
              </div>`).join('')}
          </div>
          <div class="legend" style="margin-top:12px">
            <span><i style="background:var(--verm)"></i>有写作</span>
            <span><i style="background:var(--mustard)"></i>当天也有复习</span>
            <span>峰值 ${maxWords} 词 / 天</span>
          </div>
        </article>

        <article class="card span-5">
          <div class="eyebrow">THIS WEEK</div>
          <h2 class="card-title">周报</h2>
          <ul class="mini-list">
            <li><span>复习卡片</span><span>${weekReviews} 张</span></li>
            <li><span>写作词数</span><span>${weekWords} 词</span></li>
            <li><span>连续闭环</span><span>${s.streak.current} 天</span></li>
            <li><span>主动使用率</span><span>${s.activeUse.rate === null ? '—' : s.activeUse.rate + '%'}</span></li>
          </ul>
          <div class="dashed"></div>
          <p class="hint">主动使用率 = 最近 28 天学过的材料中，被写进文章的比例。低于 10 条样本时不显示。</p>
        </article>
      </div>

      <div class="grid-12" style="margin-top:26px">
        <article class="card span-5">
          <div class="eyebrow">ABILITY</div>
          <h2 class="card-title">两维能力对照</h2>
          <div class="score-grid" style="grid-template-columns:1fr 1fr">
            <div class="score-cell">
              <div class="s">${esc(vocabLevel || '—')}</div>
              <div class="n">词汇量</div>
              <div class="note">${vocabLow ? `${vocabLow}–${vocabHigh} 词` : '还没测过'}</div>
            </div>
            <div class="score-cell">
              <div class="s">${esc(writingLevel || '—')}</div>
              <div class="n">写作</div>
              <div class="note">${writingScore ? `均分 ${Number(writingScore).toFixed(1)} / 5` : '还没测过'}</div>
            </div>
          </div>
          <div class="dashed"></div>
          <div class="mini-list">
            <li><span>综合等级取两者较低值</span><span>${esc(combined)}</span></li>
          </div>
          <div style="margin-top:16px"><a class="btn btn--sm" href="#/tests">去测试 →</a></div>
        </article>

        <article class="card span-7">
          <div class="eyebrow">SNAPSHOTS</div>
          <h2 class="card-title">能力快照</h2>
          ${snapshots.length ? `<table class="stat-table">
            <thead><tr><th>日期</th><th>词汇区间</th><th>写作均分</th><th>等级</th><th>来源</th></tr></thead>
            <tbody>
              ${snapshots.map((x) => `<tr>
                <td>${esc(x.day)}</td>
                <td class="num">${x.vocab_low ? `${x.vocab_low}–${x.vocab_high}` : '—'}</td>
                <td class="num">${x.writing_score ? Number(x.writing_score).toFixed(1) : '—'}</td>
                <td class="num">${esc(x.cefr || '—')}</td>
                <td>${esc({ vocab: '词汇测试', writing: '写作测试' }[x.source] || x.source)}</td>
              </tr>`).join('')}
            </tbody>
          </table>` : `<div class="hint">还没有能力测试记录。做完第一次测试后，这里会出现基线。</div>`}
        </article>
      </div>

      <div class="grid-12" style="margin-top:26px">
        <article class="card span-5">
          <div class="eyebrow">MATERIAL FLOW</div>
          <h2 class="card-title">材料处在哪一环</h2>
          <div class="stack-bar">
            ${['inbox', 'learning', 'mastered', 'archived'].map((k) => {
              const n = s.statusCounts[k] || 0;
              return n ? `<span style="width:${(n / Math.max(1, totalMaterials)) * 100}%;background:${statusColors[k]}" title="${statusLabel(k)} ${n}"></span>` : '';
            }).join('')}
          </div>
          <div class="legend" style="margin-top:12px">
            ${['inbox', 'learning', 'mastered', 'archived'].map((k) => `
              <span><i style="background:${statusColors[k]}"></i>${esc(statusLabel(k))} ${s.statusCounts[k] || 0}</span>`).join('')}
          </div>
          <div class="dashed"></div>
          <div class="eyebrow">SOURCES</div>
          ${sources.length ? `
            <div class="stack-bar" style="margin-top:10px">
              ${sources.map((x, i) => `<span style="width:${(x.value / Math.max(1, totalMaterials)) * 100}%;background:${sourceColors[i % sourceColors.length]}" title="${esc(sourceLabel(x.name))} ${x.value}"></span>`).join('')}
            </div>
            <div class="legend" style="margin-top:12px">
              ${sources.map((x, i) => `<span><i style="background:${sourceColors[i % sourceColors.length]}"></i>${esc(sourceLabel(x.name))} ${x.value}</span>`).join('')}
            </div>
          ` : `<div class="hint">还没有收集材料。</div>`}
        </article>

        <article class="card span-7">
          <div class="card-top">
            <div>
              <div class="eyebrow">RECENT WRITINGS</div>
              <h2 class="card-title">最近写完的东西</h2>
            </div>
            <a class="btn btn--sm" href="#/writing">去写作 →</a>
          </div>
          ${recent.length ? `<table class="stat-table">
            <thead><tr><th>日期</th><th>题目</th><th>词数</th><th>均分</th><th></th></tr></thead>
            <tbody>
              ${recent.map((w) => `<tr>
                <td>${esc(shortDay(w.day))}</td>
                <td>${esc(w.title || '自由写作')}</td>
                <td class="num">${w.word_count}</td>
                <td class="num">${w.score ? Number(w.score).toFixed(1) : '—'}</td>
                <td class="num"><a href="#/writing?id=${w.id}" style="color:var(--verm-deep)">打开</a></td>
              </tr>`).join('')}
            </tbody>
          </table>` : `<div class="hint">还没有稿子。</div>`}
        </article>
      </div>
    </section>`;
}
