import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Download, ExternalLink, RotateCcw, ShieldCheck } from 'lucide-react';
import { api, formatMoney, getErrorMessage } from '../services/api';
import { Loading, Notice, StatusBadge } from '../components/Layout';

export default function PaymentResult() {
  const { paymentId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get(`/payments/${paymentId}`).then(({ data }) => { if (active) setPayment(data.payment); })
      .catch((requestError) => { if (active) setError(getErrorMessage(requestError)); });
    return () => { active = false; };
  }, [paymentId]);

  if (error) return <div className="content-page"><Notice tone="error">{error}</Notice><Link className="text-link" to="/history">Back to transactions</Link></div>;
  if (!payment) return <div className="content-page"><Loading label="Loading transaction…" /></div>;

  const success = payment.status === 'success';
  const pending = payment.status === 'pending';
  const stripe = payment.provider === 'stripe';
  const wasCancelled = location.state?.wasCancelled;
  const heading = success ? (stripe ? 'Stripe test payment confirmed' : 'Payment simulated successfully') : pending ? (wasCancelled ? 'Stripe checkout was not completed' : 'Payment is still processing') : payment.status === 'cancelled' ? 'Payment cancelled' : 'Payment was unsuccessful';
  const description = success
    ? (stripe ? 'Stripe confirmed this test payment. It did not move live funds.' : 'This is a simulated result. No funds were transferred.')
    : payment.failure_reason || (pending ? 'The payment has not been finalized. You can resume the hosted checkout or check its status again.' : 'The payment was not completed.');
  function receipt() {
    window.open(`${api.defaults.baseURL}/transactions/${payment.transaction_id}/receipt`, '_blank', 'noopener,noreferrer');
  }
  function resumeCheckout() {
    if (payment.checkoutUrl) window.location.assign(payment.checkoutUrl);
  }

  return <div className="result-page">
    <div className={`result-card panel result-${payment.status}`}>
      <div className="result-icon">{success ? <span>✓</span> : pending ? <span className="spinner" /> : <span>!</span>}</div>
      <p className="eyebrow">{success ? 'PAYMENT CONFIRMED' : pending ? 'AWAITING UPDATE' : 'PAYMENT NOT COMPLETED'}</p>
      <h1>{heading}</h1>
      <p className="result-description">{description}</p>
      <div className="result-amount">{formatMoney(payment.amount, payment.currency)} <StatusBadge status={payment.status} /></div>
      <div className="result-details"><div><span>Transaction ID</span><b>{payment.transaction_id}</b></div><div><span>Order ID</span><b>{payment.order_number}</b></div><div><span>Date & time</span><b>{new Date(payment.created_at).toLocaleString()}</b></div><div><span>Payment method</span><b>{payment.payment_method.replaceAll('_', ' ')}</b></div><div><span>Provider</span><b>{stripe ? 'Stripe test checkout' : 'Local simulator'}</b></div></div>
      <Notice tone="info"><ShieldCheck size={15} /> {stripe ? 'Stripe test mode only. No live money was transferred.' : 'Simulated demo transaction only. No real payment network was used.'}</Notice>
      <div className="result-actions">{success && <button className="button button-primary" onClick={receipt}><Download size={16} /> Print / download receipt</button>}{!success && !pending && <Link className="button button-primary" to="/checkout"><RotateCcw size={16} /> Try another payment</Link>}{pending && stripe && payment.checkoutUrl && <button className="button button-primary" onClick={resumeCheckout}><ExternalLink size={16} /> Resume Stripe Checkout</button>}{pending && stripe && <button className="button button-secondary" onClick={() => navigate(`/payment/${paymentId}/processing?provider=stripe`)}><ExternalLink size={16} /> Check payment status</button>}{pending && !stripe && <button className="button button-primary" onClick={() => navigate('/history')}><ExternalLink size={16} /> View status in history</button>}<Link className="button button-secondary" to="/history">Transaction history <ArrowRight size={15} /></Link></div>
      <Link className="result-back" to="/"><ArrowLeft size={14} /> Return to overview</Link>
    </div>
  </div>;
}
