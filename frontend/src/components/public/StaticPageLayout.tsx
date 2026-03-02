import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Network } from 'lucide-react';

import PublicFooter from '@/components/PublicFooter';

type StaticPageLayoutProps = {
  title: string;
  subtitle: string;
  updatedOn?: string;
  children: ReactNode;
};

export default function StaticPageLayout({ title, subtitle, updatedOn, children }: StaticPageLayoutProps) {
  return (
    <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col">
      <header className="fixed inset-x-0 top-0 z-40 glass border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary text-white">
              <Network className="h-4 w-4" />
            </span>
            <span className="font-heading text-lg font-semibold text-white">ReferNex</span>
          </Link>

          <Link to="/" className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Link>
        </div>
      </header>

      <main className="flex-1 pt-20 pb-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h1 className="font-heading text-3xl sm:text-4xl font-bold text-white">{title}</h1>
            <p className="mt-3 text-white/70">{subtitle}</p>
            {updatedOn && <p className="mt-2 text-xs text-white/50">Last updated: {updatedOn}</p>}
          </div>

          <div className="space-y-6">
            {children}
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
