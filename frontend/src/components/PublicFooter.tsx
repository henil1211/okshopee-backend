import { Link } from 'react-router-dom';
import { Globe, ShieldCheck } from 'lucide-react';

import BrandLogo from '@/components/BrandLogo';

export default function PublicFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-white/5 bg-[#0a0e17]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              <BrandLogo className="h-9 w-9 rounded-lg" />
              <p className="font-heading text-lg font-semibold text-white">ReferNex</p>
            </div>
            <p className="mt-3 text-sm text-white/60">
              The next-generation referral network for smart shoppers and digital community growth.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-white/70">Company</p>
            <div className="mt-3 space-y-2 text-sm">
              <Link to="/about-us" className="block text-white/60 hover:text-white">
                About Us
              </Link>
              <Link to="/contact-us" className="block text-white/60 hover:text-white">
                Contact Us
              </Link>
              <a href="/#faq" className="block text-white/60 hover:text-white">
                FAQ
              </a>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-white/70">Legal</p>
            <div className="mt-3 space-y-2 text-sm">
              <Link to="/privacy-policy" className="block text-white/60 hover:text-white">
                Privacy Policy
              </Link>
              <Link to="/terms-and-conditions" className="block text-white/60 hover:text-white">
                Terms & Conditions
              </Link>
              <Link to="/disclaimer" className="block text-white/60 hover:text-white">
                Disclaimer
              </Link>
              <Link to="/refund-policy" className="block text-white/60 hover:text-white">
                Refund Policy
              </Link>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-white/70">Highlights</p>
            <div className="mt-3 space-y-2 text-sm text-white/60">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-[#7cc9ff]" />
                Transparent Platform
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Globe className="h-4 w-4 text-[#7cc9ff]" />
                Digital Growth Model
              </span>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-white/5 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-white/50">© {year} ReferNex. All rights reserved.</p>
          <p className="text-xs text-white/40">Performance-based rewards. Terms apply.</p>
        </div>
      </div>
    </footer>
  );
}
