import { HttpError } from '../middleware/errors.js';

const statusQuery = `
  SELECT p.*, o.order_number, o.customer_name, o.customer_email, o.customer_mobile, o.description
  FROM payments p JOIN orders o ON o.id = p.order_id
`;

export function createStripePaymentService(db, stripe, clientOrigin) {
  function getPayment(paymentId) {
    return db.prepare(`${statusQuery} WHERE p.payment_id = ?`).get(paymentId);
  }

  function updateFromStripeSession(session, eventType) {
    const paymentId = session.metadata?.internal_payment_id;
    if (!paymentId) return null;

    const payment = db.prepare('SELECT * FROM payments WHERE payment_id = ?').get(paymentId);
    if (!payment || payment.provider !== 'stripe' || payment.checkout_session_id !== session.id) return null;
    if (session.metadata?.order_id !== payment.order_id) {
      throw new HttpError(400, 'Stripe session order metadata does not match the payment.');
    }

    let status = 'pending';
    let failureReason = null;
    if (eventType === 'checkout.session.expired' || session.status === 'expired') {
      status = 'cancelled';
      failureReason = 'The Stripe Checkout session expired before payment completed.';
    } else if (eventType === 'checkout.session.async_payment_failed') {
      status = 'failed';
      failureReason = 'The Stripe test payment was not completed.';
    } else if (eventType === 'checkout.session.async_payment_succeeded' ||
      (session.status === 'complete' && session.payment_status === 'paid')) {
      if (session.amount_total !== payment.amount || session.currency?.toLowerCase() !== payment.currency.toLowerCase()) {
        throw new HttpError(400, 'Stripe-reported amount or currency does not match the order.');
      }
      status = 'success';
    }

    if (status !== 'pending' && payment.status === 'pending') {
      const orderStatus = status === 'success' ? 'paid' : status;
      const transaction = db.transaction(() => {
        db.prepare(`
          UPDATE payments SET status = ?, failure_reason = ?, updated_at = datetime('now')
          WHERE payment_id = ? AND status = 'pending'
        `).run(status, failureReason, paymentId);
        db.prepare('UPDATE orders SET status = ? WHERE id = ? AND status = \'created\'').run(orderStatus, payment.order_id);
      });
      transaction();
    }

    return getPayment(paymentId);
  }

  async function createCheckoutSession(payment) {
    if (!stripe) throw new HttpError(503, 'Stripe test checkout is not configured. Add a Stripe test secret key to server/.env.');
    let session;
    try {
      session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: payment.customer_email,
      client_reference_id: payment.payment_id,
      metadata: {
        internal_payment_id: payment.payment_id,
        order_id: payment.order_id,
        order_number: payment.order_number,
      },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: payment.currency.toLowerCase(),
          unit_amount: payment.amount,
          product_data: { name: payment.description },
        },
      }],
      success_url: `${clientOrigin}/payment/${encodeURIComponent(payment.payment_id)}/processing?provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientOrigin}/payment/${encodeURIComponent(payment.payment_id)}/processing?provider=stripe&cancelled=1`,
      }, { idempotencyKey: `payflow-${payment.payment_id}` });
    } catch (error) {
      console.error('Could not create Stripe Checkout session:', error.message);
      throw new HttpError(502, 'Unable to start Stripe Checkout right now. Please try again.');
    }
    if (!session.id || !session.url) throw new HttpError(502, 'Stripe did not return a Checkout URL.');
    db.prepare('UPDATE payments SET checkout_session_id = ?, checkout_url = ?, updated_at = datetime(\'now\') WHERE payment_id = ?')
      .run(session.id, session.url, payment.payment_id);
    return getPayment(payment.payment_id);
  }

  return {
    async start(payment) {
      if (payment.checkout_url) return payment;
      return createCheckoutSession(payment);
    },

    async refresh(paymentId) {
      const payment = getPayment(paymentId);
      if (!payment) throw new HttpError(404, 'Payment not found.');
      if (payment.provider !== 'stripe' || payment.status !== 'pending') return payment;
      if (!stripe || !payment.checkout_session_id) return payment;
      let session;
      try {
        session = await stripe.checkout.sessions.retrieve(payment.checkout_session_id);
      } catch (error) {
        console.error('Could not refresh Stripe Checkout session:', error.message);
        throw new HttpError(502, 'Unable to verify payment status with Stripe right now.');
      }
      const updated = updateFromStripeSession(session);
      if (!updated) throw new HttpError(502, 'Stripe returned a session that does not match this payment.');
      return updated;
    },

    handleWebhook(event) {
      const seen = db.prepare('SELECT event_id FROM stripe_webhook_events WHERE event_id = ?').get(event.id);
      if (seen) return { duplicate: true };
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded',
        'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type)) {
        updateFromStripeSession(event.data.object, event.type);
      }
      db.prepare('INSERT INTO stripe_webhook_events (event_id) VALUES (?)').run(event.id);
      return { duplicate: false };
    },
  };
}
