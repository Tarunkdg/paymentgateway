import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import Stripe from 'stripe';
import { createDatabase } from '../src/database/database.js';
import { createApp } from '../src/app.js';

process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.STRIPE_SECRET_KEY = '';

let db;
let app;

beforeEach(async () => {
  db = await createDatabase(':memory:');
  app = createApp(db);
});

afterEach(() => db.close());

async function makeOrder(overrides = {}) {
  const response = await request(app).post('/api/orders').send({
    customerName: 'Jamie Example',
    customerEmail: 'jamie@example.com',
    customerMobile: '+91 98765 43210',
    productId: 'starter',
    ...overrides,
  });
  return response;
}

async function makePayment(orderId, overrides = {}) {
  return request(app).post('/api/payments/initiate').send({
    orderId,
    method: 'upi',
    idempotencyKey: `idempotency-${Math.random().toString(36).slice(2)}-unique`,
    ...overrides,
  });
}

function createStripeTestDouble() {
  const sessions = new Map();
  const webhookVerifier = new Stripe('sk_test_webhook_unit_test');
  return {
    sessions,
    client: {
      checkout: {
        sessions: {
          create: async (input, options) => {
            const id = `cs_test_${sessions.size + 1}`;
            const session = {
              id,
              url: `https://checkout.stripe.test/${id}`,
              status: 'open',
              payment_status: 'unpaid',
              amount_total: input.line_items[0].price_data.unit_amount,
              currency: input.line_items[0].price_data.currency,
              metadata: input.metadata,
            };
            sessions.set(id, session);
            return { ...session, ...options };
          },
          retrieve: async (id) => sessions.get(id),
        },
      },
      webhooks: webhookVerifier.webhooks,
    },
  };
}

function stripeTestSignature(event) {
  return Stripe.webhooks.generateTestHeaderString({
    payload: JSON.stringify(event),
    secret: 'whsec_test',
  });
}

test('creates an order with a server-calculated amount and ignores browser prices', async () => {
  const response = await makeOrder({ amount: 1, productId: 'pro' });
  assert.equal(response.status, 201);
  assert.equal(response.body.order.amount, 249900);
  assert.equal(response.body.order.currency, 'INR');
});

test('rejects missing customer information and invalid products', async () => {
  assert.equal((await request(app).post('/api/orders').send({ productId: 'starter' })).status, 400);
  assert.equal((await makeOrder({ productId: 'unknown' })).status, 400);
});

test('successful simulated payment is recorded and linked to its order', async () => {
  const order = await makeOrder();
  const payment = await makePayment(order.body.order.id);
  const result = await request(app).post(`/api/payments/${payment.body.payment.payment_id}/simulate`).send({ outcome: 'success' });
  assert.equal(result.status, 200);
  assert.equal(result.body.payment.status, 'success');
  assert.equal(result.body.payment.amount, order.body.order.amount);
  assert.match(result.body.payment.transaction_id, /^txn_/);
  assert.equal((await request(app).get(`/api/orders/${order.body.order.id}`)).body.order.status, 'paid');
});

test('failure and cancellation scenarios persist their final statuses', async () => {
  for (const [scenario, expected] of [['failure', 'failed'], ['cancelled', 'cancelled']]) {
    const order = await makeOrder();
    const payment = await makePayment(order.body.order.id);
    const response = await request(app).post(`/api/payments/${payment.body.payment.payment_id}/simulate`).send({ outcome: scenario });
    assert.equal(response.body.payment.status, expected);
    assert.ok(response.body.payment.failure_reason);
  }
});

test('pending remains visible and may be settled by a later simulated result', async () => {
  const order = await makeOrder();
  const payment = await makePayment(order.body.order.id);
  const pending = await request(app).post(`/api/payments/${payment.body.payment.payment_id}/simulate`).send({ outcome: 'pending' });
  assert.equal(pending.body.payment.status, 'pending');
  const success = await request(app).post(`/api/payments/${payment.body.payment.payment_id}/simulate`).send({ outcome: 'success' });
  assert.equal(success.body.payment.status, 'success');
});

test('idempotency keys return the original payment and reject mismatched reuse', async () => {
  const order = await makeOrder();
  const key = 'idempotency-key-that-is-unique';
  const first = await makePayment(order.body.order.id, { idempotencyKey: key });
  const duplicate = await makePayment(order.body.order.id, { idempotencyKey: key });
  assert.equal(duplicate.status, 201);
  assert.equal(duplicate.body.payment.payment_id, first.body.payment.payment_id);
  assert.equal((await makePayment(order.body.order.id, { idempotencyKey: key, method: 'wallet' })).status, 409);
  assert.equal((await makePayment(order.body.order.id)).status, 409);
});

