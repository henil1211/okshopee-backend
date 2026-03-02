import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/store';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Copy, ExternalLink, LogOut, Search, ShoppingBag } from 'lucide-react';
import { copyToClipboard } from '@/utils/helpers';
import { toast } from 'sonner';

type AffiliatePartner = {
  id: string;
  section: 'TOP RETAILERS' | 'FINANCE DEALS';
  name: string;
  logoUrl: string;
  discountText: string;
  websiteUrl: string;
  affiliateLink: string;
};

const affiliatePartners: AffiliatePartner[] = [
  {
    id: 'flipkart',
    section: 'TOP RETAILERS',
    name: 'Flipkart',
    logoUrl: 'https://logo.clearbit.com/flipkart.com',
    discountText: 'Upto 8% Discount',
    websiteUrl: 'https://www.flipkart.com',
    affiliateLink: 'https://example.com/affiliate/flipkart'
  },
  {
    id: 'amazon',
    section: 'TOP RETAILERS',
    name: 'Amazon',
    logoUrl: 'https://logo.clearbit.com/amazon.in',
    discountText: 'Upto 10% Discount',
    websiteUrl: 'https://www.amazon.in',
    affiliateLink: 'https://example.com/affiliate/amazon'
  },
  {
    id: 'myntra',
    section: 'TOP RETAILERS',
    name: 'Myntra',
    logoUrl: 'https://logo.clearbit.com/myntra.com',
    discountText: 'Upto 12% Discount',
    websiteUrl: 'https://www.myntra.com',
    affiliateLink: 'https://example.com/affiliate/myntra'
  },
  {
    id: 'ajio',
    section: 'TOP RETAILERS',
    name: 'AJIO',
    logoUrl: 'https://logo.clearbit.com/ajio.com',
    discountText: 'Upto 9% Discount',
    websiteUrl: 'https://www.ajio.com',
    affiliateLink: 'https://example.com/affiliate/ajio'
  },
  {
    id: 'nykaa',
    section: 'TOP RETAILERS',
    name: 'Nykaa',
    logoUrl: 'https://logo.clearbit.com/nykaa.com',
    discountText: 'Upto 11% Discount',
    websiteUrl: 'https://www.nykaa.com',
    affiliateLink: 'https://example.com/affiliate/nykaa'
  },
  {
    id: 'meesho',
    section: 'TOP RETAILERS',
    name: 'Meesho',
    logoUrl: 'https://logo.clearbit.com/meesho.com',
    discountText: 'Upto 7% Discount',
    websiteUrl: 'https://www.meesho.com',
    affiliateLink: 'https://example.com/affiliate/meesho'
  },
  {
    id: 'sbi-card',
    section: 'FINANCE DEALS',
    name: 'SBI Card',
    logoUrl: 'https://logo.clearbit.com/sbicard.com',
    discountText: 'Upto 6% Discount',
    websiteUrl: 'https://www.sbicard.com',
    affiliateLink: 'https://example.com/affiliate/sbi-card'
  },
  {
    id: 'axis-bank',
    section: 'FINANCE DEALS',
    name: 'Axis Bank',
    logoUrl: 'https://logo.clearbit.com/axisbank.com',
    discountText: 'Upto 5% Discount',
    websiteUrl: 'https://www.axisbank.com',
    affiliateLink: 'https://example.com/affiliate/axis-bank'
  },
  {
    id: 'hdfc',
    section: 'FINANCE DEALS',
    name: 'HDFC Bank',
    logoUrl: 'https://logo.clearbit.com/hdfcbank.com',
    discountText: 'Upto 5.5% Discount',
    websiteUrl: 'https://www.hdfcbank.com',
    affiliateLink: 'https://example.com/affiliate/hdfc'
  },
  {
    id: 'icici',
    section: 'FINANCE DEALS',
    name: 'ICICI Bank',
    logoUrl: 'https://logo.clearbit.com/icicibank.com',
    discountText: 'Upto 4% Discount',
    websiteUrl: 'https://www.icicibank.com',
    affiliateLink: 'https://example.com/affiliate/icici'
  }
];

const sections: Array<AffiliatePartner['section']> = ['TOP RETAILERS', 'FINANCE DEALS'];

