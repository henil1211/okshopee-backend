import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/store';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, LogOut, Search, ShoppingBag,
  Star, GraduationCap, Laptop, Shirt, Landmark, Briefcase, Plane, Pill, UtensilsCrossed, Heart, Home,
  Gift, Music, Camera, Gamepad2, Dumbbell, Baby, Car, Smartphone, Handbag, Sparkles, Gem, SprayCan,
  Venus, Mars, WandSparkles, CookingPot, BadgeCent, Flower2, SoapDispenserDroplet, Store, Share2, Tag, Zap, TrendingUp,
  ArrowRight, Award, Upload, FileText, Clock, CheckCircle, XCircle, Send, type LucideIcon
} from 'lucide-react';
import { copyToClipboard, formatAmountForCountryCurrency, getCurrencyLabelForCountry, readOptimizedUploadDataUrl } from '@/utils/helpers';
import MobileBottomNav from '@/components/MobileBottomNav';
import { toast } from 'sonner';
import Database from '@/db';
import type { MarketplaceRetailer, MarketplaceInvoice, RewardRedemption } from '@/types';

const BACKEND_BASE_URL = (() => {
  const configured = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_BACKEND_URL;
  const fallback = typeof window !== 'undefined' ? window.location.origin : '';
  return (configured || fallback).replace(/\/+$/, '');
})();

async function uploadMarketplaceFile(dataUrl: string, fileName: string, mimeType?: string): Promise<{
  fileUrl: string;
  fileName: string;
  mimeType: string;
}> {
  const response = await fetch(`${BACKEND_BASE_URL}/api/upload-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scope: 'marketplace-invoices',
      fileName,
      mimeType,
      dataUrl
    })
  });

  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || payload?.ok === false || typeof payload?.fileUrl !== 'string') {
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Failed to upload invoice file (HTTP ${response.status})`;
    throw new Error(message);
  }

  return {
    fileUrl: payload.fileUrl,
    fileName: typeof payload?.fileName === 'string' ? payload.fileName : fileName,
    mimeType: typeof payload?.mimeType === 'string' ? payload.mimeType : (mimeType || '')
  };
}

// Lucide icon map for dynamic rendering
const ICON_MAP: Record<string, LucideIcon> = {
  Star, GraduationCap, Laptop, Shirt, Landmark, Briefcase, Plane, Pill, UtensilsCrossed, Heart, Home,
  ShoppingBag, Gift, Music, Camera, Gamepad2, Dumbbell, Baby, Car, Smartphone,
  Handbag, Sparkles, Gem, SprayCan, Venus, Mars, WandSparkles, CookingPot, BadgeCent, Flower2, SoapDispenserDroplet, Store,
};

function DynamicIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name];
  if (!Icon) return <ShoppingBag className={className} />;
  return <Icon className={className} />;
}

// Category gradient colors for visual variety
const CATEGORY_COLORS = [
  { bg: 'from-blue-500/20 to-cyan-500/20', icon: 'text-cyan-400', border: 'hover:border-cyan-500/40' },
  { bg: 'from-purple-500/20 to-pink-500/20', icon: 'text-purple-400', border: 'hover:border-purple-500/40' },
  { bg: 'from-orange-500/20 to-amber-500/20', icon: 'text-amber-400', border: 'hover:border-amber-500/40' },
  { bg: 'from-emerald-500/20 to-teal-500/20', icon: 'text-emerald-400', border: 'hover:border-emerald-500/40' },
  { bg: 'from-rose-500/20 to-red-500/20', icon: 'text-rose-400', border: 'hover:border-rose-500/40' },
  { bg: 'from-indigo-500/20 to-blue-500/20', icon: 'text-indigo-400', border: 'hover:border-indigo-500/40' },
  { bg: 'from-yellow-500/20 to-orange-500/20', icon: 'text-yellow-400', border: 'hover:border-yellow-500/40' },
  { bg: 'from-teal-500/20 to-green-500/20', icon: 'text-teal-400', border: 'hover:border-teal-500/40' },
  { bg: 'from-pink-500/20 to-rose-500/20', icon: 'text-pink-400', border: 'hover:border-pink-500/40' },
  { bg: 'from-sky-500/20 to-blue-500/20', icon: 'text-sky-400', border: 'hover:border-sky-500/40' },
  { bg: 'from-lime-500/20 to-emerald-500/20', icon: 'text-lime-400', border: 'hover:border-lime-500/40' },
];

type TabId = 'top-retailers' | 'categories' | 'sub-categories' | 'my-rewards';

