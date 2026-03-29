import { useEffect, useMemo, useRef, useState, useCallback, type ChangeEvent } from 'react';
import { useAuthStore, useAdminStore } from '@/store';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Users, ArrowLeft, TrendingUp, Wallet, Shield,
  Settings, DollarSign, Search, CheckCircle, RefreshCw, Download, Clock,
  CreditCard, XCircle, Eye, LogOut, IdCard, Ticket, UserCog,
  BarChart3, Copy, Check, Ban, UserCheck, ArrowUp, ArrowDown, MessageCircle, Share2,
  ShoppingBag, Plus, Pencil, Trash2, FileText, Award, Megaphone, ImagePlus, Maximize2, RotateCcw, EyeOff,
  AlertTriangle, Wrench
} from 'lucide-react';
import {
  formatCurrency,
  formatNumber,
  formatDate,
  getInitials,
  generateAvatarColor,
  getTransactionTypeLabel,
  getVisibleTransactionDescription,
  getPasswordRequirementsText,
  getTransactionPasswordRequirementsText,
  isStrongPassword,
  isValidTransactionPassword,
  readOptimizedUploadDataUrl
} from '@/utils/helpers';
import { toast } from 'sonner';
import Database, { DB_KEYS, helpDistributionTable } from '@/db';
import type { Payment, PaymentMethod, PaymentMethodType, Pin, Transaction, SupportTicket, SupportTicketAttachment, SupportTicketStatus, MarketplaceCategory, MarketplaceRetailer, MarketplaceBanner, MarketplaceDeal, AdminAnnouncement, MatrixNode } from '@/types';
import MobileBottomNav from '@/components/MobileBottomNav';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

interface MemberReportRow {
  id: string;
  createdAt: string;
  userId: string;
  name: string;
  mobile: string;
  sponsorId: string;
  sponsorName: string;
  currentLevelDisplay: string;
  qualifiedLevel: number;
  achievedOffer: string;
  blockStatus: 'active' | 'inactive' | 'temp_blocked' | 'permanent_blocked';
}

interface ReceiveHelpReportRow {
  id: string;
  createdAt: string;
  userId: string;
  userName: string;
  amount: number;
  level: number;
  fromUserId: string;
  fromUserName: string;
}

interface GiveHelpReportRow {
  id: string;
  createdAt: string;
  userId: string;
  userName: string;
  amount: number;
  level: number;
  giveToId: string;
  giveToUserName: string;
}

interface OfferAchieverReportRow {
  achievedAt: string;
  userId: string;
  name: string;
  mobile: string;
  qualifiedLevel: number;
  offerAchieved: string;
  sponsorId: string;
  sponsorName: string;
  sponsorMobile: string;
}

interface DepositReportRow {
  id: string;
  createdAt: string;
  userId: string;
  userName: string;
  amount: number;
  method: string;
  status: string;
  txHash?: string;
}

interface WithdrawalReportRow {
  id: string;
  createdAt: string;
  userId: string;
  userName: string;
  amount: number;
  status: string;
  description: string;
}

interface WithdrawalGapScanRow {
  otpId: string;
  userId: string;
  internalUserId: string;
  fullName: string;
  email: string;
  otpCreatedAt: string;
  issue: string;
}

interface PaymentMethodDraft {
  type: PaymentMethodType;
  name: string;
  description: string;
  instructions: string;
  walletAddress: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  upiId: string;
  qrCode: string;
  minAmount: string;
  maxAmount: string;
  processingFee: string;
  processingTime: string;
}

interface LockedIncomeReportRow {
  userId: string;
  name: string;
  lockedAmount: number;
  directCount: number;
  requiredDirect: number;
  currentLevel: number;
}

type BulkCreateProgress = {
  stage: 'creating' | 'finalizing' | 'syncing' | 'completed' | 'failed';
  processed: number;
  total: number;
  created: number;
  failed: number;
  message: string;
};

const isDateInRange = (date: string, from?: string, to?: string) => {
  const current = new Date(date).getTime();
  if (from) {
    const fromTime = new Date(`${from}T00:00:00`).getTime();
    if (current < fromTime) return false;
  }
  if (to) {
    const toTime = new Date(`${to}T23:59:59`).getTime();
    if (current > toTime) return false;
  }
  return true;
};

const getOfferName = (user: any) => {
  if (user.achievements?.familyTour) return 'International Family Tour Achiever';
  if (user.achievements?.internationalTour) return 'International Tour Achiever';
  if (user.achievements?.nationalTour) return 'National Tour Achiever';
  return '-';
};

const safeLower = (value: unknown): string => String(value ?? '').toLowerCase();
const safeText = (value: unknown): string => String(value ?? '');
const DELETE_ALL_IDS_PHRASE = 'DELETE ALL IDS';
const SUPPORT_STATUS_OPTIONS: Array<{ value: SupportTicketStatus; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'awaiting_user_response', label: 'Awaiting User Response' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' }
];

const SUPPORT_CATEGORY_LABELS: Record<string, string> = {
  profile_update: 'Profile Update',
  deposit_withdrawal: 'Deposit / Withdrawal',
  network_matrix: 'My Network / Matrix',
  activation_pin: 'Activation PIN',
  affiliate_shopping: 'Affiliate Shopping',
  other: 'Other',
  // Legacy
  account_issues: 'Account Issues',
  deposit_payment_issues: 'Deposit / Payment Issues',
  withdrawal_issues: 'Withdrawal Issues',
  referral_matrix_issues: 'Referral / Matrix Issues',
  technical_issues: 'Technical Issues'
};

// ==================== MARKETPLACE FORM COMPONENTS ====================