export default function Ecommerce() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuthStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [copiedPartnerId, setCopiedPartnerId] = useState<string | null>(null);
  const [brokenLogos, setBrokenLogos] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  const filteredPartners = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return affiliatePartners;
    return affiliatePartners.filter(
      (partner) =>
        partner.name.toLowerCase().includes(q)
        || partner.section.toLowerCase().includes(q)
        || partner.discountText.toLowerCase().includes(q)
    );
  }, [searchTerm]);

  const groupedBySection = useMemo(() => {
    return sections
      .map((section) => ({
        section,
        partners: filteredPartners.filter((partner) => partner.section === section)
      }))
      .filter((item) => item.partners.length > 0);
  }, [filteredPartners]);

  const handleLogout = () => {
    logout();
    navigate('/login');
    toast.success('Logged out successfully');
  };

  const handleVisitWebsite = (partner: AffiliatePartner) => {
    window.open(partner.websiteUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCopyAffiliateLink = async (partner: AffiliatePartner) => {
    const ok = await copyToClipboard(partner.affiliateLink);
    if (!ok) {
      toast.error('Unable to copy link');
      return;
    }
    setCopiedPartnerId(partner.id);
    setTimeout(() => setCopiedPartnerId(null), 1800);
    toast.success(`${partner.name} link copied`);
  };

  if (!user) return null;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0a0e17', forcedColorAdjust: 'none' }}>
      <header className="sticky top-0 z-40" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', backgroundColor: '#07132d', forcedColorAdjust: 'none' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-16 py-2 sm:py-0 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="h-9 w-9 rounded-lg inline-flex items-center justify-center"
              style={{ border: '1px solid rgba(255,255,255,0.25)', color: '#ffffff', backgroundColor: 'transparent' }}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div
              className="h-9 w-9 rounded-lg inline-flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #30c45b, #1a8e3f)' }}
            >
              <ShoppingBag className="w-4 h-4 text-white" />
            </div>
            <h1 className="font-bold text-base sm:text-xl leading-tight truncate" style={{ color: '#ffffff' }}>
              E-Commerce Affiliate Hub
            </h1>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="h-9 w-9 rounded-lg inline-flex items-center justify-center"
            style={{ border: '1px solid rgba(255,255,255,0.25)', color: '#ffffff', backgroundColor: 'transparent' }}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7">
        <div
          className="rounded-2xl overflow-hidden shadow-[0_14px_40px_rgba(0,0,0,0.35)]"
          style={{ border: '1px solid rgba(255,255,255,0.1)', forcedColorAdjust: 'none' }}
        >
          <div className="px-4 sm:px-6 py-4" style={{ backgroundColor: '#035239' }}>
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px] gap-4 items-center">
              <div className="min-w-0">
                <p className="text-sm" style={{ color: '#d1fae5' }}>Smart shopping from trusted stores</p>
                <p className="font-semibold text-base sm:text-lg mt-1" style={{ color: '#ffffff' }}>
                  Pick a brand, check the offer, and continue to the store
                </p>
              </div>
              <div className="relative w-full">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#9ca3af' }} />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search for partners or deals"
                  className="w-full h-11 rounded-full pl-10 pr-4 outline-none"
                  style={{
                    border: '1px solid rgba(255,255,255,0.4)',
                    backgroundColor: 'rgba(255,255,255,0.12)',
                    color: '#ffffff'
                  }}
                />
              </div>
            </div>
          </div>

          <div className="px-3 sm:px-5 py-5 space-y-7" style={{ backgroundColor: '#e5e7eb' }}>
            {groupedBySection.map(({ section, partners }) => (
              <section key={section}>
                <div className="flex items-center justify-between mb-3 px-1">
                  <h2 className="text-lg font-extrabold tracking-wide" style={{ color: '#1f2937' }}>{section}</h2>
                  <button
                    type="button"
                    onClick={() => setSearchTerm(section)}
                    className="text-sm font-semibold"
                    style={{ color: '#374151' }}
                  >
                    VIEW ALL
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  {partners.map((partner) => {
                    const isCopied = copiedPartnerId === partner.id;
                    const logoBroken = brokenLogos[partner.id];

                    return (
                      <article
                        key={partner.id}
                        className="rounded-md overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                        style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', color: '#111827', forcedColorAdjust: 'none' }}
                      >
                        <div className="px-2 pt-2">
                          <div
                            className="relative inline-flex text-[11px] font-bold uppercase tracking-wide pl-3 pr-6 py-1.5 rounded-sm"
                            style={{ backgroundColor: '#d90429', color: '#ffffff' }}
                          >
                            {partner.discountText}
                            <span
                              className="absolute -right-3 top-0 border-y-[14px] border-y-transparent border-l-[12px]"
                              style={{ borderLeftColor: '#d90429' }}
                            />
                          </div>
                        </div>

                        <div
                          className="h-[148px] px-4 border-b flex flex-col items-center justify-center gap-2"
                          style={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0' }}
                        >
                          {!logoBroken ? (
                            <img
                              src={partner.logoUrl}
                              alt={`${partner.name} logo`}
                              className="max-h-[72px] max-w-full object-contain"
                              onError={() => setBrokenLogos((prev) => ({ ...prev, [partner.id]: true }))}
                            />
                          ) : (
                            <div className="w-16 h-16 rounded-full bg-[#156db9] text-white text-xl font-bold inline-flex items-center justify-center">
                              {partner.name.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <p className="text-[15px] font-semibold leading-none" style={{ color: '#1f2937' }}>
                            {partner.name}
                          </p>
                        </div>

                        <div className="px-4 py-3 border-b text-center" style={{ borderColor: '#e2e8f0' }}>
                          <span
                            className="inline-flex px-3 py-1 rounded-full text-[11px] font-semibold"
                            style={{ border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', color: '#475569' }}
                          >
                            YOU GET
                          </span>
                          <p className="mt-2 text-3xl font-bold leading-tight" style={{ color: '#334155' }}>{partner.discountText}</p>
                        </div>

                        <div className="p-3 space-y-2.5">
                          <button
                            type="button"
                            onClick={() => handleVisitWebsite(partner)}
                            className="w-full h-11 rounded-full font-semibold inline-flex items-center justify-center"
                            style={{ backgroundColor: '#45ad49', color: '#ffffff' }}
                          >
                            <ExternalLink className="w-4 h-4 mr-2" />
                            Visit Website
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCopyAffiliateLink(partner)}
                            className="w-full h-11 rounded-full font-semibold inline-flex items-center justify-center"
                            style={{ border: '1px solid #94a3b8', backgroundColor: '#ffffff', color: '#334155' }}
                          >
                            {isCopied ? (
                              <>
                                <Check className="w-4 h-4 mr-2 text-emerald-600" />
                                Link Copied
                              </>
                            ) : (
                              <>
                                <Copy className="w-4 h-4 mr-2" />
                                Copy Link
                              </>
                            )}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}

            {groupedBySection.length === 0 && (
              <div
                className="rounded-md py-10 text-center"
                style={{ border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#475569' }}
              >
                No affiliate partners found for this search.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
