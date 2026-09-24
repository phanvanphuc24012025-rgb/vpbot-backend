// Mock D1 rất đơn giản chạy trên SQLite in-memory qua node:sqlite (Node 22+)
// Chỉ dùng để smoke-test cục bộ, KHÔNG dùng trong production.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function createMockD1(schemaPath) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(schemaPath, 'utf8'));

  return {
    prepare(sql) {
      // Chuyển datetime('now') SQLite chuẩn - node:sqlite hỗ trợ sẵn hàm này
      return {
        _sql: sql,
        _params: [],
        bind(...params) {
          this._params = params;
          return this;
        },
        async first() {
          const stmt = db.prepare(this._sql);
          const row = stmt.get(...this._params);
          return row || null;
        },
        async all() {
          const stmt = db.prepare(this._sql);
          const results = stmt.all(...this._params);
          return { results };
        },
        async run() {
          const stmt = db.prepare(this._sql);
          const info = stmt.run(...this._params);
          return { success: true, meta: { last_row_id: info.lastInsertRowid } };
        }
      };
    },
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    }
  };
}