function MarketplaceRetailerForm({ retailer, categories, onSave, onCancel }: {
  retailer: MarketplaceRetailer | null;
  categories: MarketplaceCategory[];
  onSave: (data: Partial<MarketplaceRetailer>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(retailer?.name || '');
  const [logoUrl, setLogoUrl] = useState(retailer?.logoUrl || '');
  const [badgeText, setBadgeText] = useState(retailer?.badgeText || (retailer?.discountPercent ? `${retailer.discountPercent}% OFF` : ''));
  const [discountText, setDiscountText] = useState(retailer?.discountText || '');
  const [websiteUrl, setWebsiteUrl] = useState(retailer?.websiteUrl || '');
  const [affiliateLink, setAffiliateLink] = useState(retailer?.affiliateLink || '');
  const initialCategoryId = retailer?.categoryId && categories.some(c => c.id === retailer.categoryId)
    ? retailer.categoryId
    : (categories[0]?.id || '');
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [isTopRetailer, setIsTopRetailer] = useState(retailer?.isTopRetailer ?? false);
  const [isActive, setIsActive] = useState(retailer?.isActive ?? true);
  const [sortOrder, setSortOrder] = useState(retailer?.sortOrder?.toString() || '0');

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        const dataUrl = await readOptimizedUploadDataUrl(file, {
          maxDimension: 1600,
          targetBytes: 500 * 1024,
          quality: 0.84
        });
        setLogoUrl(dataUrl);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Unable to read retailer logo');
      }
    })();
  };

  return (
    <div className="p-4 bg-[#1a2332] rounded-lg border border-white/10 space-y-3">
      <h4 className="text-white font-medium text-sm">{retailer ? 'Edit Retailer' : 'Add Retailer'}</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Name *</Label>
          <Input value={name} onChange={e => setName(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" placeholder="Amazon" />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Category</Label>
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="w-full h-9 bg-[#1f2937] border border-white/10 text-white rounded-md px-2 text-sm">
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Top Right Badge</Label>
          <Input value={badgeText} onChange={e => setBadgeText(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" placeholder="Special Offer" />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Discounted Text</Label>
          <Input value={discountText} onChange={e => setDiscountText(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" placeholder="Loan Upto Rs 75 Lakhs" />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Website URL</Label>
          <Input value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" placeholder="https://amazon.com" />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Affiliate Link</Label>
          <Input value={affiliateLink} onChange={e => setAffiliateLink(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" placeholder="https://..." />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Sort Order</Label>
          <Input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Logo Image</Label>
          <Input type="file" accept="image/*" onChange={handleLogoUpload} className="bg-[#1f2937] border-white/10 text-white h-9 text-xs" />
          {logoUrl && <img src={logoUrl} alt="Logo" className="w-10 h-10 rounded mt-1 object-cover" />}
        </div>
      </div>
      <div className="flex gap-4 items-center">
        <label className="flex items-center gap-2 text-white/70 text-xs cursor-pointer">
          <input type="checkbox" checked={isTopRetailer} onChange={e => setIsTopRetailer(e.target.checked)} className="rounded" />
          Top Retailer
        </label>
        <label className="flex items-center gap-2 text-white/70 text-xs cursor-pointer">
          <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="rounded" />
          Active
        </label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="bg-[#118bdd]" disabled={!name} onClick={() => onSave({ name, logoUrl, badgeText: badgeText.trim(), discountPercent: retailer?.discountPercent || 0, discountText: discountText.trim(), websiteUrl, affiliateLink, categoryId, isTopRetailer, isActive, sortOrder: Number(sortOrder) })}>
          {retailer ? 'Update' : 'Create'}
        </Button>
        <Button size="sm" variant="outline" className="border-white/20 text-white/70" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function MarketplaceCategoryForm({ category, onSave, onCancel }: {
  category: MarketplaceCategory | null;
  onSave: (data: Partial<MarketplaceCategory>) => void;
  onCancel: () => void;
}) {
  const ICON_OPTIONS = ['Star', 'GraduationCap', 'Laptop', 'Shirt', 'Landmark', 'Briefcase', 'Plane', 'Pill', 'UtensilsCrossed', 'Heart', 'Home', 'ShoppingBag', 'Gift', 'Music', 'Camera', 'Gamepad2', 'Dumbbell', 'Baby', 'Car', 'Smartphone'];
  const [name, setName] = useState(category?.name || '');
  const [slug, setSlug] = useState(category?.slug || '');
  const [icon, setIcon] = useState(category?.icon || 'Star');
  const [sortOrder, setSortOrder] = useState(category?.sortOrder?.toString() || '0');
  const [isActive, setIsActive] = useState(category?.isActive ?? true);

  return (
    <div className="p-4 bg-[#1a2332] rounded-lg border border-white/10 space-y-3">
      <h4 className="text-white font-medium text-sm">{category ? 'Edit Category' : 'Add Category'}</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Name *</Label>
          <Input value={name} onChange={e => { setName(e.target.value); if (!category) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-')); }} className="bg-[#1f2937] border-white/10 text-white h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Slug</Label>
          <Input value={slug} onChange={e => setSlug(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Icon</Label>
          <select value={icon} onChange={e => setIcon(e.target.value)} className="w-full h-9 bg-[#1f2937] border border-white/10 text-white rounded-md px-2 text-sm">
            {ICON_OPTIONS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Sort Order</Label>
          <Input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-white/70 text-xs cursor-pointer">
        <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="rounded" />
        Active
      </label>
      <div className="flex gap-2">
        <Button size="sm" className="bg-[#118bdd]" disabled={!name} onClick={() => onSave({ name, slug, icon, sortOrder: Number(sortOrder), isActive })}>
          {category ? 'Update' : 'Create'}
        </Button>
        <Button size="sm" variant="outline" className="border-white/20 text-white/70" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function MarketplaceBannerForm({ banner, onSave, onCancel }: {
  banner: MarketplaceBanner | null;
  onSave: (data: Partial<MarketplaceBanner>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(banner?.title || '');
  const [subtitle, setSubtitle] = useState(banner?.subtitle || '');
  const [imageUrl, setImageUrl] = useState(banner?.imageUrl || '');
  const [linkUrl, setLinkUrl] = useState(banner?.linkUrl || '');
  const [sortOrder, setSortOrder] = useState(banner?.sortOrder?.toString() || '0');
  const [isActive, setIsActive] = useState(banner?.isActive ?? true);

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        const dataUrl = await readOptimizedUploadDataUrl(file, {
          maxDimension: 1800,
          targetBytes: 650 * 1024,
          quality: 0.84
        });
        setImageUrl(dataUrl);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Unable to read banner image');
      }
    })();
  };

  return (
    <div className="p-4 bg-[#1a2332] rounded-lg border border-white/10 space-y-3">
      <h4 className="text-white font-medium text-sm">{banner ? 'Edit Banner' : 'Add Banner'}</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Title *</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Subtitle</Label>
          <Input value={subtitle} onChange={e => setSubtitle(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Link URL</Label>
          <Input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" placeholder="https://..." />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Sort Order</Label>
          <Input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-white/70 text-xs">Banner Image</Label>
          <Input type="file" accept="image/*" onChange={handleImageUpload} className="bg-[#1f2937] border-white/10 text-white h-9 text-xs" />
          {imageUrl && <img src={imageUrl} alt="Banner" className="w-full max-w-xs h-20 rounded mt-1 object-cover" />}
        </div>
      </div>
      <label className="flex items-center gap-2 text-white/70 text-xs cursor-pointer">
        <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="rounded" />
        Active
      </label>
      <div className="flex gap-2">
        <Button size="sm" className="bg-[#118bdd]" disabled={!title} onClick={() => onSave({ title, subtitle, imageUrl, linkUrl, sortOrder: Number(sortOrder), isActive })}>
          {banner ? 'Update' : 'Create'}
        </Button>
        <Button size="sm" variant="outline" className="border-white/20 text-white/70" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function MarketplaceDealForm({ deal, retailers, onSave, onCancel }: {
  deal: MarketplaceDeal | null;
  retailers: MarketplaceRetailer[];
  onSave: (data: Partial<MarketplaceDeal>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(deal?.title || '');
  const [description, setDescription] = useState(deal?.description || '');
  const [imageUrl, setImageUrl] = useState(deal?.imageUrl || '');
  const [linkUrl, setLinkUrl] = useState(deal?.linkUrl || '');
  const [retailerId, setRetailerId] = useState(deal?.retailerId || (retailers[0]?.id || ''));
  const [badgeText, setBadgeText] = useState(deal?.badgeText || '');
  const [sortOrder, setSortOrder] = useState(deal?.sortOrder?.toString() || '0');
  const [isActive, setIsActive] = useState(deal?.isActive ?? true);
  const [startDate, setStartDate] = useState(deal?.startDate || '');
  const [endDate, setEndDate] = useState(deal?.endDate || '');

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        const dataUrl = await readOptimizedUploadDataUrl(file, {
          maxDimension: 1800,
          targetBytes: 650 * 1024,
          quality: 0.84
        });
        setImageUrl(dataUrl);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Unable to read deal image');
      }
    })();
  };

  return (
    <div className="p-4 bg-[#1a2332] rounded-lg border border-white/10 space-y-3">
      <h4 className="text-white font-medium text-sm">{deal ? 'Edit Deal' : 'Add Deal'}</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Title *</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Retailer</Label>
          <select value={retailerId} onChange={e => setRetailerId(e.target.value)} className="w-full h-9 bg-[#1f2937] border border-white/10 text-white rounded-md px-2 text-sm">
            {retailers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-white/70 text-xs">Description</Label>
          <Input value={description} onChange={e => setDescription(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Badge Text</Label>
          <Input value={badgeText} onChange={e => setBadgeText(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" placeholder="Hot Deal" />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Link URL</Label>
          <Input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Start Date</Label>
          <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">End Date</Label>
          <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Sort Order</Label>
          <Input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} className="bg-[#1f2937] border-white/10 text-white h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-white/70 text-xs">Deal Image</Label>
          <Input type="file" accept="image/*" onChange={handleImageUpload} className="bg-[#1f2937] border-white/10 text-white h-9 text-xs" />
          {imageUrl && <img src={imageUrl} alt="Deal" className="w-12 h-12 rounded mt-1 object-cover" />}
        </div>
      </div>
      <label className="flex items-center gap-2 text-white/70 text-xs cursor-pointer">
        <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="rounded" />
        Active
      </label>
      <div className="flex gap-2">
        <Button size="sm" className="bg-[#118bdd]" disabled={!title} onClick={() => onSave({ title, description, imageUrl, linkUrl, retailerId, badgeText, sortOrder: Number(sortOrder), isActive, startDate, endDate })}>
          {deal ? 'Update' : 'Create'}
        </Button>
        <Button size="sm" variant="outline" className="border-white/20 text-white/70" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export default function Admin() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout, adminLoginAsUser } = useAuthStore();
  const {
    stats, settings, allUsers, allTransactions, safetyPoolAmount, allPins, allPinRequests, pendingPinRequests,
    loadStats, loadSettings, loadAllUsers, loadAllTransactions, loadAllPins, loadAllPinRequests, loadPendingPinRequests,
    updateSettings, addFundsToUser, generatePins, approvePinPurchase, rejectPinPurchase, reopenPinPurchase,
    suspendPin, unsuspendPin, blockUser, unblockUser, reactivateAutoDeactivatedUser, bulkCreateUsersWithoutPin, createServerBackup,
    deleteAllIdsFromSystem, getLevelWiseReport,
    marketplaceCategories, marketplaceRetailers, marketplaceBanners, marketplaceDeals,
    marketplaceInvoices, marketplaceRedemptions,
    loadMarketplaceData
  } = useAdminStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [topReferrerLimit, setTopReferrerLimit] = useState<10 | 20>(10);
  const [allUsersSortBy, setAllUsersSortBy] = useState<'joined' | 'level' | 'earnings' | 'team' | 'direct'>('direct');
  const [allUsersSortDirection, setAllUsersSortDirection] = useState<'asc' | 'desc'>('desc');
  const [bulkNoPin, setBulkNoPin] = useState({
    sponsorUserId: '',
    quantity: 1,
    namePrefix: 'Member',
    country: 'India',
    password: 'user123',
    transactionPassword: '1234'
  });
  const [bulkNoPinLoading, setBulkNoPinLoading] = useState(false);
  const [bulkNoPinCreated, setBulkNoPinCreated] = useState<string[]>([]);
  const [bulkNoPinFailed, setBulkNoPinFailed] = useState<string[]>([]);
  const [bulkNoPinProgress, setBulkNoPinProgress] = useState<BulkCreateProgress | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [fundAmount, setFundAmount] = useState('');
  const [fundWalletType, setFundWalletType] = useState<'deposit' | 'income' | 'royalty'>('deposit');
  const [fundMessage, setFundMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [orphanedPinCount, setOrphanedPinCount] = useState(0);
  const orphanedPinsNotifiedRef = useRef(false);
  const [pendingPayments, setPendingPayments] = useState<Payment[]>([]);
  const [depositHistory, setDepositHistory] = useState<Payment[]>([]);
  const [depositHistoryStatusFilter, setDepositHistoryStatusFilter] = useState<'all' | 'pending' | 'under_review' | 'completed' | 'failed' | 'reversed'>('all');
  const [withdrawalRequests, setWithdrawalRequests] = useState<Transaction[]>([]);
  const [withdrawalStatusFilter, setWithdrawalStatusFilter] = useState<'all' | 'pending' | 'completed' | 'failed'>('pending');
  const [withdrawalReasonDrafts, setWithdrawalReasonDrafts] = useState<Record<string, string>>({});
  const [withdrawalReceiptDrafts, setWithdrawalReceiptDrafts] = useState<Record<string, string>>({});
  const [copiedWithdrawalAddressId, setCopiedWithdrawalAddressId] = useState<string | null>(null);
  const [fullscreenQr, setFullscreenQr] = useState<{ src: string; userId: string } | null>(null);
  const [fullscreenPaymentProof, setFullscreenPaymentProof] = useState<{ src: string; userId: string } | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [editingPaymentMethodId, setEditingPaymentMethodId] = useState<string | null>(null);
  const [paymentMethodDraft, setPaymentMethodDraft] = useState<PaymentMethodDraft | null>(null);
  const [selectedWithdrawalRequest, setSelectedWithdrawalRequest] = useState<Transaction | null>(null);
  const [showWithdrawalRequestDialog, setShowWithdrawalRequestDialog] = useState(false);
  const [withdrawalGapScanResults, setWithdrawalGapScanResults] = useState<WithdrawalGapScanRow[]>([]);
  const [showWithdrawalGapDialog, setShowWithdrawalGapDialog] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [userSearchId, setUserSearchId] = useState('');
  const [searchedUser, setSearchedUser] = useState<any>(null);
  const [missingMatrixNode, setMissingMatrixNode] = useState<MatrixNode | null>(null);
  const [missingUserRecovery, setMissingUserRecovery] = useState({
    userId: '',
    fullName: '',
    email: '',
    phone: '',
    country: '',
    sponsorId: '',
    loginPassword: '',
    transactionPassword: '',
    restoreSponsorIncome: true
  });
  const [isRecoveringUser, setIsRecoveringUser] = useState(false);

  // PIN Management
  const [pinQuantity, setPinQuantity] = useState(1);
  const [pinRecipientId, setPinRecipientId] = useState('');
  const [generatedPins, setGeneratedPins] = useState<Pin[]>([]);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [copiedPin, setCopiedPin] = useState<string | null>(null);
  const [pinSuspendReason, setPinSuspendReason] = useState('Admin action');
  const [pinRequestStatusFilter, setPinRequestStatusFilter] = useState<'all' | 'pending' | 'completed' | 'cancelled'>('all');
  const [isPinRefreshing, setIsPinRefreshing] = useState(false);
  const [pinListLimit, setPinListLimit] = useState(0);
  const [pinSearchInput, setPinSearchInput] = useState('');
  const [pinSearchQuery, setPinSearchQuery] = useState('');
  const [takeBackUserId, setTakeBackUserId] = useState('');
  const [takeBackQuantity, setTakeBackQuantity] = useState(1);
  const [takeBackReason, setTakeBackReason] = useState('');
  const [isTakingBack, setIsTakingBack] = useState(false);

  // Master Password
  const [masterPassword, setMasterPassword] = useState('');
  const [impersonateUserId, setImpersonateUserId] = useState('');

  // Level-wise Report
  const [reportLevel, setReportLevel] = useState<string>('');
  const [levelReport, setLevelReport] = useState<any[]>([]);
  const [reportTab, setReportTab] = useState('member-report');
  const [activeMainTab, setActiveMainTab] = useState('users');
  const [reportsDataLoaded, setReportsDataLoaded] = useState(false);
  const [supportDataLoaded, setSupportDataLoaded] = useState(false);
  const [announcementData, setAnnouncementData] = useState({
    title: 'Important Announcement',
    message: '',
    imageUrl: '',
    isPermanent: true,
    durationDays: '3',
    includeFutureUsers: true
  });
  const [isSendingAnnouncement, setIsSendingAnnouncement] = useState(false);
  const [isUpdatingAnnouncement, setIsUpdatingAnnouncement] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<AdminAnnouncement | null>(null);
  const [announcementHistory, setAnnouncementHistory] = useState<AdminAnnouncement[]>([]);
  const [adminUserProfile, setAdminUserProfile] = useState({
    fullName: '',
    email: '',
    phone: '',
    usdtAddress: '',
    loginPassword: '',
    transactionPassword: ''
  });
  const [showAdminLoginPassword, setShowAdminLoginPassword] = useState(false);
  const [showAdminTransactionPassword, setShowAdminTransactionPassword] = useState(false);
  const [isUpdatingUserProfile, setIsUpdatingUserProfile] = useState(false);
  const [restoreReceiveHelpFromId, setRestoreReceiveHelpFromId] = useState('');
  const [restoreReceiveHelpLevel, setRestoreReceiveHelpLevel] = useState('');
  const [restoreReceiveHelpHistoryOnly, setRestoreReceiveHelpHistoryOnly] = useState(true);
  const [manualQualifiedLevelValue, setManualQualifiedLevelValue] = useState('1');
  const [isRepairingIncomingHelp, setIsRepairingIncomingHelp] = useState(false);
  const [isRestoringReceiveHelp, setIsRestoringReceiveHelp] = useState(false);
  const [isManualCreditingReceiveHelp, setIsManualCreditingReceiveHelp] = useState(false);
  const [isRepairingSelfFundCredits, setIsRepairingSelfFundCredits] = useState(false);
  const [isRecalculatingQualifiedLevel, setIsRecalculatingQualifiedLevel] = useState(false);
  const [isMarkingLevelHelpComplete, setIsMarkingLevelHelpComplete] = useState(false);
  const [isReversingTemporarySelfFundCredits, setIsReversingTemporarySelfFundCredits] = useState(false);
  const [isRemovingBrokenSelfTransferHistory, setIsRemovingBrokenSelfTransferHistory] = useState(false);
  const [isScanningHelpMismatches, setIsScanningHelpMismatches] = useState(false);
  const [isReversingInvalidRestoredHelp, setIsReversingInvalidRestoredHelp] = useState(false);
  const [restoringFromGiveHelpTxId, setRestoringFromGiveHelpTxId] = useState<string | null>(null);

  // Marketplace admin state
  const [mktSubTab, setMktSubTab] = useState<'banners' | 'deals' | 'categories' | 'retailers' | 'invoices' | 'redemptions'>('retailers');
  const [mktEditingBanner, setMktEditingBanner] = useState<MarketplaceBanner | null>(null);
  const [mktEditingDeal, setMktEditingDeal] = useState<MarketplaceDeal | null>(null);
  const [mktEditingCategory, setMktEditingCategory] = useState<MarketplaceCategory | null>(null);
  const [mktEditingRetailer, setMktEditingRetailer] = useState<MarketplaceRetailer | null>(null);
  const [mktShowForm, setMktShowForm] = useState(false);

  const syncMarketplaceChanges = useCallback(async (work: () => unknown, successMessage: string) => {
    try {
      await Database.commitCriticalAction(() => {
        work();
        return true;
      }, { timeoutMs: 30000, maxAttempts: 3, retryDelayMs: 1500 });
      await Database.hydrateFromServerBatches(
        [[
          'mlm_marketplace_categories',
          'mlm_marketplace_retailers',
          'mlm_marketplace_banners',
          'mlm_marketplace_deals',
        ]],
        { strict: false, maxAttempts: 1, timeoutMs: 15000, retryDelayMs: 500, continueOnError: true, requireAnySuccess: false }
      );
      loadMarketplaceData();
      toast.success(successMessage);
    } catch (error) {
      console.warn('Marketplace sync failed:', error);
      loadMarketplaceData();
      toast.error(error instanceof Error ? error.message : 'Failed to save marketplace changes to backend.');
    }
  }, [loadMarketplaceData]);

  const [helpFlowView, setHelpFlowView] = useState<'sent' | 'received'>('sent');
  const [helpFlowDebugTick, setHelpFlowDebugTick] = useState(0);
  const [ghostRepairLogTick, setGhostRepairLogTick] = useState(0);

  const [memberFilters, setMemberFilters] = useState({
    dateFrom: '',
    dateTo: '',
    userId: '',
    name: '',
    level: '',
    sponsorId: '',
    sponsorName: '',
    offer: '',
    blockStatus: ''
  });

  const [receiveFilters, setReceiveFilters] = useState({
    dateFrom: '',
    dateTo: '',
    userId: '',
    userName: '',
    level: '',
    amountMin: '',
    amountMax: ''
  });

  const [giveFilters, setGiveFilters] = useState({
    dateFrom: '',
    dateTo: '',
    userId: '',
    userName: '',
    amountMin: '',
    amountMax: ''
  });

  const [offerFilters, setOfferFilters] = useState({
    dateFrom: '',
    dateTo: '',
    userId: '',
    name: '',
    level: '',
    offer: '',
    sponsorId: '',
    sponsorName: ''
  });

  const [allLevelFilters, setAllLevelFilters] = useState({
    dateFrom: '',
    dateTo: '',
    userId: '',
    name: '',
    sponsorId: ''
  });

  const [safetyPoolFilters, setSafetyPoolFilters] = useState({
    dateFrom: '',
    dateTo: '',
    userId: '',
    reason: ''
  });

  const [depositReportFilters, setDepositReportFilters] = useState({
    dateFrom: '',
    dateTo: '',
    userId: '',
    userName: '',
    status: ''
  });

  const [withdrawalReportFilters, setWithdrawalReportFilters] = useState({
    dateFrom: '',
    dateTo: '',
    userId: '',
    userName: '',
    status: ''
  });

  const [lockedIncomeFilters, setLockedIncomeFilters] = useState({
    userId: '',
    name: '',
    minAmount: ''
  });
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [supportStatusFilter, setSupportStatusFilter] = useState<'all' | SupportTicketStatus>('all');
  const [supportSearch, setSupportSearch] = useState('');
  const [selectedSupportTicketId, setSelectedSupportTicketId] = useState('');
  const [supportStatusDraft, setSupportStatusDraft] = useState<SupportTicketStatus>('open');
  const [supportReplyMessage, setSupportReplyMessage] = useState('');
  const [supportReplyAttachment, setSupportReplyAttachment] = useState<SupportTicketAttachment | null>(null);
  const [editingSupportMessageId, setEditingSupportMessageId] = useState('');
  const [editingSupportMessageText, setEditingSupportMessageText] = useState('');
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isRepairingPins, setIsRepairingPins] = useState(false);
  const [showDeleteAllIdsDialog, setShowDeleteAllIdsDialog] = useState(false);
  const [deleteAllIdsPhrase, setDeleteAllIdsPhrase] = useState('');
  const [deleteAllIdsAdminId, setDeleteAllIdsAdminId] = useState('');
  const [isDeletingAllIds, setIsDeletingAllIds] = useState(false);
  const adminBootstrapUserRef = useRef<string | null>(null);
  const deleteAllIdsArmed =
    deleteAllIdsPhrase.trim().toUpperCase() === DELETE_ALL_IDS_PHRASE
    && deleteAllIdsAdminId.trim() === (user?.userId || '');

  const helpFlowDebugEntries = searchedUser
    ? Database.getHelpFlowDebugForUser(searchedUser.id, helpFlowView, 50 + helpFlowDebugTick * 0)
    : [];

  const isReportsTabActive = activeMainTab === 'reports';
  const isSupportTabActive = activeMainTab === 'support';
  const isPaymentsTabActive = activeMainTab === 'payments';

  const reloadAdminDataFromBrowserState = () => {
    loadStats();
    loadSettings();
    loadAllUsers();
    void loadAnnouncementHistory();
    loadAllPins();
    loadAllPinRequests();
    loadPendingPinRequests();
    loadPayments();
    loadDepositHistory();
    loadWithdrawalRequests();
    loadPaymentMethods();
    loadMarketplaceData();
  };

  const runAdminRefresh = useCallback(async () => {
    if (import.meta.env.PROD) {
      try {
        await Database.hydrateFromServerBatches(Database.getAdminCriticalRemoteSyncBatches(), {
          strict: true,
          maxAttempts: 2,
          timeoutMs: 45000,
          retryDelayMs: 1500,
          continueOnError: true,
          requireAnySuccess: true,
          onBatchError: (keys, error) => {
            console.warn('Manual admin refresh hydrate failed for keys:', keys, error);
          }
        });
      } catch (error) {
        console.warn('Manual admin refresh failed to hydrate backend state:', error);
      }
    }

    reloadAdminDataFromBrowserState();
    void loadSupportTickets(true);
    if (import.meta.env.PROD) {
      void hydrateDeferredAdminState().then(() => {
        loadAllTransactions();
        loadAllPins();
        loadAllPinRequests();
        loadPendingPinRequests();
        loadPayments();
        loadPaymentMethods();
        loadMarketplaceData();
        void loadAnnouncementHistory();
      });
    } else {
      loadAllTransactions();
    }
    toast.success('Data refreshed');
  }, [
    loadAllPins,
    loadAllPinRequests,
    loadAllTransactions,
    loadMarketplaceData,
    loadPaymentMethods,
    loadPayments,
    loadPendingPinRequests,
    loadSupportTickets,
    reloadAdminDataFromBrowserState,
    loadAnnouncementHistory
  ]);

  const hydrateDeferredAdminState = async () => {
    await Database.hydrateFromServerBatches(Database.getAdminDeferredRemoteSyncBatches(), {
      strict: true,
      maxAttempts: 1,
      timeoutMs: 30000,
      retryDelayMs: 1000,
      continueOnError: true,
      requireAnySuccess: false,
      onBatchError: (keys, error) => {
        console.warn('Deferred admin hydrate failed for keys:', keys, error);
      }
    });
  };

  useEffect(() => {
    if (!isAuthenticated) {
      adminBootstrapUserRef.current = null;
      navigate('/login');
      return;
    }
    if (!user?.isAdmin) {
      adminBootstrapUserRef.current = null;
      navigate('/dashboard');
      return;
    }
    if (adminBootstrapUserRef.current === user.userId) {
      return;
    }

    let cancelled = false;
    adminBootstrapUserRef.current = user.userId;
    const initializeAdminData = async () => {
      if (import.meta.env.PROD) {
        try {
          await Database.hydrateFromServerBatches(Database.getAdminCriticalRemoteSyncBatches(), {
            strict: true,
            maxAttempts: 2,
            timeoutMs: 45000,
            retryDelayMs: 1500,
            continueOnError: true,
            requireAnySuccess: true,
            onBatchError: (keys, error) => {
              console.warn('Admin bootstrap hydrate failed for keys:', keys, error);
            }
          });
        } catch (error) {
          console.warn('Admin bootstrap could not hydrate any backend batches:', error);
        }
      }

      if (cancelled) return;
      reloadAdminDataFromBrowserState();

      if (import.meta.env.PROD) {
        void hydrateDeferredAdminState().then(() => {
          if (!cancelled) {
            loadAllTransactions();
            loadAllPins();
            loadAllPinRequests();
            loadPendingPinRequests();
            loadPayments();
            loadPaymentMethods();
            loadMarketplaceData();
          }
        });
      }
    };

    void initializeAdminData();
    setBulkNoPin((prev) => ({
      ...prev,
      sponsorUserId: prev.sponsorUserId || user.userId
    }));

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user, navigate, loadStats, loadSettings, loadAllUsers, loadAllPins, loadAllPinRequests, loadPendingPinRequests, loadPayments, loadPaymentMethods]);

  // Auto-run a refresh once when admin loads panel
  const autoRefreshRanRef = useRef(false);
  useEffect(() => {
    if (!isAuthenticated || !user?.isAdmin) return;
    if (autoRefreshRanRef.current) return;
    autoRefreshRanRef.current = true;
    void runAdminRefresh();
  }, [isAuthenticated, user, runAdminRefresh]);

  useEffect(() => {
    if (!isReportsTabActive || reportsDataLoaded) return;
    const timer = window.setTimeout(() => {
      loadAllTransactions();
      setReportsDataLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isReportsTabActive, reportsDataLoaded, loadAllTransactions]);

  useEffect(() => {
    if (!isSupportTabActive) return;
    const timer = window.setTimeout(() => {
      void loadSupportTickets(true);
      setSupportDataLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isSupportTabActive]);

  useEffect(() => {
    if (!isPaymentsTabActive) return;
    const timer = window.setTimeout(() => {
      loadAllTransactions();
      loadPayments();
      loadDepositHistory();
      setWithdrawalRequests(Database.getWithdrawalTransactions());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isPaymentsTabActive, loadAllTransactions]);

  useEffect(() => {
    if (!user?.isAdmin) return;
    if (allPins.length === 0) {
      setOrphanedPinCount(0);
      return;
    }
    const userIdSet = new Set(allUsers.map((member) => member.id));
    const count = allPins.filter((pin) => {
      if (pin.status !== 'used') return false;
      const usedById = String(pin.usedById || '').trim();
      return !!usedById && !userIdSet.has(usedById);
    }).length;
    setOrphanedPinCount(count);
    if (count > 0 && !orphanedPinsNotifiedRef.current) {
      orphanedPinsNotifiedRef.current = true;
      toast.warning(`Found ${count} used PIN(s) with missing user records. Run "Repair Orphaned PIN Usage".`);
    }
  }, [allPins, allUsers, user]);

  function loadPayments() {
    const payments = Database.getPendingPayments();
    setPendingPayments(payments);
  }

  function loadDepositHistory() {
    const rows = Database.getAllCompletedPayments()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setDepositHistory(rows);
  }

  function loadWithdrawalRequests() {
    const requests = Database.getWithdrawalTransactions();
    setWithdrawalRequests(requests);
  }

  function loadPaymentMethods() {
    const methods = Database.getPaymentMethods();
    setPaymentMethods(methods);
  }

  async function loadAnnouncementHistory(syncFromServer = false) {
    if (syncFromServer) {
      try {
        await Database.hydrateFromServer({
          strict: true,
          maxAttempts: 2,
          timeoutMs: 15000,
          retryDelayMs: 1500,
          keys: [DB_KEYS.ANNOUNCEMENTS, DB_KEYS.NOTIFICATIONS]
        });
      } catch (error) {
        console.warn('Announcement hydrate failed:', error);
      }
    }
    const rows = Database.getAnnouncements();
    if (rows.length > 0) {
      setAnnouncementHistory(rows);
      return;
    }

    const notifications = Database.getNotifications();
    const derived = new Map<string, AdminAnnouncement>();
    for (const notification of notifications) {
      if (!notification.announcementId) continue;
      const existing = derived.get(notification.announcementId);
      if (!existing) {
        derived.set(notification.announcementId, {
          id: notification.announcementId,
          title: notification.title,
          message: notification.message,
          imageUrl: notification.imageUrl,
          type: notification.type,
          totalRecipients: 1,
          createdAt: notification.createdAt,
          createdById: 'system',
          createdByUserId: 'system',
          isRecalled: false,
          isPermanent: true,
          includeFutureUsers: true
        });
      } else {
        existing.totalRecipients += 1;
        if (new Date(notification.createdAt).getTime() < new Date(existing.createdAt).getTime()) {
          existing.createdAt = notification.createdAt;
        }
      }
    }

    const derivedRows = Array.from(derived.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setAnnouncementHistory(derivedRows);
  }

  async function loadSupportTickets(syncFromServer = false) {
    if (syncFromServer) {
      try {
        await Database.hydrateFromServer({
          strict: true,
          maxAttempts: 2,
          timeoutMs: 15000,
          retryDelayMs: 1200,
          keys: [DB_KEYS.SUPPORT_TICKETS]
        });
      } catch (error) {
        console.warn('Support tickets hydrate failed:', error);
      }
    }
    const rows = Database.getSupportTickets();
    setSupportTickets(rows);
    if (!selectedSupportTicketId && rows.length > 0) {
      setSelectedSupportTicketId(rows[0].ticket_id);
      setSupportStatusDraft(rows[0].status);
    }
  }

  const readSupportAttachment = async (file: File): Promise<SupportTicketAttachment> => {
    const dataUrl = await readOptimizedUploadDataUrl(file, {
      maxDimension: 1800,
      targetBytes: 650 * 1024,
      quality: 0.86
    });

    return {
      id: `support_admin_att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file_name: file.name,
      file_type: file.type || 'application/octet-stream',
      file_size: file.size,
      data_url: dataUrl,
      uploaded_by: user?.userId || 'admin',
      uploaded_at: new Date().toISOString()
    };
  };

  const handleAnnouncementImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select a valid image file');
      return;
    }

    const maxImageBytes = 350 * 1024;
    if (file.size > maxImageBytes) {
      toast.error('Image is too large. Keep it under 350 KB for announcement notifications.');
      return;
    }

    try {
      const imageUrl = await readOptimizedUploadDataUrl(file, {
        maxDimension: 1800,
        targetBytes: 500 * 1024,
        quality: 0.82
      });
      setAnnouncementData((prev) => ({ ...prev, imageUrl }));
      toast.success('Announcement image attached');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to read image');
    }
  };

  const handleSendAnnouncement = async () => {
    if (!user?.isAdmin) return;
    if (editingAnnouncement) {
      toast.error('Finish editing the current announcement before sending a new one.');
      return;
    }

    const title = announcementData.title.trim() || 'Important Announcement';
    const message = announcementData.message.trim();
    const imageUrl = announcementData.imageUrl.trim();
    const isPermanent = announcementData.isPermanent;
    const durationDays = isPermanent ? undefined : Math.max(1, Number(announcementData.durationDays || 0));
    const includeFutureUsers = isPermanent ? true : announcementData.includeFutureUsers;

    if (!message) {
      toast.error('Announcement message is required');
      return;
    }
    if (!isPermanent && (!durationDays || durationDays <= 0)) {
      toast.error('Please enter a valid duration (days).');
      return;
    }

    setIsSendingAnnouncement(true);
    try {
      const announcement = await Database.commitCriticalAction(() => Database.createAnnouncement({
        title,
        message,
        type: 'info',
        imageUrl: imageUrl || undefined,
        includeAdmins: true,
        createdById: user.id,
        createdByUserId: user.userId,
        isPermanent,
        durationDays,
        includeFutureUsers
      }), { timeoutMs: 120000, maxAttempts: 3, retryDelayMs: 2000 });

      if (!announcement) {
        toast.error('No users found for announcement');
        return;
      }

      setAnnouncementData((prev) => ({
        ...prev,
        message: '',
        imageUrl: '',
        isPermanent: true,
        durationDays: '3',
        includeFutureUsers: true
      }));
      await loadAnnouncementHistory();
      toast.success(`Announcement sent to ${announcement.totalRecipients} user(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send announcement');
    } finally {
      setIsSendingAnnouncement(false);
    }
  };

  const startEditAnnouncement = (announcement: AdminAnnouncement) => {
    if (announcement.isRecalled) {
      toast.error('Recalled announcements cannot be edited.');
      return;
    }
    setEditingAnnouncement(announcement);
    setAnnouncementData({
      title: announcement.title || 'Important Announcement',
      message: announcement.message || '',
      imageUrl: announcement.imageUrl || '',
      isPermanent: announcement.isPermanent ?? true,
      durationDays: announcement.durationDays ? String(announcement.durationDays) : '3',
      includeFutureUsers: announcement.includeFutureUsers ?? (announcement.isPermanent ?? true)
    });
  };

  const cancelEditAnnouncement = () => {
    setEditingAnnouncement(null);
    setAnnouncementData({
      title: 'Important Announcement',
      message: '',
      imageUrl: '',
      isPermanent: true,
      durationDays: '3',
      includeFutureUsers: true
    });
  };

  const handleUpdateAnnouncement = async () => {
    if (!user?.isAdmin || !editingAnnouncement) return;

    const title = announcementData.title.trim() || 'Important Announcement';
    const message = announcementData.message.trim();
    const imageUrl = announcementData.imageUrl.trim();
    const isPermanent = announcementData.isPermanent;
    const durationDays = isPermanent ? undefined : Math.max(1, Number(announcementData.durationDays || 0));
    const includeFutureUsers = isPermanent ? true : announcementData.includeFutureUsers;

    if (!message) {
      toast.error('Announcement message is required');
      return;
    }
    if (!isPermanent && (!durationDays || durationDays <= 0)) {
      toast.error('Please enter a valid duration (days).');
      return;
    }

    setIsUpdatingAnnouncement(true);
    try {
      const result = await Database.commitCriticalAction(() => Database.updateAnnouncement({
        id: editingAnnouncement.id,
        title,
        message,
        imageUrl,
        updatedByUserId: user.userId,
        isPermanent,
        durationDays,
        includeFutureUsers
      }), { timeoutMs: 120000, maxAttempts: 3, retryDelayMs: 2000 });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      await loadAnnouncementHistory();
      cancelEditAnnouncement();
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update announcement');
    } finally {
      setIsUpdatingAnnouncement(false);
    }
  };

  const handleRecallAnnouncement = async (announcement: AdminAnnouncement) => {
    if (!user?.isAdmin) return;
    if (announcement.isRecalled) {
      toast.error('Announcement already recalled');
      return;
    }

    const ok = window.confirm(`Take back announcement "${announcement.title}" for all users?`);
    if (!ok) return;

    try {
      await loadAnnouncementHistory(true);
    } catch (error) {
      console.warn('Announcement pre-refresh failed:', error);
    }

    try {
      const result = await Database.commitCriticalAction(() => Database.recallAnnouncement(announcement.id, user.userId), {
        timeoutMs: 120000,
        maxAttempts: 3,
        retryDelayMs: 2000
      });
      if (!result.success) {
        toast.error(result.message);
        return;
      }

      await loadAnnouncementHistory();
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to recall announcement');
    }
  };

  const handleApprovePayment = async () => {
    if (!selectedPayment || !user) return;

    await Database.ensureFreshData();

    try {
      const result = await Database.commitCriticalAction(() => Database.approvePayment(selectedPayment.id, user.id), {
        timeoutMs: 120000,
        maxAttempts: 3,
        retryDelayMs: 2000
      });
      if (result) {
        toast.success('Payment approved and funds added to user wallet');
        loadPayments();
        loadDepositHistory();
        loadAllUsers();
        setShowPaymentDialog(false);
        setSelectedPayment(null);
      } else {
        toast.error('Failed to approve payment');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to approve payment');
    }
  };

  const handleRejectPayment = async () => {
    if (!selectedPayment || !user) return;

    await Database.ensureFreshData();

    try {
      const result = await Database.commitCriticalAction(() => Database.rejectPayment(selectedPayment.id, user.id, adminNotes), {
        timeoutMs: 120000,
        maxAttempts: 3,
        retryDelayMs: 2000
      });
      if (result) {
        toast.success('Payment rejected');
        loadPayments();
        loadDepositHistory();
        setShowPaymentDialog(false);
        setSelectedPayment(null);
        setAdminNotes('');
      } else {
        toast.error('Failed to reject payment');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reject payment');
    }
  };

  const handleReversePayment = async () => {
    if (!selectedPayment || !user) return;
    const reason = adminNotes.trim();
    if (!reason) {
      toast.error('Please enter a remark for reversal');
      return;
    }
    const confirm = window.confirm('This will deduct the deposit from the user fund wallet. Continue?');
    if (!confirm) return;
    try {
      await Database.ensureFreshData();
      await Database.commitCriticalAction(() => Database.reversePayment(selectedPayment.id, user.id, reason), {
        timeoutMs: 120000,
        maxAttempts: 3,
        retryDelayMs: 2000
      });
      toast.success('Deposit reversed and funds deducted');
      loadPayments();
      loadDepositHistory();
      loadAllUsers();
      setShowPaymentDialog(false);
      setSelectedPayment(null);
      setAdminNotes('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reverse deposit');
    }
  };

  const handleWithdrawalReceiptUpload = async (requestId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!(file.type.startsWith('image/') || file.type === 'application/pdf')) {
      toast.error('Only image or PDF files are allowed');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Receipt must be under 5MB');
      return;
    }

    try {
      const dataUrl = await readOptimizedUploadDataUrl(file, {
        maxDimension: 1800,
        targetBytes: 650 * 1024,
        quality: 0.86
      });
      setWithdrawalReceiptDrafts((prev) => ({ ...prev, [requestId]: dataUrl }));
      toast.success('Receipt attached');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to read receipt');
    }
  };

  const handleApproveWithdrawalRequest = async (requestId: string) => {
    if (!user?.isAdmin) return;
    await Database.ensureFreshData();
    try {
      const result = await Database.commitCriticalAction(() => Database.processWithdrawalRequest({
        transactionId: requestId,
        adminUserId: user.userId,
        action: 'approve',
        adminReason: withdrawalReasonDrafts[requestId] || undefined,
        adminReceipt: withdrawalReceiptDrafts[requestId] || undefined
      }), { timeoutMs: 120000, maxAttempts: 3, retryDelayMs: 2000 });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      setWithdrawalReasonDrafts((prev) => ({ ...prev, [requestId]: '' }));
      setWithdrawalReceiptDrafts((prev) => ({ ...prev, [requestId]: '' }));
      loadAllTransactions();
      loadWithdrawalRequests();
      loadStats();
      if (selectedWithdrawalRequest?.id === requestId) {
        setShowWithdrawalRequestDialog(false);
        setSelectedWithdrawalRequest(null);
      }
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to approve withdrawal request');
    }
  };

  const handleRejectWithdrawalRequest = async (requestId: string) => {
    if (!user?.isAdmin) return;
    await Database.ensureFreshData();
    const reason = (withdrawalReasonDrafts[requestId] || '').trim();
    const confirmText = reason
      ? 'Reject this withdrawal request and refund amount to user income wallet?'
      : 'Reject this withdrawal request (no reason) and refund amount to user income wallet?';
    const confirmed = window.confirm(confirmText);
    if (!confirmed) return;

    try {
      const result = await Database.commitCriticalAction(() => Database.processWithdrawalRequest({
        transactionId: requestId,
        adminUserId: user.userId,
        action: 'reject',
        adminReason: reason || undefined,
        adminReceipt: withdrawalReceiptDrafts[requestId] || undefined
      }), { timeoutMs: 120000, maxAttempts: 3, retryDelayMs: 2000 });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      setWithdrawalReasonDrafts((prev) => ({ ...prev, [requestId]: '' }));
      setWithdrawalReceiptDrafts((prev) => ({ ...prev, [requestId]: '' }));
      loadAllTransactions();
      loadWithdrawalRequests();
      loadStats();
      if (selectedWithdrawalRequest?.id === requestId) {
        setShowWithdrawalRequestDialog(false);
        setSelectedWithdrawalRequest(null);
      }
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reject withdrawal request');
    }
  };

  const handleScanMissingPendingWithdrawals = async () => {
    try {
      await Database.ensureFreshData();
      const findings = Database.scanSuspiciousWithdrawalSubmissions(20);
      setWithdrawalGapScanResults(findings);
      setShowWithdrawalGapDialog(true);
      if (findings.length === 0) {
        toast.success('No suspicious missing pending withdrawals found.');
        return;
      }
      toast.warning(`Found ${findings.length} suspicious withdrawal submission${findings.length === 1 ? '' : 's'}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to scan withdrawal gaps');
    }
  };

  const togglePaymentMethod = async (methodId: string, isActive: boolean) => {
    try {
      await Database.commitCriticalAction(() => Database.updatePaymentMethod(methodId, { isActive }), {
        timeoutMs: 120000,
        maxAttempts: 3,
        retryDelayMs: 2000
      });
      loadPaymentMethods();
      toast.success(`Payment method ${isActive ? 'enabled' : 'disabled'}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update payment method');
    }
  };

  const openPaymentMethodEditor = (method: PaymentMethod) => {
    setEditingPaymentMethodId(method.id);
    setPaymentMethodDraft({
      type: method.type,
      name: method.name || '',
      description: method.description || '',
      instructions: method.instructions || '',
      walletAddress: method.walletAddress || '',
      accountNumber: method.accountNumber || '',
      accountName: method.accountName || '',
      bankName: method.bankName || '',
      upiId: method.upiId || '',
      qrCode: method.qrCode || '',
      minAmount: String(method.minAmount ?? ''),
      maxAmount: String(method.maxAmount ?? ''),
      processingFee: String(method.processingFee ?? ''),
      processingTime: method.processingTime || ''
    });
  };

  const closePaymentMethodEditor = () => {
    setEditingPaymentMethodId(null);
    setPaymentMethodDraft(null);
  };

  const updatePaymentMethodDraft = (field: keyof PaymentMethodDraft, value: string) => {
    setPaymentMethodDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const startNewPaymentMethod = () => {
    setEditingPaymentMethodId('new');
    setPaymentMethodDraft({
      type: 'crypto',
      name: '',
      description: '',
      instructions: '',
      walletAddress: '',
      accountNumber: '',
      accountName: '',
      bankName: '',
      upiId: '',
      qrCode: '',
      minAmount: '0',
      maxAmount: '0',
      processingFee: '0',
      processingTime: ''
    });
  };

  const handlePaymentMethodQrUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select a valid image for QR code');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('QR code image must be under 2MB');
      return;
    }

    try {
      const dataUrl = await readOptimizedUploadDataUrl(file, {
        maxDimension: 1200,
        targetBytes: 350 * 1024,
        quality: 0.84
      });
      updatePaymentMethodDraft('qrCode', dataUrl);
      toast.success('QR code updated in editor');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to read QR image');
    }
  };

  const savePaymentMethodDetails = async () => {
    if (!editingPaymentMethodId || !paymentMethodDraft) return;

    const minAmount = Number(paymentMethodDraft.minAmount);
    const maxAmount = Number(paymentMethodDraft.maxAmount);
    const processingFee = Number(paymentMethodDraft.processingFee);

    if (!Number.isFinite(minAmount) || minAmount < 0) {
      toast.error('Minimum amount must be a valid non-negative number');
      return;
    }
    if (!Number.isFinite(maxAmount) || maxAmount <= 0) {
      toast.error('Maximum amount must be a valid positive number');
      return;
    }
    if (maxAmount < minAmount) {
      toast.error('Maximum amount cannot be less than minimum amount');
      return;
    }
    if (!Number.isFinite(processingFee) || processingFee < 0) {
      toast.error('Processing fee must be a valid non-negative number');
      return;
    }

    const baseFields: Partial<PaymentMethod> = {
      name: paymentMethodDraft.name.trim(),
      description: paymentMethodDraft.description.trim(),
      instructions: paymentMethodDraft.instructions.trim(),
      walletAddress: paymentMethodDraft.walletAddress.trim() || undefined,
      accountNumber: paymentMethodDraft.accountNumber.trim() || undefined,
      accountName: paymentMethodDraft.accountName.trim() || undefined,
      bankName: paymentMethodDraft.bankName.trim() || undefined,
      upiId: paymentMethodDraft.upiId.trim() || undefined,
      qrCode: paymentMethodDraft.qrCode.trim() || undefined,
      minAmount,
      maxAmount,
      processingFee,
      processingTime: paymentMethodDraft.processingTime.trim()
    };

    try {
      if (editingPaymentMethodId === 'new') {
        const newId = `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const newMethod: PaymentMethod = {
          id: newId,
          type: paymentMethodDraft.type,
          icon: paymentMethodDraft.type,
          isActive: true,
          name: baseFields.name || 'New Payment Method',
          description: baseFields.description || '',
          instructions: baseFields.instructions || '',
          walletAddress: baseFields.walletAddress,
          accountNumber: baseFields.accountNumber,
          accountName: baseFields.accountName,
          bankName: baseFields.bankName,
          upiId: baseFields.upiId,
          qrCode: baseFields.qrCode,
          minAmount: minAmount || 0,
          maxAmount: maxAmount || minAmount || 0,
          processingFee: processingFee || 0,
          processingTime: baseFields.processingTime || `Within ${settings.depositProcessingHours} hours`
        };
        await Database.commitCriticalAction(() => Database.addPaymentMethod(newMethod), {
          timeoutMs: 120000,
          maxAttempts: 3,
          retryDelayMs: 2000
        });
      } else {
        const currentMethod = paymentMethods.find((method) => method.id === editingPaymentMethodId);
        if (!currentMethod) {
          toast.error('Payment method not found');
          return;
        }
        const updates: Partial<PaymentMethod> = {
          ...baseFields,
          name: baseFields.name || currentMethod.name,
          description: baseFields.description || currentMethod.description,
          instructions: baseFields.instructions || currentMethod.instructions,
          processingTime: baseFields.processingTime || currentMethod.processingTime || `Within ${settings.depositProcessingHours} hours`
        };

        const updated = await Database.commitCriticalAction(() => Database.updatePaymentMethod(editingPaymentMethodId, updates), {
          timeoutMs: 120000,
          maxAttempts: 3,
          retryDelayMs: 2000
        });
        if (!updated) {
          toast.error('Failed to update payment method');
          return;
        }
      }

      loadPaymentMethods();
      closePaymentMethodEditor();
      toast.success(editingPaymentMethodId === 'new' ? 'Payment method added' : 'Payment method details updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save payment method');
    }
  };

  const handleAddFunds = async () => {
    if (!selectedUser || !fundAmount) return;

    const parsedAmount = parseFloat(fundAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }

    setIsLoading(true);
    const result = await addFundsToUser(
      selectedUser,
      parsedAmount,
      fundWalletType,
      fundWalletType === 'royalty' ? fundMessage : undefined
    );
    setIsLoading(false);

    if (result.success) {
      toast.success(result.message);
      setFundAmount('');
      setFundMessage('');
      setFundWalletType('deposit');
      setSelectedUser(null);
      loadAllUsers();
    } else {
      toast.error(result.message);
    }
  };

  const searchUserById = (overrideId?: string) => {
    const targetId = (overrideId ?? userSearchId).trim();
    if (targetId.length !== 7) {
      toast.error('Please enter a valid 7-digit User ID');
      return;
    }

    const foundUser = Database.getUserByUserId(targetId);
    if (foundUser) {
      setMissingMatrixNode(null);
      setMissingUserRecovery({
        userId: '',
        fullName: '',
        email: '',
        phone: '',
        country: '',
        sponsorId: '',
        loginPassword: '',
        transactionPassword: '',
        restoreSponsorIncome: true
      });
      const wallet = Database.getWallet(foundUser.id);
      const teamStats = Database.getTeamCounts(foundUser.userId);
      const userPayments = Database.getUserPayments(foundUser.id);
      const userTransactions = Database.getUserTransactions(foundUser.id);
      const userPins = Database.getUserPins(foundUser.id);
      const pendingMatrixDebug = Database.getPendingMatrixContributionsDebug(foundUser.id);
      const incomingPendingMatrixDebug = Database.getIncomingPendingMatrixContributionsDebug(foundUser.id);
      const incomingGiveHelpCandidates = Database.findGiveHelpDebitsTargetingUser(foundUser.id);

      const receiveHelpAmount = userTransactions
        .filter(t => t.type === 'receive_help' && t.status === 'completed')
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      const giveHelpAmount = userTransactions
        .filter(t => t.type === 'give_help' && t.status === 'completed')
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      const directReferralIncome = userTransactions
        .filter(t => t.type === 'direct_income' && t.status === 'completed')
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      const qualifiedLevel = Database.getQualifiedLevel(foundUser.id);

      setSearchedUser({
        ...foundUser,
        wallet,
        teamStats,
        payments: userPayments,
        transactions: userTransactions,
        receiveHelpAmount,
        giveHelpAmount,
        directReferralIncome,
        qualifiedLevel,
        pins: userPins,
        pendingMatrixDebug,
        incomingPendingMatrixDebug,
        incomingGiveHelpCandidates
      });
      setAdminUserProfile({
        fullName: foundUser.fullName || '',
        email: foundUser.email || '',
        phone: foundUser.phone || '',
        usdtAddress: foundUser.usdtAddress || '',
        loginPassword: '',
        transactionPassword: ''
      });
    } else {
      const matrixNode = Database.getMatrixNode(targetId);
      if (matrixNode) {
        setMissingMatrixNode(matrixNode);
        setMissingUserRecovery({
          userId: targetId,
          fullName: matrixNode.username || '',
          email: '',
          phone: '',
          country: '',
          sponsorId: matrixNode.parentId || '',
          loginPassword: '',
          transactionPassword: '',
          restoreSponsorIncome: true
        });
        toast.error('User not found. Matrix slot exists; you can recover below.');
      } else {
        setMissingMatrixNode(null);
        setMissingUserRecovery({
          userId: '',
          fullName: '',
          email: '',
          phone: '',
          country: '',
          sponsorId: '',
          loginPassword: '',
          transactionPassword: '',
          restoreSponsorIncome: true
        });
        toast.error('User not found');
      }
      setSearchedUser(null);
    }
  };

  const handleRecoverMissingUser = async () => {
    if (!user?.isAdmin) return;
    if (missingUserRecovery.userId.length !== 7) {
      toast.error('Enter a valid 7-digit User ID to recover');
      return;
    }
    if (!missingMatrixNode) {
      toast.error('Matrix slot not found for this ID');
      return;
    }
    setIsRecoveringUser(true);
    try {
      await Database.ensureFreshData();
      const result = Database.recoverMissingUserFromMatrix({
        userId: missingUserRecovery.userId,
        fullName: missingUserRecovery.fullName,
        email: missingUserRecovery.email,
        phone: missingUserRecovery.phone,
        country: missingUserRecovery.country,
        sponsorId: missingUserRecovery.sponsorId || null,
        loginPassword: missingUserRecovery.loginPassword,
        transactionPassword: missingUserRecovery.transactionPassword,
        restoreSponsorIncome: missingUserRecovery.restoreSponsorIncome
      });
      loadAllUsers();
      loadAllTransactions();
      loadStats();
      setUserSearchId(missingUserRecovery.userId);
      searchUserById(missingUserRecovery.userId);
      toast.success(`Recovered user ${result.user.fullName} (${result.user.userId}).`);
      if (result.sponsorIncomeRestored) {
        toast.success('Restored missing referral income.');
      }
      if (result.generatedLoginPassword) {
        toast.success(`Temporary login password: ${result.generatedLoginPassword}`);
      }
      if (result.generatedTransactionPassword) {
        toast.success(`Temporary transaction password: ${result.generatedTransactionPassword}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to recover user');
    } finally {
      setIsRecoveringUser(false);
    }
  };

  const resetAdminUserProfileForm = () => {
    if (!searchedUser) return;
    setAdminUserProfile({
      fullName: searchedUser.fullName || '',
      email: searchedUser.email || '',
      phone: searchedUser.phone || '',
      usdtAddress: searchedUser.usdtAddress || '',
      loginPassword: '',
      transactionPassword: ''
    });
  };

  const applyAdminProfileUpdate = async (profile: typeof adminUserProfile) => {
    if (!user?.isAdmin || !searchedUser) return;

    const fullName = profile.fullName.trim();
    const email = profile.email.trim();
    const phone = profile.phone.trim();
    const usdtAddress = profile.usdtAddress.trim();
    const loginPassword = profile.loginPassword.trim();
    const transactionPassword = profile.transactionPassword.trim();

    if (!fullName || !email || !phone) {
      toast.error('Name, email, and phone are required');
      return;
    }

    const allUsers = Database.getUsers();
    const emailConflict = allUsers.find(
      (u) => u.id !== searchedUser.id && u.email?.toLowerCase() === email.toLowerCase()
    );
    if (emailConflict) {
      toast.error('Email is already used by another user');
      return;
    }
    const phoneConflict = allUsers.find(
      (u) => u.id !== searchedUser.id && u.phone?.trim() === phone
    );
    if (phoneConflict) {
      toast.error('Phone number is already used by another user');
      return;
    }

    if (loginPassword && !isStrongPassword(loginPassword)) {
      toast.error(getPasswordRequirementsText());
      return;
    }
    if (transactionPassword && !isValidTransactionPassword(transactionPassword)) {
      toast.error(getTransactionPasswordRequirementsText());
      return;
    }

    const now = new Date().toISOString();
    const nextLastActions = { ...(searchedUser.lastActions || {}) };
    if (email !== searchedUser.email) nextLastActions.email = now;
    if (phone !== searchedUser.phone) nextLastActions.phone = now;
    if (usdtAddress !== (searchedUser.usdtAddress || '')) nextLastActions.usdtAddress = now;
    if (loginPassword) nextLastActions.loginPassword = now;
    if (transactionPassword) nextLastActions.transactionPassword = now;

    const updates: Record<string, unknown> = {
      fullName,
      email,
      phone,
      usdtAddress,
      ...(Object.keys(nextLastActions).length > 0 ? { lastActions: nextLastActions } : {})
    };
    if (loginPassword) updates.password = loginPassword;
    if (transactionPassword) updates.transactionPassword = transactionPassword;

    setIsUpdatingUserProfile(true);
    try {
      const updated = await Database.commitCriticalAction(() => Database.updateUser(searchedUser.id, updates), {
        timeoutMs: 120000,
        maxAttempts: 3,
        retryDelayMs: 2000
      });
      if (!updated) {
        toast.error('Unable to update user profile');
        return;
      }
      loadAllUsers();
      searchUserById();
      toast.success('User profile updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update user profile');
    } finally {
      setIsUpdatingUserProfile(false);
    }
  };

  const handleAdminProfileUpdate = async () => {
    await applyAdminProfileUpdate(adminUserProfile);
  };

  const handleResetUserPasswords = async () => {
    if (!searchedUser) return;
    const tempLoginPassword = `Temp@${searchedUser.userId}`;
    const tempTransactionPassword = String(searchedUser.userId || '').slice(-4).padStart(4, '0');
    const nextProfile = {
      ...adminUserProfile,
      loginPassword: tempLoginPassword,
      transactionPassword: tempTransactionPassword
    };
    setAdminUserProfile(nextProfile);
    await applyAdminProfileUpdate(nextProfile);
    toast.success(`New login password: ${tempLoginPassword}`);
    toast.success(`New transaction password: ${tempTransactionPassword}`);
  };

  const handleRestoreReceiveHelp = async () => {
    if (!searchedUser) return;
    const fromId = restoreReceiveHelpFromId.replace(/\D/g, '').slice(0, 7);
    if (fromId.length !== 7) {
      toast.error('Enter a valid 7-digit sender ID');
      return;
    }
    const levelInput = restoreReceiveHelpLevel.trim();
    let parsedLevel: number | undefined;
    if (levelInput) {
      const numericLevel = Number(levelInput);
      if (!Number.isFinite(numericLevel) || numericLevel < 1) {
        toast.error('Enter a valid level number');
        return;
      }
      parsedLevel = numericLevel;
    }
    setIsRestoringReceiveHelp(true);
    try {
      const result = restoreReceiveHelpHistoryOnly
        ? Database.restoreReceiveHelpHistoryOnly({
            recipientUserId: searchedUser.userId,
            fromUserId: fromId,
            level: parsedLevel
          })
        : Database.restoreMissingReceiveHelpFromUserId({
            recipientUserId: searchedUser.userId,
            fromUserId: fromId,
            level: parsedLevel
          });
      if (!result.created) {
        toast.success('Receive-help entry already exists.');
      } else {
        toast.success('Receive-help entry restored.');
        if (result.description) {
          toast.success(result.description);
        }
      }
      loadAllTransactions();
      loadStats();
      searchUserById();
      setRestoreReceiveHelpFromId('');
      setRestoreReceiveHelpLevel('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to restore receive-help');
    } finally {
      setIsRestoringReceiveHelp(false);
    }
  };

  const handleRepairMissingIncomingHelp = async () => {
    if (!searchedUser) return;
    setIsRepairingIncomingHelp(true);
    try {
      const result = Database.repairMissingIncomingReceiveHelp(searchedUser.id);
      if (result.created > 0) {
        toast.success(`Repaired ${result.created} missing incoming help entr${result.created > 1 ? 'ies' : 'y'}.`);
      } else if (result.existing > 0) {
        toast.success(`Found ${result.existing} matching incoming help entr${result.existing > 1 ? 'ies' : 'y'} already on this user and refreshed wallet/lock state.`);
      } else {
        toast.success('No missing incoming help entries found.');
      }
      loadAllTransactions();
      loadStats();
      searchUserById();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to repair missing incoming help');
    } finally {
      setIsRepairingIncomingHelp(false);
    }
  };

  const handleManualCreditReceiveHelp = async () => {
    if (!searchedUser) return;
    const fromId = restoreReceiveHelpFromId.trim();
    if (fromId.length !== 7) {
      toast.error('Enter a valid 7-digit sender ID');
      return;
    }

    const levelInput = restoreReceiveHelpLevel.trim();
    const parsedLevel = Number(levelInput);
    if (!levelInput || !Number.isFinite(parsedLevel) || parsedLevel < 1) {
      toast.error('Enter the level number for the manual credit');
      return;
    }

    setIsManualCreditingReceiveHelp(true);
    try {
      const result = Database.manualAdminReceiveHelpCredit({
        recipientUserId: searchedUser.userId,
        fromUserId: fromId,
        level: parsedLevel
      });
      toast.success('Manual receive-help credit added.');
      if (result.description) toast.success(result.description);
      loadAllTransactions();
      loadStats();
      searchUserById();
      setRestoreReceiveHelpFromId('');
      setRestoreReceiveHelpLevel('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add manual receive-help credit');
    } finally {
      setIsManualCreditingReceiveHelp(false);
    }
  };

  const handleScanHelpMismatches = async () => {
    if (!searchedUser) return;
    setIsScanningHelpMismatches(true);
    try {
      const result = Database.scanHelpLedgerMismatches(searchedUser.id);
      if (result.giveWithoutReceive === 0 && result.restoredWithoutDebit === 0) {
        toast.success(`No help-ledger mismatches found. Scanned ${result.scannedGiveHelp} give-help entries.`);
      } else {
        toast.error(
          `Found ${result.giveWithoutReceive} give-help without receive-help and ${result.restoredWithoutDebit} manual restored credits without debit.`
        );
        result.examples.slice(0, 3).forEach((example) => toast.message(example));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to scan help mismatches');
    } finally {
      setIsScanningHelpMismatches(false);
    }
  };

  const handleRepairSelfFundCredits = async () => {
    if (!searchedUser) return;
    setIsRepairingSelfFundCredits(true);
    try {
      const result = Database.repairMissingSelfFundCredits(searchedUser.id);
      if (result.repaired === 0) {
        toast.success('No missing self fund-credit entries found for this user.');
      } else {
        toast.success(`Repaired ${result.repaired} missing self fund-credit entr${result.repaired > 1 ? 'ies' : 'y'}.`);
        result.examples.slice(0, 3).forEach((example) => toast.message(example));
      }
      loadAllTransactions();
      loadStats();
      searchUserById();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to repair missing self fund credits');
    } finally {
      setIsRepairingSelfFundCredits(false);
    }
  };

  const handleRecalculateQualifiedLevel = async () => {
    if (!searchedUser) return;
    setIsRecalculatingQualifiedLevel(true);
    try {
      const result = Database.recalculateQualifiedLevel(searchedUser.id);
      if (result.after !== result.before) {
        toast.success(`Qualified Level updated from L${result.before} to L${result.after}.`);
      } else if (result.syncedLevels > 0) {
        toast.success(`Qualified Level rechecked. It remains at L${result.after}.`);
      } else {
        toast.success(`No qualified-level changes were needed. Current value is L${result.after}.`);
      }
      loadStats();
      searchUserById();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to recalculate qualified level');
    } finally {
      setIsRecalculatingQualifiedLevel(false);
    }
  };

  const handleMarkLevelHelpComplete = async () => {
    if (!searchedUser) return;
    const parsedLevel = Number(manualQualifiedLevelValue);
    if (!Number.isFinite(parsedLevel) || parsedLevel < 1) {
      toast.error('Enter a valid level number');
      return;
    }

    setIsMarkingLevelHelpComplete(true);
    try {
      const result = Database.markLevelHelpComplete(searchedUser.id, parsedLevel);
      toast.success(`Marked Level ${result.level} help as complete for this user.`);
      if (result.after !== result.before) {
        toast.success(`Qualified Level updated from L${result.before} to L${result.after}.`);
      }
      loadAllTransactions();
      loadStats();
      searchUserById();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to mark level help complete');
    } finally {
      setIsMarkingLevelHelpComplete(false);
    }
  };

  const handleReverseTemporarySelfFundCredits = async () => {
    if (!searchedUser) return;
    setIsReversingTemporarySelfFundCredits(true);
    try {
      const result = Database.reverseTemporarySelfFundCredits(searchedUser.id);
      if (result.reversed === 0) {
        toast.success('No temporary self fund-credit entries found for this user.');
      } else {
        toast.success(`Reversed ${result.reversed} temporary self fund-credit entr${result.reversed > 1 ? 'ies' : 'y'}.`);
        result.examples.slice(0, 3).forEach((example) => toast.message(example));
      }
      loadAllTransactions();
      loadStats();
      searchUserById();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reverse temporary self fund credits');
    } finally {
      setIsReversingTemporarySelfFundCredits(false);
    }
  };

  const handleRemoveBrokenSelfTransferHistory = async () => {
    if (!searchedUser) return;
    setIsRemovingBrokenSelfTransferHistory(true);
    try {
      const result = Database.removeBrokenSelfIncomeToFundTransfer(searchedUser.id);
      if (result.removed === 0) {
        toast.success('No broken self transfer history entries found for this user.');
      } else {
        toast.success(`Removed ${result.removed} broken self-transfer histor${result.removed > 1 ? 'ies' : 'y'}.`);
        result.examples.slice(0, 3).forEach((example) => toast.message(example));
      }
      loadAllTransactions();
      loadStats();
      searchUserById();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove broken self transfer history');
    } finally {
      setIsRemovingBrokenSelfTransferHistory(false);
    }
  };

  const handleReverseInvalidRestoredHelp = async () => {
    if (!searchedUser) return;
    setIsReversingInvalidRestoredHelp(true);
    try {
      const result = Database.reverseInvalidRestoredReceiveHelp(searchedUser.id);
      if (result.reversed === 0) {
        toast.success('No invalid restored credits found for this user.');
      } else {
        toast.success(`Reversed ${result.reversed} invalid restored credit entr${result.reversed > 1 ? 'ies' : 'y'}.`);
        result.examples.slice(0, 3).forEach((example) => toast.message(example));
      }
      loadAllTransactions();
      loadStats();
      searchUserById();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reverse invalid restored credits');
    } finally {
      setIsReversingInvalidRestoredHelp(false);
    }
  };

  const handleRestoreFromExactGiveHelp = async (giveHelpTxId: string, historyOnly = false) => {
    if (!searchedUser) return;
    setRestoringFromGiveHelpTxId(giveHelpTxId);
    try {
      const result = Database.restoreReceiveHelpFromGiveHelpTxId({
        recipientUserId: searchedUser.userId,
        giveHelpTxId,
        historyOnly
      });
      if (!result.created) {
        toast.success('Matching receive-help entry already exists.');
      } else {
        toast.success('Receive-help restored from exact give-help transaction.');
        if (result.description) toast.success(result.description);
      }
      loadAllTransactions();
      loadStats();
      searchUserById();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to restore from exact give-help transaction');
    } finally {
      setRestoringFromGiveHelpTxId(null);
    }
  };

  const handleGeneratePins = async () => {
    if (!pinRecipientId || pinQuantity < 1) {
      toast.error('Please enter recipient ID and quantity');
      return;
    }

    const recipient = Database.getUserByUserId(pinRecipientId);
    if (!recipient) {
      toast.error('Recipient not found');
      return;
    }

    const confirmed = window.confirm(`Generate ${pinQuantity} PIN(s) for User ID ${pinRecipientId}?`);
    if (!confirmed) return;

    setIsLoading(true);
    const result = await generatePins(pinQuantity, recipient.id);
    setIsLoading(false);

    if (result.success && result.pins) {
      setGeneratedPins(result.pins);
      setShowPinDialog(true);
      toast.success(result.message);
      setPinQuantity(1);
      setPinRecipientId('');
    } else {
      toast.error(result.message);
    }
  };

  const copyPin = (pinCode: string) => {
    navigator.clipboard.writeText(pinCode);
    setCopiedPin(pinCode);
    setTimeout(() => setCopiedPin(null), 2000);
    toast.success('PIN copied!');
  };

  const copyWithdrawalAddress = async (requestId: string, address: string) => {
    const value = String(address || '').trim();
    if (!value || value === '-') {
      toast.error('No valid USDT address to copy');
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopiedWithdrawalAddressId(requestId);
      window.setTimeout(() => setCopiedWithdrawalAddressId((prev) => (prev === requestId ? null : prev)), 2000);
      toast.success('USDT address copied');
    } catch {
      toast.error('Unable to copy address');
    }
  };

  const handlePinRefresh = async () => {
    if (isPinRefreshing) return;
    setIsPinRefreshing(true);
    try {
      await Database.forceRemoteSyncNowWithOptions({ full: false, force: true, timeoutMs: 15000, maxAttempts: 2, retryDelayMs: 1200 });
      await Database.hydrateFromServer({ strict: true, maxAttempts: 2, timeoutMs: 12000, retryDelayMs: 800 });
    } catch {
      // best-effort sync
    } finally {
      loadAllPins();
      loadAllPinRequests();
      loadPendingPinRequests();
      setIsPinRefreshing(false);
    }
  };

  const handleTakeBackPins = async () => {
    if (!user?.isAdmin) return;
    if (!takeBackUserId || takeBackQuantity < 1) {
      toast.error('Enter user ID and quantity to take back');
      return;
    }
    const confirmed = window.confirm(`Take back ${takeBackQuantity} unused PIN(s) from User ID ${takeBackUserId}?`);
    if (!confirmed) return;

    setIsTakingBack(true);
    try {
      await Database.ensureFreshData();
      const taken = Database.reclaimPinsFromUser(takeBackUserId, user.id, takeBackQuantity, takeBackReason.trim());
      if (taken.length === 0) {
        toast.error('No unused PINs found to take back');
      } else {
        toast.success(`Taken back ${taken.length} PIN(s)`);
        setTakeBackUserId('');
        setTakeBackQuantity(1);
        setTakeBackReason('');
      }
      loadAllPins();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to take back PINs');
    } finally {
      setIsTakingBack(false);
    }
  };

  const handleRepairOrphanedPins = async () => {
    if (!user?.isAdmin) return;
    setIsRepairingPins(true);
    try {
      const users = Database.getUsers();
      const userIdSet = new Set(users.map((member) => member.id));
      const pins = Database.getPins();
      const orphanUserIds = new Set<string>();
      let repaired = 0;

      const nextPins = pins.map((pin) => {
        if (pin.status !== 'used') return pin;
        const usedById = String(pin.usedById || '').trim();
        if (!usedById || userIdSet.has(usedById)) return pin;
        orphanUserIds.add(usedById);
        repaired += 1;
        return {
          ...pin,
          status: 'unused' as Pin['status'],
          usedAt: undefined,
          usedById: undefined,
          registrationUserId: undefined
        };
      });

      if (repaired === 0) {
        toast.success('No orphaned PIN usage found.');
        return;
      }

      Database.savePins(nextPins);

      let removedSafetyPool = 0;
      const safetyPool = Database.getSafetyPool();
      if (safetyPool) {
        const remaining = safetyPool.transactions.filter((tx) => {
          if (!orphanUserIds.has(tx.fromUserId)) return true;
          removedSafetyPool += Number(tx.amount) || 0;
          return false;
        });
        const nextTotal = remaining.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
        Database.saveSafetyPool({ totalAmount: nextTotal, transactions: remaining });
      }

      const affectedUsers = new Set<string>();
      const transactions = Database.getTransactions();
      let removedTransactions = 0;
      const remainingTx = transactions.filter((tx) => {
        const orphanUser = orphanUserIds.has(tx.userId);
        const orphanFrom = !!tx.fromUserId && orphanUserIds.has(tx.fromUserId);
        if (!orphanUser && !orphanFrom) return true;
        removedTransactions += 1;
        if (!orphanUser) {
          affectedUsers.add(tx.userId);
        }
        return false;
      });
      if (removedTransactions > 0) {
        Database.saveTransactions(remainingTx);
      }

      affectedUsers.forEach((id) => {
        Database.repairIncomeWalletConsistency(id);
        Database.repairLockedIncomeTrackerFromTransactions(id);
        Database.syncLockedIncomeWallet(id);
      });

      loadAllPins();
      loadAllTransactions();
      loadStats();

      toast.success(`Recovered ${repaired} PIN(s). Removed ${removedTransactions} transaction(s).`);
      if (removedSafetyPool > 0) {
        toast.success(`Removed $${removedSafetyPool.toFixed(2)} orphan admin fee from safety pool.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to repair orphaned PIN usage');
    } finally {
      setIsRepairingPins(false);
    }
  };

  const pinUserMap = useMemo(() => new Map(allUsers.map((u) => [u.id, u])), [allUsers]);
  const filteredPins = useMemo(() => {
    const sorted = [...allPins].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const q = pinSearchQuery.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((pin) => {
      const owner = pinUserMap.get(pin.ownerId);
      const usedBy = pin.usedById ? pinUserMap.get(pin.usedById) : null;
      return (
        pin.pinCode.toLowerCase().includes(q)
        || pin.status.toLowerCase().includes(q)
        || (owner?.userId || '').toLowerCase().includes(q)
        || (owner?.fullName || '').toLowerCase().includes(q)
        || (usedBy?.userId || '').toLowerCase().includes(q)
        || (usedBy?.fullName || '').toLowerCase().includes(q)
      );
    });
  }, [allPins, pinSearchQuery, pinUserMap]);

  const getPinShareMessage = (pinCode: string) => [
    '*Your Exclusive Activation Details:*',
    '',
    `*Activation PIN : ${pinCode}*`,
    '',
    'Use this PIN to create your account and become part of the *ReferNex* network.',
    '',
    '*Important :* This PIN is valid for one-time use only, so please keep it safe and do not share it publicly.'
  ].join('\n');

  const sharePinOnWhatsApp = (pinCode: string) => {
    const message = getPinShareMessage(pinCode);
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  };

  const sharePinAnywhere = async (pinCode: string) => {
    const message = getPinShareMessage(pinCode);

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'ReferNex Activation Details',
          text: message
        });
        return;
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
      }
    }

    try {
      await navigator.clipboard.writeText(message);
      toast.success('PIN message copied. Paste it anywhere to share.');
    } catch {
      toast.error('Unable to share this PIN on your device');
    }
  };

  const handleImpersonateUser = async () => {
    if (!impersonateUserId || !masterPassword) {
      toast.error('Please enter User ID and Master Password');
      return;
    }

    const result = await adminLoginAsUser(impersonateUserId, masterPassword);
    if (result.success) {
      toast.success(result.message);
      navigate('/dashboard');
    } else {
      toast.error(result.message);
    }
  };

  const generateLevelReport = () => {
    const level = reportLevel ? parseInt(reportLevel) : undefined;
    const report = getLevelWiseReport(level);
    setLevelReport(report);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
    toast.success('Logged out successfully');
  };

  const handleUpdateSettings = (key: string, value: any) => {
    updateSettings({ [key]: value });
    toast.success('Settings updated');
  };

  const handleCreateServerBackup = async () => {
    setIsCreatingBackup(true);
    const result = await createServerBackup();
    setIsCreatingBackup(false);

    if (result.success) {
      const path = typeof result.backup?.filePath === 'string' ? result.backup.filePath : '';
      toast.success(path ? `${result.message} at ${path}` : result.message);
    } else {
      toast.error(result.message);
    }
  };

  const resetDeleteAllIdsConfirmation = () => {
    setDeleteAllIdsPhrase('');
    setDeleteAllIdsAdminId('');
  };

  const handleDeleteAllIds = async () => {
    if (!user?.isAdmin) return;
    if (!deleteAllIdsArmed) {
      toast.error('Complete both confirmations before deleting IDs');
      return;
    }

    const finalConfirm = window.confirm(
      'Final confirmation: this will permanently delete all non-admin IDs and reset matrix/wallet/transactions. Continue?'
    );
    if (!finalConfirm) return;

    setIsDeletingAllIds(true);
    const result = await deleteAllIdsFromSystem();
    setIsDeletingAllIds(false);

    if (result.success) {
      toast.success(result.message);
      setShowDeleteAllIdsDialog(false);
      resetDeleteAllIdsConfirmation();
    } else {
      toast.error(result.message);
    }
  };

  const handleBlockUser = async (targetUserId: string, type: 'temporary' | 'permanent') => {
    const reason = window.prompt('Enter block reason', 'Blocked by admin')?.trim() || 'Blocked by admin';
    let hours = 24;
    if (type === 'temporary') {
      const hoursInput = window.prompt('Temporary block duration in hours', '24');
      const parsedHours = Number(hoursInput);
      if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
        toast.error('Invalid block duration');
        return;
      }
      hours = parsedHours;
    }

    const result = await blockUser(targetUserId, type, reason, hours);
    if (result.success) {
      toast.success(result.message);
      loadStats();
    } else {
      toast.error(result.message);
    }
  };

  const handleUnblockUser = async (targetUserId: string) => {
    const result = await unblockUser(targetUserId);
    if (result.success) {
      toast.success(result.message);
      loadStats();
    } else {
      toast.error(result.message);
    }
  };

  const handleReactivateUser = async (targetUserId: string) => {
    const result = await reactivateAutoDeactivatedUser(targetUserId);
    if (result.success) {
      toast.success(result.message);
      loadStats();
    } else {
      toast.error(result.message);
    }
  };

  const handleBulkCreateNoPin = async () => {
    setBulkNoPinCreated([]);
    setBulkNoPinFailed([]);
    setBulkNoPinProgress(null);

    if (!bulkNoPin.sponsorUserId || bulkNoPin.sponsorUserId.length !== 7) {
      toast.error('Enter a valid 7-digit sponsor ID');
      return;
    }
    if (!isStrongPassword(bulkNoPin.password)) {
      toast.error(getPasswordRequirementsText());
      return;
    }
    if (!isValidTransactionPassword(bulkNoPin.transactionPassword)) {
      toast.error(getTransactionPasswordRequirementsText());
      return;
    }

    setBulkNoPinLoading(true);
    setBulkNoPinProgress({
      stage: 'creating',
      processed: 0,
      total: Math.max(1, Number(bulkNoPin.quantity) || 1),
      created: 0,
      failed: 0,
      message: 'Starting bulk creation...'
    });
    const result = await bulkCreateUsersWithoutPin({
      sponsorUserId: bulkNoPin.sponsorUserId,
      quantity: bulkNoPin.quantity,
      namePrefix: bulkNoPin.namePrefix,
      country: bulkNoPin.country,
      password: bulkNoPin.password,
      transactionPassword: bulkNoPin.transactionPassword,
      onProgress: (progress) => {
        setBulkNoPinProgress(progress);
      }
    });
    setBulkNoPinLoading(false);

    if (result.success) {
      setBulkNoPinCreated(result.createdUserIds || []);
      setBulkNoPinFailed(result.failed || []);
      toast.success(result.message);
    } else {
      setBulkNoPinCreated(result.createdUserIds || []);
      setBulkNoPinFailed(result.failed || []);
      toast.error(result.message);
    }
  };

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return allUsers.filter((u) =>
      !query ||
      safeText(u.userId).includes(query) ||
      safeLower(u.email).includes(query) ||
      safeLower(u.fullName).includes(query)
    );
  }, [allUsers, searchQuery]);

  // For sorting by expensive fields (level/team/earnings), compute stats only
  // for a reasonably-sized sample instead of ALL 1000+ users.
  const DISPLAY_LIMIT = 50;
  const SAMPLE_LIMIT = 200; // Compute stats for top-200 by cheap proxy, then sort by expensive field within that.

  const rankedUsers = useMemo(() => {
    const sortNumber = (aValue: number, bValue: number) =>
      allUsersSortDirection === 'desc' ? bValue - aValue : aValue - bValue;

    // For cheap sorts (joined, direct), sort all directly.
    if (allUsersSortBy === 'joined' || allUsersSortBy === 'direct') {
      const users = [...filteredUsers];
      users.sort((a, b) => {
        if (allUsersSortBy === 'joined') {
          const diff = sortNumber(new Date(a.createdAt).getTime(), new Date(b.createdAt).getTime());
          if (diff !== 0) return diff;
        } else {
          const diff = sortNumber(a.directCount || 0, b.directCount || 0);
          if (diff !== 0) return diff;
        }
        const fallback = sortNumber(a.directCount || 0, b.directCount || 0);
        if (fallback !== 0) return fallback;
        return safeText(a.userId).localeCompare(safeText(b.userId));
      });
      return users.slice(0, DISPLAY_LIMIT);
    }

    // For expensive sorts (level/team/earnings): pre-sort by direct count to get a
    // reasonable sample, then compute expensive stats only for that sample.
    const preSorted = [...filteredUsers].sort((a, b) => (b.directCount || 0) - (a.directCount || 0));
    const sample = preSorted.slice(0, Math.min(SAMPLE_LIMIT, preSorted.length));

    // Compute expensive stats only for the sample
    const statsMap = new Map<string, { level: number; team: number; earnings: number }>();
    for (const u of sample) {
      if (allUsersSortBy === 'level') {
        statsMap.set(u.userId, { level: Database.getCurrentMatrixLevel(u.id), team: 0, earnings: 0 });
      } else if (allUsersSortBy === 'team') {
        const tc = Database.getTeamCounts(u.userId);
        statsMap.set(u.userId, { level: 0, team: (tc.left || 0) + (tc.right || 0), earnings: 0 });
      } else {
        statsMap.set(u.userId, { level: 0, team: 0, earnings: Database.getWallet(u.id)?.totalReceived || 0 });
      }
    }

    sample.sort((a, b) => {
      const sa = statsMap.get(a.userId)!;
      const sb = statsMap.get(b.userId)!;
      if (allUsersSortBy === 'level') {
        const diff = sortNumber(sa.level, sb.level);
        if (diff !== 0) return diff;
      } else if (allUsersSortBy === 'team') {
        const diff = sortNumber(sa.team, sb.team);
        if (diff !== 0) return diff;
      } else {
        const diff = sortNumber(sa.earnings, sb.earnings);
        if (diff !== 0) return diff;
      }
      const fallback = sortNumber(a.directCount || 0, b.directCount || 0);
      if (fallback !== 0) return fallback;
      return safeText(a.userId).localeCompare(safeText(b.userId));
    });

    return sample.slice(0, DISPLAY_LIMIT);
  }, [filteredUsers, allUsersSortBy, allUsersSortDirection]);

  // Compute display stats only for the 50 displayed users (not all 1000+).
  const displayedUserLevels = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of rankedUsers) {
      map.set(u.userId, Database.getCurrentMatrixLevel(u.id));
    }
    return map;
  }, [rankedUsers]);

  const displayedUserTeamStats = useMemo(() => {
    const map = new Map<string, { left: number; right: number; leftActive: number; rightActive: number }>();
    for (const u of rankedUsers) {
      map.set(u.userId, Database.getTeamCounts(u.userId));
    }
    return map;
  }, [rankedUsers]);

  const displayedUserEarnings = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of rankedUsers) {
      map.set(u.userId, Database.getWallet(u.id)?.totalReceived || 0);
    }
    return map;
  }, [rankedUsers]);

  const topReferrers = useMemo(() => {
    return [...allUsers]
      .filter((u) => !u.isAdmin)
      .sort((a, b) => {
        const directDiff = (b.directCount || 0) - (a.directCount || 0);
        if (directDiff !== 0) return directDiff;
        return safeText(a.userId).localeCompare(safeText(b.userId));
      })
      .slice(0, topReferrerLimit);
  }, [allUsers, topReferrerLimit]);

  const topReferrerStats = useMemo(() => {
    const statsByUserId = new Map<string, { level: number; left: number; right: number }>();
    topReferrers.forEach((u) => {
      const teamStats = Database.getTeamCounts(u.userId);
      statsByUserId.set(u.userId, {
        level: Database.getCurrentMatrixLevel(u.id),
        left: teamStats.left,
        right: teamStats.right
      });
    });
    return statsByUserId;
  }, [topReferrers]);

  const allUsersSortLabel = useMemo(() => {
    const isDesc = allUsersSortDirection === 'desc';
    if (allUsersSortBy === 'joined') return isDesc ? 'Date Joined (newest first)' : 'Date Joined (oldest first)';
    if (allUsersSortBy === 'level') return isDesc ? 'Level (highest first)' : 'Level (lowest first)';
    if (allUsersSortBy === 'earnings') return isDesc ? 'Earnings (highest first)' : 'Earnings (lowest first)';
    if (allUsersSortBy === 'team') return isDesc ? 'Left + Right Team (largest first)' : 'Left + Right Team (smallest first)';
    return isDesc ? 'Direct Referrals (highest first)' : 'Direct Referrals (lowest first)';
  }, [allUsersSortBy, allUsersSortDirection]);

  const userById = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);
  const userByUserId = useMemo(() => new Map(allUsers.map(u => [u.userId, u])), [allUsers]);

  const memberReportRows = useMemo(() => {
    if (!isReportsTabActive || reportTab !== 'member-report') return [];
    const rows: MemberReportRow[] = allUsers.map((u) => {
      const sponsor = u.sponsorId ? userByUserId.get(u.sponsorId) : undefined;
      const blockStatus: MemberReportRow['blockStatus'] = u.accountStatus === 'temp_blocked'
        ? 'temp_blocked'
        : u.accountStatus === 'permanent_blocked'
          ? 'permanent_blocked'
          : u.isActive
            ? 'active'
            : 'inactive';

      const levelProgress = Database.getLevelFillProgress(u.id);
      const currentLevelDisplay = `Level ${levelProgress.level} (${levelProgress.filled}/${levelProgress.required} filled)`;
      const trueQualifiedLevel = Database.getQualifiedLevel(u.id);

      return {
        id: u.id,
        createdAt: u.createdAt,
        userId: u.userId,
        name: u.fullName,
        mobile: u.phone || '-',
        sponsorId: u.sponsorId || '-',
        sponsorName: sponsor?.fullName || '-',
        currentLevelDisplay,
        qualifiedLevel: trueQualifiedLevel,
        achievedOffer: getOfferName(u),
        blockStatus
      };
    });

    return rows.filter((r) => {
      if (!isDateInRange(r.createdAt, memberFilters.dateFrom, memberFilters.dateTo)) return false;
      if (memberFilters.userId && !safeText(r.userId).includes(memberFilters.userId)) return false;
      if (memberFilters.name && !safeLower(r.name).includes(safeLower(memberFilters.name))) return false;
      if (memberFilters.level && r.qualifiedLevel !== Number(memberFilters.level)) return false;
      if (memberFilters.sponsorId && !safeText(r.sponsorId).includes(memberFilters.sponsorId)) return false;
      if (memberFilters.sponsorName && !safeLower(r.sponsorName).includes(safeLower(memberFilters.sponsorName))) return false;
      if (memberFilters.offer && r.achievedOffer !== memberFilters.offer) return false;
      if (memberFilters.blockStatus && r.blockStatus !== memberFilters.blockStatus) return false;
      return true;
    });
  }, [allUsers, userByUserId, memberFilters, isReportsTabActive, reportTab]);

  const receiveHelpReportRows = useMemo(() => {
    if (!isReportsTabActive || reportTab !== 'receive-help') return [];
    const ordered = [...allTransactions]
      .filter(tx => tx.type === 'receive_help')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const rows: ReceiveHelpReportRow[] = ordered.map((tx) => {
      const user = userById.get(tx.userId);
      let fromUser = tx.fromUserId ? userById.get(tx.fromUserId) : undefined;
      let fallbackFromUserId = '';
      let fallbackFromUserName = '';
      if (!fromUser) {
        const desc = tx.description || '';
        const match = desc.match(/from\s+(.+?)\s*\((\d{7})\)/i);
        if (match) {
          fallbackFromUserName = match[1].trim();
          fallbackFromUserId = match[2];
          fromUser = userByUserId.get(fallbackFromUserId);
        }
      }

      return {
        id: tx.id,
        createdAt: tx.createdAt,
        userId: user?.userId || '-',
        userName: user?.fullName || '-',
        amount: Math.abs(tx.amount),
        level: tx.level || 0,
        fromUserId: fromUser?.userId || fallbackFromUserId || '-',
        fromUserName: fromUser?.fullName || fallbackFromUserName || '-'
      };
    });

    return rows
      .filter((r) => {
        if (!isDateInRange(r.createdAt, receiveFilters.dateFrom, receiveFilters.dateTo)) return false;
        if (receiveFilters.userId && !safeText(r.userId).includes(receiveFilters.userId)) return false;
        if (receiveFilters.userName && !safeLower(r.userName).includes(safeLower(receiveFilters.userName))) return false;
        if (receiveFilters.level && r.level !== Number(receiveFilters.level)) return false;
        if (receiveFilters.amountMin && r.amount < Number(receiveFilters.amountMin)) return false;
        if (receiveFilters.amountMax && r.amount > Number(receiveFilters.amountMax)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allTransactions, userById, receiveFilters, isReportsTabActive, reportTab]);

  const giveHelpReportRows = useMemo(() => {
    if (!isReportsTabActive || reportTab !== 'give-help') return [];
    const receiveHelpTx = allTransactions.filter(tx => tx.type === 'receive_help' && tx.fromUserId);
    const rows: GiveHelpReportRow[] = allTransactions
      .filter(tx => tx.type === 'give_help')
      .map((tx) => {
        const sender = userById.get(tx.userId);
        const txAmount = Math.abs(tx.amount);
        let receiver = tx.toUserId ? userById.get(tx.toUserId) : undefined;
        if (!receiver && tx.toUserId) {
          receiver = userByUserId.get(tx.toUserId);
        }

        // Fallback for legacy transactions that didn't store explicit receiver
        if (!receiver) {
          const txTime = new Date(tx.createdAt).getTime();
          const candidates = receiveHelpTx
            .filter(g =>
              g.fromUserId === tx.userId &&
              (tx.level ? g.level === tx.level : true) &&
              Math.abs(Math.abs(g.amount) - txAmount) < 0.0001
            )
            .sort((a, b) => Math.abs(new Date(a.createdAt).getTime() - txTime) - Math.abs(new Date(b.createdAt).getTime() - txTime));

          const best = candidates[0];
          receiver = best ? userById.get(best.userId) : undefined;
        }

        const safetyDest = !receiver && safeLower(tx.description || '').includes('safety pool');
        const giveToId = receiver
          ? receiver.userId
          : safetyDest
            ? 'SAFETY_POOL'
            : '-';
        const giveToUserName = receiver
          ? receiver.fullName
          : safetyDest
            ? 'Safety Pool'
            : '-';

        return {
          id: tx.id,
          createdAt: tx.createdAt,
          userId: sender?.userId || '-',
          userName: sender?.fullName || '-',
          amount: txAmount,
          level: tx.level || 0,
          giveToId,
          giveToUserName
        };
      });

    return rows
      .filter((r) => {
        if (!isDateInRange(r.createdAt, giveFilters.dateFrom, giveFilters.dateTo)) return false;
        if (giveFilters.userId && !safeText(r.userId).includes(giveFilters.userId)) return false;
        if (giveFilters.userName && !safeLower(r.userName).includes(safeLower(giveFilters.userName))) return false;
        if (giveFilters.amountMin && r.amount < Number(giveFilters.amountMin)) return false;
        if (giveFilters.amountMax && r.amount > Number(giveFilters.amountMax)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allTransactions, userById, userByUserId, giveFilters, isReportsTabActive, reportTab]);

  const ghostRepairLogs = useMemo(() => {
    if (!isReportsTabActive) return [];
    const logs = Database.getGhostReceiveHelpRepairLogs();
    return [...logs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [ghostRepairLogTick, isReportsTabActive]);

  const userHelpLockDebug = useMemo(() => {
    if (!searchedUser?.transactions) {
      return { giveEntries: [], lockedEntries: [] };
    }

    const txs: Transaction[] = searchedUser.transactions;
    const lockState = new Map<string, 'locked' | 'unlocked'>();
    const lockedMeta = new Map<string, { amount: number; level: number; description: string; createdAt: string }>();
    const firstTwoByLevel = new Map<number, Array<{ txId: string; remaining: number }>>();
    const qualificationByLevel = new Map<number, Array<{ txId: string; remaining: number }>>();
    const originalIndexById = new Map<string, number>();
    txs.forEach((tx, index) => {
      originalIndexById.set(tx.id, index);
    });

    const getTxLevel = (tx: Transaction): number | null => {
      const numericLevel = typeof tx.level === 'number' ? tx.level : Number(tx.level);
      if (Number.isFinite(numericLevel) && numericLevel >= 1 && numericLevel <= 10) {
        return numericLevel;
      }
      const match = tx.description?.match(/level\s+(\d+)/i);
      return match ? Number(match[1]) : null;
    };

    const getTxTimestamp = (tx: Transaction): number => {
      const created = Date.parse(tx.createdAt || '');
      if (!Number.isNaN(created)) return created;
      const completed = Date.parse(tx.completedAt || '');
      if (!Number.isNaN(completed)) return completed;
      const idMatch = (tx.id || '').match(/_(\d{10,13})(?:_|$)/);
      if (idMatch) {
        const n = Number(idMatch[1]);
        if (Number.isFinite(n)) {
          return idMatch[1].length === 10 ? n * 1000 : n;
        }
      }
      return 0;
    };

    const consumeQueueAtLevel = (
      queueMap: Map<number, Array<{ txId: string; remaining: number }>>,
      level: number,
      amount: number,
      consumed: Array<{ txId: string; amount: number; level: number; description: string }>
    ): number => {
      if (amount <= 0) return 0;
      const queue = queueMap.get(level);
      if (!queue || queue.length === 0) return amount;
      let remaining = amount;

      for (const item of queue) {
        if (remaining <= 0) break;
        if (item.remaining <= 0) continue;
        const used = Math.min(item.remaining, remaining);
        item.remaining -= used;
        remaining -= used;
        const meta = lockedMeta.get(item.txId);
        consumed.push({
          txId: item.txId,
          amount: used,
          level,
          description: meta?.description || ''
        });
        if (item.remaining <= 0) {
          lockState.set(item.txId, 'unlocked');
        }
      }

      queueMap.set(level, queue.filter((item) => item.remaining > 0));
      return remaining;
    };

    const consumeQueueAcrossLevels = (
      queueMap: Map<number, Array<{ txId: string; remaining: number }>>,
      preferredLevel: number,
      amount: number,
      consumed: Array<{ txId: string; amount: number; level: number; description: string }>
    ): number => {
      if (amount <= 0) return 0;
      const levels = Array.from(queueMap.keys())
        .filter((lvl) => Number.isFinite(lvl))
        .sort((a, b) => a - b);
      const ordered = levels.includes(preferredLevel)
        ? [preferredLevel, ...levels.filter((lvl) => lvl !== preferredLevel)]
        : levels;
      let remaining = amount;
      for (const level of ordered) {
        if (remaining <= 0) break;
        remaining = consumeQueueAtLevel(queueMap, level, remaining, consumed);
      }
      return remaining;
    };

    const sortedAsc = [...txs].sort((a, b) => {
      const timeDiff = getTxTimestamp(a) - getTxTimestamp(b);
      if (timeDiff !== 0) return timeDiff;

      const getLockedFlowPriority = (tx: Transaction): number => {
        const txDesc = (tx.description || '').toLowerCase();
        if (
          tx.type === 'receive_help'
          && tx.amount > 0
          && (
            txDesc.startsWith('locked first-two help at level')
            || txDesc.startsWith('locked receive help at level')
          )
        ) {
          return 0;
        }
        if (
          (tx.type === 'give_help' && txDesc.includes('from locked income'))
          || (
            tx.type === 'receive_help'
            && tx.amount > 0
            && txDesc.startsWith('released locked receive help at level')
          )
        ) {
          return 1;
        }
        return 2;
      };

      const priorityDiff = getLockedFlowPriority(a) - getLockedFlowPriority(b);
      if (priorityDiff !== 0) return priorityDiff;
      const indexDiff = (originalIndexById.get(a.id) ?? 0) - (originalIndexById.get(b.id) ?? 0);
      if (indexDiff !== 0) return indexDiff;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    const giveEntries: Array<{
      txId: string;
      createdAt: string;
      amount: number;
      sourceLevel: number;
      consumed: Array<{ txId: string; amount: number; level: number; description: string }>;
    }> = [];

    for (const tx of sortedAsc) {
      const desc = (tx.description || '').toLowerCase();
      const level = getTxLevel(tx);

      if (tx.type === 'receive_help' && tx.amount > 0 && desc.startsWith('locked first-two help at level')) {
        if (!level) continue;
        const list = firstTwoByLevel.get(level) || [];
        list.push({ txId: tx.id, remaining: tx.amount });
        firstTwoByLevel.set(level, list);
        lockState.set(tx.id, 'locked');
        lockedMeta.set(tx.id, { amount: tx.amount, level, description: tx.description || '', createdAt: tx.createdAt });
        continue;
      }

      if (tx.type === 'receive_help' && tx.amount > 0 && desc.startsWith('locked receive help at level')) {
        if (!level) continue;
        const list = qualificationByLevel.get(level) || [];
        list.push({ txId: tx.id, remaining: tx.amount });
        qualificationByLevel.set(level, list);
        lockState.set(tx.id, 'locked');
        lockedMeta.set(tx.id, { amount: tx.amount, level, description: tx.description || '', createdAt: tx.createdAt });
        continue;
      }

      if (tx.type === 'give_help' && desc.includes('from locked income')) {
        const preferredLevel = Math.max(1, (level || 1) - 1);
        const consumed: Array<{ txId: string; amount: number; level: number; description: string }> = [];
        let remaining = Math.abs(tx.amount);
        remaining = consumeQueueAcrossLevels(qualificationByLevel, preferredLevel, remaining, consumed);
        consumeQueueAcrossLevels(firstTwoByLevel, preferredLevel, remaining, consumed);

        giveEntries.push({
          txId: tx.id,
          createdAt: tx.createdAt,
          amount: Math.abs(tx.amount),
          sourceLevel: preferredLevel,
          consumed
        });
        continue;
      }

      if (tx.type === 'receive_help' && tx.amount > 0 && desc.startsWith('released locked receive help at level')) {
        if (!level) continue;
        consumeQueueAtLevel(qualificationByLevel, level, tx.amount, []);
      }
    }

    const lockedEntries = Array.from(lockedMeta.entries()).map(([txId, meta]) => ({
      txId,
      ...meta,
      status: lockState.get(txId) || 'locked'
    }));

    return { giveEntries, lockedEntries };
  }, [searchedUser]);

  const offerAchieverRows = useMemo(() => {
    if (!isReportsTabActive || reportTab !== 'offer-achievers') return [];
    const rows: OfferAchieverReportRow[] = [];

    allUsers.forEach((u) => {
      const sponsor = u.sponsorId ? userByUserId.get(u.sponsorId) : undefined;
      const trueQualifiedLevel = Database.getQualifiedLevel(u.id);

      const base = {
        userId: u.userId,
        name: u.fullName,
        mobile: u.phone || '-',
        qualifiedLevel: trueQualifiedLevel,
        sponsorId: sponsor?.userId || '-',
        sponsorName: sponsor?.fullName || '-',
        sponsorMobile: sponsor?.phone || '-'
      };

      if (u.achievements?.silverCoin) {
        rows.push({
          achievedAt: u.achievements.silverCoinDate || u.createdAt,
          offerAchieved: 'Silver Coin Achiever',
          ...base
        });
      }
      if (u.achievements?.nationalTour) {
        rows.push({
          achievedAt: u.achievements.nationalTourDate || u.createdAt,
          offerAchieved: 'National Tour Achiever',
          ...base
        });
      }
      if (u.achievements?.internationalTour) {
        rows.push({
          achievedAt: u.achievements.internationalTourDate || u.createdAt,
          offerAchieved: 'International Tour Achiever',
          ...base
        });
      }
      if (u.achievements?.familyTour) {
        rows.push({
          achievedAt: u.achievements.familyTourDate || u.createdAt,
          offerAchieved: 'International Family Tour Achiever',
          ...base
        });
      }
    });

    return rows.filter((r) => {
      if (!isDateInRange(r.achievedAt, offerFilters.dateFrom, offerFilters.dateTo)) return false;
      if (offerFilters.userId && !safeText(r.userId).includes(offerFilters.userId)) return false;
      if (offerFilters.name && !safeLower(r.name).includes(safeLower(offerFilters.name))) return false;
      if (offerFilters.level && r.qualifiedLevel !== Number(offerFilters.level)) return false;
      if (offerFilters.offer && r.offerAchieved !== offerFilters.offer) return false;
      if (offerFilters.sponsorId && !safeText(r.sponsorId).includes(offerFilters.sponsorId)) return false;
      if (offerFilters.sponsorName && !safeLower(r.sponsorName).includes(safeLower(offerFilters.sponsorName))) return false;
      return true;
    });
  }, [allUsers, userByUserId, offerFilters, isReportsTabActive, reportTab]);

  const filteredLevelReport = useMemo(() => {
    if (!isReportsTabActive || reportTab !== 'all-level') return [];
    return levelReport.filter((row) => {
      if (!isDateInRange(row.date, allLevelFilters.dateFrom, allLevelFilters.dateTo)) return false;
      if (allLevelFilters.userId && !safeText(row.userId).includes(allLevelFilters.userId)) return false;
      if (allLevelFilters.name && !safeLower(row.fullName).includes(safeLower(allLevelFilters.name))) return false;
      if (allLevelFilters.sponsorId && !safeText(row.sponsorId).includes(allLevelFilters.sponsorId)) return false;
      return true;
    });
  }, [levelReport, allLevelFilters, isReportsTabActive, reportTab]);

  const depositReportRows = useMemo(() => {
    if (!isReportsTabActive || reportTab !== 'deposit-report') return [];
    // Get all completed payments for deposit report
    const allPayments = Database.getAllCompletedPayments();
    const rows: DepositReportRow[] = allPayments.map(p => ({
      id: p.id,
      createdAt: p.createdAt,
      userId: p.userId,
      userName: userById?.get(p.userId)?.fullName || '-',
      amount: p.amount,
      method: p.method,
      status: p.status,
      txHash: p.txHash || ''
    }));

    return rows.filter(r => {
      if (!isDateInRange(r.createdAt, depositReportFilters.dateFrom, depositReportFilters.dateTo)) return false;
      if (depositReportFilters.userId && !safeText(r.userId).includes(depositReportFilters.userId)) return false;
      if (depositReportFilters.userName && !safeLower(r.userName).includes(safeLower(depositReportFilters.userName))) return false;
      if (depositReportFilters.status && r.status !== depositReportFilters.status) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [depositReportFilters, isReportsTabActive, reportTab]);

  const withdrawalReportRows = useMemo(() => {
    if (!isReportsTabActive || reportTab !== 'withdrawal-report') return [];
    // Filter transactions for withdrawals
    const rows: WithdrawalReportRow[] = allTransactions
      .filter(tx => tx.type === 'withdrawal')
      .map(tx => {
        const user = userById.get(tx.userId);
        return {
          id: tx.id,
          createdAt: tx.createdAt,
          userId: user?.userId || '-',
          userName: user?.fullName || '-',
          amount: Math.abs(tx.amount),
          status: tx.status,
          description: tx.description
        };
      });

    return rows.filter(r => {
      if (!isDateInRange(r.createdAt, withdrawalReportFilters.dateFrom, withdrawalReportFilters.dateTo)) return false;
      if (withdrawalReportFilters.userId && !safeText(r.userId).includes(withdrawalReportFilters.userId)) return false;
      if (withdrawalReportFilters.userName && !safeLower(r.userName).includes(safeLower(withdrawalReportFilters.userName))) return false;
      if (withdrawalReportFilters.status && r.status !== withdrawalReportFilters.status) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allTransactions, userById, withdrawalReportFilters, isReportsTabActive, reportTab]);

  const lockedIncomeRows = useMemo(() => {
    if (!isReportsTabActive || reportTab !== 'locked-income') return [];
    const rows: LockedIncomeReportRow[] = allUsers
      .filter(u => !u.isAdmin)
      .map(u => {
        const wallet = Database.getWallet(u.id);
        const currentLevel = Database.getCurrentMatrixLevel(u.id);
        const requiredDirect = Database.getRequiredDirectsForLevel(currentLevel + 1);
        return {
          userId: u.userId,
          name: u.fullName,
          lockedAmount: wallet?.lockedIncomeWallet || 0,
          directCount: u.directCount || 0,
          requiredDirect,
          currentLevel
        };
      })
      .filter(r => r.lockedAmount > 0);

    return rows.filter(r => {
      if (lockedIncomeFilters.userId && !safeText(r.userId).includes(lockedIncomeFilters.userId)) return false;
      if (lockedIncomeFilters.name && !safeLower(r.name).includes(safeLower(lockedIncomeFilters.name))) return false;
      if (lockedIncomeFilters.minAmount && r.lockedAmount < Number(lockedIncomeFilters.minAmount)) return false;
      return true;
    }).sort((a, b) => b.lockedAmount - a.lockedAmount);
  }, [allUsers, lockedIncomeFilters, isReportsTabActive, reportTab]);

  const safetyPoolRows = useMemo(() => {
    if (!isReportsTabActive || reportTab !== 'safety-pool') return [];
    const pool = Database.getSafetyPool();
    return pool.transactions
      .map((t) => {
        const user = userById.get(t.fromUserId);
        return {
          id: t.id || Math.random().toString(),
          createdAt: t.createdAt,
          userId: user?.userId || '-',
          userName: user?.fullName || '-',
          amount: t.amount,
          reason: t.reason
        };
      })
      .filter((r) => {
        if (!isDateInRange(r.createdAt, safetyPoolFilters.dateFrom, safetyPoolFilters.dateTo)) return false;
        if (safetyPoolFilters.userId && !safeText(r.userId).includes(safetyPoolFilters.userId)) return false;
        if (safetyPoolFilters.reason && !safeLower(r.reason).includes(safeLower(safetyPoolFilters.reason))) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [userById, safetyPoolFilters, isReportsTabActive, reportTab]);

  const filteredPinRequests = useMemo(() => {
    if (pinRequestStatusFilter === 'all') return allPinRequests;
    return allPinRequests.filter(r => r.status === pinRequestStatusFilter);
  }, [allPinRequests, pinRequestStatusFilter]);

  const filteredSupportTickets = useMemo(() => {
    return supportTickets.filter((ticket) => {
      if (supportStatusFilter !== 'all' && ticket.status !== supportStatusFilter) return false;
      if (!supportSearch.trim()) return true;
      const q = supportSearch.trim().toLowerCase();
      return (
        ticket.ticket_id.toLowerCase().includes(q)
        || ticket.user_id.toLowerCase().includes(q)
        || (ticket.name || '').toLowerCase().includes(q)
        || (ticket.subject || '').toLowerCase().includes(q)
      );
    });
  }, [supportTickets, supportStatusFilter, supportSearch]);

  const pendingWithdrawalCount = useMemo(
    () => withdrawalRequests.filter((tx) => tx.status === 'pending').length,
    [withdrawalRequests]
  );

  const openSupportCount = useMemo(
    () => supportTickets.filter((ticket) => ticket.status === 'open' || ticket.status === 'in_progress').length,
    [supportTickets]
  );

  const selectedSupportTicket = useMemo(
    () => supportTickets.find((ticket) => ticket.ticket_id === selectedSupportTicketId) || null,
    [supportTickets, selectedSupportTicketId]
  );

  const announcementSummary = useMemo(() => {
    const total = announcementHistory.length;
    const nowTs = Date.now();
    const active = announcementHistory.filter((item) => {
      if (item.isRecalled) return false;
      if (item.expiresAt && Date.parse(item.expiresAt) <= nowTs) return false;
      return true;
    }).length;
    const recalled = total - active;
    const totalRecipients = announcementHistory.reduce((sum, item) => sum + (item.totalRecipients || 0), 0);
    return { total, active, recalled, totalRecipients };
  }, [announcementHistory]);

  const userLookup = useMemo(() => {
    const map = new Map<string, (typeof allUsers)[number]>();
    for (const member of allUsers) {
      map.set(member.id, member);
      map.set(member.userId, member);
    }
    return map;
  }, [allUsers]);

  const filteredWithdrawalRequests = useMemo(() => {
    const rows = [...withdrawalRequests].sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    if (withdrawalStatusFilter === 'all') return rows;
    return rows.filter((tx) => tx.status === withdrawalStatusFilter);
  }, [withdrawalRequests, withdrawalStatusFilter]);

  const filteredDepositHistory = useMemo(() => {
    const rows = [...depositHistory].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (depositHistoryStatusFilter === 'all') return rows;
    return rows.filter((payment) => payment.status === depositHistoryStatusFilter);
  }, [depositHistory, depositHistoryStatusFilter]);

  useEffect(() => {
    if (selectedSupportTicket) {
      setSupportStatusDraft(selectedSupportTicket.status);
    }
  }, [selectedSupportTicket]);

  useEffect(() => {
    setEditingSupportMessageId('');
    setEditingSupportMessageText('');
  }, [selectedSupportTicketId]);

  const handleSupportStatusUpdate = async () => {
    if (!selectedSupportTicket) return;
    try {
      const updated = await Database.commitCriticalAction(() => Database.updateSupportTicketStatus(selectedSupportTicket.ticket_id, supportStatusDraft));
      if (!updated) {
        toast.error('Failed to update ticket status');
        return;
      }
      loadSupportTickets();
      toast.success(`Ticket ${updated.ticket_id} marked ${SUPPORT_STATUS_OPTIONS.find((s) => s.value === updated.status)?.label || updated.status}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update ticket status');
    }
  };

  const handleSupportAttachmentChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setSupportReplyAttachment(null);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Attachment size must be under 5MB');
      return;
    }
    try {
      const attachment = await readSupportAttachment(file);
      setSupportReplyAttachment(attachment);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to read attachment');
    }
  };

  const handleSupportReply = async () => {
    if (!selectedSupportTicket || !user) return;
    if (!supportReplyMessage.trim() && !supportReplyAttachment) {
      toast.error('Write a reply or attach a file');
      return;
    }
    try {
      const updated = await Database.commitCriticalAction(() => Database.addSupportTicketMessage({
        ticket_id: selectedSupportTicket.ticket_id,
        sender_type: 'admin',
        sender_user_id: user.userId,
        sender_name: 'Admin',
        message: supportReplyMessage.trim(),
        attachments: supportReplyAttachment ? [supportReplyAttachment] : []
      }));
      if (!updated) {
        toast.error('Failed to send reply');
        return;
      }
      setSupportReplyMessage('');
      setSupportReplyAttachment(null);
      setSupportStatusDraft(updated.status);
      loadSupportTickets();
      toast.success('Reply sent');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send reply');
    }
  };

  const handleAdminSupportMessageEdit = async () => {
    if (!selectedSupportTicket || !user || !editingSupportMessageId) return;
    try {
      const updated = await Database.commitCriticalAction(() => Database.updateSupportTicketMessage({
        ticket_id: selectedSupportTicket.ticket_id,
        message_id: editingSupportMessageId,
        editor_type: 'admin',
        editor_user_id: user.userId,
        message: editingSupportMessageText.trim()
      }));
      if (!updated) {
        toast.error('Failed to edit reply');
        return;
      }
      setEditingSupportMessageId('');
      setEditingSupportMessageText('');
      loadSupportTickets();
      toast.success('Reply updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to edit reply');
    }
  };

  const exportData = () => {
    const data = {
      users: allUsers,
      stats,
      exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mlm-data-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success('Data exported successfully');
  };

  if (!user?.isAdmin) return null;

  return (
    <div className="admin-page min-h-screen bg-[#0a0e17] pb-24 md:pb-0" >
      {/* Header */}
      <header className="glass sticky top-0 z-50 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between min-h-16 py-2 sm:py-0 gap-2 sm:gap-3">
            <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/dashboard')}
                className="text-white/60 hover:text-white"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div>
                  <span className="text-base sm:text-xl font-bold text-white">Admin Panel</span>
                  <Badge className="hidden sm:inline-flex ml-2 bg-purple-500/20 text-purple-400">Admin</Badge>
                </div>
              </div>
            </div>

            <div className="flex w-full sm:w-auto items-center justify-end gap-2 sm:gap-3 flex-wrap sm:flex-nowrap">
              <Button
                variant="outline"
                onClick={handleCreateServerBackup}
                disabled={isCreatingBackup}
                className="border-emerald-400/30 text-emerald-200 hover:bg-emerald-500/10"
              >
                {isCreatingBackup ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                <span className="hidden sm:inline">Create Backup</span>
              </Button>
              <Button
                variant="outline"
                onClick={exportData}
                className="border-white/20 text-white hover:bg-white/10"
              >
                <Download className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Export</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => { void runAdminRefresh(); }}
                className="border-white/20 text-white hover:bg-white/10"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                className="text-white/60 hover:text-red-400"
              >
                <LogOut className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm text-white/60">Total Users</p>
                  <p className="text-xl sm:text-2xl font-bold text-white">{formatNumber(stats?.totalUsers || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm text-white/60">Active Users</p>
                  <p className="text-xl sm:text-2xl font-bold text-white">{formatNumber(stats?.activeUsers || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-sm text-white/60">Total Distributed</p>
                  <p className="text-xl sm:text-2xl font-bold text-white">{formatCurrency(stats?.totalHelpDistributed || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm text-white/60">Safety Pool</p>
                  <p className="text-xl sm:text-2xl font-bold text-white">{formatCurrency(safetyPoolAmount)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <p className="text-sm text-white/60">Total Deposits</p>
                  <p className="text-xl sm:text-2xl font-bold text-white">{formatCurrency(stats?.totalDeposits || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-rose-500/20 flex items-center justify-center">
                  <ArrowUp className="w-5 h-5 text-rose-400" />
                </div>
                <div>
                  <p className="text-sm text-white/60">Total Withdrawals</p>
                  <p className="text-xl sm:text-2xl font-bold text-white">{formatCurrency(stats?.totalWithdrawals || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <p className="text-sm text-white/60">Total Locked Income</p>
                  <p className="text-xl sm:text-2xl font-bold text-white">{formatCurrency(stats?.totalLockedIncome || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-sky-500/20 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-sky-400" />
                </div>
                <div>
                  <p className="text-sm text-white/60">Total Income Wallet</p>
                  <p className="text-xl sm:text-2xl font-bold text-white">{formatCurrency(stats?.totalIncomeWalletBalance || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <p className="text-sm text-white/60">Total Fund Wallet Balance</p>
                  <p className="text-xl sm:text-2xl font-bold text-white">{formatCurrency(stats?.totalFundWalletBalance || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-teal-500/20 flex items-center justify-center">
                  <Ticket className="w-5 h-5 text-teal-400" />
                </div>
                <div>
                  <p className="text-sm text-white/60">No of Pin Sold</p>
                  <p className="text-xl sm:text-2xl font-bold text-white">{formatNumber(stats?.totalPinsSold || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-fuchsia-500/20 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-fuchsia-400" />
                </div>
                <div>
                  <p className="text-sm text-white/60">Total Pin Sold Amount</p>
                  <p className="text-xl sm:text-2xl font-bold text-white">{formatCurrency(stats?.totalPinSoldAmount || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-lime-500/20 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-lime-400" />
                </div>
                <div>
                  <p className="text-sm text-white/60">Balance Amount Remaining</p>
                  <p className="text-xl sm:text-2xl font-bold text-white">{formatCurrency(stats?.balanceAmountRemaining || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>


        {/* Main Content Tabs */}
        <Tabs value={activeMainTab} onValueChange={setActiveMainTab} className="space-y-6">
          <TabsList className="mobile-bottom-scroll bg-[#1f2937] border border-white/10 h-auto w-full justify-start gap-1 overflow-x-auto whitespace-nowrap">
            <TabsTrigger value="users" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Users</TabsTrigger>
            <TabsTrigger value="pins" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">
              PIN Management
              {pendingPinRequests.length > 0 && (
                <span className="ml-1 text-xs bg-fuchsia-500/90 text-white px-1.5 rounded-full">
                  {pendingPinRequests.length}
                </span>
              )}
              {orphanedPinCount > 0 && (
                <span className="ml-1 text-xs bg-amber-500/90 text-white px-1.5 rounded-full">
                  {orphanedPinCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="payments" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">
              Payments
              {(pendingPayments.length > 0 || pendingWithdrawalCount > 0) && (
                <span className="ml-1 text-xs bg-amber-500/90 text-white px-1.5 rounded-full">
                  {pendingPayments.length + pendingWithdrawalCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="user-details" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">User Details</TabsTrigger>
            <TabsTrigger value="impersonate" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Login As User</TabsTrigger>
            <TabsTrigger value="support" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">
              Support
              {openSupportCount > 0 && (
                <span className="ml-1 text-xs bg-teal-500/90 text-white px-1.5 rounded-full">
                  {openSupportCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="reports" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Reports</TabsTrigger>
            <TabsTrigger value="matrix" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Matrix Table</TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Settings</TabsTrigger>
            <TabsTrigger value="marketplace" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Marketplace</TabsTrigger>
          </TabsList>

          {/* Users Tab */}
          <TabsContent value="users">
            <Card className="glass border-white/10 mb-6">
              <CardHeader>
                <CardTitle className="text-white">Bulk Create IDs (No PIN)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-white/80">Sponsor ID</Label>
                    <Input
                      value={bulkNoPin.sponsorUserId}
                      onChange={(e) => setBulkNoPin((prev) => ({ ...prev, sponsorUserId: e.target.value.replace(/\D/g, '').slice(0, 7) }))}
                      maxLength={7}
                      placeholder="7-digit sponsor ID"
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/80">Quantity</Label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={bulkNoPin.quantity}
                      onChange={(e) => setBulkNoPin((prev) => ({ ...prev, quantity: Math.max(1, parseInt(e.target.value || '1')) }))}
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/80">Name Prefix</Label>
                    <Input
                      value={bulkNoPin.namePrefix}
                      onChange={(e) => setBulkNoPin((prev) => ({ ...prev, namePrefix: e.target.value }))}
                      placeholder="Member"
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-white/80">Country</Label>
                    <Input
                      value={bulkNoPin.country}
                      onChange={(e) => setBulkNoPin((prev) => ({ ...prev, country: e.target.value }))}
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/80">Default Password</Label>
                    <Input
                      value={bulkNoPin.password}
                      onChange={(e) => setBulkNoPin((prev) => ({ ...prev, password: e.target.value }))}
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/80">Default Tx Password</Label>
                    <Input
                      value={bulkNoPin.transactionPassword}
                      onChange={(e) => setBulkNoPin((prev) => ({ ...prev, transactionPassword: e.target.value }))}
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>
                </div>

                <Button onClick={handleBulkCreateNoPin} disabled={bulkNoPinLoading} className="w-full btn-primary">
                  {bulkNoPinLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Users className="w-4 h-4 mr-2" />}
                  {bulkNoPinLoading && bulkNoPinProgress
                    ? `${bulkNoPinProgress.processed}/${bulkNoPinProgress.total} Processing...`
                    : 'Create IDs Without PIN'}
                </Button>
                {bulkNoPinProgress && (
                  <div className="p-3 rounded-lg bg-[#1f2937] border border-white/10 space-y-2">
                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <span className="text-white/80">{bulkNoPinProgress.message}</span>
                      <span className="text-[#8fcfff]">
                        {bulkNoPinProgress.processed}/{bulkNoPinProgress.total}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          bulkNoPinProgress.stage === 'failed'
                            ? 'bg-red-500'
                            : bulkNoPinProgress.stage === 'completed'
                              ? 'bg-emerald-500'
                              : 'bg-[#118bdd]'
                        }`}
                        style={{
                          width: `${Math.max(
                            3,
                            Math.min(
                              100,
                              Math.round((bulkNoPinProgress.processed / Math.max(1, bulkNoPinProgress.total)) * 100)
                            )
                          )}%`
                        }}
                      />
                    </div>
                    <div className="text-xs text-white/60">
                      Created: <span className="text-emerald-400">{bulkNoPinProgress.created}</span>
                      {' '}| Failed: <span className="text-red-400">{bulkNoPinProgress.failed}</span>
                      {' '}| Stage: <span className="text-[#8fcfff]">{bulkNoPinProgress.stage}</span>
                    </div>
                  </div>
                )}

                {bulkNoPinCreated.length > 0 && (
                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                    <p className="text-emerald-400 text-sm">
                      Created {bulkNoPinCreated.length} ID(s): {bulkNoPinCreated.join(', ')}
                    </p>
                  </div>
                )}
                {bulkNoPinFailed.length > 0 && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                    <p className="text-red-400 text-sm">
                      Failed {bulkNoPinFailed.length}: {bulkNoPinFailed.join(' | ')}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="glass border-white/10 mb-6">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Megaphone className="w-5 h-5 text-sky-400" />
                  Broadcast Announcement
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-white/60">
                  Send a notification announcement to existing users, with optional future-user delivery based on your selection. Optional image will appear inside the notification card.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="rounded-md border border-white/10 bg-[#1f2937] px-3 py-2">
                    <p className="text-[11px] text-white/55">Total Sent</p>
                    <p className="text-sm font-semibold text-white">{announcementSummary.total}</p>
                  </div>
                  <div className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2">
                    <p className="text-[11px] text-emerald-200/70">Active</p>
                    <p className="text-sm font-semibold text-emerald-300">{announcementSummary.active}</p>
                  </div>
                  <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                    <p className="text-[11px] text-amber-200/70">Recalled</p>
                    <p className="text-sm font-semibold text-amber-300">{announcementSummary.recalled}</p>
                  </div>
                  <div className="rounded-md border border-sky-500/25 bg-sky-500/10 px-3 py-2">
                    <p className="text-[11px] text-sky-200/70">Total Delivered</p>
                    <p className="text-sm font-semibold text-sky-300">{formatNumber(announcementSummary.totalRecipients)}</p>
                  </div>
                </div>
                {editingAnnouncement && (
                  <div className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs text-amber-200/80">Editing announcement</p>
                      <p className="text-sm font-semibold text-amber-100">{editingAnnouncement.title}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={cancelEditAnnouncement}
                      className="border-amber-400/40 text-amber-200 hover:bg-amber-500/10"
                    >
                      Cancel Edit
                    </Button>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-white/80">Title</Label>
                    <Input
                      value={announcementData.title}
                      onChange={(e) => setAnnouncementData((prev) => ({ ...prev, title: e.target.value }))}
                      placeholder="Important Announcement"
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/80">Image URL (Optional)</Label>
                    <Input
                      value={announcementData.imageUrl}
                      onChange={(e) => setAnnouncementData((prev) => ({ ...prev, imageUrl: e.target.value }))}
                      placeholder="https://..."
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Upload Image (Optional)</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-[#1f2937] px-3 py-2 text-sm text-white/80 cursor-pointer hover:bg-white/10">
                      <ImagePlus className="w-4 h-4" />
                      Upload
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleAnnouncementImageUpload}
                      />
                    </label>
                    {announcementData.imageUrl && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setAnnouncementData((prev) => ({ ...prev, imageUrl: '' }))}
                        className="border-red-500/40 text-red-300 hover:bg-red-500/10"
                      >
                        Remove Image
                      </Button>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Message</Label>
                  <Textarea
                    value={announcementData.message}
                    onChange={(e) => setAnnouncementData((prev) => ({ ...prev, message: e.target.value }))}
                    placeholder="Write your announcement message..."
                    className="bg-[#1f2937] border-white/10 text-white min-h-[110px]"
                  />
                </div>
                <div className="rounded-lg border border-white/10 bg-[#141c2a] p-3 space-y-3">
                  <p className="text-sm text-white/80 font-medium">Delivery Options</p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <label className="flex items-center gap-2 text-sm text-white/70">
                      <input
                        type="radio"
                        name="announcement-duration"
                        checked={announcementData.isPermanent}
                        onChange={() => setAnnouncementData((prev) => ({ ...prev, isPermanent: true, includeFutureUsers: true }))}
                      />
                      Permanent (until you take back)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-white/70">
                      <input
                        type="radio"
                        name="announcement-duration"
                        checked={!announcementData.isPermanent}
                        onChange={() => setAnnouncementData((prev) => ({ ...prev, isPermanent: false, includeFutureUsers: false }))}
                      />
                      Time period (days)
                    </label>
                  </div>
                  {!announcementData.isPermanent && (
                    <div className="flex flex-col sm:flex-row gap-3">
                      <Input
                        type="number"
                        min={1}
                        value={announcementData.durationDays}
                        onChange={(e) => setAnnouncementData((prev) => ({ ...prev, durationDays: e.target.value }))}
                        className="bg-[#1f2937] border-white/10 text-white sm:max-w-[180px]"
                        placeholder="Number of days"
                      />
                      <label className="flex items-center gap-2 text-sm text-white/70">
                        <input
                          type="checkbox"
                          checked={announcementData.includeFutureUsers}
                          onChange={(e) => setAnnouncementData((prev) => ({ ...prev, includeFutureUsers: e.target.checked }))}
                        />
                        Include future users (approval)
                      </label>
                    </div>
                  )}
                  {announcementData.isPermanent && (
                    <p className="text-xs text-white/50">
                      Permanent announcements are delivered to existing users and new users automatically.
                    </p>
                  )}
                </div>
                {announcementData.imageUrl && (
                  <div className="space-y-2">
                    <Label className="text-white/80 text-xs">Image Preview</Label>
                    <img
                      src={announcementData.imageUrl}
                      alt="Announcement preview"
                      className="max-h-52 w-full max-w-md rounded-lg border border-white/15 object-cover"
                    />
                  </div>
                )}
                {editingAnnouncement ? (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button
                      onClick={handleUpdateAnnouncement}
                      disabled={isUpdatingAnnouncement || !announcementData.message.trim()}
                      className="flex-1 btn-primary"
                    >
                      {isUpdatingAnnouncement ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Pencil className="w-4 h-4 mr-2" />}
                      {isUpdatingAnnouncement ? 'Updating Announcement...' : 'Update Announcement'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={cancelEditAnnouncement}
                      className="flex-1 border-white/20 text-white hover:bg-white/10"
                    >
                      Cancel Edit
                    </Button>
                  </div>
                ) : (
                  <Button
                    onClick={handleSendAnnouncement}
                    disabled={isSendingAnnouncement || !announcementData.message.trim()}
                    className="w-full btn-primary"
                  >
                    {isSendingAnnouncement ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Megaphone className="w-4 h-4 mr-2" />}
                    {isSendingAnnouncement ? 'Sending Announcement...' : 'Send Announcement'}
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card className="glass border-white/10 mb-6">
              <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="text-white">Announcement History</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void loadAnnouncementHistory(true)}
                  className="border-white/20 text-white hover:bg-white/10"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh History
                </Button>
              </CardHeader>
              <CardContent>
                {announcementHistory.length === 0 ? (
                  <p className="text-sm text-white/55">No announcements sent yet.</p>
                ) : (
                  <div className="space-y-3">
                    {announcementHistory.slice(0, 20).map((announcement) => (
                      <div key={announcement.id} className="rounded-lg border border-white/10 bg-[#1f2937] p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-white">{announcement.title}</p>
                              {(() => {
                                const expired = announcement.expiresAt && Date.parse(announcement.expiresAt) <= Date.now();
                                if (announcement.isRecalled) {
                                  return <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30">Recalled</Badge>;
                                }
                                if (expired) {
                                  return <Badge className="bg-gray-500/20 text-gray-300 border-gray-500/30">Expired</Badge>;
                                }
                                return <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">Active</Badge>;
                              })()}
                            </div>
                            <p className="mt-1 text-xs text-white/65">
                              {announcement.message.length > 180 ? `${announcement.message.slice(0, 180)}...` : announcement.message}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/45">
                              <span>Sent: {new Date(announcement.createdAt).toLocaleString()}</span>
                              <span>By: {announcement.createdByUserId}</span>
                              <span>Delivered: {announcement.totalRecipients}</span>
                              <span>
                                Duration: {(announcement.isPermanent ?? true)
                                  ? 'Permanent'
                                  : `${announcement.durationDays || '-'} day(s)`}
                              </span>
                              <span>
                                Future Users: {((announcement.isPermanent ?? true) || announcement.includeFutureUsers) ? 'Yes' : 'No'}
                              </span>
                              {announcement.expiresAt && (
                                <span>Expires: {new Date(announcement.expiresAt).toLocaleString()}</span>
                              )}
                              {announcement.updatedAt && (
                                <span>Edited: {new Date(announcement.updatedAt).toLocaleString()}</span>
                              )}
                              {announcement.isRecalled && announcement.recalledAt && (
                                <span>Recalled: {new Date(announcement.recalledAt).toLocaleString()}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={announcement.isRecalled}
                              onClick={() => startEditAnnouncement(announcement)}
                              className="border-sky-500/40 text-sky-200 hover:bg-sky-500/10 disabled:opacity-50"
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={announcement.isRecalled}
                              onClick={() => handleRecallAnnouncement(announcement)}
                              className="border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                            >
                              Take Back
                            </Button>
                          </div>
                        </div>
                        {announcement.imageUrl && (
                          <img
                            src={announcement.imageUrl}
                            alt={announcement.title || 'Announcement'}
                            className="mt-3 max-h-44 w-full max-w-xs rounded-lg border border-white/10 object-cover"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="glass border-white/10 mb-6">
              <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="text-white flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                  Top Referrers
                </CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant={topReferrerLimit === 10 ? 'default' : 'outline'}
                    onClick={() => setTopReferrerLimit(10)}
                    className={topReferrerLimit === 10 ? 'btn-primary' : 'border-white/20 text-white hover:bg-white/10'}
                  >
                    Top 10
                  </Button>
                  <Button
                    size="sm"
                    variant={topReferrerLimit === 20 ? 'default' : 'outline'}
                    onClick={() => setTopReferrerLimit(20)}
                    className={topReferrerLimit === 20 ? 'btn-primary' : 'border-white/20 text-white hover:bg-white/10'}
                  >
                    Top 20
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto admin-table-scroll">
                  <table className="w-full admin-table">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Rank</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">User ID</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Name</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Direct</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Level</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Left Team</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Right Team</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topReferrers.map((u, index) => {
                        const stats = topReferrerStats.get(u.userId) || { level: 0, left: 0, right: 0 };
                        return (
                          <tr key={u.id} className="border-b border-white/5 hover:bg-white/5">
                            <td className="py-3 px-4 text-white/70 font-medium">#{index + 1}</td>
                            <td className="py-3 px-4">
                              <span className="text-[#118bdd] font-mono font-medium">{u.userId}</span>
                            </td>
                            <td className="py-3 px-4 text-white">{u.fullName}</td>
                            <td className="py-3 px-4 text-white/70 font-medium">{u.directCount || 0}</td>
                            <td className="py-3 px-4 text-white/60">{stats.level}</td>
                            <td className="py-3 px-4 text-white/60">{stats.left}</td>
                            <td className="py-3 px-4 text-white/60">{stats.right}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {topReferrers.length === 0 && (
                    <p className="text-center text-white/50 py-8">No referrer data found</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="glass border-white/10">
              <CardHeader className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <CardTitle className="text-white">All Users</CardTitle>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by ID, name or email..."
                      className="pl-10 w-full sm:w-64 bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>
                  <select
                    value={allUsersSortBy}
                    onChange={(e) => setAllUsersSortBy(e.target.value as 'joined' | 'level' | 'earnings' | 'team' | 'direct')}
                    className="h-10 rounded-md bg-[#1f2937] border border-white/10 text-white px-3 text-sm"
                  >
                    <option value="joined">Sort by Date Joined</option>
                    <option value="level">Sort by Level</option>
                    <option value="earnings">Sort by Earnings</option>
                    <option value="team">Sort by Left + Right Team</option>
                    <option value="direct">Sort by Direct Referrals</option>
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAllUsersSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
                    className="h-10 border-white/20 text-white hover:bg-white/10"
                  >
                    {allUsersSortDirection === 'desc' ? <ArrowDown className="w-4 h-4 mr-1" /> : <ArrowUp className="w-4 h-4 mr-1" />}
                    {allUsersSortDirection === 'desc' ? 'Desc' : 'Asc'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-white/60 mb-4">
                  Sorted by: {allUsersSortLabel}.
                </p>
                <div className="overflow-x-auto admin-table-scroll">
                  <table className="w-full admin-table">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Rank</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">User ID</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Name</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Status</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Direct</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Level</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Left Team</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Right Team</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Earnings</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Joined</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankedUsers.map((u, index) => {
                        const walletEarnings = displayedUserEarnings.get(u.userId) || 0;
                        const userLevel = displayedUserLevels.get(u.userId) || 0;
                        const teamStats = displayedUserTeamStats.get(u.userId) || { left: 0, right: 0, leftActive: 0, rightActive: 0 };
                        return (
                          <tr key={u.id} className="border-b border-white/5 hover:bg-white/5">
                            <td className="py-3 px-4 text-white/70 font-medium">#{index + 1}</td>
                            <td className="py-3 px-4">
                              <span className="text-[#118bdd] font-mono font-medium">{u.userId}</span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${generateAvatarColor(u.userId)}`}>
                                  {getInitials(u.fullName)}
                                </div>
                                <div>
                                  <p className="text-white font-medium">{u.fullName}</p>
                                  <p className="text-white/50 text-xs">{u.email}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="space-y-1">
                                {u.accountStatus === 'permanent_blocked' && (
                                  <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Permanently Blocked</Badge>
                                )}
                                {u.accountStatus === 'temp_blocked' && (
                                  <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Temporarily Blocked</Badge>
                                )}
                                {u.accountStatus === 'active' && u.isActive && (
                                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Active</Badge>
                                )}
                                {u.accountStatus === 'active' && !u.isActive && u.deactivationReason === 'direct_referral_deadline' && (
                                  <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Auto-Deactivated (No Directs)</Badge>
                                )}
                                {u.accountStatus === 'active' && !u.isActive && u.deactivationReason !== 'direct_referral_deadline' && (
                                  <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Inactive</Badge>
                                )}
                                {(u.accountStatus === 'temp_blocked' || u.accountStatus === 'permanent_blocked') && (
                                  <p className="text-[11px] text-white/50">
                                    {u.blockedReason || 'Blocked by admin'}
                                    {u.blockedUntil ? ` | Until ${new Date(u.blockedUntil).toLocaleString()}` : ''}
                                  </p>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-white/60">{u.directCount}</td>
                            <td className="py-3 px-4 text-white/60">{userLevel}</td>
                            <td className="py-3 px-4 text-white/60">
                              {teamStats.left}
                              <span className="text-xs text-emerald-400 ml-1">({teamStats.leftActive} active)</span>
                            </td>
                            <td className="py-3 px-4 text-white/60">
                              {teamStats.right}
                              <span className="text-xs text-emerald-400 ml-1">({teamStats.rightActive} active)</span>
                            </td>
                            <td className="py-3 px-4 text-emerald-400">{formatCurrency(walletEarnings)}</td>
                            <td className="py-3 px-4 text-white/60">{formatDate(u.createdAt)}</td>
                            <td className="py-3 px-4">
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedUser(u.userId);
                                    setFundWalletType('deposit');
                                    setFundAmount('');
                                    setFundMessage('');
                                  }}
                                  className="border-white/20 text-white hover:bg-white/10"
                                >
                                  <DollarSign className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setActiveMainTab('impersonate');
                                    setImpersonateUserId(u.userId);
                                    setMasterPassword('');
                                  }}
                                  className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                                  title="Login as this user"
                                >
                                  <UserCog className="w-4 h-4" />
                                </Button>
                                {u.accountStatus === 'active' && !u.isAdmin && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleBlockUser(u.userId, 'temporary')}
                                      className="border-orange-500/40 text-orange-400 hover:bg-orange-500/10"
                                      title="Temporary block"
                                    >
                                      <Ban className="w-4 h-4" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleBlockUser(u.userId, 'permanent')}
                                      className="border-red-500/40 text-red-400 hover:bg-red-500/10"
                                      title="Permanent block"
                                    >
                                      <Ban className="w-4 h-4" />
                                    </Button>
                                  </>
                                )}
                                {(u.accountStatus === 'temp_blocked' || u.accountStatus === 'permanent_blocked') && !u.isAdmin && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleUnblockUser(u.userId)}
                                    className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                                    title="Unblock user"
                                  >
                                    <UserCheck className="w-4 h-4" />
                                  </Button>
                                )}
                                {u.accountStatus === 'active' && !u.isActive && u.deactivationReason === 'direct_referral_deadline' && !u.isAdmin && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleReactivateUser(u.userId)}
                                    className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                                    title="Reactivate user (reset direct referral deadline)"
                                  >
                                    <UserCheck className="w-4 h-4 mr-1" />
                                    Reactivate
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* PIN Management Tab */}
          <TabsContent value="pins">
            <div className="flex justify-end mb-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePinRefresh}
                disabled={isPinRefreshing}
                className="border-white/20 text-white hover:bg-white/10"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isPinRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Generate PINs */}
              <Card className="glass border-white/10">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Ticket className="w-5 h-5 text-[#118bdd]" />
                    Generate PINs
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-white/80">Recipient User ID (7 digits)</Label>
                    <Input
                      value={pinRecipientId}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 7);
                        setPinRecipientId(value);
                      }}
                      maxLength={7}
                      placeholder="Enter recipient User ID"
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/80">Quantity</Label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={pinQuantity}
                      onChange={(e) => setPinQuantity(parseInt(e.target.value) || 1)}
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>
                  <div className="p-3 rounded-lg bg-[#1f2937]">
                    <p className="text-sm text-white/60">Total Value: {formatCurrency(pinQuantity * 11)}</p>
                  </div>
                  <Button
                    onClick={handleGeneratePins}
                    disabled={isLoading || pinRecipientId.length !== 7}
                    className="w-full btn-primary"
                  >
                    {isLoading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Ticket className="w-4 h-4 mr-2" />}
                    Generate PINs
                  </Button>
                </CardContent>
              </Card>

              {/* PIN Purchase Requests */}
              <Card className="glass border-white/10">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <CardTitle className="text-white flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-[#118bdd]" />
                      PIN Purchase Requests
                      {pendingPinRequests.length > 0 && (
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                          {pendingPinRequests.length}
                        </Badge>
                      )}
                    </CardTitle>
                    <select
                      value={pinRequestStatusFilter}
                      onChange={(e) => setPinRequestStatusFilter(e.target.value as 'all' | 'pending' | 'completed' | 'cancelled')}
                      className="px-3 h-9 bg-[#1f2937] border border-white/10 rounded-md text-white text-sm w-full sm:w-auto"
                    >
                      <option value="pending">Pending</option>
                      <option value="completed">Approved</option>
                      <option value="cancelled">Rejected</option>
                      <option value="all">All</option>
                    </select>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {filteredPinRequests.map((request) => {
                      const requestUser = allUsers.find(u => u.id === request.userId);
                      const processedByUser = request.processedBy ? allUsers.find(u => u.id === request.processedBy) : null;
                      return (
                        <div key={request.id} className="p-4 rounded-lg bg-[#1f2937] border border-white/10">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-2 gap-1">
                            <span className="text-[#118bdd] font-mono">{requestUser?.userId}</span>
                            <span className="text-white font-bold">{formatCurrency(request.amount)}</span>
                          </div>
                          <p className="text-white/60 text-sm mb-1">{requestUser?.fullName}</p>
                          <p className="text-white/40 text-sm">{request.quantity} PIN(s) requested</p>
                          <p className="text-white/40 text-xs">
                            Mode: {request.purchaseType === 'direct' ? 'Direct Buy (Auto)' : 'Normal Request'}
                          </p>
                          <p className="text-white/40 text-xs">
                            Status: <span className={`${request.status === 'completed'
                              ? 'text-emerald-400'
                              : request.status === 'cancelled'
                                ? 'text-red-400'
                                : 'text-amber-400'
                              }`}>{request.status}</span>
                          </p>
                          <p className="text-white/40 text-xs">
                            Payment: {request.paidFromWallet ? 'Fund Wallet' : 'Manual USDT Slip'}
                          </p>
                          {request.pinsGenerated && request.pinsGenerated.length > 0 && (
                            <p className="text-white/40 text-xs">Generated PINs: {request.pinsGenerated.length}</p>
                          )}
                          {request.processedAt && (
                            <p className="text-white/40 text-xs">
                              Processed: {formatDate(request.processedAt)} by {processedByUser?.userId || request.processedBy}
                            </p>
                          )}
                          {request.paymentTxHash && (
                            <p className="text-white/40 text-xs break-all">Tx Hash: {request.paymentTxHash}</p>
                          )}
                          {request.paymentProof && (
                            <div className="mt-3 space-y-2">
                              <img
                                src={request.paymentProof}
                                alt="PIN request proof"
                                className="max-h-28 rounded border border-white/10"
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-white/20 text-white hover:bg-white/10"
                                onClick={() => setFullscreenPaymentProof({ src: request.paymentProof || '', userId: requestUser?.userId || '-' })}
                              >
                                <Maximize2 className="w-4 h-4 mr-2" />
                                Full Screen
                              </Button>
                            </div>
                          )}
                          <p className="text-white/40 text-xs">{formatDate(request.createdAt)}</p>
                          <div className="flex flex-wrap gap-2 mt-3">
                            {request.status === 'pending' ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={async () => {
                                    const result = await rejectPinPurchase(request.id, 'Rejected by admin');
                                    if (result.success) {
                                      toast.success(result.message);
                                    } else {
                                      toast.error(result.message);
                                    }
                                  }}
                                  className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10"
                                >
                                  <XCircle className="w-4 h-4 mr-1" /> Reject
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={async () => {
                                    const result = await approvePinPurchase(request.id);
                                    if (result.success) {
                                      toast.success(result.message);
                                    } else {
                                      toast.error(result.message);
                                    }
                                  }}
                                  className="flex-1 bg-emerald-500 hover:bg-emerald-600"
                                >
                                  <CheckCircle className="w-4 h-4 mr-1" /> Approve
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  const result = await reopenPinPurchase(request.id);
                                  if (result.success) {
                                    toast.success(result.message);
                                  } else {
                                    toast.error(result.message);
                                  }
                                }}
                                className="flex-1 border-[#118bdd]/30 text-[#118bdd] hover:bg-[#118bdd]/10"
                              >
                                <RefreshCw className="w-4 h-4 mr-1" /> Reopen
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {filteredPinRequests.length === 0 && (
                      <p className="text-center text-white/50 py-8">No PIN requests in selected status</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Repair Orphaned PINs */}
              <Card className="glass border-white/10">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                    Repair Orphaned PIN Usage
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-white/60">
                    If a PIN shows as used but the user record is missing (sync failed), recover the PIN back to the owner and
                    remove orphan admin-fee entries.
                  </p>
                  <Button
                    onClick={handleRepairOrphanedPins}
                    disabled={isRepairingPins}
                    className="btn-primary"
                  >
                    {isRepairingPins ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <AlertTriangle className="w-4 h-4 mr-2" />}
                    Repair Now
                  </Button>
                </CardContent>
              </Card>

              {/* Take Back PINs */}
              <Card className="glass border-white/10 lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <RotateCcw className="w-5 h-5 text-amber-400" />
                    Take Back PINs
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label className="text-white/80">User ID (7 digits)</Label>
                      <Input
                        value={takeBackUserId}
                        onChange={(e) => setTakeBackUserId(e.target.value.replace(/\D/g, '').slice(0, 7))}
                        maxLength={7}
                        placeholder="Enter User ID"
                        className="bg-[#1f2937] border-white/10 text-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-white/80">Quantity</Label>
                      <Input
                        type="number"
                        min={1}
                        value={takeBackQuantity}
                        onChange={(e) => setTakeBackQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="bg-[#1f2937] border-white/10 text-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-white/80">Remarks</Label>
                      <Input
                        value={takeBackReason}
                        onChange={(e) => setTakeBackReason(e.target.value)}
                        placeholder="Reason (optional)"
                        className="bg-[#1f2937] border-white/10 text-white"
                      />
                    </div>
                  </div>
                  <Button
                    onClick={handleTakeBackPins}
                    disabled={isTakingBack || takeBackUserId.length !== 7}
                    className="btn-primary"
                  >
                    {isTakingBack ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}
                    Take Back PINs
                  </Button>
                </CardContent>
              </Card>

              {/* All PINs */}
              <Card className="glass border-white/10 lg:col-span-2">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <CardTitle className="text-white">All PINs</CardTitle>
                    <div className="flex items-center gap-2 text-sm text-white/60">
                      <span>Show</span>
                      <select
                        value={pinListLimit}
                        onChange={(e) => setPinListLimit(parseInt(e.target.value, 10))}
                        className="px-2 h-8 bg-[#1f2937] border border-white/10 rounded-md text-white text-sm"
                      >
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={200}>200</option>
                        <option value={0}>All</option>
                      </select>
                      <span className="text-white/40">
                        ({pinListLimit === 0 ? filteredPins.length : Math.min(pinListLimit, filteredPins.length)} of {filteredPins.length}{pinSearchQuery ? ` • Total ${allPins.length}` : ''})
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-col sm:flex-row gap-2">
                    <Input
                      value={pinSearchInput}
                      onChange={(e) => setPinSearchInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          setPinSearchQuery(pinSearchInput.trim());
                        }
                      }}
                      placeholder="Search PIN / user ID / name / status"
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setPinSearchQuery(pinSearchInput.trim())}
                        className="border-white/20 text-white hover:bg-white/10"
                      >
                        Search
                      </Button>
                      {pinSearchQuery && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setPinSearchQuery('');
                            setPinSearchInput('');
                          }}
                          className="border-white/20 text-white hover:bg-white/10"
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto admin-table-scroll">
                    <table className="w-full admin-table">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="text-left py-3 px-4 text-white/60 font-medium">PIN Code</th>
                          <th className="text-left py-3 px-4 text-white/60 font-medium">Status</th>
                          <th className="text-left py-3 px-4 text-white/60 font-medium">Owner</th>
                          <th className="text-left py-3 px-4 text-white/60 font-medium">Used By</th>
                          <th className="text-left py-3 px-4 text-white/60 font-medium">Created</th>
                          <th className="text-left py-3 px-4 text-white/60 font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPins
                          .slice(0, pinListLimit === 0 ? filteredPins.length : pinListLimit)
                          .map((pin) => {
                          const owner = allUsers.find(u => u.id === pin.ownerId);
                          const usedBy = pin.usedById ? allUsers.find(u => u.id === pin.usedById) : null;
                          return (
                            <tr key={pin.id} className="border-b border-white/5 hover:bg-white/5">
                              <td className="py-3 px-4">
                                <span className="font-mono text-white">{pin.pinCode}</span>
                              </td>
                              <td className="py-3 px-4">
                                <Badge className={
                                  pin.status === 'unused'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : pin.status === 'suspended'
                                      ? 'bg-red-500/20 text-red-400'
                                      : 'bg-white/10 text-white/50'
                                }>
                                  {pin.status}
                                </Badge>
                              </td>
                              <td className="py-3 px-4 text-white/60">{owner?.userId || '-'}</td>
                              <td className="py-3 px-4 text-white/60">{usedBy?.userId || '-'}</td>
                              <td className="py-3 px-4 text-white/60">{formatDate(pin.createdAt)}</td>
                              <td className="py-3 px-4">
                                {pin.status === 'unused' && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-red-500/40 text-red-400 hover:bg-red-500/10"
                                    onClick={async () => {
                                      const result = await suspendPin(pin.id, pinSuspendReason || 'Admin action');
                                      if (result.success) {
                                        toast.success(result.message);
                                      } else {
                                        toast.error(result.message);
                                      }
                                    }}
                                  >
                                    Suspend
                                  </Button>
                                )}
                                {pin.status === 'suspended' && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                                    onClick={async () => {
                                      const result = await unsuspendPin(pin.id);
                                      if (result.success) {
                                        toast.success(result.message);
                                      } else {
                                        toast.error(result.message);
                                      }
                                    }}
                                  >
                                    Unsuspend
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="mt-4 grid gap-2 md:grid-cols-[180px_1fr]">
                      <Label className="text-white/70">Suspend Reason</Label>
                      <Input
                        value={pinSuspendReason}
                        onChange={(e) => setPinSuspendReason(e.target.value)}
                        placeholder="Reason for pin suspension"
                        className="bg-[#1f2937] border-white/10 text-white"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Payments Tab */}
          <TabsContent value="payments">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Pending Payments */}
              <Card className="glass border-white/10">
                <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <CardTitle className="text-white flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-[#118bdd]" />
                    Pending Deposits
                    {pendingPayments.length > 0 && (
                      <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                        {pendingPayments.length}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto admin-table-scroll">
                    <table className="w-full admin-table">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="text-left py-3 px-4 text-white/60 font-medium">User ID</th>
                          <th className="text-left py-3 px-4 text-white/60 font-medium">Method</th>
                          <th className="text-left py-3 px-4 text-white/60 font-medium">Amount</th>
                          <th className="text-left py-3 px-4 text-white/60 font-medium">Date</th>
                          <th className="text-left py-3 px-4 text-white/60 font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingPayments.map((payment) => {
                          const paymentUser = userLookup.get(payment.userId) || Database.getUserById(payment.userId) || Database.getUserByUserId(payment.userId);
                          const displayPaymentUserId = paymentUser?.userId || payment.userId || '-';
                          return (
                            <tr key={payment.id} className="border-b border-white/5 hover:bg-white/5">
                              <td className="py-3 px-4">
                                <span className="text-[#118bdd] font-mono">{displayPaymentUserId}</span>
                              </td>
                              <td className="py-3 px-4 text-white/60">{payment.methodName}</td>
                              <td className="py-3 px-4 text-white font-medium">{formatCurrency(payment.amount)}</td>
                              <td className="py-3 px-4 text-white/60">{formatDate(payment.createdAt)}</td>
                              <td className="py-3 px-4">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedPayment(payment);
                                    setShowPaymentDialog(true);
                                  }}
                                  className="border-white/20 text-white hover:bg-white/10"
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {pendingPayments.length === 0 && (
                      <div className="text-center py-12">
                        <CheckCircle className="w-12 h-12 text-emerald-500/50 mx-auto mb-4" />
                        <p className="text-white/50">No pending deposits</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Deposit History */}
              <Card className="glass border-white/10 lg:col-span-2">
                <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <CardTitle className="text-white flex items-center gap-2">
                    <Clock className="w-5 h-5 text-cyan-400" />
                    Deposit History
                    <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30">
                      {filteredDepositHistory.length}
                    </Badge>
                  </CardTitle>
                  <select
                    value={depositHistoryStatusFilter}
                    onChange={(e) => setDepositHistoryStatusFilter(e.target.value as 'all' | 'pending' | 'under_review' | 'completed' | 'failed' | 'reversed')}
                    className="h-9 px-3 rounded-md bg-[#1f2937] border border-white/10 text-white text-sm"
                  >
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="under_review">Under Review</option>
                    <option value="completed">Completed</option>
                    <option value="failed">Rejected</option>
                    <option value="reversed">Reversed</option>
                  </select>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                    {filteredDepositHistory.map((payment) => {
                      const paymentUser = userLookup.get(payment.userId) || Database.getUserById(payment.userId) || Database.getUserByUserId(payment.userId);
                      const displayUserId = paymentUser?.userId || payment.userId;
                      const displayName = paymentUser?.fullName || 'Unknown user';
                      return (
                        <div key={payment.id} className="p-3 rounded-lg bg-[#1f2937] border border-white/10">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[#118bdd] font-mono text-sm">{displayUserId}</span>
                                <Badge className={`text-[10px] ${
                                  payment.status === 'completed'
                                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                    : payment.status === 'pending' || payment.status === 'under_review'
                                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                      : payment.status === 'reversed'
                                        ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                                        : 'bg-red-500/15 text-red-300 border-red-500/30'
                                }`}>
                                  {payment.status}
                                </Badge>
                              </div>
                              <p className="text-white text-sm font-medium mt-1">{displayName}</p>
                              <p className="text-white/55 text-xs mt-1">
                                Amount: {formatCurrency(payment.amount)} | Method: {payment.methodName}
                              </p>
                              <p className="text-white/40 text-xs mt-1">
                                Requested at: {formatDate(payment.createdAt)}
                              </p>
                              {payment.txHash && (
                                <p className="text-white/35 text-[11px] mt-1 break-all">Tx Hash: {payment.txHash}</p>
                              )}
                              {payment.adminNotes && (
                                <p className="text-white/55 text-xs mt-1">Admin Note: {payment.adminNotes}</p>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedPayment(payment);
                                setShowPaymentDialog(true);
                              }}
                              className="border-white/20 text-white hover:bg-white/10 self-start"
                            >
                              <Eye className="w-4 h-4 mr-1" />
                              View
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    {filteredDepositHistory.length === 0 && (
                      <div className="text-center py-10">
                        <CheckCircle className="w-10 h-10 text-emerald-500/40 mx-auto mb-2" />
                        <p className="text-white/50 text-sm">No deposit history in selected status</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Withdrawal Requests */}
              <Card className="glass border-white/10 lg:col-span-2">
                <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <CardTitle className="text-white flex items-center gap-2">
                    <ArrowUp className="w-5 h-5 text-amber-400" />
                    Withdrawal Requests
                    {withdrawalRequests.filter((tx) => tx.status === 'pending').length > 0 && (
                      <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30">
                        {withdrawalRequests.filter((tx) => tx.status === 'pending').length} pending
                      </Badge>
                    )}
                  </CardTitle>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleScanMissingPendingWithdrawals}
                      className="border-amber-500/30 text-amber-300 hover:bg-amber-500/10 w-full sm:w-auto"
                    >
                      <AlertTriangle className="w-4 h-4 mr-1" />
                      Scan Missing Pending Withdrawals
                    </Button>
                    <select
                      value={withdrawalStatusFilter}
                      onChange={(e) => setWithdrawalStatusFilter(e.target.value as 'all' | 'pending' | 'completed' | 'failed')}
                      className="h-9 px-3 rounded-md bg-[#1f2937] border border-white/10 text-white text-sm w-full sm:w-auto"
                    >
                      <option value="pending">Pending</option>
                      <option value="completed">Completed</option>
                      <option value="failed">Rejected</option>
                      <option value="all">All</option>
                    </select>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                    {filteredWithdrawalRequests.map((tx) => {
                      const txUser = userLookup.get(tx.userId) || Database.getUserById(tx.userId) || Database.getUserByUserId(tx.userId);
                      const displayTxUserId = txUser?.userId || tx.requesterUserId || tx.userId;
                      const displayTxUserName = txUser?.fullName || tx.requesterName || 'Unknown user';
                      const grossAmount = Math.abs(tx.amount);
                      const fee = Number(tx.fee || 0);
                      const netAmount = Number(tx.netAmount || Math.max(0, grossAmount - fee));
                      return (
                        <div key={tx.id} className="p-3 rounded-lg bg-[#1f2937] border border-white/10">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[#118bdd] font-mono text-sm">{displayTxUserId}</span>
                                <Badge className={`text-[10px] ${
                                  tx.status === 'pending'
                                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                    : tx.status === 'completed'
                                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                      : 'bg-red-500/15 text-red-300 border-red-500/30'
                                }`}>
                                  {tx.status}
                                </Badge>
                              </div>
                              <p className="text-white text-sm font-medium mt-1">{displayTxUserName}</p>
                              <p className="text-white/55 text-xs mt-1">
                                Requested: {formatCurrency(grossAmount)} | Fee: {formatCurrency(fee)} | Net: {formatCurrency(netAmount)}
                              </p>
                              <p className="text-white/40 text-xs mt-1">
                                Requested at: {formatDate(tx.createdAt)}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedWithdrawalRequest(tx);
                                setShowWithdrawalRequestDialog(true);
                              }}
                              className="border-white/20 text-white hover:bg-white/10 self-start"
                            >
                              <Eye className="w-4 h-4 mr-1" />
                              View
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    {filteredWithdrawalRequests.length === 0 && (
                      <div className="text-center py-10">
                        <CheckCircle className="w-10 h-10 text-emerald-500/40 mx-auto mb-2" />
                        <p className="text-white/50 text-sm">No withdrawal requests in selected status</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Payment Methods */}
              <Card className="glass border-white/10">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-white flex items-center gap-2">
                      <Settings className="w-5 h-5 text-[#118bdd]" />
                      Payment Methods
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-white/20 text-white hover:bg-white/10"
                        onClick={startNewPaymentMethod}
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add Payment Method
                      </Button>
                      {editingPaymentMethodId === 'new' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-white/70 hover:text-white"
                          onClick={closePaymentMethodEditor}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {editingPaymentMethodId === 'new' && paymentMethodDraft && (
                    <div className="p-4 mb-4 rounded-lg border border-white/10 bg-[#111827] space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-white/70 text-xs">Method Type</Label>
                          <select
                            value={paymentMethodDraft.type}
                            onChange={(e) => updatePaymentMethodDraft('type', e.target.value as PaymentMethodType)}
                            className="bg-[#1f2937] border border-white/10 text-white h-9 rounded px-2"
                          >
                            <option value="crypto">Crypto</option>
                            <option value="upi">UPI</option>
                            <option value="bank_transfer">Bank Transfer</option>
                            <option value="paypal">PayPal</option>
                            <option value="stripe">Stripe</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-white/70 text-xs">Method Name</Label>
                          <Input
                            value={paymentMethodDraft.name}
                            onChange={(e) => updatePaymentMethodDraft('name', e.target.value)}
                            placeholder="e.g., USDT (BEP-20)"
                            className="bg-[#1f2937] border-white/10 text-white h-9"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-white/70 text-xs">Processing Time</Label>
                          <Input
                            value={paymentMethodDraft.processingTime}
                            onChange={(e) => updatePaymentMethodDraft('processingTime', e.target.value)}
                            placeholder={`Within ${settings.depositProcessingHours} hours`}
                            className="bg-[#1f2937] border-white/10 text-white h-9"
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <Label className="text-white/70 text-xs">Description</Label>
                          <Input
                            value={paymentMethodDraft.description}
                            onChange={(e) => updatePaymentMethodDraft('description', e.target.value)}
                            className="bg-[#1f2937] border-white/10 text-white h-9"
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <Label className="text-white/70 text-xs">Instructions</Label>
                          <Textarea
                            value={paymentMethodDraft.instructions}
                            onChange={(e) => updatePaymentMethodDraft('instructions', e.target.value)}
                            className="bg-[#1f2937] border-white/10 text-white min-h-[80px]"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-white/70 text-xs">Minimum Amount</Label>
                          <Input
                            type="number"
                            value={paymentMethodDraft.minAmount}
                            onChange={(e) => updatePaymentMethodDraft('minAmount', e.target.value)}
                            className="bg-[#1f2937] border-white/10 text-white h-9"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-white/70 text-xs">Maximum Amount</Label>
                          <Input
                            type="number"
                            value={paymentMethodDraft.maxAmount}
                            onChange={(e) => updatePaymentMethodDraft('maxAmount', e.target.value)}
                            className="bg-[#1f2937] border-white/10 text-white h-9"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-white/70 text-xs">Processing Fee (%)</Label>
                          <Input
                            type="number"
                            value={paymentMethodDraft.processingFee}
                            onChange={(e) => updatePaymentMethodDraft('processingFee', e.target.value)}
                            className="bg-[#1f2937] border-white/10 text-white h-9"
                          />
                        </div>
                      </div>

                      {paymentMethodDraft.type === 'crypto' && (
                        <div className="space-y-1">
                          <Label className="text-white/70 text-xs">USDT Wallet Address (BEP-20)</Label>
                          <Input
                            value={paymentMethodDraft.walletAddress}
                            onChange={(e) => updatePaymentMethodDraft('walletAddress', e.target.value)}
                            placeholder="0x..."
                            className="bg-[#1f2937] border-white/10 text-white h-9"
                          />
                        </div>
                      )}

                      {paymentMethodDraft.type === 'upi' && (
                        <div className="space-y-1">
                          <Label className="text-white/70 text-xs">UPI ID</Label>
                          <Input
                            value={paymentMethodDraft.upiId}
                            onChange={(e) => updatePaymentMethodDraft('upiId', e.target.value)}
                            placeholder="name@bank"
                            className="bg-[#1f2937] border-white/10 text-white h-9"
                          />
                        </div>
                      )}

                      {paymentMethodDraft.type === 'bank_transfer' && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <Label className="text-white/70 text-xs">Account Name</Label>
                            <Input
                              value={paymentMethodDraft.accountName}
                              onChange={(e) => updatePaymentMethodDraft('accountName', e.target.value)}
                              className="bg-[#1f2937] border-white/10 text-white h-9"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-white/70 text-xs">Bank Name</Label>
                            <Input
                              value={paymentMethodDraft.bankName}
                              onChange={(e) => updatePaymentMethodDraft('bankName', e.target.value)}
                              className="bg-[#1f2937] border-white/10 text-white h-9"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-white/70 text-xs">Account Number</Label>
                            <Input
                              value={paymentMethodDraft.accountNumber}
                              onChange={(e) => updatePaymentMethodDraft('accountNumber', e.target.value)}
                              className="bg-[#1f2937] border-white/10 text-white h-9"
                            />
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label className="text-white/70 text-xs">Payment QR Code (Optional)</Label>
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-[#1f2937] px-3 py-2 text-sm text-white/80 cursor-pointer hover:bg-white/10">
                            <ImagePlus className="w-4 h-4" />
                            Upload QR
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => void handlePaymentMethodQrUpload(e)}
                            />
                          </label>
                          {paymentMethodDraft.qrCode && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => updatePaymentMethodDraft('qrCode', '')}
                              className="border-red-500/40 text-red-300 hover:bg-red-500/10"
                            >
                              Remove QR
                            </Button>
                          )}
                        </div>
                        {paymentMethodDraft.qrCode && (
                          <img src={paymentMethodDraft.qrCode} alt="Payment QR" className="h-28 w-28 rounded-lg border border-white/15 object-cover bg-white p-1" />
                        )}
                      </div>

                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={closePaymentMethodEditor}
                          className="border-white/20 text-white hover:bg-white/10"
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void savePaymentMethodDetails()}
                          className="bg-[#118bdd] hover:bg-[#0f7ac7]"
                        >
                          Save Payment Method
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    {paymentMethods.map((method) => (
                      <div key={method.id} className="p-4 rounded-lg bg-[#1f2937] space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${method.isActive ? 'bg-[#118bdd]' : 'bg-gray-600'}`}>
                              <CreditCard className="w-5 h-5 text-white" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-white font-medium">{method.name}</p>
                              <p className="text-white/50 text-sm">
                                Fee: {method.processingFee}% | {method.processingTime}
                              </p>
                              <p className="text-white/45 text-xs mt-1">
                                Min: {formatCurrency(method.minAmount)} | Max: {formatCurrency(method.maxAmount)}
                              </p>
                              {method.walletAddress && (
                                <p className="text-white/45 text-xs mt-1 break-all">
                                  Wallet: {method.walletAddress}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                if (editingPaymentMethodId === method.id) {
                                  closePaymentMethodEditor();
                                } else {
                                  openPaymentMethodEditor(method);
                                }
                              }}
                              className="border-white/20 text-white hover:bg-white/10"
                            >
                              <Pencil className="w-4 h-4 mr-1" />
                              {editingPaymentMethodId === method.id ? 'Close Edit' : 'Edit Details'}
                            </Button>
                            <button
                              onClick={() => togglePaymentMethod(method.id, !method.isActive)}
                              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${method.isActive
                                ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                                : 'bg-gray-600/20 text-gray-400 hover:bg-gray-600/30'
                                }`}
                            >
                              {method.isActive ? 'Active' : 'Inactive'}
                            </button>
                          </div>
                        </div>

                        {editingPaymentMethodId === method.id && paymentMethodDraft && (
                          <div className="rounded-lg border border-white/10 bg-[#111827] p-3 space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-white/70 text-xs">Method Name</Label>
                                <Input
                                  value={paymentMethodDraft.name}
                                  onChange={(e) => updatePaymentMethodDraft('name', e.target.value)}
                                  className="bg-[#1f2937] border-white/10 text-white h-9"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-white/70 text-xs">Processing Time</Label>
                                <Input
                                  value={paymentMethodDraft.processingTime}
                                  onChange={(e) => updatePaymentMethodDraft('processingTime', e.target.value)}
                                  placeholder={`Within ${settings.depositProcessingHours} hours`}
                                  className="bg-[#1f2937] border-white/10 text-white h-9"
                                />
                              </div>
                              <div className="space-y-1 md:col-span-2">
                                <Label className="text-white/70 text-xs">Description</Label>
                                <Input
                                  value={paymentMethodDraft.description}
                                  onChange={(e) => updatePaymentMethodDraft('description', e.target.value)}
                                  className="bg-[#1f2937] border-white/10 text-white h-9"
                                />
                              </div>
                              <div className="space-y-1 md:col-span-2">
                                <Label className="text-white/70 text-xs">Instructions</Label>
                                <Textarea
                                  value={paymentMethodDraft.instructions}
                                  onChange={(e) => updatePaymentMethodDraft('instructions', e.target.value)}
                                  className="bg-[#1f2937] border-white/10 text-white min-h-[80px]"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-white/70 text-xs">Minimum Amount</Label>
                                <Input
                                  type="number"
                                  value={paymentMethodDraft.minAmount}
                                  onChange={(e) => updatePaymentMethodDraft('minAmount', e.target.value)}
                                  className="bg-[#1f2937] border-white/10 text-white h-9"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-white/70 text-xs">Maximum Amount</Label>
                                <Input
                                  type="number"
                                  value={paymentMethodDraft.maxAmount}
                                  onChange={(e) => updatePaymentMethodDraft('maxAmount', e.target.value)}
                                  className="bg-[#1f2937] border-white/10 text-white h-9"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-white/70 text-xs">Processing Fee (%)</Label>
                                <Input
                                  type="number"
                                  value={paymentMethodDraft.processingFee}
                                  onChange={(e) => updatePaymentMethodDraft('processingFee', e.target.value)}
                                  className="bg-[#1f2937] border-white/10 text-white h-9"
                                />
                              </div>
                            </div>

                            {method.type === 'crypto' && (
                              <div className="space-y-1">
                                <Label className="text-white/70 text-xs">USDT Wallet Address (BEP-20)</Label>
                                <Input
                                  value={paymentMethodDraft.walletAddress}
                                  onChange={(e) => updatePaymentMethodDraft('walletAddress', e.target.value)}
                                  placeholder="0x..."
                                  className="bg-[#1f2937] border-white/10 text-white h-9"
                                />
                              </div>
                            )}

                            {method.type === 'upi' && (
                              <div className="space-y-1">
                                <Label className="text-white/70 text-xs">UPI ID</Label>
                                <Input
                                  value={paymentMethodDraft.upiId}
                                  onChange={(e) => updatePaymentMethodDraft('upiId', e.target.value)}
                                  placeholder="name@bank"
                                  className="bg-[#1f2937] border-white/10 text-white h-9"
                                />
                              </div>
                            )}

                            {method.type === 'bank_transfer' && (
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-white/70 text-xs">Account Name</Label>
                                  <Input
                                    value={paymentMethodDraft.accountName}
                                    onChange={(e) => updatePaymentMethodDraft('accountName', e.target.value)}
                                    className="bg-[#1f2937] border-white/10 text-white h-9"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-white/70 text-xs">Bank Name</Label>
                                  <Input
                                    value={paymentMethodDraft.bankName}
                                    onChange={(e) => updatePaymentMethodDraft('bankName', e.target.value)}
                                    className="bg-[#1f2937] border-white/10 text-white h-9"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-white/70 text-xs">Account Number</Label>
                                  <Input
                                    value={paymentMethodDraft.accountNumber}
                                    onChange={(e) => updatePaymentMethodDraft('accountNumber', e.target.value)}
                                    className="bg-[#1f2937] border-white/10 text-white h-9"
                                  />
                                </div>
                              </div>
                            )}

                            <div className="space-y-2">
                              <Label className="text-white/70 text-xs">Payment QR Code (Optional)</Label>
                              <div className="flex flex-wrap items-center gap-2">
                                <label className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-[#1f2937] px-3 py-2 text-sm text-white/80 cursor-pointer hover:bg-white/10">
                                  <ImagePlus className="w-4 h-4" />
                                  Upload QR
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => void handlePaymentMethodQrUpload(e)}
                                  />
                                </label>
                                {paymentMethodDraft.qrCode && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => updatePaymentMethodDraft('qrCode', '')}
                                    className="border-red-500/40 text-red-300 hover:bg-red-500/10"
                                  >
                                    Remove QR
                                  </Button>
                                )}
                              </div>
                              {paymentMethodDraft.qrCode && (
                                <img src={paymentMethodDraft.qrCode} alt="Payment QR" className="h-28 w-28 rounded-lg border border-white/15 object-cover bg-white p-1" />
                              )}
                            </div>

                            <div className="flex gap-2 pt-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={closePaymentMethodEditor}
                                className="border-white/20 text-white hover:bg-white/10"
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => void savePaymentMethodDetails()}
                                className="bg-[#118bdd] hover:bg-[#0f7ac7]"
                              >
                                Save Details
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* User Details Tab */}
          <TabsContent value="user-details">
            <Card className="glass border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <IdCard className="w-5 h-5 text-[#118bdd]" />
                  Search User Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row gap-3 mb-6">
                  <Input
                    value={userSearchId}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '').slice(0, 7);
                      setUserSearchId(value);
                    }}
                    maxLength={7}
                    placeholder="Enter 7-digit User ID"
                    className="bg-[#1f2937] border-white/10 text-white w-full sm:max-w-xs"
                  />
                  <Button
                    onClick={() => searchUserById()}
                    className="btn-primary"
                  >
                    <Search className="w-4 h-4 mr-2" />
                    Search
                  </Button>
                </div>

                {!searchedUser && missingMatrixNode && (
                  <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-300 mt-1" />
                      <div>
                        <h4 className="text-white font-semibold">Recover Missing User Record</h4>
                        <p className="text-xs text-white/60">
                          Matrix slot found for this ID. This recovery recreates the user record and referral income (if missing)
                          without re-running any give-help logic.
                        </p>
                        <p className="text-xs text-white/50 mt-1">
                          Matrix slot: Parent ID {missingMatrixNode.parentId || '-'} · Position {missingMatrixNode.position === 1 ? 'Right' : 'Left'}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-white/70">Full Name</Label>
                        <Input
                          value={missingUserRecovery.fullName}
                          onChange={(e) => setMissingUserRecovery((prev) => ({ ...prev, fullName: e.target.value }))}
                          className="bg-[#1f2937] border-white/10 text-white h-9"
                          placeholder="Full name"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-white/70">Sponsor ID (optional)</Label>
                        <Input
                          value={missingUserRecovery.sponsorId}
                          onChange={(e) => setMissingUserRecovery((prev) => ({ ...prev, sponsorId: e.target.value.replace(/\D/g, '').slice(0, 7) }))}
                          className="bg-[#1f2937] border-white/10 text-white h-9"
                          placeholder="7-digit sponsor ID"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-white/70">Email (optional)</Label>
                        <Input
                          value={missingUserRecovery.email}
                          onChange={(e) => setMissingUserRecovery((prev) => ({ ...prev, email: e.target.value }))}
                          className="bg-[#1f2937] border-white/10 text-white h-9"
                          placeholder="recovered@email"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-white/70">Phone (optional)</Label>
                        <Input
                          value={missingUserRecovery.phone}
                          onChange={(e) => setMissingUserRecovery((prev) => ({ ...prev, phone: e.target.value }))}
                          className="bg-[#1f2937] border-white/10 text-white h-9"
                          placeholder="Phone number"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-white/70">Country (optional)</Label>
                        <Input
                          value={missingUserRecovery.country}
                          onChange={(e) => setMissingUserRecovery((prev) => ({ ...prev, country: e.target.value }))}
                          className="bg-[#1f2937] border-white/10 text-white h-9"
                          placeholder="Country"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-white/70">Login Password (optional)</Label>
                        <Input
                          value={missingUserRecovery.loginPassword}
                          onChange={(e) => setMissingUserRecovery((prev) => ({ ...prev, loginPassword: e.target.value }))}
                          className="bg-[#1f2937] border-white/10 text-white h-9"
                          placeholder="Leave blank for auto"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-white/70">Transaction Password (optional)</Label>
                        <Input
                          value={missingUserRecovery.transactionPassword}
                          onChange={(e) => setMissingUserRecovery((prev) => ({ ...prev, transactionPassword: e.target.value }))}
                          className="bg-[#1f2937] border-white/10 text-white h-9"
                          placeholder="Leave blank for auto"
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-white/70">
                      <input
                        type="checkbox"
                        checked={missingUserRecovery.restoreSponsorIncome}
                        onChange={(e) => setMissingUserRecovery((prev) => ({ ...prev, restoreSponsorIncome: e.target.checked }))}
                        className="rounded"
                      />
                      Restore referral income if missing
                    </label>
                    <Button
                      onClick={handleRecoverMissingUser}
                      disabled={isRecoveringUser}
                      className="bg-amber-500/90 hover:bg-amber-500 text-slate-900"
                    >
                      {isRecoveringUser ? 'Recovering…' : 'Recover User (No Give-Help)'}
                    </Button>
                  </div>
                )}

                {searchedUser && (
                  <div className="space-y-6">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        variant="outline"
                        className="border-amber-400/40 text-amber-300 hover:bg-amber-400/10"
                        onClick={() => {
                          const result = Database.repairGhostReceiveHelpTransactions(searchedUser.id);
                          if (result.repaired > 0) {
                            toast.success(`Repaired ${result.repaired} ghost receive-help record(s) for this user.`);
                            loadAllTransactions();
                            loadStats();
                            setGhostRepairLogTick((tick) => tick + 1);
                            searchUserById();
                          } else {
                            toast.success('No ghost receive-help records found for this user.');
                          }
                        }}
                      >
                        Repair Ghost Receive-Help (This User)
                      </Button>
                      <p className="text-xs text-white/40 self-center">
                        Fixes invalid receive-help entries and recalculates this user’s wallet/locks.
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-end">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs text-white/70">Restore missing receive-help from sender</Label>
                        <Input
                          value={restoreReceiveHelpFromId}
                          onChange={(e) => setRestoreReceiveHelpFromId(e.target.value.replace(/\D/g, '').slice(0, 7))}
                          className="bg-[#1f2937] border-white/10 text-white h-9"
                          placeholder="Sender User ID (7 digits)"
                        />
                      </div>
                      <div className="w-full sm:w-32 space-y-1">
                        <Label className="text-xs text-white/70">Level (optional)</Label>
                        <Input
                          value={restoreReceiveHelpLevel}
                          onChange={(e) => setRestoreReceiveHelpLevel(e.target.value.replace(/\D/g, '').slice(0, 2))}
                          className="bg-[#1f2937] border-white/10 text-white h-9"
                          placeholder="Auto"
                        />
                      </div>
                      <label className="flex items-center gap-2 text-xs text-white/70 sm:self-center">
                        <input
                          type="checkbox"
                          checked={restoreReceiveHelpHistoryOnly}
                          onChange={(e) => setRestoreReceiveHelpHistoryOnly(e.target.checked)}
                          className="rounded"
                        />
                        History only (no wallet impact)
                      </label>
                      <Button
                        variant="outline"
                        onClick={handleRestoreReceiveHelp}
                        disabled={isRestoringReceiveHelp}
                        className="border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10"
                      >
                        {isRestoringReceiveHelp ? 'Restoring...' : 'Restore Receive Help'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleManualCreditReceiveHelp}
                        disabled={isManualCreditingReceiveHelp}
                        className="border-amber-400/40 text-amber-300 hover:bg-amber-400/10"
                      >
                        {isManualCreditingReceiveHelp ? 'Crediting...' : 'Manual Credit Now'}
                      </Button>
                    </div>
                    <p className="text-xs text-white/40 self-center sm:self-end">
                      Auto-detects level from matrix when blank. Use level if sender is not in the user's downline.
                    </p>
                    <p className="text-xs text-amber-200/70">
                      `Manual Credit Now` is only for recovery when the sender debit is already visible in history but exact matching still fails.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-end">
                      <div className="w-full sm:w-32 space-y-1">
                        <Label className="text-xs text-white/70">Legacy Qualified Level</Label>
                        <Input
                          value={manualQualifiedLevelValue}
                          onChange={(e) => setManualQualifiedLevelValue(e.target.value.replace(/\D/g, '').slice(0, 2))}
                          className="bg-[#1f2937] border-white/10 text-white h-9"
                          placeholder="1"
                        />
                      </div>
                      <Button
                        variant="outline"
                        onClick={handleMarkLevelHelpComplete}
                        disabled={isMarkingLevelHelpComplete}
                        className="border-indigo-400/40 text-indigo-300 hover:bg-indigo-400/10"
                      >
                        {isMarkingLevelHelpComplete ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                        {isMarkingLevelHelpComplete ? 'Marking Level Complete...' : 'Mark Level Help Complete'}
                      </Button>
                    </div>
                    <p className="text-xs text-white/40">
                      Use only for legacy manual-help cases where a user truly completed a level but proper receive-help history was never recorded.
                    </p>
                    <div className="space-y-2">
                      <Label className="text-xs text-white/70">Unsettled Exact Give-Help Debits Targeting This User</Label>
                      <div className="space-y-2">
                        {searchedUser.incomingGiveHelpCandidates?.slice(0, 8).map((item: any) => (
                          <div key={item.txId} className="rounded-lg bg-[#1f2937] p-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm text-white font-medium">
                                {item.senderName || 'Unknown sender'} {item.senderUserId ? `(${item.senderUserId})` : ''} {'->'} Level {item.level} {'->'} {formatCurrency(item.amount)}
                              </p>
                              <p className="text-xs text-white/50 break-all">{item.description}</p>
                              <p className="text-[11px] text-white/40 mt-1">
                                Tx: {item.txId} | {formatDate(item.createdAt)}
                              </p>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2">
                              <Button
                                variant="outline"
                                onClick={() => handleRestoreFromExactGiveHelp(item.txId, false)}
                                disabled={restoringFromGiveHelpTxId === item.txId}
                                className="border-sky-400/40 text-sky-300 hover:bg-sky-400/10"
                              >
                                {restoringFromGiveHelpTxId === item.txId ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Wrench className="w-4 h-4 mr-2" />}
                                Restore From This Debit
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => handleRestoreFromExactGiveHelp(item.txId, true)}
                                disabled={restoringFromGiveHelpTxId === item.txId}
                                className="border-white/20 text-white hover:bg-white/10"
                              >
                                History Only
                              </Button>
                            </div>
                          </div>
                        ))}
                        {(!searchedUser.incomingGiveHelpCandidates || searchedUser.incomingGiveHelpCandidates.length === 0) && (
                          <p className="text-xs text-white/40">No unsettled exact give-help debit candidates found for this user.</p>
                        )}
                      </div>
                    </div>
                    {/* User Details Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {/* 1. User ID */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">User ID</p>
                        <p className="text-xl font-bold text-[#118bdd] font-mono">{searchedUser.userId}</p>
                      </div>
                      {/* 2. Name */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Name</p>
                        <p className="text-xl font-bold text-white">{searchedUser.fullName}</p>
                      </div>
                      {/* 3. Status */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Status</p>
                        <div className="space-y-1 mt-1">
                          {searchedUser.accountStatus === 'permanent_blocked' && (
                            <Badge className="bg-red-500/20 text-red-400">Permanently Blocked</Badge>
                          )}
                          {searchedUser.accountStatus === 'temp_blocked' && (
                            <Badge className="bg-orange-500/20 text-orange-400">Temporarily Blocked</Badge>
                          )}
                          {searchedUser.accountStatus === 'active' && searchedUser.isActive && (
                            <Badge className="bg-emerald-500/20 text-emerald-400">Active</Badge>
                          )}
                          {searchedUser.accountStatus === 'active' && !searchedUser.isActive && (
                            <Badge className="bg-amber-500/20 text-amber-400">Inactive</Badge>
                          )}
                          {(searchedUser.accountStatus === 'temp_blocked' || searchedUser.accountStatus === 'permanent_blocked') && (
                            <p className="text-xs text-white/50">
                              {searchedUser.blockedReason || 'Blocked by admin'}
                              {searchedUser.blockedUntil ? ` | Until ${new Date(searchedUser.blockedUntil).toLocaleString()}` : ''}
                            </p>
                          )}
                        </div>
                      </div>
                      {/* 4. Fund Wallet */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Fund Wallet</p>
                        <p className="text-xl font-bold text-white">{formatCurrency(searchedUser.wallet?.depositWallet || 0)}</p>
                      </div>
                      {/* 5. Pin Wallet */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">PIN Wallet</p>
                        <p className="text-xl font-bold text-[#118bdd]">{searchedUser.pins?.filter((p: Pin) => p.status === 'unused').length || 0} PINs</p>
                      </div>
                      {/* 6. Income Wallet */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Income Wallet</p>
                        <p className="text-xl font-bold text-emerald-400">{formatCurrency(searchedUser.wallet?.incomeWallet || 0)}</p>
                      </div>
                      {/* 7. Royalty Wallet */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Royalty Wallet</p>
                        <p className="text-xl font-bold text-amber-300">{formatCurrency(searchedUser.wallet?.royaltyWallet || 0)}</p>
                      </div>
                      {/* 8. Total Earnings */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Total Earnings</p>
                        <p className="text-xl font-bold text-emerald-400">{formatCurrency(searchedUser.wallet?.totalEarning || 0)}</p>
                      </div>
                      {/* 9. Give Help */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Give Help</p>
                        <p className="text-xl font-bold text-orange-400">{formatCurrency(searchedUser.giveHelpAmount || 0)}</p>
                      </div>
                      {/* 10. Received Help */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Received Help</p>
                        <p className="text-xl font-bold text-emerald-400">{formatCurrency(searchedUser.receiveHelpAmount || 0)}</p>
                      </div>
                      {/* 11. Locked Help */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Locked Help</p>
                        <p className="text-xl font-bold text-white/80">{formatCurrency((searchedUser.wallet?.lockedIncomeWallet || 0) + (searchedUser.wallet?.giveHelpLocked || 0))}</p>
                      </div>
                      {/* 12. Direct Referral */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Direct Referral</p>
                        <p className="text-xl font-bold text-white">{searchedUser.directCount}</p>
                      </div>
                      {/* 13. Direct Referral Income */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Direct Referral Income</p>
                        <p className="text-xl font-bold text-white/80">{formatCurrency(searchedUser.directReferralIncome || 0)}</p>
                      </div>
                      {/* 14. Left Team */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50 mb-1">Left Team</p>
                        <p className="text-xl font-bold text-white">{searchedUser.teamStats?.left || 0}</p>
                        <p className="text-xs text-emerald-400">{searchedUser.teamStats?.leftActive || 0} Active</p>
                      </div>
                      {/* 15. Right Team */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50 mb-1">Right Team</p>
                        <p className="text-xl font-bold text-white">{searchedUser.teamStats?.right || 0}</p>
                        <p className="text-xs text-emerald-400">{searchedUser.teamStats?.rightActive || 0} Active</p>
                      </div>
                      {/* 16. Level Filled */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Level Filled</p>
                        <p className="text-xl font-bold text-white">
                          {(() => {
                            const progress = Database.getLevelFillProgress(searchedUser.id);
                            return `Level ${progress.level} (${progress.filled}/${progress.required} filled)`;
                          })()}
                        </p>
                      </div>
                      {/* 17. Qualified Level */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Qualified Level</p>
                        <p className="text-xl font-bold text-white">
                          Level {Database.getQualifiedLevel(searchedUser.id)}
                        </p>
                      </div>
                      {/* 18. Offer Achievement */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Offer Achievement</p>
                        <p className="text-xl font-bold text-purple-400">{searchedUser.offerAchieved ? 'Achieved' : 'Not Achieved'}</p>
                      </div>
                      {/* 19. User's Transition */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">User's Transition</p>
                        <p className="text-xl font-bold text-white/80">{searchedUser.transactions?.length || 0} Txns</p>
                      </div>
                    </div>

                    {/* Admin Profile Update */}
                    <div className="rounded-lg border border-white/10 bg-[#141c2a] p-4 space-y-4">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <h4 className="text-white font-semibold">Admin Profile Update</h4>
                          <p className="text-xs text-white/55">
                            Update user profile details directly. User ID cannot be changed.
                          </p>
                        </div>
                        <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30">
                          No OTP required
                        </Badge>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-white/70 text-xs">Full Name</Label>
                          <Input
                            value={adminUserProfile.fullName}
                            onChange={(e) => setAdminUserProfile((prev) => ({ ...prev, fullName: e.target.value }))}
                            className="bg-[#1f2937] border-white/10 text-white h-9"
                            placeholder="Enter full name"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-white/70 text-xs">Email</Label>
                          <Input
                            value={adminUserProfile.email}
                            onChange={(e) => setAdminUserProfile((prev) => ({ ...prev, email: e.target.value }))}
                            className="bg-[#1f2937] border-white/10 text-white h-9"
                            placeholder="Enter email"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-white/70 text-xs">Phone Number</Label>
                          <Input
                            value={adminUserProfile.phone}
                            onChange={(e) => setAdminUserProfile((prev) => ({ ...prev, phone: e.target.value }))}
                            className="bg-[#1f2937] border-white/10 text-white h-9"
                            placeholder="Enter phone number"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-white/70 text-xs">USDT Address</Label>
                          <Input
                            value={adminUserProfile.usdtAddress}
                            onChange={(e) => setAdminUserProfile((prev) => ({ ...prev, usdtAddress: e.target.value }))}
                            className="bg-[#1f2937] border-white/10 text-white h-9"
                            placeholder="Enter USDT address"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-white/70 text-xs">Login Password (optional)</Label>
                          <div className="relative">
                            <Input
                              type={showAdminLoginPassword ? 'text' : 'password'}
                              value={adminUserProfile.loginPassword}
                              onChange={(e) => setAdminUserProfile((prev) => ({ ...prev, loginPassword: e.target.value }))}
                              className="bg-[#1f2937] border-white/10 text-white h-9 pr-10"
                              placeholder="Enter new login password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowAdminLoginPassword((prev) => !prev)}
                              className="absolute inset-y-0 right-3 flex items-center text-white/60 hover:text-white"
                              tabIndex={-1}
                            >
                              {showAdminLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          <p className="text-[11px] text-white/40">{getPasswordRequirementsText()}</p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-white/70 text-xs">Transaction Password (optional)</Label>
                          <div className="relative">
                            <Input
                              type={showAdminTransactionPassword ? 'text' : 'password'}
                              value={adminUserProfile.transactionPassword}
                              onChange={(e) => setAdminUserProfile((prev) => ({ ...prev, transactionPassword: e.target.value }))}
                              className="bg-[#1f2937] border-white/10 text-white h-9 pr-10"
                              placeholder="Enter new transaction password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowAdminTransactionPassword((prev) => !prev)}
                              className="absolute inset-y-0 right-3 flex items-center text-white/60 hover:text-white"
                              tabIndex={-1}
                            >
                              {showAdminTransactionPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          <p className="text-[11px] text-white/40">{getTransactionPasswordRequirementsText()}</p>
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                          onClick={handleAdminProfileUpdate}
                          disabled={isUpdatingUserProfile}
                          className="bg-[#118bdd] hover:bg-[#0f7ac7] flex-1"
                        >
                          {isUpdatingUserProfile ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <UserCog className="w-4 h-4 mr-2" />}
                          {isUpdatingUserProfile ? 'Updating...' : 'Update Profile'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handleResetUserPasswords}
                          disabled={isUpdatingUserProfile}
                          className="border-amber-400/40 text-amber-300 hover:bg-amber-400/10 flex-1"
                        >
                          Reset Passwords
                        </Button>
                        <Button
                          variant="outline"
                          onClick={resetAdminUserProfileForm}
                          className="border-white/20 text-white hover:bg-white/10 flex-1"
                        >
                          Reset
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                        <Button
                          variant="outline"
                          onClick={handleRepairMissingIncomingHelp}
                          disabled={isRepairingIncomingHelp}
                          className="border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10 w-full"
                        >
                          {isRepairingIncomingHelp ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Wrench className="w-4 h-4 mr-2" />}
                          {isRepairingIncomingHelp ? 'Repairing Incoming Help...' : 'Repair Missing Incoming Help'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handleRepairSelfFundCredits}
                          disabled={isRepairingSelfFundCredits}
                          className="border-cyan-400/40 text-cyan-300 hover:bg-cyan-400/10 w-full"
                        >
                          {isRepairingSelfFundCredits ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Wrench className="w-4 h-4 mr-2" />}
                          {isRepairingSelfFundCredits ? 'Repairing Self Fund Credit...' : 'Repair Missing Self Fund Credit'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handleRecalculateQualifiedLevel}
                          disabled={isRecalculatingQualifiedLevel}
                          className="border-sky-400/40 text-sky-300 hover:bg-sky-400/10 w-full"
                        >
                          {isRecalculatingQualifiedLevel ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                          {isRecalculatingQualifiedLevel ? 'Rechecking Qualified Level...' : 'Recalculate Qualified Level'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handleReverseTemporarySelfFundCredits}
                          disabled={isReversingTemporarySelfFundCredits}
                          className="border-fuchsia-400/40 text-fuchsia-300 hover:bg-fuchsia-400/10 w-full"
                        >
                          {isReversingTemporarySelfFundCredits ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}
                          {isReversingTemporarySelfFundCredits ? 'Removing Temporary Self Fund Credit...' : 'Remove Temporary Self Fund Credit'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handleRemoveBrokenSelfTransferHistory}
                          disabled={isRemovingBrokenSelfTransferHistory}
                          className="border-rose-400/40 text-rose-300 hover:bg-rose-400/10 w-full"
                        >
                          {isRemovingBrokenSelfTransferHistory ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                          {isRemovingBrokenSelfTransferHistory ? 'Removing Broken Self Transfer...' : 'Remove Broken Self Transfer'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handleScanHelpMismatches}
                          disabled={isScanningHelpMismatches}
                          className="border-amber-400/40 text-amber-300 hover:bg-amber-400/10 w-full"
                        >
                          {isScanningHelpMismatches ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <AlertTriangle className="w-4 h-4 mr-2" />}
                          {isScanningHelpMismatches ? 'Scanning Help Mismatches...' : 'Scan Help Mismatches'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handleReverseInvalidRestoredHelp}
                          disabled={isReversingInvalidRestoredHelp}
                          className="border-red-400/40 text-red-300 hover:bg-red-400/10 w-full"
                        >
                          {isReversingInvalidRestoredHelp ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}
                          {isReversingInvalidRestoredHelp ? 'Reversing Invalid Credits...' : 'Reverse Invalid Restored Credit'}
                        </Button>
                      </div>
                    </div>

                    {/* Pending Matrix Debug */}
                    <div className="space-y-3">
                      <h4 className="text-white font-medium">Pending Matrix Debug (Sender Queue)</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 rounded-lg bg-[#1f2937]">
                          <p className="text-sm text-white/50">Total Pending</p>
                          <p className="text-xl sm:text-2xl font-bold text-white">{searchedUser.pendingMatrixDebug?.totalPending || 0}</p>
                        </div>
                        <div className="p-4 rounded-lg bg-[#1f2937]">
                          <p className="text-sm text-white/50">Blocked At Item</p>
                          <p className="text-sm font-bold text-white break-all">{searchedUser.pendingMatrixDebug?.blockedAtItemId || 'None'}</p>
                        </div>
                        <div className="p-4 rounded-lg bg-[#1f2937]">
                          <p className="text-sm text-white/50">Queue Status</p>
                          <p className={`text-sm font-semibold ${searchedUser.pendingMatrixDebug?.blockedReason ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {searchedUser.pendingMatrixDebug?.blockedReason ? 'Blocked' : 'Ready'}
                          </p>
                        </div>
                      </div>

                      {searchedUser.pendingMatrixDebug?.blockedReason && (
                        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                          <p className="text-amber-300 text-sm">
                            {searchedUser.pendingMatrixDebug.blockedReason}
                          </p>
                        </div>
                      )}

                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg bg-[#1f2937]">
                          <p className="text-white/80 font-medium mb-3">Pending By Level</p>
                          <div className="overflow-x-auto admin-table-scroll">
                            <table className="w-full admin-table">
                              <thead>
                                <tr className="border-b border-white/10">
                                  <th className="text-left py-2 px-3 text-white/60 text-sm">Level</th>
                                  <th className="text-left py-2 px-3 text-white/60 text-sm">Pending</th>
                                  <th className="text-left py-2 px-3 text-white/60 text-sm">Ready</th>
                                  <th className="text-left py-2 px-3 text-white/60 text-sm">Blocked</th>
                                </tr>
                              </thead>
                              <tbody>
                                {searchedUser.pendingMatrixDebug?.levels?.map((row: any) => (
                                  <tr key={row.level} className="border-b border-white/5">
                                    <td className="py-2 px-3 text-white">Level {row.level}</td>
                                    <td className="py-2 px-3 text-white/80">{row.pending}</td>
                                    <td className="py-2 px-3 text-emerald-400">{row.ready}</td>
                                    <td className="py-2 px-3 text-amber-400">{row.blocked}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {(!searchedUser.pendingMatrixDebug?.levels || searchedUser.pendingMatrixDebug.levels.length === 0) && (
                            <p className="text-white/50 text-sm py-3">No pending matrix contributions for this user.</p>
                          )}
                        </div>

                        <div className="p-4 rounded-lg bg-[#1f2937]">
                          <p className="text-white/80 font-medium mb-3">Pending Items (Top 50)</p>
                          <div className="max-h-80 overflow-auto space-y-2 pr-1">
                            {searchedUser.pendingMatrixDebug?.items?.slice(0, 50).map((item: any) => (
                              <div key={item.id} className="p-3 rounded-lg border border-white/10 bg-[#0f172a]">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                  <p className="text-sm text-white font-medium">
                                    Level {item.level} - {safeText(item.side).toUpperCase()} - To {item.toUserId}
                                  </p>
                                  <Badge className={item.status === 'ready' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}>
                                    {item.status}
                                  </Badge>
                                </div>
                                <p className="text-xs text-white/50 mt-1">{item.toUserName} - {formatDate(item.createdAt)}</p>
                                <p className="text-xs text-white/70 mt-1">{item.reason}</p>
                              </div>
                            ))}
                          </div>
                          {(!searchedUser.pendingMatrixDebug?.items || searchedUser.pendingMatrixDebug.items.length === 0) && (
                            <p className="text-white/50 text-sm py-3">No pending items.</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Pending Matrix Debug - Incoming */}
                    <div className="space-y-3">
                      <h4 className="text-white font-medium">Pending Matrix Debug (Incoming To This User)</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 rounded-lg bg-[#1f2937]">
                          <p className="text-sm text-white/50">Total Pending Incoming</p>
                          <p className="text-xl sm:text-2xl font-bold text-white">{searchedUser.incomingPendingMatrixDebug?.totalPending || 0}</p>
                        </div>
                        <div className="p-4 rounded-lg bg-[#1f2937]">
                          <p className="text-sm text-white/50">Blocked Senders</p>
                          <p className="text-2xl font-bold text-amber-400">{searchedUser.incomingPendingMatrixDebug?.blockedSenders || 0}</p>
                        </div>
                        <div className="p-4 rounded-lg bg-[#1f2937]">
                          <p className="text-sm text-white/50">Incoming Queue</p>
                          <p className={`text-sm font-semibold ${(searchedUser.incomingPendingMatrixDebug?.blockedSenders || 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {(searchedUser.incomingPendingMatrixDebug?.blockedSenders || 0) > 0 ? 'Partially Blocked' : 'Healthy'}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg bg-[#1f2937]">
                          <p className="text-white/80 font-medium mb-3">Incoming Pending By Level</p>
                          <div className="overflow-x-auto admin-table-scroll">
                            <table className="w-full admin-table">
                              <thead>
                                <tr className="border-b border-white/10">
                                  <th className="text-left py-2 px-3 text-white/60 text-sm">Level</th>
                                  <th className="text-left py-2 px-3 text-white/60 text-sm">Pending</th>
                                  <th className="text-left py-2 px-3 text-white/60 text-sm">Ready</th>
                                  <th className="text-left py-2 px-3 text-white/60 text-sm">Blocked</th>
                                </tr>
                              </thead>
                              <tbody>
                                {searchedUser.incomingPendingMatrixDebug?.levels?.map((row: any) => (
                                  <tr key={row.level} className="border-b border-white/5">
                                    <td className="py-2 px-3 text-white">Level {row.level}</td>
                                    <td className="py-2 px-3 text-white/80">{row.pending}</td>
                                    <td className="py-2 px-3 text-emerald-400">{row.ready}</td>
                                    <td className="py-2 px-3 text-amber-400">{row.blocked}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {(!searchedUser.incomingPendingMatrixDebug?.levels || searchedUser.incomingPendingMatrixDebug.levels.length === 0) && (
                            <p className="text-white/50 text-sm py-3">No incoming pending matrix contributions for this user.</p>
                          )}
                        </div>

                        <div className="p-4 rounded-lg bg-[#1f2937]">
                          <p className="text-white/80 font-medium mb-3">Incoming Pending Items (Top 50)</p>
                          <div className="max-h-80 overflow-auto space-y-2 pr-1">
                            {searchedUser.incomingPendingMatrixDebug?.items?.slice(0, 50).map((item: any) => (
                              <div key={item.id} className="p-3 rounded-lg border border-white/10 bg-[#0f172a]">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                  <p className="text-sm text-white font-medium">
                                    Level {item.level} - {safeText(item.side).toUpperCase()} - From {item.fromUserId}
                                  </p>
                                  <Badge className={item.status === 'ready' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}>
                                    {item.status}
                                  </Badge>
                                </div>
                                <p className="text-xs text-white/50 mt-1">{item.fromUserName} - {formatDate(item.createdAt)}</p>
                                <p className="text-xs text-white/70 mt-1">{item.reason}</p>
                              </div>
                            ))}
                          </div>
                          {(!searchedUser.incomingPendingMatrixDebug?.items || searchedUser.incomingPendingMatrixDebug.items.length === 0) && (
                            <p className="text-white/50 text-sm py-3">No incoming pending items.</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Auto Give-Help Debug */}
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 className="text-white font-medium">Auto Give-Help Debug (Source → Target)</h4>
                          <span className="text-xs text-white/50">Local browser log</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className={helpFlowView === 'sent' ? 'bg-[#118bdd] text-white border-transparent' : 'border-white/20 text-white/70'}
                            onClick={() => setHelpFlowView('sent')}
                          >
                            Sent
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className={helpFlowView === 'received' ? 'bg-[#118bdd] text-white border-transparent' : 'border-white/20 text-white/70'}
                            onClick={() => setHelpFlowView('received')}
                          >
                            Received
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-white/20 text-white/70"
                            onClick={() => {
                              if (!searchedUser) return;
                              Database.clearHelpFlowDebugForUser(searchedUser.id);
                              setHelpFlowDebugTick((t) => t + 1);
                            }}
                          >
                            Clear Log
                          </Button>
                        </div>
                      </div>
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <div className="overflow-x-auto admin-table-scroll">
                          <table className="w-full admin-table">
                            <thead>
                              <tr className="border-b border-white/10">
                                <th className="text-left py-2 px-3 text-white/60 text-sm">Time</th>
                                <th className="text-left py-2 px-3 text-white/60 text-sm">Source → Target</th>
                                <th className="text-left py-2 px-3 text-white/60 text-sm">Amount</th>
                                <th className="text-left py-2 px-3 text-white/60 text-sm">
                                  {helpFlowView === 'sent' ? 'To' : 'From'}
                                </th>
                                <th className="text-left py-2 px-3 text-white/60 text-sm">Outcome</th>
                              </tr>
                            </thead>
                            <tbody>
                              {helpFlowDebugEntries.map((entry) => (
                                <tr key={entry.id} className="border-b border-white/5">
                                  <td className="py-2 px-3 text-white/60 text-sm">{formatDate(entry.createdAt)}</td>
                                  <td className="py-2 px-3 text-white text-sm">
                                    L{entry.sourceLevel} → L{entry.targetLevel}
                                  </td>
                                  <td className="py-2 px-3 text-white font-medium">
                                    {formatCurrency(entry.amount)}
                                  </td>
                                  <td className="py-2 px-3 text-white/70 text-sm">
                                    {entry.outcome === 'safety_pool'
                                      ? 'Safety Pool'
                                      : (() => {
                                          const name = helpFlowView === 'sent' ? entry.toUserName : entry.fromUserName;
                                          const publicId = helpFlowView === 'sent' ? entry.toUserPublicId : entry.fromUserPublicId;
                                          return `${name || 'User'}${publicId ? ` (${publicId})` : ''}`;
                                        })()}
                                  </td>
                                  <td className="py-2 px-3">
                                    <Badge className={entry.outcome === 'safety_pool' ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}>
                                      {entry.outcome === 'safety_pool' ? 'Safety Pool' : 'Sent'}
                                    </Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {helpFlowDebugEntries.length === 0 && (
                          <p className="text-white/50 text-sm py-3">No auto give-help logs yet for this user.</p>
                        )}
                      </div>
                    </div>

                    {/* Locked/Unlock Debug */}
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 className="text-white font-medium">Locked/Unlock Debug (Give-Help Consumption)</h4>
                          <span className="text-xs text-white/50">Shows which locked entries were consumed by each give-help.</span>
                        </div>
                      </div>
                      <div className="p-4 rounded-lg bg-[#1f2937] space-y-4">
                        <div className="overflow-x-auto admin-table-scroll">
                          <table className="w-full admin-table">
                            <thead>
                              <tr className="border-b border-white/10">
                                <th className="text-left py-2 px-3 text-white/60 text-sm min-w-[160px]">Give Time</th>
                                <th className="text-left py-2 px-3 text-white/60 text-sm">Give Amount</th>
                                <th className="text-left py-2 px-3 text-white/60 text-sm">Source Level</th>
                                <th className="text-left py-2 px-3 text-white/60 text-sm">Unlocked Entries</th>
                              </tr>
                            </thead>
                            <tbody>
                              {userHelpLockDebug.giveEntries.map((entry) => (
                                <tr key={entry.txId} className="border-b border-white/5">
                                  <td className="py-2 px-3 text-white/60 text-sm whitespace-nowrap">{formatDate(entry.createdAt)}</td>
                                  <td className="py-2 px-3 text-orange-300">{formatCurrency(entry.amount)}</td>
                                  <td className="py-2 px-3 text-white/70">L{entry.sourceLevel}</td>
                                  <td className="py-2 px-3 text-white/70 text-xs">
                                    {entry.consumed.length === 0
                                      ? 'No locked entries matched'
                                      : entry.consumed.map((c) => (
                                          <div key={`${entry.txId}_${c.txId}`} className="py-0.5">
                                            {formatCurrency(c.amount)} · L{c.level} · {c.description || c.txId}
                                          </div>
                                        ))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {userHelpLockDebug.giveEntries.length === 0 && (
                          <p className="text-white/50 text-sm">No give-help consumption found for this user yet.</p>
                        )}

                        <div className="overflow-x-auto admin-table-scroll">
                          <table className="w-full admin-table">
                            <thead>
                              <tr className="border-b border-white/10">
                                <th className="text-left py-2 px-3 text-white/60 text-sm min-w-[160px]">Locked Tx Time</th>
                                <th className="text-left py-2 px-3 text-white/60 text-sm">Amount</th>
                                <th className="text-left py-2 px-3 text-white/60 text-sm">Level</th>
                                <th className="text-left py-2 px-3 text-white/60 text-sm">Status</th>
                                <th className="text-left py-2 px-3 text-white/60 text-sm">Description</th>
                              </tr>
                            </thead>
                            <tbody>
                              {userHelpLockDebug.lockedEntries.map((entry) => (
                                <tr key={entry.txId} className="border-b border-white/5">
                                  <td className="py-2 px-3 text-white/60 text-sm whitespace-nowrap">{formatDate(entry.createdAt)}</td>
                                  <td className="py-2 px-3 text-emerald-300">{formatCurrency(entry.amount)}</td>
                                  <td className="py-2 px-3 text-white/70">L{entry.level}</td>
                                  <td className="py-2 px-3">
                                    <Badge className={entry.status === 'locked' ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}>
                                      {entry.status === 'locked' ? 'Locked' : 'Unlocked'}
                                    </Badge>
                                  </td>
                                  <td className="py-2 px-3 text-white/60 text-xs">{getVisibleTransactionDescription(entry.description)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {userHelpLockDebug.lockedEntries.length === 0 && (
                          <p className="text-white/50 text-sm">No locked income entries found for this user.</p>
                        )}
                      </div>
                    </div>

                    {/* User's Transactions */}
                    <div>
                      <h4 className="text-white font-medium mb-3">User's Transactions</h4>
                      <div className="overflow-x-auto admin-table-scroll">
                        <table className="w-full admin-table">
                          <thead>
                            <tr className="border-b border-white/10">
                              <th className="text-left py-2 px-4 text-white/60 font-medium">Type</th>
                              <th className="text-left py-2 px-4 text-white/60 font-medium">Amount</th>
                              <th className="text-left py-2 px-4 text-white/60 font-medium">Description</th>
                              <th className="text-left py-2 px-4 text-white/60 font-medium">Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {searchedUser.transactions?.slice(0, 10).map((tx: any) => (
                              <tr key={tx.id} className="border-b border-white/5">
                                <td className="py-2 px-4">
                                  <Badge variant="outline" className="border-white/20 text-white/80">
                                    {getTransactionTypeLabel(tx.type, tx.description)}
                                  </Badge>
                                </td>
                                <td className={`py-2 px-4 font-medium ${tx.amount > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {tx.amount > 0 ? '+' : ''}{formatCurrency(tx.amount)}
                                </td>
                                <td className="py-2 px-4 text-white/60 text-sm">{getVisibleTransactionDescription(tx.description)}</td>
                                <td className="py-2 px-4 text-white/60 text-sm">{formatDate(tx.createdAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {(!searchedUser.transactions || searchedUser.transactions.length === 0) && (
                          <p className="text-center text-white/50 py-4">No transactions</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Impersonate Tab */}
          <TabsContent value="impersonate">
            <Card className="glass border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <UserCog className="w-5 h-5 text-purple-400" />
                  Login As User (Master Password)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <Alert className="bg-amber-500/10 border-amber-500/30">
                  <AlertDescription className="text-amber-400">
                    This feature allows you to login as any user to view their dashboard and manage their account.
                    All actions will be logged.
                  </AlertDescription>
                </Alert>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-white/80">Target User ID (7 digits)</Label>
                    <Input
                      value={impersonateUserId}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 7);
                        setImpersonateUserId(value);
                      }}
                      maxLength={7}
                      placeholder="Enter User ID to impersonate"
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/80">Master Password</Label>
                    <Input
                      type="password"
                      value={masterPassword}
                      onChange={(e) => setMasterPassword(e.target.value)}
                      placeholder="Enter master password"
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>
                </div>

                <Button
                  onClick={handleImpersonateUser}
                  disabled={impersonateUserId.length !== 7 || !masterPassword}
                  className="w-full btn-primary"
                >
                  <UserCog className="w-4 h-4 mr-2" />
                  Login As User
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Support Tab */}
          <TabsContent value="support">
            <div className="space-y-4">
              {!supportDataLoaded && (
                <Card className="glass border-white/10">
                  <CardContent className="p-4 text-white/70 text-sm">
                    Loading support tickets...
                  </CardContent>
                </Card>
              )}
              <Card className="glass border-white/10">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Ticket className="w-5 h-5 text-[#118bdd]" />
                    Support Tickets
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label className="text-white/80">Search</Label>
                      <Input
                        value={supportSearch}
                        onChange={(e) => setSupportSearch(e.target.value)}
                        placeholder="Ticket ID / User ID / Name / Subject"
                        className="bg-[#1f2937] border-white/10 text-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-white/80">Status Filter</Label>
                      <select
                        value={supportStatusFilter}
                        onChange={(e) => setSupportStatusFilter(e.target.value as 'all' | SupportTicketStatus)}
                        className="w-full h-10 rounded-md bg-[#1f2937] border border-white/10 text-white px-3 text-sm"
                      >
                        <option value="all">All Statuses</option>
                        {SUPPORT_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <Button
                        variant="outline"
                        onClick={() => void loadSupportTickets(true)}
                        className="w-full border-white/20 text-white hover:bg-white/10"
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Refresh Tickets
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                    <div className="xl:col-span-1 space-y-2 max-h-[580px] overflow-y-auto pr-1">
                      {filteredSupportTickets.map((ticket) => {
                        const isActive = ticket.ticket_id === selectedSupportTicketId;
                        return (
                          <button
                            type="button"
                            key={ticket.ticket_id}
                            onClick={() => setSelectedSupportTicketId(ticket.ticket_id)}
                            className={`w-full text-left p-3 rounded-lg border transition-colors ${isActive ? 'border-[#118bdd] bg-[#118bdd]/15' : 'border-white/10 bg-[#1f2937] hover:bg-[#263248]'
                              }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-mono text-white">{ticket.ticket_id}</p>
                              <Badge className="bg-white/10 text-white/80 border-white/20">{SUPPORT_STATUS_OPTIONS.find((s) => s.value === ticket.status)?.label || ticket.status}</Badge>
                            </div>
                            <p className="text-sm text-white mt-2 line-clamp-1">{ticket.subject || '-'}</p>
                            <p className="text-xs text-white/50 mt-1">{ticket.user_id} - {ticket.name || '-'}</p>
                            <p className="text-xs text-white/40 mt-1">{new Date(ticket.updated_at).toLocaleString()}</p>
                          </button>
                        );
                      })}
                      {filteredSupportTickets.length === 0 && (
                        <p className="text-white/50 text-sm text-center py-6">No support tickets found</p>
                      )}
                    </div>

                    <div className="xl:col-span-2">
                      {!selectedSupportTicket && (
                        <div className="rounded-lg border border-white/10 bg-[#1f2937] p-6 text-white/60 text-center">
                          Select a ticket to view conversation.
                        </div>
                      )}

                      {selectedSupportTicket && (
                        <div className="space-y-4">
                          <div className="rounded-lg border border-white/10 bg-[#1f2937] p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                              <p className="text-white/70"><span className="text-white">Ticket ID:</span> {selectedSupportTicket.ticket_id}</p>
                              <p className="text-white/70"><span className="text-white">User:</span> {selectedSupportTicket.user_id} ({selectedSupportTicket.name || '-'})</p>
                              <p className="text-white/70"><span className="text-white">Email:</span> {selectedSupportTicket.email || '-'}</p>
                              <p className="text-white/70"><span className="text-white">Category:</span> {SUPPORT_CATEGORY_LABELS[selectedSupportTicket.category] || selectedSupportTicket.category}</p>
                              <p className="text-white/70"><span className="text-white">Priority:</span> {selectedSupportTicket.priority}</p>
                              <p className="text-white/70"><span className="text-white">Created:</span> {new Date(selectedSupportTicket.created_at).toLocaleString()}</p>
                            </div>
                          </div>

                          <div className="rounded-lg border border-white/10 bg-[#1f2937] p-4 space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div className="space-y-2 md:col-span-2">
                                <Label className="text-white/80">Change Status</Label>
                                <select
                                  value={supportStatusDraft}
                                  onChange={(e) => setSupportStatusDraft(e.target.value as SupportTicketStatus)}
                                  className="w-full h-10 rounded-md bg-[#111827] border border-white/10 text-white px-3 text-sm"
                                >
                                  {SUPPORT_STATUS_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex items-end">
                                <Button onClick={handleSupportStatusUpdate} className="w-full bg-[#118bdd] hover:bg-[#0f79be] text-white">
                                  Update Status
                                </Button>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-lg border border-white/10 bg-[#1f2937] p-4">
                            <p className="text-white/80 font-medium mb-3">Ticket History</p>
                            <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                              {(() => {
                                const latestAdminMessageId = [...selectedSupportTicket.messages]
                                  .reverse()
                                  .find((item) => item.sender_type === 'admin')?.id;
                                return selectedSupportTicket.messages.map((msg) => {
                                  const canEditAdminMessage = msg.sender_type === 'admin' && msg.id === latestAdminMessageId;
                                  return (
                                <div key={msg.id} className="rounded-lg border border-white/10 bg-[#111827] p-3">
                                  <div className="flex items-center justify-between gap-3 mb-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <p className="text-sm text-white">
                                        {msg.sender_type === 'admin' ? 'Admin' : 'User'} - {msg.sender_name}
                                      </p>
                                      {msg.edited_at && (
                                        <span className="text-[11px] text-amber-300">
                                          edited {new Date(msg.edited_at).toLocaleString()}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <p className="text-xs text-white/50">{new Date(msg.created_at).toLocaleString()}</p>
                                      {canEditAdminMessage && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => {
                                            setEditingSupportMessageId(msg.id);
                                            setEditingSupportMessageText(msg.message || '');
                                          }}
                                          className="h-7 px-2 text-sky-300 hover:bg-sky-400/10 hover:text-sky-200"
                                        >
                                          <Pencil className="w-3.5 h-3.5 mr-1" />
                                          Edit
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                  {editingSupportMessageId === msg.id ? (
                                    <div className="space-y-2">
                                      <Textarea
                                        rows={4}
                                        value={editingSupportMessageText}
                                        onChange={(e) => setEditingSupportMessageText(e.target.value)}
                                        className="bg-[#0f172a] border-white/10 text-white"
                                      />
                                      <div className="flex flex-col sm:flex-row gap-2">
                                        <Button onClick={handleAdminSupportMessageEdit} className="bg-[#118bdd] hover:bg-[#0f79be] text-white">
                                          Save Edit
                                        </Button>
                                        <Button
                                          variant="outline"
                                          onClick={() => {
                                            setEditingSupportMessageId('');
                                            setEditingSupportMessageText('');
                                          }}
                                          className="border-white/20 text-white hover:bg-white/10"
                                        >
                                          Cancel
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="text-white/75 text-sm whitespace-pre-wrap">{msg.message || '-'}</p>
                                  )}
                                  {msg.attachments.length > 0 && (
                                    <div className="mt-2 space-y-2">
                                      {msg.attachments.map((att) => (
                                        <div key={att.id}>
                                          {(att.file_type?.startsWith('image/') || att.data_url?.startsWith('data:image/')) ? (
                                            <a href={att.data_url} target="_blank" rel="noreferrer" className="block">
                                              <img
                                                src={att.data_url}
                                                alt={att.file_name}
                                                className="max-w-[280px] max-h-[200px] rounded-lg border border-white/10 object-contain cursor-pointer hover:opacity-80 transition-opacity"
                                              />
                                              <p className="text-xs text-[#7cc9ff] mt-1">{att.file_name}</p>
                                            </a>
                                          ) : (
                                            <a href={att.data_url} target="_blank" rel="noreferrer" className="block text-xs text-[#7cc9ff] hover:underline">
                                              📎 {att.file_name}
                                            </a>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                  );
                                });
                              })()}
                            </div>
                          </div>

                          {selectedSupportTicket.status === 'closed' ? (
                            <div className="rounded-lg border border-white/10 bg-[#1f2937] p-4">
                              <p className="text-white/50 text-sm text-center">This ticket is closed. Reopen it by changing the status above to reply.</p>
                            </div>
                          ) : (
                            <div className="rounded-lg border border-white/10 bg-[#1f2937] p-4 space-y-3">
                              <p className="text-white/80 font-medium">Reply to Ticket</p>
                              <Textarea
                                rows={4}
                                value={supportReplyMessage}
                                onChange={(e) => setSupportReplyMessage(e.target.value)}
                                placeholder="Write your response for the user..."
                                className="bg-[#111827] border-white/10 text-white"
                              />
                              <Input
                                type="file"
                                accept="image/*,.pdf"
                                onChange={(e) => { void handleSupportAttachmentChange(e); }}
                                className="bg-[#111827] border-white/10 text-white file:text-white"
                              />
                              {supportReplyAttachment && (
                                <p className="text-xs text-emerald-400">Attachment ready: {supportReplyAttachment.file_name}</p>
                              )}
                              <div className="flex flex-col sm:flex-row gap-2">
                                <Button onClick={handleSupportReply} className="bg-[#118bdd] hover:bg-[#0f79be] text-white">
                                  Reply to User
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={async () => {
                                    setSupportStatusDraft('closed');
                                    try {
                                      const closed = await Database.commitCriticalAction(() => Database.updateSupportTicketStatus(selectedSupportTicket.ticket_id, 'closed'));
                                      if (!closed) {
                                        toast.error('Failed to close ticket');
                                        return;
                                      }
                                      loadSupportTickets();
                                      toast.success('Ticket closed');
                                    } catch (error) {
                                      toast.error(error instanceof Error ? error.message : 'Failed to close ticket');
                                    }
                                  }}
                                  className="border-red-500/40 text-red-300 hover:bg-red-500/10"
                                >
                                  Close Ticket
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Reports Tab */}
          <TabsContent value="reports">
            <Card className="glass border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-[#118bdd]" />
                  Advanced Reports & Filters
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-2">
                  <Button
                    variant="outline"
                    className="border-amber-400/40 text-amber-300 hover:bg-amber-400/10"
                    onClick={() => {
                      const result = Database.repairGhostReceiveHelpTransactions();
                      if (result.repaired > 0) {
                        toast.success(`Repaired ${result.repaired} ghost receive-help record(s) across ${result.affectedUsers} user(s).`);
                        loadAllTransactions();
                        loadStats();
                        setGhostRepairLogTick((tick) => tick + 1);
                      } else {
                        toast.success('No ghost receive-help records found.');
                      }
                    }}
                  >
                    Repair Ghost Receive-Help
                  </Button>
                  <Button
                    variant="outline"
                    className="border-cyan-400/40 text-cyan-300 hover:bg-cyan-400/10"
                    onClick={() => {
                      const result = Database.backfillReceiveHelpSenderIds();
                      if (result.updated > 0) {
                        toast.success(`Updated ${result.updated} receive-help record(s) with missing sender IDs.`);
                        loadAllTransactions();
                      } else {
                        toast.success('No receive-help records needed sender backfill.');
                      }
                    }}
                  >
                    Backfill Sender IDs
                  </Button>
                  <p className="text-xs text-white/40">
                    Removes receive-help entries missing a valid sender and recalculates affected wallets/locks.
                  </p>
                </div>
                {!reportsDataLoaded && (
                  <div className="mb-4 rounded-lg border border-[#118bdd]/30 bg-[#118bdd]/10 px-3 py-2 text-sm text-[#a7dcff]">
                    Loading transaction data for reports...
                  </div>
                )}
                <div className="mb-6 rounded-lg border border-white/10 bg-[#141c2a] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-white font-semibold">Ghost Receive-Help Repair Log</h4>
                    <span className="text-xs text-white/40">{ghostRepairLogs.length} record(s)</span>
                  </div>
                  {ghostRepairLogs.length === 0 ? (
                    <p className="text-sm text-white/50">No repairs recorded yet.</p>
                  ) : (
                    <div className="overflow-x-auto admin-table-scroll">
                      <table className="w-full admin-table">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 px-3 text-white/60 min-w-[170px]">Date & Time</th>
                            <th className="text-left py-2 px-3 text-white/60">User ID</th>
                            <th className="text-left py-2 px-3 text-white/60">User Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Amount</th>
                            <th className="text-left py-2 px-3 text-white/60">Reason</th>
                            <th className="text-left py-2 px-3 text-white/60">Tx ID</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ghostRepairLogs.slice(0, 50).map((log) => {
                            const user = userById.get(log.userId);
                            return (
                              <tr key={log.id} className="border-b border-white/5">
                                <td className="py-2 px-3 text-white/60 whitespace-nowrap">{formatDate(log.createdAt)}</td>
                                <td className="py-2 px-3 text-[#118bdd] font-mono">{log.userPublicId || user?.userId || '-'}</td>
                                <td className="py-2 px-3 text-white">{user?.fullName || '-'}</td>
                                <td className="py-2 px-3 text-amber-400">{formatCurrency(log.amount)}</td>
                                <td className="py-2 px-3 text-white/60">{log.reason}</td>
                                <td className="py-2 px-3 text-white/40 font-mono text-xs" title={log.txId}>{log.txId}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {ghostRepairLogs.length > 50 && (
                        <p className="text-xs text-white/40 mt-2">Showing latest 50 repairs.</p>
                      )}
                    </div>
                  )}
                </div>
                <Tabs value={reportTab} onValueChange={setReportTab} className="space-y-4">
                  <TabsList className="bg-[#1f2937] border border-white/10 flex-wrap h-auto">
                    <TabsTrigger value="member-report" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Member Report</TabsTrigger>
                    <TabsTrigger value="receive-help" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Receive Help</TabsTrigger>
                    <TabsTrigger value="give-help" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Give Help</TabsTrigger>
                    <TabsTrigger value="deposit-report" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Deposit Report</TabsTrigger>
                    <TabsTrigger value="withdrawal-report" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Withdrawal Report</TabsTrigger>
                    <TabsTrigger value="locked-income" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Locked Income</TabsTrigger>
                    <TabsTrigger value="offer-achievers" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Offer Achievers</TabsTrigger>
                    <TabsTrigger value="all-level" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">All Level Report</TabsTrigger>
                    <TabsTrigger value="safety-pool" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Safety Pool</TabsTrigger>
                  </TabsList>

                  <TabsContent value="member-report" className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                      <Input type="date" value={memberFilters.dateFrom} onChange={(e) => setMemberFilters({ ...memberFilters, dateFrom: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input type="date" value={memberFilters.dateTo} onChange={(e) => setMemberFilters({ ...memberFilters, dateTo: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="User ID" value={memberFilters.userId} onChange={(e) => setMemberFilters({ ...memberFilters, userId: e.target.value.replace(/\D/g, '').slice(0, 7) })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Name" value={memberFilters.name} onChange={(e) => setMemberFilters({ ...memberFilters, name: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Sponsor ID" value={memberFilters.sponsorId} onChange={(e) => setMemberFilters({ ...memberFilters, sponsorId: e.target.value.replace(/\D/g, '').slice(0, 7) })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Sponsor Name" value={memberFilters.sponsorName} onChange={(e) => setMemberFilters({ ...memberFilters, sponsorName: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Level" type="number" min={0} max={10} value={memberFilters.level} onChange={(e) => setMemberFilters({ ...memberFilters, level: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <select value={memberFilters.offer} onChange={(e) => setMemberFilters({ ...memberFilters, offer: e.target.value })} className="px-3 h-10 bg-[#1f2937] border border-white/10 rounded-md text-white">
                        <option value="">All Offers</option>
                        <option value="National Tour Achiever">National Tour Achiever</option>
                        <option value="International Tour Achiever">International Tour Achiever</option>
                        <option value="International Family Tour Achiever">International Family Tour Achiever</option>
                      </select>
                      <select value={memberFilters.blockStatus} onChange={(e) => setMemberFilters({ ...memberFilters, blockStatus: e.target.value })} className="px-3 h-10 bg-[#1f2937] border border-white/10 rounded-md text-white">
                        <option value="">All Status</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="temp_blocked">Temp Blocked</option>
                        <option value="permanent_blocked">Permanent Blocked</option>
                      </select>
                    </div>
                    <div className="overflow-x-auto admin-table-scroll">
                      <table className="w-full admin-table">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 px-3 text-white/60">ID</th>
                            <th className="text-left py-2 px-3 text-white/60">Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Mobile</th>
                            <th className="text-left py-2 px-3 text-white/60">Sponsor Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Current Level</th>
                            <th className="text-left py-2 px-3 text-white/60">Qualified Level</th>
                            <th className="text-left py-2 px-3 text-white/60">Offer</th>
                            <th className="text-left py-2 px-3 text-white/60">Status</th>
                            <th className="text-left py-2 px-3 text-white/60 min-w-[170px]">Date & Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {memberReportRows.slice(0, 200).map((r) => (
                            <tr key={r.id} className="border-b border-white/5">
                              <td className="py-2 px-3 text-[#118bdd] font-mono">{r.userId}</td>
                              <td className="py-2 px-3 text-white">{r.name}</td>
                              <td className="py-2 px-3 text-white/60">{r.mobile}</td>
                              <td className="py-2 px-3 text-white/60">{r.sponsorName}</td>
                              <td className="py-2 px-3 text-white/60 whitespace-nowrap">{r.currentLevelDisplay}</td>
                              <td className="py-2 px-3 text-white/60">L{r.qualifiedLevel}</td>
                              <td className="py-2 px-3 text-white/60">{r.achievedOffer}</td>
                              <td className="py-2 px-3 text-white/60">{r.blockStatus}</td>
                              <td className="py-2 px-3 text-white/60 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {memberReportRows.length === 0 && <p className="text-center text-white/50 py-6">No matching members</p>}
                    </div>
                  </TabsContent>

                  <TabsContent value="receive-help" className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
                      <Input type="date" value={receiveFilters.dateFrom} onChange={(e) => setReceiveFilters({ ...receiveFilters, dateFrom: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input type="date" value={receiveFilters.dateTo} onChange={(e) => setReceiveFilters({ ...receiveFilters, dateTo: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="User ID" value={receiveFilters.userId} onChange={(e) => setReceiveFilters({ ...receiveFilters, userId: e.target.value.replace(/\D/g, '').slice(0, 7) })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="User Name" value={receiveFilters.userName} onChange={(e) => setReceiveFilters({ ...receiveFilters, userName: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Level" type="number" min={1} max={10} value={receiveFilters.level} onChange={(e) => setReceiveFilters({ ...receiveFilters, level: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Min Amount" type="number" value={receiveFilters.amountMin} onChange={(e) => setReceiveFilters({ ...receiveFilters, amountMin: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Max Amount" type="number" value={receiveFilters.amountMax} onChange={(e) => setReceiveFilters({ ...receiveFilters, amountMax: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                    </div>
                    <div className="overflow-x-auto admin-table-scroll">
                      <table className="w-full admin-table">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 px-3 text-white/60 min-w-[170px]">Date & Time</th>
                            <th className="text-left py-2 px-3 text-white/60">ID</th>
                            <th className="text-left py-2 px-3 text-white/60">User Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Received Help</th>
                            <th className="text-left py-2 px-3 text-white/60">From Level</th>
                            <th className="text-left py-2 px-3 text-white/60">Received From ID</th>
                            <th className="text-left py-2 px-3 text-white/60">Received From User Name</th>
                          </tr>
                        </thead>
                        <tbody>
                          {receiveHelpReportRows.slice(0, 300).map((r) => (
                            <tr key={r.id} className="border-b border-white/5">
                              <td className="py-2 px-3 text-white/60 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                              <td className="py-2 px-3 text-[#118bdd] font-mono">{r.userId}</td>
                              <td className="py-2 px-3 text-white">{r.userName}</td>
                              <td className="py-2 px-3 text-emerald-400">{formatCurrency(r.amount)}</td>
                              <td className="py-2 px-3 text-white/60">{r.level}</td>
                              <td className="py-2 px-3 text-white/60 font-mono">{r.fromUserId}</td>
                              <td className="py-2 px-3 text-white/60">{r.fromUserName}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {receiveHelpReportRows.length === 0 && <p className="text-center text-white/50 py-6">No matching receive-help records</p>}
                    </div>
                  </TabsContent>

                  <TabsContent value="give-help" className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
                      <Input type="date" value={giveFilters.dateFrom} onChange={(e) => setGiveFilters({ ...giveFilters, dateFrom: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input type="date" value={giveFilters.dateTo} onChange={(e) => setGiveFilters({ ...giveFilters, dateTo: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="User ID" value={giveFilters.userId} onChange={(e) => setGiveFilters({ ...giveFilters, userId: e.target.value.replace(/\D/g, '').slice(0, 7) })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="User Name" value={giveFilters.userName} onChange={(e) => setGiveFilters({ ...giveFilters, userName: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Min Amount" type="number" value={giveFilters.amountMin} onChange={(e) => setGiveFilters({ ...giveFilters, amountMin: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Max Amount" type="number" value={giveFilters.amountMax} onChange={(e) => setGiveFilters({ ...giveFilters, amountMax: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                    </div>
                    <div className="overflow-x-auto admin-table-scroll">
                      <table className="w-full admin-table">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 px-3 text-white/60 min-w-[170px]">Date & Time</th>
                            <th className="text-left py-2 px-3 text-white/60">ID</th>
                            <th className="text-left py-2 px-3 text-white/60">User Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Give Help</th>
                            <th className="text-left py-2 px-3 text-white/60">Level</th>
                            <th className="text-left py-2 px-3 text-white/60">Give to ID</th>
                            <th className="text-left py-2 px-3 text-white/60">Give to User Name</th>
                          </tr>
                        </thead>
                        <tbody>
                          {giveHelpReportRows.slice(0, 300).map((r) => (
                            <tr key={r.id} className="border-b border-white/5">
                              <td className="py-2 px-3 text-white/60 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                              <td className="py-2 px-3 text-[#118bdd] font-mono">{r.userId}</td>
                              <td className="py-2 px-3 text-white">{r.userName}</td>
                              <td className="py-2 px-3 text-orange-400">{formatCurrency(r.amount)}</td>
                              <td className="py-2 px-3 text-white/60">{r.level || '-'}</td>
                              <td className="py-2 px-3 text-white/60">{r.giveToId}</td>
                              <td className="py-2 px-3 text-white/60">{r.giveToUserName}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {giveHelpReportRows.length === 0 && <p className="text-center text-white/50 py-6">No matching give-help records</p>}
                    </div>
                  </TabsContent>

                  <TabsContent value="deposit-report" className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                      <Input type="date" value={depositReportFilters.dateFrom} onChange={(e) => setDepositReportFilters({ ...depositReportFilters, dateFrom: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input type="date" value={depositReportFilters.dateTo} onChange={(e) => setDepositReportFilters({ ...depositReportFilters, dateTo: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="User ID" value={depositReportFilters.userId} onChange={(e) => setDepositReportFilters({ ...depositReportFilters, userId: e.target.value.replace(/\D/g, '').slice(0, 7) })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="User Name" value={depositReportFilters.userName} onChange={(e) => setDepositReportFilters({ ...depositReportFilters, userName: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <select value={depositReportFilters.status} onChange={(e) => setDepositReportFilters({ ...depositReportFilters, status: e.target.value })} className="px-3 h-10 bg-[#1f2937] border border-white/10 rounded-md text-white">
                        <option value="">All Status</option>
                        <option value="completed">Completed</option>
                        <option value="pending">Pending</option>
                        <option value="failed">Rejected</option>
                        <option value="reversed">Reversed</option>
                      </select>
                    </div>
                    <div className="overflow-x-auto admin-table-scroll">
                      <table className="w-full admin-table">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 px-3 text-white/60 min-w-[170px]">Date & Time</th>
                            <th className="text-left py-2 px-3 text-white/60">User ID</th>
                            <th className="text-left py-2 px-3 text-white/60">User Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Amount</th>
                            <th className="text-left py-2 px-3 text-white/60">Method</th>
                            <th className="text-left py-2 px-3 text-white/60">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {depositReportRows.slice(0, 300).map((r) => (
                            <tr key={r.id} className="border-b border-white/5">
                              <td className="py-2 px-3 text-white/60 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                              <td className="py-2 px-3 text-[#118bdd] font-mono">{r.userId}</td>
                              <td className="py-2 px-3 text-white">{r.userName}</td>
                              <td className="py-2 px-3 text-emerald-400 font-medium">{formatCurrency(r.amount)}</td>
                              <td className="py-2 px-3 text-white/60">{r.method}</td>
                              <td className="py-2 px-3">
                                <Badge className={
                                  r.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
                                    r.status === 'pending' ? 'bg-amber-500/20 text-amber-400' :
                                      r.status === 'reversed' ? 'bg-purple-500/20 text-purple-300' :
                                        'bg-red-500/20 text-red-400'
                                }>
                                  {r.status}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {depositReportRows.length === 0 && <p className="text-center text-white/50 py-6">No matching deposit records</p>}
                    </div>
                  </TabsContent>

                  <TabsContent value="withdrawal-report" className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                      <Input type="date" value={withdrawalReportFilters.dateFrom} onChange={(e) => setWithdrawalReportFilters({ ...withdrawalReportFilters, dateFrom: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input type="date" value={withdrawalReportFilters.dateTo} onChange={(e) => setWithdrawalReportFilters({ ...withdrawalReportFilters, dateTo: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="User ID" value={withdrawalReportFilters.userId} onChange={(e) => setWithdrawalReportFilters({ ...withdrawalReportFilters, userId: e.target.value.replace(/\D/g, '').slice(0, 7) })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="User Name" value={withdrawalReportFilters.userName} onChange={(e) => setWithdrawalReportFilters({ ...withdrawalReportFilters, userName: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <select value={withdrawalReportFilters.status} onChange={(e) => setWithdrawalReportFilters({ ...withdrawalReportFilters, status: e.target.value })} className="px-3 h-10 bg-[#1f2937] border border-white/10 rounded-md text-white">
                        <option value="">All Status</option>
                        <option value="completed">Completed</option>
                        <option value="pending">Pending</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>
                    <div className="overflow-x-auto admin-table-scroll">
                      <table className="w-full admin-table">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 px-3 text-white/60 min-w-[170px]">Date & Time</th>
                            <th className="text-left py-2 px-3 text-white/60">User ID</th>
                            <th className="text-left py-2 px-3 text-white/60">User Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Amount</th>
                            <th className="text-left py-2 px-3 text-white/60">Status</th>
                            <th className="text-left py-2 px-3 text-white/60">Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {withdrawalReportRows.slice(0, 300).map((r) => (
                            <tr key={r.id} className="border-b border-white/5">
                              <td className="py-2 px-3 text-white/60 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                              <td className="py-2 px-3 text-[#118bdd] font-mono">{r.userId}</td>
                              <td className="py-2 px-3 text-white">{r.userName}</td>
                              <td className="py-2 px-3 text-rose-400 font-medium">{formatCurrency(r.amount)}</td>
                              <td className="py-2 px-3">
                                <Badge className={
                                  r.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
                                    r.status === 'pending' ? 'bg-amber-500/20 text-amber-400' :
                                      'bg-red-500/20 text-red-400'
                                }>
                                  {r.status}
                                </Badge>
                              </td>
                              <td className="py-2 px-3 text-white/60 text-sm">{getVisibleTransactionDescription(r.description)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {withdrawalReportRows.length === 0 && <p className="text-center text-white/50 py-6">No matching withdrawal records</p>}
                    </div>
                  </TabsContent>

                  <TabsContent value="locked-income" className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      <Input placeholder="User ID" value={lockedIncomeFilters.userId} onChange={(e) => setLockedIncomeFilters({ ...lockedIncomeFilters, userId: e.target.value.replace(/\D/g, '').slice(0, 7) })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="User Name" value={lockedIncomeFilters.name} onChange={(e) => setLockedIncomeFilters({ ...lockedIncomeFilters, name: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Min Amount" type="number" value={lockedIncomeFilters.minAmount} onChange={(e) => setLockedIncomeFilters({ ...lockedIncomeFilters, minAmount: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                    </div>
                    <div className="overflow-x-auto admin-table-scroll">
                      <table className="w-full admin-table">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 px-3 text-white/60">User ID</th>
                            <th className="text-left py-2 px-3 text-white/60">User Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Locked Amount</th>
                            <th className="text-left py-2 px-3 text-white/60">Current Level</th>
                            <th className="text-left py-2 px-3 text-white/60">Direct Count</th>
                            <th className="text-left py-2 px-3 text-white/60">Required for Next Level</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lockedIncomeRows.slice(0, 300).map((r) => (
                            <tr key={r.userId} className="border-b border-white/5">
                              <td className="py-2 px-3 text-[#118bdd] font-mono">{r.userId}</td>
                              <td className="py-2 px-3 text-white">{r.name}</td>
                              <td className="py-2 px-3 text-cyan-400 font-medium">{formatCurrency(r.lockedAmount)}</td>
                              <td className="py-2 px-3"><Badge className="bg-purple-500/20 text-purple-400">Level {r.currentLevel}</Badge></td>
                              <td className="py-2 px-3 text-white/60">{r.directCount}</td>
                              <td className="py-2 px-3 text-white/60">{r.requiredDirect}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {lockedIncomeRows.length === 0 && <p className="text-center text-white/50 py-6">No users with locked income found</p>}
                    </div>
                  </TabsContent>

                  <TabsContent value="offer-achievers" className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
                      <Input type="date" value={offerFilters.dateFrom} onChange={(e) => setOfferFilters({ ...offerFilters, dateFrom: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input type="date" value={offerFilters.dateTo} onChange={(e) => setOfferFilters({ ...offerFilters, dateTo: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="User ID" value={offerFilters.userId} onChange={(e) => setOfferFilters({ ...offerFilters, userId: e.target.value.replace(/\D/g, '').slice(0, 7) })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Name" value={offerFilters.name} onChange={(e) => setOfferFilters({ ...offerFilters, name: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Qualified Level" type="number" min={1} max={10} value={offerFilters.level} onChange={(e) => setOfferFilters({ ...offerFilters, level: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <select value={offerFilters.offer} onChange={(e) => setOfferFilters({ ...offerFilters, offer: e.target.value })} className="px-3 h-10 bg-[#1f2937] border border-white/10 rounded-md text-white">
                        <option value="">All Offers</option>
                        <option value="National Tour Achiever">National Tour Achiever</option>
                        <option value="International Tour Achiever">International Tour Achiever</option>
                        <option value="International Family Tour Achiever">International Family Tour Achiever</option>
                      </select>
                      <Input placeholder="Sponsor ID" value={offerFilters.sponsorId} onChange={(e) => setOfferFilters({ ...offerFilters, sponsorId: e.target.value.replace(/\D/g, '').slice(0, 7) })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Sponsor Name" value={offerFilters.sponsorName} onChange={(e) => setOfferFilters({ ...offerFilters, sponsorName: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                    </div>
                    <div className="overflow-x-auto admin-table-scroll">
                      <table className="w-full admin-table">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 px-3 text-white/60 min-w-[170px]">Date</th>
                            <th className="text-left py-2 px-3 text-white/60">ID</th>
                            <th className="text-left py-2 px-3 text-white/60">Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Mobile</th>
                            <th className="text-left py-2 px-3 text-white/60">Qualified Level</th>
                            <th className="text-left py-2 px-3 text-white/60">Offer</th>
                            <th className="text-left py-2 px-3 text-white/60">Sponsor ID</th>
                            <th className="text-left py-2 px-3 text-white/60">Sponsor Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Sponsor Mobile</th>
                          </tr>
                        </thead>
                        <tbody>
                          {offerAchieverRows.slice(0, 200).map((r, index) => (
                            <tr key={index} className="border-b border-white/5">
                              <td className="py-2 px-3 text-white/60 whitespace-nowrap">{formatDate(r.achievedAt)}</td>
                              <td className="py-2 px-3 text-[#118bdd] font-mono">{r.userId}</td>
                              <td className="py-2 px-3 text-white">{r.name}</td>
                              <td className="py-2 px-3 text-white/60">{r.mobile}</td>
                              <td className="py-2 px-3 text-white/60">L{r.qualifiedLevel}</td>
                              <td className="py-2 px-3 text-white/60">{r.offerAchieved}</td>
                              <td className="py-2 px-3 text-white/60">{r.sponsorId}</td>
                              <td className="py-2 px-3 text-white/60">{r.sponsorName}</td>
                              <td className="py-2 px-3 text-white/60">{r.sponsorMobile}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {offerAchieverRows.length === 0 && <p className="text-center text-white/50 py-6">No offer achievers found for selected filters</p>}
                    </div>
                  </TabsContent>

                  <TabsContent value="all-level" className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
                      <select value={reportLevel} onChange={(e) => setReportLevel(e.target.value)} className="px-3 h-10 bg-[#1f2937] border border-white/10 rounded-md text-white">
                        <option value="">All Levels</option>
                        {Array.from({ length: 10 }, (_, i) => i + 1).map(level => (
                          <option key={level} value={level}>Level {level}</option>
                        ))}
                      </select>
                      <Input type="date" value={allLevelFilters.dateFrom} onChange={(e) => setAllLevelFilters({ ...allLevelFilters, dateFrom: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input type="date" value={allLevelFilters.dateTo} onChange={(e) => setAllLevelFilters({ ...allLevelFilters, dateTo: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="User ID" value={allLevelFilters.userId} onChange={(e) => setAllLevelFilters({ ...allLevelFilters, userId: e.target.value.replace(/\D/g, '').slice(0, 7) })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Name" value={allLevelFilters.name} onChange={(e) => setAllLevelFilters({ ...allLevelFilters, name: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Sponsor ID" value={allLevelFilters.sponsorId} onChange={(e) => setAllLevelFilters({ ...allLevelFilters, sponsorId: e.target.value.replace(/\D/g, '').slice(0, 7) })} className="bg-[#1f2937] border-white/10 text-white" />
                    </div>
                    <Button onClick={generateLevelReport} className="btn-primary">
                      <BarChart3 className="w-4 h-4 mr-2" />
                      Generate Level Report
                    </Button>
                    <div className="overflow-x-auto admin-table-scroll">
                      <table className="w-full admin-table">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 px-3 text-white/60">Level</th>
                            <th className="text-left py-2 px-3 text-white/60">User Id</th>
                            <th className="text-left py-2 px-3 text-white/60">Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Give help</th>
                            <th className="text-left py-2 px-3 text-white/60">Received Help</th>
                            <th className="text-left py-2 px-3 text-white/60">Direct Refer Income</th>
                            <th className="text-left py-2 px-3 text-white/60">Income wallet</th>
                            <th className="text-left py-2 px-3 text-white/60">Total Earning</th>
                            <th className="text-left py-2 px-3 text-white/60">Locked help</th>
                            <th className="text-left py-2 px-3 text-white/60">Qualified</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLevelReport.slice(0, 300).map((row, index) => (
                            <tr key={`${row.userId}_${index}`} className="border-b border-white/5">
                              <td className="py-2 px-3"><Badge className="bg-[#118bdd]/20 text-[#118bdd]">{row.levelFilledText || `Level ${row.level}`}</Badge></td>
                              <td className="py-2 px-3 text-[#118bdd] font-mono">{row.userId}</td>
                              <td className="py-2 px-3 text-white">{row.fullName}</td>
                              <td className="py-2 px-3 text-orange-400">{formatCurrency(row.giveHelpAmount)}</td>
                              <td className="py-2 px-3 text-emerald-400">{formatCurrency(row.receiveHelpAmount)}</td>
                              <td className="py-2 px-3 text-white/60">{formatCurrency(row.directReferralIncome)}</td>
                              <td className="py-2 px-3 text-white/60">{formatCurrency(row.incomeWallet)}</td>
                              <td className="py-2 px-3 text-white/60">{formatCurrency(row.totalEarning)}</td>
                              <td className="py-2 px-3 text-white/60">{formatCurrency(row.lockedHelp)}</td>
                              <td className="py-2 px-3 text-white/60">L{row.qualifiedLevel}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {filteredLevelReport.length === 0 && <p className="text-center text-white/50 py-6">Generate report and apply filters to view data</p>}
                    </div>
                  </TabsContent>

                  <TabsContent value="safety-pool" className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                      <Input type="date" value={safetyPoolFilters.dateFrom} onChange={(e) => setSafetyPoolFilters({ ...safetyPoolFilters, dateFrom: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input type="date" value={safetyPoolFilters.dateTo} onChange={(e) => setSafetyPoolFilters({ ...safetyPoolFilters, dateTo: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="User ID" value={safetyPoolFilters.userId} onChange={(e) => setSafetyPoolFilters({ ...safetyPoolFilters, userId: e.target.value.replace(/\D/g, '').slice(0, 7) })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Reason" value={safetyPoolFilters.reason} onChange={(e) => setSafetyPoolFilters({ ...safetyPoolFilters, reason: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                    </div>
                    <div className="p-3 rounded-lg bg-[#1f2937] border border-white/10">
                      <p className="text-sm text-white/60">Current Safety Pool Balance</p>
                      <p className="text-xl font-bold text-amber-400">{formatCurrency(safetyPoolAmount)}</p>
                    </div>
                    <div className="overflow-x-auto admin-table-scroll">
                      <table className="w-full admin-table">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 px-3 text-white/60 min-w-[170px]">Date & Time</th>
                            <th className="text-left py-2 px-3 text-white/60">From ID</th>
                            <th className="text-left py-2 px-3 text-white/60">From User</th>
                            <th className="text-left py-2 px-3 text-white/60">Amount</th>
                            <th className="text-left py-2 px-3 text-white/60">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {safetyPoolRows.slice(0, 300).map((r) => (
                            <tr key={r.id} className="border-b border-white/5">
                              <td className="py-2 px-3 text-white/60 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                              <td className="py-2 px-3 text-[#118bdd] font-mono">{r.userId}</td>
                              <td className="py-2 px-3 text-white">{r.userName}</td>
                              <td className={`py-2 px-3 ${r.amount < 0 ? 'text-red-400' : 'text-amber-400'}`}>{formatCurrency(r.amount)}</td>
                              <td className="py-2 px-3 text-white/60">{r.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {safetyPoolRows.length === 0 && <p className="text-center text-white/50 py-6">No safety pool records found</p>}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Matrix Table Tab */}
          <TabsContent value="matrix">
            <Card className="glass border-white/10">
              <CardHeader>
                <CardTitle className="text-white">Help Distribution Table</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto admin-table-scroll">
                  <table className="w-full admin-table">
                    <thead>
                      <tr className="bg-[#1f2937]">
                        <th className="text-left py-4 px-6 text-white/60 font-medium">Level</th>
                        <th className="text-left py-4 px-6 text-white/60 font-medium">Users</th>
                        <th className="text-left py-4 px-6 text-white/60 font-medium">Per User Help</th>
                        <th className="text-left py-4 px-6 text-white/60 font-medium">Total Receive Help</th>
                        <th className="text-left py-4 px-6 text-white/60 font-medium">Give Help</th>
                        <th className="text-left py-4 px-6 text-white/60 font-medium">Net Balance</th>
                        <th className="text-left py-4 px-6 text-white/60 font-medium">New Direct Required</th>
                        <th className="text-left py-4 px-6 text-white/60 font-medium">Total Direct Required</th>
                      </tr>
                    </thead>
                    <tbody>
                      {helpDistributionTable.map((row) => (
                        <tr key={row.level} className="border-b border-white/5 hover:bg-white/5">
                          <td className="py-4 px-6">
                            <Badge className="bg-[#118bdd]/20 text-[#118bdd]">Level {row.level}</Badge>
                          </td>
                          <td className="py-4 px-6 text-white">{row.users.toLocaleString()}</td>
                          <td className="py-4 px-6 text-white">{formatCurrency(row.perUserHelp)}</td>
                          <td className="py-4 px-6 text-emerald-400">{formatCurrency(row.totalReceiveHelp)}</td>
                          <td className="py-4 px-6 text-orange-400">{formatCurrency(row.giveHelp)}</td>
                          <td className="py-4 px-6 text-purple-400 font-bold">{formatCurrency(row.netBalance)}</td>
                          <td className="py-4 px-6 text-white/60">{row.directRequired === 0 ? '0' : `+${row.directRequired}`}</td>
                          <td className="py-4 px-6 text-white/60">{Database.getCumulativeDirectRequired(row.level)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings">
            <Card className="glass border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Settings className="w-5 h-5 text-[#118bdd]" />
                  System Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-white/80">PIN Amount ($)</Label>
                    <Input
                      type="number"
                      value={settings.pinAmount}
                      onChange={(e) => handleUpdateSettings('pinAmount', parseFloat(e.target.value))}
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-white/80">Withdrawal Fee (%)</Label>
                    <Input
                      type="number"
                      value={settings.withdrawalFeePercent}
                      onChange={(e) => handleUpdateSettings('withdrawalFeePercent', parseFloat(e.target.value))}
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-white/80">Deposit Processing (Hours)</Label>
                    <Input
                      type="number"
                      value={settings.depositProcessingHours}
                      onChange={(e) => handleUpdateSettings('depositProcessingHours', parseFloat(e.target.value))}
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-white/80">Withdrawal Processing (Hours)</Label>
                    <Input
                      type="number"
                      value={settings.withdrawalProcessingHours}
                      onChange={(e) => handleUpdateSettings('withdrawalProcessingHours', parseFloat(e.target.value))}
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-white/80">Grace Period (Hours)</Label>
                    <Input
                      type="number"
                      value={settings.gracePeriodHours}
                      onChange={(e) => handleUpdateSettings('gracePeriodHours', parseFloat(e.target.value))}
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-white/80">Max Levels</Label>
                    <Input
                      type="number"
                      value={settings.maxLevels}
                      onChange={(e) => handleUpdateSettings('maxLevels', parseInt(e.target.value))}
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-white/80">Matrix View Max Levels</Label>
                    <Input
                      type="number"
                      value={settings.matrixViewMaxLevels}
                      onChange={(e) => handleUpdateSettings('matrixViewMaxLevels', parseInt(e.target.value))}
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label className="text-white/80">Master Password</Label>
                    <Input
                      type="password"
                      value={settings.masterPassword}
                      onChange={(e) => handleUpdateSettings('masterPassword', e.target.value)}
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                    <p className="text-xs text-white/40">Used for admin to login as any user</p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-lg bg-[#1f2937]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="checkbox"
                      checked={settings.reEntryEnabled}
                      onChange={(e) => handleUpdateSettings('reEntryEnabled', e.target.checked)}
                      className="w-4 h-4 rounded border-white/20"
                    />
                    <Label className="text-white/80 mb-0">Enable Re-Entry System</Label>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-lg bg-[#1f2937]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="checkbox"
                      checked={settings.safetyPoolEnabled}
                      onChange={(e) => handleUpdateSettings('safetyPoolEnabled', e.target.checked)}
                      className="w-4 h-4 rounded border-white/20"
                    />
                    <Label className="text-white/80 mb-0">Enable Safety Pool</Label>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-lg bg-[#1f2937]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="checkbox"
                      checked={settings.marketplaceEnabled}
                      onChange={(e) => handleUpdateSettings('marketplaceEnabled', e.target.checked)}
                      className="w-4 h-4 rounded border-white/20"
                    />
                    <Label className="text-white/80 mb-0">Enable Marketplace (show to users)</Label>
                  </div>
                  <div className="flex flex-1 flex-col sm:flex-row sm:items-center gap-3 text-xs text-white/50">
                    <p className="sm:flex-1">
                      Toggle off to show a "Coming Soon" banner on the marketplace page.
                    </p>
                    <Button
                      type="button"
                      className="px-3 py-2 bg-white/5 border border-white/15 text-white hover:bg-white/10"
                      onClick={() => navigate('/e-commerce?preview=admin')}
                    >
                      Open user preview
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-lg bg-[#1f2937]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="checkbox"
                      checked={settings.requireOtpForTransactions}
                      onChange={(e) => handleUpdateSettings('requireOtpForTransactions', e.target.checked)}
                      className="w-4 h-4 rounded border-white/20"
                    />
                    <Label className="text-white/80 mb-0">Require OTP for Transactions</Label>
                  </div>
                </div>

                <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 space-y-3">
                  <div>
                    <p className="text-red-300 font-semibold">Danger Zone</p>
                    <p className="text-xs text-red-200/80 mt-1">
                      Deletes all non-admin IDs and resets matrix/wallet/transactions. This action is irreversible.
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      resetDeleteAllIdsConfirmation();
                      setShowDeleteAllIdsDialog(true);
                    }}
                    variant="destructive"
                    className="bg-red-600 hover:bg-red-700"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Delete All IDs
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Marketplace Tab */}
          <TabsContent value="marketplace">
            <Card className="glass border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-[#118bdd]" />
                  Marketplace Management
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Sub-tabs */}
                <div className="flex gap-2 flex-wrap">
                  {(['retailers', 'categories', 'banners', 'deals', 'invoices', 'redemptions'] as const).map(tab => (
                    <Button
                      key={tab}
                      variant={mktSubTab === tab ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => { setMktSubTab(tab); setMktShowForm(false); setMktEditingBanner(null); setMktEditingDeal(null); setMktEditingCategory(null); setMktEditingRetailer(null); }}
                      className={mktSubTab === tab ? 'bg-[#118bdd]' : 'border-white/20 text-white/70 hover:text-white'}
                    >
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </Button>
                  ))}
                </div>

                {/* === RETAILERS SUB-TAB === */}
                {mktSubTab === 'retailers' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-white/80 text-sm font-medium">Retailers ({marketplaceRetailers.length})</h3>
                      <Button size="sm" className="bg-[#118bdd]" onClick={() => { setMktEditingRetailer(null); setMktShowForm(true); }}>
                        <Plus className="w-4 h-4 mr-1" /> Add Retailer
                      </Button>
                    </div>
                    {mktShowForm && (
                      <MarketplaceRetailerForm
                        retailer={mktEditingRetailer}
                        categories={marketplaceCategories}
                        onSave={async (data) => {
                          const successMessage = mktEditingRetailer ? 'Retailer updated' : 'Retailer added';
                          setMktShowForm(false);
                          setMktEditingRetailer(null);
                          await syncMarketplaceChanges(() => {
                            if (mktEditingRetailer) {
                              Database.updateMarketplaceRetailer(mktEditingRetailer.id, data);
                            } else {
                              Database.createMarketplaceRetailer(data as Omit<MarketplaceRetailer, 'id'>);
                            }
                          }, successMessage);
                        }}
                        onCancel={() => { setMktShowForm(false); setMktEditingRetailer(null); }}
                      />
                    )}
                    <div className="space-y-2">
                      {marketplaceRetailers
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map(r => (
                        <div key={r.id} className="flex items-center justify-between p-3 bg-[#1f2937] rounded-lg border border-white/10">
                          <div className="flex items-center gap-3">
                            {r.logoUrl ? (
                              <img src={r.logoUrl} alt={r.name} className="w-10 h-10 rounded-lg object-cover" />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-[#118bdd]/20 flex items-center justify-center text-[#118bdd] font-bold text-sm">{r.name.charAt(0)}</div>
                            )}
                            <div>
                              <div className="text-white text-sm font-medium">{r.name}</div>
                              <div className="text-white/50 text-xs">{r.discountText || `${r.discountPercent}% off`} · {marketplaceCategories.find(c => c.id === r.categoryId)?.name || 'No category'}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {r.isTopRetailer && <Badge className="bg-amber-500/20 text-amber-400 text-xs">Top</Badge>}
                            <Badge className={r.isActive ? 'bg-green-500/20 text-green-400 text-xs' : 'bg-red-500/20 text-red-400 text-xs'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>
                            <Button size="sm" variant="ghost" className="text-white/50 hover:text-white h-8 w-8 p-0" onClick={() => { setMktEditingRetailer(r); setMktShowForm(true); }}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 h-8 w-8 p-0" onClick={async () => { await syncMarketplaceChanges(() => Database.deleteMarketplaceRetailer(r.id), 'Retailer deleted'); }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      {marketplaceRetailers.length === 0 && <p className="text-white/40 text-sm text-center py-4">No retailers added yet</p>}
                    </div>
                  </div>
                )}

                {/* === CATEGORIES SUB-TAB === */}
                {mktSubTab === 'categories' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-white/80 text-sm font-medium">Categories ({marketplaceCategories.length})</h3>
                      <Button size="sm" className="bg-[#118bdd]" onClick={() => { setMktEditingCategory(null); setMktShowForm(true); }}>
                        <Plus className="w-4 h-4 mr-1" /> Add Category
                      </Button>
                    </div>
                    {mktShowForm && (
                      <MarketplaceCategoryForm
                        category={mktEditingCategory}
                        onSave={async (data) => {
                          const successMessage = mktEditingCategory ? 'Category updated' : 'Category added';
                          setMktShowForm(false);
                          setMktEditingCategory(null);
                          await syncMarketplaceChanges(() => {
                            if (mktEditingCategory) {
                              Database.updateMarketplaceCategory(mktEditingCategory.id, data);
                            } else {
                              Database.createMarketplaceCategory(data as Omit<MarketplaceCategory, 'id'>);
                            }
                          }, successMessage);
                        }}
                        onCancel={() => { setMktShowForm(false); setMktEditingCategory(null); }}
                      />
                    )}
                    <div className="space-y-2">
                      {marketplaceCategories
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map(c => (
                        <div key={c.id} className="flex items-center justify-between p-3 bg-[#1f2937] rounded-lg border border-white/10">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-[#118bdd]/20 flex items-center justify-center text-[#118bdd] text-sm">{c.icon}</div>
                            <div>
                              <div className="text-white text-sm font-medium">{c.name}</div>
                              <div className="text-white/50 text-xs">Sort: {c.sortOrder} · {marketplaceRetailers.filter(r => r.categoryId === c.id).length} retailers</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={c.isActive ? 'bg-green-500/20 text-green-400 text-xs' : 'bg-red-500/20 text-red-400 text-xs'}>{c.isActive ? 'Active' : 'Inactive'}</Badge>
                            <Button size="sm" variant="ghost" className="text-white/50 hover:text-white h-8 w-8 p-0" onClick={() => { setMktEditingCategory(c); setMktShowForm(true); }}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 h-8 w-8 p-0" onClick={async () => { await syncMarketplaceChanges(() => Database.deleteMarketplaceCategory(c.id), 'Category deleted'); }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* === BANNERS SUB-TAB === */}
                {mktSubTab === 'banners' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-white/80 text-sm font-medium">Banners ({marketplaceBanners.length})</h3>
                      <Button size="sm" className="bg-[#118bdd]" onClick={() => { setMktEditingBanner(null); setMktShowForm(true); }}>
                        <Plus className="w-4 h-4 mr-1" /> Add Banner
                      </Button>
                    </div>
                    {mktShowForm && (
                      <MarketplaceBannerForm
                        banner={mktEditingBanner}
                        onSave={async (data) => {
                          const successMessage = mktEditingBanner ? 'Banner updated' : 'Banner added';
                          setMktShowForm(false);
                          setMktEditingBanner(null);
                          await syncMarketplaceChanges(() => {
                            if (mktEditingBanner) {
                              Database.updateMarketplaceBanner(mktEditingBanner.id, data);
                            } else {
                              Database.createMarketplaceBanner(data as Omit<MarketplaceBanner, 'id'>);
                            }
                          }, successMessage);
                        }}
                        onCancel={() => { setMktShowForm(false); setMktEditingBanner(null); }}
                      />
                    )}
                    <div className="space-y-2">
                      {marketplaceBanners
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map(b => (
                        <div key={b.id} className="flex items-center justify-between p-3 bg-[#1f2937] rounded-lg border border-white/10">
                          <div className="flex items-center gap-3">
                            {b.imageUrl ? (
                              <img src={b.imageUrl} alt={b.title} className="w-16 h-10 rounded object-cover" />
                            ) : (
                              <div className="w-16 h-10 rounded bg-gradient-to-r from-[#118bdd] to-purple-500 flex items-center justify-center text-white text-xs">Banner</div>
                            )}
                            <div>
                              <div className="text-white text-sm font-medium">{b.title}</div>
                              <div className="text-white/50 text-xs">{b.subtitle || 'No subtitle'}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={b.isActive ? 'bg-green-500/20 text-green-400 text-xs' : 'bg-red-500/20 text-red-400 text-xs'}>{b.isActive ? 'Active' : 'Inactive'}</Badge>
                            <Button size="sm" variant="ghost" className="text-white/50 hover:text-white h-8 w-8 p-0" onClick={() => { setMktEditingBanner(b); setMktShowForm(true); }}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 h-8 w-8 p-0" onClick={async () => { await syncMarketplaceChanges(() => Database.deleteMarketplaceBanner(b.id), 'Banner deleted'); }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      {marketplaceBanners.length === 0 && <p className="text-white/40 text-sm text-center py-4">No banners added yet</p>}
                    </div>
                  </div>
                )}

                {/* === DEALS SUB-TAB === */}
                {mktSubTab === 'deals' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-white/80 text-sm font-medium">Deals ({marketplaceDeals.length})</h3>
                      <Button size="sm" className="bg-[#118bdd]" onClick={() => { setMktEditingDeal(null); setMktShowForm(true); }}>
                        <Plus className="w-4 h-4 mr-1" /> Add Deal
                      </Button>
                    </div>
                    {mktShowForm && (
                      <MarketplaceDealForm
                        deal={mktEditingDeal}
                        retailers={marketplaceRetailers}
                        onSave={async (data) => {
                          const successMessage = mktEditingDeal ? 'Deal updated' : 'Deal added';
                          setMktShowForm(false);
                          setMktEditingDeal(null);
                          await syncMarketplaceChanges(() => {
                            if (mktEditingDeal) {
                              Database.updateMarketplaceDeal(mktEditingDeal.id, data);
                            } else {
                              Database.createMarketplaceDeal(data as Omit<MarketplaceDeal, 'id'>);
                            }
                          }, successMessage);
                        }}
                        onCancel={() => { setMktShowForm(false); setMktEditingDeal(null); }}
                      />
                    )}
                    <div className="space-y-2">
                      {marketplaceDeals
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map(d => (
                        <div key={d.id} className="flex items-center justify-between p-3 bg-[#1f2937] rounded-lg border border-white/10">
                          <div className="flex items-center gap-3">
                            {d.imageUrl ? (
                              <img src={d.imageUrl} alt={d.title} className="w-12 h-12 rounded object-cover" />
                            ) : (
                              <div className="w-12 h-12 rounded bg-orange-500/20 flex items-center justify-center text-orange-400 text-xs">Deal</div>
                            )}
                            <div>
                              <div className="text-white text-sm font-medium">{d.title}</div>
                              <div className="text-white/50 text-xs">{d.badgeText || 'No badge'} · {marketplaceRetailers.find(r => r.id === d.retailerId)?.name || 'N/A'}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={d.isActive ? 'bg-green-500/20 text-green-400 text-xs' : 'bg-red-500/20 text-red-400 text-xs'}>{d.isActive ? 'Active' : 'Inactive'}</Badge>
                            <Button size="sm" variant="ghost" className="text-white/50 hover:text-white h-8 w-8 p-0" onClick={() => { setMktEditingDeal(d); setMktShowForm(true); }}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 h-8 w-8 p-0" onClick={async () => { await syncMarketplaceChanges(() => Database.deleteMarketplaceDeal(d.id), 'Deal deleted'); }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      {marketplaceDeals.length === 0 && <p className="text-white/40 text-sm text-center py-4">No deals added yet</p>}
                    </div>
                  </div>
                )}

                {/* === INVOICES SUB-TAB === */}
                {mktSubTab === 'invoices' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-white/80 text-sm font-medium flex items-center gap-2">
                        <FileText className="w-4 h-4 text-[#118bdd]" />
                        Invoice Verification ({marketplaceInvoices.filter(i => i.status === 'pending').length} pending)
                      </h3>
                    </div>
                    <div className="space-y-2">
                      {[...marketplaceInvoices]
                        .sort((a, b) => {
                          if (a.status === 'pending' && b.status !== 'pending') return -1;
                          if (a.status !== 'pending' && b.status === 'pending') return 1;
                          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                        })
                        .map(inv => (
                        <div key={inv.id} className="p-4 bg-[#1f2937] rounded-lg border border-white/10 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-white text-sm font-semibold">{inv.retailerName}</span>
                                <Badge className={`text-[9px] ${
                                  inv.status === 'pending' ? 'bg-amber-500/15 text-amber-400 border-amber-500/20' :
                                  inv.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' :
                                  'bg-red-500/15 text-red-400 border-red-500/20'
                                }`}>{inv.status}</Badge>
                              </div>
                              <p className="text-white/40 text-xs mt-0.5">
                                User: {inv.userId} • Amount: ${inv.amount.toFixed(2)} • {new Date(inv.createdAt).toLocaleDateString()}
                              </p>
                              {inv.orderId && <p className="text-white/40 text-xs mt-0.5">Order ID: {inv.orderId}</p>}
                              {inv.status === 'approved' && <p className="text-emerald-400/60 text-xs mt-0.5">Awarded: {inv.rewardPoints} RP</p>}
                              {inv.status === 'approved' && inv.rpRevoked && (
                                <p className="text-rose-300/70 text-xs mt-0.5">
                                  RP taken back by admin{inv.rpRevokedAt ? ` on ${new Date(inv.rpRevokedAt).toLocaleString()}` : ''}
                                </p>
                              )}
                              {inv.status === 'rejected' && inv.adminNotes && <p className="text-red-400/60 text-xs mt-0.5">Reason: {inv.adminNotes}</p>}
                            </div>
                          </div>
                          {inv.invoiceImage && (
                            (String(inv.invoiceImageMimeType || '').startsWith('image/'))
                            || inv.invoiceImage.startsWith('data:image')
                            || /\.(png|jpe?g|webp|gif)(?:$|[?#])/i.test(inv.invoiceImage)
                          ) && (
                            <div className="rounded-lg overflow-hidden border border-white/10 max-w-xs">
                              <img src={inv.invoiceImage} alt="Invoice" className="w-full max-h-48 object-contain bg-white/5" />
                            </div>
                          )}
                          {inv.invoiceImage && (
                            String(inv.invoiceImageMimeType || '').toLowerCase() === 'application/pdf'
                            || inv.invoiceImage.startsWith('data:application/pdf')
                            || /\.pdf(?:$|[?#])/i.test(inv.invoiceImage)
                          ) && (
                            <div className="rounded-lg border border-white/10 p-3 flex items-center gap-2 max-w-xs bg-white/5">
                              <FileText className="w-5 h-5 text-red-400" />
                              <span className="text-white/60 text-xs">PDF Invoice Uploaded</span>
                              <a href={inv.invoiceImage} target="_blank" rel="noreferrer" download={inv.invoiceImageFileName || `invoice-${inv.id}.pdf`} className="text-[#118bdd] text-xs underline ml-auto">Download</a>
                            </div>
                          )}
                          {inv.status === 'pending' && (
                            <div className="flex items-end gap-2 flex-wrap">
                              <div className="flex-1 min-w-[120px]">
                                <Label className="text-white/60 text-xs">Reward Points to Award</Label>
                                <Input
                                  id={`inv-rp-${inv.id}`}
                                  type="number"
                                  placeholder="e.g. 100"
                                  className="bg-[#111827] border-white/10 text-white h-9 text-sm mt-1"
                                />
                              </div>
                              <Button
                                size="sm"
                                className="bg-emerald-600 hover:bg-emerald-700 h-9"
                                onClick={async () => {
                                  try {
                                    const rpInput = document.getElementById(`inv-rp-${inv.id}`) as HTMLInputElement;
                                    const rp = parseInt(rpInput?.value || '0');
                                    if (!rp || rp <= 0) { toast.error('Enter valid reward points'); return; }
                                    await Database.commitCriticalAction(() => Database.approveMarketplaceInvoice(inv.id, user?.userId || '', rp), { timeoutMs: 90000 });
                                    loadMarketplaceData();
                                    toast.success(`Invoice approved with ${rp} RP`);
                                  } catch (error) {
                                    toast.error(error instanceof Error ? error.message : 'Failed to approve invoice');
                                  }
                                }}
                              >
                                <CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-red-500/30 text-red-400 hover:bg-red-500/10 h-9"
                                onClick={async () => {
                                  try {
                                    const reason = prompt('Rejection reason (optional):') || '';
                                    await Database.commitCriticalAction(() => Database.rejectMarketplaceInvoice(inv.id, user?.userId || '', reason), { timeoutMs: 90000 });
                                    loadMarketplaceData();
                                    toast.success('Invoice rejected');
                                  } catch (error) {
                                    toast.error(error instanceof Error ? error.message : 'Failed to reject invoice');
                                  }
                                }}
                              >
                                <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                              </Button>
                            </div>
                          )}
                          {inv.status === 'approved' && !inv.rpRevoked && inv.rewardPoints > 0 && (
                            <div className="flex items-center gap-2 flex-wrap">
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-rose-500/40 text-rose-300 hover:bg-rose-500/10 h-9"
                                onClick={async () => {
                                  try {
                                    const confirmed = window.confirm(
                                      `Take back ${inv.rewardPoints} RP from user ${inv.userId}? This will silently move the invoice back to pending so you can approve again with correct RP.`
                                    );
                                    if (!confirmed) return;
                                    const result = await Database.commitCriticalAction(() => Database.revokeMarketplaceInvoiceRewardPoints(inv.id, user?.userId || ''), { timeoutMs: 90000 });
                                    if (!result.success) {
                                      toast.error(result.message);
                                      return;
                                    }
                                    loadMarketplaceData();
                                    toast.success(result.message);
                                  } catch (error) {
                                    toast.error(error instanceof Error ? error.message : 'Failed to take back reward points');
                                  }
                                }}
                              >
                                <ArrowDown className="w-3.5 h-3.5 mr-1" /> Take Back & Reopen
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                      {marketplaceInvoices.length === 0 && <p className="text-white/40 text-sm text-center py-4">No invoices submitted yet</p>}
                    </div>
                  </div>
                )}

                {/* === REDEMPTIONS SUB-TAB === */}
                {mktSubTab === 'redemptions' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-white/80 text-sm font-medium flex items-center gap-2">
                        <Award className="w-4 h-4 text-[#118bdd]" />
                        Redemption Requests ({marketplaceRedemptions.filter(r => r.status === 'pending').length} pending)
                      </h3>
                    </div>
                    <div className="space-y-2">
                      {[...marketplaceRedemptions]
                        .sort((a, b) => {
                          if (a.status === 'pending' && b.status !== 'pending') return -1;
                          if (a.status !== 'pending' && b.status === 'pending') return 1;
                          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                        })
                        .map(red => (
                        <div key={red.id} className="p-4 bg-[#1f2937] rounded-lg border border-white/10">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-white text-sm font-semibold">{red.rewardPoints} RP → ${red.usdtAmount.toFixed(2)} USDT</span>
                                <Badge className={`text-[9px] ${
                                  red.status === 'pending' ? 'bg-amber-500/15 text-amber-400 border-amber-500/20' :
                                  red.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' :
                                  'bg-red-500/15 text-red-400 border-red-500/20'
                                }`}>{red.status}</Badge>
                              </div>
                              <p className="text-white/40 text-xs mt-0.5">
                                User: {red.userId} • {new Date(red.createdAt).toLocaleDateString()}
                                {red.status === 'approved' && ' • Credited to Income Wallet'}
                              </p>
                              {red.status === 'rejected' && red.adminNotes && <p className="text-red-400/60 text-xs mt-0.5">Reason: {red.adminNotes}</p>}
                            </div>
                            {red.status === 'pending' && (
                              <div className="flex gap-2 flex-shrink-0">
                                <Button
                                  size="sm"
                                  className="bg-emerald-600 hover:bg-emerald-700 h-8"
                                  onClick={async () => {
                                    try {
                                      await Database.commitCriticalAction(() => Database.approveRedemption(red.id, user?.userId || ''), { timeoutMs: 90000 });
                                      loadMarketplaceData();
                                      toast.success(`Approved. $${red.usdtAmount.toFixed(2)} credited to user's Income Wallet`);
                                    } catch (error) {
                                      toast.error(error instanceof Error ? error.message : 'Failed to approve redemption');
                                    }
                                  }}
                                >
                                  <CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-red-500/30 text-red-400 hover:bg-red-500/10 h-8"
                                  onClick={async () => {
                                    try {
                                      const reason = prompt('Rejection reason (optional):') || '';
                                      await Database.commitCriticalAction(() => Database.rejectRedemption(red.id, user?.userId || '', reason), { timeoutMs: 90000 });
                                      loadMarketplaceData();
                                      toast.success('Rejected. Points refunded to user.');
                                    } catch (error) {
                                      toast.error(error instanceof Error ? error.message : 'Failed to reject redemption');
                                    }
                                  }}
                                >
                                  <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      {marketplaceRedemptions.length === 0 && <p className="text-white/40 text-sm text-center py-4">No redemption requests yet</p>}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog
        open={!!fullscreenQr}
        onOpenChange={(open) => {
          if (!open) setFullscreenQr(null);
        }}
      >
        <DialogContent className="glass border-white/10 bg-[#0b1220] max-w-4xl w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] p-4">
          <DialogHeader>
            <DialogTitle className="text-white">Withdrawal QR Code</DialogTitle>
            <DialogDescription className="text-white/65">
              {fullscreenQr ? `User: ${fullscreenQr.userId}` : ''}
            </DialogDescription>
          </DialogHeader>
          {fullscreenQr && (
            <div className="w-full h-[72vh] rounded-lg border border-white/10 bg-black/40 p-2 flex items-center justify-center">
              <img
                src={fullscreenQr.src}
                alt={`Withdrawal QR ${fullscreenQr.userId}`}
                className="max-h-full max-w-full object-contain rounded"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!fullscreenPaymentProof}
        onOpenChange={(open) => {
          if (!open) setFullscreenPaymentProof(null);
        }}
      >
        <DialogContent className="glass border-white/10 bg-[#0b1220] max-w-5xl w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] p-4">
          <DialogHeader>
            <DialogTitle className="text-white">Payment Proof Receipt</DialogTitle>
            <DialogDescription className="text-white/65">
              {fullscreenPaymentProof ? `User: ${fullscreenPaymentProof.userId}` : ''}
            </DialogDescription>
          </DialogHeader>
          {fullscreenPaymentProof && (
            <div className="w-full h-[80vh] rounded-lg border border-white/10 bg-black/40 p-2 flex items-center justify-center">
              <img
                src={fullscreenPaymentProof.src}
                alt={`Payment proof ${fullscreenPaymentProof.userId}`}
                className="w-full h-full object-contain rounded"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={showDeleteAllIdsDialog}
        onOpenChange={(open) => {
          setShowDeleteAllIdsDialog(open);
          if (!open) {
            resetDeleteAllIdsConfirmation();
          }
        }}
      >
        <DialogContent className="glass border-red-500/40 bg-[#111827] max-w-lg w-[calc(100vw-2rem)] sm:w-full">
          <DialogHeader>
            <DialogTitle className="text-red-300">Delete All IDs</DialogTitle>
            <DialogDescription className="text-white/70">
              This will remove all non-admin IDs from the system and clear related records.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-200">
              Confirm twice to continue:
              <div className="mt-1">1. Type <span className="font-mono">DELETE ALL IDS</span></div>
              <div>2. Type your admin ID: <span className="font-mono">{user?.userId || '-'}</span></div>
            </div>
            <div className="space-y-2">
              <Label className="text-white/80">Type confirmation phrase</Label>
              <Input
                value={deleteAllIdsPhrase}
                onChange={(e) => setDeleteAllIdsPhrase(e.target.value)}
                placeholder={DELETE_ALL_IDS_PHRASE}
                className="bg-[#1f2937] border-white/10 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-white/80">Type admin ID</Label>
              <Input
                value={deleteAllIdsAdminId}
                onChange={(e) => setDeleteAllIdsAdminId(e.target.value)}
                placeholder={user?.userId || '1000001'}
                className="bg-[#1f2937] border-white/10 text-white"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDeleteAllIdsDialog(false);
                  resetDeleteAllIdsConfirmation();
                }}
                className="flex-1 border-white/20 text-white hover:bg-white/10"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDeleteAllIds}
                disabled={!deleteAllIdsArmed || isDeletingAllIds}
                variant="destructive"
                className="flex-1 bg-red-600 hover:bg-red-700"
              >
                {isDeletingAllIds ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <XCircle className="w-4 h-4 mr-2" />}
                Confirm Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Funds Dialog */}
      {
        selectedUser && (
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => {
              setSelectedUser(null);
              setFundAmount('');
              setFundMessage('');
              setFundWalletType('deposit');
            }}
          >
            <Card
              className="glass border-white/10 bg-[#111827] max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <CardHeader>
                <CardTitle className="text-white">{fundWalletType === 'royalty' ? 'Send Royalty to User' : 'Add Funds'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-white/80">Wallet Type</Label>
                  <select
                    value={fundWalletType}
                    onChange={(e) => setFundWalletType(e.target.value as 'deposit' | 'income' | 'royalty')}
                    className="w-full px-4 py-2 bg-[#1f2937] border border-white/10 rounded-lg text-white"
                  >
                    <option value="deposit">Deposit Wallet</option>
                    <option value="income">Income Wallet</option>
                    <option value="royalty">Royalty Wallet</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Amount</Label>
                  <Input
                    type="number"
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                    placeholder="Enter amount"
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                </div>
                {fundWalletType === 'royalty' && (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                      <p className="text-xs text-white/60">Current Safety Pool Balance</p>
                      <p className="text-lg font-bold text-amber-300">{formatCurrency(safetyPoolAmount)}</p>
                      <p className="text-[11px] text-white/50 mt-1">
                        Royalty payout will be deducted from safety pool balance.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-white/80">Transaction Message</Label>
                      <Textarea
                        value={fundMessage}
                        onChange={(e) => setFundMessage(e.target.value)}
                        placeholder="Shown in the user's transaction history"
                        className="bg-[#1f2937] border-white/10 text-white min-h-[96px]"
                      />
                    </div>
                  </div>
                )}
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedUser(null);
                      setFundAmount('');
                      setFundMessage('');
                      setFundWalletType('deposit');
                    }}
                    className="flex-1 border-white/20 text-white hover:bg-white/10"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddFunds}
                    disabled={isLoading}
                    className="flex-1 btn-primary"
                  >
                    {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : (fundWalletType === 'royalty' ? 'Send Royalty' : 'Add Funds')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )
      }

      {/* Generated PINs Dialog */}
      <Dialog open={showPinDialog} onOpenChange={setShowPinDialog}>
        <DialogContent className="glass border-white/10 bg-[#111827] max-w-lg w-[calc(100vw-2rem)] sm:w-full max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Generated PINs</DialogTitle>
            <DialogDescription className="text-white/60">
              Copy these PINs and share them with the recipient.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {generatedPins.map((pin) => (
              <div key={pin.id} className="p-3 rounded-lg bg-[#1f2937] space-y-3">
                <span className="font-mono text-lg text-white block">{pin.pinCode}</span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyPin(pin.pinCode)}
                    className="flex-1 border-white/20 text-white hover:bg-white/10"
                  >
                    {copiedPin === pin.pinCode ? (
                      <><Check className="w-4 h-4 mr-1" /> Copied</>
                    ) : (
                      <><Copy className="w-4 h-4 mr-1" /> Copy</>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => sharePinOnWhatsApp(pin.pinCode)}
                    className="flex-1 border-green-500/30 text-green-400 hover:bg-green-500/10"
                  >
                    <MessageCircle className="w-4 h-4 mr-1" /> WhatsApp
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void sharePinAnywhere(pin.pinCode)}
                    className="flex-1 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
                  >
                    <Share2 className="w-4 h-4 mr-1" /> Share
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button onClick={() => setShowPinDialog(false)} className="w-full btn-primary">
            Close
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={showWithdrawalGapDialog} onOpenChange={setShowWithdrawalGapDialog}>
        <DialogContent className="glass border-white/10 bg-[#111827] max-w-3xl w-[calc(100vw-2rem)] sm:w-full max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Missing Pending Withdrawal Scan</DialogTitle>
            <DialogDescription className="text-white/60">
              Flags used withdrawal OTPs that do not have a recorded withdrawal request in the expected time window.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {withdrawalGapScanResults.length === 0 ? (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4">
                <p className="text-emerald-200 text-sm">No suspicious missing pending withdrawals found.</p>
              </div>
            ) : (
              withdrawalGapScanResults.map((item) => (
                <div key={item.otpId} className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-white font-medium">{item.fullName}</p>
                      <p className="text-[#8fcfff] text-xs font-mono">{item.userId}</p>
                    </div>
                    <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30">
                      Suspicious
                    </Badge>
                  </div>
                  <p className="text-white/70 text-sm">{item.issue}</p>
                  <p className="text-white/45 text-xs">OTP used at: {formatDate(item.otpCreatedAt)}</p>
                  <p className="text-white/45 text-xs break-all">Email: {item.email}</p>
                  <p className="text-white/30 text-[11px] break-all">Internal Ref: {item.internalUserId} | OTP: {item.otpId}</p>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Withdrawal Request Detail Dialog */}
      <Dialog
        open={showWithdrawalRequestDialog}
        onOpenChange={(open) => {
          setShowWithdrawalRequestDialog(open);
          if (!open) setSelectedWithdrawalRequest(null);
        }}
      >
        <DialogContent className="glass border-white/10 bg-[#111827] max-w-3xl w-[calc(100vw-2rem)] sm:w-full max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Withdrawal Request Details</DialogTitle>
            <DialogDescription className="text-white/60">
              Review payout details and process this request.
            </DialogDescription>
          </DialogHeader>
          {selectedWithdrawalRequest && (() => {
            const tx = selectedWithdrawalRequest;
            const txUser = userLookup.get(tx.userId) || Database.getUserById(tx.userId) || Database.getUserByUserId(tx.userId);
            const displayTxUserId = txUser?.userId || tx.requesterUserId || tx.userId;
            const displayTxUserName = txUser?.fullName || tx.requesterName || 'Unknown user';
            const requestedAddress = String(tx.walletAddress || '').trim();
            const profileAddress = String(txUser?.usdtAddress || '').trim();
            const payoutAddress = requestedAddress || profileAddress || '-';
            const payoutQrCode = String(tx.payoutQrCode || '').trim();
            const receiptDraft = withdrawalReceiptDrafts[tx.id] || '';
            const reasonDraft = withdrawalReasonDrafts[tx.id] || '';
            const grossAmount = Math.abs(tx.amount);
            const fee = Number(tx.fee || 0);
            const netAmount = Number(tx.netAmount || Math.max(0, grossAmount - fee));

            return (
              <div className="space-y-3 py-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#118bdd] font-mono">{displayTxUserId}</span>
                    <Badge className={`text-[10px] ${
                      tx.status === 'pending'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : tx.status === 'completed'
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-red-500/15 text-red-300 border-red-500/30'
                    }`}>
                      {tx.status}
                    </Badge>
                  </div>
                  <p className="text-white text-sm font-medium mt-1">{displayTxUserName}</p>
                  <p className="text-white/55 text-xs mt-1">
                    Requested: {formatCurrency(grossAmount)} | Fee: {formatCurrency(fee)} | Net: {formatCurrency(netAmount)}
                  </p>
                  <div className="mt-2 rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-3 py-2 max-w-xl">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-medium text-emerald-200/90">USDT (BEP20) Payout Address</p>
                      <Button
                        size="sm"
                        type="button"
                        variant="outline"
                        disabled={payoutAddress === '-'}
                        onClick={() => void copyWithdrawalAddress(tx.id, payoutAddress)}
                        className="h-7 px-2 border-emerald-400/35 text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-45"
                      >
                        {copiedWithdrawalAddressId === tx.id ? (
                          <><Check className="w-3.5 h-3.5 mr-1" /> Copied</>
                        ) : (
                          <><Copy className="w-3.5 h-3.5 mr-1" /> Copy</>
                        )}
                      </Button>
                    </div>
                    <p className="text-[13px] text-emerald-100 font-mono break-all mt-1">
                      {payoutAddress}
                    </p>
                  </div>
                  {requestedAddress && profileAddress && requestedAddress !== profileAddress && (
                    <p className="text-white/35 text-[11px] mt-0.5 break-all">
                      Profile USDT: {profileAddress}
                    </p>
                  )}
                  <p className="text-white/40 text-xs mt-1">
                    Requested at: {formatDate(tx.createdAt)}
                  </p>
                  {tx.completedAt && (
                    <p className="text-white/40 text-xs mt-0.5">
                      Processed at: {formatDate(tx.completedAt)}
                    </p>
                  )}
                  {tx.adminReason && (
                    <p className={`text-xs mt-1 ${tx.status === 'failed' ? 'text-red-300/90' : 'text-white/70'}`}>
                      Reason: {tx.adminReason}
                    </p>
                  )}
                </div>

                {payoutQrCode && (
                  <div className="rounded-lg border border-white/10 p-3 bg-white/5 max-w-sm">
                    <p className="text-white/60 text-xs mb-2">User payout QR code</p>
                    {payoutQrCode.startsWith('data:image') ? (
                      <button
                        type="button"
                        onClick={() => setFullscreenQr({ src: payoutQrCode, userId: displayTxUserId })}
                        className="w-full text-left"
                      >
                        <img src={payoutQrCode} alt="User payout QR" className="w-full max-h-48 object-contain rounded border border-white/15" />
                        <p className="text-[11px] text-[#8fcfff] mt-2">Tap to open full screen</p>
                      </button>
                    ) : (
                      <a href={payoutQrCode} target="_blank" rel="noreferrer" className="text-[#118bdd] text-xs underline break-all">
                        Open QR code
                      </a>
                    )}
                  </div>
                )}

                {(tx.status === 'completed' || tx.status === 'failed') && tx.adminReceipt && (
                  <div className="rounded-lg border border-white/10 p-3 bg-white/5 max-w-sm">
                    <p className="text-white/60 text-xs mb-2">Admin receipt/proof</p>
                    {tx.adminReceipt.startsWith('data:image') ? (
                      <img src={tx.adminReceipt} alt="Withdrawal proof" className="w-full max-h-48 object-contain rounded" />
                    ) : tx.adminReceipt.startsWith('data:application/pdf') ? (
                      <a href={tx.adminReceipt} download={`withdrawal-proof-${tx.id}.pdf`} className="text-[#118bdd] text-xs underline">
                        Download PDF proof
                      </a>
                    ) : (
                      <a href={tx.adminReceipt} target="_blank" rel="noreferrer" className="text-[#118bdd] text-xs underline break-all">
                        Open receipt link
                      </a>
                    )}
                  </div>
                )}

                {tx.status === 'pending' && (
                  <div className="space-y-2">
                    <div>
                      <Label className="text-white/70 text-xs">Admin note / rejection reason (optional)</Label>
                      <Textarea
                        value={reasonDraft}
                        onChange={(e) => setWithdrawalReasonDrafts((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                        className="mt-1 min-h-[76px] bg-[#111827] border-white/10 text-white text-sm"
                        placeholder="Add reason (user can see this if provided)..."
                      />
                    </div>
                    <div>
                      <Label className="text-white/70 text-xs">Payment receipt (optional)</Label>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Input
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={(e) => void handleWithdrawalReceiptUpload(tx.id, e)}
                          className="max-w-xs bg-[#111827] border-white/10 text-white file:text-white"
                        />
                        {receiptDraft && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setWithdrawalReceiptDrafts((prev) => ({ ...prev, [tx.id]: '' }))}
                            className="border-red-500/30 text-red-300 hover:bg-red-500/10"
                          >
                            Remove Receipt
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleRejectWithdrawalRequest(tx.id)}
                        className="border-red-500/40 text-red-300 hover:bg-red-500/10"
                      >
                        <XCircle className="w-4 h-4 mr-1" /> Reject & Refund
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void handleApproveWithdrawalRequest(tx.id)}
                        className="bg-emerald-600 hover:bg-emerald-700"
                      >
                        <CheckCircle className="w-4 h-4 mr-1" /> Mark Completed
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Payment Review Dialog */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="glass border-white/10 bg-[#111827] max-w-lg w-[calc(100vw-2rem)] sm:w-full">
          <DialogHeader>
            <DialogTitle className="text-white">Review Deposit</DialogTitle>
            <DialogDescription className="text-white/60">
              Verify the payment details before approving or rejecting.
            </DialogDescription>
          </DialogHeader>
          {selectedPayment && (
            <div className="space-y-4 py-4">
              {(() => {
                const paymentUser = userLookup.get(selectedPayment.userId) || Database.getUserById(selectedPayment.userId) || Database.getUserByUserId(selectedPayment.userId);
                const displayPaymentUserId = paymentUser?.userId || selectedPayment.userId || '-';
                const canApprove = selectedPayment.status === 'pending' || selectedPayment.status === 'under_review';
                const canReverse = selectedPayment.status === 'completed';
                return (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">User ID</p>
                        <p className="text-white font-medium font-mono">{displayPaymentUserId}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Amount</p>
                        <p className="text-white font-medium">{formatCurrency(selectedPayment.amount)}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Method</p>
                        <p className="text-white font-medium">{selectedPayment.methodName}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Date</p>
                        <p className="text-white font-medium">{formatDate(selectedPayment.createdAt)}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-[#1f2937] col-span-2">
                        <p className="text-sm text-white/50">Status</p>
                        <p className="text-white font-medium">{selectedPayment.status}</p>
                      </div>
                    </div>

                    {selectedPayment.txHash && (
                      <div className="p-3 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Transaction Hash</p>
                        <p className="text-white font-mono text-sm break-all">{selectedPayment.txHash}</p>
                      </div>
                    )}

                    {selectedPayment.screenshot && (
                      <div className="p-3 rounded-lg bg-[#1f2937]">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-sm text-white/50">Payment Screenshot</p>
                          <Button
                            size="sm"
                            type="button"
                            variant="outline"
                            onClick={() => setFullscreenPaymentProof({ src: selectedPayment.screenshot!, userId: displayPaymentUserId })}
                            className="h-7 px-2 border-white/20 text-white/80 hover:bg-white/10"
                          >
                            <Maximize2 className="w-3.5 h-3.5 mr-1" />
                            Full Screen
                          </Button>
                        </div>
                        <img
                          src={selectedPayment.screenshot}
                          alt="Payment Proof"
                          className="max-h-48 rounded-lg mx-auto"
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label className="text-white/80">Admin Notes (for rejection / reversal)</Label>
                      <textarea
                        value={adminNotes}
                        onChange={(e) => setAdminNotes(e.target.value)}
                        placeholder="Enter reason..."
                        className="w-full p-3 bg-[#1f2937] border border-white/10 rounded-lg text-white text-sm resize-none"
                        rows={3}
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <Button
                        variant="outline"
                        onClick={() => setShowPaymentDialog(false)}
                        className="flex-1 border-white/20 text-white hover:bg-white/10"
                      >
                        Cancel
                      </Button>
                      {canApprove && (
                        <>
                          <Button
                            onClick={handleRejectPayment}
                            variant="destructive"
                            className="flex-1 bg-red-500 hover:bg-red-600"
                          >
                            <XCircle className="w-4 h-4 mr-2" />
                            Reject
                          </Button>
                          <Button
                            onClick={handleApprovePayment}
                            className="flex-1 bg-emerald-500 hover:bg-emerald-600"
                          >
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Approve
                          </Button>
                        </>
                      )}
                      {canReverse && (
                        <Button
                          onClick={handleReversePayment}
                          variant="destructive"
                          className="flex-1 bg-purple-600 hover:bg-purple-700"
                        >
                          <XCircle className="w-4 h-4 mr-2" />
                          Reverse Deposit
                        </Button>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <MobileBottomNav />
    </div >
  );
}

// Alert component for the impersonate tab
function Alert({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`p-4 rounded-lg ${className}`}>
      {children}
    </div>
  );
}

function AlertDescription({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-sm ${className}`}>
      {children}
    </p>
  );
}




