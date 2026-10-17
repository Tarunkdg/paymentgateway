import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CircleDollarSign, LogOut, ShieldCheck, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { api, formatMoney, getErrorMessage } from '../services/api';
import { Loading, Notice, PageHeading, StatusBadge } from '../components/Layout';

export function AdminLogin() {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { data } = await api.post('/auth/login', credentials);
      localStorage.setItem('adminToken', data.token);
      localStorage.setItem('adminName', data.admin.name);
      navigate('/admin', { replace: true });
    } catch (requestError) { setError(getErrorMessage(requestError)); }
    finally { setBusy(false); }
  }
  return <div className="login-page"><div className="login-card panel"><span className="login-icon"><ShieldCheck size={22} /></span><p className="eyebrow">ADMINISTRATION</p><h1>Welcome back</h1><p className="page-description">Sign in to monitor demo payment activity.</p>{error && <Notice tone="error">{error}</Notice>}<form onSubmit={submit}><label className="field">Email address<input type="email" required autoComplete="username" value={credentials.email} onChange={(event) => setCredentials({ ...credentials, email: event.target.value })} /></label><label className="field">Password<input type="password" required autoComplete="current-password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} /></label><button className="button button-primary button-full" disabled={busy}>{busy ? 'Signing in…' : <>Sign in to dashboard <ArrowRight size={16} /></>}</button></form><div className="login-info">Use the administrator credentials configured in <code>server/.env</code>.</div><Link className="back-link" to="/"><span>←</span> Back to overview</Link></div></div>;
}

export function AdminDashboard() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [payments, setPayments] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    Promise.all([api.get('/admin/dashboard'), api.get('/payments', { params: { limit: 8 } })])
      .then(([stats, rows]) => { if (active) { setDashboard(stats.data.dashboard); setPayments(rows.data.payments); } })
      .catch((requestError) => { if (active) { setError(getErrorMessage(requestError)); if (requestError.response?.status === 401) { localStorage.removeItem('adminToken'); navigate('/admin/login', { replace: true }); } } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [navigate]);
  function signOut() { localStorage.removeItem('adminToken'); localStorage.removeItem('adminName'); navigate('/admin/login'); }
  if (loading) return <div className="content-page"><Loading label="Loading admin dashboard…" /></div>;
  if (error) return <div className="content-page"><Notice tone="error">{error}</Notice></div>;
  const stats = [
    { title: 'Total transactions', value: dashboard.total_transactions, icon: CircleDollarSign, tone: 'blue', note: 'All payment attempts' },
    { title: 'Successful payments', value: dashboard.successful_payments || 0, icon: TrendingUp, tone: 'green', note: 'Simulator + Stripe test' },
    { title: 'Failed / cancelled', value: dashboard.failed_payments || 0, icon: TrendingDown, tone: 'orange', note: 'Unsuccessful attempts' },
    { title: 'Pending payments', value: dashboard.pending_payments || 0, icon: Wallet, tone: 'purple', note: 'Awaiting completion' },
  ];
  return <div className="content-page admin-page"><div className="admin-topline"><div className="admin-welcome"><span className="admin-avatar">{(localStorage.getItem('adminName') || 'A')[0]}</span><span><b>{localStorage.getItem('adminName') || 'Administrator'}</b><small>Payment operations</small></span></div><div><span className="demo-tag"><span /> TEST MODE</span><button className="signout-button" onClick={signOut}><LogOut size={15} /> Sign out</button></div></div>
    <PageHeading eyebrow="ADMIN DASHBOARD" title="Payment overview" description="A live snapshot of simulator and Stripe test-mode activity." />
    <div className="stat-grid">{stats.map(({ title, value, icon: Icon, tone, note }) => <article className="stat-card panel" key={title}><div className="stat-top"><span>{title}</span><span className={`stat-icon ${tone}`}><Icon size={18} /></span></div><strong>{value.toLocaleString()}</strong><small>{note}</small></article>)}</div>
    <div className="admin-collected panel"><div className="collected-icon"><CircleDollarSign size={20} /></div><div><span>Successful payment total <i>TEST DATA</i></span><b>{formatMoney(dashboard.total_collected)}</b><small>Local simulation + Stripe test mode · no live funds</small></div></div>
    <section className="panel transaction-panel"><div className="table-heading"><div><h2>Recent transactions</h2><p>Latest demo payment activity.</p></div><Link className="text-link" to="/history">View all <ArrowRight size={14} /></Link></div>{payments.length ? <div className="table-scroll"><table><thead><tr><th>TRANSACTION</th><th>CUSTOMER</th><th>AMOUNT</th><th>STATUS</th><th /></tr></thead><tbody>{payments.map((payment) => <tr key={payment.payment_id}><td><Link className="transaction-id" to={`/transactions/${payment.transaction_id}`}>{payment.transaction_id}<small>{payment.order_number}</small></Link></td><td><b>{payment.customer_name}</b><small className="table-sub">{payment.customer_email}</small></td><td className="amount-cell">{formatMoney(payment.amount)}</td><td><StatusBadge status={payment.status} /></td><td><Link className="row-arrow" to={`/transactions/${payment.transaction_id}`} aria-label={`View ${payment.transaction_id}`}><ArrowRight size={15} /></Link></td></tr>)}</tbody></table></div> : <div className="admin-empty">No payments yet. <Link to="/checkout">Create a test transaction <ArrowRight size={14} /></Link></div>}</section>
  </div>;
}
