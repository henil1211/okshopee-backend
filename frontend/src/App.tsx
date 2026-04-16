// App Component
import { useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import ThemeToggle from '@/components/ThemeToggle';
import SyncStatusBadge from '@/components/SyncStatusBadge';
import Database from '@/db';
import { useAuthStore, useNotificationStore } from '@/store';

// Pages
import Landing from '@/pages/Landing';
import Login from '@/pages/Login';
import ForgotPassword from '@/pages/ForgotPassword';
import Register from '@/pages/Register';
import Dashboard from '@/pages/Dashboard';
import Matrix from '@/pages/Matrix';
import Deposit from '@/pages/Deposit';
import FundTransfer from '@/pages/FundTransfer';
import Withdraw from '@/pages/Withdraw';
import Transactions from '@/pages/Transactions';
import PinWallet from '@/pages/PinWallet';
import Profile from '@/pages/Profile';
import CreateId from '@/pages/CreateId';
import Admin from '@/pages/Admin';
import Ecommerce from '@/pages/Ecommerce';
import AboutUs from '@/pages/AboutUs';
import ContactUs from '@/pages/ContactUs';
import Support from '@/pages/Support';
import Notifications from '@/pages/Notifications';
import PrivacyPolicy from '@/pages/PrivacyPolicy';
import TermsAndConditions from '@/pages/TermsAndConditions';
import Disclaimer from '@/pages/Disclaimer';
import Referrals from '@/pages/Referrals';
import RefundPolicy from '@/pages/RefundPolicy';
import DummyMail from '@/pages/DummyMail';
import InvoiceQuery from '@/pages/InvoiceQuery';
import InvoiceProfitTrackedIncorrectly from '@/pages/InvoiceProfitTrackedIncorrectly';
import InvoiceWhyPending from '@/pages/InvoiceWhyPending';
import InvoiceHowToWithdrawProfit from '@/pages/InvoiceHowToWithdrawProfit';
import InvoiceDifferentQuery from '@/pages/InvoiceDifferentQuery';

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    const scrollToTop = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };
    scrollToTop();
    requestAnimationFrame(scrollToTop);
  }, [pathname]);

  return null;
}

function AutoRefreshAnnouncements() {
  const location = useLocation();
  const { user, impersonatedUser, isAuthenticated } = useAuthStore();
  const { loadNotifications } = useNotificationStore();
  const lastRunRef = useRef<string>('');
  const displayUser = impersonatedUser || user;

  useEffect(() => {
    if (!isAuthenticated || !displayUser) return;
    const key = `${location.pathname}:${displayUser.id}`;
    if (lastRunRef.current === key) return;
    lastRunRef.current = key;

    let active = true;
    const refresh = async () => {
      try {
        await Database.hydrateFromServer({
          keys: ['mlm_notifications', 'mlm_announcements'],
          strict: false,
          maxAttempts: 2,
          timeoutMs: 10000,
          retryDelayMs: 800
        });
      } catch {
        // Best-effort refresh only.
      }
      if (!active) return;
      loadNotifications(displayUser.id);
    };
    void refresh();

    return () => {
      active = false;
    };
  }, [isAuthenticated, displayUser, loadNotifications, location.pathname]);

  return null;
}

function SessionAccessGuard() {
  const { isAuthenticated, enforceSessionAccess } = useAuthStore();
  const lastLogoutReasonRef = useRef('');

  useEffect(() => {
    if (!isAuthenticated) {
      lastLogoutReasonRef.current = '';
      return;
    }

    let mounted = true;

    const runSessionCheck = async (forceServerCheck = false) => {
      const result = await enforceSessionAccess({ forceServerCheck });
      if (!mounted) return;
      if (!result.active && result.message && lastLogoutReasonRef.current !== result.message) {
        lastLogoutReasonRef.current = result.message;
        toast.error(result.message);
      }
    };

    void runSessionCheck(true);

    const intervalId = window.setInterval(() => {
      void runSessionCheck(true);
    }, 10000);

    const onWindowFocus = () => {
      void runSessionCheck(true);
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        void runSessionCheck(true);
      }
    };

    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    const unsubscribeSync = Database.subscribeRemoteSyncStatus((status) => {
      if (status.state === 'synced') {
        void runSessionCheck(false);
      }
    });

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribeSync();
    };
  }, [isAuthenticated, enforceSessionAccess]);

  return null;
}

function App() {
  return (
    <Router>
      <ScrollToTop />
      <SessionAccessGuard />
      <AutoRefreshAnnouncements />
      <Toaster position="top-center" />
      <ThemeToggle />
      <SyncStatusBadge />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/matrix" element={<Matrix />} />
        <Route path="/deposit" element={<Deposit />} />
        <Route path="/fund-transfer" element={<FundTransfer />} />
        <Route path="/withdraw" element={<Withdraw />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/pin-wallet" element={<PinWallet />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/referrals" element={<Referrals />} />
        <Route path="/create-id" element={<CreateId />} />
        <Route path="/e-commerce" element={<Ecommerce />} />
        <Route path="/invoice-query" element={<InvoiceQuery />} />
        <Route path="/invoice-query/profit-tracked-incorrectly" element={<InvoiceProfitTrackedIncorrectly />} />
        <Route path="/invoice-query/why-profit-pending" element={<InvoiceWhyPending />} />
        <Route path="/invoice-query/how-to-withdraw-profit" element={<InvoiceHowToWithdrawProfit />} />
        <Route path="/invoice-query/different-query" element={<InvoiceDifferentQuery />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/about-us" element={<AboutUs />} />
        <Route path="/contact-us" element={<ContactUs />} />
        <Route path="/support" element={<Support />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms-and-conditions" element={<TermsAndConditions />} />
        <Route path="/disclaimer" element={<Disclaimer />} />
        <Route path="/refund-policy" element={<RefundPolicy />} />
        <Route path="/dummy-mail" element={<DummyMail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
