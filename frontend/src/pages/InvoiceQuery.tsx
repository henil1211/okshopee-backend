import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, HelpCircle } from 'lucide-react';
import { useAuthStore } from '@/store';
import { Button } from '@/components/ui/button';
import MobileBottomNav from '@/components/MobileBottomNav';
import type { MarketplaceInvoice } from '@/types';

const INVOICE_QUERY_OPTIONS = [
  'My Profit has tracked incorrectly',
  'Why is my Profit Pending?',
  'How can I Withdraw my Profit?',
  'I have a different query.'
] as const;

export default function InvoiceQuery() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, impersonatedUser, isAuthenticated } = useAuthStore();
  const displayUser = impersonatedUser || user;
  const queryInvoice = ((location.state as { invoice?: MarketplaceInvoice } | null) ?? null)?.invoice ?? null;

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  if (!displayUser) return null;

  return (
    <div className="min-h-screen bg-[#0a0e17] pb-24 md:pb-0">
      <header className="glass sticky top-0 z-50 border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="min-h-16 py-2 sm:py-0 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/e-commerce')}
                className="text-white/60 hover:text-white"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#118bdd] to-[#6366f1] flex items-center justify-center">
                <HelpCircle className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-white font-semibold">Raise Query</p>
                <p className="text-xs text-white/50">
                  {queryInvoice?.retailerName || 'Invoice Support'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div
          className="relative overflow-hidden rounded-[28px] p-6 sm:p-8"
          style={{ background: 'linear-gradient(180deg, #111827 0%, #0d1117 100%)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(17,139,221,0.18),transparent_30%),radial-gradient(circle_at_top_left,rgba(99,102,241,0.14),transparent_28%)]" />
          <div className="relative">
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#84c5ff]">
                Invoice Query
              </p>
              <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                What is your question about?
              </h1>
              <p className="text-sm text-white/55">
                Select one option below to continue with your invoice query.
              </p>
              {queryInvoice && (
                <div className="mt-2 inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/65">
                  <span>{queryInvoice.retailerName}</span>
                  {queryInvoice.orderId && <span className="text-white/35">•</span>}
                  {queryInvoice.orderId && <span>Order ID: {queryInvoice.orderId}</span>}
                </div>
              )}
            </div>

            <div className="mt-6 border-b border-dashed border-white/10" />

            <div className="mt-6 overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03]">
              {INVOICE_QUERY_OPTIONS.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    if (index === 0) {
                      navigate('/invoice-query/profit-tracked-incorrectly', { state: { invoice: queryInvoice } });
                    } else if (index === 1) {
                      navigate('/invoice-query/why-profit-pending', { state: { invoice: queryInvoice } });
                    } else if (index === 2) {
                      navigate('/invoice-query/how-to-withdraw-profit', { state: { invoice: queryInvoice } });
                    } else if (index === 3) {
                      navigate('/invoice-query/different-query', { state: { invoice: queryInvoice } });
                    }
                  }}
                  className={`w-full px-5 py-4 text-left text-[15px] font-medium text-white/80 transition-colors hover:bg-white/[0.04] hover:text-white sm:px-6 sm:py-5 sm:text-[17px] ${index < INVOICE_QUERY_OPTIONS.length - 1 ? 'border-b border-white/8' : ''}`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>

      <MobileBottomNav />
    </div>
  );
}
