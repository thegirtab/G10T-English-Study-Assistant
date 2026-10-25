import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, 'data');
export const DB_PATH = path.join(DATA_DIR, 'english-loop.db');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const EXPORT_DIR = path.join(DATA_DIR, 'exports');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(EXPORT_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'word',
  norm TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'other',
  source_name TEXT,
  locator TEXT,
  context TEXT,
  meaning TEXT,
  pos TEXT,
  cefr TEXT,
  examples TEXT,
  collocations TEXT,
  enrich_status TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'inbox',
  created_at TEXT NOT NULL,
  learned_at TEXT,
  archived_at TEXT,
  deleted_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_materials_status ON materials(status);
CREATE INDEX IF NOT EXISTS idx_materials_norm ON materials(norm);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL UNIQUE REFERENCES materials(id) ON DELETE CASCADE,
  due_at TEXT NOT NULL,
  interval_d REAL NOT NULL DEFAULT 0,
  ease REAL NOT NULL DEFAULT 2.5,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_rating INTEGER,
  last_reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due_at);

CREATE TABLE IF NOT EXISTS review_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  material_id INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  correct INTEGER NOT NULL DEFAULT 1,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  manual INTEGER NOT NULL DEFAULT 0,
  reviewed_at TEXT NOT NULL,
  day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_day ON review_logs(day);

CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'daily',
  genre TEXT NOT NULL,
  cefr TEXT NOT NULL,
  text TEXT NOT NULL,
  required_words TEXT,
  last_used TEXT
);

CREATE TABLE IF NOT EXISTS writings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'prompt',
  prompt_id INTEGER,
  title TEXT,
  body TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  duration_s INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  feedback_json TEXT,
  rewrite TEXT,
  model TEXT,
  use_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_writings_day ON writings(day);

CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  state_json TEXT,
  result_json TEXT,
  valid INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS test_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  word_id INTEGER,
  word TEXT,
  band INTEGER,
  pseudo INTEGER NOT NULL DEFAULT 0,
  chosen TEXT,
  correct INTEGER,
  latency_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_items_test ON test_items(test_id);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  vocab_low INTEGER,
  vocab_high INTEGER,
  writing_score REAL,
  cefr TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loop_days (
  day TEXT PRIMARY KEY,
  review_done INTEGER NOT NULL DEFAULT 0,
  writing_done INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,
  meaning TEXT NOT NULL,
  band INTEGER NOT NULL,
  pos TEXT
);
`);

/* ---------------- 基础工具 ---------------- */

export const nowISO = () => new Date().toISOString();

export function localDay(ts = Date.now(), boundaryHour = 4) {
  const d = new Date(ts - boundaryHour * 3600 * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dayOffset(n, boundaryHour = 4) {
  return localDay(Date.now() + n * 86400000, boundaryHour);
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value));
}

export const DEFAULT_SETTINGS = {
  ai_base: 'https://api.openai.com/v1',
  ai_key: '',
  ai_model: 'gpt-4o-mini',
  new_limit: 15,
  review_limit: 60,
  min_words: 50,
  post_min_words: 30,
  day_boundary: 4,
  budget: ''
};

export function ensureSettings() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    const exists = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(k);
    if (!exists) setSetting(k, v);
  }
}

export function allSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[row.key] = JSON.parse(row.value); } catch { out[row.key] = row.value; }
  }
  return out;
}

export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function today() {
  return localDay(Date.now(), Number(getSetting('day_boundary', 4)));
}

export function ensureLoopDay(day) {
  db.prepare('INSERT OR IGNORE INTO loop_days (day) VALUES (?)').run(day);
  return db.prepare('SELECT * FROM loop_days WHERE day = ?').get(day);
}

export function refreshLoopDay(day) {
  const boundary = Number(getSetting('day_boundary', 4));
  const dueLeft = db.prepare(
    `SELECT COUNT(*) AS n FROM cards c
     JOIN materials m ON m.id = c.material_id
     WHERE c.due_at <= ? AND m.status IN ('learning','mastered') AND m.deleted_at IS NULL`
  ).get(new Date().toISOString()).n;

  const doneToday = db.prepare('SELECT COUNT(*) AS n FROM review_logs WHERE day = ?').get(day).n;
  const writing = db.prepare(
    `SELECT COUNT(*) AS n FROM writings WHERE day = ? AND status IN ('reviewed','submitted') AND mode != 'test'`
  ).get(day).n;

  ensureLoopDay(day);
  // 当日有任何一条到期卡片被处理过，即视为复习完成；没有到期卡片则直接算完成
  const reviewDone = doneToday > 0 || dueLeft === 0;
  const writingDone = writing > 0;
  const completed = reviewDone && writingDone ? 1 : 0;
  db.prepare(
    'UPDATE loop_days SET review_done = ?, writing_done = ?, completed = ?, completed_at = ? WHERE day = ?'
  ).run(reviewDone ? 1 : 0, writingDone ? 1 : 0, completed, completed ? (getLatest(day) || nowISO()) : null, day);
  return db.prepare('SELECT * FROM loop_days WHERE day = ?').get(day);
}

function getLatest(day) {
  const row = db.prepare('SELECT completed_at FROM loop_days WHERE day = ?').get(day);
  return row?.completed_at || null;
}

export function streak(boundary = 4) {
  let count = 0;
  let cursor = 0;
  let longest = 0;
  let run = 0;
  const rows = db.prepare('SELECT day, completed FROM loop_days ORDER BY day ASC').all();
  const map = new Map(rows.map((r) => [r.day, r.completed]));
  for (const r of rows) {
    if (r.completed) { run += 1; longest = Math.max(longest, run); } else { run = 0; }
  }
  while (true) {
    const d = localDay(Date.now() - cursor * 86400000, boundary);
    if (map.get(d) === 1) { count += 1; cursor += 1; } else {
      // 今天还没完成不算断签
      if (cursor === 0) { cursor += 1; continue; }
      break;
    }
  }
  return { current: count, longest };
}

/* ---------------- 材料与卡片 ---------------- */

export function findDuplicate(norm, exceptId = 0) {
  return db.prepare(
    'SELECT * FROM materials WHERE norm = ? AND id != ? AND deleted_at IS NULL'
  ).get(norm, exceptId);
}

export function createMaterial(input) {
  const content = String(input.content || '').trim();
  if (!content) throw new Error('内容不能为空');
  const type = input.type || guessType(content);
  const norm = normalize(content);
  const dup = findDuplicate(norm);
  if (dup) {
    const err = new Error('duplicate');
    err.duplicateId = dup.id;
    throw err;
  }
  const info = db.prepare(
    `INSERT INTO materials
     (content, type, norm, source_type, source_name, locator, context, meaning, pos, cefr, enrich_status, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inbox', ?)`
  ).run(
    content,
    type,
    norm,
    input.source_type || 'other',
    input.source_name || '',
    input.locator || '',
    input.context || '',
    input.meaning || '',
    input.pos || '',
    input.cefr || '',
    input.meaning ? 'manual' : 'pending',
    nowISO()
  );
  return db.prepare('SELECT * FROM materials WHERE id = ?').get(info.lastInsertRowid);
}

export function guessType(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return 'word';
  if (words.length <= 4) return 'phrase';
  if (/^(if|when|although|because|while|unless)\b/i.test(text)) return 'grammar';
  return 'sentence';
}

