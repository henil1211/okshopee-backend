import { useEffect, useState, useRef, useMemo } from 'react';
import { useAuthStore, useWalletStore, useMatrixStore, useOtpStore, useSyncRefreshKey, useNotificationStore, computeSpendableIncomeBalance } from '@/store';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  TrendingUp, Users, ArrowUpRight, ArrowDownLeft,
  Copy, CheckCircle, RefreshCw, Bell, AlertCircle,
  DollarSign, UserPlus, BarChart3, PlusCircle, LogOut, Shield,
  Ticket, Award, UserCog, IdCard, PhoneCall, ShoppingBag, MessageCircle, Share2, X
} from 'lucide-react';
import { formatCurrency, formatNumber, getInitials, generateAvatarColor, truncateText, getTransactionTypeLabel, calculateTimeRemainingWithDays, getVisibleTransactionDescription } from '@/utils/helpers';
import { helpDistributionTable } from '@/db';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import MobileBottomNav from '@/components/MobileBottomNav';
import BrandLogo from '@/components/BrandLogo';
import { toast } from 'sonner';
import Database from '@/db';
import { useOtpResend } from '@/hooks/use-otp-resend';

const ROYALTY_MILESTONES = [
  { qualifiedLevel: 3, percent: 5 },
  { qualifiedLevel: 4, percent: 10 },
  { qualifiedLevel: 5, percent: 15 },
  { qualifiedLevel: 6, percent: 16 },
  { qualifiedLevel: 7, percent: 17 },
  { qualifiedLevel: 8, percent: 18 },
  { qualifiedLevel: 9, percent: 19 }
] as const;

