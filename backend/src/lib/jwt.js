// ============================================
// jwt.js - Ký & xác minh JWT (dùng hono/jwt, chạy được trên Workers)
// ============================================
import { sign, verify } from 'hono/jwt';

export async function signToken(env, payload) {
  const expiresIn = parseInt(env.JWT_EXPIRES_IN_SECONDS || '604800', 10);
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  return sign({ ...payload, exp }, env.JWT_SECRET);
}

export async function verifyToken(env, token) {
  return verify(token, env.JWT_SECRET, 'HS256'); // throws nếu invalid/hết hạn
}
