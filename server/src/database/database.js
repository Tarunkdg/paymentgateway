import bcrypt from 'bcryptjs';
import initSqlJs from 'sql.js';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const defaultPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/payments.sqlite');
const require = createRequire(import.meta.url);

export async function createDatabase(path = process.env.DATABASE_PATH || defaultPath) {
  const filePath = path === ':memory:' ? path : resolve(path);
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true });
  const SQL = await initSqlJs({ locateFile: (file) => file.endsWith('.wasm') ? require.resolve('sql.js/dist/sql-wasm.wasm') : file });
  const native = new SQL.Database(filePath !== ':memory:' && existsSync(filePath) ? readFileSync(filePath) : undefined);
  native.run('PRAGMA foreign_keys = ON');
  let transactionDepth = 0;
  const persist = () => {
    if (filePath !== ':memory:') writeFileSync(filePath, Buffer.from(native.export()));
  };
  const bind = (params) => {
    if (params.length === 0) return undefined;
    if (params.length > 1) return params;
    const value = params[0];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [`@${key}`, item]));
    }
    return [value];
  };
  const db = {
    exec: (sql) => native.exec(sql),
    pragma: (sql) => {
      if (!sql.toLowerCase().startsWith('journal_mode')) native.run(`PRAGMA ${sql}`);
    },
    prepare: (sql) => ({
      get: (...params) => {
        const statement = native.prepare(sql);
        try {
          const values = bind(params);
          if (values) statement.bind(values);
          return statement.step() ? statement.getAsObject() : undefined;
        } finally { statement.free(); }
      },
      all: (...params) => {
        const statement = native.prepare(sql);
        try {
          const values = bind(params);
          if (values) statement.bind(values);
          const rows = [];
          while (statement.step()) rows.push(statement.getAsObject());
          return rows;
        } finally { statement.free(); }
      },
      run: (...params) => {
        const statement = native.prepare(sql);
        try {
          const values = bind(params);
          if (values) statement.bind(values);
          statement.step();
          if (transactionDepth === 0) persist();
          return { changes: native.getRowsModified() };
        } finally { statement.free(); }
      },
    }),
    transaction: (handler) => (...args) => {
      native.run('BEGIN');
      transactionDepth += 1;
      try {
        const result = handler(...args);
        native.run('COMMIT');
        transactionDepth -= 1;
        persist();
        return result;
      } catch (error) {
        native.run('ROLLBACK');
        transactionDepth -= 1;
        throw error;
      }
    },
    close: () => { persist(); native.close(); },
  };
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_mobile TEXT NOT NULL,
      description TEXT NOT NULL,
      product_id TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount > 0),
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL CHECK (status IN ('created', 'paid', 'failed', 'cancelled', 'pending')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL UNIQUE,
      order_id TEXT NOT NULL REFERENCES orders(id),
      idempotency_key TEXT NOT NULL UNIQUE,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('upi', 'credit_card', 'debit_card', 'net_banking', 'wallet')),
      amount INTEGER NOT NULL CHECK (amount > 0),
      currency TEXT NOT NULL,
      transaction_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'cancelled')),
      provider TEXT NOT NULL DEFAULT 'simulated' CHECK (provider IN ('simulated', 'stripe')),
      checkout_session_id TEXT,
      checkout_url TEXT,
      failure_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
    CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);
    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      event_id TEXT PRIMARY KEY,
      received_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const paymentColumns = new Set(db.prepare('PRAGMA table_info(payments)').all().map((column) => column.name));
  if (!paymentColumns.has('provider')) db.exec("ALTER TABLE payments ADD COLUMN provider TEXT NOT NULL DEFAULT 'simulated' CHECK (provider IN ('simulated', 'stripe'))");
  if (!paymentColumns.has('checkout_session_id')) db.exec('ALTER TABLE payments ADD COLUMN checkout_session_id TEXT');
  if (!paymentColumns.has('checkout_url')) db.exec('ALTER TABLE payments ADD COLUMN checkout_url TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_checkout_session_id ON payments(checkout_session_id) WHERE checkout_session_id IS NOT NULL');

  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || 'DemoAdmin123!';
  if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_PASSWORD || !process.env.JWT_SECRET)) {
    throw new Error('ADMIN_PASSWORD and JWT_SECRET must be configured in production.');
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!existing) {
    db.prepare('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(
      randomUUID(), 'Demo Administrator', email, bcrypt.hashSync(password, 12), 'admin',
    );
  }
  return db;
}
