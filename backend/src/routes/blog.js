// ============================================
// routes/blog.js - /api/blog/*  (BlogPost.js) - đọc công khai
// ============================================
import { Hono } from 'hono';

const blog = new Hono();

function mapPost(r) {
  return {
    id: r.id,
    title: r.title,
    slug: r.slug,
    excerpt: r.excerpt,
    content: r.content,
    coverImage: r.cover_image,
    published: !!r.published,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

// GET /blog - danh sách bài đã publish
blog.get('/', async (c) => {
  const page = Math.max(parseInt(c.req.query('page') || '1', 10), 1);
  const limit = Math.min(parseInt(c.req.query('limit') || '10', 10), 50);
  const offset = (page - 1) * limit;

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM blog_posts WHERE published = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?'
  )
    .bind(limit, offset)
    .all();

  const { total } = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM blog_posts WHERE published = 1').first();

  return c.json({ posts: results.map(mapPost), page, limit, total });
});

// GET /blog/:slug
blog.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const row = await c.env.DB.prepare('SELECT * FROM blog_posts WHERE slug = ? AND published = 1')
    .bind(slug)
    .first();
  if (!row) return c.json({ message: 'Không tìm thấy bài viết' }, 404);
  return c.json({ post: mapPost(row) });
});

export { mapPost };
export default blog;