export function learnMaterial(id) {
  const m = db.prepare('SELECT * FROM materials WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!m) throw new Error('材料不存在');
  db.prepare(
    `UPDATE materials SET status = 'learning', learned_at = COALESCE(learned_at, ?) WHERE id = ?`
  ).run(nowISO(), id);
  const card = db.prepare('SELECT * FROM cards WHERE material_id = ?').get(id);
  if (!card) {
    db.prepare(
      'INSERT INTO cards (material_id, due_at, interval_d, ease, reps, lapses) VALUES (?, ?, 0, 2.5, 0, 0)'
    ).run(id, nowISO());
  }
  return db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
}

export function reviewQueue() {
  const now = nowISO();
  const s = allSettings();
  const newLimit = Number(s.new_limit) || 15;
  const reviewLimit = Number(s.review_limit) || 60;

  const due = db.prepare(
    `SELECT c.*, m.content, m.type AS mtype, m.meaning, m.context, m.source_type, m.source_name,
            m.locator, m.cefr, m.status AS mstatus
     FROM cards c JOIN materials m ON m.id = c.material_id
     WHERE c.due_at <= ? AND m.status IN ('learning','mastered') AND m.deleted_at IS NULL
     ORDER BY c.due_at ASC LIMIT ?`
  ).all(now, reviewLimit);

  const fresh = db.prepare(
    `SELECT c.*, m.content, m.type AS mtype, m.meaning, m.context, m.source_type, m.source_name,
            m.locator, m.cefr, m.status AS mstatus
     FROM cards c JOIN materials m ON m.id = c.material_id
     WHERE c.reps = 0 AND c.due_at > ? AND m.status = 'learning' AND m.deleted_at IS NULL
     ORDER BY c.id ASC LIMIT ?`
  ).all(now, newLimit);

  return { due, fresh, newLimit, reviewLimit };
}

export function gradeCard(cardId, rating, elapsedMs = 0, manual = 0) {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!card) throw new Error('卡片不存在');
  const r = Math.min(4, Math.max(1, Number(rating) || 3));
  let ease = card.ease;
  let interval = card.interval_d;
  let lapses = card.lapses;
  let reps = card.reps + 1;
  const correct = r >= 3 ? 1 : 0;

  if (r === 1) {
    ease = Math.max(1.3, ease - 0.2);
    interval = 0;
    lapses += 1;
  } else if (r === 2) {
    ease = Math.max(1.3, ease - 0.05);
    interval = interval <= 1 ? 1 : Math.max(1, Math.round(interval * 1.2));
  } else if (r === 3) {
    interval = interval < 1 ? 1 : Math.round(interval * ease);
  } else {
    ease = Math.min(2.8, ease + 0.1);
    interval = interval < 1 ? 2 : Math.round(interval * ease * 1.3);
  }
  interval = Math.min(365, interval);

  const dueAt = r === 1
    ? new Date(Date.now() + 10 * 60 * 1000).toISOString()
    : new Date(Date.now() + interval * 86400000).toISOString();

  db.prepare(
    `UPDATE cards SET due_at = ?, interval_d = ?, ease = ?, reps = ?, lapses = ?,
      last_rating = ?, last_reviewed_at = ? WHERE id = ?`
  ).run(dueAt, interval, ease, reps, lapses, r, nowISO(), cardId);

  const day = today();
  db.prepare(
    `INSERT INTO review_logs (card_id, material_id, rating, correct, elapsed_ms, manual, reviewed_at, day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(cardId, card.material_id, r, correct, Number(elapsedMs) || 0, manual ? 1 : 0, nowISO(), day);

  // 连续 3 次"一般及以上"且间隔 >= 30 天 -> 已掌握
  if (r >= 3 && interval >= 30) {
    const recent = db.prepare(
      'SELECT rating FROM review_logs WHERE card_id = ? ORDER BY id DESC LIMIT 3'
    ).all(cardId);
    if (recent.length === 3 && recent.every((x) => x.rating >= 3)) {
      db.prepare(`UPDATE materials SET status = 'mastered' WHERE id = ? AND status = 'learning'`).run(card.material_id);
    }
  }
  if (r === 1) {
    db.prepare(`UPDATE materials SET status = 'learning' WHERE id = ? AND status = 'mastered'`).run(card.material_id);
  }
  const d = refreshLoopDay(day);
  return { card: db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId), loopDay: d };
}

/* ---------------- 写作 ---------------- */

const CONNECTIVES = ['however', 'therefore', 'moreover', 'although', 'because', 'while', 'instead', 'meanwhile', 'furthermore', 'in addition'];

export function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function pickPrompt(kind = 'daily', excludeIds = []) {
  const rows = db.prepare('SELECT * FROM prompts WHERE kind = ? ORDER BY RANDOM()').all(kind);
  const filtered = rows.filter((r) => !excludeIds.includes(r.id));
  return filtered[0] || rows[0] || null;
}

export function createWriting({ mode = 'prompt', promptId = null }) {
  const day = today();
  const prompt = promptId ? db.prepare('SELECT * FROM prompts WHERE id = ?').get(promptId) : null;
  const info = db.prepare(
    `INSERT INTO writings (day, mode, prompt_id, title, body, status, created_at)
     VALUES (?, ?, ?, ?, '', 'draft', ?)`
  ).run(day, mode, promptId, prompt?.text || '自由写作', nowISO());
  return db.prepare('SELECT * FROM writings WHERE id = ?').get(info.lastInsertRowid);
}

export function heuristicFeedback(body, promptText = '') {
  const wc = countWords(body);
  const sentences = body.split(/[.!?]+\s*/).filter((s) => s.trim().length > 0);
  const avgLen = sentences.length ? wc / sentences.length : 0;
  const lower = body.toLowerCase();
  const conn = CONNECTIVES.filter((c) => lower.includes(c)).length;
  const uniqueRatio = wc ? new Set(lower.split(/\s+/).filter(Boolean)).size / wc : 0;

  const learned = db.prepare(
    `SELECT * FROM materials WHERE status IN ('learning','mastered') AND deleted_at IS NULL`
  ).all();
  const used = learned.filter((m) => {
    const key = normalize(m.content);
    return key.length > 2 && normalize(body).includes(key);
  });

  const task = wc >= 80 ? 4 : wc >= 50 ? 3 : 2;
  const org = Math.min(5, 2 + conn + (sentences.length >= 5 ? 1 : 0));
  const lex = Math.min(5, Math.max(1, Math.round(2 + uniqueRatio * 4 + used.length * 0.3)));
  const grammar = avgLen > 12 && avgLen < 26 ? 4 : 3;

  const suggestions = [];
  if (used.length === 0) suggestions.push('至少主动使用 1 条本周收集的表达，把输入变成产出。');
  if (conn === 0) suggestions.push('加入 however / because / while 之类的衔接词，让段落之间有关系。');
  if (avgLen > 26) suggestions.push('平均句长偏长，尝试把一个长句拆成两个短句。');
  if (uniqueRatio < 0.55 && wc > 60) suggestions.push('重复用词偏多，挑 2 个高频词换成更具体的表达。');
  if (suggestions.length === 0) suggestions.push('保持当前节奏，下一稿尝试加入一个从句结构。');

  return {
    mode: 'local',
    rubric: {
      task: { score: task, note: `共 ${wc} 词，${wc >= 50 ? '达到' : '未达到'}当日最低词数要求。` },
      organization: { score: org, note: `检测到 ${conn} 个衔接词，共 ${sentences.length} 句。` },
      lexical: { score: lex, note: `去重词比 ${(uniqueRatio * 100).toFixed(0)}%，主动使用已学表达 ${used.length} 条。` },
      grammar: { score: grammar, note: `平均句长 ${avgLen.toFixed(1)} 词。` }
    },
    corrections: [],
    rewrite: body,
    priorities: suggestions.slice(0, 3),
    suggestions: [],
    used: used.map((m) => ({ id: m.id, content: m.content })),
    note: '未配置 AI 时使用本地规则评估，只作为骨架演示。'
  };
}

/* ---------------- 词汇测试 ---------------- */

const PSEUDO = ['florvent', 'glimber', 'tarnick', 'plevish', 'quandor', 'brimsome', 'dravel', 'nostric'];
const NOT_KNOW = '不认识该词';

export function buildQuestion(band, askedIds = [], index = 0) {
  const isPseudo = index > 0 && index % 10 === 9;
  if (isPseudo) {
    const word = PSEUDO[Math.floor(Math.random() * PSEUDO.length)];
    const pool = ['一种旧式乐器', '缓慢地行走', '使某物变甜', '谨慎地观察'];
    const options = [NOT_KNOW, ...pool].sort(() => Math.random() - 0.5);
    return { word, band, pseudo: true, word_id: 0, options, answer: NOT_KNOW };
  }
  const rows = db.prepare('SELECT * FROM words WHERE band = ?').all(band);
  const usable = rows.filter((r) => !askedIds.includes(r.id));
  const pick = usable.length ? usable[Math.floor(Math.random() * usable.length)] : rows[Math.floor(Math.random() * rows.length)];
  const distractorPool = db.prepare('SELECT meaning FROM words WHERE band BETWEEN ? AND ? AND id != ?')
    .all(Math.max(1, band - 1), Math.min(6, band + 1), pick.id);
  const dists = [];
  while (dists.length < 3 && distractorPool.length) {
    const cand = distractorPool[Math.floor(Math.random() * distractorPool.length)].meaning;
    if (cand !== pick.meaning && !dists.includes(cand)) dists.push(cand);
  }
  const options = [pick.meaning, ...dists].sort(() => Math.random() - 0.5);
  return { word: pick.word, band, pseudo: false, word_id: pick.id, options, answer: pick.meaning };
}

export function vocabResult(state) {
  const band = state.band;
  const est = Math.max(300, Math.round((state.correct / Math.max(1, state.total)) * 3600 + (band - 1) * 600 + 400));
  const low = Math.max(200, Math.round((est - 500) / 100) * 100);
  const high = Math.round((est + 500) / 100) * 100;
  const pseudoWrong = state.pseudoAsked ? state.pseudoWrong / state.pseudoAsked : 0;
  const cefr = est < 1500 ? 'A1' : est < 2500 ? 'A2' : est < 4000 ? 'B1' : est < 6000 ? 'B2' : est < 9000 ? 'C1' : 'C2';
  return {
    low, high, band, cefr,
    correct: state.correct, total: state.total,
    pseudoRate: pseudoWrong,
    valid: pseudoWrong <= 0.3,
    bands: state.bands || {}
  };
}

export function addSnapshot(snap) {
  db.prepare(
    `INSERT INTO snapshots (day, vocab_low, vocab_high, writing_score, cefr, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(snap.day || today(), snap.vocab_low ?? null, snap.vocab_high ?? null,
    snap.writing_score ?? null, snap.cefr ?? null, snap.source, nowISO());
}

export function scoreToCefr(score) {
  if (score < 2) return 'A1';
  if (score < 3) return 'A2';
  if (score < 3.5) return 'B1';
  if (score < 4) return 'B2';
  if (score < 4.5) return 'C1';
  return 'C2';
}

/* ---------------- 种子数据 ---------------- */

const SEED_WORDS = [
  [1, 'apple', '苹果', 'n.'], [1, 'water', '水', 'n.'], [1, 'house', '房子', 'n.'],
  [1, 'friend', '朋友', 'n.'], [1, 'happy', '高兴的', 'adj.'], [1, 'school', '学校', 'n.'],
  [1, 'morning', '早晨', 'n.'], [1, 'family', '家庭', 'n.'], [1, 'listen', '听', 'v.'], [1, 'easy', '容易的', 'adj.'],
  [2, 'decide', '决定', 'v.'], [2, 'arrive', '到达', 'v.'], [2, 'borrow', '借入', 'v.'],
  [2, 'weather', '天气', 'n.'], [2, 'invite', '邀请', 'v.'], [2, 'prepare', '准备', 'v.'],
  [2, 'memory', '记忆', 'n.'], [2, 'polite', '有礼貌的', 'adj.'], [2, 'improve', '改善', 'v.'], [2, 'journey', '旅程', 'n.'],
  [3, 'achieve', '实现', 'v.'], [3, 'attitude', '态度', 'n.'], [3, 'benefit', '益处', 'n.'],
  [3, 'contain', '包含', 'v.'], [3, 'describe', '描述', 'v.'], [3, 'environment', '环境', 'n.'],
  [3, 'familiar', '熟悉的', 'adj.'], [3, 'generous', '慷慨的', 'adj.'], [3, 'opportunity', '机会', 'n.'], [3, 'reduce', '减少', 'v.'],
  [4, 'ambiguous', '模棱两可的', 'adj.'], [4, 'coherent', '连贯的', 'adj.'], [4, 'contradict', '反驳', 'v.'],
  [4, 'deteriorate', '恶化', 'v.'], [4, 'elaborate', '详尽阐述', 'v.'], [4, 'facilitate', '促进', 'v.'],
  [4, 'inevitable', '不可避免的', 'adj.'], [4, 'perceive', '察觉', 'v.'], [4, 'reluctant', '不情愿的', 'adj.'], [4, 'sophisticated', '复杂精密的', 'adj.'],
  [5, 'alleviate', '缓解', 'v.'], [5, 'consensus', '共识', 'n.'], [5, 'discrepancy', '差异', 'n.'],
  [5, 'empirical', '经验主义的', 'adj.'], [5, 'impartial', '公正的', 'adj.'], [5, 'lucrative', '有利可图的', 'adj.'],
  [5, 'mitigate', '减轻', 'v.'], [5, 'plausible', '貌似合理的', 'adj.'], [5, 'scrutinize', '仔细审查', 'v.'], [5, 'versatile', '多才多艺的', 'adj.'],
  [6, 'abstruse', '深奥的', 'adj.'], [6, 'acquiesce', '默许', 'v.'], [6, 'corroborate', '证实', 'v.'],
  [6, 'debunk', '揭穿', 'v.'], [6, 'equivocal', '含糊的', 'adj.'], [6, 'fastidious', '挑剔的', 'adj.'],
  [6, 'idiosyncratic', '独特的', 'adj.'], [6, 'obfuscate', '混淆', 'v.'], [6, 'perfunctory', '敷衍的', 'adj.'], [6, 'sagacious', '睿智的', 'adj.']
];

const SEED_PROMPTS = [
  ['daily', '日记', 'A2', '记录今天让你分心的一件事，以及你最后怎么处理的。'],
  ['daily', '观点', 'B1', '有人认为短视频让注意力变短了，你怎么看？给出两个理由。'],
  ['daily', '描述', 'B1', '描述一个你经常路过但从没进去过的地方。'],
  ['daily', '邮件', 'B1', '给一位很久没联系的朋友写一封邮件，提议一次见面。'],
  ['daily', '社媒回复', 'B2', '有人发帖说"学语言不需要背单词"，写一条有理有据的回复。'],
  ['daily', '观点', 'B2', '远程办公是否让人更自由？用具体例子支持你的判断。'],
  ['daily', '日记', 'B1', '写下本周你改变过的一个小习惯，以及原因。'],
  ['daily', '描述', 'B2', '描述一次让你改变想法的对话。'],
  ['daily', '邮件', 'B2', '写一封邮件向同事解释项目延期的原因，并提出补救方案。'],
  ['daily', '社媒回复', 'B1', '朋友晒出一张旅行照，写一条真诚又有细节的评论。'],
  ['daily', '观点', 'C1', '城市应该优先投资公共交通还是自行车道？论证你的选择。'],
  ['daily', '日记', 'A2', '写下你今天学到的一个新表达，并用它造两个句子。'],
  ['test', '测试', 'B1', '描述一个你最近解决的问题，说明过程和你学到的经验。'],
  ['test', '测试', 'B2', '有人主张大学教育应以就业为导向，你是否同意？请论证。'],
  ['test', '测试', 'B1', '写一封邮件，向房东说明房屋出现的问题并请求维修。'],
  ['test', '测试', 'B2', '描述一项你希望自己早点掌握的技能，并解释它为什么重要。']
];

const SEED_MATERIALS = [
  ['call it a day', 'phrase', '剧集', 'The Bear S02E03', '12:34', "We're exhausted. Let's call it a day.", '今天到此为止', 'B2'],
  ['take something with a grain of salt', 'phrase', '剧集', 'Succession S01E02', '08:10', 'Take his numbers with a grain of salt.', '对某事持保留态度', 'B2'],
  ['a blessing in disguise', 'phrase', '网课', 'BBC Learning English', '第 12 讲', 'Losing that job was a blessing in disguise.', '因祸得福', 'B2'],
  ['burn the midnight oil', 'phrase', '阅读', 'The Economist', '2026-09', "She burned the midnight oil to finish the report.", '熬夜工作', 'B2'],
  ['resilient', 'word', '词典', 'Oxford Learner', '词条', 'Children are often more resilient than we think.', '有韧性的', 'B2'],
  ['nuance', 'word', '词典', 'Cambridge', '词条', 'The translation loses some of the nuance.', '细微差别', 'C1'],
  ['On the one hand ... on the other hand', 'grammar', '网课', 'Writing Course', '第 3 讲', '', '一方面…另一方面', 'B1'],
  ['put up with', 'phrase', '剧集', 'Friends S03E11', '03:52', "I can't put up with the noise anymore.", '忍受', 'B1']
];

export function seedWordsAndPrompts() {
  const wordCount = db.prepare('SELECT COUNT(*) AS n FROM words').get().n;
  if (wordCount === 0) {
    const stmt = db.prepare('INSERT INTO words (band, word, meaning, pos) VALUES (?, ?, ?, ?)');
    for (const [band, w, m, pos] of SEED_WORDS) stmt.run(band, w, m, pos);
  }
  const promptCount = db.prepare('SELECT COUNT(*) AS n FROM prompts').get().n;
  if (promptCount === 0) {
    const stmt = db.prepare('INSERT INTO prompts (kind, genre, cefr, text) VALUES (?, ?, ?, ?)');
    for (const p of SEED_PROMPTS) stmt.run(...p);
  }
}

export function seedDemo() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM materials').get().n;
  if (existing > 0) return;
  const stmt = db.prepare(
    `INSERT INTO materials (content, type, norm, source_type, source_name, locator, context, meaning, cefr,
      enrich_status, status, created_at, learned_at, use_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'learning', ?, ?, ?)`
  );
  const now = Date.now();
  SEED_MATERIALS.forEach((m, i) => {
    const created = new Date(now - (12 - i) * 86400000).toISOString();
    stmt.run(m[0], m[1], normalize(m[0]), m[2], m[3], m[4], m[5], m[6], m[7], created, created, i % 3);
    const id = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    db.prepare('INSERT INTO cards (material_id, due_at, interval_d, ease, reps) VALUES (?, ?, ?, 2.5, ?)')
      .run(id, new Date(now - (i < 4 ? 1 : -1) * 3600000).toISOString(), i < 4 ? 3 : 0, i < 4 ? 2 : 0);
  });

  const logs = db.prepare(
    `INSERT INTO review_logs (card_id, material_id, rating, correct, elapsed_ms, reviewed_at, day)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (let d = 13; d >= 0; d--) {
    const n = 3 + Math.floor(Math.random() * 8);
    for (let i = 0; i < n; i++) {
      const cardId = 1 + Math.floor(Math.random() * 4);
      const ts = new Date(now - d * 86400000 - i * 600000).toISOString();
      logs.run(cardId, cardId, 2 + (i % 3), 1, 4000 + Math.floor(Math.random() * 9000), ts, localDay(new Date(ts).getTime(), 4));
    }
  }

  for (let d = 5; d >= 1; d--) {
    const day = localDay(now - d * 86400000, 4);
    db.prepare('INSERT OR IGNORE INTO loop_days (day, review_done, writing_done, completed, completed_at) VALUES (?, 1, 1, 1, ?)')
      .run(day, new Date(now - d * 86400000).toISOString());
  }

  const writing = db.prepare(
    `INSERT INTO writings (day, mode, prompt_id, title, body, word_count, duration_s, status, created_at, submitted_at, feedback_json, model)
     VALUES (?, 'prompt', ?, ?, ?, ?, ?, 'reviewed', ?, ?, ?, 'seed')`
  );
  const bodies = [
    'Today I planned to finish two articles, but I kept checking my phone. Every time I opened the browser, a short video pulled me away. In the end, I turned on airplane mode and set a timer for twenty-five minutes. It worked better than I expected. I still checked my phone twice, but the work finally moved forward. I think the problem is not the phone itself but the habit of reaching for it whenever a task becomes difficult.',
    'My town has an old bookshop that I pass by almost every day. I have never walked in, although I have looked at its window many times. The window is always crowded with second-hand books, a few yellow posters, and a cat sleeping on a pile of magazines. I imagine the inside is narrow and smells of paper. Maybe I avoid going in because I want to keep it as a small mystery.'
  ];
  bodies.forEach((body, i) => {
    writing.run(dayOffset(-(4 - i)), i + 1, 'Demo writing ' + (i + 1), body, countWords(body), 900,
      new Date(now - (4 - i) * 86400000).toISOString(),
      new Date(now - (4 - i) * 86400000 + 900000).toISOString(),
      JSON.stringify(heuristicFeedback(body)));
  });

  db.prepare(`INSERT INTO snapshots (day, vocab_low, vocab_high, writing_score, cefr, source, created_at)
    VALUES (?, 5200, 5900, 3.4, 'B1', 'vocab', ?)`).run(dayOffset(-6), nowISO());
  db.prepare(`INSERT INTO snapshots (day, vocab_low, vocab_high, writing_score, cefr, source, created_at)
    VALUES (?, NULL, NULL, 3.6, 'B1', 'writing', ?)`).run(dayOffset(-3), nowISO());

  setSetting('demo_seeded', true);
}

export function clearDemo() {
  db.exec(`
    DELETE FROM review_logs; DELETE FROM cards; DELETE FROM materials;
    DELETE FROM writings; DELETE FROM tests; DELETE FROM test_items;
    DELETE FROM snapshots; DELETE FROM loop_days;
  `);
  setSetting('demo_seeded', false);
}

export function initDb() {
  ensureSettings();
  seedWordsAndPrompts();
  seedDemo();
  refreshLoopDay(today());
}
