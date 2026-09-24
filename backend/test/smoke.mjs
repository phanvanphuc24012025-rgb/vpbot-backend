import { createMockD1 } from './mock-d1.mjs';
import app from '../src/index.js';

const DB = createMockD1(new URL('../schema.sql', import.meta.url));
const env = {
  DB,
  JWT_SECRET: 'smoke-test-secret',
  JWT_EXPIRES_IN_SECONDS: '3600',
  DEV_MODE: 'true'
};

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('✓', label); }
  else { fail++; console.log('✗ FAIL:', label); }
}

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    }),
    env
  );
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function main() {
  // 1. Register
  let r = await call('POST', '/api/auth/register', { username: 'tester01', email: 'tester01@test.com', password: 'matkhau123' });
  check('register -> 200', r.status === 200);
  const otp = r.data.devOtp;
  check('register returns devOtp in DEV_MODE', !!otp);

  // 2. Verify OTP
  r = await call('POST', '/api/auth/verify-otp', { email: 'tester01@test.com', otp });
  check('verify-otp -> 200', r.status === 200);
  check('verify-otp returns token', !!r.data.token);

  // 3. Login
  r = await call('POST', '/api/auth/login', { email: 'tester01@test.com', password: 'matkhau123' });
  check('login -> 200', r.status === 200);
  const token = r.data.token;
  check('login returns token', !!token);

  // 4. Wrong password rejected
  r = await call('POST', '/api/auth/login', { email: 'tester01@test.com', password: 'sai' });
  check('login wrong password -> 401', r.status === 401);

  // 5. /auth/me
  r = await call('GET', '/api/auth/me', null, token);
  check('me -> 200', r.status === 200);
  check('me returns correct username', r.data.user.username === 'tester01');

  // 6. No token -> 401
  r = await call('GET', '/api/auth/me');
  check('me without token -> 401', r.status === 401);

  // 7. Create box
  r = await call('POST', '/api/boxes', { name: 'Box test', boxId: 'fb123' }, token);
  check('create box -> 201', r.status === 201);
  const boxId = r.data?.box?.id;

  // 8. List boxes
  r = await call('GET', '/api/boxes', null, token);
  check('list boxes -> 200 and has 1 item', r.status === 200 && r.data.boxes.length === 1);

  // 9. Update box config
  r = await call('PUT', `/api/boxes/${boxId}/config`, { antiSpam: false, bannedKeywords: ['spam1'] }, token);
  check('update box config -> 200', r.status === 200 && r.data.box.config.antiSpam === false);

  // 10. Submit match & check score formula (kill=5, top=1, damage=1000 -> 5*2+10+10=30)
  r = await call('POST', '/api/matches', { playerName: 'ProPlayer', kill: 5, top: 1, damage: 1000 }, token);
  check('submit match -> 201', r.status === 201);
  check('score formula correct (expect 30)', r.data.match.score === 30);

  // 11. Leaderboard (public, no token)
  r = await call('GET', '/api/matches/leaderboard');
  check('leaderboard public -> 200', r.status === 200);
  check('leaderboard has ProPlayer on top', r.data.leaderboard[0]?.playerName === 'ProPlayer');

  // 12. Match history (auth)
  r = await call('GET', '/api/matches/history', null, token);
  check('match history -> 200, 1 item', r.status === 200 && r.data.total === 1);

  // 13. Blog public list (empty ok)
  r = await call('GET', '/api/blog');
  check('blog list -> 200', r.status === 200);

  // 14. Contact form
  r = await call('POST', '/api/contact', { name: 'A', email: 'a@test.com', message: 'hello' });
  check('contact -> 201', r.status === 201);

  // 15. Payments: create + voucher preview (no voucher) + confirm
  r = await call('POST', '/api/payments', { planName: '1month' }, token);
  check('create payment -> 201', r.status === 201);
  const txCode = r.data?.payment?.transactionCode;

  r = await call('POST', '/api/payments/confirm', { transactionCode: txCode }, token);
  check('confirm payment -> 200', r.status === 200);

  r = await call('GET', '/api/dashboard/overview', null, token);
  check('dashboard overview shows active plan after payment', r.status === 200 && r.data.plan.active === true);

  // 16. Admin endpoints should be forbidden for normal user
  r = await call('GET', '/api/admin/users', null, token);
  check('admin endpoint forbidden for normal user -> 403', r.status === 403);

  // 17. Promote user to admin directly in DB, then retry
  await DB.prepare("UPDATE users SET role = 'admin' WHERE email = ?").bind('tester01@test.com').run();
  r = await call('POST', '/api/auth/login', { email: 'tester01@test.com', password: 'matkhau123' });
  const adminToken = r.data.token;
  r = await call('GET', '/api/admin/users', null, adminToken);
  check('admin can list users -> 200', r.status === 200 && r.data.users.length === 1);

  r = await call('POST', '/api/admin/vouchers', { code: 'SALE10', type: 'percent', value: 10 }, adminToken);
  check('admin create voucher -> 201', r.status === 201);

  r = await call('POST', '/api/payments/voucher', { code: 'SALE10', planName: '1month' }, token);
  check('voucher preview applies 10% discount', r.status === 200 && r.data.amount === Math.round(99000 * 0.9));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('SMOKE TEST CRASHED:', e); process.exit(1); });
