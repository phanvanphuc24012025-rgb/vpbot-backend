// ============================================
// routes/dashboard.js - /api/dashboard/*
// ============================================
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { sanitizeUser } from './auth.js';
import { mapPayment, createPendingPayment } from './payments.js';

const dashboard = new Hono();
dashboard.use('*', requireAuth);

// ---------- GET /dashboard/overview ----------
dashboard.get('/overview', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const { boxCount } = await db.prepare('SELECT COUNT(*) AS boxCount FROM boxes WHERE owner_id = ?')
    .bind(user.id)
    .first();

  const { matchCount } = await db.prepare('SELECT COUNT(*) AS matchCount FROM matches WHERE created_by = ?')
    .bind(user.id)
    .first();

  const { results: recentPayments } = await db.prepare(
    'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 5'
  )
    .bind(user.id)
    .all();

  const isPlanActive = !!(user.plan_expires_at && new Date(user.plan_expires_at).getTime() > Date.now());

  return c.json({
    user: sanitizeUser(user),
    plan: {
      name: user.plan_name,
      expiresAt: user.plan_expires_at,
      active: isPlanActive
    },
    stats: { boxCount, matchCount },
    recentPayments: recentPayments.map(mapPayment)
  });
});

// ---------- GET /dashboard/payments ----------
dashboard.get('/payments', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC'
  )
    .bind(user.id)
    .all();
  return c.json({ payments: results.map(mapPayment) });
});

// ---------- POST /dashboard/renew ----------
// Tạo giao dịch gia hạn gói hiện tại (dùng chung logic với POST /payments)
dashboard.post('/renew', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const planName = body.planName || user.plan_name || '1month';
  try {
    const row = await createPendingPayment(c.env.DB, user, { ...body, planName });
    return c.json({ message: 'Đã tạo giao dịch gia hạn, vui lòng thanh toán', payment: mapPayment(row) }, 201);
  } catch (err) {
    return c.json({ message: err.message }, 400);
  }
});

export default dashboard;
