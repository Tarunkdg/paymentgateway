import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, ArrowUpRight, Search, SlidersHorizontal } from 'lucide-react';
import { api, formatMoney, getErrorMessage } from '../services/api';
import { Loading, Notice, PageHeading, StatusBadge } from '../components/Layout';

export default function History() {
  const [payments, setPayments] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ field: 'created_at', direction: 'desc' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get('/payments', { params: { page: pagination.page, limit: 10, status: status || undefined, search: query || undefined, sort: sort.field, direction: sort.direction } })
      .then(({ data }) => { if (active) { setPayments(data.payments); setPagination((prev) => ({ ...data.pagination, page: prev.page })); setError(''); } })
      .catch((requestError) => { if (active) setError(getErrorMessage(requestError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [pagination.page, status, query, sort]);

  function filterStatus(value) { setStatus(value); setPagination((prev) => ({ ...prev, page: 1 })); }
  function changeSearch(value) { setSearch(value); setPagination((prev) => ({ ...prev, page: 1 })); }
  function changeSort(field) {
    setSort((current) => ({ field, direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc' }));
    setPagination((prev) => ({ ...prev, page: 1 }));
  }
  function sortIcon(field) {
    if (sort.field !== field) return <ArrowUpDown size={11} />;
    return sort.direction === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />;
  }

  return <div className="content-page">
    <PageHeading eyebrow="PAYMENT ACTIVITY" title="Transaction history" description="Search and review simulator and Stripe test-mode payments." action={<span className="history-count">{pagination.total} transactions</span>} />
    <div className="history-toolbar panel"><label className="search-box"><Search size={17} /><input placeholder="Search name, email, order or transaction ID…" value={search} onChange={(event) => changeSearch(event.target.value)} /></label><label className="filter-select"><SlidersHorizontal size={15} /><select value={status} onChange={(event) => filterStatus(event.target.value)}><option value="">All statuses</option><option value="success">Successful</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option><option value="pending">Pending</option></select></label></div>
    <section className="panel transaction-panel"><div className="table-heading"><div><h2>All transactions</h2><p>Most recent payments appear first.</p></div><span className="demo-tag"><span /> TEST DATA</span></div>
      {error && <Notice tone="error">{error}</Notice>}
      {loading ? <Loading label="Loading transactions…" /> : payments.length === 0 ? <div className="empty-state"><span className="empty-icon"><Search size={21} /></span><h3>No transactions found</h3><p>Try adjusting your search, or start a new demo payment.</p><Link className="button button-primary" to="/checkout">Create a demo payment <ArrowRight size={15} /></Link></div> :
        <div className="table-scroll"><table><thead><tr><th>TRANSACTION</th><th aria-sort={sort.field === 'customer_name' ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button className="sort-button" onClick={() => changeSort('customer_name')}>CUSTOMER {sortIcon('customer_name')}</button></th><th>METHOD / PROVIDER</th><th aria-sort={sort.field === 'amount' ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button className="sort-button" onClick={() => changeSort('amount')}>AMOUNT {sortIcon('amount')}</button></th><th>STATUS</th><th aria-sort={sort.field === 'created_at' ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button className="sort-button" onClick={() => changeSort('created_at')}>DATE {sortIcon('created_at')}</button></th><th /></tr></thead><tbody>{payments.map((payment) => <tr key={payment.payment_id}><td><Link className="transaction-id" to={`/transactions/${payment.transaction_id}`}>{payment.transaction_id}<small>{payment.order_number}</small></Link></td><td><b>{payment.customer_name}</b><small className="table-sub">{payment.customer_email}</small></td><td><span className="method-chip">{payment.provider === 'stripe' ? 'Stripe test · card' : payment.payment_method.replaceAll('_', ' ')}</span></td><td className="amount-cell">{formatMoney(payment.amount, payment.currency)}</td><td><StatusBadge status={payment.status} /></td><td className="date-cell">{new Date(payment.created_at).toLocaleDateString()}</td><td><Link className="row-arrow" to={`/transactions/${payment.transaction_id}`} aria-label={`View ${payment.transaction_id}`}><ArrowUpRight size={16} /></Link></td></tr>)}</tbody></table></div>}
      {!loading && pagination.pages > 1 && <div className="pagination"><span>Page {pagination.page} of {pagination.pages}</span><div><button disabled={pagination.page <= 1} onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}>Previous</button><button disabled={pagination.page >= pagination.pages} onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}>Next <ArrowRight size={14} /></button></div></div>}
    </section>
    <div className="history-disclaimer"><span>ⓘ</span> Stripe entries use test mode only. No live payments or fund transfers are made.</div>
  </div>;
}
