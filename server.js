import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db, DB_PATH, BACKUP_DIR, EXPORT_DIR, initDb, allSettings, setSetting,
  today, nowISO, localDay, refreshLoopDay, streak, createMaterial, learnMaterial,
  reviewQueue, gradeCard, pickPrompt, createWriting, countWords, heuristicFeedback,
  buildQuestion, vocabResult, addSnapshot, scoreToCefr, clearDemo, normalize
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';

initDb();
backupIfNeeded();

/* ------------------------- 静态文件 ------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const target = clean === '/' ? '/index.html' : clean;
  const filePath = path.join(PUBLIC, target);
  if (!filePath.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (clean !== '/' && !path.extname(clean)) return serveStatic(req, res, '/index.html');
      return send(res, 404, 'Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 4 * 1024 * 1024) reject(new Error('请求体过大'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}

/* ------------------------- AI ------------------------- */
async function aiChat(messages, { jsonMode = true } = {}) {
  const s = allSettings();
  if (!s.ai_key) return null;
  const base = String(s.ai_base || '').replace(/\/+$/, '');
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.ai_key}` },
    body: JSON.stringify({
      model: s.ai_model,
      temperature: 0.2,
      messages,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
    }),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) throw new Error(`AI 服务返回 ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || null;
}

const FEEDBACK_SCHEMA = `{
  "rubric": {
    "task": {"score": 1-5, "note": "一句依据"},
    "organization": {"score": 1-5, "note": "一句依据"},
    "lexical": {"score": 1-5, "note": "一句依据"},
    "grammar": {"score": 1-5, "note": "一句依据"}
  },
  "corrections": [{"original": "", "suggestion": "", "reason": "", "type": "grammar|collocation|register|logic"}],
  "rewrite": "保持原意与长度相近的完整重写",
  "priorities": ["可执行的第 1 条改进", "...", "..."],
  "suggestions": [{"content": "值得收集的英文表达", "meaning": "中文释义"}]
}`;

async function aiFeedback(body, promptText) {
  const learned = db.prepare(
    `SELECT id, content FROM materials WHERE status IN ('learning','mastered') AND deleted_at IS NULL`
  ).all();
  const content = await aiChat([
    {
      role: 'system',
      content: `你是英语写作教练。请严格输出 JSON，不要输出 Markdown。评分维度为任务完成、组织衔接、词汇资源、语法准确，各 1-5 分。只列出确实有问题的句子，最多 20 条。rewrite 必须保持原意与相近长度。priorities 恰好 3 条且可执行。suggestions 3-5 条。输出结构：${FEEDBACK_SCHEMA}`
    },
    {
      role: 'user',
      content: `题目：${promptText || '自由写作'}\n\n作文：\n${body}\n\n可用已学表达列表（若作文中使用，请在 suggestions 之外不要改动）：\n${learned.map((m) => m.content).join('; ')}`
    }
  ]);
  if (!content) return null;
  const parsed = JSON.parse(content);
  const usedRows = learned.filter((m) => {
    const key = normalize(m.content);
    return key.length > 2 && normalize(body).includes(key);
  });
  return { mode: 'ai', ...parsed, used: usedRows.map((m) => ({ id: m.id, content: m.content })) };
}

function recordUsage(used) {
  if (!Array.isArray(used)) return;
  for (const u of used) {
    db.prepare('UPDATE materials SET use_count = use_count + 1, last_used_at = ? WHERE id = ?')
      .run(nowISO(), u.id);
  }
}

