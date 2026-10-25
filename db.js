// שכבת נתונים: Postgres כשיש DATABASE_URL (ברנדר), אחרת SQLite מקומי
const url = process.env.DATABASE_URL;
let impl;

if (url) {
  const { default: pg } = await import('pg');
  const external = /@[^/]*\./.test(url) && !url.includes('localhost');
  // DB_SCHEMA מאפשר לחלוק בסיס נתונים קיים בלי להתערב בטבלאות של אפליקציה אחרת
  const schema = process.env.DB_SCHEMA;
  if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('DB_SCHEMA לא תקין');
  const pool = new pg.Pool({
    connectionString: url,
    ssl: external ? { rejectUnauthorized: false } : false,
    ...(schema && { options: `-c search_path=${schema}` }),
  });
  if (schema) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  const conv = (s) => { let i = 0; return s.replace(/\?/g, () => '$' + ++i); };
  impl = {
    all: async (s, p = []) => (await pool.query(conv(s), p)).rows,
    run: async (s, p = []) => { await pool.query(conv(s), p); },
    insert: async (s, p = []) => (await pool.query(conv(s) + ' RETURNING id', p)).rows[0].id,
    exec: (s) => pool.query(s),
    idType: 'SERIAL PRIMARY KEY',
  };
} else {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(process.env.DB_PATH || './data.db');
  impl = {
    all: async (s, p = []) => db.prepare(s).all(...p),
    run: async (s, p = []) => { db.prepare(s).run(...p); },
    insert: async (s, p = []) => Number(db.prepare(s).run(...p).lastInsertRowid),
    exec: async (s) => db.exec(s),
    idType: 'INTEGER PRIMARY KEY AUTOINCREMENT',
  };
}

export const db = impl;

export async function init() {
  const id = impl.idType;
  await impl.exec(`CREATE TABLE IF NOT EXISTS income (
    id ${id}, date TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL,
    description TEXT DEFAULT '', pct DOUBLE PRECISION NOT NULL DEFAULT 10)`);
  await impl.exec(`CREATE TABLE IF NOT EXISTS gift (
    id ${id}, date TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL,
    recipient TEXT DEFAULT '', category TEXT DEFAULT '', note TEXT DEFAULT '',
    recurring_id INTEGER)`);
  await impl.exec(`CREATE TABLE IF NOT EXISTS recurring (
    id ${id}, amount DOUBLE PRECISION NOT NULL, day INTEGER NOT NULL,
    recipient TEXT DEFAULT '', category TEXT DEFAULT '', note TEXT DEFAULT '',
    start_date TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, last_month TEXT DEFAULT '')`);
}
