import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check, CircleDollarSign, Fingerprint, RefreshCw, Shield, Zap } from 'lucide-react';

const features = [
  { icon: Shield, title: 'Built for safe testing', text: 'No real card data, PINs, or payment credentials are collected.' },
  { icon: RefreshCw, title: 'Full payment lifecycle', text: 'Try success, decline, cancellation, and pending outcomes.' },
  { icon: Fingerprint, title: 'Unique transaction trail', text: 'Explore order IDs, transaction history, and printable receipts.' },
];

export default function Home() {
  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-kicker"><span className="kicker-icon"><Zap size={14} /></span> PAYMENT INFRASTRUCTURE, MADE VISIBLE</div>
          <h1>Payments, without<br />the <span>guesswork.</span></h1>
          <p className="hero-description">Explore the complete payment journey in a safe, local demo. Create an order, test different outcomes, and see exactly what happens next.</p>
          <div className="hero-actions"><Link className="button button-primary" to="/checkout">Start a demo payment <ArrowRight size={17} /></Link><Link className="text-link" to="/history">View transaction history <ArrowUpRight size={15} /></Link></div>
          <div className="hero-points"><span><Check size={14} /> Server-priced orders</span><span><Check size={14} /> Simulated outcomes</span><span><Check size={14} /> No real money</span></div>
        </div>
        <div className="hero-visual">
          <div className="visual-glow" />
          <div className="checkout-preview">
            <div className="preview-head"><div><span className="mini-label">SECURE CHECKOUT</span><h3>Complete your order</h3></div><span className="preview-lock"><Shield size={17} /></span></div>
            <div className="preview-item"><span className="product-icon"><CircleDollarSign size={20} /></span><div><b>Demo Starter Kit</b><small>Digital sample product</small></div><strong>₹1,299</strong></div>
            <div className="preview-line" />
            <div className="preview-total"><span>Total due</span><b>₹1,299.00</b></div>
            <div className="preview-button"><span>Pay securely</span><ArrowRight size={15} /></div>
            <div className="preview-methods"><span>UPI</span><span>VISA</span><span>MC</span><span>WALLET</span></div>
            <div className="preview-note"><span className="note-dot" /> Test mode · No real transaction</div>
          </div>
          <div className="floating-chip chip-top"><span className="chip-check"><Check size={13} /></span><span><b>Order created</b><small>Server-verified amount</small></span></div>
          <div className="floating-chip chip-bottom"><span className="chip-bars">▮</span><span><b>Every outcome covered</b><small>Success · Failed · Pending</small></span></div>
        </div>
      </section>
      <section className="feature-section">
        <div className="section-heading"><div><p className="eyebrow">A COMPLETE SANDBOX</p><h2>Everything you need to explore</h2></div><span className="section-aside">A hands-on look at the payment lifecycle</span></div>
        <div className="feature-grid">{features.map(({ icon: Icon, title, text }, index) => <article className="feature-card" key={title}><span className="feature-icon"><Icon size={19} /></span><span className="feature-number">0{index + 1}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
      </section>
      <div className="safety-strip"><Shield size={16} /><span><b>Test mode only.</b> The local simulator and Stripe test checkout do not make live charges or transfer funds.</span><Link to="/checkout">Try the demo <ArrowRight size={14} /></Link></div>
    </div>
  );
}