/* ------------------------- 统计 ------------------------- */
function statsPayload() {
  const days = [];
  for (let i = 29; i >= 0; i--) days.push(localDay(Date.now() - i * 86400000, 4));
  const reviews = Object.fromEntries(
    db.prepare(`SELECT day, COUNT(*) AS n FROM review_logs WHERE day >= ? GROUP BY day`)
      .all(days[0]).map((r) => [r.day, r.n])
  );
  const words = Object.fromEntries(
    db.prepare(`SELECT day, SUM(word_count) AS n FROM writings
      WHERE mode != 'test' AND status IN ('submitted','reviewed') AND day >= ? GROUP BY day`)
      .all(days[0]).map((r) => [r.day, r.n || 0])
  );
  const added = Object.fromEntries(
    db.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM materials GROUP BY day`)
      .all().map((r) => [r.day, r.n])
  );

  const heat = days.map((day) => ({ day, reviews: reviews[day] || 0, words: words[day] || 0 }));

  const sources = db.prepare(
    `SELECT source_type AS name, COUNT(*) AS value FROM materials WHERE deleted_at IS NULL GROUP BY source_type ORDER BY value DESC`
  ).all();

  const statusCounts = Object.fromEntries(
    db.prepare(`SELECT status, COUNT(*) AS n FROM materials WHERE deleted_at IS NULL GROUP BY status`)
      .all().map((r) => [r.status, r.n])
  );

  const cutoff = new Date(Date.now() - 28 * 86400000).toISOString();
  const base = db.prepare(
    `SELECT COUNT(*) AS n FROM materials WHERE learned_at >= ? AND deleted_at IS NULL`
  ).get(cutoff).n;
  const used = db.prepare(
    `SELECT COUNT(*) AS n FROM materials WHERE learned_at >= ? AND last_used_at >= ? AND deleted_at IS NULL`
  ).get(cutoff, cutoff).n;

  const due = db.prepare(
    `SELECT COUNT(*) AS n FROM cards c JOIN materials m ON m.id=c.material_id
     WHERE c.due_at <= ? AND m.status IN ('learning','mastered') AND m.deleted_at IS NULL`
  ).get(nowISO()).n;
  const newCards = db.prepare(
    `SELECT COUNT(*) AS n FROM cards c JOIN materials m ON m.id=c.material_id
     WHERE c.reps = 0 AND m.status = 'learning' AND m.deleted_at IS NULL`
  ).get().n;

  const totalWords = db.prepare(
    `SELECT COALESCE(SUM(word_count),0) AS n FROM writings WHERE mode != 'test' AND status IN ('submitted','reviewed')`
  ).get().n;
  const writings = db.prepare(`SELECT COUNT(*) AS n FROM writings WHERE mode != 'test' AND status IN ('submitted','reviewed')`).get().n;

  const vocabSnap = db.prepare(
    `SELECT * FROM snapshots WHERE vocab_low IS NOT NULL ORDER BY id DESC LIMIT 1`
  ).get();
  const writingSnap = db.prepare(
    `SELECT * FROM snapshots WHERE writing_score IS NOT NULL ORDER BY id DESC LIMIT 1`
  ).get();
  const snaps = db.prepare('SELECT * FROM snapshots ORDER BY id DESC LIMIT 20').all().reverse();

  const recentWritings = db.prepare(
    `SELECT id, day, title, word_count, status, feedback_json FROM writings
     WHERE mode != 'test' AND status IN ('submitted','reviewed')
     ORDER BY id DESC LIMIT 8`
  ).all().map((w) => {
    let score = null;
    try {
      const fb = JSON.parse(w.feedback_json || '{}');
      const r = fb.rubric || {};
      const vals = ['task', 'organization', 'lexical', 'grammar'].map((k) => r[k]?.score).filter(Boolean);
      score = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    } catch { /* ignore */ }
    return { ...w, feedback_json: undefined, score };
  }).reverse();

  return {
    heat, sources, statusCounts, due, newCards,
    activeUse: { base, used, rate: base >= 10 ? Math.round((used / base) * 100) : null },
    totalWords, writings,
    vocab: vocabSnap || null,
    writing: writingSnap || null,
    snapshots: snaps,
    recentWritings,
    streak: streak(Number(allSettings().day_boundary) || 4)
  };
}

/* ------------------------- 路由 ------------------------- */
async function api(req, res, pathname, query) {
  const m = req.method;

  if (pathname === '/api/bootstrap' && m === 'GET') {
    const day = refreshLoopDay(today());
    const due = statsPayload();
    return json(res, 200, {
      day,
      today: today(),
      loop: day,
      streak: due.streak,
      counts: {
        inbox: db.prepare(`SELECT COUNT(*) AS n FROM materials WHERE status='inbox' AND deleted_at IS NULL`).get().n,
        learning: db.prepare(`SELECT COUNT(*) AS n FROM materials WHERE status='learning' AND deleted_at IS NULL`).get().n,
        due: due.due,
        newCards: due.newCards
      },
      settings: publicSettings()
    });
  }

  /* 材料 */
  if (pathname === '/api/materials' && m === 'GET') {
    const status = query.get('status') || '';
    const q = query.get('q') || '';
    const source = query.get('source') || '';
    let sql = `SELECT * FROM materials WHERE deleted_at IS NULL`;
    const args = [];
    if (status) { sql += ' AND status = ?'; args.push(status); }
    if (source) { sql += ' AND source_type = ?'; args.push(source); }
    if (q) {
      sql += ' AND (content LIKE ? OR meaning LIKE ? OR context LIKE ?)';
      const like = `%${q}%`;
      args.push(like, like, like);
    }
    sql += ' ORDER BY id DESC LIMIT 300';
    const rows = db.prepare(sql).all(...args);
    return json(res, 200, rows);
  }

  if (pathname === '/api/materials' && m === 'POST') {
    const body = await readBody(req);
    try {
      const material = createMaterial(body);
      enrichLater(material.id, body.content);
      return json(res, 200, material);
    } catch (e) {
      if (e.message === 'duplicate') {
        const dup = db.prepare('SELECT * FROM materials WHERE id = ?').get(e.duplicateId);
        return json(res, 409, { error: 'duplicate', existing: dup });
      }
      return json(res, 400, { error: e.message });
    }
  }

  const matMatch = pathname.match(/^\/api\/materials\/(\d+)$/);
  if (matMatch) {
    const id = Number(matMatch[1]);
    if (m === 'GET') {
      const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
      if (!row) return json(res, 404, { error: '材料不存在' });
      const logs = db.prepare('SELECT * FROM review_logs WHERE material_id = ? ORDER BY id DESC LIMIT 20').all(id);
      const card = db.prepare('SELECT * FROM cards WHERE material_id = ?').get(id);
      return json(res, 200, { ...row, logs, card });
    }
    if (m === 'PATCH') {
      const body = await readBody(req);
      const fields = ['content', 'type', 'source_type', 'source_name', 'locator', 'context', 'meaning', 'pos', 'cefr'];
      const sets = [];
      const args = [];
      for (const f of fields) {
        if (body[f] !== undefined) { sets.push(`${f} = ?`); args.push(body[f]); }
      }
      if (body.content !== undefined) {
        sets.push('norm = ?'); args.push(normalize(body.content));
      }
      if (body.meaning !== undefined) sets.push(`enrich_status = 'manual'`);
      if (sets.length) {
        args.push(id);
        db.prepare(`UPDATE materials SET ${sets.join(', ')} WHERE id = ?`).run(...args);
      }
      return json(res, 200, db.prepare('SELECT * FROM materials WHERE id = ?').get(id));
    }
    if (m === 'DELETE') {
      db.prepare('UPDATE materials SET deleted_at = ? WHERE id = ?').run(nowISO(), id);
      return json(res, 200, { ok: true });
    }
  }

  const learnMatch = pathname.match(/^\/api\/materials\/(\d+)\/learn$/);
  if (learnMatch && m === 'POST') {
    return json(res, 200, learnMaterial(Number(learnMatch[1])));
  }

  const enrichMatch = pathname.match(/^\/api\/materials\/(\d+)\/enrich$/);
  if (enrichMatch && m === 'POST') {
    const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(Number(enrichMatch[1]));
    if (!row) return json(res, 404, { error: '材料不存在' });
    const updated = await enrichMaterial(row);
    return json(res, 200, updated);
  }

  /* 复习 */
  if (pathname === '/api/review/queue' && m === 'GET') {
    return json(res, 200, reviewQueue());
  }

  if (pathname === '/api/review/grade' && m === 'POST') {
    const body = await readBody(req);
    try {
      return json(res, 200, gradeCard(body.card_id, body.rating, body.elapsed_ms, body.manual));
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  /* 写作 */
  if (pathname === '/api/writings' && m === 'GET') {
    const rows = db.prepare(
      `SELECT id, day, mode, title, word_count, status, created_at, submitted_at,
        json_extract(feedback_json, '$.mode') AS fb_mode
       FROM writings ORDER BY id DESC LIMIT 100`
    ).all();
    return json(res, 200, rows);
  }

  if (pathname === '/api/writings' && m === 'POST') {
    const body = await readBody(req);
    if (body.mode === 'test') {
      const used = db.prepare(`SELECT prompt_id FROM writings WHERE mode = 'test' AND status != 'draft'`).all().map((r) => r.prompt_id);
      const p = pickPrompt('test', used) || pickPrompt('test');
      return json(res, 200, createWriting({ mode: 'test', promptId: p?.id || null }));
    }
    let promptId = body.prompt_id || null;
    if (body.mode === 'prompt' && !promptId) {
      const used = db.prepare(`SELECT prompt_id FROM writings WHERE prompt_id IS NOT NULL ORDER BY id DESC LIMIT 20`).all().map((r) => r.prompt_id);
      const p = pickPrompt('daily', used) || pickPrompt('daily');
      promptId = p?.id || null;
    }
    return json(res, 200, createWriting({ mode: body.mode || 'prompt', promptId }));
  }

  const writeMatch = pathname.match(/^\/api\/writings\/(\d+)$/);
  if (writeMatch) {
    const id = Number(writeMatch[1]);
    const row = db.prepare('SELECT * FROM writings WHERE id = ?').get(id);
    if (!row) return json(res, 404, { error: '写作稿不存在' });
    if (m === 'GET') {
      const prompt = row.prompt_id ? db.prepare('SELECT * FROM prompts WHERE id = ?').get(row.prompt_id) : null;
      return json(res, 200, { ...row, prompt });
    }
    if (m === 'PATCH') {
      if (row.status !== 'draft') return json(res, 400, { error: '已提交的稿件不可修改' });
      const body = await readBody(req);
      const wc = countWords(body.body ?? row.body);
      db.prepare('UPDATE writings SET body = ?, word_count = ?, duration_s = ? WHERE id = ?')
        .run(body.body ?? row.body, wc, body.duration_s ?? row.duration_s, id);
      return json(res, 200, db.prepare('SELECT * FROM writings WHERE id = ?').get(id));
    }
  }

  const submitMatch = pathname.match(/^\/api\/writings\/(\d+)\/submit$/);
  if (submitMatch && m === 'POST') {
    const id = Number(submitMatch[1]);
    const row = db.prepare('SELECT * FROM writings WHERE id = ?').get(id);
    if (!row) return json(res, 404, { error: '写作稿不存在' });
    if (row.status !== 'draft') return json(res, 409, { error: '该稿已提交' });
    const body = await readBody(req);
    const text = body.body ?? row.body;
    const wc = countWords(text);
    const prompt = row.prompt_id ? db.prepare('SELECT * FROM prompts WHERE id = ?').get(row.prompt_id) : null;
    const s = allSettings();
    const minWords = row.mode === 'social' ? Number(s.post_min_words) : Number(s.min_words);
    if (!body.force && wc < minWords) {
      return json(res, 400, { error: `至少需要 ${minWords} 词`, need_words: minWords });
    }
    db.prepare(
      `UPDATE writings SET body = ?, word_count = ?, duration_s = ?, status = 'submitted', submitted_at = ? WHERE id = ?`
    ).run(text, wc, body.duration_s ?? row.duration_s, nowISO(), id);

    let fb;
    try {
      fb = await aiFeedback(text, prompt?.text || '');
    } catch (e) {
      fb = null;
    }
    if (!fb) fb = heuristicFeedback(text, prompt?.text || '');
    recordUsage(fb.used);

    db.prepare(`UPDATE writings SET status = 'reviewed', feedback_json = ?, rewrite = ?, model = ? WHERE id = ?`)
      .run(JSON.stringify(fb), fb.rewrite || text, fb.mode === 'ai' ? s.ai_model : 'local', id);

    let snapshot = null;
    if (row.mode === 'test') {
      const r = fb.rubric || {};
      const vals = ['task', 'organization', 'lexical', 'grammar'].map((k) => r[k]?.score).filter(Boolean);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      if (avg) {
        snapshot = { day: today(), writing_score: Math.round(avg * 10) / 10, cefr: scoreToCefr(avg) };
        addSnapshot({ ...snapshot, source: 'writing' });
      }
    }

    refreshLoopDay(today());
    return json(res, 200, {
      writing: db.prepare('SELECT * FROM writings WHERE id = ?').get(id),
      feedback: fb,
      snapshot
    });
  }

  if (pathname === '/api/prompts/next' && m === 'GET') {
    const kind = query.get('kind') || 'daily';
    return json(res, 200, pickPrompt(kind));
  }

  /* 测试 */
  if (pathname === '/api/tests/vocab/start' && m === 'POST') {
    const info = db.prepare(
      `INSERT INTO tests (type, started_at, status, state_json) VALUES ('vocab', ?, 'active', ?)`
    ).run(nowISO(), JSON.stringify({ band: 3, asked: [], correct: 0, total: 0, bands: {}, pseudoAsked: 0, pseudoWrong: 0 }));
    const testId = Number(info.lastInsertRowid);
    const question = buildQuestion(3, [], 0);
    return json(res, 200, { test_id: testId, question, index: 0, total: 20 });
  }

  if (pathname === '/api/tests/vocab/answer' && m === 'POST') {
    const body = await readBody(req);
    const test = db.prepare('SELECT * FROM tests WHERE id = ?').get(body.test_id);
    if (!test || test.status !== 'active') return json(res, 400, { error: '测试不存在或已结束' });
    const state = JSON.parse(test.state_json);
    const q = body.question;
    if (!q) return json(res, 400, { error: '缺少题目' });
    const chosen = body.chosen;
    const correct = chosen === q.answer;
    state.total += 1;
    state.asked.push(q.word_id || 0);
    if (correct) state.correct += 1;
    if (q.pseudo) {
      state.pseudoAsked += 1;
      if (!correct) state.pseudoWrong += 1;
    }
    const bandKey = String(q.band);
    if (!state.bands[bandKey]) state.bands[bandKey] = { asked: 0, correct: 0 };
    state.bands[bandKey].asked += 1;
    if (correct) state.bands[bandKey].correct += 1;

    db.prepare(
      `INSERT INTO test_items (test_id, position, word_id, word, band, pseudo, chosen, correct, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(test.id, state.total, q.word_id || null, q.word, q.band, q.pseudo ? 1 : 0, chosen, correct ? 1 : 0, body.latency_ms || 0);

    if (correct) state.band = Math.min(6, state.band + 1);
    else state.band = Math.max(1, state.band - 1);

    if (state.total >= 20) {
      const result = vocabResult(state);
      db.prepare(`UPDATE tests SET status = 'finished', finished_at = ?, state_json = ?, result_json = ?, valid = ? WHERE id = ?`)
        .run(nowISO(), JSON.stringify(state), JSON.stringify(result), result.valid ? 1 : 0, test.id);
      if (result.valid) {
        addSnapshot({ day: today(), vocab_low: result.low, vocab_high: result.high, source: 'vocab' });
      }
      return json(res, 200, { done: true, result });
    }

    db.prepare('UPDATE tests SET state_json = ? WHERE id = ?').run(JSON.stringify(state), test.id);
    const next = buildQuestion(state.band, state.asked, state.total);
    return json(res, 200, { done: false, question: next, index: state.total, total: 20 });
  }

  if (pathname === '/api/tests/vocab/abort' && m === 'POST') {
    const body = await readBody(req);
    db.prepare(`UPDATE tests SET status = 'aborted', finished_at = ? WHERE id = ?`).run(nowISO(), body.test_id);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/tests' && m === 'GET') {
    const rows = db.prepare('SELECT * FROM tests ORDER BY id DESC LIMIT 50').all();
    return json(res, 200, rows);
  }

  /* 统计与设置 */
  if (pathname === '/api/stats' && m === 'GET') {
    return json(res, 200, statsPayload());
  }

  if (pathname === '/api/settings' && m === 'GET') {
    return json(res, 200, publicSettings());
  }

  if (pathname === '/api/settings' && m === 'PUT') {
    const body = await readBody(req);
    for (const [k, v] of Object.entries(body)) {
      if (k in allSettings()) setSetting(k, v);
    }
    return json(res, 200, publicSettings());
  }

  if (pathname === '/api/settings/test' && m === 'POST') {
    if (!allSettings().ai_key) {
      return json(res, 200, { ok: false, error: '尚未配置 API Key' });
    }
    try {
      const reply = await aiChat([
        { role: 'system', content: '只回复 JSON：{"ok":true}' },
        { role: 'user', content: 'ping' }
      ]);
      return json(res, 200, { ok: true, sample: reply });
    } catch (e) {
      return json(res, 200, { ok: false, error: e.message });
    }
  }

  if (pathname === '/api/backups' && m === 'GET') {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.db'))
      .map((f) => ({ name: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime.toISOString() }))
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    return json(res, 200, files);
  }

  if (pathname === '/api/backup' && m === 'POST') {
    const name = makeBackup();
    return json(res, 200, { ok: true, name });
  }

  if (pathname === '/api/export' && m === 'POST') {
    const body = await readBody(req);
    const type = body.type || 'json';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (type === 'json') {
      const dump = {
        exported_at: nowISO(),
        materials: db.prepare('SELECT * FROM materials').all(),
        cards: db.prepare('SELECT * FROM cards').all(),
        review_logs: db.prepare('SELECT * FROM review_logs').all(),
        writings: db.prepare('SELECT * FROM writings').all(),
        tests: db.prepare('SELECT * FROM tests').all(),
        snapshots: db.prepare('SELECT * FROM snapshots').all(),
        loop_days: db.prepare('SELECT * FROM loop_days').all()
      };
      const file = path.join(EXPORT_DIR, `english-loop-${stamp}.json`);
      fs.writeFileSync(file, JSON.stringify(dump, null, 2));
      return json(res, 200, { ok: true, file: path.basename(file) });
    }
    if (type === 'csv') {
      const rows = db.prepare(
        `SELECT id, content, type, meaning, source_type, source_name, locator, context, cefr, status, use_count, created_at FROM materials WHERE deleted_at IS NULL`
      ).all();
      const header = 'id,content,type,meaning,source_type,source_name,locator,context,cefr,status,use_count,created_at';
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [header, ...rows.map((r) => Object.values(r).map(esc).join(','))].join('\n');
      const file = path.join(EXPORT_DIR, `materials-${stamp}.csv`);
      fs.writeFileSync(file, '\ufeff' + csv, 'utf8');
      return json(res, 200, { ok: true, file: path.basename(file) });
    }
    return json(res, 400, { error: '未知导出类型' });
  }

  if (pathname === '/api/demo/clear' && m === 'POST') {
    clearDemo();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: '接口不存在' });
}

