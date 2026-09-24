// ============================================
// routes/contact.js - /api/contact  (ContactMessage.js)
// ============================================
import { Hono } from 'hono';
import { newId } from '../lib/utils.js';

const contact = new Hono();

contact.post('/', async (c) => {
  const { name, email, subject = '', message } = await c.req.json();
  if (!name || !email || !message) {
    return c.json({ message: 'Thiếu tên, email hoặc nội dung' }, 400);
  }

  await c.env.DB.prepare(
    'INSERT INTO contact_messages (id, name, email, subject, message) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(newId(), name, email.toLowerCase(), subject, message)
    .run();

  return c.json({ message: 'Đã gửi liên hệ, chúng tôi sẽ phản hồi sớm nhất' }, 201);
});

export default contact;
