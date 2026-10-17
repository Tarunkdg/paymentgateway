import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { api, getErrorMessage } from '../services/api';
import { Notice } from '../components/Layout';

export default function Processing() {
  const { paymentId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isStripe = new URLSearchParams(location.search).get('provider') === 'stripe';
  const wasCancelled = new URLSearchParams(location.search).get('cancelled') === '1';
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function process() {
      try {
        if (isStripe) {
          let payment;
          for (let attempt = 0; attempt < (wasCancelled ? 1 : 8); attempt += 1) {
            const { data } = await api.get(`/payments/${paymentId}`);
            payment = data.payment;
            if (payment.status !== 'pending') break;
            if (attempt < 7 && !wasCancelled) await new Promise((resolve) => setTimeout(resolve, 1500));
          }
          if (active) navigate(`/payment/${paymentId}/result`, { replace: true, state: { payment, wasCancelled } });
          return;
        }
        const scenario = location.state?.scenario || 'success';
        await new Promise((resolve) => setTimeout(resolve, 900));
        await api.post(`/payments/${paymentId}/simulate`, { outcome: scenario });
        const { data } = await api.get(`/payments/${paymentId}`);
        if (active) navigate(`/payment/${paymentId}/result`, { replace: true, state: { payment: data.payment } });
      } catch (requestError) {
        if (active) setError(getErrorMessage(requestError));
      }
    }
    process();
    return () => { active = false; };
  }, [paymentId, location.state, navigate, isStripe, wasCancelled]);

  async function reloadStatus() {
    try {
      const { data } = await api.get(`/payments/${paymentId}`);
      navigate(`/payment/${paymentId}/result`, { state: { payment: data.payment } });
    } catch (requestError) { setError(getErrorMessage(requestError)); }
  }

  return <div className="processing-page"><div className="processing-card panel"><div className="processing-art"><span className="processing-ring" /><span className="processing-center"><ShieldCheck size={27} /></span></div>{error ? <><h1>We couldn't verify your payment</h1><Notice tone="error">{error}</Notice><button className="button button-primary" onClick={reloadStatus}>Check payment status</button><Link className="text-link" to="/history">View transactions</Link></> : <><p className="eyebrow">{isStripe ? 'STRIPE TEST MODE · NO LIVE CHARGE' : 'TEST MODE · NO REAL PAYMENT'}</p><h1>{isStripe ? 'Confirming your Stripe payment' : 'Simulating your payment'}</h1><p className="page-description">{isStripe ? 'We are checking the payment status directly with Stripe. This can take a few seconds.' : 'Your request is being processed by the local demo service. Please keep this page open for a moment.'}</p><div className="processing-progress"><span /></div><div className="processing-caption"><span className="spinner" /> {wasCancelled ? 'Checking whether the checkout session expired…' : 'Please keep this page open for a moment'}</div></>}</div><p className="processing-footnote"><ShieldCheck size={14} /> Card details are entered on Stripe Checkout and are never stored by this demo.</p></div>;
}
