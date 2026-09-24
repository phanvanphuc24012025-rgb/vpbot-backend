// ============================================
// password.js - Hash & verify mật khẩu bằng Web Crypto (PBKDF2)
// Chạy thuần trên Cloudflare Workers, không cần bcrypt / binding native.
// Định dạng lưu: pbkdf2$<iterations>$<saltHex>$<hashHex>
// ============================================

const ITERATIONS = 100000;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

async function deriveHash(password, saltBytes, iterations = ITERATIONS) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return toHex(bits);
}

export async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hashHex = await deriveHash(password, saltBytes);
  return `pbkdf2$${ITERATIONS}$${toHex(saltBytes)}$${hashHex}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.startsWith('pbkdf2$')) return false;
  const [, iterStr, saltHex, hashHex] = stored.split('$');
  const iterations = parseInt(iterStr, 10);
  const saltBytes = fromHex(saltHex);
  const computed = await deriveHash(password, saltBytes, iterations);
  // So sánh thời gian cố định (constant-time-ish)
  if (computed.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}
