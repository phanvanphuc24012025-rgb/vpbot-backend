// ============================================
// routes/matches.js - /api/matches/*  (Match.js)
// Công thức: score = kill*2 + topPoint(top) + damage/100
// ============================================
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { verifyToken } from '../lib/jwt.js';
import { newId, calcScore } from '../lib/utils.js';

const matches = new Hono();

function mapMatch(r) {
  return {
    id: r.id,
    playerName: r.player_name,
    kill: r.kill,
    top: r.top,
    damage: r.damage,
    score: r.score,
    season: r.season,
    createdAt: r.created_at
  };
}

// ---------- POST /matches (auth) ----------
matches.post('/', requireAuth, async (c) => {
  const user = c.get('user');
  const { playerName, kill = 0, top = 99, damage = 0, season = null } = await c.req.json();
  if (!playerName) return c.json({ message: 'Thiếu tên người chơi' }, 400);

  const score = calcScore({ kill, top, damage });
  const id = newId();
  await c.env.DB.prepare(
    `INSERT INTO matches (id, created_by, player_name, kill, top, damage, score, season)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, user.id, playerName, kill, top, damage, score, season)
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM matches WHERE id = ?').bind(id).first();
  return c.json({ message: 'Đã lưu trận đấu', match: mapMatch(row) }, 201);
});

// ---------- POST /matches/bulk (auth) ----------
matches.post('/bulk', requireAuth, async (c) => {
  const user = c.get('user');
  const { matches: list } = await c.req.json();
  if (!Array.isArray(list) || list.length === 0) {
    return c.json({ message: 'Danh sách trận đấu trống' }, 400);
  }

  const stmts = list.map((m) => {
    const score = calcScore({ kill: m.kill || 0, top: m.top || 99, damage: m.damage || 0 });
    return c.env.DB.prepare(
      `INSERT INTO matches (id, created_by, player_name, kill, top, damage, score, season)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(newId(), user.id, m.playerName, m.kill || 0, m.top || 99, m.damage || 0, score, m.season || null);
  });

  await c.env.DB.batch(stmts);
  return c.json({ message: `Đã nhập ${list.length} trận đấu` }, 201);
});

// ---------- POST /matches/import (auth, multipart CSV: playerName,kill,top,damage) ----------
matches.post('/import', requireAuth, async (c) => {
  const user = c.get('user');
  const form = await c.req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return c.json({ message: 'Thiếu file CSV' }, 400);

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const startIdx = /playername/i.test(lines[0]) ? 1 : 0; // bỏ qua dòng header nếu có

  const stmts = [];
  for (let i = startIdx; i < lines.length; i++) {
    const [playerName, kill, top, damage, season] = lines[i].split(',').map((s) => s?.trim());
    if (!playerName) continue;
    const k = Number(kill) || 0;
    const t = Number(top) || 99;
    const d = Number(damage) || 0;
    const score = calcScore({ kill: k, top: t, damage: d });
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO matches (id, created_by, player_name, kill, top, damage, score, season)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(newId(), user.id, playerName, k, t, d, score, season || null)
    );
  }

  if (stmts.length === 0) return c.json({ message: 'Không có dòng dữ liệu hợp lệ trong file' }, 400);
  await c.env.DB.batch(stmts);
  return c.json({ message: `Đã nhập ${stmts.length} trận đấu từ file` }, 201);
});

// ---------- GET /matches/leaderboard (public) ----------
matches.get('/leaderboard', async (c) => {
  const season = c.req.query('season');
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);

  const query = season
    ? `SELECT player_name, SUM(score) AS total_score, COUNT(*) AS matches_count
       FROM matches WHERE season = ? GROUP BY player_name ORDER BY total_score DESC LIMIT ?`
    : `SELECT player_name, SUM(score) AS total_score, COUNT(*) AS matches_count
       FROM matches GROUP BY player_name ORDER BY total_score DESC LIMIT ?`;

  const stmt = season
    ? c.env.DB.prepare(query).bind(season, limit)
    : c.env.DB.prepare(query).bind(limit);

  const { results } = await stmt.all();
  return c.json({
    leaderboard: results.map((r, i) => ({
      rank: i + 1,
      playerName: r.player_name,
      totalScore: Math.round(r.total_score * 100) / 100,
      matchesCount: r.matches_count
    }))
  });
});

// ---------- GET /matches/history (auth) ----------
matches.get('/history', requireAuth, async (c) => {
  const user = c.get('user');
  const page = Math.max(parseInt(c.req.query('page') || '1', 10), 1);
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const offset = (page - 1) * limit;

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM matches WHERE created_by = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  )
    .bind(user.id, limit, offset)
    .all();

  const { total } = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM matches WHERE created_by = ?')
    .bind(user.id)
    .first();

  return c.json({ matches: results.map(mapMatch), page, limit, total });
});

// ---------- GET /matches/export/:format (auth qua header HOẶC ?token=) ----------
// Đây là link tải trực tiếp (không qua apiRequest), nên chấp nhận token ở query string.
matches.get('/export/:format', async (c) => {
  const headerToken = (c.req.header('Authorization') || '').replace('Bearer ', '');
  const token = headerToken || c.req.query('token');
  if (!token) return c.json({ message: 'Chưa đăng nhập' }, 401);

  let payload;
  try {
    payload = await verifyToken(c.env, token);
  } catch {
    return c.json({ message: 'Token không hợp lệ' }, 401);
  }

  const format = c.req.param('format');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM matches WHERE created_by = ? ORDER BY created_at DESC'
  )
    .bind(payload.sub)
    .all();

  if (format === 'json') {
    return c.json({ matches: results.map(mapMatch) });
  }

  // mặc định: csv
  const header = 'playerName,kill,top,damage,score,season,createdAt';
  const rows = results.map((r) =>
    [r.player_name, r.kill, r.top, r.damage, r.score, r.season || '', r.created_at].join(',')
  );
  const csv = [header, ...rows].join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="matches.csv"'
    }
  });
});

export default matches;
