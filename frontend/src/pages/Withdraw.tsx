/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useAuthStore, useWalletStore, useOtpStore, useSyncRefreshKey } from '@/store';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft, Wallet, CheckCircle, Clock, Upload, RefreshCw, LogOut, Maximize2, Eye, EyeOff
} from 'lucide-react';
import { formatCurrency } from '@/utils/helpers';
import Database from '@/db';
import type { Transaction } from '@/types';
import MobileBottomNav from '@/components/MobileBottomNav';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export default function Withdraw() {
  const navigate = useNavigate();
  const { user, impersonatedUser, isAuthenticated, logout, verifyTransactionPassword } = useAuthStore();
  const { wallet, loadWallet, withdraw } = useWalletStore();
  const { sendOtp, verifyOtp } = useOtpStore();
  const syncKey = useSyncRefreshKey();
  const displayUser = impersonatedUser || user;

  const settings = Database.getSettings();
  const withdrawalFeePercent = settings.withdrawalFeePercent;

  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [payoutQr, setPayoutQr] = useState<string>('');
  const [transactionPassword, setTransactionPassword] = useState('');
  const [showTxPassword, setShowTxPassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [showQrFullscreen, setShowQrFullscreen] = useState(false);
  const [withdrawalHistory, setWithdrawalHistory] = useState<Transaction[]>([]);
  const payoutQrInputRef = useRef<HTMLInputElement>(null);

  const loadWithdrawalHistory = useCallback(() => {
    if (!displayUser) return;
    const rows = Database.getUserTransactions(displayUser.id)
      .filter((tx) => tx.type === 'withdrawal')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setWithdrawalHistory(rows);
  }, [displayUser]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    if (displayUser) {
      loadWallet(displayUser.id);
      loadWithdrawalHistory();
      if (!address.trim() && displayUser.usdtAddress) {
        setAddress(displayUser.usdtAddress);
      }
    }
  }, [address, isAuthenticated, navigate, loadWallet, loadWithdrawalHistory, syncKey, displayUser]);

  const handleLogout = () => {
    logout();
    navigate('/login');
    toast.success('Logged out successfully');
  };

  const handleSendOtp = async () => {
    if (!displayUser) return;
    setIsSendingOtp(true);
    const result = await sendOtp(displayUser.id, displayUser.email, 'withdrawal');
    setIsSendingOtp(false);
    if (result.success) {
      setIsOtpSent(true);
      if (result.status === 'pending') {
        toast.warning(result.message);
      } else {
        toast.success(result.message);
      }
    } else {
      toast.error(result.message);
    }
  };

  const handlePayoutQrUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please upload a valid image for payout QR');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('QR image must be under 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => setPayoutQr(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!displayUser) return;

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    const amountInCents = Math.round(numericAmount * 100);
    if (amountInCents < 1000) {
      toast.error('Minimum withdrawal amount is $10');
      return;
    }
    if (amountInCents % 1000 !== 0) {
      toast.error('Withdrawal amount must be in multiples of $10 (10, 20, 30...)');
      return;
    }

    const payoutAddress = String(address || '').trim();
    if (!payoutAddress) {
      toast.error('USDT (BEP20) address is required');
      return;
    }

    if (!verifyTransactionPassword(displayUser.id, transactionPassword)) {
      toast.error('Invalid transaction password');
      return;
    }

    if (settings.requireOtpForTransactions) {
      if (!otp.trim()) {
        toast.error('Please enter OTP');
        return;
      }
      const isValidOtp = await verifyOtp(displayUser.id, otp, 'withdrawal');
      if (!isValidOtp) {
        toast.error('Invalid or expired OTP');
        return;
      }
    }

    setIsSubmitting(true);
    const result = await withdraw(displayUser.id, numericAmount, payoutAddress, payoutQr || undefined);
    setIsSubmitting(false);

    if (!result.success) {
      toast.error(result.message);
      return;
    }

    toast.success(result.message);
    setShowSuccessDialog(true);
    setAmount('');
    setAddress(payoutAddress);
    setPayoutQr('');
    setTransactionPassword('');
    setOtp('');
    setIsOtpSent(false);
    loadWallet(displayUser.id);
    loadWithdrawalHistory();
  };

  const amountNumber = Number(amount || 0);
  const feeAmount = amountNumber * (withdrawalFeePercent / 100);
  const netAmount = Math.max(0, amountNumber - feeAmount);

  const statusBadge = (status: string) => {
    if (status === 'completed') {
      return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Completed</Badge>;
    }
    if (status === 'pending') {
      return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Pending</Badge>;
    }
    if (status === 'failed') {
      return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Rejected</Badge>;
    }
    return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">{status}</Badge>;
  };

  const renderedHistory = useMemo(() => {
    return withdrawalHistory.map((tx) => {
      const gross = Math.abs(Number(tx.amount || 0));
      const fee = Number(tx.fee || 0);
      const net = Number(tx.netAmount || Math.max(0, gross - fee));
      return {
        ...tx,
        gross,
        fee,
        net
      };
    });
  }, [withdrawalHistory]);

  if (!displayUser) return null;

  return (
    <div className="withdraw-page min-h-screen bg-[#0a0e17] pb-24 md:pb-0">
      <header className="glass sticky top-0 z-50 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-700 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-white" />
                </div>
                <div>
                  <span className="text-base sm:text-xl font-bold text-white">Withdraw Funds</span>
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
                <p className="text-sm text-white/60">Income Wallet</p>
                <p className="text-lg font-bold text-white">{formatCurrency(wallet?.incomeWallet || 0)}</p>
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <Tabs defaultValue="withdraw" className="space-y-6">
          <TabsList className="bg-[#1f2937] border border-white/10 w-full sm:w-auto grid grid-cols-2 sm:inline-flex">
            <TabsTrigger value="withdraw" className="data-[state=active]:bg-[#118bdd]">Make Withdraw</TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-[#118bdd]">Withdraw History</TabsTrigger>
          </TabsList>

          <TabsContent value="withdraw">
            <Card className="glass border-white/10">
              <CardHeader>
                <CardTitle className="text-white">Submit Withdrawal Request</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="p-4 rounded-lg bg-[#1f2937]">
                  <p className="text-white/55 text-sm">Available Withdrawable Balance</p>
                  <p className="text-white text-xl font-semibold mt-1">{formatCurrency(wallet?.incomeWallet || 0)}</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-white/80">Amount</Label>
                  <Input
                    type="number"
                    min={10}
                    step={10}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Enter amount"
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                  <p className="text-[11px] text-white/55">Minimum $10 and only multiples of $10 (10, 20, 30...)</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-white/80">USDT (BEP-20) Address</Label>
                  <Input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Enter wallet address"
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                  {displayUser.usdtAddress && (
                    <p className="text-[11px] text-[#118bdd] break-all">USDT (BEP-20) Address Saved in Profile : {displayUser.usdtAddress}</p>
                  )}
                  <p className="text-[11px] text-white/55">This field is mandatory for withdrawal request.</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-white/80">Payout QR Code (Optional)</Label>
                  <input
                    type="file"
                    ref={payoutQrInputRef}
                    onChange={handlePayoutQrUpload}
                    accept="image/*"
                    className="hidden"
                  />
                  <div
                    onClick={() => payoutQrInputRef.current?.click()}
                    className="border-2 border-dashed border-white/20 rounded-lg p-4 text-center cursor-pointer hover:border-white/35 transition-colors"
                  >
                    {payoutQr ? (
                      <img src={payoutQr} alt="Payout QR" className="max-h-40 mx-auto rounded" />
                    ) : (
                      <div className="text-white/60 text-sm flex items-center justify-center gap-2">
                        <Upload className="w-4 h-4" />
                        Upload payout QR image
                      </div>
                    )}
                  </div>
                  {payoutQr && (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setShowQrFullscreen(true)}
                        className="border-white/20 text-white hover:bg-white/10"
                      >
                        <Maximize2 className="w-3.5 h-3.5 mr-1" />
                        Full Screen
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setPayoutQr('')}
                        className="border-red-500/30 text-red-300 hover:bg-red-500/10"
                      >
                        Remove QR
                      </Button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-white/80">Transaction Password</Label>
                  <div className="relative">
                    <Input
                      type={showTxPassword ? 'text' : 'password'}
                      value={transactionPassword}
                      onChange={(e) => setTransactionPassword(e.target.value)}
                      placeholder="Enter transaction password"
                      className="bg-[#1f2937] border-white/10 text-white pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTxPassword((v) => !v)}
                      className="absolute inset-y-0 right-3 flex items-center text-white/60 hover:text-white"
                      tabIndex={-1}
                    >
                      {showTxPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {settings.requireOtpForTransactions && (
                  <div className="space-y-2">
                    <Label className="text-white/80">Email OTP</Label>
                    <div className="flex gap-2">
                      <Input
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        maxLength={6}
                        placeholder="Enter OTP"
                        className="bg-[#1f2937] border-white/10 text-white"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleSendOtp}
                        disabled={isSendingOtp}
                        className="border-white/20 text-white hover:bg-white/10"
                      >
                        {isSendingOtp ? 'Sending...' : 'Send OTP'}
                      </Button>
                    </div>
                    {isOtpSent && (
                      <p className="text-xs text-emerald-400">OTP sent. Check your email.</p>
                    )}
                  </div>
                )}

                {amount && (
                  <div className="p-3 rounded-lg bg-[#1f2937]">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-white/60">Amount</span>
                      <span className="text-sm text-white">{formatCurrency(amountNumber)}</span>
                    </div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-white/60">Fee ({withdrawalFeePercent}%)</span>
                      <span className="text-sm text-red-400">-{formatCurrency(feeAmount)}</span>
                    </div>
                    <div className="border-t border-white/10 my-1" />
                    <div className="flex justify-between">
                      <span className="text-sm text-white/60">You Receive</span>
                      <span className="text-sm text-emerald-400">{formatCurrency(netAmount)}</span>
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleSubmit}
                  disabled={
                    isSubmitting
                    || !amount
                    || !String(address || '').trim()
                    || !transactionPassword
                    || (settings.requireOtpForTransactions && !otp)
                  }
                  className="w-full btn-primary h-12"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Submit Withdrawal Request
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card className="glass border-white/10">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-white">Withdraw History</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={loadWithdrawalHistory}
                  className="border-white/20 text-white hover:bg-white/10"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {renderedHistory.map((tx) => (
                    <div key={tx.id} className="rounded-xl border border-white/10 bg-[#1f2937]/55 p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-white">{tx.description || 'Withdrawal'}</p>
                          <p className="text-xs text-white/55">{new Date(tx.createdAt).toLocaleString()}</p>
                        </div>
                        {statusBadge(tx.status)}
                      </div>
                      <p className="text-base font-semibold text-red-400">-{formatCurrency(Math.abs(tx.gross))}</p>
                      <p className="text-xs text-white/55">
                        Gross: {formatCurrency(tx.gross)} | Fee: {formatCurrency(tx.fee)} | Net: {formatCurrency(tx.net)}
                      </p>
                      {tx.walletAddress && (
                        <p className="text-xs text-white/50 break-all">USDT (BEP20): {tx.walletAddress}</p>
                      )}
                      {tx.adminReason && (
                        <p className={`text-xs ${tx.status === 'failed' ? 'text-red-300/90' : 'text-white/65'}`}>
                          Reason: {tx.adminReason}
                        </p>
                      )}
                      {tx.adminReceipt && tx.adminReceipt.startsWith('data:image') && (
                        <img src={tx.adminReceipt} alt="Withdrawal Receipt" className="inline-block max-h-44 max-w-full w-auto h-auto rounded border border-white/10 bg-white/5" />
                      )}
                      {tx.adminReceipt && tx.adminReceipt.startsWith('data:application/pdf') && (
                        <a
                          href={tx.adminReceipt}
                          download={`withdrawal-proof-${tx.id}.pdf`}
                          className="text-xs text-[#8fcfff] underline"
                        >
                          Download admin receipt (PDF)
                        </a>
                      )}
                    </div>
                  ))}
                </div>
                {renderedHistory.length === 0 && (
                  <div className="text-center py-12">
                    <Clock className="w-12 h-12 text-white/20 mx-auto mb-4" />
                    <p className="text-white/50">No withdrawal history yet</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={showQrFullscreen} onOpenChange={setShowQrFullscreen}>
        <DialogContent className="glass border-white/10 bg-[#0b1220] max-w-3xl w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] p-4">
          <DialogHeader>
            <DialogTitle className="text-white">Payout QR Code</DialogTitle>
            <DialogDescription className="text-white/60">
              Scan this payout QR for wallet verification
            </DialogDescription>
          </DialogHeader>
          {payoutQr ? (
            <div className="w-full h-[70vh] rounded-lg border border-white/10 bg-black/35 p-3 flex items-center justify-center">
              <img
                src={payoutQr}
                alt="Payout Full QR"
                className="max-h-full max-w-full object-contain rounded bg-white p-2"
              />
            </div>
          ) : (
            <p className="text-white/60 text-sm">No QR uploaded.</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <DialogContent className="glass border-white/10 bg-[#111827]">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CheckCircle className="w-6 h-6 text-emerald-500" />
              Withdrawal Request Submitted
            </DialogTitle>
            <DialogDescription className="text-white/60">
              Your withdrawal request has been submitted and is pending verification.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-4 rounded-lg bg-[#1f2937]">
              <div className="flex items-center gap-2 text-amber-400 mb-2">
                <Clock className="w-4 h-4" />
                <span className="font-medium">Processing Time</span>
              </div>
              <p className="text-white/60 text-sm">Within {settings.withdrawalProcessingHours} hours</p>
            </div>
            <p className="text-white/60 text-sm">
              You will receive a notification once your withdrawal is processed by admin.
            </p>
          </div>
          <Button
            onClick={() => setShowSuccessDialog(false)}
            className="w-full btn-primary"
          >
            Got it
          </Button>
        </DialogContent>
      </Dialog>

      <MobileBottomNav />
    </div>
  );
}
