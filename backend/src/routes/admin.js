// ============================================
// routes/admin.js - /api/admin/*  (chỉ role = 'admin')
// ============================================
import { Hono } from 'hono';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { newId, planDurationDays } from '../lib/utils.js';
import { sanitizeUser } from './auth.js';
import { mapPayment } from './payments.js';
import { mapPost } from './blog.js';

const admin = new Hono();
admin.use('*', requireAuth, requireAdmin);

// ---------- Users ----------
admin.get('/users', async (c) => {
  const search = c.req.query('search');
  const page = Math.max(parseInt(c.req.query('page') || '1', 10), 1);
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const offset = (page - 1) * limit;

  const where = search ? 'WHERE username LIKE ? OR email LIKE ?' : '';
  const bindings = search ? [`%${search}%`, `%${search}%`] : [];

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...bindings, limit, offset)
    .all();

  const { total } = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM users ${where}`)
    .bind(...bindings)
    .first();

  return c.json({ users: results.map(sanitizeUser), page, limit, total });
});

admin.put('/users/:id', async (c) => {
  const id = c.req.param('id');
  const { role, locked, planName, planExpiresAt } = await c.req.json();

  await c.env.DB.prepare(
    `UPDATE users SET
       role = COALESCE(?, role),
       locked = COALESCE(?, locked),
       plan_name = COALESCE(?, plan_name),
       plan_expires_at = COALESCE(?, plan_expires_at),
       updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(role || null, locked === undefined ? null : locked ? 1 : 0, planName || null, planExpiresAt || null, id)
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!row) return c.json({ message: 'Không tìm thấy user' }, 404);
  return c.json({ message: 'Cập nhật thành công', user: sanitizeUser(row) });
});

admin.delete('/users/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return c.json({ message: 'Đã xoá user' });
});

// ---------- Orders (Payment) ----------
admin.get('/orders', async (c) => {
  const status = c.req.query('status');
  const where = status ? 'WHERE status = ?' : '';
  const bindings = status ? [status] : [];

  const { results } = await c.env.DB.prepare(
    `SELECT p.*, u.username, u.email FROM payments p
     JOIN users u ON u.id = p.user_id
     ${where.replace('status', 'p.status')}
     ORDER BY p.created_at DESC LIMIT 200`
  )
    .bind(...bindings)
    .all();

  return c.json({
    orders: results.map((r) => ({ ...mapPayment(r), username: r.username, email: r.email }))
  });
});

admin.post('/orders/:id/approve', async (c) => {
  const id = c.req.param('id');
  const payment = await c.env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(id).first();
  if (!payment) return c.json({ message: 'Không tìm thấy giao dịch' }, 404);
  if (payment.status === 'paid') return c.json({ message: 'Giao dịch đã được duyệt trước đó' });

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payment.user_id).first();
  if (!user) return c.json({ message: 'Không tìm thấy user của giao dịch' }, 404);

  await c.env.DB.prepare("UPDATE payments SET status = 'paid', updated_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();

  if (payment.voucher_code) {
    await c.env.DB.prepare('UPDATE vouchers SET used_count = used_count + 1 WHERE code = ?')
      .bind(payment.voucher_code)
      .run();
  }

  const days = planDurationDays(payment.plan_name);
  const currentExpiry = user.plan_expires_at && new Date(user.plan_expires_at).getTime() > Date.now()
    ? new Date(user.plan_expires_at)
    : new Date();
  const newExpiry = new Date(currentExpiry.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  await c.env.DB.prepare(
    "UPDATE users SET plan_name = ?, plan_expires_at = ?, updated_at = datetime('now') WHERE id = ?"
  )
    .bind(payment.plan_name, newExpiry, user.id)
    .run();

  return c.json({ message: 'Đã duyệt giao dịch và kích hoạt gói cho user' });
});

// ---------- Revenue ----------
admin.get('/revenue', async (c) => {
  const { total, count } = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM payments WHERE status = 'paid'"
  ).first();

  const { results: byDay } = await c.env.DB.prepare(
    `SELECT date(created_at) AS day, SUM(amount) AS amount, COUNT(*) AS count
     FROM payments WHERE status = 'paid'
     GROUP BY date(created_at) ORDER BY day DESC LIMIT 30`
  ).all();

  return c.json({ totalRevenue: total, paidCount: count, byDay });
});