test('payment history, transaction details, and printable receipt are available', async () => {
  const order = await makeOrder();
  const payment = await makePayment(order.body.order.id);
  await request(app).post(`/api/payments/${payment.body.payment.payment_id}/simulate`).send({ outcome: 'success' });
  const secondOrder = await makeOrder({ customerName: 'Taylor Example', customerEmail: 'taylor@example.com', productId: 'pro' });
  const secondPayment = await makePayment(secondOrder.body.order.id);
  await request(app).post(`/api/payments/${secondPayment.body.payment.payment_id}/simulate`).send({ outcome: 'success' });
  const transactionId = payment.body.payment.transaction_id;
  const history = await request(app).get('/api/payments?status=success&search=Jamie');
  assert.equal(history.body.pagination.total, 1);
  assert.equal(history.body.payments[0].customer_name, 'Jamie Example');
  const sorted = await request(app).get('/api/payments?sort=amount&direction=asc');
  assert.deepEqual(sorted.body.payments.map((row) => row.amount), [129900, 249900]);
  assert.equal((await request(app).get(`/api/transactions/${transactionId}`)).status, 200);
  const receipt = await request(app).get(`/api/transactions/${transactionId}/receipt`);
  assert.equal(receipt.status, 200);
  assert.match(receipt.headers['content-type'], /text\/html/);
  assert.match(receipt.text, /no money was transferred/i);
});

test('administrator routes require a valid administrator token', async () => {
  assert.equal((await request(app).get('/api/admin/dashboard')).status, 401);
  const login = await request(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'test-admin-password' });
  assert.equal(login.status, 200);
  const dashboard = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.dashboard.total_transactions, 0);
});

test('API reports validation, missing resource, and missing route errors clearly', async () => {
  assert.equal((await request(app).post('/api/payments/initiate').send({})).status, 400);
  const malformed = await request(app).post('/api/orders').set('Content-Type', 'application/json').send('{"customerName":');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error, 'Request body must contain valid JSON.');
  assert.equal((await request(app).get('/api/orders/no-such-order')).status, 404);
  const missing = await request(app).get('/api/not-a-route');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'Route not found.');
});

test('simulated payment controls are disabled outside development mode', async () => {
  const order = await makeOrder();
  const payment = await makePayment(order.body.order.id);
  process.env.NODE_ENV = 'production';
  try {
    assert.equal((await request(app).post(`/api/payments/${payment.body.payment.payment_id}/simulate`).send({ outcome: 'success' })).status, 404);
    assert.equal((await request(app).post('/api/dev/reset')).status, 404);
  } finally {
    process.env.NODE_ENV = 'development';
  }
});

test('Stripe test checkout uses server amount and verified webhook finalizes the order', async () => {
  const stripe = createStripeTestDouble();
  const stripeApp = createApp(db, { stripe: stripe.client });
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  try {
    const order = await request(stripeApp).post('/api/orders').send({
      customerName: 'Stripe Customer',
      customerEmail: 'stripe@example.com',
      customerMobile: '+91 98765 43210',
      productId: 'pro',
    });
    const initiated = await request(stripeApp).post('/api/payments/initiate').send({
      orderId: order.body.order.id,
      method: 'credit_card',
      provider: 'stripe',
      idempotencyKey: 'stripe-idempotency-key-test',
      amount: 1,
    });
    assert.equal(initiated.status, 201);
    assert.equal(initiated.body.payment.checkoutUrl, 'https://checkout.stripe.test/cs_test_1');
    assert.equal(initiated.body.payment.amount, 249900);
    const duplicateStart = await request(stripeApp).post('/api/payments/initiate').send({
      orderId: order.body.order.id,
      method: 'credit_card',
      provider: 'stripe',
      idempotencyKey: 'stripe-idempotency-key-test',
    });
    assert.equal(duplicateStart.body.payment.payment_id, initiated.body.payment.payment_id);
    assert.equal(stripe.sessions.size, 1);
    assert.equal((await request(stripeApp).post(`/api/payments/${initiated.body.payment.payment_id}/simulate`).send({ outcome: 'success' })).status, 409);
    assert.equal((await request(stripeApp).post('/api/payments/initiate').send({
      orderId: order.body.order.id,
      method: 'credit_card',
      provider: 'stripe',
      idempotencyKey: 'stripe-second-payment-attempt',
    })).status, 409);
    const session = stripe.sessions.get('cs_test_1');
    session.status = 'complete';
    session.payment_status = 'paid';
    const webhookEvent = { id: 'evt_checkout_complete', type: 'checkout.session.completed', data: { object: session } };
    const webhook = await request(stripeApp).post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', stripeTestSignature(webhookEvent))
      .send(JSON.stringify(webhookEvent));
    assert.equal(webhook.status, 200);
    assert.equal((await request(stripeApp).get(`/api/payments/${initiated.body.payment.payment_id}`)).body.payment.status, 'success');
    assert.equal((await request(stripeApp).get(`/api/orders/${order.body.order.id}`)).body.order.status, 'paid');
    const duplicate = await request(stripeApp).post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', stripeTestSignature(webhookEvent))
      .send(JSON.stringify(webhookEvent));
    assert.deepEqual(duplicate.body, { duplicate: true });
  } finally {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  }
});

