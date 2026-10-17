import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { products } from './config/products.js';
import { asyncRoute, errorHandler, HttpError } from './middleware/errors.js';
import { requireAdmin } from './middleware/auth.js';
import { createPaymentService } from './services/payments.js';
import { createStripePaymentService } from './services/stripePayments.js';

const orderSchema = z.object({
  customerName: z.string().trim().min(2).max(100),
  customerEmail: z.string().trim().email().max(254),
  customerMobile: z.string().trim().regex(/^\+?[0-9\s-]{8,18}$/),
  productId: z.enum(['starter', 'pro']),
});
const paymentSchema = z.object({
  orderId: z.string().uuid(),
  method: z.enum(['upi', 'credit_card', 'debit_card', 'net_banking', 'wallet']),
  provider: z.enum(['simulated', 'stripe']).default('simulated'),
  idempotencyKey: z.string().min(16).max(100),
});
const outcomes = z.object({ outcome: z.enum(['success', 'failure', 'cancelled', 'pending']) });
const orderSelect = `SELECT id, order_number, customer_name, customer_email, customer_mobile, description, product_id, amount, currency, status, created_at FROM orders`;
const paymentSelect = `
  SELECT p.payment_id, p.transaction_id, p.payment_method, p.provider, p.amount, p.currency, p.status, p.failure_reason, p.created_at, p.updated_at,
    o.id AS order_id, o.order_number, o.customer_name, o.customer_email, o.customer_mobile, o.description
  FROM payments p JOIN orders o ON o.id = p.order_id`;

function paymentResponse(payment) {
  const { checkout_url: checkoutUrl, ...details } = payment;
  return { ...details, checkoutUrl: payment.provider === 'stripe' && payment.status === 'pending' ? checkoutUrl : undefined };
}

