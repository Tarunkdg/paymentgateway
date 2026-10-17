import { Link, NavLink } from 'react-router-dom';
import { ArrowUpRight, CreditCard, History, ShieldCheck } from 'lucide-react';

export function Layout({ children }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand"><span className="brand-mark"><CreditCard size={19} /></span>payflow<span className="brand-dot">.</span></Link>
        <nav className="main-nav" aria-label="Main navigation">
          <NavLink to="/" end>Overview</NavLink>
          <NavLink to="/history"><History size={15} /> Transactions</NavLink>
          <NavLink to="/admin/login"><ShieldCheck size={15} /> Admin</NavLink>
        </nav>
        <div className="demo-pill"><span /> Demo environment</div>
      </header>
      <main>{children}</main>
      <footer className="footer"><span>Payflow Demo · Simulator + Stripe test checkout</span><span>No live money moves <ArrowUpRight size={13} /></span></footer>
    </div>
  );
}

export function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action}</div>;
}

export function Notice({ children, tone = 'info' }) {
  return <div className={`notice notice-${tone}`} role="status">{children}</div>;
}

export function StatusBadge({ status }) {
  const label = status === 'success' ? 'Successful' : status === 'failed' ? 'Failed' : status === 'cancelled' ? 'Cancelled' : 'Pending';
  return <span className={`status-badge status-${status}`}>{label}</span>;
}

export function Loading({ label = 'Loading your payment details…' }) {
  return <div className="loading-state"><span className="spinner" /><span>{label}</span></div>;
}
