import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, CreditCard, Landmark, Smartphone, WalletCards } from 'lucide-react';
import { api, formatMoney, getErrorMessage } from '../services/api';
import { Notice, PageHeading } from '../components/Layout';

const products = [
  { id: 'starter', name: 'Demo Starter Kit', description: 'A sample product for the payment lifecycle demo.', amount: 129900, icon: '✦' },
  { id: 'pro', name: 'Demo Pro Bundle', description: 'An expanded sample bundle for checkout testing.', amount: 249900, icon: '◈' },
];
const methods = [
  { id: 'upi', label: 'UPI', detail: 'GPay, PhonePe, BHIM', icon: Smartphone },
  { id: 'credit_card', label: 'Credit card', detail: 'No card details needed', icon: CreditCard },
  { id: 'debit_card', label: 'Debit card', detail: 'No card details needed', icon: CreditCard },
  { id: 'net_banking', label: 'Net banking', detail: 'Simulated bank flow', icon: Landmark },
  { id: 'wallet', label: 'Wallet', detail: 'Demo wallet flow', icon: WalletCards },
];

export default function Checkout() {
  const navigate = useNavigate();
  const [customer, setCustomer] = useState({ customerName: '', customerEmail: '', customerMobile: '' });
  const [productId, setProductId] = useState('starter');
  const [method, setMethod] = useState('upi');
  const [provider, setProvider] = useState('simulated');
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [scenario, setScenario] = useState('success');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const product = products.find((item) => item.id === productId);
  const update = (event) => setCustomer({ ...customer, [event.target.name]: event.target.value });

  useEffect(() => {
    api.get('/config').then(({ data }) => setStripeEnabled(data.stripeTestModeEnabled))
      .catch((requestError) => setError(getErrorMessage(requestError)));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data: orderData } = await api.post('/orders', { ...customer, productId });
      const idempotencyKey = crypto.randomUUID();
      const { data: paymentData } = await api.post('/payments/initiate', { orderId: orderData.order.id, method, provider, idempotencyKey });
      if (provider === 'stripe') {
        if (!paymentData.payment.checkoutUrl) throw new Error('Stripe did not provide a Checkout link.');
        window.location.assign(paymentData.payment.checkoutUrl);
        return;
      }
      navigate(`/payment/${paymentData.payment.payment_id}/processing`, {
        state: { scenario, order: orderData.order, payment: paymentData.payment },
      });
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="content-page">
      <PageHeading eyebrow="CHECKOUT · TEST MODE" title="A better way to test payments." description="Use the local simulator or Stripe's hosted test checkout. Live charges are never enabled." />
      <div className="checkout-layout">
        <form className="panel checkout-form" onSubmit={submit}>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="form-section"><div className="step-heading"><span>01</span><div><h2>Your details</h2><p>Used only to label your sample order.</p></div></div>
            <div className="field-grid"><label className="field field-wide">Full name<input required name="customerName" value={customer.customerName} onChange={update} minLength="2" maxLength="100" placeholder="e.g. Alex Morgan" autoComplete="name" /></label><label className="field">Email address<input required type="email" name="customerEmail" value={customer.customerEmail} onChange={update} placeholder="alex@example.com" autoComplete="email" /></label><label className="field">Mobile number<input required type="tel" name="customerMobile" value={customer.customerMobile} onChange={update} pattern="\+?[0-9\s\-]{8,18}" placeholder="+91 98765 43210" autoComplete="tel" /></label></div>
          </div>
          <div className="form-section"><div className="step-heading"><span>02</span><div><h2>Choose a demo product</h2><p>Price is calculated and verified by the server.</p></div></div>
            <div className="product-options">{products.map((item) => <button className={`product-option ${productId === item.id ? 'selected' : ''}`} type="button" key={item.id} onClick={() => setProductId(item.id)}><span className="product-option-icon">{item.icon}</span><span className="product-option-copy"><b>{item.name}</b><small>{item.description}</small></span><strong>{formatMoney(item.amount)}</strong><span className="radio-mark">{productId === item.id && <Check size={12} />}</span></button>)}</div>
          </div>
          <div className="form-section"><div className="step-heading"><span>03</span><div><h2>Payment provider</h2><p>Choose local simulation or Stripe-hosted test checkout.</p></div></div>
            <div className="provider-grid">
              <button type="button" className={`provider-option ${provider === 'simulated' ? 'selected' : ''}`} onClick={() => setProvider('simulated')}><span className="provider-mark provider-sim-mark">◎</span><span><b>Local simulator</b><small>Choose a test outcome</small></span><span className="radio-mark">{provider === 'simulated' && <Check size={12} />}</span></button>
              <button type="button" className={`provider-option ${provider === 'stripe' ? 'selected' : ''}`} disabled={!stripeEnabled} onClick={() => { setProvider('stripe'); setMethod('credit_card'); }}><span className="provider-mark stripe-mark">S</span><span><b>Stripe test checkout</b><small>{stripeEnabled ? 'Hosted card form · test mode' : 'Configure Stripe test keys first'}</small></span><span className="radio-mark">{provider === 'stripe' && <Check size={12} />}</span></button>
            </div>
            {!stripeEnabled && <p className="stripe-setup-hint">To enable Stripe, add your Stripe <code>sk_test_…</code> key in <code>server/.env</code> and restart the API.</p>}
          </div>
          <div className="form-section"><div className="step-heading"><span>04</span><div><h2>Payment method</h2><p>{provider === 'stripe' ? 'Card details are entered only on Stripe-hosted checkout.' : 'Pick a method for the simulated checkout.'}</p></div></div>
            <div className="method-grid">{methods.map(({ id, label, detail, icon: Icon }) => <button type="button" className={`method-option ${method === id ? 'selected' : ''}`} disabled={provider === 'stripe' && id !== 'credit_card'} key={id} onClick={() => setMethod(id)}><span className="method-icon"><Icon size={18} /></span><span><b>{label}</b><small>{provider === 'stripe' && id === 'credit_card' ? 'Collected by Stripe Checkout' : detail}</small></span><span className="radio-mark">{method === id && <Check size={12} />}</span></button>)}</div>
          </div>
          {provider === 'simulated' && <div className="form-section scenario-section"><div className="step-heading"><span>05</span><div><h2>Test scenario</h2><p>Choose the result the simulator should return.</p></div></div>
            <div className="field"><label htmlFor="scenario">Simulated result</label><select id="scenario" value={scenario} onChange={(event) => setScenario(event.target.value)}><option value="success">Successful payment</option><option value="failure">Payment declined</option><option value="cancelled">Customer cancellation</option><option value="pending">Pending / processing</option></select></div>
          </div>}
          <div className="form-submit"><div className="safe-note"><span className="safe-icon"><Check size={13} /></span><span>{provider === 'stripe' ? 'Stripe test mode — never enter real card details.' : 'Safe demo — no financial credentials required.'}</span></div><button className="button button-primary button-pay" type="submit" disabled={busy || (provider === 'stripe' && !stripeEnabled)}> {busy ? <><span className="button-spinner" /> Creating order…</> : <>{provider === 'stripe' ? 'Continue to Stripe' : `Pay ${formatMoney(product.amount)}`} <ArrowRight size={16} /></>}</button></div>
          <button className="back-link" type="button" onClick={() => navigate('/')}><ArrowLeft size={14} /> Back to overview</button>
        </form>
        <aside className="order-summary panel"><div className="summary-top"><span>YOUR ORDER</span><span className="summary-edit"><Check size={12} /> Demo item</span></div><div className="summary-product"><div className="summary-product-icon">{product.icon}</div><div><b>{product.name}</b><p>{product.description}</p></div></div><div className="summary-divider" /><div className="summary-row"><span>Subtotal</span><span>{formatMoney(product.amount)}</span></div><div className="summary-row"><span>Taxes</span><span>Included</span></div><div className="summary-divider" /><div className="summary-row summary-total"><span>Total due</span><b>{formatMoney(product.amount)}</b></div><div className="summary-demo"><span>◎</span><span><b>{provider === 'stripe' ? 'Stripe test mode' : 'Simulation mode'}</b><small>{provider === 'stripe' ? 'Stripe test transactions only. No live charge will be made.' : 'This is not a real payment. No funds will be transferred.'}</small></span></div><div className="summary-methods"><span><Smartphone size={14} /> UPI</span><span><CreditCard size={14} /> Cards</span><span><WalletCards size={14} /> Wallets</span></div></aside>
      </div>
    </div>
  );
}