export function createApp(db, options = {}) {
  const app = express();
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  if (stripeKey && !stripeKey.startsWith('sk_test_')) {
    throw new Error('This demo accepts Stripe test secret keys only (sk_test_...).');
  }
  const stripe = options.stripe || (stripeKey.startsWith('sk_test_') ? new Stripe(stripeKey) : null);
  const stripePayments = createStripePaymentService(db, stripe, process.env.CLIENT_ORIGIN || 'http://localhost:5173');
  const paymentService = createPaymentService(db, stripePayments);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));

  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '100kb' }), asyncRoute((req, res) => {
    const signature = req.get('stripe-signature');
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !webhookSecret) throw new HttpError(503, 'Stripe webhooks are not configured.');
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch {
      throw new HttpError(400, 'Invalid Stripe webhook signature.');
    }
    res.json(stripePayments.handleWebhook(event));
  }));
  app.use(express.json({ limit: '20kb' }));
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', mode: process.env.NODE_ENV || 'development' }));
  app.get('/api/config', (_req, res) => res.json({
    stripeTestModeEnabled: Boolean(stripe && (stripeKey.startsWith('sk_test_') || options.stripe)),
  }));

  app.post('/api/orders', asyncRoute((req, res) => {
    const input = orderSchema.parse(req.body);
    const product = products[input.productId];
    const id = randomUUID();
    const orderNumber = `ord_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    db.prepare(`
      INSERT INTO orders (id, order_number, customer_name, customer_email, customer_mobile, description, product_id, amount, currency, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'created')
    `).run(id, orderNumber, input.customerName, input.customerEmail, input.customerMobile, product.description, product.id, product.unitAmount, product.currency);
    res.status(201).json({ order: db.prepare(`${orderSelect} WHERE id = ?`).get(id), product: { name: product.name } });
  }));

  app.get('/api/orders/:orderId', asyncRoute((req, res) => {
    const order = db.prepare(`${orderSelect} WHERE id = ? OR order_number = ?`).get(req.params.orderId, req.params.orderId);
    if (!order) throw new HttpError(404, 'Order not found.');
    res.json({ order });
  }));

  app.post('/api/payments/initiate', asyncRoute(async (req, res) => {
    const input = paymentSchema.parse(req.body);
    if (input.provider === 'stripe' && !stripe) {
      throw new HttpError(503, 'Stripe test checkout is not configured. Add a Stripe test secret key to server/.env.');
    }
    const payment = await paymentService.initiate(input);
    res.status(201).json({ payment: paymentResponse(payment) });
  }));

  app.post('/api/payments/:paymentId/simulate', asyncRoute((req, res) => {
    const { outcome } = outcomes.parse(req.body);
    res.json({ payment: paymentService.simulate(req.params.paymentId, outcome) });
  }));

  app.get('/api/payments/:paymentId', asyncRoute(async (req, res) => {
    const payment = await stripePayments.refresh(req.params.paymentId);
    res.json({ payment: paymentResponse(payment) });
  }));

  app.get('/api/payments', asyncRoute((req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const status = typeof req.query.status === 'string' && ['pending', 'success', 'failed', 'cancelled'].includes(req.query.status) ? req.query.status : null;
    const search = typeof req.query.search === 'string' ? `%${req.query.search.trim().slice(0, 100)}%` : null;
    const sortColumns = { created_at: 'p.created_at', amount: 'p.amount', customer_name: 'o.customer_name', status: 'p.status' };
    const sort = typeof req.query.sort === 'string' && Object.hasOwn(sortColumns, req.query.sort) ? req.query.sort : 'created_at';
    const direction = req.query.direction === 'asc' ? 'ASC' : 'DESC';
    const filters = [];
    const params = [];
    if (status) { filters.push('p.status = ?'); params.push(status); }
    if (search) {
      filters.push('(o.customer_name LIKE ? OR o.customer_email LIKE ? OR o.order_number LIKE ? OR p.transaction_id LIKE ?)');
      params.push(search, search, search, search);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM payments p JOIN orders o ON o.id = p.order_id ${where}`).get(...params).count;
    const rows = db.prepare(`${paymentSelect} ${where} ORDER BY ${sortColumns[sort]} ${direction}, p.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
    res.json({ payments: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  }));

  app.get('/api/transactions/:transactionId', asyncRoute((req, res) => {
    const transaction = db.prepare(`${paymentSelect} WHERE p.transaction_id = ?`).get(req.params.transactionId);
    if (!transaction) throw new HttpError(404, 'Transaction not found.');
    res.json({ transaction });
  }));

  app.get('/api/transactions/:transactionId/receipt', asyncRoute((req, res) => {
    const payment = db.prepare(`${paymentSelect} WHERE p.transaction_id = ?`).get(req.params.transactionId);
    if (!payment) throw new HttpError(404, 'Transaction not found.');
    const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const receiptNote = payment.provider === 'stripe'
      ? 'Stripe test-mode transaction — no live funds were transferred.'
      : 'Simulated transaction — no money was transferred.';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Payment receipt ${escape(payment.transaction_id)}</title><style>body{font:16px Arial,sans-serif;max-width:680px;margin:48px auto;padding:24px;color:#172335}h1{color:#176b59}.row{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:12px 0}.amount{font-size:28px;font-weight:bold}button{padding:10px 16px;margin-top:22px}@media print{button{display:none}}</style></head><body><h1>Payment receipt</h1><p>${escape(receiptNote)}</p><div class="row"><b>Payment status</b><span>${escape(payment.status.toUpperCase())}</span></div><div class="row"><b>Provider</b><span>${payment.provider === 'stripe' ? 'Stripe test mode' : 'Local simulator'}</span></div><div class="row"><b>Transaction ID</b><span>${escape(payment.transaction_id)}</span></div><div class="row"><b>Order ID</b><span>${escape(payment.order_number)}</span></div><div class="row"><b>Customer</b><span>${escape(payment.customer_name)}</span></div><div class="row"><b>Description</b><span>${escape(payment.description)}</span></div><div class="row"><b>Payment method</b><span>${escape(payment.payment_method.replaceAll('_', ' '))}</span></div><div class="row"><b>Date</b><span>${escape(payment.created_at)}</span></div><p class="amount">${(payment.amount / 100).toLocaleString('en-IN', { style: 'currency', currency: payment.currency })}</p><button onclick="window.print()">Print / Save receipt</button></body></html>`;
    res.type('html').set('Content-Disposition', `attachment; filename="receipt-${payment.transaction_id}.html"`).send(html);
  }));

  app.post('/api/auth/login', asyncRoute(async (req, res) => {
    const input = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).parse(req.body);
    const user = db.prepare('SELECT id, name, email, password_hash, role FROM users WHERE email = ? COLLATE NOCASE').get(input.email);
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) throw new HttpError(401, 'Email or password is incorrect.');
    const token = jwt.sign({ sub: user.id, role: user.role, name: user.name }, process.env.JWT_SECRET || 'local-demo-secret-change-me', { expiresIn: '8h' });
    res.json({ token, admin: { name: user.name, email: user.email } });
  }));

  app.get('/api/admin/dashboard', requireAdmin, (_req, res) => {
    const stats = db.prepare(`
      SELECT COUNT(*) AS total_transactions,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successful_payments,
        SUM(CASE WHEN status IN ('failed', 'cancelled') THEN 1 ELSE 0 END) AS failed_payments,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_payments,
        COALESCE(SUM(CASE WHEN status = 'success' THEN amount ELSE 0 END), 0) AS total_collected
      FROM payments
    `).get();
    res.json({ dashboard: stats });
  });

  app.post('/api/dev/reset', (_req, res, next) => {
    if (process.env.NODE_ENV !== 'development') return next(new HttpError(404, 'Not found.'));
    db.transaction(() => { db.prepare('DELETE FROM payments').run(); db.prepare('DELETE FROM orders').run(); })();
    res.json({ message: 'Demo orders and payments have been cleared.' });
  });

  app.use((_req, _res, next) => next(new HttpError(404, 'Route not found.')));
  app.use(errorHandler);
  return app;
}
