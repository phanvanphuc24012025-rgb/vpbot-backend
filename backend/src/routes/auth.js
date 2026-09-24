// ============================================
// routes/auth.js - /api/auth/*
// ============================================
import { Hono } from 'hono';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signToken } from '../lib/jwt.js';
import { sendOtpEmail } from '../lib/email.js';
import { newId, genOtp, addSeconds, genReferralCode } from '../lib/utils.js';
import { requireAuth } from '../middleware/auth.js';

const auth = new Hono();

// ---------- POST /auth/register ----------
// Không tạo user ngay - lưu OTP kèm pendingUserData, tạo user thật khi verify-otp
auth.post('/register', async (c) => {
  const { username, email, password } = await c.req.json();
  if (!username || !email || !password) {
    return c.json({ message: 'Thiếu username, email hoặc password' }, 400);
  }
  if (password.length < 6) {
    return c.json({ message: 'Mật khẩu tối thiểu 6 ký tự' }, 400);
  }

  const db = c.env.DB;
  const existing = await db
    .prepare('SELECT id FROM users WHERE email = ? OR username = ?')
    .bind(email.toLowerCase(), username)
    .first();
  if (existing) return c.json({ message: 'Username hoặc email đã được sử dụng' }, 409);

  const passwordHash = await hashPassword(password);
  const otp = genOtp();

  await db
    .prepare(
      `INSERT INTO otps (id, email, otp, type, pending_username, pending_email, pending_password_hash, expires_at)
       VALUES (?, ?, ?, 'register', ?, ?, ?, ?)`
    )
    .bind(newId(), email.toLowerCase(), otp, username, email.toLowerCase(), passwordHash, addSeconds(60))
    .run();

  const mail = await sendOtpEmail(c.env, { to: email, otp, type: 'register' });

  return c.json({
    message: 'Đã gửi mã OTP xác thực tới email',
    ...(c.env.DEV_MODE === 'true' || !mail.sent ? { devOtp: otp } : {})
  });
});

