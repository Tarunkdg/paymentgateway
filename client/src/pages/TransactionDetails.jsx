import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, ExternalLink } from 'lucide-react';
import { api, formatMoney, getErrorMessage } from '../services/api';
import { Loading, Notice, PageHeading, StatusBadge } from '../components/Layout';

export default function TransactionDetails() {
  const { transactionId } = useParams();
  const [transaction, setTransaction] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api.get(`/transactions/${transactionId}`).then(({ data }) => { if (active) setTransaction(data.transaction); })
      .catch((requestError) => { if (active) setError(getErrorMessage(requestError)); });
    return () => { active = false; };
  }, [transactionId]);
  if (error) return <div className="content-page"><Notice tone="error">{error}</Notice><Link className="text-link" to="/history">Back to history</Link></div>;
  if (!transaction) return <div className="content-page"><Loading label="Loading transaction…" /></div>;
  return <div className="content-page"><PageHeading eyebrow="TRANSACTION DETAILS" title="Payment record" description="A complete view of this test-mode payment." action={<Link className="button button-secondary" to="/history"><ArrowLeft size={14} /> All transactions</Link>} />
    <div className="details-layout"><section className="panel detail-card"><div className="detail-status"><StatusBadge status={transaction.status} /><span>Updated {new Date(transaction.updated_at).toLocaleString()}</span></div><div className="detail-total"><span>Amount</span><b>{formatMoney(transaction.amount, transaction.currency)}</b></div><div className="detail-group"><h3>Payment information</h3><Detail label="Transaction ID" value={transaction.transaction_id} /><Detail label="Payment ID" value={transaction.payment_id} /><Detail label="Order ID" value={transaction.order_number} /><Detail label="Payment method" value={transaction.payment_method.replaceAll('_', ' ')} /><Detail label="Provider" value={transaction.provider === 'stripe' ? 'Stripe test checkout' : 'Local simulator'} /><Detail label="Created" value={new Date(transaction.created_at).toLocaleString()} /></div>{transaction.failure_reason && <Notice tone="error">{transaction.failure_reason}</Notice>}<div className="detail-actions"><button className="button button-primary" onClick={() => window.open(`${api.defaults.baseURL}/transactions/${transaction.transaction_id}/receipt`, '_blank', 'noopener,noreferrer')}><Download size={16} /> Open receipt</button><Link className="button button-secondary" to={`/payment/${transaction.payment_id}/result`}>View payment result <ExternalLink size={15} /></Link></div></section>
    <aside className="panel detail-card"><div className="detail-group"><h3>Order & customer</h3><Detail label="Product" value={transaction.description} /><Detail label="Customer" value={transaction.customer_name} /><Detail label="Email" value={transaction.customer_email} /><Detail label="Mobile" value={transaction.customer_mobile} /></div><Notice tone="info">{transaction.provider === 'stripe' ? 'Stripe test transaction only. No live money was transferred.' : 'Simulated transaction only. No money was transferred.'}</Notice></aside></div>
  </div>;
}

function Detail({ label, value }) { return <div className="detail-row"><span>{label}</span><b>{value}</b></div>; }