// ---------- Vouchers ----------
admin.get('/vouchers', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM vouchers ORDER BY created_at DESC').all();
  return c.json({
    vouchers: results.map((r) => ({
      id: r.id,
      code: r.code,
      type: r.type,
      value: r.value,
      maxUses: r.max_uses,
      usedCount: r.used_count,
      expiresAt: r.expires_at,
      active: !!r.active,
      createdAt: r.created_at
    }))
  });
});

admin.post('/vouchers', async (c) => {
  const admin_ = c.get('user');
  const { code, type, value, maxUses = null, expiresAt = null } = await c.req.json();
  if (!code || !type || value === undefined) return c.json({ message: 'Thiếu thông tin voucher' }, 400);
  if (!['percent', 'fixed'].includes(type)) return c.json({ message: 'Loại voucher không hợp lệ' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM vouchers WHERE code = ?')
    .bind(code.toUpperCase())
    .first();
  if (existing) return c.json({ message: 'Mã voucher đã tồn tại' }, 409);

  const id = newId();
  await c.env.DB.prepare(
    `INSERT INTO vouchers (id, code, type, value, max_uses, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, code.toUpperCase(), type, value, maxUses, expiresAt, admin_.id)
    .run();

  return c.json({ message: 'Đã tạo voucher' }, 201);
});

// ---------- Blog (admin) ----------
admin.get('/blog', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM blog_posts ORDER BY created_at DESC').all();
  return c.json({ posts: results.map(mapPost) });
});

admin.post('/blog', async (c) => {
  const user = c.get('user');
  const { id, title, slug, excerpt = '', content, coverImage = '', published = true } = await c.req.json();
  if (!title || !slug || !content) return c.json({ message: 'Thiếu title, slug hoặc content' }, 400);

  if (id) {
    await c.env.DB.prepare(
      `UPDATE blog_posts SET title=?, slug=?, excerpt=?, content=?, cover_image=?, published=?, updated_at=datetime('now')
       WHERE id = ?`
    )
      .bind(title, slug, excerpt, content, coverImage, published ? 1 : 0, id)
      .run();
    const row = await c.env.DB.prepare('SELECT * FROM blog_posts WHERE id = ?').bind(id).first();
    return c.json({ message: 'Đã cập nhật bài viết', post: mapPost(row) });
  }

  const dup = await c.env.DB.prepare('SELECT id FROM blog_posts WHERE slug = ?').bind(slug).first();
  if (dup) return c.json({ message: 'Slug đã tồn tại' }, 409);

  const newPostId = newId();
  await c.env.DB.prepare(
    `INSERT INTO blog_posts (id, title, slug, excerpt, content, cover_image, author_id, published)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(newPostId, title, slug, excerpt, content, coverImage, user.id, published ? 1 : 0)
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM blog_posts WHERE id = ?').bind(newPostId).first();
  return c.json({ message: 'Đã tạo bài viết', post: mapPost(row) }, 201);
});

// ---------- Notifications ----------
admin.post('/notifications', async (c) => {
  const { title, message, target = 'all' } = await c.req.json();
  if (!title || !message) return c.json({ message: 'Thiếu tiêu đề hoặc nội dung' }, 400);
  if (!['all', 'active', 'expired'].includes(target)) return c.json({ message: 'target không hợp lệ' }, 400);

  const id = newId();
  await c.env.DB.prepare('INSERT INTO notifications (id, title, message, target) VALUES (?, ?, ?, ?)')
    .bind(id, title, message, target)
    .run();

  return c.json({ message: 'Đã gửi thông báo' }, 201);
});

export default admin;