// ---------- POST /auth/verify-otp ----------
auth.post('/verify-otp', async (c) => {
  const { email, otp } = await c.req.json();
  if (!email || !otp) return c.json({ message: 'Thiếu email hoặc mã OTP' }, 400);

  const db = c.env.DB;
  const record = await db
    .prepare(
      `SELECT * FROM otps WHERE email = ? AND type = 'register' AND verified = 0
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(email.toLowerCase())
    .first();

  if (!record) return c.json({ message: 'Không tìm thấy yêu cầu OTP, vui lòng đăng ký lại' }, 400);
  if (new Date(record.expires_at).getTime() < Date.now()) {
    return c.json({ message: 'Mã OTP đã hết hạn' }, 400);
  }
  if (record.otp !== otp) return c.json({ message: 'Mã OTP không đúng' }, 400);

  const userId = newId();
  const referralCode = genReferralCode(record.pending_username);

  await db
    .prepare(
      `INSERT INTO users (id, username, email, password, is_verified, referral_code)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
    .bind(userId, record.pending_username, record.pending_email, record.pending_password_hash, referralCode)
    .run();

  await db.prepare('UPDATE otps SET verified = 1 WHERE id = ?').bind(record.id).run();

  const token = await signToken(c.env, { sub: userId, tv: 0, role: 'user' });
  return c.json({ message: 'Xác thực thành công', token });
});

// ---------- POST /auth/resend-otp ----------
auth.post('/resend-otp', async (c) => {
  const { email, type = 'register' } = await c.req.json();
  if (!email) return c.json({ message: 'Thiếu email' }, 400);

  const db = c.env.DB;
  const last = await db
    .prepare(`SELECT * FROM otps WHERE email = ? AND type = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(email.toLowerCase(), type)
    .first();

  if (!last) return c.json({ message: 'Không có yêu cầu OTP trước đó cho email này' }, 400);
  if (last.attempt_count >= 5) {
    return c.json({ message: 'Bạn đã yêu cầu gửi lại quá nhiều lần, thử lại sau 10 phút' }, 429);
  }

  const otp = genOtp();
  await db
    .prepare(
      `INSERT INTO otps (id, email, otp, type, pending_username, pending_email, pending_password_hash, attempt_count, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      newId(),
      email.toLowerCase(),
      otp,
      type,
      last.pending_username,
      last.pending_email,
      last.pending_password_hash,
      last.attempt_count + 1,
      addSeconds(60)
    )
    .run();

  const mail = await sendOtpEmail(c.env, { to: email, otp, type });
  return c.json({
    message: 'Đã gửi lại mã OTP',
    ...(c.env.DEV_MODE === 'true' || !mail.sent ? { devOtp: otp } : {})
  });
});

// ---------- POST /auth/login ----------
auth.post('/login', async (c) => {
  const { email, password } = await c.req.json();
  if (!email || !password) return c.json({ message: 'Thiếu email hoặc mật khẩu' }, 400);

  const db = c.env.DB;
  const user = await db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first();

  if (!user) return c.json({ message: 'Email hoặc mật khẩu không đúng' }, 401);
  if (user.locked) return c.json({ message: 'Tài khoản đã bị khoá' }, 403);
  if (!user.is_verified) return c.json({ message: 'Tài khoản chưa xác thực OTP' }, 403);

  const ok = await verifyPassword(password, user.password);
  if (!ok) return c.json({ message: 'Email hoặc mật khẩu không đúng' }, 401);

  const token = await signToken(c.env, { sub: user.id, tv: user.token_version, role: user.role });
  return c.json({
    message: 'Đăng nhập thành công',
    token,
    user: { id: user.id, username: user.username, email: user.email, role: user.role }
  });
});

// ---------- POST /auth/forgot-password ----------
auth.post('/forgot-password', async (c) => {
  const { email } = await c.req.json();
  if (!email) return c.json({ message: 'Thiếu email' }, 400);

  const db = c.env.DB;
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first();
  // Không tiết lộ email có tồn tại hay không
  if (!user) return c.json({ message: 'Nếu email tồn tại, mã OTP đã được gửi' });

  const otp = genOtp();
  await db
    .prepare(`INSERT INTO otps (id, email, otp, type, expires_at) VALUES (?, ?, ?, 'reset', ?)`)
    .bind(newId(), email.toLowerCase(), otp, addSeconds(60))
    .run();

  const mail = await sendOtpEmail(c.env, { to: email, otp, type: 'reset' });
  return c.json({
    message: 'Nếu email tồn tại, mã OTP đã được gửi',
    ...(c.env.DEV_MODE === 'true' || !mail.sent ? { devOtp: otp } : {})
  });
});

// ---------- POST /auth/reset-password ----------
auth.post('/reset-password', async (c) => {
  const { email, otp, newPassword } = await c.req.json();
  if (!email || !otp || !newPassword) return c.json({ message: 'Thiếu thông tin' }, 400);
  if (newPassword.length < 6) return c.json({ message: 'Mật khẩu tối thiểu 6 ký tự' }, 400);

  const db = c.env.DB;
  const record = await db
    .prepare(
      `SELECT * FROM otps WHERE email = ? AND type = 'reset' AND verified = 0
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(email.toLowerCase())
    .first();

  if (!record || record.otp !== otp) return c.json({ message: 'Mã OTP không đúng' }, 400);
  if (new Date(record.expires_at).getTime() < Date.now()) {
    return c.json({ message: 'Mã OTP đã hết hạn' }, 400);
  }

  const passwordHash = await hashPassword(newPassword);
  await db
    .prepare('UPDATE users SET password = ?, token_version = token_version + 1, updated_at = datetime("now") WHERE email = ?')
    .bind(passwordHash, email.toLowerCase())
    .run();
  await db.prepare('UPDATE otps SET verified = 1 WHERE id = ?').bind(record.id).run();

  return c.json({ message: 'Đặt lại mật khẩu thành công' });
});

// ---------- Các route dưới đây cần đăng nhập ----------
auth.use('/change-password', requireAuth);
auth.post('/change-password', async (c) => {
  const user = c.get('user');
  const { oldPassword, newPassword } = await c.req.json();
  if (!oldPassword || !newPassword) return c.json({ message: 'Thiếu thông tin' }, 400);
  if (newPassword.length < 6) return c.json({ message: 'Mật khẩu tối thiểu 6 ký tự' }, 400);

  const ok = await verifyPassword(oldPassword, user.password);
  if (!ok) return c.json({ message: 'Mật khẩu cũ không đúng' }, 401);

  const passwordHash = await hashPassword(newPassword);
  await c.env.DB.prepare('UPDATE users SET password = ?, updated_at = datetime("now") WHERE id = ?')
    .bind(passwordHash, user.id)
    .run();

  return c.json({ message: 'Đổi mật khẩu thành công' });
});

auth.use('/logout-all', requireAuth);
auth.post('/logout-all', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').bind(user.id).run();
  return c.json({ message: 'Đã đăng xuất khỏi mọi thiết bị' });
});

auth.use('/profile', requireAuth);
auth.put('/profile', async (c) => {
  const user = c.get('user');
  const { username, avatar } = await c.req.json();

  if (username && username !== user.username) {
    const dup = await c.env.DB.prepare('SELECT id FROM users WHERE username = ? AND id != ?')
      .bind(username, user.id)
      .first();
    if (dup) return c.json({ message: 'Username đã được sử dụng' }, 409);
  }

  await c.env.DB.prepare(
    'UPDATE users SET username = COALESCE(?, username), avatar = COALESCE(?, avatar), updated_at = datetime("now") WHERE id = ?'
  )
    .bind(username || null, avatar ?? null, user.id)
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  return c.json({ message: 'Cập nhật thành công', user: sanitizeUser(updated) });
});

auth.use('/me', requireAuth);
auth.get('/me', async (c) => {
  const user = c.get('user');
  return c.json({ user: sanitizeUser(user) });
});

export function sanitizeUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}

export default auth;