export default function Ecommerce() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, impersonatedUser, isAuthenticated, logout } = useAuthStore();
  const displayUser = impersonatedUser || user;
  const userCurrencyLabel = useMemo(
    () => getCurrencyLabelForCountry(displayUser?.country) || 'Your Currency',
    [displayUser?.country]
  );

  const [activeTab, setActiveTab] = useState<TabId>('top-retailers');
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [bannerIndex, setBannerIndex] = useState(0);
  const bannerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const quickCategoriesRef = useRef<HTMLDivElement | null>(null);
  const [showQuickCategoriesLeftArrow, setShowQuickCategoriesLeftArrow] = useState(false);
  const [showQuickCategoriesRightArrow, setShowQuickCategoriesRightArrow] = useState(false);

  // Reward points / invoice / redemption state
  const [userWallet, setUserWallet] = useState(() => {
    const wallets = Database.getWallets();
    return wallets.find(w => w.userId === displayUser?.id) || null;
  });
  const [userInvoices, setUserInvoices] = useState<MarketplaceInvoice[]>(() =>
    displayUser?.userId ? Database.getUserInvoices(displayUser.userId) : []
  );
  const [userRedemptions, setUserRedemptions] = useState<RewardRedemption[]>(() =>
    displayUser?.userId ? Database.getUserRedemptions(displayUser.userId) : []
  );
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceRetailerId, setInvoiceRetailerId] = useState('');
  const [invoiceOrderId, setInvoiceOrderId] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceImage, setInvoiceImage] = useState('');
  const [invoiceFileName, setInvoiceFileName] = useState('');
  const [invoiceFileMimeType, setInvoiceFileMimeType] = useState('');
  const [showRedeemForm, setShowRedeemForm] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState('');
  const [marketplaceEnabled, setMarketplaceEnabled] = useState(() => Database.getSettings().marketplaceEnabled !== false);
  const [invoicePreview, setInvoicePreview] = useState<{ url: string; mimeType: string } | null>(null);
  const [pendingInfoInvoice, setPendingInfoInvoice] = useState<MarketplaceInvoice | null>(null);
  const [showFullInstructions, setShowFullInstructions] = useState(false);

  // Marketplace data state
  const [categories, setCategories] = useState(() => Database.getMarketplaceCategories().filter(c => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder));
  const [allRetailers, setAllRetailers] = useState(() => Database.getMarketplaceRetailers().filter(r => r.isActive).sort((a, b) => a.sortOrder - b.sortOrder));
  const [banners, setBanners] = useState(() => Database.getMarketplaceBanners().filter(b => b.isActive).sort((a, b) => a.sortOrder - b.sortOrder));
  const [deals, setDeals] = useState(() => {
    const now = new Date().toISOString();
    return Database.getMarketplaceDeals().filter(d => d.isActive && (!d.endDate || d.endDate >= now)).sort((a, b) => a.sortOrder - b.sortOrder);
  });

  const reloadMarketplaceData = useCallback(() => {
    setCategories(Database.getMarketplaceCategories().filter(c => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder));
    setAllRetailers(Database.getMarketplaceRetailers().filter(r => r.isActive).sort((a, b) => a.sortOrder - b.sortOrder));
    setBanners(Database.getMarketplaceBanners().filter(b => b.isActive).sort((a, b) => a.sortOrder - b.sortOrder));
    const now = new Date().toISOString();
    setDeals(Database.getMarketplaceDeals().filter(d => d.isActive && (!d.endDate || d.endDate >= now)).sort((a, b) => a.sortOrder - b.sortOrder));
  }, []);

  const updateQuickCategoryArrows = useCallback(() => {
    const container = quickCategoriesRef.current;
    if (!container) {
      setShowQuickCategoriesLeftArrow(false);
      setShowQuickCategoriesRightArrow(false);
      return;
    }

    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    setShowQuickCategoriesLeftArrow(container.scrollLeft > 8);
    setShowQuickCategoriesRightArrow(maxScrollLeft > 8 && container.scrollLeft < maxScrollLeft - 8);
  }, []);

  const topRetailers = useMemo(() => {
    let list = allRetailers.filter(r => r.isTopRetailer);
    const q = searchTerm.trim().toLowerCase();
    if (q) list = list.filter(r => r.name.toLowerCase().includes(q) || r.discountText.toLowerCase().includes(q));
    return list;
  }, [allRetailers, searchTerm]);

  const filteredDeals = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return deals;
    return deals.filter(d => d.title.toLowerCase().includes(q) || d.description.toLowerCase().includes(q) || d.badgeText.toLowerCase().includes(q));
  }, [deals, searchTerm]);

  const filteredRetailers = useMemo(() => {
    let list = selectedCategoryId
      ? allRetailers.filter(r => r.categoryId === selectedCategoryId)
      : allRetailers;
    const q = searchTerm.trim().toLowerCase();
    if (q) {
      list = list.filter(r => r.name.toLowerCase().includes(q) || r.discountText.toLowerCase().includes(q));
    }
    return list;
  }, [allRetailers, selectedCategoryId, searchTerm]);

  const filteredCategories = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter(c => c.name.toLowerCase().includes(q));
  }, [categories, searchTerm]);

  const selectedCategory = useMemo(() => categories.find(c => c.id === selectedCategoryId), [categories, selectedCategoryId]);

  const adminPreview = useMemo(() => {
    if (!displayUser?.isAdmin) return false;
    const search = new URLSearchParams(location.search);
    const flag = search.get('preview');
    return flag === 'admin' || flag === '1' || flag === 'true';
  }, [location.search, displayUser?.isAdmin]);

  useEffect(() => {
    const search = new URLSearchParams(location.search);
    const tab = search.get('tab');
    if (tab === 'my-rewards') {
      setActiveTab('my-rewards');
    }
  }, [location.search]);

  const isMarketplaceOpen = marketplaceEnabled || adminPreview;

  useEffect(() => {
    if (!isAuthenticated) { navigate('/login'); return; }
    setMarketplaceEnabled(Database.getSettings().marketplaceEnabled !== false);

    // Hydrate marketplace data from server, then reload state
    if (import.meta.env.PROD) {
      void Database.hydrateFromServerBatches(
        [[
          'mlm_marketplace_categories',
          'mlm_marketplace_retailers',
          'mlm_marketplace_banners',
          'mlm_marketplace_deals',
        ]],
        { strict: true, maxAttempts: 2, timeoutMs: 20000, retryDelayMs: 1000, continueOnError: true, requireAnySuccess: false }
      ).then(() => {
        setMarketplaceEnabled(Database.getSettings().marketplaceEnabled !== false);
        reloadMarketplaceData();
      }).catch(() => {
        // Even if hydration fails, try to reload from local cache
        reloadMarketplaceData();
      });
    }
  }, [isAuthenticated, navigate, reloadMarketplaceData]);

  // Banner auto-cycle
  useEffect(() => {
    if (banners.length <= 1) return;
    bannerTimerRef.current = setInterval(() => {
      setBannerIndex(prev => (prev + 1) % banners.length);
    }, 4000);
    return () => { if (bannerTimerRef.current) clearInterval(bannerTimerRef.current); };
  }, [banners.length]);

  useEffect(() => {
    return () => {
      if (invoicePreview?.url.startsWith('blob:')) {
        URL.revokeObjectURL(invoicePreview.url);
      }
    };
  }, [invoicePreview]);

  useEffect(() => {
    updateQuickCategoryArrows();
    window.addEventListener('resize', updateQuickCategoryArrows);
    return () => window.removeEventListener('resize', updateQuickCategoryArrows);
  }, [categories, updateQuickCategoryArrows]);

  const handleLogout = () => {
    logout();
    navigate('/login');
    toast.success('Logged out successfully');
  };

  const handleShopNow = (url: string) => {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleShareNow = useCallback(async (retailer: MarketplaceRetailer) => {
    const referralId = displayUser?.userId || '';
    const link = retailer.affiliateLink
      ? `${retailer.affiliateLink}${retailer.affiliateLink.includes('?') ? '&' : '?'}ref=${referralId}`
      : `${retailer.websiteUrl}?ref=${referralId}`;
    const shareText = retailer.discountText
      ? `Check out ${retailer.name} - ${retailer.discountText}!`
      : `Check out ${retailer.name}!`;

    // Use native share sheet if available (mobile browsers, etc.)
    if (navigator.share) {
      try {
        await navigator.share({ title: retailer.name, text: shareText, url: link });
        return;
      } catch {
        // User cancelled or share failed - fall back to copy
      }
    }

    // Fallback: copy to clipboard
    const ok = await copyToClipboard(link);
    if (!ok) { toast.error('Unable to share'); return; }
    setCopiedId(retailer.id);
    setTimeout(() => setCopiedId(null), 1800);
    toast.success('Link copied! Share it anywhere');
  }, [displayUser?.userId]);

  const handleCopyLink = useCallback(async (retailer: MarketplaceRetailer) => {
    const referralId = displayUser?.userId || '';
    const link = retailer.affiliateLink
      ? `${retailer.affiliateLink}${retailer.affiliateLink.includes('?') ? '&' : '?'}ref=${referralId}`
      : `${retailer.websiteUrl}?ref=${referralId}`;
    const ok = await copyToClipboard(link);
    if (!ok) { toast.error('Unable to copy'); return; }
    setCopiedId(retailer.id);
    setTimeout(() => setCopiedId(null), 1800);
    toast.success('Link copied!');
  }, [displayUser?.userId]);

  const handleCategoryClick = (catId: string) => {
    setSelectedCategoryId(catId);
    setActiveTab('sub-categories');
  };

  const handleQuickCategoryArrowClick = (direction: 'left' | 'right') => {
    const container = quickCategoriesRef.current;
    if (!container) return;
    const scrollAmount = Math.max(container.clientWidth * 0.7, 180);
    container.scrollBy({
      left: direction === 'right' ? scrollAmount : -scrollAmount,
      behavior: 'smooth',
    });
    window.setTimeout(updateQuickCategoryArrows, 220);
  };

  const reloadRewardsData = useCallback(() => {
    if (!displayUser?.userId) return;
    const wallets = Database.getWallets();
    setUserWallet(wallets.find(w => w.userId === displayUser.id) || null);
    setUserInvoices(Database.getUserInvoices(displayUser.userId));
    setUserRedemptions(Database.getUserRedemptions(displayUser.userId));
  }, [displayUser?.userId, displayUser?.id]);

  // Reload wallet + invoice + redemption data every time user opens My Rewards tab
  useEffect(() => {
    if (activeTab === 'my-rewards') {
      if (import.meta.env.PROD) {
        void Database.hydrateFromServerBatches(
          [['mlm_wallets', 'mlm_marketplace_invoices', 'mlm_marketplace_redemptions']],
          { strict: true, maxAttempts: 2, timeoutMs: 15000, retryDelayMs: 1000, continueOnError: true, requireAnySuccess: false }
        ).then(() => reloadRewardsData()).catch(() => reloadRewardsData());
      } else {
        reloadRewardsData();
      }
    }
  }, [activeTab, reloadRewardsData]);

  const handleInvoiceImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      toast.error('Please upload JPG, PNG, or PDF files only');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size must be less than 5MB');
      return;
    }
    try {
      setInvoiceFileName(file.name);
      setInvoiceFileMimeType(file.type || '');
      const dataUrl = await readOptimizedUploadDataUrl(file, {
        maxDimension: 1800,
        targetBytes: 650 * 1024,
        quality: 0.88
      });
      setInvoiceImage(dataUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to process invoice file');
    }
  };

  const handleSubmitInvoice = async () => {
    if (!displayUser?.userId) return;
    if (!invoiceRetailerId) { toast.error('Please select a retailer'); return; }
    if (!invoiceOrderId.trim()) { toast.error('Please enter order ID'); return; }
    if (!invoiceAmount || parseFloat(invoiceAmount) <= 0) { toast.error('Please enter a valid amount'); return; }
    if (!invoiceImage) { toast.error('Please upload an invoice image'); return; }
    if (!invoiceFileName) { toast.error('Please select an invoice file'); return; }
    const retailer = allRetailers.find(r => r.id === invoiceRetailerId);
    try {
      const existingInvoices = Database.getMarketplaceInvoices();
      const legacyInvoices = existingInvoices.filter((inv) => typeof inv.invoiceImage === 'string' && inv.invoiceImage.startsWith('data:'));

      if (legacyInvoices.length > 0) {
        toast.info(`Optimizing ${legacyInvoices.length} older invoice file${legacyInvoices.length > 1 ? 's' : ''} for faster sync...`);
        const migratedInvoices = [...existingInvoices];
        for (let index = 0; index < migratedInvoices.length; index += 1) {
          const currentInvoice = migratedInvoices[index];
          if (!currentInvoice?.invoiceImage?.startsWith('data:')) continue;
          const legacyUpload = await uploadMarketplaceFile(
            currentInvoice.invoiceImage,
            currentInvoice.invoiceImageFileName || `${currentInvoice.retailerName || 'invoice'}-${currentInvoice.orderId || currentInvoice.id}`,
            currentInvoice.invoiceImageMimeType || undefined
          );
          migratedInvoices[index] = {
            ...currentInvoice,
            invoiceImage: legacyUpload.fileUrl,
            invoiceImageMimeType: legacyUpload.mimeType || currentInvoice.invoiceImageMimeType || null,
            invoiceImageFileName: legacyUpload.fileName || currentInvoice.invoiceImageFileName || null
          };
        }

        await Database.commitCriticalAction(() => {
          Database.saveMarketplaceInvoices(migratedInvoices);
          return migratedInvoices.length;
        }, {
          full: false,
          force: true,
          timeoutMs: 90000,
          maxAttempts: 3,
          retryDelayMs: 1500
        });
      }

      const uploadedInvoiceFile = await uploadMarketplaceFile(invoiceImage, invoiceFileName, invoiceFileMimeType);
      await Database.runWithLocalStateTransaction(() => Database.createMarketplaceInvoice({
        userId: displayUser.userId,
        retailerId: invoiceRetailerId,
        retailerName: retailer?.name || 'Unknown',
        orderId: invoiceOrderId.trim(),
        amount: parseFloat(invoiceAmount),
        invoiceImage: uploadedInvoiceFile.fileUrl,
        invoiceImageMimeType: uploadedInvoiceFile.mimeType || invoiceFileMimeType || null,
        invoiceImageFileName: uploadedInvoiceFile.fileName || invoiceFileName,
        status: 'pending',
        rewardPoints: 0,
        adminNotes: '',
        createdAt: new Date().toISOString(),
        processedAt: null,
        processedBy: null,
      }), {
        syncOnCommit: true,
        syncOptions: {
          full: false,
          force: true,
          timeoutMs: 90000,
          maxAttempts: 3,
          retryDelayMs: 1500
        }
      });
      toast.success('Invoice submitted for review');
      setShowInvoiceForm(false);
      setInvoiceRetailerId('');
      setInvoiceOrderId('');
      setInvoiceAmount('');
      setInvoiceImage('');
      setInvoiceFileName('');
      setInvoiceFileMimeType('');
      reloadRewardsData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to submit invoice');
    }
  };

  const handleSubmitRedemption = async () => {
    if (!displayUser?.userId) return;
    const pts = parseInt(redeemPoints);
    if (!pts || pts <= 0) { toast.error('Enter a valid number of points'); return; }
    const currentRP = userWallet?.rewardPoints || 0;
    if (pts > currentRP) { toast.error(`You only have ${currentRP} reward points`); return; }
    try {
      const result = await Database.runWithLocalStateTransaction(() => Database.createRedemptionRequest(displayUser.userId, pts), {
        syncOnCommit: true,
        syncOptions: {
          full: false,
          force: true,
          timeoutMs: 60000,
          maxAttempts: 3,
          retryDelayMs: 1500
        }
      });
      if (!result) { toast.error('Failed to create redemption request'); return; }
      toast.success(`Redemption request for ${pts} RP ($${(pts * 0.01).toFixed(2)} USDT) submitted`);
      setShowRedeemForm(false);
      setRedeemPoints('');
      reloadRewardsData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to submit redemption request');
    }
  };

  const closeInvoicePreview = () => {
    setInvoicePreview((current) => {
      if (current?.url.startsWith('blob:')) {
        URL.revokeObjectURL(current.url);
      }
      return null;
    });
  };

  const handleViewInvoice = async (invoiceImage: string) => {
    if (!invoiceImage) return;
    try {
      if (invoiceImage.startsWith('data:')) {
        const response = await fetch(invoiceImage);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        setInvoicePreview((current) => {
          if (current?.url.startsWith('blob:')) {
            URL.revokeObjectURL(current.url);
          }
          return { url: objectUrl, mimeType: blob.type };
        });
        return;
      }

      setInvoicePreview({ url: invoiceImage, mimeType: '' });
    } catch {
      toast.error('Unable to open invoice preview');
    }
  };

  if (!isMarketplaceOpen) {
    return (
      <div className="min-h-screen bg-[#060b14] relative overflow-hidden flex flex-col items-center justify-center px-4 py-10 text-center">
        <div className="absolute inset-0 opacity-45" style={{ background: 'radial-gradient(circle at 18% 22%, rgba(17,139,221,0.22), transparent 38%), radial-gradient(circle at 78% 18%, rgba(99,102,241,0.2), transparent 35%), radial-gradient(circle at 50% 80%, rgba(16,185,129,0.18), transparent 40%)' }} />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.03)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.03)_50%,rgba(255,255,255,0.03)_75%,transparent_75%,transparent)] bg-[length:14px_14px] opacity-15" />
        <div className="relative max-w-2xl w-full">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 shadow-2xl backdrop-blur space-y-5">
            <div className="flex items-center justify-center gap-3">
              <div className="h-14 w-14 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30" style={{ background: 'linear-gradient(135deg, #118bdd 0%, #6366f1 100%)' }}>
                <ShoppingBag className="w-7 h-7 text-white" />
              </div>
              <div className="text-left">
                <p className="text-xs uppercase tracking-[0.25em] text-[#84c5ff] font-semibold">Affiliate Marketplace</p>
                <p className="text-sm text-amber-200 font-semibold">Launching soon</p>
              </div>
            </div>
            <div className="space-y-2 text-center">
              <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">Coming Soon</h1>
              <p className="text-white/70 text-sm sm:text-base leading-relaxed">
                We’re finalizing offers and retailers. Check back shortly to start shopping and earning rewards.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => navigate('/dashboard')}
                className="px-4 py-2 rounded-lg bg-[#118bdd] text-white hover:bg-[#0f7ac7] w-full sm:w-auto shadow-lg shadow-blue-500/30 transition"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
        <MobileBottomNav />
      </div>
    );
  }

  if (!displayUser) return null;

  return (
    <div className="min-h-screen pb-24 md:pb-0 overflow-x-hidden" style={{ backgroundColor: '#060b14' }}>

      {/* ====== PREMIUM HEADER ====== */}
      <header className="sticky top-0 z-40" style={{ background: 'linear-gradient(180deg, #0c1829 0%, #0a1422 100%)' }}>
        <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(17,139,221,0.15), transparent 70%)' }} />
        <div className="relative max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-3 pb-2 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => navigate('/dashboard')} className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl inline-flex items-center justify-center bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 hover:text-white transition-all">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl inline-flex items-center justify-center shadow-lg shadow-blue-500/20" style={{ background: 'linear-gradient(135deg, #118bdd 0%, #6366f1 100%)' }}>
              <ShoppingBag className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-sm sm:text-lg text-white truncate leading-tight">Affiliate Marketplace</h1>
              <p className="text-[10px] text-white/40 leading-tight">Shop smart, earn rewards</p>
              {impersonatedUser && (
                <p className="text-[10px] text-amber-300/90 leading-tight mt-0.5">
                  Viewing as {impersonatedUser.fullName} ({impersonatedUser.userId})
                </p>
              )}
            </div>
          </div>
          <button onClick={handleLogout} className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl inline-flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-red-500/15 hover:text-red-400 hover:border-red-500/30 transition-all">
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        {/* Marketplace note */}
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-3 pt-1">
          <div className="rounded-2xl p-4 sm:p-5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <h2 className="text-white font-bold text-base sm:text-lg">Instruction</h2>
            <ol className="mt-3 space-y-2 text-sm sm:text-base text-white/80 leading-relaxed list-decimal pl-5">
              <li>To get RP (Reward Points), upload your invoice in the &quot;My Reward&quot; section.</li>
              <li>Upload the invoice only after the return policy period is completed.</li>
              {showFullInstructions && (
                <>
                  <li>RP (Reward Points) will be reflected within 60-90 days once the retailer shares the order report.</li>
                  <li>Before purchasing any product through third-party affiliate links/websites, please read the terms &amp; conditions and privacy policy carefully on that website.</li>
                </>
              )}
            </ol>
            <button
              type="button"
              onClick={() => setShowFullInstructions(current => !current)}
              className="mt-3 text-[11px] sm:text-xs font-semibold text-[#118bdd] hover:text-blue-300 transition-colors"
            >
              {showFullInstructions ? 'Read less' : 'Read more'}
            </button>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="relative max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 border-b border-white/[0.06] sm:flex sm:overflow-x-auto sm:whitespace-nowrap" style={{ scrollbarWidth: 'none' }}>
            {([
              { id: 'top-retailers' as TabId, label: 'Top Retailers', icon: Star },
              { id: 'categories' as TabId, label: 'Categories', icon: ShoppingBag },
              { id: 'sub-categories' as TabId, label: 'Sub-Categories', icon: Tag },
              { id: 'my-rewards' as TabId, label: 'My Rewards', icon: Award },
            ]).map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex min-w-0 items-center justify-center gap-1.5 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium text-center transition-colors border-white/[0.06] sm:shrink-0 ${
                    isActive ? 'text-white' : 'text-white/40 hover:text-white/70'
                  }`}
                  style={{ borderTopWidth: 0, borderLeftWidth: 0, borderRightWidth: 0, borderBottomWidth: 0 }}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  <span className="truncate sm:truncate-none">{tab.label}</span>
                  {isActive && (
                    <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full" style={{ background: 'linear-gradient(90deg, #118bdd, #6366f1)' }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-5 space-y-6 sm:space-y-7">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search brands, categories, deals..."
            className="w-full h-11 rounded-xl pl-11 pr-4 text-sm bg-white/[0.06] border border-white/[0.08] text-white placeholder:text-white/30 outline-none focus:border-[#118bdd]/50 focus:bg-white/[0.08] transition-all"
          />
        </div>

        {/* ============ TOP RETAILERS TAB ============ */}
        {activeTab === 'top-retailers' && (
          <>
            {/* Hero Banner Slideshow */}
            {banners.length > 0 ? (
              <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-black/40" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="relative h-44 sm:h-56 md:h-64">
                  {banners.map((banner, idx) => (
                    <div
                      key={banner.id}
                      className={`absolute inset-0 transition-all duration-1000 ease-in-out ${idx === bannerIndex ? 'opacity-100 scale-100' : 'opacity-0 scale-105 pointer-events-none'}`}
                      onClick={() => banner.linkUrl && handleShopNow(banner.linkUrl)}
                      style={{ cursor: banner.linkUrl ? 'pointer' : 'default' }}
                    >
                      {banner.imageUrl ? (
                        <img src={banner.imageUrl} alt={banner.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #312e81 70%, #4338ca 100%)' }}>
                          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 30% 70%, rgba(99,102,241,0.4), transparent 50%), radial-gradient(circle at 70% 30%, rgba(17,139,221,0.3), transparent 50%)' }} />
                          <div className="relative pl-4 pr-4 sm:pl-16 sm:pr-10 py-5 sm:py-6 max-w-xl">
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 mb-3">
                              <Zap className="w-3 h-3 text-yellow-400" />
                              <span className="text-[10px] font-semibold text-white/80 uppercase tracking-wider">Featured</span>
                            </div>
                            <h3 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white leading-tight">{banner.title}</h3>
                            {banner.subtitle && <p className="text-sm sm:text-base mt-2 text-white/60 max-w-md">{banner.subtitle}</p>}
                            {banner.linkUrl && (
                              <button className="mt-4 px-5 py-2.5 rounded-xl text-sm font-semibold text-white inline-flex items-center gap-2 transition-all hover:gap-3" style={{ background: 'linear-gradient(135deg, #118bdd, #6366f1)' }}>
                                Shop Now <ArrowRight className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      {banner.imageUrl && (
                        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent">
                          <div className="h-full flex flex-col justify-center pl-4 pr-4 sm:pl-16 sm:pr-10 max-w-lg">
                            <h3 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight">{banner.title}</h3>
                            {banner.subtitle && <p className="text-sm mt-2 text-white/70">{banner.subtitle}</p>}
                            {banner.linkUrl && (
                              <button className="mt-4 w-fit px-5 py-2.5 rounded-xl text-sm font-semibold text-white inline-flex items-center gap-2 transition-all hover:gap-3" style={{ background: 'linear-gradient(135deg, #118bdd, #6366f1)' }}>
                                Shop Now <ArrowRight className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {/* Dots */}
                {banners.length > 1 && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 px-3 py-1.5 rounded-full bg-black/30 backdrop-blur-sm">
                    {banners.map((_, idx) => (
                      <button
                        key={idx}
                        onClick={() => setBannerIndex(idx)}
                        className={`rounded-full transition-all duration-300 ${idx === bannerIndex ? 'w-6 h-2 bg-white' : 'w-2 h-2 bg-white/40 hover:bg-white/60'}`}
                      />
                    ))}
                  </div>
                )}
                {/* Arrows */}
                {banners.length > 1 && (
                  <>
                    <button onClick={() => setBannerIndex(prev => (prev - 1 + banners.length) % banners.length)} className="absolute left-1.5 sm:left-3 top-1/2 -translate-y-1/2 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 text-white/70 hover:text-white hover:bg-black/50 flex items-center justify-center transition-all">
                      <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                    <button onClick={() => setBannerIndex(prev => (prev + 1) % banners.length)} className="absolute right-1.5 sm:right-3 top-1/2 -translate-y-1/2 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 text-white/70 hover:text-white hover:bg-black/50 flex items-center justify-center transition-all">
                      <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                  </>
                )}
              </div>
            ) : (
              /* Default hero when no banners */
              <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #312e81 70%, #4338ca 100%)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, rgba(99,102,241,0.4), transparent 50%), radial-gradient(circle at 20% 80%, rgba(17,139,221,0.3), transparent 50%)' }} />
                <div className="relative px-6 sm:px-10 py-8 sm:py-12">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 mb-4">
                    <span className="text-[10px] font-semibold text-white/80 uppercase tracking-wider">Exclusive Deals</span>
                  </div>
                  <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white leading-tight max-w-lg">
                    Shop from <span style={{ background: 'linear-gradient(135deg, #60a5fa, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Top Brands</span> & Earn Rewards
                  </h2>
                  <p className="text-sm sm:text-base mt-3 text-white/50 max-w-md">
                    Discover exclusive discounts from your favourite stores. Share and earn through affiliate links.
                  </p>
                  <div className="flex flex-wrap gap-4 sm:gap-6 mt-6">
                    <div className="text-center">
                      <div className="text-xl font-bold text-white">{allRetailers.length}+</div>
                      <div className="text-[10px] text-white/40 uppercase tracking-wider">Brands</div>
                    </div>
                    <div className="w-px bg-white/10" />
                    <div className="text-center">
                      <div className="text-xl font-bold text-white">{categories.length}</div>
                      <div className="text-[10px] text-white/40 uppercase tracking-wider">Categories</div>
                    </div>
                    <div className="w-px bg-white/10" />
                    <div className="text-center">
                      <div className="text-xl font-bold text-emerald-400">{deals.length}</div>
                      <div className="text-[10px] text-white/40 uppercase tracking-wider">Live Deals</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Today's Best Deals */}
            {filteredDeals.length > 0 && (
              <section>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f97316, #ef4444)' }}>
                      <Zap className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <h2 className="text-white font-bold text-base sm:text-lg leading-tight">Today's Best Deals</h2>
                      <p className="text-white/30 text-[10px] uppercase tracking-wider font-medium">Limited time offers</p>
                    </div>
                  </div>
                  <button className="text-[11px] font-semibold text-[#118bdd] hover:text-blue-300 flex items-center gap-1 transition-colors">
                    View All <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-3 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
                  {filteredDeals.map(deal => {
                    const dealRetailer = allRetailers.find(r => r.id === deal.retailerId);
                    return (
                    <div
                      key={deal.id}
                      className="min-w-[210px] sm:min-w-[250px] max-w-[250px] rounded-2xl overflow-hidden flex-shrink-0 group transition-all duration-300 hover:-translate-y-1"
                      style={{ background: 'linear-gradient(180deg, #111827 0%, #0d1117 100%)', border: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      {/* Badge strip above image */}
                      {deal.badgeText && (
                        <div className="px-3 py-1.5 flex items-center gap-1.5" style={{ background: 'linear-gradient(135deg, #ef4444, #f97316)' }}>
                          <Zap className="w-3 h-3 text-white" />
                          <span className="text-[10px] font-bold text-white uppercase tracking-wide">{deal.badgeText}</span>
                        </div>
                      )}
                      <div className="relative overflow-hidden">
                        {deal.imageUrl ? (
                          <img src={deal.imageUrl} alt={deal.title} className="w-full h-36 object-cover group-hover:scale-105 transition-transform duration-500" />
                        ) : (
                          <div className="w-full h-36 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #1e1b4b, #312e81)' }}>
                            <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center">
                              <Tag className="w-7 h-7 text-indigo-300" />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="p-3.5 space-y-2">
                        <h3 className="text-white text-sm font-semibold line-clamp-2 leading-snug">{deal.title}</h3>
                        {deal.description && <p className="text-white/40 text-xs line-clamp-2 leading-relaxed">{deal.description}</p>}
                        <button
                          onClick={() => handleShopNow(deal.linkUrl)}
                          className="w-full h-9 rounded-xl text-xs font-bold text-white inline-flex items-center justify-center gap-1.5 transition-all hover:shadow-lg hover:shadow-blue-500/20"
                          style={{ background: 'linear-gradient(135deg, #118bdd, #6366f1)' }}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Grab Deal
                        </button>
                        {dealRetailer && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleShareNow(dealRetailer)}
                              className="flex-1 h-8 rounded-xl text-[11px] font-semibold inline-flex items-center justify-center gap-1 transition-all active:scale-[0.98] bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white hover:border-white/20 hover:bg-white/[0.08]"
                            >
                              <Share2 className="w-3 h-3" />
                              Share
                            </button>
                            <button
                              onClick={() => handleCopyLink(dealRetailer)}
                              className={`h-8 px-3 rounded-xl text-[11px] font-semibold inline-flex items-center justify-center gap-1 transition-all active:scale-[0.98] border ${
                                copiedId === dealRetailer.id
                                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                  : 'bg-white/[0.04] border-white/[0.08] text-white/60 hover:text-white hover:border-white/20 hover:bg-white/[0.08]'
                              }`}
                            >
                              {copiedId === dealRetailer.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Quick Categories Strip */}
            {categories.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-white/50 text-xs font-semibold uppercase tracking-wider">Quick Categories</span>
                  <button onClick={() => setActiveTab('categories')} className="text-[11px] font-semibold text-[#118bdd] hover:text-blue-300 flex items-center gap-1 transition-colors">
                    See All <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="relative">
                  <div
                    ref={quickCategoriesRef}
                    onScroll={updateQuickCategoryArrows}
                    className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1"
                    style={{ scrollbarWidth: 'none' }}
                  >
                    {categories.slice(0, 8).map((cat, idx) => {
                      const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
                      return (
                        <button
                          key={cat.id}
                          onClick={() => handleCategoryClick(cat.id)}
                          className="flex flex-col items-center gap-2 min-w-[80px] flex-shrink-0 group"
                        >
                          <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${color.bg} border border-white/[0.08] flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-200`}>
                            <DynamicIcon name={cat.icon} className={`w-6 h-6 ${color.icon}`} />
                          </div>
                          <span className="text-[10px] text-white/50 group-hover:text-white/80 font-medium text-center leading-tight transition-colors line-clamp-2 w-[76px]">{cat.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  {showQuickCategoriesLeftArrow && (
                    <button
                      type="button"
                      onClick={() => handleQuickCategoryArrowClick('left')}
                      className="absolute left-0 top-4 -translate-x-1 h-8 w-8 rounded-full border border-white/10 bg-[#0b1220]/85 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-black/30 sm:hidden z-10"
                      aria-label="Scroll categories left"
                    >
                        <ChevronLeft className="w-4 h-4 text-white/70" />
                    </button>
                  )}
                  {showQuickCategoriesRightArrow && (
                    <button
                      type="button"
                      onClick={() => handleQuickCategoryArrowClick('right')}
                      className="absolute right-0 top-4 translate-x-1 h-8 w-8 rounded-full border border-white/10 bg-[#0b1220]/85 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-black/30 sm:hidden z-10"
                      aria-label="Scroll categories right"
                    >
                        <ChevronRight className="w-4 h-4 text-white/70" />
                    </button>
                  )}
                </div>
              </section>
            )}

            {/* Top Retailers Grid */}
            <section>
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)' }}>
                    <TrendingUp className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-base sm:text-lg leading-tight">Top Retailers</h2>
                    <p className="text-white/30 text-[10px] uppercase tracking-wider font-medium">Most popular stores</p>
                  </div>
                </div>
              </div>
              {topRetailers.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                  {topRetailers.map(retailer => (
                    <RetailerCard key={retailer.id} retailer={retailer} copiedId={copiedId} onShop={handleShopNow} onShare={handleShareNow} onCopy={handleCopyLink} />
                  ))}
                </div>
              ) : (
                <EmptyState message="Top retailers will appear here" sub="Admin can add retailers from the Marketplace management panel" />
              )}
            </section>

            {/* All Retailers */}
            {allRetailers.length > topRetailers.length && (
              <section>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.06] border border-white/[0.06]">
                      <ShoppingBag className="w-4 h-4 text-white/50" />
                    </div>
                    <div>
                      <h2 className="text-white font-bold text-base sm:text-lg leading-tight">All Retailers</h2>
                      <p className="text-white/30 text-[10px] uppercase tracking-wider font-medium">{allRetailers.length} stores available</p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                  {allRetailers.filter(r => !r.isTopRetailer).map(retailer => (
                    <RetailerCard key={retailer.id} retailer={retailer} copiedId={copiedId} onShop={handleShopNow} onShare={handleShareNow} onCopy={handleCopyLink} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ============ CATEGORIES TAB ============ */}
        {activeTab === 'categories' && (
          <section>
            <div className="mb-5">
              <h2 className="text-white font-bold text-lg sm:text-xl">Browse by Category</h2>
              <p className="text-white/40 text-xs sm:text-sm mt-1">Find your favourite brands by category</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {filteredCategories.map((cat, idx) => {
                const retailerCount = allRetailers.filter(r => r.categoryId === cat.id).length;
                const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleCategoryClick(cat.id)}
                    className={`relative overflow-hidden rounded-2xl text-left group transition-all duration-300 hover:-translate-y-1 ${color.border}`}
                    style={{ background: 'linear-gradient(180deg, #111827 0%, #0d1117 100%)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    {/* Glow effect */}
                    <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br ${color.bg}`} />
                    <div className="relative p-4 sm:p-5">
                      <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br ${color.bg} border border-white/[0.06] flex items-center justify-center flex-shrink-0 mb-3 group-hover:scale-110 transition-transform duration-300`}>
                        <DynamicIcon name={cat.icon} className={`w-6 h-6 sm:w-7 sm:h-7 ${color.icon}`} />
                      </div>
                      <h3 className="text-white text-sm sm:text-base font-semibold leading-tight">{cat.name}</h3>
                      <p className="text-white/30 text-xs mt-1">{retailerCount} {retailerCount === 1 ? 'store' : 'stores'}</p>
                      <div className="mt-3 flex items-center gap-1 text-[11px] font-medium text-white/30 group-hover:text-white/60 transition-colors">
                        Explore <ArrowRight className="w-3 h-3" />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {filteredCategories.length === 0 && (
              <EmptyState message={searchTerm ? 'No categories match your search' : 'No categories available'} sub={searchTerm ? 'Try a different search term' : 'Categories will be added by the admin'} />
            )}
          </section>
        )}

        {/* ============ SUB-CATEGORIES TAB ============ */}
        {activeTab === 'sub-categories' && (
          <section className="space-y-5">
            {/* Category header */}
            {selectedCategory && (
              <div className="flex items-center gap-3 mb-1">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${CATEGORY_COLORS[(categories.indexOf(selectedCategory)) % CATEGORY_COLORS.length].bg} flex items-center justify-center`}>
                  <DynamicIcon name={selectedCategory.icon} className={`w-5 h-5 ${CATEGORY_COLORS[(categories.indexOf(selectedCategory)) % CATEGORY_COLORS.length].icon}`} />
                </div>
                <div>
                  <h2 className="text-white font-bold text-lg leading-tight">{selectedCategory.name}</h2>
                  <p className="text-white/30 text-xs">{filteredRetailers.length} stores</p>
                </div>
              </div>
            )}

            {/* Category pills */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
              <button
                onClick={() => setSelectedCategoryId(null)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                  !selectedCategoryId
                    ? 'text-white shadow-lg shadow-blue-500/20'
                    : 'bg-white/[0.04] border border-white/[0.06] text-white/50 hover:text-white/80 hover:border-white/15'
                }`}
                style={!selectedCategoryId ? { background: 'linear-gradient(135deg, #118bdd, #6366f1)' } : undefined}
              >
                All Stores
              </button>
              {categories.map((cat) => {
                const isSelected = selectedCategoryId === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategoryId(cat.id)}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition-all ${
                      isSelected
                        ? 'text-white shadow-lg shadow-blue-500/20'
                        : 'bg-white/[0.04] border border-white/[0.06] text-white/50 hover:text-white/80 hover:border-white/15'
                    }`}
                    style={isSelected ? { background: 'linear-gradient(135deg, #118bdd, #6366f1)' } : undefined}
                  >
                    <DynamicIcon name={cat.icon} className="w-3.5 h-3.5" />
                    {cat.name}
                  </button>
                );
              })}
            </div>

            {/* Filtered retailers grid */}
            {filteredRetailers.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                {filteredRetailers.map(retailer => (
                  <RetailerCard key={retailer.id} retailer={retailer} copiedId={copiedId} onShop={handleShopNow} onShare={handleShareNow} onCopy={handleCopyLink} />
                ))}
              </div>
            ) : (
              <EmptyState
                message={searchTerm ? 'No retailers match your search' : 'No retailers in this category'}
                sub={searchTerm ? 'Try a different search term' : 'Check back soon for new stores'}
              />
            )}
          </section>
        )}

        {/* ============ MY REWARDS TAB ============ */}
        {activeTab === 'my-rewards' && (
          <section className="space-y-5">
            {/* User Info + RP Dashboard */}
            <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="p-5 sm:p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)' }}>
                    <Award className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-lg leading-tight">{displayUser?.fullName || 'User'}</h2>
                    <p className="text-white/40 text-xs">ID: {displayUser?.userId}</p>
                  </div>
                </div>

                {/* RP Balance card */}
                <div className="rounded-xl p-4 mb-4" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <p className="text-white/40 text-[10px] uppercase tracking-wider font-semibold mb-1">Reward Points Balance</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl sm:text-4xl font-extrabold text-white">{userWallet?.rewardPoints || 0}</span>
                    <span className="text-sm text-white/30 font-medium">RP</span>
                  </div>
                  <p className="text-emerald-400/80 text-xs mt-1">~ ${((userWallet?.rewardPoints || 0) * 0.01).toFixed(2)} USDT</p>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p className="text-white/30 text-[9px] uppercase tracking-wider font-semibold">Earned</p>
                    <p className="text-white font-bold text-lg mt-0.5">{userWallet?.totalRewardPointsEarned || 0}</p>
                    <p className="text-white/20 text-[10px]">RP</p>
                  </div>
                  <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p className="text-white/30 text-[9px] uppercase tracking-wider font-semibold">Redeemed</p>
                    <p className="text-white font-bold text-lg mt-0.5">{userWallet?.totalRewardPointsRedeemed || 0}</p>
                    <p className="text-white/20 text-[10px]">RP</p>
                  </div>
                  <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p className="text-white/30 text-[9px] uppercase tracking-wider font-semibold">Rate</p>
                    <p className="text-emerald-400 font-bold text-lg mt-0.5">0.01</p>
                    <p className="text-white/20 text-[10px]">USDT/RP</p>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-3 mt-5 sm:mt-4">
                  <button
                    onClick={() => { setShowInvoiceForm(!showInvoiceForm); setShowRedeemForm(false); }}
                    className="w-full min-w-0 h-12 sm:h-11 rounded-xl px-2 sm:px-3 text-[13px] sm:text-sm font-bold text-white inline-flex items-center justify-center gap-1.5 sm:gap-2 transition-all active:scale-[0.98] bg-white/[0.06] border border-white/[0.1] hover:bg-white/[0.1]"
                  >
                    <Upload className="w-4 h-4 flex-shrink-0" />
                    Upload Invoice
                  </button>
                  <button
                    onClick={() => { setShowRedeemForm(!showRedeemForm); setShowInvoiceForm(false); }}
                    className="w-full min-w-0 h-12 sm:h-11 rounded-xl px-2 sm:px-3 text-[13px] sm:text-sm font-bold text-white inline-flex items-center justify-center gap-1.5 sm:gap-2 transition-all hover:shadow-lg hover:shadow-blue-500/20 active:scale-[0.98]"
                    style={{ background: 'linear-gradient(135deg, #118bdd, #6366f1)' }}
                  >
                    <Send className="w-4 h-4 flex-shrink-0" />
                    Redeem RP
                  </button>
                </div>
              </div>
            </div>

            {/* Redeem Form */}
            {showRedeemForm && (
              <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(180deg, #111827 0%, #0d1117 100%)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <h3 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
                  <Send className="w-4 h-4 text-[#118bdd]" /> Redeem Reward Points
                </h3>
                <p className="text-white/40 text-xs mb-4">Your points will be converted to USDT at 1 RP = $0.01 and credited to your Income Wallet.</p>
                <div className="space-y-3">
                  <div>
                    <label className="text-white/50 text-xs font-medium block mb-1.5">Points to Redeem</label>
                    <input
                      type="number"
                      value={redeemPoints}
                      onChange={e => setRedeemPoints(e.target.value)}
                      placeholder={`Max: ${userWallet?.rewardPoints || 0} RP`}
                      className="w-full h-11 rounded-xl px-4 text-sm bg-white/[0.06] border border-white/[0.08] text-white placeholder:text-white/30 outline-none focus:border-[#118bdd]/50"
                    />
                    {redeemPoints && parseInt(redeemPoints) > 0 && (
                      <p className="text-emerald-400/80 text-xs mt-1.5">You'll receive: ${(parseInt(redeemPoints) * 0.01).toFixed(2)} USDT</p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={handleSubmitRedemption} className="w-full min-w-0 h-11 rounded-xl px-2 sm:px-4 text-[13px] sm:text-sm font-bold text-white inline-flex items-center justify-center gap-1.5" style={{ background: 'linear-gradient(135deg, #118bdd, #6366f1)' }}>
                      Submit Request
                    </button>
                    <button onClick={() => { setShowRedeemForm(false); setRedeemPoints(''); }} className="w-full min-w-0 h-11 px-2 sm:px-4 rounded-xl text-[13px] sm:text-sm font-medium text-white/60 bg-white/[0.04] border border-white/[0.08] hover:text-white">
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Invoice Upload Form */}
            {showInvoiceForm && (
              <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(180deg, #111827 0%, #0d1117 100%)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <h3 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-[#118bdd]" /> Upload Purchase Invoice
                </h3>
                <p className="text-white/40 text-xs mb-4">Upload your purchase invoice to earn reward points. Admin will verify and assign points.</p>
                <div className="space-y-3">
                  <div>
                    <label className="text-white/50 text-xs font-medium block mb-1.5">Retailer</label>
                    <select
                      value={invoiceRetailerId}
                      onChange={e => setInvoiceRetailerId(e.target.value)}
                      className="w-full h-11 rounded-xl px-4 text-sm bg-white/[0.06] border border-white/[0.08] text-white outline-none focus:border-[#118bdd]/50 appearance-none"
                    >
                      <option value="" className="bg-[#111827]">Select retailer...</option>
                      {allRetailers.map(r => (
                        <option key={r.id} value={r.id} className="bg-[#111827]">{r.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-white/50 text-xs font-medium block mb-1.5">Purchase Amount ({userCurrencyLabel})</label>
                    <input
                      type="number"
                      value={invoiceAmount}
                      onChange={e => setInvoiceAmount(e.target.value)}
                      placeholder={`Enter purchase amount in ${userCurrencyLabel}`}
                      className="w-full h-11 rounded-xl px-4 text-sm bg-white/[0.06] border border-white/[0.08] text-white placeholder:text-white/30 outline-none focus:border-[#118bdd]/50"
                    />
                  </div>
                  <div>
                    <label className="text-white/50 text-xs font-medium block mb-1.5">Order ID</label>
                    <input
                      type="text"
                      value={invoiceOrderId}
                      onChange={e => setInvoiceOrderId(e.target.value)}
                      placeholder="Enter order ID"
                      className="w-full h-11 rounded-xl px-4 text-sm bg-white/[0.06] border border-white/[0.08] text-white placeholder:text-white/30 outline-none focus:border-[#118bdd]/50"
                    />
                  </div>
                  <div>
                    <label className="text-white/50 text-xs font-medium block mb-1.5">Invoice (JPG, PNG, or PDF)</label>
                    <label className="flex items-center gap-3 w-full h-11 rounded-xl px-4 text-sm bg-white/[0.06] border border-white/[0.08] border-dashed cursor-pointer hover:bg-white/[0.08] transition-colors">
                      <Upload className="w-4 h-4 text-white/30 flex-shrink-0" />
                      <span className={`truncate ${invoiceFileName ? 'text-white' : 'text-white/30'}`}>
                        {invoiceFileName || 'Choose file...'}
                      </span>
                      <input type="file" accept="image/jpeg,image/jpg,image/png,application/pdf" onChange={handleInvoiceImageUpload} className="hidden" />
                    </label>
                    {invoiceImage && invoiceImage.startsWith('data:image') && (
                      <div className="mt-2 rounded-lg overflow-hidden border border-white/[0.06]">
                        <img src={invoiceImage} alt="Invoice preview" className="w-full max-h-40 object-contain bg-white/5" />
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={handleSubmitInvoice} className="w-full min-w-0 h-11 rounded-xl px-2 sm:px-4 text-[13px] sm:text-sm font-bold text-white inline-flex items-center justify-center gap-1.5" style={{ background: 'linear-gradient(135deg, #118bdd, #6366f1)' }}>
                      Submit Invoice
                    </button>
                    <button onClick={() => { setShowInvoiceForm(false); setInvoiceRetailerId(''); setInvoiceOrderId(''); setInvoiceAmount(''); setInvoiceImage(''); setInvoiceFileName(''); }} className="w-full min-w-0 h-11 px-2 sm:px-4 rounded-xl text-[13px] sm:text-sm font-medium text-white/60 bg-white/[0.04] border border-white/[0.08] hover:text-white">
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Invoice History */}
            <div>
              <h3 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4 text-white/40" /> My Invoices
              </h3>
              {userInvoices.length > 0 ? (
                <div className="space-y-2">
                  {userInvoices.map(inv => (
                    <div key={inv.id} className="rounded-xl p-3.5 flex items-start gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        inv.status === 'approved' ? 'bg-emerald-500/15' :
                        inv.status === 'rejected' ? 'bg-red-500/15' : 'bg-amber-500/15'
                      }`}>
                        {inv.status === 'approved' ? <CheckCircle className="w-4 h-4 text-emerald-400" /> :
                         inv.status === 'rejected' ? <XCircle className="w-4 h-4 text-red-400" /> :
                         <Clock className="w-4 h-4 text-amber-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-white text-sm font-medium truncate">{inv.retailerName}</span>
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                            inv.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400' :
                            inv.status === 'rejected' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'
                          }`}>{inv.status}</span>
                        </div>
                        <p className="text-white/30 text-xs mt-0.5">
                          {formatAmountForCountryCurrency(inv.amount, displayUser?.country)} - {new Date(inv.createdAt).toLocaleDateString()}
                          {inv.status === 'approved' && ` - +${inv.rewardPoints} RP`}
                        </p>
                        {inv.orderId && (
                          <p className="text-white/35 text-[11px] mt-1">Order ID: {inv.orderId}</p>
                        )}
                        <div className="mt-3 space-y-2.5">
                          <button
                            type="button"
                            onClick={() => void handleViewInvoice(inv.invoiceImage)}
                            className="text-[11px] font-semibold text-[#118bdd] hover:text-blue-300 inline-flex items-center gap-1 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            View Invoice
                          </button>
                          <div className="flex flex-wrap items-center gap-2.5">
                            {inv.status === 'pending' && (
                              <button
                                type="button"
                                onClick={() => setPendingInfoInvoice(inv)}
                                className="min-h-9 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-[11px] font-semibold text-amber-300 transition-colors hover:bg-amber-400/15"
                              >
                                Why Pending?
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => navigate('/invoice-query', { state: { invoice: inv } })}
                              className="min-h-9 rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-400/15"
                            >
                              Raise Query
                            </button>
                          </div>
                        </div>
                        {inv.status === 'rejected' && inv.adminNotes && (
                          <p className="text-red-400/60 text-[10px] mt-0.5">Reason: {inv.adminNotes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl p-6 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <FileText className="w-8 h-8 text-white/10 mx-auto mb-2" />
                  <p className="text-white/30 text-sm">No invoices uploaded yet</p>
                  <p className="text-white/15 text-xs mt-0.5">Upload a purchase invoice to earn reward points</p>
                </div>
              )}
            </div>

            {/* Redemption History */}
            <div>
              <h3 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
                <Send className="w-4 h-4 text-white/40" /> My Redemptions
              </h3>
              {userRedemptions.length > 0 ? (
                <div className="space-y-2">
                  {userRedemptions.map(red => (
                    <div key={red.id} className="rounded-xl p-3.5 flex items-start gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        red.status === 'approved' ? 'bg-emerald-500/15' :
                        red.status === 'rejected' ? 'bg-red-500/15' : 'bg-amber-500/15'
                      }`}>
                        {red.status === 'approved' ? <CheckCircle className="w-4 h-4 text-emerald-400" /> :
                         red.status === 'rejected' ? <XCircle className="w-4 h-4 text-red-400" /> :
                         <Clock className="w-4 h-4 text-amber-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-white text-sm font-medium">
                            {`${red.rewardPoints} RP -> $${red.usdtAmount.toFixed(2)}`}
                          </span>
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                            red.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400' :
                            red.status === 'rejected' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'
                          }`}>{red.status}</span>
                        </div>
                        <p className="text-white/30 text-xs mt-0.5">
                          {new Date(red.createdAt).toLocaleDateString()}
                          {red.status === 'approved' && ' - Credited to Income Wallet'}
                        </p>
                        {red.status === 'rejected' && red.adminNotes && (
                          <p className="text-red-400/60 text-[10px] mt-0.5">Reason: {red.adminNotes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl p-6 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <Send className="w-8 h-8 text-white/10 mx-auto mb-2" />
                  <p className="text-white/30 text-sm">No redemption requests yet</p>
                  <p className="text-white/15 text-xs mt-0.5">Redeem your reward points for USDT</p>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
      {invoicePreview && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button
            type="button"
            onClick={closeInvoicePreview}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Close invoice preview"
          />
          <div className="relative w-full max-w-4xl rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, #111827 0%, #0d1117 100%)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.08]">
              <h3 className="text-white font-semibold text-sm">Invoice Preview</h3>
              <div className="flex items-center gap-2">
                <a
                  href={invoicePreview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-semibold text-[#118bdd] hover:text-blue-300"
                >
                  Open in New Tab
                </a>
                <button
                  type="button"
                  onClick={closeInvoicePreview}
                  className="h-8 px-3 rounded-lg text-xs font-medium text-white/70 bg-white/[0.04] border border-white/[0.08] hover:text-white"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="h-[75vh] bg-[#0b1220]">
              {invoicePreview.mimeType.startsWith('image/') ? (
                <img src={invoicePreview.url} alt="Invoice preview" className="w-full h-full object-contain" />
              ) : (
                <iframe src={invoicePreview.url} title="Invoice preview" className="w-full h-full bg-white" />
              )}
            </div>
          </div>
        </div>
      )}
      {pendingInfoInvoice && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4">
          <button
            type="button"
            onClick={() => setPendingInfoInvoice(null)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Close pending information"
          />
          <div
            className="relative w-full max-w-lg overflow-hidden rounded-[28px] text-white shadow-2xl"
            style={{ background: 'linear-gradient(180deg, #111827 0%, #0d1117 100%)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(17,139,221,0.18),transparent_32%),radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_26%)]" />
            <button
              type="button"
              onClick={() => setPendingInfoInvoice(null)}
              className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close pending information"
            >
              <XCircle className="h-5 w-5" />
            </button>
            <div className="relative px-6 pb-8 pt-7 sm:px-8">
              <div className="flex items-center gap-3 pr-12">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10 text-amber-300">
                  <Clock className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="text-lg font-bold uppercase tracking-tight text-white">
                    {pendingInfoInvoice.retailerName}
                  </p>
                  <p className="mt-1 text-xs font-medium uppercase tracking-[0.22em] text-amber-300/80">
                    Pending Invoice
                  </p>
                </div>
              </div>
              <div className="mt-5 border-b border-dashed border-white/10" />
              <div className="mt-6 rounded-2xl border border-white/8 bg-white/[0.03] p-5 sm:p-6">
                <div className="space-y-4 text-[15px] leading-8 text-white/75 sm:text-base">
                <p>
                  Your profit has been tracked and will be processed by the brand after the return or cancellation period.
                </p>
                <p>
                  If approved, it will be confirmed. If the order is returned, cancelled, or does not meet the terms and conditions, it may be cancelled.
                </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <MobileBottomNav />
    </div>
  );
}

// ==================== RETAILER CARD COMPONENT ====================

function RetailerCard({ retailer, copiedId, onShop, onShare, onCopy }: {
  retailer: MarketplaceRetailer;
  copiedId: string | null;
  onShop: (url: string) => void;
  onShare: (retailer: MarketplaceRetailer) => void;
  onCopy: (retailer: MarketplaceRetailer) => void;
}) {
  const isCopied = copiedId === retailer.id;
  const shopUrl = retailer.websiteUrl || retailer.affiliateLink;
  const badgeText = retailer.badgeText?.trim();

  return (
    <div
      className="relative rounded-2xl overflow-hidden group transition-all duration-300 hover:-translate-y-1"
      style={{ background: 'linear-gradient(180deg, #111827 0%, #0d1117 100%)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* Discount ribbon */}
      {badgeText && (
        <div className="absolute inset-x-0 top-0 z-10">
          <div
            className="flex min-h-[2.5rem] w-full items-center justify-center px-4 py-2 text-center text-[10px] font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
          >
            {badgeText}
          </div>
        </div>
      )}

      {/* Card content */}
      <div className={`px-4 pb-3 ${badgeText ? 'pt-16' : 'pt-6'}`}>
        {/* Logo area */}
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => { if (shopUrl) onShop(shopUrl); }}
            className={`relative focus:outline-none focus-visible:ring-2 focus-visible:ring-[#118bdd]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1117] ${shopUrl ? 'cursor-pointer' : 'cursor-default'}`}
            aria-label={`Shop ${retailer.name}`}
          >
            {retailer.logoUrl ? (
              <div className="w-20 h-20 sm:w-[90px] sm:h-[90px] rounded-2xl overflow-hidden border-2 border-white/[0.08] shadow-lg shadow-black/20 p-2" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <img src={retailer.logoUrl} alt={retailer.name} className="w-full h-full rounded-xl object-contain" />
              </div>
            ) : (
              <div className="w-20 h-20 sm:w-[90px] sm:h-[90px] rounded-2xl flex items-center justify-center shadow-lg shadow-black/20" style={{ background: 'linear-gradient(135deg, #1e40af, #6366f1)', border: '2px solid rgba(255,255,255,0.1)' }}>
                <span className="text-white font-black text-2xl">{retailer.name.charAt(0)}</span>
              </div>
            )}
          </button>
          <h3 className="text-white text-sm sm:text-base font-semibold mt-3 text-center w-full leading-tight break-words whitespace-normal min-h-[2.5rem] flex items-center justify-center">
            {retailer.name}
          </h3>
          {retailer.discountText?.trim() && (
            <div className="mt-2 inline-flex items-center gap-1 px-3 py-1 rounded-full" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.15))', border: '1px solid rgba(16,185,129,0.2)' }}>
              <span className="text-[11px] font-bold text-emerald-400">{retailer.discountText.trim()}</span>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-4 pb-4 space-y-2">
        <button
          onClick={() => { if (shopUrl) onShop(shopUrl); }}
          className="w-full h-10 rounded-xl text-sm font-bold text-white inline-flex items-center justify-center gap-1.5 transition-all hover:shadow-lg hover:shadow-blue-500/20 active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg, #118bdd, #6366f1)' }}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Shop Now
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => onShare(retailer)}
            className="flex-1 h-10 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white hover:border-white/20 hover:bg-white/[0.08]"
          >
            <Share2 className="w-3.5 h-3.5" />
            Share
          </button>
          <button
            onClick={() => onCopy(retailer)}
            className={`h-10 px-3.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] border ${
              isCopied
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-white/[0.04] border-white/[0.08] text-white/60 hover:text-white hover:border-white/20 hover:bg-white/[0.08]'
            }`}
          >
            {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Hover glow */}
      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ boxShadow: 'inset 0 1px 0 0 rgba(99,102,241,0.15), 0 0 20px rgba(17,139,221,0.08)' }} />
    </div>
  );
}

// ==================== EMPTY STATE COMPONENT ====================

function EmptyState({ message, sub }: { message: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, rgba(17,139,221,0.1), rgba(99,102,241,0.1))', border: '1px solid rgba(255,255,255,0.06)' }}>
        <ShoppingBag className="w-8 h-8 text-white/20" />
      </div>
      <p className="text-white/40 text-sm font-medium">{message}</p>
      <p className="text-white/20 text-xs mt-1">{sub}</p>
    </div>
  );
}

