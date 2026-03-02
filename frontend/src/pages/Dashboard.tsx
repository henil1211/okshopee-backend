import { useEffect, useState } from 'react';
import { useAuthStore, useWalletStore, useMatrixStore, useOtpStore } from '@/store';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  TrendingUp, Users, ArrowUpRight, ArrowDownLeft,
  Copy, CheckCircle, RefreshCw,
  DollarSign, UserPlus, BarChart3, PlusCircle, LogOut, Shield,
  Ticket, Plane, Globe, Heart, Award, UserCog, IdCard, PhoneCall, ShoppingBag, MessageCircle, Share2, Headphones, Mail
} from 'lucide-react';
import { formatCurrency, formatNumber, getInitials, generateAvatarColor, truncateText } from '@/utils/helpers';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import MobileBottomNav from '@/components/MobileBottomNav';
import BrandLogo from '@/components/BrandLogo';
import { toast } from 'sonner';
import Database from '@/db';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout, impersonatedUser, endImpersonation, verifyTransactionPassword } = useAuthStore();
  const { wallet, transactions, loadWallet, transferFunds, withdraw } = useWalletStore();
  const { loadUserDownline, getDownlineStats } = useMatrixStore();
  const { sendOtp, verifyOtp } = useOtpStore();

  const [isLoading, setIsLoading] = useState(false);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false);
  const [showDirectReferralsDialog, setShowDirectReferralsDialog] = useState(false);
  const [showLockedIncomeDialog, setShowLockedIncomeDialog] = useState(false);
  const [directReferralSearch, setDirectReferralSearch] = useState('');
  const [transferData, setTransferData] = useState({ userId: '', amount: '' });
  const [withdrawData, setWithdrawData] = useState({ amount: '', address: '' });
  const [withdrawTransactionPassword, setWithdrawTransactionPassword] = useState('');
  const [withdrawOtp, setWithdrawOtp] = useState('');
  const [isSendingWithdrawOtp, setIsSendingWithdrawOtp] = useState(false);
  const [isWithdrawOtpSent, setIsWithdrawOtpSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const settings = Database.getSettings();
  const withdrawalFeePercent = settings.withdrawalFeePercent;

  const displayUser = impersonatedUser || user;

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    if (displayUser) {
      loadWallet(displayUser.id);
      loadUserDownline(displayUser.userId);
    }
  }, [isAuthenticated, displayUser, navigate, loadWallet, loadUserDownline]);

  const handleTransfer = async () => {
    if (!displayUser) return;
    const amount = parseFloat(transferData.amount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Invalid amount');
      return;
    }

    if (transferData.userId.length !== 7) {
      toast.error('User ID must be 7 digits');
      return;
    }

    setIsLoading(true);
    const result = await transferFunds(displayUser.id, transferData.userId, amount);
    setIsLoading(false);

    if (result.success) {
      toast.success(result.message);
      setShowTransferDialog(false);
      setTransferData({ userId: '', amount: '' });
    } else {
      toast.error(result.message);
    }
  };

  const handleWithdraw = async () => {
    if (!displayUser) return;
    const amount = parseFloat(withdrawData.amount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Invalid amount');
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
      const isValidOtp = await verifyOtp(displayUser.id, withdrawOtp, 'withdrawal');
      if (!isValidOtp) {
        toast.error('Invalid or expired OTP');
        return;
      }
    }

    setIsLoading(true);
    const result = await withdraw(displayUser.id, amount, withdrawData.address);
    setIsLoading(false);

    if (result.success) {
      toast.success(result.message);
      setShowWithdrawDialog(false);
      setWithdrawData({ amount: '', address: '' });
      setWithdrawTransactionPassword('');
      setWithdrawOtp('');
      setIsWithdrawOtpSent(false);
    } else {
      toast.error(result.message);
    }
  };

  const handleSendWithdrawOtp = async () => {
    if (!displayUser) return;
    setIsSendingWithdrawOtp(true);
    const result = await sendOtp(displayUser.id, displayUser.email, 'withdrawal');
    setIsSendingWithdrawOtp(false);
    if (result.success) {
      setIsWithdrawOtpSent(true);
      toast.success('OTP sent to your registered email');
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
    return [
      '*New Earning Opportunity !*',
      '',
      '*ReferNex* = Smart Shopping + Helping System + Referral Income.',
      '',
      'Simple process, Transparent system, Real growth.',
      '',
      '*Join here :*',
      link,
      '',
      '*Note :* A valid *Activation Pin* is required to complete registration.'
    ].join('\n');
  };

  const shareReferralOnWhatsApp = () => {
    const message = getReferralShareMessage();
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const shareReferral = async () => {
    const link = getReferralLink();
    const message = getReferralShareMessage();

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'ReferNex - New Earning Opportunity',
          text: message,
          url: link
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

  const downlineStats = displayUser ? getDownlineStats(displayUser.userId) : { left: 0, right: 0, leftActive: 0, rightActive: 0 };
  const sponsorUser = displayUser?.sponsorId ? Database.getUserByUserId(displayUser.sponsorId) : null;
  const directReferralUsers = displayUser
    ? Database.getUsers()
      .filter(u => u.sponsorId === displayUser.userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];
  const filteredDirectReferrals = directReferralUsers.filter((u) =>
    u.userId.includes(directReferralSearch.trim()) ||
    u.fullName.toLowerCase().includes(directReferralSearch.trim().toLowerCase())
  );
  const currentLevelDisplay = displayUser ? Database.getCurrentMatrixLevel(displayUser.id) : 0;
  const lockedIncomeBreakdown = displayUser ? Database.getLockedIncomeBreakdown(displayUser.id) : [];
  const effectiveDirectCount = displayUser ? Database.getEffectiveDirectCount(displayUser) : 0;
  const isOutflowTransaction = (tx: { amount: number; type: string }) =>
    tx.amount < 0
    || tx.type === 'withdrawal'
    || tx.type === 'give_help'
    || tx.type === 'safety_pool'
    || tx.type === 'activation'
    || tx.type === 'admin_debit';
  const getDisplayAmount = (tx: { amount: number; type: string }) =>
    `${isOutflowTransaction(tx) ? '-' : '+'}${formatCurrency(Math.abs(tx.amount))}`;

  if (!displayUser) return null;

  // Check achievements
  const achievements = [
    {
      key: 'nationalTour',
      label: 'National Tour',
      level: 3,
      icon: Plane,
      achieved: displayUser.achievements?.nationalTour,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/20'
    },
    {
      key: 'internationalTour',
      label: 'International Tour',
      level: 4,
      icon: Globe,
      achieved: displayUser.achievements?.internationalTour,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/20'
    },
    {
      key: 'familyTour',
      label: 'Family International Tour',
      level: 5,
      icon: Heart,
      achieved: displayUser.achievements?.familyTour,
      color: 'text-pink-400',
      bgColor: 'bg-pink-500/20'
    }
  ];

  return (
    <div className="dashboard-page min-h-screen bg-slate-50 pb-24 dark:bg-[#0a0e17] md:pb-0">
      {/* Header */}
      <header className="glass sticky top-0 z-50 border-b border-slate-200/80 dark:border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between min-h-16 py-2 sm:py-0 gap-2">
            <div className="flex items-center gap-3">
              <BrandLogo className="h-10 w-10 rounded-xl" />
              <div>
                <span className="text-base sm:text-xl font-bold text-slate-900 dark:text-white">ReferNex</span>
                <span className="text-xs text-slate-500 hidden sm:block dark:text-white/50">ID: {displayUser.userId}</span>
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

              <div className="flex items-center gap-3">
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
        {/* Welcome Section */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mb-2">
            Welcome back, <span className="gradient-text">{displayUser.fullName.split(' ')[0]}</span>
          </h1>
          <p className="text-slate-600 dark:text-white/60">
            Here is an overview of your referral network, shopping rewards, and earnings.
          </p>
        </div>

        {/* Sponsor Detail & Affiliate MarketPlace */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Sponsor Detail */}
          {sponsorUser && (
            <Card className="glass border-slate-200/80 dark:border-white/10">
              <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-500 dark:text-white/50 flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#118bdd]" />
                    Sponsor Details
                  </p>
                  <p className="text-lg font-semibold text-slate-900 dark:text-white mt-1">{sponsorUser.fullName}</p>
                  <p className="text-sm text-slate-600 dark:text-white/60">ID: {sponsorUser.userId}</p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!sponsorUser.phone) {
                      toast.error('Sponsor mobile number not available');
                      return;
                    }
                    window.location.href = `tel:${sponsorUser.phone}`;
                  }}
                  className="border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                >
                  <PhoneCall className="w-4 h-4 mr-2" />
                  Call Sponsor
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Affiliate MarketPlace */}
          <Card className="glass border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 to-transparent dark:from-emerald-900/20">
            <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500 dark:text-white/50 flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-emerald-500" />
                  Affiliate MarketPlace
                </p>
                <p className="text-sm text-slate-600 dark:text-white/60 mt-1">
                  Products and services from leading global brands are available.
                </p>
              </div>
              <Button
                onClick={() => navigate('/e-commerce')}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <ShoppingBag className="w-4 h-4 mr-2" />
                Click & Visit MarketPlace
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Three Wallet System */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="wallet-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-white/60 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-500" />
                Fund Wallet
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-white">{formatCurrency(wallet?.depositWallet || 0)}</p>
              <p className="text-xs text-white/50 mt-1">Add fund for PIN requests and P2P fund transfer</p>
            </CardContent>
          </Card>

          <Card className="wallet-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-white/60 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-cyan-400" />
                Total Earnings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-white">{formatCurrency(wallet?.totalReceived || 0)}</p>
              <p className="text-xs text-white/50 mt-1">Lifetime earnings credited to your account</p>
            </CardContent>
          </Card>

          <Card className="wallet-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-white/60 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-purple-500" />
                Available Income
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-white">{formatCurrency(wallet?.incomeWallet || 0)}</p>
              <p className="text-xs text-white/50 mt-1">Available funds for transfer and withdrawals</p>
            </CardContent>
          </Card>

          <Card className="wallet-card">
            <CardHeader className="pb-2">
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
            <CardContent>
              <p className="text-3xl font-bold text-white">{formatCurrency(wallet?.lockedIncomeWallet || 0)}</p>
              <p className="text-xs text-white/50 mt-1">Level income locked until direct referral qualification</p>
            </CardContent>
          </Card>
        </div>

        {/* Achievements Section */}
        <div className="mb-8">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-400" />
            Tour Achievements
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {achievements.map((achievement) => {
              const Icon = achievement.icon;
              return (
                <div
                  key={achievement.key}
                  className={`p-4 rounded-xl border ${achievement.achieved
                    ? `${achievement.bgColor} ${achievement.key === 'nationalTour'
                      ? 'border-blue-500/50'
                      : achievement.key === 'internationalTour'
                        ? 'border-purple-500/50'
                        : 'border-pink-500/50'
                    }`
                    : 'border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-[#1f2937]/50'
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${achievement.achieved ? achievement.bgColor : 'bg-white/10'
                      }`}>
                      <Icon className={`w-6 h-6 ${achievement.achieved ? achievement.color : 'text-slate-400 dark:text-white/40'}`} />
                    </div>
                    <div>
                      <p className={`font-medium ${achievement.achieved ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-white/60'}`}>
                        {achievement.label} — <span className="text-xs font-normal text-slate-500 dark:text-white/50">Complete Level {achievement.level}</span>
                      </p>
                      <p className="text-xs text-slate-400 dark:text-white/40 mt-1">
                        You must receive help from all users in your Level {achievement.level} to be considered Level {achievement.level} qualified.
                      </p>
                    </div>
                  </div>
                  {achievement.achieved && (
                    <div className="mt-3 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm text-emerald-400">Achieved!</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
            onClick={() => setShowTransferDialog(true)}
          >
            <ArrowUpRight className="w-5 h-5 text-[#118bdd]" />
            <span className="text-sm">Fund Transfer</span>
          </Button>
          <Button
            variant="outline"
            className="dashboard-action h-auto py-4 flex flex-col items-center gap-2 border-slate-200 bg-white hover:bg-slate-100 dark:border-white/10 dark:bg-[#1f2937]/50 dark:hover:bg-[#1f2937]"
            onClick={() => setShowWithdrawDialog(true)}
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
            onClick={copyReferralLink}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  <span className="text-sm text-slate-600 dark:text-white/60">Direct Referrals</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-slate-900 dark:text-white">{displayUser.directCount}</span>
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
                <Progress value={Math.min(displayUser.directCount * 10, 100)} className="h-2" />
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
                          <p className="text-sm font-medium text-slate-900 dark:text-white capitalize">
                            {tx.type.replace('_', ' ')}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-white/50 truncate">{truncateText(tx.description, 30)}</p>
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
                    <Headphones className="w-5 h-5 text-purple-500" />
                    Dedicated Support
                  </h3>
                  <p className="text-slate-600 dark:text-white/60 text-sm">Need help? Our support team is here for you.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    variant="outline"
                    onClick={() => window.open('mailto:support@refernex.com', '_blank')}
                    className="border-purple-500/40 text-purple-700 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-purple-500/10"
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    Email Support
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => window.open('https://wa.me/919999999999', '_blank', 'noopener,noreferrer')}
                    className="border-emerald-500/40 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
                  >
                    <MessageCircle className="w-4 h-4 mr-2" />
                    WhatsApp Support
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Transfer Dialog */}
      <Dialog open={showTransferDialog} onOpenChange={setShowTransferDialog}>
        <DialogContent className="glass border-white/10 bg-[#111827]">
          <DialogHeader>
            <DialogTitle className="text-white">Transfer Fund Wallet</DialogTitle>
            <DialogDescription className="text-white/60">
              Transfer fund wallet balance to your upline or downline (7-digit ID required)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-white/80">Recipient User ID (7 digits)</Label>
              <Input
                value={transferData.userId}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 7);
                  setTransferData({ ...transferData, userId: value });
                }}
                maxLength={7}
                placeholder="Enter 7-digit ID"
                className="bg-[#1f2937] border-white/10 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-white/80">Amount</Label>
              <Input
                type="number"
                value={transferData.amount}
                onChange={(e) => setTransferData({ ...transferData, amount: e.target.value })}
                placeholder="Enter amount"
                className="bg-[#1f2937] border-white/10 text-white"
              />
            </div>
            <div className="p-3 rounded-lg bg-[#1f2937]">
              <p className="text-sm text-white/60">Available Fund Wallet Balance: {formatCurrency(wallet?.depositWallet || 0)}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setShowTransferDialog(false)}
              className="flex-1 border-white/20 text-white hover:bg-white/10"
            >
              Cancel
            </Button>
            <Button
              onClick={handleTransfer}
              disabled={isLoading || transferData.userId.length !== 7}
              className="flex-1 btn-primary"
            >
              {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Transfer'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Withdraw Dialog */}
      <Dialog open={showWithdrawDialog} onOpenChange={setShowWithdrawDialog}>
        <DialogContent className="glass border-white/10 bg-[#111827]">
          <DialogHeader>
            <DialogTitle className="text-white">Withdraw Funds</DialogTitle>
            <DialogDescription className="text-white/60">
              Withdraw from your Income Wallet ({withdrawalFeePercent}% fee applies)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-white/80">Amount</Label>
              <Input
                type="number"
                value={withdrawData.amount}
                onChange={(e) => setWithdrawData({ ...withdrawData, amount: e.target.value })}
                placeholder="Enter amount"
                className="bg-[#1f2937] border-white/10 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-white/80">USDT (BEP-20) Address</Label>
              <Input
                value={withdrawData.address}
                onChange={(e) => setWithdrawData({ ...withdrawData, address: e.target.value })}
                placeholder="Enter wallet address"
                className="bg-[#1f2937] border-white/10 text-white"
              />
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
                    disabled={isSendingWithdrawOtp}
                    className="border-white/20 text-white hover:bg-white/10"
                  >
                    {isSendingWithdrawOtp ? 'Sending...' : 'Send OTP'}
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
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setShowWithdrawDialog(false);
                setWithdrawTransactionPassword('');
                setWithdrawOtp('');
                setIsWithdrawOtpSent(false);
              }}
              className="flex-1 border-white/20 text-white hover:bg-white/10"
            >
              Cancel
            </Button>
            <Button
              onClick={handleWithdraw}
              disabled={isLoading || !withdrawTransactionPassword || (settings.requireOtpForTransactions && !withdrawOtp)}
              className="flex-1 btn-primary"
            >
              {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Withdraw'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Direct Referrals Dialog */}
      <Dialog open={showDirectReferralsDialog} onOpenChange={setShowDirectReferralsDialog}>
        <DialogContent className="glass border-white/10 bg-[#111827] max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-white">Direct Referrals</DialogTitle>
            <DialogDescription className="text-white/60">
              Total direct referrals: {directReferralUsers.length}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Input
              value={directReferralSearch}
              onChange={(e) => setDirectReferralSearch(e.target.value)}
              placeholder="Search by User ID or name"
              className="bg-[#1f2937] border-white/10 text-white"
            />

            <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
              {filteredDirectReferrals.length === 0 ? (
                <p className="text-center text-white/50 py-8">No direct referrals found</p>
              ) : (
                filteredDirectReferrals.map((refUser) => (
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
      <MobileBottomNav />
    </div>
  );
}
