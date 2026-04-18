import { useState, useEffect, useRef, useMemo, type ChangeEvent } from 'react';
import { useAuthStore, usePinStore, useOtpStore, useSyncRefreshKey, useWalletStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import MobileBottomNav from '@/components/MobileBottomNav';
import { 
  Copy, Check, Send, Ticket, History, Download, 
  MessageCircle, Share2, AlertTriangle, Maximize2,
  RefreshCw, User, Upload, QrCode, Eye, EyeOff
} from 'lucide-react';
import Database from '@/db';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { uploadOptimizedFileToBackend } from '@/utils/helpers';

export default function PinWallet() {
  const navigate = useNavigate();
  const { user, impersonatedUser, isAuthenticated, verifyTransactionPassword } = useAuthStore();
  const { 
    unusedPins, 
    usedPins, 
    receivedPins, 
    transfers, 
    purchaseRequests,
    loadPins, 
    transferPin,
    transferPinsBulk,
    requestPinPurchase,
    buyPinsDirect,
    loadPurchaseRequests,
    copyPinToClipboard 
  } = usePinStore();
  const { sendOtp, verifyOtp } = useOtpStore();
  const { wallet, loadWallet, refreshTransactions } = useWalletStore();
  const syncKey = useSyncRefreshKey();
  const displayUser = useMemo(() => {
    const activeUser = impersonatedUser || user;
    if (!activeUser) return null;
    return Database.getUserByUserId(activeUser.userId) || Database.getUserById(activeUser.id) || activeUser;
  }, [impersonatedUser, user]);

  const [activeTab, setActiveTab] = useState<'unused' | 'used' | 'received' | 'transfer' | 'request'>('unused');
  const [transferUserId, setTransferUserId] = useState('');
  const [selectedPins, setSelectedPins] = useState<string[]>([]);
  const [transactionPassword, setTransactionPassword] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [copiedPin, setCopiedPin] = useState<string | null>(null);
  const [targetUserName, setTargetUserName] = useState('');
  const [transferOtp, setTransferOtp] = useState('');
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isTransferOtpSent, setIsTransferOtpSent] = useState(false);
  const [requestQuantity, setRequestQuantity] = useState('');
  const [requestTxHash, setRequestTxHash] = useState('');
  const [requestProof, setRequestProof] = useState<string | null>(null);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [isBuyingDirect, setIsBuyingDirect] = useState(false);
  const [showDirectBuyModal, setShowDirectBuyModal] = useState(false);
  const [showQrFullscreen, setShowQrFullscreen] = useState(false);
  const [directBuyTransactionPassword, setDirectBuyTransactionPassword] = useState('');
  const [showTransferTxPassword, setShowTransferTxPassword] = useState(false);
  const [showDirectBuyTxPassword, setShowDirectBuyTxPassword] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [bulkSelectCount, setBulkSelectCount] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pinSyncInFlight = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (displayUser) {
      loadPins(displayUser.id);
      loadPurchaseRequests(displayUser.id);
      loadWallet(displayUser.id, { v2Only: true });
    }
  }, [isAuthenticated, displayUser, loadPins, loadPurchaseRequests, loadWallet, navigate, syncKey]);

  useEffect(() => {
    if (!isAuthenticated || !displayUser) return;
    if (pinSyncInFlight.current) return;
    let cancelled = false;
    const syncPins = async () => {
      pinSyncInFlight.current = true;
      try {
        await Database.hydrateFromServer({ strict: true, maxAttempts: 2, timeoutMs: 12000, retryDelayMs: 800 });
      } catch {
        // best-effort sync
      } finally {
        pinSyncInFlight.current = false;
        if (!cancelled) {
          loadPins(displayUser.id);
          loadPurchaseRequests(displayUser.id);
        }
      }
    };
    void syncPins();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, displayUser?.id, loadPins, loadPurchaseRequests]);

  const handleCopyPin = async (pinCode: string) => {
    const success = await copyPinToClipboard(pinCode);
    if (success) {
      setCopiedPin(pinCode);
      toast.success('PIN copied to clipboard');
      setTimeout(() => setCopiedPin(null), 2000);
    } else {
      toast.error('Failed to copy PIN');
    }
  };

  const getPinShareMessage = (pinCode: string) => [
    '*Your Exclusive Activation Details:*',
    '',
    `*Activation PIN : ${pinCode}*`,
    '',
    'Use this PIN to create your account and become part of the *ReferNex* network.',
    '',
    '*Important :* This PIN is valid for one-time use only, so please keep it safe and do not share it publicly.'
  ].join('\n');

  const handleShareWhatsApp = (pinCode: string) => {
    const text = getPinShareMessage(pinCode);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleShareAnywhere = async (pinCode: string) => {
    const text = getPinShareMessage(pinCode);

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'ReferNex Activation Details',
          text
        });
        return;
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      toast.success('PIN message copied. Paste it anywhere to share.');
    } catch {
      toast.error('Unable to share this PIN on your device');
    }
  };

  const checkTargetUser = (value: string) => {
    const cleanValue = value.replace(/\D/g, '').slice(0, 7);
    setTransferUserId(cleanValue);
    
    if (cleanValue.length === 7) {
      const targetUser = Database.getUserByUserId(cleanValue);
      if (targetUser && displayUser) {
        // Check if in same chain
        const isInChain = Database.isInSameChain(displayUser.id, targetUser.id);
        if (isInChain) {
          setTargetUserName(targetUser.fullName);
        } else {
          setTargetUserName('Not in your upline/downline');
        }
      } else {
        setTargetUserName('User not found');
      }
    } else {
      setTargetUserName('');
    }
  };

  const initiateTransfer = (pinId: string) => {
    setSelectedPins([pinId]);
    setShowPasswordModal(true);
  };

  const togglePinSelection = (pinId: string) => {
    setSelectedPins((prev) => (
      prev.includes(pinId) ? prev.filter((id) => id !== pinId) : [...prev, pinId]
    ));
  };

  const clearPinSelection = () => {
    setSelectedPins([]);
  };

  const selectAllPins = () => {
    setSelectedPins(unusedPins.map((pin) => pin.id));
  };

  const selectPinsByCount = () => {
    const qty = Math.max(0, Number.parseInt(bulkSelectCount, 10) || 0);
    if (qty < 1) {
      toast.error('Enter a valid quantity');
      return;
    }
    const count = Math.min(qty, unusedPins.length);
    setSelectedPins(unusedPins.slice(0, count).map((pin) => pin.id));
  };

  const confirmTransfer = async () => {
    if (!displayUser || selectedPins.length === 0) return;
    
    // Verify transaction password
    if (!verifyTransactionPassword(displayUser.id, transactionPassword)) {
      toast.error('Invalid transaction password');
      return;
    }
    if (!transferOtp) {
      toast.error('OTP is required');
      return;
    }

    const otpValid = await verifyOtp(displayUser.userId, transferOtp, 'transaction');
    if (!otpValid) {
      toast.error('Invalid or expired OTP');
      return;
    }

    setIsTransferring(true);
    
    const targetUser = Database.getUserByUserId(transferUserId);
    if (!targetUser) {
      toast.error('Target user not found');
      setIsTransferring(false);
      return;
    }

    const result = selectedPins.length === 1
      ? await transferPin(selectedPins[0], displayUser.id, targetUser.id)
      : await transferPinsBulk(selectedPins, displayUser.id, targetUser.id);
    
    if (result.success) {
      toast.success(result.message);
      setShowPasswordModal(false);
      setTransactionPassword('');
      setShowTransferTxPassword(false);
      setTransferOtp('');
      setIsTransferOtpSent(false);
      setTransferUserId('');
      setTargetUserName('');
      setSelectedPins([]);
      loadPins(displayUser.id);
    } else {
      toast.error(result.message);
    }
    
    setIsTransferring(false);
  };

  const handleSendTransferOtp = async () => {
    if (!displayUser) return;
    setIsSendingOtp(true);
    const result = await sendOtp(displayUser.userId, displayUser.email, 'transaction');
    setIsSendingOtp(false);
    if (result.success) {
      setIsTransferOtpSent(true);
      if (result.status === 'pending') {
        toast.warning(result.message);
      } else {
        toast.success(result.message);
      }
    } else {
      toast.error(result.message);
    }
  };

  const handleRequestProofUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const uploaded = await uploadOptimizedFileToBackend(file, {
        scope: 'pin-request-proofs',
        maxDimension: 1800,
        targetBytes: 650 * 1024,
        quality: 0.86
      });
      setRequestProof(uploaded.fileUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to process payment screenshot');
    }
  };

  const handlePinRequestSubmit = async () => {
    if (!displayUser) return;
    const quantityNumber = Math.max(0, Number.parseInt(requestQuantity, 10) || 0);
    if (quantityNumber < 1) {
      toast.error('Quantity must be at least 1');
      return;
    }
    if (!requestProof) {
      toast.error('Please upload payment screenshot');
      return;
    }

    setIsSubmittingRequest(true);
    const result = await requestPinPurchase(displayUser.id, quantityNumber, {
      paymentMethod: 'crypto',
      paymentProof: requestProof,
      paymentTxHash: requestTxHash || undefined,
      paidFromWallet: false
    });
    setIsSubmittingRequest(false);

    if (!result.success) {
      toast.error(result.message);
      return;
    }

    toast.success(result.message);
    setRequestQuantity('');
    setRequestTxHash('');
    setRequestProof(null);
    loadPurchaseRequests(displayUser.id);
  };

  const handleDirectBuy = async () => {
    if (!displayUser) return;
    const quantityNumber = Math.max(0, Number.parseInt(requestQuantity, 10) || 0);
    if (quantityNumber < 1) {
      toast.error('Quantity must be at least 1');
      return;
    }
    if (!verifyTransactionPassword(displayUser.id, directBuyTransactionPassword)) {
      toast.error('Invalid transaction password');
      return;
    }

    const settings = Database.getSettings();
    const totalAmount = quantityNumber * settings.pinAmount;
    const isConfirmed = window.confirm(
      `Are you sure to buy PIN now?\n\nPINs: ${quantityNumber}\nAmount to deduct: $${totalAmount}`
    );
    if (!isConfirmed) return;

    setIsBuyingDirect(true);
    const result = await buyPinsDirect(displayUser.id, quantityNumber);
    setIsBuyingDirect(false);
    if (!result.success) {
      toast.error(result.message);
      return;
    }

    toast.success(result.message);
    setRequestQuantity('');
    setRequestTxHash('');
    setRequestProof(null);
    setDirectBuyTransactionPassword('');
    setShowDirectBuyTxPassword(false);
    setShowDirectBuyModal(false);
    loadPurchaseRequests(displayUser.id);
  };

  const handleRefresh = async () => {
    if (!displayUser || isRefreshing) return;

    setIsRefreshing(true);
    try {
      await Database.forceRemoteSyncNowWithOptions({
        full: false,
        force: true,
        timeoutMs: 15000,
        maxAttempts: 2,
        retryDelayMs: 1200
      });

      await Database.hydrateFromServer({
        strict: true,
        maxAttempts: 2,
        timeoutMs: 12000,
        retryDelayMs: 800,
        keys: Database.getPinFreshDataKeys()
      });
    } catch {
      // Best-effort sync only.
    } finally {
      loadPins(displayUser.id);
      loadPurchaseRequests(displayUser.id);
      loadWallet(displayUser.id, { v2Only: true });
      refreshTransactions(displayUser.id, { v2Only: true });

      // Run one more read pass after in-store async V2 fetches settle.
      setTimeout(() => {
        if (!displayUser) return;
        loadPins(displayUser.id);
        loadPurchaseRequests(displayUser.id);
      }, 450);

      setIsRefreshing(false);
    }
  };

  const renderUnusedPins = () => (
    <div className="space-y-4">
      {unusedPins.length === 0 ? (
        <div className="text-center py-8">
          <Ticket className="w-12 h-12 text-white/20 mx-auto mb-4" />
          <p className="text-white/60">No unused PINs available</p>
          <p className="text-sm text-white/40 mt-1">Purchase PINs from the admin or receive from your upline</p>
        </div>
      ) : (
        <div className="space-y-3">
          {selectedPins.length > 0 && (
            <div className="p-3 rounded-lg bg-[#0f172a] border border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-white/70 text-sm">
                Selected {selectedPins.length} PIN{selectedPins.length === 1 ? '' : 's'}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => setShowPasswordModal(true)}
                  className="btn-primary"
                >
                  <Send className="w-4 h-4 mr-1" /> Transfer Selected
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={clearPinSelection}
                  className="border-white/20 text-white hover:bg-white/10"
                >
                  Clear
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={selectAllPins}
                className="border-white/20 text-white hover:bg-white/10"
              >
                Select All
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={clearPinSelection}
                className="border-white/20 text-white hover:bg-white/10"
              >
                Select None
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                value={bulkSelectCount}
                onChange={(e) => setBulkSelectCount(e.target.value.replace(/\D/g, '').slice(0, 3))}
                placeholder="Qty"
                className="w-24 bg-[#1f2937] border-white/10 text-white"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={selectPinsByCount}
                className="border-white/20 text-white hover:bg-white/10"
              >
                Select Qty
              </Button>
            </div>
          </div>
          <div className="grid gap-4">
          {unusedPins.map((pin) => (
            <div 
              key={pin.id} 
              className="p-4 rounded-lg bg-[#1f2937] border border-white/10 hover:border-[#118bdd]/50 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#118bdd]/20 flex items-center justify-center">
                    <Ticket className="w-5 h-5 text-[#118bdd]" />
                  </div>
                  <div>
                    <p className="text-lg font-mono font-bold text-white tracking-wider">{pin.pinCode}</p>
                    <p className="text-xs text-white/50">Created: {new Date(pin.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-emerald-400">${pin.amount}</p>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs">
                    Unused
                  </span>
                </div>
              </div>
              
              <div className="flex items-center gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => togglePinSelection(pin.id)}
                  className={`h-6 w-6 rounded-md border flex items-center justify-center ${
                    selectedPins.includes(pin.id)
                      ? 'bg-[#118bdd] border-[#118bdd] text-white'
                      : 'border-white/30 text-white/50 hover:border-white/60'
                  }`}
                  title={selectedPins.includes(pin.id) ? 'Deselect PIN' : 'Select PIN'}
                >
                  {selectedPins.includes(pin.id) && <Check className="w-4 h-4" />}
                </button>
                <span className="text-xs text-white/60">Select for bulk transfer</span>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopyPin(pin.pinCode)}
                  className="flex-1 border-white/20 text-white hover:bg-white/10"
                >
                  {copiedPin === pin.pinCode ? (
                    <><Check className="w-4 h-4 mr-1" /> Copied</>
                  ) : (
                    <><Copy className="w-4 h-4 mr-1" /> Copy</>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleShareWhatsApp(pin.pinCode)}
                  className="flex-1 border-green-500/30 text-green-400 hover:bg-green-500/10"
                >
                  <MessageCircle className="w-4 h-4 mr-1" /> WhatsApp
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleShareAnywhere(pin.pinCode)}
                  className="flex-1 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
                >
                  <Share2 className="w-4 h-4 mr-1" /> Share
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => initiateTransfer(pin.id)}
                  className="flex-1 border-[#118bdd]/30 text-[#118bdd] hover:bg-[#118bdd]/10"
                >
                  <Send className="w-4 h-4 mr-1" /> Transfer
                </Button>
              </div>
            </div>
          ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderUsedPins = () => (
    <div className="space-y-4">
      {usedPins.length === 0 ? (
        <div className="text-center py-8">
          <History className="w-12 h-12 text-white/20 mx-auto mb-4" />
          <p className="text-white/60">No used PINs</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {usedPins.map((pin) => (
            <div 
              key={pin.id} 
              className="p-4 rounded-lg bg-[#1f2937] border border-white/10 opacity-70"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                    <Ticket className="w-5 h-5 text-white/50" />
                  </div>
                  <div>
                    <p className="text-lg font-mono font-bold text-white/50 tracking-wider">{pin.pinCode}</p>
                    <p className="text-xs text-white/40">
                      Used: {pin.usedAt ? new Date(pin.usedAt).toLocaleDateString() : '-'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-white/50">${pin.amount}</p>
                  <span className="px-2 py-0.5 rounded-full bg-white/10 text-white/50 text-xs">
                    Used
                  </span>
                </div>
              </div>
              {pin.registrationUserId && (
                <p className="text-xs text-white/40 mt-2">
                  Registered User: {Database.getUserById(pin.registrationUserId)?.userId || '-'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderReceivedPins = () => (
    <div className="space-y-4">
      {receivedPins.length === 0 ? (
        <div className="text-center py-8">
          <Download className="w-12 h-12 text-white/20 mx-auto mb-4" />
          <p className="text-white/60">No received PINs</p>
          <p className="text-sm text-white/40 mt-1">PINs transferred to you will appear here</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {receivedPins.map((pin) => {
            const fromUser = pin.transferredFrom ? Database.getUserById(pin.transferredFrom) : null;
            return (
              <div 
                key={pin.id} 
                className="p-4 rounded-lg bg-[#1f2937] border border-white/10"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                      <Download className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-lg font-mono font-bold text-white tracking-wider">{pin.pinCode}</p>
                      <p className="text-xs text-white/50">
                        From: {fromUser?.fullName || 'Unknown'} ({fromUser?.userId || '-'})
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-emerald-400">${pin.amount}</p>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      pin.status === 'unused'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : pin.status === 'suspended'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-white/10 text-white/50'
                    }`}>
                      {pin.status === 'unused' ? 'Available' : pin.status === 'suspended' ? 'Suspended' : 'Used'}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-white/40">
                  Received: {pin.transferredAt ? new Date(pin.transferredAt).toLocaleDateString() : '-'}
                </p>
                {pin.status === 'unused' && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyPin(pin.pinCode)}
                      className="flex-1 border-white/20 text-white hover:bg-white/10"
                    >
                      {copiedPin === pin.pinCode ? (
                        <><Check className="w-4 h-4 mr-1" /> Copied</>
                      ) : (
                        <><Copy className="w-4 h-4 mr-1" /> Copy</>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleShareWhatsApp(pin.pinCode)}
                      className="flex-1 border-green-500/30 text-green-400 hover:bg-green-500/10"
                    >
                      <MessageCircle className="w-4 h-4 mr-1" /> WhatsApp
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleShareAnywhere(pin.pinCode)}
                      className="flex-1 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
                    >
                      <Share2 className="w-4 h-4 mr-1" /> Share
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderTransferHistory = () => (
    <div className="space-y-4">
      {transfers.length === 0 ? (
        <div className="text-center py-8">
          <Send className="w-12 h-12 text-white/20 mx-auto mb-4" />
          <p className="text-white/60">No transfer history</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {transfers.map((transfer) => (
            <div 
              key={transfer.id} 
              className="p-4 rounded-lg bg-[#1f2937] border border-white/10"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#118bdd]/20 flex items-center justify-center">
                    <Send className="w-5 h-5 text-[#118bdd]" />
                  </div>
                  <div>
                    <p className="font-mono text-white">{transfer.pinCode}</p>
                    <p className="text-xs text-white/50">
                      {transfer.fromUserId === displayUser?.id ? (
                        <>To: {transfer.toUserName} ({transfer.toUserId})</>
                      ) : (
                        <>From: {transfer.fromUserName} ({transfer.fromUserId})</>
                      )}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    transfer.fromUserId === displayUser?.id 
                      ? 'bg-amber-500/20 text-amber-400' 
                      : 'bg-emerald-500/20 text-emerald-400'
                  }`}>
                    {transfer.fromUserId === displayUser?.id ? 'Sent' : 'Received'}
                  </span>
                  <p className="text-xs text-white/40 mt-1">
                    {new Date(transfer.transferredAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderPinRequest = () => {
    const settings = Database.getSettings();
    const pinAmount = settings.pinAmount;
    const quantityNumber = Math.max(0, Number.parseInt(requestQuantity, 10) || 0);
    const totalAmount = quantityNumber * pinAmount;
    const localFundWalletBalance = displayUser ? (Database.getWallet(displayUser.id)?.depositWallet || 0) : 0;
    const liveFundWalletBalance = displayUser && wallet && String(wallet.userId || '').trim() === String(displayUser.id || '').trim()
      ? Number(wallet.depositWallet || 0)
      : null;
    const fundWalletBalance = liveFundWalletBalance != null
      ? liveFundWalletBalance
      : localFundWalletBalance;
    const canDirectBuy = quantityNumber > 0 && fundWalletBalance >= totalAmount;
    const activeCryptoMethod = Database.getPaymentMethods().find(m => m.isActive && m.type === 'crypto');

    return (
      <div className="space-y-6">
        <Card className="bg-[#1f2937] border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-base">Request PIN from Admin</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-white/80">Quantity</label>
              <Input
                type="number"
                min={1}
                value={requestQuantity}
                onChange={(e) => setRequestQuantity(e.target.value.replace(/\D/g, ''))}
                onWheel={(e) => e.currentTarget.blur()}
                className="bg-[#0f172a] border-white/10 text-white"
              />
            </div>
            <div className="p-3 rounded-lg bg-[#0f172a] border border-white/10">
              <p className="text-sm text-white/60">PIN Amount: ${pinAmount}</p>
              <p className="text-sm text-white/60">Total Payable: ${totalAmount}</p>
              <p className="text-sm text-white/60">Fund Wallet: ${fundWalletBalance}</p>
            </div>

            {activeCryptoMethod?.walletAddress ? (
              <div className="space-y-4 p-4 rounded-lg bg-[#0f172a] border border-white/10">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#118bdd]/15 flex items-center justify-center">
                    <QrCode className="w-5 h-5 text-[#118bdd]" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className="text-sm text-white font-semibold">Pay via USDT (BEP-20)</p>
                    <p className="text-xs text-white/60">
                      {activeCryptoMethod.instructions || 'Send USDT to this address and upload proof.'}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-white/60 uppercase">Wallet Address</p>
                  <div className="flex gap-2 items-center">
                    <code className="flex-1 p-3 rounded-lg bg-[#111827] text-white/90 text-xs break-all border border-white/10">
                      {activeCryptoMethod.walletAddress}
                    </code>
                    <Button
                      variant="outline"
                      className="border-white/20 text-white hover:bg-white/10"
                      onClick={async () => {
                        const ok = await copyPinToClipboard(activeCryptoMethod.walletAddress || '');
                        toast[ok ? 'success' : 'error'](ok ? 'Wallet address copied' : 'Copy failed');
                      }}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-[11px] text-white/50">Powered by admin deposit details</p>
                </div>

                <div className="flex flex-col items-center gap-2">
                  {activeCryptoMethod.qrCode ? (
                    <>
                      <img
                        src={activeCryptoMethod.qrCode}
                        alt={`${activeCryptoMethod.name} QR`}
                        className="w-44 h-44 object-contain rounded-lg bg-white p-2 border border-white/15"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowQrFullscreen(true)}
                        className="border-white/20 text-white hover:bg-white/10"
                      >
                        <Maximize2 className="w-4 h-4 mr-2" />
                        Full Screen QR
                      </Button>
                    </>
                  ) : (
                    <div className="p-4 rounded-lg bg-white/5 border border-white/10 w-full text-center text-white/50">
                      No QR configured in admin deposit details.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-[#0f172a] border border-amber-500/30 text-amber-300 text-sm">
                Admin has not configured deposit details yet. Add a USDT (BEP-20) method in Deposit settings to enable PIN requests.
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm text-white/80">Transaction Hash (Optional)</label>
              <Input
                value={requestTxHash}
                onChange={(e) => setRequestTxHash(e.target.value)}
                placeholder="Enter tx hash"
                className="bg-[#0f172a] border-white/10 text-white"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm text-white/80">Upload Payment Screenshot</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleRequestProofUpload}
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-white/20 rounded-lg p-5 text-center cursor-pointer hover:border-white/40 transition-colors"
              >
                {requestProof ? (
                  <img src={requestProof} alt="Payment proof" className="max-h-36 mx-auto rounded" />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-white/50">
                    <Upload className="w-6 h-6" />
                    <span>Click to upload screenshot</span>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Button
                onClick={handlePinRequestSubmit}
                disabled={isSubmittingRequest || isBuyingDirect || Math.max(0, Number.parseInt(requestQuantity, 10) || 0) < 1}
                className="w-full btn-primary"
              >
                {isSubmittingRequest ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                Submit Normal Request
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowDirectBuyModal(true)}
                disabled={!canDirectBuy || isSubmittingRequest || isBuyingDirect}
                className="w-full border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              >
                {isBuyingDirect ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Ticket className="w-4 h-4 mr-2" />}
                Buy Instantly
              </Button>
            </div>
            {!canDirectBuy && (
              <p className="text-xs text-amber-400">Insufficient fund wallet balance for instant buy.</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-[#1f2937] border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-base">PIN Request History</CardTitle>
          </CardHeader>
          <CardContent>
            {purchaseRequests.length === 0 ? (
              <p className="text-white/50 py-4 text-center">No PIN request history</p>
            ) : (
              <div className="space-y-3">
                {purchaseRequests.map((request) => (
                  <div key={request.id} className="p-3 rounded-lg bg-[#0f172a] border border-white/10">
                    <div className="flex items-center justify-between">
                      <p className="text-white font-medium">{request.quantity} PIN(s) - ${request.amount}</p>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        request.status === 'completed'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : request.status === 'failed' || request.status === 'cancelled'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-amber-500/20 text-amber-400'
                      }`}>
                        {request.status}
                      </span>
                    </div>
                    <p className="text-xs text-white/50 mt-1">{new Date(request.createdAt).toLocaleString()}</p>
                    {request.paymentTxHash && <p className="text-xs text-white/40 mt-1">Tx Hash: {request.paymentTxHash}</p>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="pin-wallet-page min-h-screen bg-[#0a0e17] px-4 py-6 pb-24 sm:px-6 lg:px-8 md:pb-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">PIN Wallet</h1>
          <p className="text-white/60">Manage your activation PINs</p>
          {impersonatedUser && (
            <p className="text-[11px] text-amber-300/90 mt-0.5">
              Viewing as {impersonatedUser.fullName} ({impersonatedUser.userId})
            </p>
          )}
        </div>
        <Button
          variant="outline"
          onClick={handleRefresh}
          className="border-white/20 text-white hover:bg-white/10 w-full sm:w-auto"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="glass border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <Ticket className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{unusedPins.length}</p>
                <p className="text-xs text-white/60">Unused PINs</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                <History className="w-5 h-5 text-white/60" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{usedPins.length}</p>
                <p className="text-xs text-white/60">Used PINs</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#118bdd]/20 flex items-center justify-center">
                <Download className="w-5 h-5 text-[#118bdd]" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{receivedPins.length}</p>
                <p className="text-xs text-white/60">Received PINs</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <Send className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">
                  {transfers.filter(t => t.fromUserId === displayUser?.id).length}
                </p>
                <p className="text-xs text-white/60">Transfers Sent</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {[
          { key: 'request', label: 'PIN Request', count: purchaseRequests.length },
          { key: 'unused', label: 'Unused PINs', count: unusedPins.length },
          { key: 'used', label: 'Used PINs', count: usedPins.length },
          { key: 'received', label: 'Received PINs', count: receivedPins.length },
          { key: 'transfer', label: 'Transfer History', count: transfers.length }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as 'unused' | 'used' | 'received' | 'transfer' | 'request')}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.key
                ? 'bg-[#118bdd] text-white'
                : 'bg-[#1f2937] text-white/60 hover:bg-[#1f2937]/80'
            }`}
          >
            {tab.label}
            <span className="ml-2 px-1.5 py-0.5 rounded-full bg-white/20 text-xs">
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
        <Card className="glass border-white/10">
          <CardHeader>
            <CardTitle className="text-white capitalize">
            {activeTab === 'transfer' ? 'Transfer History' : activeTab === 'request' ? 'PIN Request' : `${activeTab} PINs`}
            </CardTitle>
          </CardHeader>
          <CardContent>
          {activeTab === 'unused' && renderUnusedPins()}
          {activeTab === 'used' && renderUsedPins()}
          {activeTab === 'received' && renderReceivedPins()}
          {activeTab === 'transfer' && renderTransferHistory()}
          {activeTab === 'request' && renderPinRequest()}
          </CardContent>
        </Card>

      {/* Transaction Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <Card className="glass border-white/10 max-w-md w-full">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                Confirm PIN Transfer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="bg-amber-500/10 border-amber-500/30">
                <AlertDescription className="text-amber-400">
                  PINs can only be transferred to your upline or downline members.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <label className="text-sm text-white/80">Recipient User ID (7 digits)</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <Input
                    value={transferUserId}
                    onChange={(e) => checkTargetUser(e.target.value)}
                    maxLength={7}
                    placeholder="Enter recipient User ID"
                    className="pl-10 bg-[#1f2937] border-white/10 text-white"
                  />
                </div>
                {targetUserName && (
                  <p className={`text-sm ${targetUserName.includes('Not') || targetUserName.includes('not found') ? 'text-red-400' : 'text-emerald-400'}`}>
                    {targetUserName}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm text-white/80">Transaction Password</label>
                <div className="relative">
                  <Input
                    type={showTransferTxPassword ? 'text' : 'password'}
                    value={transactionPassword}
                    onChange={(e) => setTransactionPassword(e.target.value)}
                    placeholder="Enter your transaction password"
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
                <label className="text-sm text-white/80">Email OTP</label>
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
                    disabled={isSendingOtp}
                    className="border-white/20 text-white hover:bg-white/10"
                  >
                    {isSendingOtp ? 'Sending...' : 'Send OTP'}
                  </Button>
                </div>
                {isTransferOtpSent && (
                  <p className="text-xs text-emerald-400">OTP sent. Check your email.</p>
                )}
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowPasswordModal(false);
                    setTransactionPassword('');
                    setShowTransferTxPassword(false);
                    setTransferOtp('');
                    setIsTransferOtpSent(false);
                    setTransferUserId('');
                    setTargetUserName('');
                    setSelectedPins([]);
                  }}
                  className="flex-1 border-white/20 text-white hover:bg-white/10"
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmTransfer}
                  disabled={isTransferring || !transferUserId || transferUserId.length !== 7 || !targetUserName || targetUserName.includes('Not') || !transactionPassword || !transferOtp}
                  className="flex-1 btn-primary"
                >
                  {isTransferring ? (
                    <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Transferring...</>
                  ) : (
                    <><Send className="w-4 h-4 mr-2" /> Confirm Transfer</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Direct Buy Confirmation Modal */}
      {showDirectBuyModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <Card className="glass border-white/10 max-w-md w-full">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Ticket className="w-5 h-5 text-emerald-400" />
                Confirm Instant PIN Buy
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 rounded-lg bg-[#1f2937] border border-white/10">
                <p className="text-sm text-white/70">
                  PIN Quantity: <span className="text-white font-medium">{Math.max(0, Number.parseInt(requestQuantity, 10) || 0)}</span>
                </p>
                <p className="text-sm text-white/70">
                  Amount to deduct: <span className="text-emerald-400 font-medium">${Math.max(0, Number.parseInt(requestQuantity, 10) || 0) * Database.getSettings().pinAmount}</span>
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm text-white/80">Transaction Password</label>
                <div className="relative">
                  <Input
                    type={showDirectBuyTxPassword ? 'text' : 'password'}
                    value={directBuyTransactionPassword}
                    onChange={(e) => setDirectBuyTransactionPassword(e.target.value)}
                    placeholder="Enter transaction password"
                    className="bg-[#1f2937] border-white/10 text-white pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDirectBuyTxPassword((v) => !v)}
                    className="absolute inset-y-0 right-3 flex items-center text-white/60 hover:text-white"
                    tabIndex={-1}
                  >
                    {showDirectBuyTxPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDirectBuyModal(false);
                    setDirectBuyTransactionPassword('');
                    setShowDirectBuyTxPassword(false);
                  }}
                  className="flex-1 border-white/20 text-white hover:bg-white/10"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleDirectBuy}
                  disabled={!directBuyTransactionPassword || isBuyingDirect}
                  className="flex-1 border border-emerald-500/40 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {isBuyingDirect ? (
                    <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Buying...</>
                  ) : (
                    <>Continue</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {showQrFullscreen && Database.getPaymentMethods().find(m => m.isActive && m.type === 'crypto' && m.walletAddress)?.qrCode && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f172a] border border-white/10 rounded-xl p-4 max-w-3xl w-full">
            <div className="flex justify-between items-center mb-3">
              <p className="text-white font-semibold text-sm">Payment QR Code</p>
              <Button
                variant="ghost"
                size="sm"
                className="text-white/70 hover:text-white"
                onClick={() => setShowQrFullscreen(false)}
              >
                Close
              </Button>
            </div>
            <div className="bg-white rounded-lg p-4 flex justify-center">
              <img
                src={Database.getPaymentMethods().find(m => m.isActive && m.type === 'crypto' && m.walletAddress)?.qrCode || ''}
                alt="Payment QR Fullscreen"
                className="w-full max-h-[70vh] object-contain"
              />
            </div>
          </div>
        </div>
      )}
      <MobileBottomNav />
    </div>
  );
}
