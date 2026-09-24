// ============================================
// routes/payments.js - /api/payments/*  (Payment.js + Voucher.js)
// LƯU Ý: chưa nối cổng thanh toán thật (MoMo/Banking webhook).
// /confirm hiện xác nhận thủ công để demo - khi tích hợp cổng thật,
// thay logic /confirm bằng xác minh webhook chữ ký từ MoMo/ngân hàng.
// ============================================
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { newId, addDays, planDurationDays, PLAN_PRICES, genTransactionCode } from '../lib/utils.js';

const payments = new Hono();
payments.use('*', requireAuth);

async function computeVoucherDiscount(db, code, originalAmount) {
  if (!code) return { amount: originalAmount, voucher: null };

  const voucher = await db.prepare('SELECT * FROM vouchers WHERE code = ?').bind(code.toUpperCase()).first();
  if (!voucher || !voucher.active) throw new Error('Mã giảm giá không hợp lệ');
  if (voucher.expires_at && new Date(voucher.expires_at).getTime() < Date.now()) {
    throw new Error('Mã giảm giá đã hết hạn');
  }
  if (voucher.max_uses !== null && voucher.used_count >= voucher.max_uses) {
    throw new Error('Mã giảm giá đã hết lượt sử dụng');
  }

  const discount = voucher.type === 'percent' ? (originalAmount * voucher.value) / 100 : voucher.value;
  const amount = Math.max(0, Math.round(originalAmount - discount));
  return { amount, voucher };
}

// ---------- POST /payments/voucher - preview áp dụng mã (không trừ lượt dùng) ----------
payments.post('/voucher', async (c) => {
  const { code, planName = '1month' } = await c.req.json();
  const originalAmount = PLAN_PRICES[planName] || PLAN_PRICES['1month'];
  try {
    const { amount, voucher } = await computeVoucherDiscount(c.env.DB, code, originalAmount);
    return c.json({
      valid: true,
      originalAmount,
      amount,
      discount: originalAmount - amount,
      voucherType: voucher?.type,
      voucherValue: voucher?.value
    });
  } catch (err) {
    return c.json({ valid: false, message: err.message }, 400);
  }
});

// Logic tạo giao dịch dùng chung cho POST /payments và POST /dashboard/renew
export async function createPendingPayment(db, user, { planName, voucherCode, method = 'momo' }) {
  if (!PLAN_PRICES[planName]) throw new Error('Gói dịch vụ không hợp lệ');

  const originalAmount = PLAN_PRICES[planName];
  const { amount } = await computeVoucherDiscount(db, voucherCode, originalAmount);

  const id = newId();
  const transactionCode = genTransactionCode();
  await db
    .prepare(
      `INSERT INTO payments (id, user_id, plan_name, amount, original_amount, voucher_code, transaction_code, status, method)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
    .bind(id, user.id, planName, amount, originalAmount, voucherCode ? voucherCode.toUpperCase() : null, transactionCode, method)
    .run();

  return db.prepare('SELECT * FROM payments WHERE id = ?').bind(id).first();
}

// ---------- POST /payments - tạo giao dịch (pending) ----------
payments.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  try {
    const row = await createPendingPayment(c.env.DB, user, body);
    return c.json({ message: 'Đã tạo giao dịch, vui lòng thanh toán', payment: mapPayment(row) }, 201);
  } catch (err) {
    return c.json({ message: err.message }, 400);
  }
});

// ---------- POST /payments/confirm - xác nhận đã thanh toán (demo, chưa nối cổng thật) ----------
payments.post('/confirm', async (c) => {
  const user = c.get('user');
  const { transactionCode } = await c.req.json();
  if (!transactionCode) return c.json({ message: 'Thiếu mã giao dịch' }, 400);

  const payment = await c.env.DB.prepare(
    'SELECT * FROM payments WHERE transaction_code = ? AND user_id = ?'
  )
    .bind(transactionCode, user.id)
    .first();

  if (!payment) return c.json({ message: 'Không tìm thấy giao dịch' }, 404);
  if (payment.status === 'paid') return c.json({ message: 'Giao dịch đã được xác nhận trước đó' });

  await c.env.DB.prepare("UPDATE payments SET status = 'paid', updated_at = datetime('now') WHERE id = ?")
    .bind(payment.id)
    .run();

  if (payment.voucher_code) {
    await c.env.DB.prepare('UPDATE vouchers SET used_count = used_count + 1 WHERE code = ?')
      .bind(payment.voucher_code)
      .run();
  }

  // Gia hạn gói: nếu gói hiện tại còn hạn thì cộng dồn, ngược lại tính từ hôm nay
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

  return c.json({ message: 'Thanh toán thành công, gói dịch vụ đã được kích hoạt', planExpiresAt: newExpiry });
});

function mapPayment(r) {
  return {
    id: r.id,
    planName: r.plan_name,
    amount: r.amount,
    originalAmount: r.original_amount,
    voucherCode: r.voucher_code,
    transactionCode: r.transaction_code,
    status: r.status,
    method: r.method,
    createdAt: r.created_at
  };
}

export { mapPayment };
export default payments;
