import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
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
  Settings, DollarSign, Search, CheckCircle, RefreshCw, Download,
  CreditCard, XCircle, Eye, LogOut, IdCard, Ticket, UserCog,
  BarChart3, Copy, Check, Ban, UserCheck, ArrowUp, ArrowDown, MessageCircle, Share2
} from 'lucide-react';
import { formatCurrency, formatNumber, formatDate, getInitials, generateAvatarColor, getTransactionTypeLabel } from '@/utils/helpers';
import { toast } from 'sonner';
import Database from '@/db';
import { helpDistributionTable } from '@/db';
import type { Payment, PaymentMethod, Pin, SupportTicket, SupportTicketAttachment, SupportTicketStatus } from '@/types';
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

export default function Admin() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout, adminLoginAsUser } = useAuthStore();
  const {
    stats, settings, allUsers, allTransactions, safetyPoolAmount, allPins, allPinRequests, pendingPinRequests,
    loadStats, loadSettings, loadAllUsers, loadAllTransactions, loadAllPins, loadAllPinRequests, loadPendingPinRequests,
    updateSettings, addFundsToUser, generatePins, approvePinPurchase, rejectPinPurchase, reopenPinPurchase,
    suspendPin, unsuspendPin, blockUser, unblockUser, reactivateAutoDeactivatedUser, bulkCreateUsersWithoutPin, createServerBackup,
    deleteAllIdsFromSystem, getLevelWiseReport
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
  const [fundWalletType, setFundWalletType] = useState<'deposit' | 'income'>('deposit');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingPayments, setPendingPayments] = useState<Payment[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [userSearchId, setUserSearchId] = useState('');
  const [searchedUser, setSearchedUser] = useState<any>(null);

  // PIN Management
  const [pinQuantity, setPinQuantity] = useState(1);
  const [pinRecipientId, setPinRecipientId] = useState('');
  const [generatedPins, setGeneratedPins] = useState<Pin[]>([]);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [copiedPin, setCopiedPin] = useState<string | null>(null);
  const [pinSuspendReason, setPinSuspendReason] = useState('Admin action');
  const [pinRequestStatusFilter, setPinRequestStatusFilter] = useState<'all' | 'pending' | 'completed' | 'cancelled'>('all');

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
  const [sweepRunning, setSweepRunning] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);

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
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [showDeleteAllIdsDialog, setShowDeleteAllIdsDialog] = useState(false);
  const [deleteAllIdsPhrase, setDeleteAllIdsPhrase] = useState('');
  const [deleteAllIdsAdminId, setDeleteAllIdsAdminId] = useState('');
  const [isDeletingAllIds, setIsDeletingAllIds] = useState(false);
  const adminBootstrapUserRef = useRef<string | null>(null);
  const deleteAllIdsArmed =
    deleteAllIdsPhrase.trim().toUpperCase() === DELETE_ALL_IDS_PHRASE
    && deleteAllIdsAdminId.trim() === (user?.userId || '');

  const isReportsTabActive = activeMainTab === 'reports';
  const isSupportTabActive = activeMainTab === 'support';

  const reloadAdminDataFromBrowserState = () => {
    loadStats();
    loadSettings();
    loadAllUsers();
    loadAllPins();
    loadAllPinRequests();
    loadPendingPinRequests();
    loadPayments();
    loadPaymentMethods();
  };

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

  useEffect(() => {
    if (!isReportsTabActive || reportsDataLoaded) return;
    const timer = window.setTimeout(() => {
      loadAllTransactions();
      setReportsDataLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isReportsTabActive, reportsDataLoaded, loadAllTransactions]);

  useEffect(() => {
    if (!isSupportTabActive || supportDataLoaded) return;
    const timer = window.setTimeout(() => {
      loadSupportTickets();
      setSupportDataLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isSupportTabActive, supportDataLoaded]);

  function loadPayments() {
    const payments = Database.getPendingPayments();
    setPendingPayments(payments);
  }

  function loadPaymentMethods() {
    const methods = Database.getPaymentMethods();
    setPaymentMethods(methods);
  }

  const loadSupportTickets = () => {
    const rows = Database.getSupportTickets();
    setSupportTickets(rows);
    if (!selectedSupportTicketId && rows.length > 0) {
      setSelectedSupportTicketId(rows[0].ticket_id);
      setSupportStatusDraft(rows[0].status);
    }
  };

  const readSupportAttachment = async (file: File): Promise<SupportTicketAttachment> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read attachment'));
      reader.readAsDataURL(file);
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

  const handleApprovePayment = () => {
    if (!selectedPayment || !user) return;

    const result = Database.approvePayment(selectedPayment.id, user.id);
    if (result) {
      toast.success('Payment approved and funds added to user wallet');
      loadPayments();
      loadAllUsers();
      setShowPaymentDialog(false);
      setSelectedPayment(null);
    } else {
      toast.error('Failed to approve payment');
    }
  };

  const handleRejectPayment = () => {
    if (!selectedPayment || !user) return;

    const result = Database.rejectPayment(selectedPayment.id, user.id, adminNotes);
    if (result) {
      toast.success('Payment rejected');
      loadPayments();
      setShowPaymentDialog(false);
      setSelectedPayment(null);
      setAdminNotes('');
    } else {
      toast.error('Failed to reject payment');
    }
  };

  const togglePaymentMethod = (methodId: string, isActive: boolean) => {
    Database.updatePaymentMethod(methodId, { isActive });
    loadPaymentMethods();
    toast.success(`Payment method ${isActive ? 'enabled' : 'disabled'}`);
  };

  const handleAddFunds = async () => {
    if (!selectedUser || !fundAmount) return;

    setIsLoading(true);
    const result = await addFundsToUser(selectedUser, parseFloat(fundAmount), fundWalletType);
    setIsLoading(false);

    if (result.success) {
      toast.success(result.message);
      setFundAmount('');
      setSelectedUser(null);
      loadAllUsers();
    } else {
      toast.error(result.message);
    }
  };

  const searchUserById = () => {
    if (userSearchId.length !== 7) {
      toast.error('Please enter a valid 7-digit User ID');
      return;
    }

    const foundUser = Database.getUserByUserId(userSearchId);
    if (foundUser) {
      const wallet = Database.getWallet(foundUser.id);
      const teamStats = Database.getTeamCounts(foundUser.userId);
      const userPayments = Database.getUserPayments(foundUser.id);
      const userTransactions = Database.getUserTransactions(foundUser.id);
      const userPins = Database.getUserPins(foundUser.id);
      const pendingMatrixDebug = Database.getPendingMatrixContributionsDebug(foundUser.id);
      const incomingPendingMatrixDebug = Database.getIncomingPendingMatrixContributionsDebug(foundUser.id);

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
        incomingPendingMatrixDebug
      });
    } else {
      toast.error('User not found');
      setSearchedUser(null);
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

  const handleSweepPending = async () => {
    setSweepRunning(true);
    setSweepResult(null);
    try {
      const result = Database.repairAndSweepPendingContributions();
      setSweepResult(
        `Repaired ${result.repairedUsers} user(s), processed ${result.processedItems} contribution(s). ${result.stillPending} still pending.`
      );
      if (result.processedItems > 0 || result.repairedUsers > 0) {
        await Database.forceRemoteSyncNowWithOptions({ full: false, force: true, timeoutMs: 120_000, maxAttempts: 3, retryDelayMs: 2000 });
        loadStats();
        loadAllTransactions();
      }
    } catch (err) {
      setSweepResult(`Error: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    setSweepRunning(false);
  };

  const handleBulkCreateNoPin = async () => {
    setBulkNoPinCreated([]);
    setBulkNoPinFailed([]);
    setBulkNoPinProgress(null);

    if (!bulkNoPin.sponsorUserId || bulkNoPin.sponsorUserId.length !== 7) {
      toast.error('Enter a valid 7-digit sponsor ID');
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
      const fromUser = tx.fromUserId ? userById.get(tx.fromUserId) : undefined;

      return {
        id: tx.id,
        createdAt: tx.createdAt,
        userId: user?.userId || '-',
        userName: user?.fullName || '-',
        amount: Math.abs(tx.amount),
        level: tx.level || 0,
        fromUserId: fromUser?.userId || '-',
        fromUserName: fromUser?.fullName || '-'
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

        return {
          id: tx.id,
          createdAt: tx.createdAt,
          userId: sender?.userId || '-',
          userName: sender?.fullName || '-',
          amount: txAmount,
          giveToId: receiver?.userId || '-',
          giveToUserName: receiver?.fullName || '-'
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
  }, [allTransactions, userById, giveFilters, isReportsTabActive, reportTab]);

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

  const selectedSupportTicket = useMemo(
    () => supportTickets.find((ticket) => ticket.ticket_id === selectedSupportTicketId) || null,
    [supportTickets, selectedSupportTicketId]
  );

  useEffect(() => {
    if (selectedSupportTicket) {
      setSupportStatusDraft(selectedSupportTicket.status);
    }
  }, [selectedSupportTicket]);

  const handleSupportStatusUpdate = () => {
    if (!selectedSupportTicket) return;
    const updated = Database.updateSupportTicketStatus(selectedSupportTicket.ticket_id, supportStatusDraft);
    if (!updated) {
      toast.error('Failed to update ticket status');
      return;
    }
    loadSupportTickets();
    toast.success(`Ticket ${updated.ticket_id} marked ${SUPPORT_STATUS_OPTIONS.find((s) => s.value === updated.status)?.label || updated.status}`);
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

  const handleSupportReply = () => {
    if (!selectedSupportTicket || !user) return;
    if (!supportReplyMessage.trim() && !supportReplyAttachment) {
      toast.error('Write a reply or attach a file');
      return;
    }
    const updated = Database.addSupportTicketMessage({
      ticket_id: selectedSupportTicket.ticket_id,
      sender_type: 'admin',
      sender_user_id: user.userId,
      sender_name: user.fullName,
      message: supportReplyMessage.trim(),
      attachments: supportReplyAttachment ? [supportReplyAttachment] : []
    });
    if (!updated) {
      toast.error('Failed to send reply');
      return;
    }
    setSupportReplyMessage('');
    setSupportReplyAttachment(null);
    setSupportStatusDraft(updated.status);
    loadSupportTickets();
    toast.success('Reply sent');
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
                onClick={async () => {
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
                  loadSupportTickets();
                  if (import.meta.env.PROD) {
                    void hydrateDeferredAdminState().then(() => {
                      loadAllTransactions();
                      loadAllPins();
                      loadAllPinRequests();
                      loadPendingPinRequests();
                      loadPayments();
                      loadPaymentMethods();
                    });
                  } else {
                    loadAllTransactions();
                  }
                  toast.success('Data refreshed');
                }}
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
            <TabsTrigger value="pins" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">PIN Management</TabsTrigger>
            <TabsTrigger value="payments" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">
              Payments {pendingPayments.length > 0 && <span className="ml-1 text-xs bg-red-500 text-white px-1.5 rounded-full">{pendingPayments.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="user-details" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">User Details</TabsTrigger>
            <TabsTrigger value="impersonate" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Login As User</TabsTrigger>
            <TabsTrigger value="support" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Support</TabsTrigger>
            <TabsTrigger value="reports" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Reports</TabsTrigger>
            <TabsTrigger value="matrix" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Matrix Table</TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-[#118bdd] text-xs sm:text-sm">Settings</TabsTrigger>
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
                  <RefreshCw className="w-5 h-5 text-amber-400" />
                  Reprocess Pending Help
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-white/60 text-sm">
                  Sweep all stuck pending matrix contributions and process any that are now eligible (users with locked income ready to fund higher-level help).
                </p>
                <Button onClick={handleSweepPending} disabled={sweepRunning} className="w-full btn-primary">
                  {sweepRunning ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  {sweepRunning ? 'Processing...' : 'Reprocess Pending Help'}
                </Button>
                {sweepResult && (
                  <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/30">
                    <p className="text-sky-300 text-sm">{sweepResult}</p>
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
                                  onClick={() => setSelectedUser(u.userId)}
                                  className="border-white/20 text-white hover:bg-white/10"
                                >
                                  <DollarSign className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
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
                            <div className="mt-2">
                              <img src={request.paymentProof} alt="PIN request proof" className="max-h-24 rounded border border-white/10" />
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

              {/* All PINs */}
              <Card className="glass border-white/10 lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-white">All PINs</CardTitle>
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
                        {allPins.slice(0, 50).map((pin) => {
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
                          const paymentUser = allUsers.find(u => u.id === payment.userId);
                          return (
                            <tr key={payment.id} className="border-b border-white/5 hover:bg-white/5">
                              <td className="py-3 px-4">
                                <span className="text-[#118bdd] font-mono">{paymentUser?.userId}</span>
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

              {/* Payment Methods */}
              <Card className="glass border-white/10">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Settings className="w-5 h-5 text-[#118bdd]" />
                    Payment Methods
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {paymentMethods.map((method) => (
                      <div key={method.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-lg bg-[#1f2937]">
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${method.isActive ? 'bg-[#118bdd]' : 'bg-gray-600'}`}>
                            <CreditCard className="w-5 h-5 text-white" />
                          </div>
                          <div>
                            <p className="text-white font-medium">{method.name}</p>
                            <p className="text-white/50 text-sm">
                              Fee: {method.processingFee}% | {method.processingTime}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
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
                    onClick={searchUserById}
                    className="btn-primary"
                  >
                    <Search className="w-4 h-4 mr-2" />
                    Search
                  </Button>
                </div>

                {searchedUser && (
                  <div className="space-y-6">
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
                      {/* 7. Total Earnings */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Total Earnings</p>
                        <p className="text-xl font-bold text-emerald-400">{formatCurrency(searchedUser.wallet?.totalEarning || 0)}</p>
                      </div>
                      {/* 8. Give Help */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Give Help</p>
                        <p className="text-xl font-bold text-orange-400">{formatCurrency(searchedUser.giveHelpAmount || 0)}</p>
                      </div>
                      {/* 9. Received Help */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Received Help</p>
                        <p className="text-xl font-bold text-emerald-400">{formatCurrency(searchedUser.receiveHelpAmount || 0)}</p>
                      </div>
                      {/* 10. Locked Help */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Locked Help</p>
                        <p className="text-xl font-bold text-white/80">{formatCurrency((searchedUser.wallet?.lockedIncomeWallet || 0) + (searchedUser.wallet?.giveHelpLocked || 0))}</p>
                      </div>
                      {/* 11. Direct Referral */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Direct Referral</p>
                        <p className="text-xl font-bold text-white">{searchedUser.directCount}</p>
                      </div>
                      {/* 12. Direct Referral Income */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Direct Referral Income</p>
                        <p className="text-xl font-bold text-white/80">{formatCurrency(searchedUser.directReferralIncome || 0)}</p>
                      </div>
                      {/* 13. Left Team */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50 mb-1">Left Team</p>
                        <p className="text-xl font-bold text-white">{searchedUser.teamStats?.left || 0}</p>
                        <p className="text-xs text-emerald-400">{searchedUser.teamStats?.leftActive || 0} Active</p>
                      </div>
                      {/* 14. Right Team */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50 mb-1">Right Team</p>
                        <p className="text-xl font-bold text-white">{searchedUser.teamStats?.right || 0}</p>
                        <p className="text-xs text-emerald-400">{searchedUser.teamStats?.rightActive || 0} Active</p>
                      </div>
                      {/* 15. Level Filled */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Level Filled</p>
                        <p className="text-xl font-bold text-white">
                          {(() => {
                            const progress = Database.getLevelFillProgress(searchedUser.id);
                            return `Level ${progress.level} (${progress.filled}/${progress.required} filled)`;
                          })()}
                        </p>
                      </div>
                      {/* 16. Qualified Level */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Qualified Level</p>
                        <p className="text-xl font-bold text-white">
                          Level {Database.getQualifiedLevel(searchedUser.id)}
                        </p>
                      </div>
                      {/* 17. Offer Achievement */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Offer Achievement</p>
                        <p className="text-xl font-bold text-purple-400">{searchedUser.offerAchieved ? 'Achieved' : 'Not Achieved'}</p>
                      </div>
                      {/* 18. User's Transition */}
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">User's Transition</p>
                        <p className="text-xl font-bold text-white/80">{searchedUser.transactions?.length || 0} Txns</p>
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
                                    {getTransactionTypeLabel(tx.type)}
                                  </Badge>
                                </td>
                                <td className={`py-2 px-4 font-medium ${tx.amount > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {tx.amount > 0 ? '+' : ''}{formatCurrency(tx.amount)}
                                </td>
                                <td className="py-2 px-4 text-white/60 text-sm">{tx.description}</td>
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
                        onClick={loadSupportTickets}
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
                              {selectedSupportTicket.messages.map((msg) => (
                                <div key={msg.id} className="rounded-lg border border-white/10 bg-[#111827] p-3">
                                  <div className="flex items-center justify-between gap-3 mb-2">
                                    <p className="text-sm text-white">
                                      {msg.sender_type === 'admin' ? 'Admin' : 'User'} - {msg.sender_name}
                                    </p>
                                    <p className="text-xs text-white/50">{new Date(msg.created_at).toLocaleString()}</p>
                                  </div>
                                  <p className="text-white/75 text-sm whitespace-pre-wrap">{msg.message || '-'}</p>
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
                              ))}
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
                                  onClick={() => {
                                    setSupportStatusDraft('closed');
                                    const closed = Database.updateSupportTicketStatus(selectedSupportTicket.ticket_id, 'closed');
                                    if (!closed) {
                                      toast.error('Failed to close ticket');
                                      return;
                                    }
                                    loadSupportTickets();
                                    toast.success('Ticket closed');
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
                {!reportsDataLoaded && (
                  <div className="mb-4 rounded-lg border border-[#118bdd]/30 bg-[#118bdd]/10 px-3 py-2 text-sm text-[#a7dcff]">
                    Loading transaction data for reports...
                  </div>
                )}
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
                        <option value="rejected">Rejected</option>
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
                              <td className="py-2 px-3 text-white/60 text-sm">{r.description}</td>
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
                              <td className="py-2 px-3 text-amber-400">{formatCurrency(r.amount)}</td>
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
        </Tabs>
      </main>

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
            onClick={() => setSelectedUser(null)}
          >
            <Card
              className="glass border-white/10 bg-[#111827] max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <CardHeader>
                <CardTitle className="text-white">Add Funds</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-white/80">Wallet Type</Label>
                  <select
                    value={fundWalletType}
                    onChange={(e) => setFundWalletType(e.target.value as 'deposit' | 'income')}
                    className="w-full px-4 py-2 bg-[#1f2937] border border-white/10 rounded-lg text-white"
                  >
                    <option value="deposit">Deposit Wallet</option>
                    <option value="income">Income Wallet</option>
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
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setSelectedUser(null)}
                    className="flex-1 border-white/20 text-white hover:bg-white/10"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddFunds}
                    disabled={isLoading}
                    className="flex-1 btn-primary"
                  >
                    {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Add Funds'}
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
                const paymentUser = allUsers.find(u => u.id === selectedPayment.userId);
                return (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">User ID</p>
                        <p className="text-white font-medium font-mono">{paymentUser?.userId}</p>
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
                    </div>

                    {selectedPayment.txHash && (
                      <div className="p-3 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Transaction Hash</p>
                        <p className="text-white font-mono text-sm break-all">{selectedPayment.txHash}</p>
                      </div>
                    )}

                    {selectedPayment.screenshot && (
                      <div className="p-3 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50 mb-2">Payment Screenshot</p>
                        <img
                          src={selectedPayment.screenshot}
                          alt="Payment Proof"
                          className="max-h-48 rounded-lg mx-auto"
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label className="text-white/80">Admin Notes (for rejection)</Label>
                      <textarea
                        value={adminNotes}
                        onChange={(e) => setAdminNotes(e.target.value)}
                        placeholder="Enter reason for rejection..."
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




