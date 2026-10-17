import { randomUUID } from 'node:crypto';
import { HttpError } from '../middleware/errors.js';

const methods = ['upi', 'credit_card', 'debit_card', 'net_banking', 'wallet'];
const outcomes = ['success', 'failure', 'cancelled', 'pending'];
const uid = () => randomUUID();

export function createPaymentService(db, stripePayments) {
  return {
    async initiate({ orderId, method, idempotencyKey, provider = 'simulated' }) {
      const existing = db.prepare(`
        SELECT p.*, o.order_number, o.customer_email, o.description FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.idempotency_key = ?
      `).get(idempotencyKey);
      if (existing) {
        if (existing.order_id !== orderId || existing.payment_method !== method || existing.provider !== provider) {
          throw new HttpError(409, 'The idempotency key has already been used for a different request.');
        }
        if (existing.provider === 'stripe') return stripePayments.start(existing);
        return existing;
      }
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) throw new HttpError(404, 'Order not found.');
      if (order.status !== 'created') throw new HttpError(409, 'This order cannot be paid again.');
      const pendingPayment = db.prepare('SELECT payment_id FROM payments WHERE order_id = ? AND status = \'pending\'').get(orderId);
      if (pendingPayment) throw new HttpError(409, 'A payment is already pending for this order.');
      if (!methods.includes(method)) throw new HttpError(400, 'Choose a supported payment method.');
      if (!['simulated', 'stripe'].includes(provider)) throw new HttpError(400, 'Choose a supported payment provider.');
      if (provider === 'stripe' && method !== 'credit_card') {
        throw new HttpError(400, 'Stripe Checkout currently supports the card method only.');
      }

      const payment = {
        id: uid(),
        payment_id: `pay_${uid().replaceAll('-', '').slice(0, 20)}`,
        order_id: order.id,
        idempotency_key: idempotencyKey,
        payment_method: method,
        amount: order.amount,
        currency: order.currency,
        transaction_id: `txn_${uid().replaceAll('-', '').slice(0, 20)}`,
        status: 'pending',
        provider,
      };
      db.prepare(`
        INSERT INTO payments (id, payment_id, order_id, idempotency_key, payment_method, amount, currency, transaction_id, status, provider)
        VALUES (@id, @payment_id, @order_id, @idempotency_key, @payment_method, @amount, @currency, @transaction_id, @status, @provider)
      `).run(payment);
      const created = db.prepare(`
        SELECT p.*, o.order_number, o.customer_email, o.description
        FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = ?
      `).get(payment.id);
      if (provider === 'stripe') return stripePayments.start(created);
      return created;
    },

    simulate(paymentId, outcome) {
      if (process.env.NODE_ENV !== 'development') throw new HttpError(404, 'Not found.');
      if (!outcomes.includes(outcome)) throw new HttpError(400, 'Choose success, failure, cancelled, or pending.');
      const payment = db.prepare('SELECT * FROM payments WHERE payment_id = ?').get(paymentId);
      if (!payment) throw new HttpError(404, 'Payment not found.');
      if (payment.provider !== 'simulated') throw new HttpError(409, 'Stripe payment status can only be updated by Stripe.');
      const status = outcome === 'failure' ? 'failed' : outcome;
      if (payment.status !== 'pending') {
        if (payment.status === status) {
          return db.prepare(`
            SELECT p.*, o.order_number, o.customer_name, o.customer_email, o.customer_mobile, o.description
            FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.payment_id = ?
          `).get(paymentId);
        }
        throw new HttpError(409, 'This payment has already been finalized.');
      }
      const reason = status === 'failed' ? 'The simulated payment was declined.' : status === 'cancelled' ? 'Payment was cancelled by the customer.' : null;
      const orderStatus = status === 'success' ? 'paid' : status;
      const transaction = db.transaction(() => {
        db.prepare('UPDATE payments SET status = ?, failure_reason = ?, updated_at = datetime(\'now\') WHERE payment_id = ?')
          .run(status, reason, paymentId);
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(orderStatus, payment.order_id);
      });
      transaction();
      return db.prepare(`
        SELECT p.*, o.order_number, o.customer_name, o.customer_email, o.customer_mobile, o.description
        FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.payment_id = ?
      `).get(paymentId);
    },
  };
}