/* ------------------------- 补全与备份 ------------------------- */
function publicSettings() {
  const s = allSettings();
  return { ...s, ai_key: s.ai_key ? '••••••••' + String(s.ai_key).slice(-4) : '', has_key: Boolean(s.ai_key) };
}

async function enrichMaterial(row) {
  try {
    const reply = await aiChat([
      {
        role: 'system',
        content: `你是英语词典。只输出 JSON，结构：{"meaning":"中文释义","pos":"词性","cefr":"A1-C2","examples":["例句1","例句2"],"collocations":["搭配1","搭配2"]}`
      },
      { role: 'user', content: `内容：${row.content}\n语境：${row.context || '无'}` }
    ]);
    if (!reply) {
      db.prepare(`UPDATE materials SET enrich_status = 'manual' WHERE id = ?`).run(row.id);
      return db.prepare('SELECT * FROM materials WHERE id = ?').get(row.id);
    }
    const data = JSON.parse(reply);
    db.prepare(
      `UPDATE materials SET meaning = COALESCE(NULLIF(meaning,''), ?), pos = ?, cefr = ?, examples = ?, collocations = ?, enrich_status = 'ready'
       WHERE id = ?`
    ).run(data.meaning || '', data.pos || '', data.cefr || '', JSON.stringify(data.examples || []), JSON.stringify(data.collocations || []), row.id);
    return db.prepare('SELECT * FROM materials WHERE id = ?').get(row.id);
  } catch {
    db.prepare(`UPDATE materials SET enrich_status = 'failed' WHERE id = ?`).run(row.id);
    return db.prepare('SELECT * FROM materials WHERE id = ?').get(row.id);
  }
}

function enrichLater(id, content) {
  if (!allSettings().ai_key) {
    db.prepare(`UPDATE materials SET enrich_status = 'manual' WHERE id = ?`).run(id);
    return;
  }
  const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  enrichMaterial(row).catch(() => {});
}

function makeBackup() {
  const day = today();
  const name = `${day}.db`;
  const dest = path.join(BACKUP_DIR, name);
  try {
    fs.copyFileSync(DB_PATH, dest);
  } catch {
    fs.copyFileSync(DB_PATH + '-wal', dest);
  }
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort();
  while (files.length > 30) {
    fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  }
  return name;
}

function backupIfNeeded() {
  try {
    const day = today();
    const dest = path.join(BACKUP_DIR, `${day}.db`);
    if (!fs.existsSync(dest)) makeBackup();
  } catch { /* 备份失败不阻塞启动 */ }
}

/* ------------------------- 启动 ------------------------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    api(req, res, url.pathname, url.searchParams).catch((e) => {
      console.error(e);
      json(res, 500, { error: e.message || '服务器错误' });
    });
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  English Loop  ·  http://localhost:${PORT}\n  数据位置: ${DB_PATH}\n`);
});
