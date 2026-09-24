// ============================================
// routes/boxes.js - /api/boxes/*  (Box.js + BoxLog.js)
// ============================================
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { newId } from '../lib/utils.js';

const boxes = new Hono();
boxes.use('*', requireAuth);

function mapBox(row) {
  return {
    id: row.id,
    name: row.name,
    boxId: row.box_id,
    status: row.status,
    config: {
      antiSpam: !!row.anti_spam,
      autoKick: !!row.auto_kick,
      warnBeforeKick: !!row.warn_before_kick,
      bannedKeywords: JSON.parse(row.banned_keywords || '[]')
    },
    stats: {
      messagesProcessed: row.messages_processed,
      membersKicked: row.members_kicked,
      spamBlocked: row.spam_blocked,
      warningsIssued: row.warnings_issued
    },
    createdAt: row.created_at
  };
}

// GET /boxes - danh sách box của user hiện tại
boxes.get('/', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare('SELECT * FROM boxes WHERE owner_id = ? ORDER BY created_at DESC')
    .bind(user.id)
    .all();
  return c.json({ boxes: results.map(mapBox) });
});

// POST /boxes - kết nối box mới
boxes.post('/', async (c) => {
  const user = c.get('user');
  const { name, boxId } = await c.req.json();
  if (!name || !boxId) return c.json({ message: 'Thiếu tên hoặc box ID' }, 400);

  const id = newId();
  await c.env.DB.prepare('INSERT INTO boxes (id, owner_id, name, box_id) VALUES (?, ?, ?, ?)')
    .bind(id, user.id, name, boxId)
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM boxes WHERE id = ?').bind(id).first();
  return c.json({ message: 'Kết nối box thành công', box: mapBox(row) }, 201);
});

async function findOwnedBox(c, boxId) {
  const user = c.get('user');
  return c.env.DB.prepare('SELECT * FROM boxes WHERE id = ? AND owner_id = ?').bind(boxId, user.id).first();
}

// PUT /boxes/:boxId/config
boxes.put('/:boxId/config', async (c) => {
  const boxId = c.req.param('boxId');
  const existing = await findOwnedBox(c, boxId);
  if (!existing) return c.json({ message: 'Không tìm thấy box' }, 404);

  const { antiSpam, autoKick, warnBeforeKick, bannedKeywords, status } = await c.req.json();

  await c.env.DB.prepare(
    `UPDATE boxes SET
       anti_spam = COALESCE(?, anti_spam),
       auto_kick = COALESCE(?, auto_kick),
       warn_before_kick = COALESCE(?, warn_before_kick),
       banned_keywords = COALESCE(?, banned_keywords),
       status = COALESCE(?, status),
       updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(
      antiSpam === undefined ? null : antiSpam ? 1 : 0,
      autoKick === undefined ? null : autoKick ? 1 : 0,
      warnBeforeKick === undefined ? null : warnBeforeKick ? 1 : 0,
      bannedKeywords ? JSON.stringify(bannedKeywords) : null,
      status || null,
      boxId
    )
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM boxes WHERE id = ?').bind(boxId).first();
  return c.json({ message: 'Cập nhật cấu hình thành công', box: mapBox(row) });
});

// DELETE /boxes/:boxId
boxes.delete('/:boxId', async (c) => {
  const boxId = c.req.param('boxId');
  const existing = await findOwnedBox(c, boxId);
  if (!existing) return c.json({ message: 'Không tìm thấy box' }, 404);

  await c.env.DB.prepare('DELETE FROM box_logs WHERE box_id = ?').bind(boxId).run();
  await c.env.DB.prepare('DELETE FROM boxes WHERE id = ?').bind(boxId).run();
  return c.json({ message: 'Đã xoá box' });
});

// GET /boxes/:boxId/logs
boxes.get('/:boxId/logs', async (c) => {
  const boxId = c.req.param('boxId');
  const existing = await findOwnedBox(c, boxId);
  if (!existing) return c.json({ message: 'Không tìm thấy box' }, 404);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM box_logs WHERE box_id = ? ORDER BY created_at DESC LIMIT 200'
  )
    .bind(boxId)
    .all();

  return c.json({
    logs: results.map((r) => ({
      id: r.id,
      type: r.type,
      message: r.message,
      targetUserId: r.target_user_id,
      createdAt: r.created_at
    }))
  });
});

// GET /boxes/:boxId/stats
boxes.get('/:boxId/stats', async (c) => {
  const boxId = c.req.param('boxId');
  const existing = await findOwnedBox(c, boxId);
  if (!existing) return c.json({ message: 'Không tìm thấy box' }, 404);

  return c.json({
    stats: {
      messagesProcessed: existing.messages_processed,
      membersKicked: existing.members_kicked,
      spamBlocked: existing.spam_blocked,
      warningsIssued: existing.warnings_issued
    }
  });
});

export default boxes;
