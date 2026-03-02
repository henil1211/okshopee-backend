// App Component
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';

// Pages
import Landing from '@/pages/Landing';
import Login from '@/pages/Login';
import ForgotPassword from '@/pages/ForgotPassword';
import Register from '@/pages/Register';
import Dashboard from '@/pages/Dashboard';
import Matrix from '@/pages/Matrix';
import Deposit from '@/pages/Deposit';
import Transactions from '@/pages/Transactions';
import PinWallet from '@/pages/PinWallet';
import Profile from '@/pages/Profile';
import CreateId from '@/pages/CreateId';
import Admin from '@/pages/Admin';
import Ecommerce from '@/pages/Ecommerce';
import AboutUs from '@/pages/AboutUs';
import ContactUs from '@/pages/ContactUs';
import PrivacyPolicy from '@/pages/PrivacyPolicy';
import TermsAndConditions from '@/pages/TermsAndConditions';
import Disclaimer from '@/pages/Disclaimer';
import RefundPolicy from '@/pages/RefundPolicy';

function App() {
  return (
    <Router>
      <Toaster 
        position="top-right" 
        toastOptions={{
          style: {
            background: '#111827',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.1)'
          }
        }}
      />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/matrix" element={<Matrix />} />
        <Route path="/deposit" element={<Deposit />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/pin-wallet" element={<PinWallet />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/create-id" element={<CreateId />} />
        <Route path="/e-commerce" element={<Ecommerce />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/about-us" element={<AboutUs />} />
        <Route path="/contact-us" element={<ContactUs />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms-and-conditions" element={<TermsAndConditions />} />
        <Route path="/disclaimer" element={<Disclaimer />} />
        <Route path="/refund-policy" element={<RefundPolicy />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
