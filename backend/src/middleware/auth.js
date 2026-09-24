// ============================================
// auth.js - Middleware xác thực JWT + kiểm tra tokenVersion (logout all devices)
// ============================================
import { verifyToken } from '../lib/jwt.js';

export async function requireAuth(c, next) {
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return c.json({ message: 'Chưa đăng nhập' }, 401);

  let payload;
  try {
    payload = await verifyToken(c.env, token);
  } catch {
    return c.json({ message: 'Token không hợp lệ hoặc đã hết hạn' }, 401);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(payload.sub)
    .first();

  if (!user) return c.json({ message: 'Tài khoản không tồn tại' }, 401);
  if (user.locked) return c.json({ message: 'Tài khoản đã bị khoá' }, 403);
  if (user.token_version !== payload.tv) {
    return c.json({ message: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại' }, 401);
  }

  c.set('user', user);
  await next();
}

export async function requireAdmin(c, next) {
  const user = c.get('user');
  if (!user || user.role !== 'admin') {
    return c.json({ message: 'Không có quyền truy cập' }, 403);
  }
  await next();
}
