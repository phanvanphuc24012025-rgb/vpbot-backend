// ============================================
// index.js - Entry point của Cloudflare Worker (VPBot API)
// ============================================
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import authRoutes from './routes/auth.js';
import boxRoutes from './routes/boxes.js';
import matchRoutes from './routes/matches.js';
import dashboardRoutes from './routes/dashboard.js';
import paymentRoutes from './routes/payments.js';
import blogRoutes from './routes/blog.js';
import contactRoutes from './routes/contact.js';
import adminRoutes from './routes/admin.js';

const app = new Hono();

// CORS - cho phép frontend (Cloudflare Pages) gọi API
app.use(
  '/api/*',
  cors({
    origin: '*', // đổi thành domain Pages thật của bạn khi lên production, vd: 'https://vpbot.pages.dev'
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization']
  })
);

app.get('/', (c) => c.json({ ok: true, service: 'vpbot-api', message: 'VPBot API đang chạy trên Cloudflare Workers' }));

app.route('/api/auth', authRoutes);
app.route('/api/boxes', boxRoutes);
app.route('/api/matches', matchRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/payments', paymentRoutes);
app.route('/api/blog', blogRoutes);
app.route('/api/contact', contactRoutes);
app.route('/api/admin', adminRoutes);

app.notFound((c) => c.json({ message: 'Không tìm thấy endpoint' }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ message: 'Lỗi máy chủ, vui lòng thử lại sau' }, 500);
});

export default app;
