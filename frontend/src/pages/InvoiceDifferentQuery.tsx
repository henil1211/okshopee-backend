import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageSquareMore, LifeBuoy } from 'lucide-react';
import { useAuthStore } from '@/store';
import { Button } from '@/components/ui/button';
import MobileBottomNav from '@/components/MobileBottomNav';
import type { MarketplaceInvoice } from '@/types';

export default function InvoiceDifferentQuery() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, impersonatedUser, isAuthenticated } = useAuthStore();
  const displayUser = impersonatedUser || user;
  const queryInvoice = ((location.state as { invoice?: MarketplaceInvoice } | null) ?? null)?.invoice ?? null;

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (!queryInvoice) {
      navigate('/invoice-query', { replace: true });
    }
  }, [isAuthenticated, navigate, queryInvoice]);

  if (!displayUser || !queryInvoice) return null;

  return (
    <div className="min-h-screen bg-[#0a0e17] pb-24 md:pb-0">
      <header className="glass sticky top-0 z-50 border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="min-h-16 py-2 sm:py-0 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/invoice-query', { state: { invoice: queryInvoice } })}
                className="text-white/60 hover:text-white"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <p className="text-white font-semibold">I have a different query.</p>
                <p className="text-xs text-white/50">{queryInvoice.retailerName}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div
          className="relative overflow-hidden rounded-[28px] p-6 sm:p-8"
          style={{ background: 'linear-gradient(180deg, #111827 0%, #0d1117 100%)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(17,139,221,0.18),transparent_30%),radial-gradient(circle_at_top_left,rgba(168,85,247,0.14),transparent_28%)]" />
          <div className="relative">
            <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-[28px] border border-violet-400/20 bg-violet-400/10 text-violet-300 shadow-lg shadow-violet-500/10">
              <MessageSquareMore className="h-11 w-11" />
            </div>

            <div className="mt-6 text-center">
              <h1 className="text-3xl font-black tracking-tight text-white">Need help with something else?</h1>
              <div className="mx-auto mt-4 max-w-2xl space-y-4 text-base leading-8 text-white/75 sm:text-lg">
                <p>
                  If your issue is different from the options shown here, you can submit it through the Support Ticket section on the website with complete details.
                </p>
                <p>
                  Please mention your concern clearly and attach any relevant screenshot or order details so our team can review it properly and respond faster.
                </p>
              </div>
            </div>

            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button
                onClick={() => navigate('/support')}
                className="h-12 rounded-xl bg-gradient-to-r from-[#118bdd] to-[#6366f1] px-8 text-white hover:opacity-95"
              >
                Open Support Tickets
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/e-commerce?tab=my-rewards')}
                className="h-12 rounded-xl border-white/15 bg-white/[0.04] px-8 text-white hover:bg-white/[0.08]"
              >
                Back To Order Details
              </Button>
            </div>

            <div className="mt-10 rounded-2xl border border-violet-400/15 bg-violet-500/10 p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-400/15 text-violet-300">
                  <LifeBuoy className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-lg font-bold text-white">Helpful Tip</p>
                  <p className="mt-1 text-sm leading-6 text-violet-100/80">
                    Use the support ticket option for custom issues, follow-ups, or anything that does not fit the standard invoice query categories.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <MobileBottomNav />
    </div>
  );
}