function getRoyaltyExplanation(milestone: (typeof ROYALTY_MILESTONES)[number]) {
  const monthlySystemFee = 10000;
  const eligibleUsers = 10;
  const royaltyPool = (monthlySystemFee * milestone.percent) / 100;
  const perUserRoyalty = royaltyPool / eligibleUsers;

  return {
    title: `Level ${milestone.qualifiedLevel} Royalty Income Logic`,
    qualifiedLevel: milestone.qualifiedLevel,
    percent: milestone.percent,
    monthlySystemFee,
    eligibleUsers,
    royaltyPool,
    perUserRoyalty
  };
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout, impersonatedUser, endImpersonation, verifyTransactionPassword } = useAuthStore();
  const { wallet, transactions, loadWallet, refreshTransactions, withdraw, v2ReadHealthy, v2ReadError } = useWalletStore();
  const { loadUserDownline, getDownlineStats, loadMatrix } = useMatrixStore();
  const { sendOtp, verifyOtp } = useOtpStore();
  const { unreadCount, loadNotifications } = useNotificationStore();
  const syncKey = useSyncRefreshKey();

  const [isLoading, setIsLoading] = useState(false);
  const notificationsButtonRef = useRef<HTMLButtonElement>(null);
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false);
  const [showDirectReferralsDialog, setShowDirectReferralsDialog] = useState(false);
  const [showLockedIncomeDialog, setShowLockedIncomeDialog] = useState(false);
  const [showRoyaltyInfoDialog, setShowRoyaltyInfoDialog] = useState(false);
  const [directReferralSearch, setDirectReferralSearch] = useState('');
  const [directReferralSort, setDirectReferralSort] = useState<'desc' | 'asc'>('desc');
  const [withdrawData, setWithdrawData] = useState({ amount: '', address: '', qrCode: '' });
  const [withdrawTransactionPassword, setWithdrawTransactionPassword] = useState('');
  const [withdrawOtp, setWithdrawOtp] = useState('');
  const [isSendingWithdrawOtp, setIsSendingWithdrawOtp] = useState(false);
  const [isWithdrawOtpSent, setIsWithdrawOtpSent] = useState(false);
  const withdrawOtpResend = useOtpResend(30);
  const [copied, setCopied] = useState(false);
  const settings = Database.getSettings();
  const withdrawalFeePercent = settings.withdrawalFeePercent;

  const displayUser = useMemo(() => {
    const activeUser = impersonatedUser || user;
    if (!activeUser) return null;
    return Database.getUserByUserId(activeUser.userId) || Database.getUserById(activeUser.id) || activeUser;
  }, [impersonatedUser, user]);
  const spendableIncomeBalance = useMemo(
    () => computeSpendableIncomeBalance(wallet, { lockedAlreadyExcluded: v2ReadHealthy }),
    [wallet, v2ReadHealthy]
  );

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    if (displayUser) {
      Database.syncUserAchievements(displayUser.id);
      loadWallet(displayUser.id, { v2Only: true });
      refreshTransactions(displayUser.id);
      loadMatrix();
      loadUserDownline(displayUser.userId);
      loadNotifications(displayUser.id);
    }
  }, [isAuthenticated, displayUser, navigate, loadWallet, refreshTransactions, loadMatrix, loadUserDownline, loadNotifications, syncKey]);

  const openWithdrawDialog = () => {
    const fallbackAddress = String(displayUser?.usdtAddress || '').trim();
    setWithdrawData((prev) => ({
      ...prev,
      address: prev.address || fallbackAddress
    }));
    setShowWithdrawDialog(true);
  };

  const handleWithdrawDialogOpenChange = (open: boolean) => {
    if (open) {
      openWithdrawDialog();
      return;
    }
    setShowWithdrawDialog(false);
  };

  const handleWithdraw = async () => {
    if (!displayUser) return;
    if (!v2ReadHealthy) {
      toast.error(v2ReadError || 'Live sync is unavailable. Please wait few minutes and logout and login again if the sync is unavailable after few minutes.');
      return;
    }
    const amount = parseFloat(withdrawData.amount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Invalid amount');
      return;
    }
    const amountInCents = Math.round(amount * 100);
    if (amountInCents < 1000) {
      toast.error('Minimum withdrawal amount is $10');
      return;
    }
    if (amountInCents % 1000 !== 0) {
      toast.error('Withdrawal amount must be in multiples of $10 (10, 20, 30...)');
      return;
    }
    const payoutAddress = String(withdrawData.address || '').trim();
    if (!payoutAddress) {
      toast.error('USDT (BEP20) address is required');
      return;
    }
    if (!verifyTransactionPassword(displayUser.id, withdrawTransactionPassword)) {
      toast.error('Invalid transaction password');
      return;
    }
    if (settings.requireOtpForTransactions) {
      if (!withdrawOtp) {
        toast.error('Please enter OTP');
        return;
      }
      const isValidOtp = await verifyOtp(displayUser.userId, withdrawOtp, 'withdrawal');
      if (!isValidOtp) {
        toast.error('Invalid or expired OTP');
        return;
      }
    }

    setIsLoading(true);
    const result = await withdraw(displayUser.id, amount, payoutAddress, withdrawData.qrCode || undefined);
    setIsLoading(false);

    if (result.success) {
      toast.success(result.message);
      setShowWithdrawDialog(false);
      setWithdrawData({ amount: '', address: payoutAddress, qrCode: '' });
      setWithdrawTransactionPassword('');
      setWithdrawOtp('');
      setIsWithdrawOtpSent(false);
      withdrawOtpResend.resetCooldown();
    } else {
      toast.error(result.message);
    }
  };

  const handleWithdrawQrUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please upload a valid image for QR code');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('QR image must be under 2MB');
      return;
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read QR image'));
        reader.readAsDataURL(file);
      });
      setWithdrawData((prev) => ({ ...prev, qrCode: dataUrl }));
      toast.success('QR code attached');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to read QR image');
    }
  };

  const handleSendWithdrawOtp = async () => {
    if (!displayUser) return;
    setIsSendingWithdrawOtp(true);
    const result = await sendOtp(displayUser.userId, displayUser.email, 'withdrawal');
    setIsSendingWithdrawOtp(false);
    if (result.success) {
      setIsWithdrawOtpSent(true);
      withdrawOtpResend.startCooldown();
      if (result.status === 'pending') {
        toast.warning(result.message);
      } else {
        toast.success(result.message);
      }
    } else {
      toast.error(result.message);
    }
  };

  const copyReferralLink = () => {
    if (!displayUser) return;
    const link = `${window.location.origin}/register?sponsor=${displayUser.userId}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Referral link copied!');
  };

  const getReferralLink = () => {
    if (!displayUser) return '';
    return `${window.location.origin}/register?sponsor=${displayUser.userId}`;
  };

  const getReferralShareMessage = () => {
    const link = getReferralLink();
    const contactLines = displayUser?.phone
      ? ['', displayUser.phone.trim(), 'Contact for ACTIVATION PIN☝️']
      : [];
    return [
      '*New Earning Opportunity !*',
      '',
      '_ReferNex - Next Generation Referral Program_',
      '',
      '*ReferNex* = Smart Shopping + Referral Income + Helping System.',
      '',
      'Simple process, Transparent system, Real growth.',
      '',
      '*Registration Link :*',
      link,
      '',
      '*Note :* A valid *Activation Pin* is required to complete registration.',
      ...contactLines
    ].join('\n');
  };

  const shareReferralOnWhatsApp = () => {
    const message = getReferralShareMessage();
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const shareReferral = async () => {
    const message = getReferralShareMessage();

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'ReferNex - New Earning Opportunity',
          text: message
        });
        return;
      }
    } catch {
      // User may cancel share dialog. Continue with clipboard fallback.
    }

    try {
      await navigator.clipboard.writeText(message);
      toast.success('Referral message copied. You can paste and share it.');
    } catch {
      toast.error('Share not supported on this device/browser.');
    }
  };

  const handleLogout = () => {
    if (impersonatedUser) {
      endImpersonation();
      toast.success('Returned to admin account');
    } else {
      logout();
      navigate('/login');
      toast.success('Logged out successfully');
    }
  };

  const downlineStats = useMemo(
    () => (displayUser ? getDownlineStats(displayUser.userId) : { left: 0, right: 0, leftActive: 0, rightActive: 0 }),
    [displayUser?.userId, getDownlineStats]
  );
  const sponsorUser = useMemo(
    () => (displayUser?.sponsorId ? Database.getUserByUserId(displayUser.sponsorId) : null),
    [displayUser?.sponsorId]
  );
  const directReferralUsers = useMemo(() => {
    if (!displayUser) return [];
    const rawUsers = Database.getUsers().filter((u) => u.sponsorId === displayUser.userId);
    const seen = new Set<string>();
    return rawUsers
      .map((u) => Database.getUserByUserId(u.userId) || u)
      .filter((u) => {
        if (seen.has(u.userId)) return false;
        seen.add(u.userId);
        return true;
      });
  }, [displayUser?.userId]);
  const filteredDirectReferrals = useMemo(() => {
    const search = directReferralSearch.trim().toLowerCase();
    if (!search) return directReferralUsers;
    return directReferralUsers.filter((u) =>
      u.userId.includes(search) || u.fullName.toLowerCase().includes(search)
    );
  }, [directReferralSearch, directReferralUsers]);
  const sortedDirectReferrals = useMemo(() => {
    return [...filteredDirectReferrals].sort((a, b) => {
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return directReferralSort === 'asc' ? diff : -diff;
    });
  }, [directReferralSort, filteredDirectReferrals]);
  const currentLevelDisplay = useMemo(
    () => (displayUser ? Database.getCurrentMatrixLevel(displayUser.id) : 0),
    [displayUser?.id]
  );
  const qualifiedLevel = useMemo(
    () => (displayUser ? Database.getQualifiedLevel(displayUser.id) : 0),
    [displayUser?.id]
  );
  const dbLockedIncomeBreakdown = useMemo(
    () => (displayUser ? Database.getLockedIncomeBreakdown(displayUser.id) : []),
    [displayUser?.id]
  );
  const effectiveDirectCount = useMemo(
    () => (displayUser ? Database.getEffectiveDirectCount(displayUser) : 0),
    [displayUser]
  );
  const liveLockedIncomeBreakdown = useMemo(() => {
    if (!displayUser) return [] as Array<{
      level: number;
      lockedAmount: number;
      lockedFirstTwoAmount: number;
      lockedQualificationAmount: number;
      requiredDirect: number;
      currentDirect: number;
      remainingDirect: number;
      qualified: boolean;
      reason: string;
    }>;

    const levelMap = new Map<number, { firstTwo: number; qualification: number }>();
    const ensureLevel = (level: number) => {
      const existing = levelMap.get(level);
      if (existing) return existing;
      const created = { firstTwo: 0, qualification: 0 };
      levelMap.set(level, created);
      return created;
    };

    const resolveLevel = (tx: { level?: number; description?: string }): number | null => {
      const numericLevel = Number(tx.level);
      if (Number.isFinite(numericLevel) && numericLevel >= 1 && numericLevel <= helpDistributionTable.length) {
        return numericLevel;
      }
      const match = String(tx.description || '').match(/\blevel\s+(\d+)\b/i);
      if (!match) return null;
      const parsed = Number(match[1]);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > helpDistributionTable.length) return null;
      return parsed;
    };

    const txs = [...transactions]
      .filter((tx) => tx.userId === displayUser.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (const tx of txs) {
      const level = resolveLevel(tx);
      if (!level) continue;
      const amount = Math.max(0, Math.abs(Number(tx.amount || 0)));
      if (!(amount > 0.0001)) continue;
      const desc = String(tx.description || '').toLowerCase();
      const slot = ensureLevel(level);

      if (tx.type === 'receive_help' && Number(tx.amount || 0) > 0) {
        if (desc.includes('locked first-two help')) {
          slot.firstTwo += amount;
          continue;
        }
        if (desc.includes('locked receive help')) {
          slot.qualification += amount;
          continue;
        }
        if (desc.startsWith('released locked receive help')) {
          slot.qualification = Math.max(0, slot.qualification - amount);
        }
        continue;
      }

      if (tx.type === 'give_help' && desc.includes('from locked income')) {
        let remaining = amount;
        const preferredLevel = Math.max(1, level - 1);
        const orderedLevels = Array.from(levelMap.keys()).sort((left, right) => left - right);
        const ordered = orderedLevels.includes(preferredLevel)
          ? [preferredLevel, ...orderedLevels.filter((entry) => entry !== preferredLevel)]
          : orderedLevels;

        for (const targetLevel of ordered) {
          if (remaining <= 0.0001) break;
          const state = ensureLevel(targetLevel);
          const take = Math.min(state.qualification, remaining);
          state.qualification -= take;
          remaining -= take;
        }
        for (const targetLevel of ordered) {
          if (remaining <= 0.0001) break;
          const state = ensureLevel(targetLevel);
          const take = Math.min(state.firstTwo, remaining);
          state.firstTwo -= take;
          remaining -= take;
        }
      }
    }

    const rows = Array.from(levelMap.entries())
      .map(([level, state]) => {
        const lockedFirstTwoAmount = Math.max(0, Math.round((state.firstTwo || 0) * 100) / 100);
        const lockedQualificationAmount = Math.max(0, Math.round((state.qualification || 0) * 100) / 100);
        const lockedAmount = Math.max(0, Math.round((lockedFirstTwoAmount + lockedQualificationAmount) * 100) / 100);
        if (lockedAmount <= 0.0001) return null;
        const requiredDirect = Database.getCumulativeDirectRequired(level);
        const remainingDirect = Math.max(0, requiredDirect - effectiveDirectCount);
        const reasons: string[] = [];
        if (lockedQualificationAmount > 0) {
          reasons.push(
            remainingDirect > 0
              ? `Locked due to Direct Referral Rule: Level ${level} requires ${requiredDirect} directs, you currently have ${effectiveDirectCount}.`
              : `Locked receive for Level ${level} is waiting for automatic release.`
          );
        }
        if (lockedFirstTwoAmount > 0) {
          reasons.push('Locked because first two received helps at this level are reserved for auto give-help settlement.');
        }

        return {
          level,
          lockedAmount,
          lockedFirstTwoAmount,
          lockedQualificationAmount,
          requiredDirect,
          currentDirect: effectiveDirectCount,
          remainingDirect,
          qualified: remainingDirect === 0,
          reason: reasons.join(' ')
        };
      })
      .filter((row): row is NonNullable<typeof row> => !!row)
      .sort((left, right) => left.level - right.level);

    const walletLockedTotal = Math.max(0, Number(wallet?.lockedIncomeWallet || 0));
    const derivedTotal = rows.reduce((sum, item) => sum + Math.max(0, Number(item.lockedAmount || 0)), 0);
    const lockedGap = Math.max(0, Math.round((walletLockedTotal - derivedTotal) * 100) / 100);
    if (lockedGap > 0.0001) {
      const levelOneRequired = Database.getCumulativeDirectRequired(1);
      const levelOneRemaining = Math.max(0, levelOneRequired - effectiveDirectCount);
      rows.unshift({
        level: 1,
        lockedAmount: lockedGap,
        lockedFirstTwoAmount: lockedGap,
        lockedQualificationAmount: 0,
        requiredDirect: levelOneRequired,
        currentDirect: effectiveDirectCount,
        remainingDirect: levelOneRemaining,
        qualified: levelOneRemaining === 0,
        reason: `Locked because first two received helps at this level are reserved for auto give-help settlement. Includes $${lockedGap.toFixed(2)} pending amount reflected from live wallet snapshot.`
      });
    }

    return rows.sort((left, right) => left.level - right.level);
  }, [displayUser, effectiveDirectCount, transactions, wallet?.lockedIncomeWallet]);
  const lockedIncomeBreakdown = useMemo(
    () => (dbLockedIncomeBreakdown.length > 0 ? dbLockedIncomeBreakdown : liveLockedIncomeBreakdown),
    [dbLockedIncomeBreakdown, liveLockedIncomeBreakdown]
  );
  const currentRoyaltyMilestone = ROYALTY_MILESTONES
    .filter((milestone) => qualifiedLevel >= milestone.qualifiedLevel)
    .slice(-1)[0] || null;
  const nextRoyaltyMilestone = ROYALTY_MILESTONES.find((milestone) => qualifiedLevel < milestone.qualifiedLevel) || null;
  const hasUnlockedRoyalty = !!currentRoyaltyMilestone;
  const activeRoyaltyMilestone = currentRoyaltyMilestone || ROYALTY_MILESTONES[0];
  const royaltyExplanation = useMemo(
    () => getRoyaltyExplanation(activeRoyaltyMilestone),
    [activeRoyaltyMilestone]
  );

  // Direct referral deadline countdown logic
  const REQUIRED_INITIAL_DIRECTS = 2;
  const hasMetInitialDirectRequirement = effectiveDirectCount >= REQUIRED_INITIAL_DIRECTS;

  const deadlineEndISO = useMemo(() => {
    if (!displayUser || displayUser.isAdmin || hasMetInitialDirectRequirement) return null;
    const settings = Database.getSettings();
    const baseDate = displayUser.reactivatedAt
      ? new Date(displayUser.reactivatedAt)
      : (displayUser.activatedAt ? new Date(displayUser.activatedAt) : null);
    if (!baseDate) return null;
    const deadlineDays = settings.directReferralDeadlineDays || 30;
    const deadlineEnd = new Date(baseDate.getTime() + deadlineDays * 24 * 60 * 60 * 1000);
    return deadlineEnd.toISOString();
  }, [displayUser, hasMetInitialDirectRequirement]);

  const [countdown, setCountdown] = useState<{ days: number; hours: number; minutes: number; seconds: number; expired: boolean } | null>(null);

  useEffect(() => {
    if (!deadlineEndISO) {
      setCountdown(null);
      return;
    }
    const tick = () => setCountdown(calculateTimeRemainingWithDays(deadlineEndISO));
    tick();
    const intervalId = setInterval(tick, 1000);
    return () => clearInterval(intervalId);
  }, [deadlineEndISO]);

  // Next level direct referral progress
  const nextLevelDirectInfo = useMemo(() => {
    if (!displayUser || !hasMetInitialDirectRequirement) return null;
    const currentMatrixLevel = currentLevelDisplay;
    // Find the first level (starting from 2) where user hasn't met cumulative direct requirement
    for (let lvl = 2; lvl <= helpDistributionTable.length; lvl++) {
      const cumulativeRequired = Database.getCumulativeDirectRequired(lvl);
      if (cumulativeRequired === 0) continue;
      if (effectiveDirectCount < cumulativeRequired) {
        const remaining = cumulativeRequired - effectiveDirectCount;
        return { targetLevel: lvl, totalRequired: cumulativeRequired, remaining, currentMatrixLevel };
      }
    }
    // User has met all direct requirements up to level 10
    // Show next level beyond current if applicable
    const nextBeyond = currentMatrixLevel + 1;
    if (nextBeyond <= helpDistributionTable.length) {
      const cumulativeRequired = Database.getCumulativeDirectRequired(nextBeyond);
      if (effectiveDirectCount < cumulativeRequired) {
        const remaining = cumulativeRequired - effectiveDirectCount;
        return { targetLevel: nextBeyond, totalRequired: cumulativeRequired, remaining, currentMatrixLevel };
      }
    }
    return null; // qualified for all levels
  }, [currentLevelDisplay, displayUser, hasMetInitialDirectRequirement, effectiveDirectCount]);

  const isOutflowTransaction = (tx: { amount: number; type: string }) =>
    tx.amount < 0
    || tx.type === 'withdrawal'
    || tx.type === 'give_help'
    || tx.type === 'safety_pool'
    || tx.type === 'activation'
    || tx.type === 'pin_used'
    || tx.type === 'admin_debit';
  const getDisplayAmount = (tx: { amount: number; type: string }) =>
    `${isOutflowTransaction(tx) ? '-' : '+'}${formatCurrency(Math.abs(tx.amount))}`;

  const showCurrency = (amount: number | undefined): string => {
    if (!v2ReadHealthy) return '--';
    return formatCurrency(amount || 0);
  };

  if (!displayUser) return null;

  const familyNationalTourQualified = Database.isTourQualified(displayUser.id, 4);
  const internationalTourQualified = Database.isTourQualified(displayUser.id, 5);
  const dreamCarQualified = Database.isTourQualified(displayUser.id, 6);
  const tourAchievementStatus = dreamCarQualified
    ? {
      currentStatus: 'Congratulations! You Have Achieved All of the Benefits.',
      nextMilestone: 'All Benefits Achieved',
      requirement: 'You have successfully completed all available tour achievement milestones.',
      completed: true
    }
    : internationalTourQualified
      ? {
        currentStatus: 'International Tour Package Achieved',
        nextMilestone: 'Your Dream Car worth $ 50000',
        requirement: 'You must receive help from all users in Level 6 and complete direct referral qualification.',
        completed: false
      }
      : familyNationalTourQualified
        ? {
          currentStatus: 'Family National Tour Package Achieved',
          nextMilestone: 'International Tour Package (3N/4D)',
          requirement: 'You must receive help from all users in Level 5 and complete direct referral qualification.',
          completed: false
        }
        : {
          currentStatus: 'N/A',
          nextMilestone: 'Family National Tour Package (2N/3D)',
          requirement: 'You must receive help from all users in Level 4 and complete direct referral qualification.',
          completed: false
        };

  return (
    <div className="dashboard-page min-h-screen bg-slate-50 pb-24 dark:bg-[#0a0e17] md:pb-0">
      {/* Header */}
      <header className="glass sticky top-0 z-50 border-b border-slate-200/80 dark:border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between min-h-16 py-2 sm:py-0 gap-2">
            <div className="flex items-center gap-3">
              <BrandLogo variant="full" className="h-10 w-[164px] rounded-md" />
              <div className="hidden sm:block">
                <span className="text-xs text-slate-500 dark:text-white/50">ID: {displayUser.userId}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              {/* Impersonation Indicator */}
              {impersonatedUser && (
                <Badge className="hidden md:inline-flex bg-amber-500/20 text-amber-400 border-amber-500/30">
                  Viewing as {impersonatedUser.fullName}
                </Badge>
              )}

              {/* Admin Panel Button - Only for admins */}
              {user?.isAdmin && !impersonatedUser && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/admin')}
                  className="hidden sm:inline-flex border-purple-500/50 text-purple-400 hover:bg-purple-500/10"
                >
                  <Shield className="w-4 h-4 mr-2" />
                  Admin Panel
                </Button>
              )}

              {/* Notification Bell */}
              <Button
                ref={notificationsButtonRef}
                variant="ghost"
                size="icon"
                onClick={() => navigate('/notifications')}
                className="relative text-slate-500 dark:text-white/60 hover:text-slate-700 dark:hover:text-white"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Button>

              <div
                className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => navigate('/profile')}
              >
                <div className={`dashboard-avatar w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold ${generateAvatarColor(displayUser.userId)}`}>
                  {getInitials(displayUser.fullName)}
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{displayUser.fullName}</p>
                  <p className="text-xs text-slate-500 dark:text-white/50">{displayUser.isActive ? 'Active' : 'Inactive'}</p>
                </div>
              </div>

              {/* Logout Button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                className="text-slate-500 hover:text-red-500 dark:text-white/60 dark:hover:text-red-400"
              >
                <LogOut className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {!v2ReadHealthy && (
          <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
            <p className="text-sm font-semibold text-rose-200">Live sync is unavailable, Please wait few minutes and logout and login again if the sync is unavailable after few minutes.</p>
            <p className="text-xs text-rose-200/90 mt-1">
              {v2ReadError || 'Live read failed: Cannot reach. Wait few Minutes https://api.refernex.com. Check internet, DNS, SSL, or CORS/proxy settings.'}
            </p>
          </div>
        )}
        {/* Welcome Section */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mb-2">
            Welcome back, <span className="gradient-text">{displayUser.fullName.split(' ')[0]}</span>
          </h1>
          <p className="text-slate-600 dark:text-white/60">
            Here is an overview of your referral network, shopping rewards, and earnings.
          </p>
        </div>

        {/* Direct Referral Status */}
        {!hasMetInitialDirectRequirement && countdown && !countdown.expired && (
          <div className="mb-6 p-4 rounded-xl border border-red-500/30 bg-red-500/10">
            <div className="flex flex-col items-center gap-3">
              <div className="text-center">
                <p className="text-sm font-semibold text-red-400 flex items-center justify-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Direct Referral Deadline
                </p>
                <p className="text-xs text-red-300/80 mt-1">
                  Get {REQUIRED_INITIAL_DIRECTS - effectiveDirectCount} more direct referral(s) before the deadline or your account will be deactivated.
                </p>
                <p className="text-xs text-white/40 mt-1">
                  Current: {effectiveDirectCount} / {REQUIRED_INITIAL_DIRECTS} direct referrals
                </p>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                    <span className="text-xl sm:text-2xl font-mono font-bold text-red-400">{String(countdown.days).padStart(2, '0')}</span>
                  </div>
                  <span className="text-[10px] text-white/40 mt-1">Day</span>
                </div>
                <span className="text-xl font-bold text-red-400/50 -mt-4">:</span>
                <div className="flex flex-col items-center">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                    <span className="text-xl sm:text-2xl font-mono font-bold text-red-400">{String(countdown.hours).padStart(2, '0')}</span>
                  </div>
                  <span className="text-[10px] text-white/40 mt-1">Hour</span>
                </div>
                <span className="text-xl font-bold text-red-400/50 -mt-4">:</span>
                <div className="flex flex-col items-center">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                    <span className="text-xl sm:text-2xl font-mono font-bold text-red-400">{String(countdown.minutes).padStart(2, '0')}</span>
                  </div>
                  <span className="text-[10px] text-white/40 mt-1">Min</span>
                </div>
                <span className="text-xl font-bold text-red-400/50 -mt-4">:</span>
                <div className="flex flex-col items-center">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                    <span className="text-xl sm:text-2xl font-mono font-bold text-red-400">{String(countdown.seconds).padStart(2, '0')}</span>
                  </div>
                  <span className="text-[10px] text-white/40 mt-1">Sec</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {hasMetInitialDirectRequirement && nextLevelDirectInfo && (
          <div className="mb-6 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  Direct Referral Progress
                </p>
                {nextLevelDirectInfo.currentMatrixLevel >= nextLevelDirectInfo.targetLevel && (
                  <p className="text-xs text-amber-300/80 mt-1">
                    You are currently at Level {nextLevelDirectInfo.currentMatrixLevel} but need <span className="font-semibold">+{nextLevelDirectInfo.remaining}</span> more direct referral(s) (total {nextLevelDirectInfo.totalRequired}) to receive Level {nextLevelDirectInfo.targetLevel} helps.
                  </p>
                )}
                {nextLevelDirectInfo.currentMatrixLevel < nextLevelDirectInfo.targetLevel && (
                  <p className="text-xs text-emerald-300/80 mt-1">
                    You need <span className="font-semibold">+{nextLevelDirectInfo.remaining}</span> more direct referral(s) (total {nextLevelDirectInfo.totalRequired}) to start receiving Level {nextLevelDirectInfo.targetLevel} helps.
                  </p>
                )}
              </div>
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-lg px-3 py-1 shrink-0">
                {effectiveDirectCount} Direct{effectiveDirectCount !== 1 ? 's' : ''}
              </Badge>
            </div>
          </div>
        )}

        {hasMetInitialDirectRequirement && !nextLevelDirectInfo && (
          <div className="mb-6 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <p className="text-sm text-emerald-400 font-semibold">
                All direct referral requirements met! You are qualified for all levels.
              </p>
            </div>
          </div>
        )}

        {/* Sponsor Detail & Affiliate MarketPlace */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Sponsor Detail */}
          {sponsorUser && (
            <Card className="glass border-slate-200/80 dark:border-white/10">
              <CardContent className="p-5">
                <div className="space-y-4">
                  <p className="text-sm text-slate-500 dark:text-white/50 flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#118bdd]" />
                    Sponsor Details
                  </p>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-lg font-semibold text-slate-900 dark:text-white">{sponsorUser.userId}</p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (!sponsorUser.phone) {
                          toast.error('Sponsor mobile number not available');
                          return;
                        }
                        window.location.href = `tel:${sponsorUser.phone}`;
                      }}
                      className="shrink-0 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                    >
                      <PhoneCall className="w-4 h-4 mr-2" />
                      Call Sponsor
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Affiliate MarketPlace */}
          <Card className="glass border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 to-transparent dark:from-emerald-900/20">
            <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500 dark:text-white/50 flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-emerald-500" />
                  Affiliate E-Commerce Platforms
                </p>
                <p className="text-sm text-slate-600 dark:text-white/60 mt-1">
                  Top brands at great discounts — Click now and explore the deals!
                </p>
              </div>
              <Button
                onClick={() => navigate('/e-commerce')}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <ShoppingBag className="w-4 h-4 mr-2" />
                Click Now & Explore
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Three Wallet System */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
          <Card className="wallet-card h-full gap-1 py-4">
            <CardHeader className="pb-1 min-h-[52px]">
              <CardTitle className="text-sm font-medium text-white/60 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-500" />
                Fund Wallet
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 flex-1 flex flex-col justify-start">
              <p className="text-3xl font-bold text-white">{showCurrency(wallet?.depositWallet)}</p>
              <p className="text-xs text-white/50 mt-1">Add funds for PIN Requests and P2P Transfers.</p>
            </CardContent>
          </Card>

          <Card className="wallet-card h-full gap-1 py-4">
            <CardHeader className="pb-1 min-h-[52px]">
              <CardTitle className="text-sm font-medium text-white/60 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-cyan-400" />
                Total Earnings
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 flex-1 flex flex-col justify-start">
              <p className="text-3xl font-bold text-white">{showCurrency(wallet?.totalReceived)}</p>
              <p className="text-xs text-white/50 mt-1">Lifetime earnings credited to your account</p>
            </CardContent>
          </Card>

          <Card className="wallet-card h-full gap-1 py-4">
            <CardHeader className="pb-1 min-h-[52px]">
              <CardTitle className="text-sm font-medium text-white/60 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-purple-500" />
                Available Income
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 flex-1 flex flex-col justify-start">
              <p className="text-3xl font-bold text-white">{showCurrency(spendableIncomeBalance)}</p>
              <p className="text-xs text-white/50 mt-1">Available amount for withdrawal and P2P Transfers.</p>
            </CardContent>
          </Card>

          <Card className="wallet-card h-full gap-1 py-4">
            <CardHeader className="pb-1 min-h-[52px]">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium text-white/60 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-amber-500" />
                  Locked Receive Help
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowLockedIncomeDialog(true)}
                  className="h-7 px-2 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                >
                  View
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0 flex-1 flex flex-col justify-start">
              <p className="text-3xl font-bold text-white">{showCurrency(wallet?.lockedIncomeWallet)}</p>
              <p className="text-xs text-white/50 mt-1">Level income locked until direct referral qualification</p>
            </CardContent>
          </Card>
        </div>

        <Card className="glass border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-[#111827] to-[#111827] mb-8">
          <CardHeader className="pb-2">
            <div className="flex flex-col items-start gap-3">
              <CardTitle className="text-slate-900 dark:text-white flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-400" />
                Monthly Royalty Achievement
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-white/10 bg-white/5 p-4 md:flex md:min-h-[152px] md:flex-col md:justify-center">
                <p className="text-sm text-slate-500 dark:text-white/50">Current Status</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {currentRoyaltyMilestone ? `${currentRoyaltyMilestone.percent}%` : 'N/A'}
                </p>
                {currentRoyaltyMilestone ? (
                  <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                    <p className="text-sm font-medium text-emerald-300">
                      You are qualified for Level {currentRoyaltyMilestone.qualifiedLevel} Royalty Income.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-white/50 mt-2">
                    Reach qualified Level 3 to unlock royalty status.
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-4 md:flex md:min-h-[152px] md:flex-col md:justify-center">
                <p className="text-sm text-slate-500 dark:text-white/50">Royalty Income</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {formatCurrency(wallet?.royaltyWallet || 0)}
                </p>
              </div>
            </div>
            {nextRoyaltyMilestone ? (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
                <p className="text-sm font-medium text-amber-300">
                  {currentRoyaltyMilestone ? 'Next Milestone:' : 'Unlock Rewards:'}
                </p>
                <p className="text-sm text-slate-700 dark:text-white/80 mt-1">
                  Earn {nextRoyaltyMilestone.percent}% Royalty Income after qualifying Level {nextRoyaltyMilestone.qualifiedLevel}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4">
                <p className="text-sm font-medium text-emerald-300">Top royalty milestone unlocked</p>
                <p className="text-sm text-slate-700 dark:text-white/80 mt-1">
                  You have already reached the highest royalty status available right now.
                </p>
              </div>
            )}
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowRoyaltyInfoDialog(true)}
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hover:text-emerald-200"
              >
                How Royalty Works
              </Button>
            </div>
          </CardContent>
        </Card>

        {(wallet?.pendingSystemFee || 0) > 0 && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
            <p className="text-sm text-amber-300">
              Pending system fee: <span className="font-semibold">${wallet?.pendingSystemFee}</span> — will be deducted automatically from your next income.
            </p>
          </div>
        )}

        {/* Achievements Section */}
        <div className="mb-8">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-400" />
            Tour Achievement
          </h2>
          <Card className="glass border-white/10">
            <CardContent className="space-y-4 py-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                  <p className="text-sm text-slate-500 dark:text-white/50">Current Status</p>
                  <p className={`mt-2 text-xl font-bold ${tourAchievementStatus.completed ? 'text-emerald-400' : 'text-slate-900 dark:text-white'}`}>
                    {tourAchievementStatus.currentStatus}
                  </p>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                  <p className="text-sm text-slate-500 dark:text-white/50">Next Milestone</p>
                  <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
                    {tourAchievementStatus.nextMilestone}
                  </p>
                </div>
              </div>

              <div className={`rounded-lg border p-4 ${tourAchievementStatus.completed ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-amber-500/20 bg-amber-500/10'}`}>
                <p className={`text-sm font-medium ${tourAchievementStatus.completed ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {tourAchievementStatus.completed ? 'Achievement Summary' : 'Qualification Requirement'}
                </p>
                <p className="text-sm text-slate-700 dark:text-white/80 mt-1">
                  {tourAchievementStatus.requirement}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4 mb-8">
          <Button
            variant="outline"
            className="dashboard-action h-auto py-4 flex flex-col items-center gap-2 border-slate-200 bg-white hover:bg-slate-100 dark:border-white/10 dark:bg-[#1f2937]/50 dark:hover:bg-[#1f2937]"
            onClick={() => navigate('/deposit')}
          >
            <PlusCircle className="w-5 h-5 text-emerald-500" />
            <span className="text-sm">Deposit</span>
          </Button>
          <Button
            variant="outline"
            className="dashboard-action h-auto py-4 flex flex-col items-center gap-2 border-slate-200 bg-white hover:bg-slate-100 dark:border-white/10 dark:bg-[#1f2937]/50 dark:hover:bg-[#1f2937]"
            onClick={() => navigate('/fund-transfer')}
          >
            <ArrowUpRight className="w-5 h-5 text-[#118bdd]" />
            <span className="text-sm">Fund Transfer</span>
          </Button>
          <Button
            variant="outline"
            className="dashboard-action h-auto py-4 flex flex-col items-center gap-2 border-slate-200 bg-white hover:bg-slate-100 dark:border-white/10 dark:bg-[#1f2937]/50 dark:hover:bg-[#1f2937]"
            onClick={() => navigate('/withdraw')}
          >
            <DollarSign className="w-5 h-5 text-amber-500" />
            <span className="text-sm">Withdraw</span>
          </Button>
          <Button
            variant="outline"
            className="dashboard-action h-auto py-4 flex flex-col items-center gap-2 border-slate-200 bg-white hover:bg-slate-100 dark:border-white/10 dark:bg-[#1f2937]/50 dark:hover:bg-[#1f2937]"
            onClick={() => navigate('/pin-wallet')}
          >
            <Ticket className="w-5 h-5 text-purple-500" />
            <span className="text-sm">PIN Wallet</span>
          </Button>
          <Button
            variant="outline"
            className="dashboard-action h-auto py-4 flex flex-col items-center gap-2 border-slate-200 bg-white hover:bg-slate-100 dark:border-white/10 dark:bg-[#1f2937]/50 dark:hover:bg-[#1f2937]"
            onClick={() => navigate('/matrix')}
          >
            <Users className="w-5 h-5 text-orange-500" />
            <span className="text-sm">My Network</span>
          </Button>
          <Button
            variant="outline"
            className="dashboard-action h-auto py-4 flex flex-col items-center gap-2 border-slate-200 bg-white hover:bg-slate-100 dark:border-white/10 dark:bg-[#1f2937]/50 dark:hover:bg-[#1f2937]"
            onClick={() => navigate('/referrals')}
          >
            <UserPlus className="w-5 h-5 text-pink-500" />
            <span className="text-sm">Referral</span>
          </Button>
          <Button
            variant="outline"
            className="dashboard-action h-auto py-4 flex flex-col items-center gap-2 border-slate-200 bg-white hover:bg-slate-100 dark:border-white/10 dark:bg-[#1f2937]/50 dark:hover:bg-[#1f2937]"
            onClick={() => navigate('/create-id')}
          >
            <IdCard className="w-5 h-5 text-cyan-500" />
            <span className="text-sm">Create ID</span>
          </Button>
          <Button
            variant="outline"
            className="dashboard-action h-auto py-4 flex flex-col items-center gap-2 border-slate-200 bg-white hover:bg-slate-100 dark:border-white/10 dark:bg-[#1f2937]/50 dark:hover:bg-[#1f2937]"
            onClick={() => navigate('/profile')}
          >
            <UserCog className="w-5 h-5 text-indigo-400" />
            <span className="text-sm">Profile</span>
          </Button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Network Stats */}
          <Card className="glass border-slate-200/80 dark:border-white/10">
            <CardHeader>
              <CardTitle className="text-slate-900 dark:text-white flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-[#118bdd]" />
                Network Statistics
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-slate-100 dark:bg-[#1f2937]/50">
                  <p className="text-sm text-slate-500 dark:text-white/50 mb-1">Left Team</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{formatNumber(downlineStats.left)}</p>
                  <p className="text-xs text-emerald-400">{downlineStats.leftActive} Active</p>
                </div>
                <div className="p-4 rounded-lg bg-slate-100 dark:bg-[#1f2937]/50">
                  <p className="text-sm text-slate-500 dark:text-white/50 mb-1">Right Team</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{formatNumber(downlineStats.right)}</p>
                  <p className="text-xs text-emerald-400">{downlineStats.rightActive} Active</p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-600 dark:text-white/60">My Referrals</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-slate-900 dark:text-white">{effectiveDirectCount}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDirectReferralsDialog(true)}
                      className="h-7 px-2 border-[#118bdd]/40 text-[#118bdd] hover:bg-[#118bdd]/10"
                    >
                      View
                    </Button>
                  </div>
                </div>
                <Progress value={Math.min(effectiveDirectCount * 10, 100)} className="h-2" />
                <p className="text-xs text-slate-500 dark:text-white/40 mt-2">
                  Click `View` to see referral IDs and member details.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-600 dark:text-white/60">Current Level</span>
                  <Badge variant="outline" className="border-[#118bdd] text-[#118bdd]">
                    Level {currentLevelDisplay}
                  </Badge>
                </div>
                <Progress value={(currentLevelDisplay / 10) * 100} className="h-2" />
              </div>
            </CardContent>
          </Card>

          {/* Recent Transactions */}
          <Card className="glass border-slate-200/80 dark:border-white/10">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-slate-900 dark:text-white flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-[#118bdd]" />
                My Transactions
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-[#118bdd]"
                onClick={() => navigate('/transactions')}
              >
                View All
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {transactions.slice(0, 5).map((tx) => {
                  const isOutflow = isOutflowTransaction(tx);
                  return (
                    <div key={tx.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-100 dark:bg-[#1f2937]/50">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isOutflow ? 'bg-red-500/20' : 'bg-emerald-500/20'
                          }`}>
                          {!isOutflow ? (
                            <ArrowDownLeft className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <ArrowUpRight className="w-4 h-4 text-red-500" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900 dark:text-white">
                            {getTransactionTypeLabel(tx.type, tx.description)}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-white/50 truncate">{truncateText(getVisibleTransactionDescription(tx.description), 30)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${isOutflow ? 'text-red-400' : 'text-emerald-400'}`}>
                          {getDisplayAmount(tx)}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-white/40">
                          {new Date(tx.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {transactions.length === 0 && (
                  <p className="text-center text-slate-500 dark:text-white/50 py-8">No transactions yet</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Referral & Support Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Referral Section */}
          <Card className="glass border-slate-200/80 dark:border-white/10">
            <CardContent className="p-6">
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
                    <UserPlus className="w-5 h-5 text-[#118bdd]" />
                    Referral Program
                  </h3>
                  <p className="text-slate-600 dark:text-white/60 text-sm">Invite friends and earn $5 for each activation</p>
                </div>
                <div className="flex items-center gap-3 w-fit">
                  <code className="px-3 py-2 bg-slate-100 dark:bg-[#1f2937] rounded-lg text-xs sm:text-sm text-slate-700 dark:text-white/80 break-all">
                    {getReferralLink()}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={copyReferralLink}
                    className="border-slate-300 hover:bg-slate-100 dark:border-white/20 dark:hover:bg-white/10 shrink-0"
                  >
                    {copied ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <div className="mt-4 flex flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                  onClick={shareReferralOnWhatsApp}
                  className="border-emerald-500/40 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
                >
                  <MessageCircle className="w-4 h-4 mr-2" />
                  Share on WhatsApp
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void shareReferral()}
                  className="border-[#118bdd]/40 text-[#0a6fbe] hover:bg-[#118bdd]/10 dark:text-[#7dd3fc] dark:hover:bg-[#118bdd]/10"
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  Share
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Dedicated Support */}
          <Card className="glass border-slate-200/80 dark:border-white/10">
            <CardContent className="p-6">
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
                    <Ticket className="w-5 h-5 text-purple-500" />
                    Dedicated Support
                  </h3>
                  <p className="text-slate-600 dark:text-white/60 text-sm">
                    Support is ticket-based only. Submit and track your issue inside the platform.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    onClick={() => navigate('/support')}
                    className="bg-[#118bdd] hover:bg-[#0f79be] text-white"
                  >
                    Open Ticket Center
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Withdraw Dialog */}
      <Dialog open={showWithdrawDialog} onOpenChange={handleWithdrawDialogOpenChange}>
        <DialogContent className="glass border-white/10 bg-[#111827] max-h-[92vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-white">Withdraw Funds</DialogTitle>
            <DialogDescription className="text-white/60">
              Withdraw from your Income Wallet ({withdrawalFeePercent}% fee applies)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 overflow-y-auto pr-1">
            <div className="space-y-2">
              <Label className="text-white/80">Amount</Label>
              <Input
                type="number"
                min={10}
                step={10}
                value={withdrawData.amount}
                onChange={(e) => setWithdrawData({ ...withdrawData, amount: e.target.value })}
                placeholder="Enter amount"
                className="bg-[#1f2937] border-white/10 text-white"
              />
              <p className="text-[11px] text-white/55">Minimum $10 and only multiples of $10 (10, 20, 30...)</p>
            </div>
            <div className="space-y-2">
              <Label className="text-white/80">USDT (BEP-20) Address</Label>
              <Input
                value={withdrawData.address}
                onChange={(e) => setWithdrawData({ ...withdrawData, address: e.target.value })}
                placeholder="Enter wallet address"
                className="bg-[#1f2937] border-white/10 text-white"
              />
              {displayUser?.usdtAddress && (
                <p className="text-[11px] text-[#118bdd] break-all">
                  USDT (BEP-20) Address Saved in Profile : {displayUser.usdtAddress}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-white/80">Payout QR Code (Optional)</Label>
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => void handleWithdrawQrUpload(e)}
                className="bg-[#1f2937] border-white/10 text-white file:text-white"
              />
              {withdrawData.qrCode && (
                <div className="rounded-lg border border-white/10 bg-[#1f2937] p-3 space-y-2 max-w-[220px]">
                  <img src={withdrawData.qrCode} alt="Payout QR preview" className="w-full max-h-28 object-contain rounded" />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setWithdrawData((prev) => ({ ...prev, qrCode: '' }))}
                    className="border-red-500/30 text-red-300 hover:bg-red-500/10"
                  >
                    Remove QR
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-white/80">Transaction Password</Label>
              <Input
                type="password"
                value={withdrawTransactionPassword}
                onChange={(e) => setWithdrawTransactionPassword(e.target.value)}
                placeholder="Enter transaction password"
                className="bg-[#1f2937] border-white/10 text-white"
              />
            </div>
            {settings.requireOtpForTransactions && (
              <div className="space-y-2">
                <Label className="text-white/80">Email OTP</Label>
                <div className="flex gap-2">
                  <Input
                    value={withdrawOtp}
                    onChange={(e) => setWithdrawOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    maxLength={6}
                    placeholder="Enter OTP"
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSendWithdrawOtp}
                    disabled={isSendingWithdrawOtp || withdrawOtpResend.isCoolingDown}
                    className="border-white/20 text-white hover:bg-white/10"
                  >
                    {isSendingWithdrawOtp
                      ? 'Sending...'
                      : !isWithdrawOtpSent
                        ? 'Send OTP'
                        : withdrawOtpResend.isCoolingDown
                          ? `Resend in ${withdrawOtpResend.remainingSeconds}s`
                          : 'Resend OTP'}
                  </Button>
                </div>
                {isWithdrawOtpSent && (
                  <p className="text-xs text-emerald-400">OTP sent. Check your email.</p>
                )}
              </div>
            )}
            {withdrawData.amount && (
              <div className="p-3 rounded-lg bg-[#1f2937]">
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-white/60">Amount</span>
                  <span className="text-sm text-white">${withdrawData.amount}</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-white/60">Fee ({withdrawalFeePercent}%)</span>
                  <span className="text-sm text-red-400">-${(parseFloat(withdrawData.amount || '0') * (withdrawalFeePercent / 100)).toFixed(2)}</span>
                </div>
                <div className="border-t border-white/10 my-1" />
                <div className="flex justify-between">
                  <span className="text-sm text-white/60">You Receive</span>
                  <span className="text-sm text-emerald-400">${(parseFloat(withdrawData.amount || '0') * (1 - withdrawalFeePercent / 100)).toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-3 pt-3 border-t border-white/10 shrink-0 bg-[#111827]">
            <Button
              variant="outline"
              onClick={() => {
                setShowWithdrawDialog(false);
                setWithdrawData((prev) => ({ ...prev, amount: '', qrCode: '' }));
                setWithdrawTransactionPassword('');
                setWithdrawOtp('');
                setIsWithdrawOtpSent(false);
                withdrawOtpResend.resetCooldown();
              }}
              className="flex-1 border-white/20 text-white hover:bg-white/10"
            >
              Cancel
            </Button>
            <Button
              onClick={handleWithdraw}
              disabled={
                isLoading
                || !withdrawTransactionPassword
                || !(String(withdrawData.address || '').trim())
                || (settings.requireOtpForTransactions && !withdrawOtp)
              }
              className="flex-1 btn-primary"
            >
              {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Withdraw'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Direct Referrals Dialog */}
      <Dialog open={showDirectReferralsDialog} onOpenChange={setShowDirectReferralsDialog}>
        <DialogContent
          className="glass border-white/10 bg-[#111827] max-w-xl"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-white">My Referrals</DialogTitle>
            <DialogDescription className="text-white/60">
              Total referrals: {directReferralUsers.length}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={directReferralSearch}
                onChange={(e) => setDirectReferralSearch(e.target.value)}
                placeholder="Search by User ID or name"
                className="bg-[#1f2937] border-white/10 text-white flex-1"
              />
              <select
                value={directReferralSort}
                onChange={(e) => setDirectReferralSort(e.target.value as 'asc' | 'desc')}
                className="h-10 rounded-md bg-[#1f2937] border border-white/10 text-white px-3 text-sm"
              >
                <option value="desc">Newest first (DESC)</option>
                <option value="asc">Oldest first (ASC)</option>
              </select>
            </div>

            <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
              {sortedDirectReferrals.length === 0 ? (
                <p className="text-center text-white/50 py-8">No direct referrals found</p>
              ) : (
                sortedDirectReferrals.map((refUser) => (
                  <div key={refUser.id} className="flex items-center justify-between rounded-md bg-[#1f2937]/60 px-3 py-2">
                    <div>
                      <p className="text-sm text-white font-medium">{refUser.fullName}</p>
                      <p className="text-xs text-[#118bdd] font-mono">{refUser.userId}</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={refUser.isActive ? 'border-emerald-500/40 text-emerald-400' : 'border-amber-500/40 text-amber-400'}
                    >
                      {refUser.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Locked Income Dialog */}
      <Dialog open={showLockedIncomeDialog} onOpenChange={setShowLockedIncomeDialog}>
        <DialogContent className="glass border-white/10 bg-[#111827] max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-white">Locked Income Details</DialogTitle>
            <DialogDescription className="text-white/60">
              Current Direct Referrals: {effectiveDirectCount}. Complete required direct referrals to unlock each level amount.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {lockedIncomeBreakdown.length === 0 ? (
              <p className="text-center text-white/50 py-8">No locked income pending.</p>
            ) : (
              <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
                {lockedIncomeBreakdown.map((item) => (
                  <div key={item.level} className="rounded-md bg-[#1f2937]/60 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm text-white font-medium">Level {item.level}</p>
                        <p className="text-xs text-white/50">
                          Required Directs: {item.requiredDirect} | Your Directs: {item.currentDirect}
                        </p>
                        <p className="text-xs text-amber-400 mt-1">
                          {item.reason}
                        </p>
                        <p className="text-[11px] text-white/45 mt-1">
                          First-two lock: {formatCurrency(item.lockedFirstTwoAmount)} | Referral-rule lock: {formatCurrency(item.lockedQualificationAmount)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-amber-400">{formatCurrency(item.lockedAmount)}</p>
                        <p className="text-xs text-white/50">
                          {item.remainingDirect > 0
                            ? `Need ${item.remainingDirect} more direct referral${item.remainingDirect > 1 ? 's' : ''}`
                            : 'Ready to unlock'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showRoyaltyInfoDialog} onOpenChange={setShowRoyaltyInfoDialog}>
        <DialogContent
          showCloseButton={false}
          className="glass border-white/10 bg-[#111827] w-[calc(100vw-1.5rem)] max-w-2xl max-h-[88vh] overflow-hidden p-0"
        >
          <DialogClose
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <X />
            <span className="sr-only">Close</span>
          </DialogClose>

          <div className="px-4 pt-4 sm:px-6 sm:pt-6">
            <DialogHeader className="pr-10 text-center sm:text-center">
              <DialogTitle className="text-white text-center">How Royalty Works</DialogTitle>
            </DialogHeader>
          </div>

          <div className="max-h-[calc(88vh-8rem)] overflow-y-auto px-4 pb-4 pr-3 sm:px-6 sm:pb-6 sm:pr-4">
            <div className="mt-4 space-y-4 text-sm text-white/80">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <p className="font-semibold text-emerald-300">
                  {hasUnlockedRoyalty
                    ? `You are currently eligible for ${royaltyExplanation.percent}% royalty because you have qualified Level ${royaltyExplanation.qualifiedLevel}.`
                    : `You will become eligible for ${royaltyExplanation.percent}% royalty after qualifying Level ${royaltyExplanation.qualifiedLevel}.`}
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                <p>
                  The system first calculates the <span className="font-semibold text-white">total monthly generated system fee</span>.
                </p>
                <p>
                  Then <span className="font-semibold text-white">{royaltyExplanation.percent}%</span> of that monthly total becomes the
                  <span className="font-semibold text-white"> Level {royaltyExplanation.qualifiedLevel} Royalty Pool</span>.
                </p>
                <p>
                  That pool is divided equally among all users who are qualified for
                  <span className="font-semibold text-white"> Level {royaltyExplanation.qualifiedLevel} Royalty</span> in that month.
                </p>
              </div>

              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 space-y-2">
                <p className="font-semibold text-amber-300">Example</p>
                <p>
                  If the monthly generated system fee in one month is <span className="font-semibold text-white">${royaltyExplanation.monthlySystemFee.toLocaleString()}</span>,
                  then <span className="font-semibold text-white">{royaltyExplanation.percent}% of ${royaltyExplanation.monthlySystemFee.toLocaleString()} = ${royaltyExplanation.royaltyPool.toLocaleString()}</span>.
                </p>
                <p>
                  If <span className="font-semibold text-white">{royaltyExplanation.eligibleUsers} users</span> are eligible for Level {royaltyExplanation.qualifiedLevel} Royalty,
                  then <span className="font-semibold text-white">${royaltyExplanation.royaltyPool.toLocaleString()} / {royaltyExplanation.eligibleUsers} = ${royaltyExplanation.perUserRoyalty.toLocaleString()}</span>.
                </p>
                <p>
                  So each qualified user will receive <span className="font-semibold text-white">${royaltyExplanation.perUserRoyalty.toLocaleString()}</span> as royalty income for that month.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                <p className="font-semibold text-white">Royalty Percentage by Qualified Level</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ROYALTY_MILESTONES.map((milestone) => (
                    <div
                      key={milestone.qualifiedLevel}
                      className={`rounded-lg border px-3 py-2 ${
                        milestone.qualifiedLevel === currentRoyaltyMilestone?.qualifiedLevel
                          ? 'border-emerald-500/30 bg-emerald-500/10'
                          : 'border-white/10 bg-[#1f2937]/60'
                      }`}
                    >
                      <p className="text-sm text-white font-medium">
                        Level {milestone.qualifiedLevel} Royalty
                      </p>
                      <p className={`text-sm ${milestone.qualifiedLevel === currentRoyaltyMilestone?.qualifiedLevel ? 'text-emerald-300' : 'text-white/70'}`}>
                        {milestone.percent}%
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <MobileBottomNav />
    </div>
  );
}
