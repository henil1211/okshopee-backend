import { useEffect, useState, useRef } from 'react';
import { useAuthStore, useWalletStore, useSyncRefreshKey } from '@/store';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ArrowLeft, Wallet, Copy, CheckCircle, Clock, 
  AlertCircle, Upload, RefreshCw, Bitcoin, 
  ChevronRight, QrCode, LogOut, Maximize2, Download
} from 'lucide-react';
import { formatCurrency, copyToClipboard } from '@/utils/helpers';
import Database from '@/db';
import type { PaymentMethod, Payment } from '@/types';
import MobileBottomNav from '@/components/MobileBottomNav';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export default function Deposit() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuthStore();
  const { wallet, loadWallet } = useWalletStore();
  const syncKey = useSyncRefreshKey();

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [amount, setAmount] = useState('');
  const [txHash, setTxHash] = useState('');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userPayments, setUserPayments] = useState<Payment[]>([]);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showQrFullscreen, setShowQrFullscreen] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const DEPOSIT_MULTIPLE = 10;

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    
    // Load payment methods
    const methods = Database.getPaymentMethods().filter(m => m.isActive);
    setPaymentMethods(methods);
    
    // Load user payments
    if (user) {
      loadWallet(user.id);
      const payments = Database.getUserPayments(user.id);
      setUserPayments(payments);
    }
  }, [isAuthenticated, user, navigate, loadWallet, syncKey]);

  const handleCopy = async (text: string, field: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
      toast.success('Copied to clipboard!');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setScreenshot(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!user || !selectedMethod || !amount) return;
    
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (numAmount < selectedMethod.minAmount) {
      toast.error(`Minimum amount is ${formatCurrency(selectedMethod.minAmount)}`);
      return;
    }
    if (numAmount > selectedMethod.maxAmount) {
      toast.error(`Maximum amount is ${formatCurrency(selectedMethod.maxAmount)}`);
      return;
    }
    if (numAmount % DEPOSIT_MULTIPLE !== 0) {
      toast.error(`Deposit amount must be in multiples of $${DEPOSIT_MULTIPLE}`);
      return;
    }

    setIsSubmitting(true);

    // Create payment record
    const payment: Payment = {
      id: `pay_${Date.now()}`,
      userId: user.id,
      amount: numAmount,
      method: selectedMethod.type,
      methodName: selectedMethod.name,
      status: 'pending',
      txHash: txHash || undefined,
      screenshot: screenshot || undefined,
      notes: `Deposit request via ${selectedMethod.name}`,
      createdAt: new Date().toISOString()
    };

    Database.createPayment(payment);
    
    // Refresh payments
    const payments = Database.getUserPayments(user.id);
    setUserPayments(payments);

    setIsSubmitting(false);
    setShowSuccessDialog(true);
    
    // Reset form
    setAmount('');
    setTxHash('');
    setScreenshot(null);
    setSelectedMethod(null);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
    toast.success('Logged out successfully');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Completed</Badge>;
      case 'pending':
        return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Pending</Badge>;
      case 'under_review':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Under Review</Badge>;
      case 'failed':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Failed</Badge>;
      default:
        return <Badge className="bg-gray-500/20 text-gray-400">{status}</Badge>;
    }
  };

  const getMethodIcon = (type: string) => {
    switch (type) {
      case 'crypto':
        return <Bitcoin className="w-5 h-5" />;
      default:
        return <Wallet className="w-5 h-5" />;
    }
  };

  if (!user) return null;

  return (
    <div className="deposit-page min-h-screen bg-[#0a0e17] pb-24 md:pb-0">
      {/* Header */}
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
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-white" />
                </div>
                <span className="text-base sm:text-xl font-bold text-white">Deposit Funds</span>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm text-white/60">Deposit Wallet</p>
                <p className="text-lg font-bold text-white">{formatCurrency(wallet?.depositWallet || 0)}</p>
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
        <Tabs defaultValue="deposit" className="space-y-6">
          <TabsList className="bg-[#1f2937] border border-white/10 w-full sm:w-auto grid grid-cols-2 sm:inline-flex">
            <TabsTrigger value="deposit" className="data-[state=active]:bg-[#118bdd]">Make Deposit</TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-[#118bdd]">Deposit History</TabsTrigger>
          </TabsList>

          {/* Deposit Tab */}
          <TabsContent value="deposit">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Payment Methods */}
              <div className="lg:col-span-1">
                <Card className="glass border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white">Select Payment Method</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {paymentMethods.map((method) => (
                      <button
                        key={method.id}
                        onClick={() => setSelectedMethod(method)}
                        className={`w-full p-4 rounded-xl border text-left transition-all ${
                          selectedMethod?.id === method.id
                            ? 'border-[#118bdd] bg-[#118bdd]/10'
                            : 'border-white/10 hover:border-white/20 hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            selectedMethod?.id === method.id ? 'bg-[#118bdd]' : 'bg-[#1f2937]'
                          }`}>
                            {getMethodIcon(method.type)}
                          </div>
                          <div className="flex-1">
                            <p className="text-white font-medium">{method.name}</p>
                            <p className="text-white/50 text-sm">{method.description}</p>
                          </div>
                          <ChevronRight className="w-5 h-5 text-white/40" />
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs text-white/40">
                          <span>Min: {formatCurrency(method.minAmount)}</span>
                          <span>Max: {formatCurrency(method.maxAmount)}</span>
                        </div>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              </div>

              {/* Payment Details */}
              <div className="lg:col-span-2">
                {selectedMethod ? (
                  <Card className="glass border-white/10">
                    <CardHeader>
                      <CardTitle className="text-white flex items-center gap-2">
                        {getMethodIcon(selectedMethod.type)}
                        {selectedMethod.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {/* Instructions */}
                      <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
                        <p className="text-blue-400 text-sm flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          {selectedMethod.instructions}
                        </p>
                      </div>

                      {/* Payment Details */}
                      {selectedMethod.type === 'crypto' && selectedMethod.walletAddress && (
                        <div className="space-y-4">
                          <div className="p-4 rounded-lg bg-[#1f2937]">
                            <Label className="text-white/60 mb-2 block">Wallet Address (BEP-20)</Label>
                            <div className="flex items-center gap-2">
                              <code className="flex-1 p-3 bg-[#0a0e17] rounded-lg text-sm text-white/80 break-all">
                                {selectedMethod.walletAddress}
                              </code>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => handleCopy(selectedMethod.walletAddress!, 'address')}
                                className="border-white/20"
                              >
                                {copiedField === 'address' ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                              </Button>
                            </div>
                          </div>
                          
                          <div className="flex justify-center w-full">
                            <div className="p-4 rounded-lg bg-white mx-auto max-w-sm w-full flex flex-col items-center">
                              {selectedMethod.qrCode ? (
                                <img
                                  src={selectedMethod.qrCode}
                                  alt={`${selectedMethod.name} QR`}
                                  className="w-48 h-48 object-contain mx-auto"
                                />
                              ) : (
                                <QrCode className="w-32 h-32 text-[#0a0e17] mx-auto" />
                              )}
                              <p className="text-center text-[#0a0e17] text-xs mt-2">Scan to Pay</p>
                              {selectedMethod.qrCode && (
                                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setShowQrFullscreen(true)}
                                    className="w-full border-[#0a0e17]/30 text-[#0a0e17] hover:bg-[#0a0e17]/10"
                                  >
                                    <Maximize2 className="w-3.5 h-3.5 mr-1" />
                                    Full Screen QR
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      const link = document.createElement('a');
                                      link.href = selectedMethod.qrCode!;
                                      link.download = `${selectedMethod.name}-qr.png`;
                                      link.click();
                                    }}
                                    className="w-full border-[#0a0e17]/30 text-[#0a0e17] hover:bg-[#0a0e17]/10"
                                  >
                                    <Download className="w-3.5 h-3.5 mr-1" />
                                    Download QR
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Amount Input */}
                      <div className="space-y-2">
                        <Label className="text-white/80">Deposit Amount (USD)</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">$</span>
                          <Input
                            type="number"
                            min={selectedMethod.minAmount}
                            max={selectedMethod.maxAmount}
                            value={amount}
                            onChange={(e) => {
                              setAmount(e.target.value);
                              const val = Number(e.target.value);
                              if (Number.isNaN(val)) {
                                setAmountError('Enter a valid number');
                              } else if (val < selectedMethod.minAmount) {
                                setAmountError(`Minimum amount is ${formatCurrency(selectedMethod.minAmount)}`);
                              } else if (val > selectedMethod.maxAmount) {
                                setAmountError(`Maximum amount is ${formatCurrency(selectedMethod.maxAmount)}`);
                              } else if (val % DEPOSIT_MULTIPLE !== 0) {
                                setAmountError(`Amount must be in multiples of $${DEPOSIT_MULTIPLE}`);
                              } else {
                                setAmountError(null);
                              }
                            }}
                            placeholder={`Min ${formatCurrency(selectedMethod.minAmount)}`}
                            className="pl-8 bg-[#1f2937] border-white/10 text-white"
                          />
                        </div>
                        {amountError && <p className="text-red-400 text-xs">{amountError}</p>}
                      </div>

                      {/* Transaction Hash (for crypto) */}
                      {selectedMethod.type === 'crypto' && (
                        <div className="space-y-2">
                          <Label className="text-white/80">Transaction Hash (Optional)</Label>
                          <Input
                            value={txHash}
                            onChange={(e) => setTxHash(e.target.value)}
                            placeholder="Enter transaction hash / TXID"
                            className="bg-[#1f2937] border-white/10 text-white"
                          />
                        </div>
                      )}

                      {/* Screenshot Upload */}
                      <div className="space-y-2">
                        <Label className="text-white/80">Payment Screenshot (Optional)</Label>
                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={handleFileUpload}
                          accept="image/*"
                          className="hidden"
                        />
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          className="border-2 border-dashed border-white/20 rounded-lg p-6 text-center cursor-pointer hover:border-white/40 transition-colors"
                        >
                          {screenshot ? (
                            <img src={screenshot} alt="Payment Screenshot" className="max-h-40 mx-auto rounded" />
                          ) : (
                            <>
                              <Upload className="w-8 h-8 text-white/40 mx-auto mb-2" />
                              <p className="text-white/60">Click to upload payment screenshot</p>
                              <p className="text-white/40 text-sm">JPG, PNG up to 5MB</p>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Submit Button */}
                      <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !amount || !!amountError}
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
                            Submit Deposit Request
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="glass border-white/10 h-full flex items-center justify-center">
                    <CardContent className="text-center py-16">
                      <Wallet className="w-16 h-16 text-white/20 mx-auto mb-4" />
                      <p className="text-white/60">Select a payment method to continue</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history">
            <Card className="glass border-white/10">
              <CardHeader>
                <CardTitle className="text-white">Deposit History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 sm:hidden">
                  {userPayments.map((payment) => (
                    <div key={payment.id} className="rounded-xl border border-white/10 bg-[#1f2937]/55 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-white">{payment.methodName}</p>
                          <p className="text-xs text-white/55">{new Date(payment.createdAt).toLocaleDateString()}</p>
                        </div>
                        {getStatusBadge(payment.status)}
                      </div>
                      <p className="mt-2 text-base font-semibold text-white">{formatCurrency(payment.amount)}</p>
                      <p className="mt-1 text-xs text-white/60 break-words">{payment.adminNotes || payment.notes || '-'}</p>
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[680px]">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Date</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Method</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Amount</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Status</th>
                        <th className="text-left py-3 px-4 text-white/60 font-medium">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userPayments.map((payment) => (
                        <tr key={payment.id} className="border-b border-white/5 hover:bg-white/5">
                          <td className="py-3 px-4 text-white/60">
                            {new Date(payment.createdAt).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              {getMethodIcon(payment.method)}
                              <span className="text-white">{payment.methodName}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-white font-medium">
                            {formatCurrency(payment.amount)}
                          </td>
                          <td className="py-3 px-4">
                            {getStatusBadge(payment.status)}
                          </td>
                          <td className="py-3 px-4 text-white/60 text-sm">
                            {payment.adminNotes || payment.notes || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {userPayments.length === 0 && (
                  <div className="text-center py-12">
                    <Clock className="w-12 h-12 text-white/20 mx-auto mb-4" />
                    <p className="text-white/50">No deposit history yet</p>
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
            <DialogTitle className="text-white">Payment QR Code</DialogTitle>
            <DialogDescription className="text-white/60">
              {selectedMethod?.name || 'Scan this code for payment'}
            </DialogDescription>
          </DialogHeader>
          {selectedMethod?.qrCode ? (
            <div className="w-full h-[70vh] rounded-lg border border-white/10 bg-black/35 p-3 flex items-center justify-center">
              <img
                src={selectedMethod.qrCode}
                alt={`${selectedMethod.name} Full QR`}
                className="max-h-full max-w-full object-contain rounded bg-white p-2"
              />
            </div>
          ) : (
            <p className="text-white/60 text-sm">No QR available for this payment method.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Success Dialog */}
      <Dialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <DialogContent className="glass border-white/10 bg-[#111827]">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CheckCircle className="w-6 h-6 text-emerald-500" />
              Deposit Request Submitted
            </DialogTitle>
            <DialogDescription className="text-white/60">
              Your deposit request has been submitted and is pending verification.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-4 rounded-lg bg-[#1f2937]">
              <div className="flex items-center gap-2 text-amber-400 mb-2">
                <Clock className="w-4 h-4" />
                <span className="font-medium">Processing Time</span>
              </div>
              <p className="text-white/60 text-sm">
                {selectedMethod?.processingTime || 'Within 24 hours'}
              </p>
            </div>
            <p className="text-white/60 text-sm">
              You will receive a notification once your deposit is verified and funds are added to your wallet.
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
