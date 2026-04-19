import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Eye, EyeOff, LogOut, RefreshCw, Shield, Wallet } from 'lucide-react';

import { useAuthStore, useWalletStore, useOtpStore, useSyncRefreshKey, computeSpendableIncomeBalance } from '@/store';
import Database from '@/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import MobileBottomNav from '@/components/MobileBottomNav';
import { useOtpResend } from '@/hooks/use-otp-resend';
import { formatCurrency } from '@/utils/helpers';
import { toast } from 'sonner';

export default function FundTransfer() {
  const navigate = useNavigate();
  const { user, impersonatedUser, isAuthenticated, logout } = useAuthStore();
  const { wallet, loadWallet, transferFunds, v2ReadHealthy, v2ReadError } = useWalletStore();
  const { sendOtp } = useOtpStore();
  const syncKey = useSyncRefreshKey();
  const displayUser = impersonatedUser || user;

  const [transferData, setTransferData] = useState<{ userId: string; amount: string; source: 'fund' | 'income' | 'royalty'; destination: 'fund' | 'income' }>({
    userId: '',
    amount: '',
    source: 'fund',
    destination: 'fund'
  });
  const [transferTransactionPassword, setTransferTransactionPassword] = useState('');
  const [showTransferTxPassword, setShowTransferTxPassword] = useState(false);
  const [transferOtp, setTransferOtp] = useState('');
  const [isSendingTransferOtp, setIsSendingTransferOtp] = useState(false);
  const [isTransferOtpSent, setIsTransferOtpSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const transferOtpResend = useOtpResend(30);

  const isRoyaltyTransfer = transferData.source === 'royalty';
  const isExternalTransfer = transferData.source !== 'royalty';
  const isIncomeToFundSelfTransferMode = transferData.source === 'income' && transferData.destination === 'fund';
  const topWalletLabel = transferData.source === 'income'
    ? 'Income Wallet'
    : transferData.source === 'royalty'
      ? 'Royalty Wallet'
      : 'Fund Wallet';
  const topWalletAmount = transferData.source === 'income'
    ? formatCurrency(computeSpendableIncomeBalance(wallet, { lockedAlreadyExcluded: v2ReadHealthy }))
    : transferData.source === 'royalty'
      ? formatCurrency(wallet?.royaltyWallet || 0)
      : formatCurrency(wallet?.depositWallet || 0);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (!displayUser) return;
    loadWallet(displayUser.id, { v2Only: true });
  }, [isAuthenticated, displayUser, navigate, loadWallet, syncKey]);

  useEffect(() => {
    const cleanId = transferData.userId.trim();
    if (cleanId.length === 7) {
      const recipient = Database.getUserByUserId(cleanId);
      setRecipientName(recipient?.fullName || '');
    } else {
      setRecipientName('');
    }
  }, [transferData.userId, syncKey]);

  const resetTransferSecurity = () => {
    setTransferTransactionPassword('');
    setTransferOtp('');
    setIsSendingTransferOtp(false);
    setIsTransferOtpSent(false);
    setShowTransferTxPassword(false);
    transferOtpResend.resetCooldown();
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
    toast.success('Logged out successfully');
  };

  const handleSendTransferOtp = async () => {
    if (!displayUser) return;
    if (!v2ReadHealthy) {
      toast.error(v2ReadError || 'Live V2 sync is unavailable. Please refresh and try again.');
      return;
    }
    setIsSendingTransferOtp(true);
    const result = await sendOtp(displayUser.userId, displayUser.email, 'transaction');
    setIsSendingTransferOtp(false);
    if (result.success) {
      setIsTransferOtpSent(true);
      transferOtpResend.startCooldown();
      if (result.status === 'pending') {
        toast.warning(result.message);
      } else {
        toast.success(result.message);
      }
    } else {
      toast.error(result.message);
    }
  };

  const handleTransfer = async () => {
    if (!displayUser) return;
    if (isLoading) return;
    if (!v2ReadHealthy) {
      toast.error(v2ReadError || 'Live V2 sync is unavailable. Please refresh and try again.');
      return;
    }
    const amount = parseFloat(transferData.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    const targetId = transferData.userId.trim();
    const security = isExternalTransfer
      ? { transactionPassword: transferTransactionPassword, otp: transferOtp }
      : undefined;

    setIsLoading(true);
    const result = await transferFunds(
      displayUser.id,
      targetId,
      amount,
      transferData.source,
      transferData.destination,
      security
    );
    setIsLoading(false);

    if (!result.success) {
      toast.error(result.message);
      return;
    }

    toast.success(result.message);
    loadWallet(displayUser.id, { v2Only: true });
    setTransferData({ userId: '', amount: '', source: transferData.source, destination: transferData.destination });
    resetTransferSecurity();
  };

  if (!displayUser) return null;

  const effectiveRecipientUserId = transferData.userId.trim() || (isIncomeToFundSelfTransferMode ? displayUser.userId : '');
  const effectiveRecipientName = recipientName || (isIncomeToFundSelfTransferMode && !transferData.userId.trim() ? displayUser.fullName : '');
  const hasRecipientId = effectiveRecipientUserId.length > 0;
  const recipientResolved = effectiveRecipientUserId.length === 7
    && (effectiveRecipientUserId === displayUser.userId || !!Database.getUserByUserId(effectiveRecipientUserId));
  const recipientIsInvalid = isRoyaltyTransfer
    ? false
    : !hasRecipientId || !recipientResolved;

  return (
    <div className="fund-transfer-page min-h-screen bg-[#0a0e17] pb-24 md:pb-0">
      <header className="glass sticky top-0 z-50 border-b border-white/5">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between min-h-16 py-2 sm:py-0 gap-2">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/dashboard')}
                className="text-white/60 hover:text-white"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-sky-700 flex items-center justify-center">
                  <ArrowUpRight className="w-5 h-5 text-white" />
                </div>
                <div>
                  <span className="text-base sm:text-xl font-bold text-white">Fund Transfer</span>
                  {impersonatedUser && (
                    <p className="text-[11px] text-amber-300/90 mt-0.5">
                      Viewing as {impersonatedUser.fullName} ({impersonatedUser.userId})
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm text-white/60">{topWalletLabel}</p>
                <p className="text-lg font-bold text-white">{topWalletAmount}</p>
              </div>
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

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <Card className="glass border-white/10">
          <CardHeader className="flex flex-col gap-2 border-b border-white/10">
            <CardTitle className="text-white flex items-center gap-2">
              <Wallet className="w-5 h-5 text-sky-400" />
              Transfer details
            </CardTitle>
            <p className="text-sm text-white/60">
              Transfer from fund wallet or income wallet to chain members, or from royalty wallet to your own income or fund wallet.
            </p>
          </CardHeader>
          <CardContent className="space-y-5 py-6">
            {!v2ReadHealthy && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
                <p className="text-sm text-rose-200 font-medium">Live V2 sync required for transfers</p>
                <p className="text-xs text-rose-200/90 mt-1">
                  {v2ReadError || 'Live V2 sync is unavailable. Transfer action is blocked to prevent stale balances.'}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-white/80">Transfer From</Label>
              <select
                value={transferData.source}
                onChange={(e) => {
                  const nextSource = e.target.value as 'fund' | 'income' | 'royalty';
                  setTransferData({
                    ...transferData,
                    source: nextSource,
                    userId: nextSource === 'royalty' ? '' : transferData.userId
                  });
                  resetTransferSecurity();
                }}
                className="w-full h-11 rounded-md bg-[#1f2937] border border-white/10 text-white px-3 text-sm"
              >
                <option value="fund">Fund Wallet</option>
                <option value="income">Income Wallet</option>
                <option value="royalty">Royalty Wallet</option>
              </select>
            </div>

            {isRoyaltyTransfer ? (
              <div className="space-y-2">
                <Label className="text-white/80">Transfer To</Label>
                <select
                  value={transferData.destination}
                  onChange={(e) => setTransferData({ ...transferData, destination: e.target.value as 'fund' | 'income' })}
                  className="w-full h-11 rounded-md bg-[#1f2937] border border-white/10 text-white px-3 text-sm"
                >
                  <option value="fund">Fund Wallet</option>
                  <option value="income">Income Wallet</option>
                </select>
                <p className="text-xs text-white/50">
                  Royalty wallet transfers are allowed only to your own fund wallet or income wallet.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-white/80">
                  Recipient User ID
                  {' (7 digits)'}
                </Label>
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
                <p className="text-xs text-white/50">
                  {isIncomeToFundSelfTransferMode
                    ? 'Leave blank to transfer from your Income Wallet to your own Fund Wallet, or enter an upline/downline User ID.'
                    : 'Only upline/downline IDs are allowed.'}
                </p>
                {effectiveRecipientName && (
                  <p className="text-xs text-emerald-400">Recipient: {effectiveRecipientName}</p>
                )}
                {transferData.userId.length === 7 && !effectiveRecipientName && (
                  <p className="text-xs text-rose-400">Recipient ID not found</p>
                )}
              </div>
            )}

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

            {isExternalTransfer && (
              <>
                <div className="border-t border-white/10 pt-4">
                  <Badge className="bg-amber-500/15 text-amber-300 border-amber-400/30">
                    <Shield className="w-4 h-4 mr-2" />
                    Security verification required
                  </Badge>
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Transaction Password</Label>
                  <div className="relative">
                    <Input
                      type={showTransferTxPassword ? 'text' : 'password'}
                      value={transferTransactionPassword}
                      onChange={(e) => setTransferTransactionPassword(e.target.value)}
                      placeholder="Enter transaction password"
                      className="bg-[#1f2937] border-white/10 text-white pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTransferTxPassword((v) => !v)}
                      className="absolute inset-y-0 right-3 flex items-center text-white/60 hover:text-white"
                      tabIndex={-1}
                    >
                      {showTransferTxPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Email OTP</Label>
                  <div className="flex gap-2">
                    <Input
                      value={transferOtp}
                      onChange={(e) => setTransferOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      maxLength={6}
                      placeholder="Enter OTP"
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleSendTransferOtp}
                      disabled={isSendingTransferOtp || transferOtpResend.isCoolingDown || !v2ReadHealthy}
                      className="border-white/20 text-white hover:bg-white/10 whitespace-nowrap"
                    >
                      {isSendingTransferOtp
                        ? <RefreshCw className="w-4 h-4 animate-spin" />
                        : !isTransferOtpSent
                          ? 'Send OTP'
                          : transferOtpResend.isCoolingDown
                            ? `Resend in ${transferOtpResend.remainingSeconds}s`
                            : 'Resend OTP'}
                    </Button>
                  </div>
                  {isTransferOtpSent && (
                    <p className="text-xs text-emerald-400">OTP sent to your registered email</p>
                  )}
                </div>
              </>
            )}

            <div className="rounded-lg border border-white/10 bg-[#1f2937] p-3">
              <p className="text-sm text-white/60">Available Fund Wallet Balance: {formatCurrency(wallet?.depositWallet || 0)}</p>
              <p className="text-sm text-white/60">Available Income Wallet Balance: {formatCurrency(computeSpendableIncomeBalance(wallet, { lockedAlreadyExcluded: v2ReadHealthy }))}</p>
              <p className="text-sm text-white/60">Available Royalty Wallet Balance: {formatCurrency(wallet?.royaltyWallet || 0)}</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              <Button
                variant="outline"
                onClick={() => {
                  resetTransferSecurity();
                  navigate('/dashboard');
                }}
                className="flex-1 border-white/20 text-white hover:bg-white/10"
              >
                Cancel
              </Button>
              <Button
                onClick={handleTransfer}
                disabled={isLoading || !v2ReadHealthy || recipientIsInvalid || (isExternalTransfer && (!transferTransactionPassword.trim() || !transferOtp.trim()))}
                className="flex-1 btn-primary"
              >
                {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Transfer'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>

      <MobileBottomNav />
    </div>
  );
}
