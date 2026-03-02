import { useMemo, type ComponentType } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutGrid, Network, Wallet, Ticket, ReceiptText, UserRound, Shield, ShoppingBag } from 'lucide-react';

import { useAuthStore } from '@/store';

type NavItem = {
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
};

export default function MobileBottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, impersonatedUser } = useAuthStore();

  const canSeeAdmin = !!user?.isAdmin && !impersonatedUser;

  const items = useMemo<NavItem[]>(() => {
    const base: NavItem[] = [
      { label: 'Home', to: '/dashboard', icon: LayoutGrid },
      { label: 'Matrix', to: '/matrix', icon: Network },
      { label: 'Deposit', to: '/deposit', icon: Wallet },
      { label: 'Pins', to: '/pin-wallet', icon: Ticket },
      { label: 'History', to: '/transactions', icon: ReceiptText },
      { label: 'Profile', to: '/profile', icon: UserRound },
      { label: 'Shop', to: '/e-commerce', icon: ShoppingBag }
    ];

    if (canSeeAdmin) {
      base.push({ label: 'Admin', to: '/admin', icon: Shield });
    }

    return base;
  }, [canSeeAdmin]);

  if (!user) return null;

  return (
    <nav className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/90 bg-white/95 backdrop-blur-xl dark:border-white/10 dark:bg-[#0a1224]/90 md:hidden">
      <div className="mobile-bottom-scroll mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-2 pt-2 pb-[calc(0.6rem+env(safe-area-inset-bottom))]">
        {items.map((item) => {
          const isActive = pathname === item.to || pathname.startsWith(`${item.to}/`);
          const Icon = item.icon;

          return (
            <button
              key={item.to}
              type="button"
              onClick={() => navigate(item.to)}
              className={`mobile-nav-item flex min-w-[74px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-all ${
                isActive
                  ? 'bg-[#dbeeff] text-[#0b1736] shadow-[inset_0_0_0_1px_rgba(17,139,221,0.35)] dark:bg-[#118bdd]/20 dark:text-white dark:shadow-[inset_0_0_0_1px_rgba(56,189,245,0.5)]'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-white/65 dark:hover:bg-white/5'
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? 'text-[#0a6fbe] dark:text-[#7dd3fc]' : 'text-slate-500 dark:text-white/70'}`} />
              <span className="leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