test('Stripe webhook rejects invalid signatures and amount mismatches', async () => {
  const stripe = createStripeTestDouble();
  const stripeApp = createApp(db, { stripe: stripe.client });
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  try {
    const order = await makeOrder();
    const payment = await request(stripeApp).post('/api/payments/initiate').send({
      orderId: order.body.order.id,
      method: 'credit_card',
      provider: 'stripe',
      idempotencyKey: 'stripe-mismatch-idempotency',
    });
    const session = stripe.sessions.get('cs_test_1');
    session.status = 'complete';
    session.payment_status = 'paid';
    session.amount_total += 100;
    const event = JSON.stringify({ id: 'evt_bad_amount', type: 'checkout.session.completed', data: { object: session } });
    const invalidSignature = await request(stripeApp).post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json').set('stripe-signature', 'invalid').send(event);
    assert.equal(invalidSignature.status, 400);
    const mismatch = await request(stripeApp).post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json').set('stripe-signature', stripeTestSignature(JSON.parse(event))).send(event);
    assert.equal(mismatch.status, 400);
    assert.equal(db.prepare('SELECT status FROM payments WHERE payment_id = ?').get(payment.body.payment.payment_id).status, 'pending');
  } finally {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  }
});

test('Stripe Checkout expiration marks the payment cancelled on server refresh', async () => {
  const stripe = createStripeTestDouble();
  const stripeApp = createApp(db, { stripe: stripe.client });
  const order = await makeOrder();
  const payment = await request(stripeApp).post('/api/payments/initiate').send({
    orderId: order.body.order.id,
    method: 'credit_card',
    provider: 'stripe',
    idempotencyKey: 'stripe-expiration-idempotency',
  });
  const session = stripe.sessions.get('cs_test_1');
  session.status = 'expired';
  const refreshed = await request(stripeApp).get(`/api/payments/${payment.body.payment.payment_id}`);
  assert.equal(refreshed.body.payment.status, 'cancelled');
  assert.equal((await request(stripeApp).get(`/api/orders/${order.body.order.id}`)).body.order.status, 'cancelled');
});

test('Stripe payment initiation is unavailable unless a test key is configured', async () => {
  assert.deepEqual((await request(app).get('/api/config')).body, { stripeTestModeEnabled: false });
  const order = await makeOrder();
  const response = await request(app).post('/api/payments/initiate').send({
    orderId: order.body.order.id,
    method: 'credit_card',
    provider: 'stripe',
    idempotencyKey: 'stripe-unconfigured-idempotency',
  });
  assert.equal(response.status, 503);
});

test('SQLite data persists when reopening a database file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'payflow-demo-'));
  const path = join(directory, 'payments.sqlite');
  let reopened;
  try {
    const persistent = await createDatabase(path);
    const createdApp = createApp(persistent);
    const response = await request(createdApp).post('/api/orders').send({
      customerName: 'Persisted Customer',
      customerEmail: 'persisted@example.com',
      customerMobile: '+91 98765 43210',
      productId: 'starter',
    });

    test('existing SQLite databases are migrated with Stripe payment fields', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'payflow-migration-'));
      const path = join(directory, 'payments.sqlite');
      let migrated;
      try {
        const SQL = await initSqlJs();
        const legacy = new SQL.Database();
        legacy.run(`
          CREATE TABLE orders (
            id TEXT PRIMARY KEY, order_number TEXT NOT NULL UNIQUE, customer_name TEXT NOT NULL,
            customer_email TEXT NOT NULL, customer_mobile TEXT NOT NULL, description TEXT NOT NULL,
            product_id TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL,
            status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE TABLE payments (
            id TEXT PRIMARY KEY, payment_id TEXT NOT NULL UNIQUE, order_id TEXT NOT NULL REFERENCES orders(id),
            idempotency_key TEXT NOT NULL UNIQUE,
            payment_method TEXT NOT NULL CHECK (payment_method IN ('upi', 'credit_card', 'debit_card', 'net_banking', 'wallet')),
            amount INTEGER NOT NULL, currency TEXT NOT NULL, transaction_id TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'cancelled')),
            failure_reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX idx_payments_order_id ON payments(order_id);
          CREATE INDEX idx_payments_status ON payments(status);
          CREATE INDEX idx_payments_created_at ON payments(created_at);
        `);
        writeFileSync(path, Buffer.from(legacy.export()));
        legacy.close();

        migrated = await createDatabase(path);
        const columns = new Set(migrated.prepare('PRAGMA table_info(payments)').all().map((column) => column.name));
        assert.ok(columns.has('provider'));
        assert.ok(columns.has('checkout_session_id'));
        assert.ok(columns.has('checkout_url'));
        assert.equal(migrated.prepare('SELECT COUNT(*) AS count FROM payments').get().count, 0);
      } finally {
        if (migrated) migrated.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
    assert.equal(response.status, 201);
    persistent.close();
    reopened = await createDatabase(path);
    assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 1);
    assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
  } finally {
    if (reopened) reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
