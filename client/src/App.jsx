import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import Home from './pages/Home';
import Checkout from './pages/Checkout';
import Processing from './pages/Processing';
import PaymentResult from './pages/PaymentResult';
import History from './pages/History';
import TransactionDetails from './pages/TransactionDetails';
import { AdminDashboard, AdminLogin } from './pages/Admin';

function ProtectedAdmin() {
  return localStorage.getItem('adminToken') ? <AdminDashboard /> : <Navigate to="/admin/login" replace />;
}

export default function App() {
  return <BrowserRouter><Layout><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/checkout" element={<Checkout />} />
    <Route path="/payment/:paymentId/processing" element={<Processing />} />
    <Route path="/payment/:paymentId/result" element={<PaymentResult />} />
    <Route path="/history" element={<History />} />
    <Route path="/transactions/:transactionId" element={<TransactionDetails />} />
    <Route path="/admin/login" element={<AdminLogin />} />
    <Route path="/admin" element={<ProtectedAdmin />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Layout></BrowserRouter>;
}
