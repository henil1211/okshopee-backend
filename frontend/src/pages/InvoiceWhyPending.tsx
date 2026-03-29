import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock3, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/store';
import { Button } from '@/components/ui/button';
import MobileBottomNav from '@/components/MobileBottomNav';
import type { MarketplaceInvoice } from '@/types';

export default function InvoiceWhyPending() {
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
                <p className="text-white font-semibold">Why is my Profit Pending?</p>
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
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(17,139,221,0.18),transparent_30%),radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_28%)]" />
          <div className="relative">
            <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-[28px] border border-amber-400/20 bg-amber-400/10 text-amber-300 shadow-lg shadow-amber-500/10">
              <Clock3 className="h-11 w-11" />
            </div>

            <div className="mt-6 text-center">
              <h1 className="text-3xl font-black tracking-tight text-white">Don&apos;t break a sweat!</h1>
              <div className="mx-auto mt-4 max-w-2xl space-y-4 text-base leading-8 text-white/75 sm:text-lg">
                <p>
                  Don&apos;t worry! Your Profit has been recorded and will be confirmed as per the partner&apos;s expected date.
                </p>
                <p>
                  We are awaiting payment from our retailer and will confirm it, once we have received it!
                </p>
              </div>
            </div>

            <div className="mt-8 flex justify-center">
              <Button
                onClick={() => navigate('/e-commerce?tab=my-rewards')}
                className="h-12 rounded-xl bg-gradient-to-r from-[#118bdd] to-[#6366f1] px-8 text-white hover:opacity-95"
              >
                Back To Order Details
              </Button>
            </div>

            <div className="mt-10 rounded-2xl border border-emerald-400/15 bg-emerald-500/10 p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-lg font-bold text-white">Your Profit is safe!</p>
                  <p className="mt-1 text-sm leading-6 text-emerald-100/80">
                    Your pending invoice is already tracked in the system and will be updated after confirmation from the retailer.
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
