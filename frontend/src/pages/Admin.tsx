import { useEffect, useMemo, useState } from 'react';
import { useAuthStore, useAdminStore } from '@/store';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Users, ArrowLeft, TrendingUp, Wallet, Shield,
  Settings, DollarSign, Search, CheckCircle, RefreshCw, Download,
  CreditCard, XCircle, Eye, LogOut, IdCard, Ticket, UserCog,
  BarChart3, Copy, Check, Ban, UserCheck, ArrowUp, ArrowDown
} from 'lucide-react';
import { formatCurrency, formatNumber, formatDate, getInitials, generateAvatarColor } from '@/utils/helpers';
import { toast } from 'sonner';
import Database from '@/db';
import { helpDistributionTable } from '@/db';
import type { Payment, PaymentMethod, Pin } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

interface MemberReportRow {
  id: string;
  createdAt: string;
  userId: string;
  name: string;
  mobile: string;
  sponsorId: string;
  sponsorName: string;
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
  status: string;
  helpNumberInLevel: number;
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
  id: string;
  achievedAt: string;
  userId: string;
  name: string;
  mobile: string;
  completeLevel: number;
  offerAchieved: string;
  sponsorId: string;
  sponsorName: string;
  sponsorMobile: string;
}

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

export default function Admin() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout, adminLoginAsUser } = useAuthStore();
  const {
    stats, settings, allUsers, allTransactions, safetyPoolAmount, allPins, allPinRequests, pendingPinRequests,
    loadStats, loadSettings, loadAllUsers, loadAllTransactions, loadAllPins, loadAllPinRequests, loadPendingPinRequests,
    updateSettings, addFundsToUser, generatePins, approvePinPurchase, rejectPinPurchase, reopenPinPurchase,
    suspendPin, unsuspendPin, blockUser, unblockUser, bulkCreateUsersWithoutPin, reconcileHelpTrackers, activateUsersAndRebuildMatrix,
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
  const [isReconciling, setIsReconciling] = useState(false);
  const [lastReconcileReport, setLastReconcileReport] = useState<any | null>(null);
  const [isRebuildingMatrix, setIsRebuildingMatrix] = useState(false);
  const [lastRebuildReport, setLastRebuildReport] = useState<any | null>(null);
  const [showDeleteAllIdsDialog, setShowDeleteAllIdsDialog] = useState(false);
  const [deleteAllIdsPhrase, setDeleteAllIdsPhrase] = useState('');
  const [deleteAllIdsAdminId, setDeleteAllIdsAdminId] = useState('');
  const [isDeletingAllIds, setIsDeletingAllIds] = useState(false);
  const deleteAllIdsArmed =
    deleteAllIdsPhrase.trim().toUpperCase() === DELETE_ALL_IDS_PHRASE
    && deleteAllIdsAdminId.trim() === (user?.userId || '');

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (!user?.isAdmin) {
      navigate('/dashboard');
      return;
    }

    loadStats();
    loadSettings();
    loadAllUsers();
    loadAllTransactions();
    loadAllPins();
    loadAllPinRequests();
    loadPendingPinRequests();
    loadPayments();
    loadPaymentMethods();
    setBulkNoPin((prev) => ({
      ...prev,
      sponsorUserId: prev.sponsorUserId || user.userId
    }));
  }, [isAuthenticated, user, navigate, loadStats, loadSettings, loadAllUsers, loadAllTransactions, loadAllPins, loadAllPinRequests, loadPendingPinRequests]);

  const loadPayments = () => {
    const payments = Database.getPendingPayments();
    setPendingPayments(payments);
  };

  const loadPaymentMethods = () => {
    const methods = Database.getPaymentMethods();
    setPaymentMethods(methods);
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

      setSearchedUser({
        ...foundUser,
        wallet,
        teamStats,
        payments: userPayments,
        transactions: userTransactions,
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

  const handleReconcileTrackers = async () => {
    setIsReconciling(true);
    const result = await reconcileHelpTrackers();
    setIsReconciling(false);
    if (result.success) {
      setLastReconcileReport(result.report || null);
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
  };

  const handleActivateAndRebuildMatrix = async () => {
    const confirmed = window.confirm(
      'This will activate legacy inactive IDs (except blocked IDs) and rebuild matrix give-help/receive-help from current logic. Continue?'
    );
    if (!confirmed) return;

    setIsRebuildingMatrix(true);
    const result = await activateUsersAndRebuildMatrix();
    setIsRebuildingMatrix(false);

    if (result.success) {
      setLastRebuildReport(result.report || null);
      toast.success(result.message);
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
      setLastReconcileReport(null);
      setLastRebuildReport(null);
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

  const handleBulkCreateNoPin = async () => {
    setBulkNoPinCreated([]);
    setBulkNoPinFailed([]);

    if (!bulkNoPin.sponsorUserId || bulkNoPin.sponsorUserId.length !== 7) {
      toast.error('Enter a valid 7-digit sponsor ID');
      return;
    }

    setBulkNoPinLoading(true);
    const result = await bulkCreateUsersWithoutPin({
      sponsorUserId: bulkNoPin.sponsorUserId,
      quantity: bulkNoPin.quantity,
      namePrefix: bulkNoPin.namePrefix,
      country: bulkNoPin.country,
      password: bulkNoPin.password,
      transactionPassword: bulkNoPin.transactionPassword
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
    const rows: MemberReportRow[] = allUsers.map((u) => {
      const sponsor = u.sponsorId ? userByUserId.get(u.sponsorId) : undefined;
      const blockStatus: MemberReportRow['blockStatus'] = u.accountStatus === 'temp_blocked'
        ? 'temp_blocked'
        : u.accountStatus === 'permanent_blocked'
          ? 'permanent_blocked'
          : u.isActive
            ? 'active'
            : 'inactive';

      return {
        id: u.id,
        createdAt: u.createdAt,
        userId: u.userId,
        name: u.fullName,
        mobile: u.phone || '-',
        sponsorId: u.sponsorId || '-',
        sponsorName: sponsor?.fullName || '-',
        qualifiedLevel: Database.getQualifiedLevel(u.id),
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
  }, [allUsers, userByUserId, memberFilters]);

  const receiveHelpReportRows = useMemo(() => {
    const ordered = [...allTransactions]
      .filter(tx => tx.type === 'get_help')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const counts = new Map<string, number>();
    const rows: ReceiveHelpReportRow[] = ordered.map((tx) => {
      const user = userById.get(tx.userId);
      const level = tx.level || 0;
      const key = `${tx.userId}_${level}`;
      const next = (counts.get(key) || 0) + 1;
      counts.set(key, next);

      return {
        id: tx.id,
        createdAt: tx.createdAt,
        userId: user?.userId || '-',
        userName: user?.fullName || '-',
        amount: Math.abs(tx.amount),
        level,
        status: tx.status,
        helpNumberInLevel: next
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
  }, [allTransactions, userById, receiveFilters]);

  const giveHelpReportRows = useMemo(() => {
    const getHelpTx = allTransactions.filter(tx => tx.type === 'get_help' && tx.fromUserId);
    const rows: GiveHelpReportRow[] = allTransactions
      .filter(tx => tx.type === 'give_help')
      .map((tx) => {
        const sender = userById.get(tx.userId);
        const txAmount = Math.abs(tx.amount);
        let receiver = tx.toUserId ? userById.get(tx.toUserId) : undefined;

        // Fallback for legacy transactions that didn't store explicit receiver
        if (!receiver) {
          const txTime = new Date(tx.createdAt).getTime();
          const candidates = getHelpTx
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
  }, [allTransactions, userById, giveFilters]);

  const offerAchieverRows = useMemo(() => {
    const rows: OfferAchieverReportRow[] = [];

    for (const u of allUsers) {
      const sponsor = u.sponsorId ? userByUserId.get(u.sponsorId) : undefined;
      const base = {
        userId: u.userId,
        name: u.fullName,
        mobile: u.phone || '-',
        sponsorId: sponsor?.userId || '-',
        sponsorName: sponsor?.fullName || '-',
        sponsorMobile: sponsor?.phone || '-'
      };

      if (u.achievements?.nationalTour) {
        rows.push({
          id: `${u.id}_national`,
          achievedAt: u.achievements.nationalTourDate || u.createdAt,
          completeLevel: 5,
          offerAchieved: 'National Tour Achiever',
          ...base
        });
      }
      if (u.achievements?.internationalTour) {
        rows.push({
          id: `${u.id}_international`,
          achievedAt: u.achievements.internationalTourDate || u.createdAt,
          completeLevel: 7,
          offerAchieved: 'International Tour Achiever',
          ...base
        });
      }
      if (u.achievements?.familyTour) {
        rows.push({
          id: `${u.id}_family`,
          achievedAt: u.achievements.familyTourDate || u.createdAt,
          completeLevel: 10,
          offerAchieved: 'International Family Tour Achiever',
          ...base
        });
      }
    }

    return rows.filter((r) => {
      if (!isDateInRange(r.achievedAt, offerFilters.dateFrom, offerFilters.dateTo)) return false;
      if (offerFilters.userId && !safeText(r.userId).includes(offerFilters.userId)) return false;
      if (offerFilters.name && !safeLower(r.name).includes(safeLower(offerFilters.name))) return false;
      if (offerFilters.level && r.completeLevel !== Number(offerFilters.level)) return false;
      if (offerFilters.offer && r.offerAchieved !== offerFilters.offer) return false;
      if (offerFilters.sponsorId && !safeText(r.sponsorId).includes(offerFilters.sponsorId)) return false;
      if (offerFilters.sponsorName && !safeLower(r.sponsorName).includes(safeLower(offerFilters.sponsorName))) return false;
      return true;
    });
  }, [allUsers, userByUserId, offerFilters]);

  const filteredLevelReport = useMemo(() => {
    return levelReport.filter((row) => {
      if (!isDateInRange(row.date, allLevelFilters.dateFrom, allLevelFilters.dateTo)) return false;
      if (allLevelFilters.userId && !safeText(row.userId).includes(allLevelFilters.userId)) return false;
      if (allLevelFilters.name && !safeLower(row.fullName).includes(safeLower(allLevelFilters.name))) return false;
      if (allLevelFilters.sponsorId && !safeText(row.sponsorId).includes(allLevelFilters.sponsorId)) return false;
      return true;
    });
  }, [levelReport, allLevelFilters]);

  const safetyPoolRows = useMemo(() => {
    const pool = Database.getSafetyPool();
    return pool.transactions
      .map((t) => {
        const sourceUser = userById.get(t.fromUserId);
        return {
          id: t.id,
          createdAt: t.createdAt,
          amount: t.amount,
          reason: t.reason || '',
          userId: sourceUser?.userId || '-',
          userName: sourceUser?.fullName || '-'
        };
      })
      .filter((r) => {
        if (!isDateInRange(r.createdAt, safetyPoolFilters.dateFrom, safetyPoolFilters.dateTo)) return false;
        if (safetyPoolFilters.userId && !safeText(r.userId).includes(safetyPoolFilters.userId)) return false;
        if (safetyPoolFilters.reason && !safeLower(r.reason).includes(safeLower(safetyPoolFilters.reason))) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [userById, safetyPoolAmount, safetyPoolFilters]);

  const filteredPinRequests = useMemo(() => {
    if (pinRequestStatusFilter === 'all') return allPinRequests;
    return allPinRequests.filter(r => r.status === pinRequestStatusFilter);
  }, [allPinRequests, pinRequestStatusFilter]);

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
    <div className="min-h-screen bg-[#0a0e17]">
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
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div>
                  <span className="text-base sm:text-xl font-bold text-white">Admin Panel</span>
                  <Badge className="hidden sm:inline-flex ml-2 bg-purple-500/20 text-purple-400">Admin</Badge>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
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
                onClick={() => {
                  loadStats();
                  loadAllUsers();
                  loadAllTransactions();
                  loadAllPins();
                  loadAllPinRequests();
                  loadPendingPinRequests();
                  loadPayments();
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm text-white/60">Total Users</p>
                  <p className="text-2xl font-bold text-white">{formatNumber(stats?.totalUsers || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm text-white/60">Active Users</p>
                  <p className="text-2xl font-bold text-white">{formatNumber(stats?.activeUsers || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-sm text-white/60">Total Distributed</p>
                  <p className="text-2xl font-bold text-white">{formatCurrency(stats?.totalHelpDistributed || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm text-white/60">Safety Pool</p>
                  <p className="text-2xl font-bold text-white">{formatCurrency(safetyPoolAmount)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="users" className="space-y-6">
          <TabsList className="bg-[#1f2937] border border-white/10 flex-wrap h-auto">
            <TabsTrigger value="users" className="data-[state=active]:bg-[#118bdd]">Users</TabsTrigger>
            <TabsTrigger value="pins" className="data-[state=active]:bg-[#118bdd]">PIN Management</TabsTrigger>
            <TabsTrigger value="payments" className="data-[state=active]:bg-[#118bdd]">
              Payments {pendingPayments.length > 0 && <span className="ml-1 text-xs bg-red-500 text-white px-1.5 rounded-full">{pendingPayments.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="user-details" className="data-[state=active]:bg-[#118bdd]">User Details</TabsTrigger>
            <TabsTrigger value="impersonate" className="data-[state=active]:bg-[#118bdd]">Login As User</TabsTrigger>
            <TabsTrigger value="reports" className="data-[state=active]:bg-[#118bdd]">Reports</TabsTrigger>
            <TabsTrigger value="matrix" className="data-[state=active]:bg-[#118bdd]">Matrix Table</TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-[#118bdd]">Settings</TabsTrigger>
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
                      max={500}
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
                  Create IDs Without PIN
                </Button>

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
              <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="text-white flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                  Top Referrers
                </CardTitle>
                <div className="flex items-center gap-2">
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
                <div className="overflow-x-auto">
                  <table className="w-full">
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
                <div className="overflow-x-auto">
                  <table className="w-full">
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
                              <div className="flex items-center gap-3">
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
                                {u.accountStatus === 'active' && !u.isActive && (
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
                              <div className="flex gap-2">
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
                  <div className="flex items-center justify-between gap-3">
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
                      className="px-3 h-9 bg-[#1f2937] border border-white/10 rounded-md text-white text-sm"
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
                          <div className="flex items-center justify-between mb-2">
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
                          <div className="flex gap-2 mt-3">
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
                  <div className="overflow-x-auto">
                    <table className="w-full">
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
                <CardHeader className="flex flex-row items-center justify-between">
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
                  <div className="overflow-x-auto">
                    <table className="w-full">
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
                      <div key={method.id} className="flex items-center justify-between p-4 rounded-lg bg-[#1f2937]">
                        <div className="flex items-center gap-3">
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
                        <div className="flex items-center gap-2">
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
                <div className="flex gap-3 mb-6">
                  <Input
                    value={userSearchId}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '').slice(0, 7);
                      setUserSearchId(value);
                    }}
                    maxLength={7}
                    placeholder="Enter 7-digit User ID"
                    className="bg-[#1f2937] border-white/10 text-white max-w-xs"
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
                    {/* User Info */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">User ID</p>
                        <p className="text-xl font-bold text-[#118bdd] font-mono">{searchedUser.userId}</p>
                      </div>
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Name</p>
                        <p className="text-xl font-bold text-white">{searchedUser.fullName}</p>
                      </div>
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Status</p>
                        <div className="space-y-1">
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
                    </div>

                    {/* Wallet Info - Three Wallets */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Deposit Wallet</p>
                        <p className="text-xl font-bold text-white">{formatCurrency(searchedUser.wallet?.depositWallet || 0)}</p>
                      </div>
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">PIN Wallet</p>
                        <p className="text-xl font-bold text-[#118bdd]">{searchedUser.pins?.filter((p: Pin) => p.status === 'unused').length || 0} PINs</p>
                      </div>
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Income Wallet</p>
                        <p className="text-xl font-bold text-emerald-400">{formatCurrency(searchedUser.wallet?.incomeWallet || 0)}</p>
                      </div>
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Direct Referrals</p>
                        <p className="text-xl font-bold text-white">{searchedUser.directCount}</p>
                      </div>
                    </div>

                    {/* Team Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50 mb-2">Left Team</p>
                        <p className="text-2xl font-bold text-white">{searchedUser.teamStats?.left || 0}</p>
                        <p className="text-sm text-emerald-400">{searchedUser.teamStats?.leftActive || 0} Active</p>
                      </div>
                      <div className="p-4 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50 mb-2">Right Team</p>
                        <p className="text-2xl font-bold text-white">{searchedUser.teamStats?.right || 0}</p>
                        <p className="text-sm text-emerald-400">{searchedUser.teamStats?.rightActive || 0} Active</p>
                      </div>
                    </div>

                    {/* Pending Matrix Debug */}
                    <div className="space-y-3">
                      <h4 className="text-white font-medium">Pending Matrix Debug (Sender Queue)</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 rounded-lg bg-[#1f2937]">
                          <p className="text-sm text-white/50">Total Pending</p>
                          <p className="text-2xl font-bold text-white">{searchedUser.pendingMatrixDebug?.totalPending || 0}</p>
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
                          <div className="overflow-x-auto">
                            <table className="w-full">
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
                                <div className="flex items-center justify-between gap-3">
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
                          <p className="text-2xl font-bold text-white">{searchedUser.incomingPendingMatrixDebug?.totalPending || 0}</p>
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
                          <div className="overflow-x-auto">
                            <table className="w-full">
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
                                <div className="flex items-center justify-between gap-3">
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
                      <div className="overflow-x-auto">
                        <table className="w-full">
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
                                  <Badge variant="outline" className="border-white/20 text-white/80 capitalize">
                                    {tx.type.replace('_', ' ')}
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

          {/* Reports Tab */}
          <TabsContent value="reports">
            <Card className="glass border-white/10">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-white flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-[#118bdd]" />
                  Advanced Reports & Filters
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={handleActivateAndRebuildMatrix}
                    disabled={isRebuildingMatrix}
                    className="border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                  >
                    {isRebuildingMatrix ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    Activate + Rebuild Matrix
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleReconcileTrackers}
                    disabled={isReconciling}
                    className="border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                  >
                    {isReconciling ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    Reconcile Matrix
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {lastRebuildReport && (
                  <div className="mb-4 p-3 rounded-lg bg-[#1f2937] border border-rose-400/20 text-sm text-white/70">
                    <span className="mr-4">Activated IDs: {lastRebuildReport.activatedUsers}</span>
                    <span className="mr-4">Node Sync: {lastRebuildReport.activatedMatrixNodes}</span>
                    <span className="mr-4">Direct Count Fixes: {lastRebuildReport.directCountsUpdated}</span>
                    <span className="mr-4">Removed Matrix TX: {lastRebuildReport.removedMatrixTransactions}</span>
                    <span className="mr-4">Removed Safety Entries: {lastRebuildReport.removedMatrixSafetyPoolEntries}</span>
                    <span className="mr-4">Trackers Reset: {lastRebuildReport.trackersReset}</span>
                    <span className="mr-4">Replayed Members: {lastRebuildReport.replayedMembers}</span>
                    <span>Post-Reconcile Wallet Syncs: {lastRebuildReport.reconciliation?.walletSyncs || 0}</span>
                  </div>
                )}
                {lastReconcileReport && (
                  <div className="mb-4 p-3 rounded-lg bg-[#1f2937] border border-white/10 text-sm text-white/70">
                    <span className="mr-4">Scanned: {lastReconcileReport.scannedTrackers}</span>
                    <span className="mr-4">Created: {lastReconcileReport.createdTrackers}</span>
                    <span className="mr-4">Removed: {lastReconcileReport.removedTrackers}</span>
                    <span className="mr-4">Level Repairs: {lastReconcileReport.repairedLevels}</span>
                    <span className="mr-4">Queue Repairs: {lastReconcileReport.repairedQueueItems}</span>
                    <span>Wallet Syncs: {lastReconcileReport.walletSyncs}</span>
                  </div>
                )}
                <Tabs value={reportTab} onValueChange={setReportTab} className="space-y-4">
                  <TabsList className="bg-[#1f2937] border border-white/10 flex-wrap h-auto">
                    <TabsTrigger value="member-report" className="data-[state=active]:bg-[#118bdd]">Member Report</TabsTrigger>
                    <TabsTrigger value="receive-help" className="data-[state=active]:bg-[#118bdd]">Receive Help</TabsTrigger>
                    <TabsTrigger value="give-help" className="data-[state=active]:bg-[#118bdd]">Give Help</TabsTrigger>
                    <TabsTrigger value="offer-achievers" className="data-[state=active]:bg-[#118bdd]">Offer Achievers</TabsTrigger>
                    <TabsTrigger value="all-level" className="data-[state=active]:bg-[#118bdd]">All Level Report</TabsTrigger>
                    <TabsTrigger value="safety-pool" className="data-[state=active]:bg-[#118bdd]">Safety Pool</TabsTrigger>
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
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 px-3 text-white/60">Date & Time</th>
                            <th className="text-left py-2 px-3 text-white/60">ID</th>
                            <th className="text-left py-2 px-3 text-white/60">Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Mobile</th>
                            <th className="text-left py-2 px-3 text-white/60">Sponsor ID</th>
                            <th className="text-left py-2 px-3 text-white/60">Sponsor Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Qualified Level</th>
                            <th className="text-left py-2 px-3 text-white/60">Offer</th>
                            <th className="text-left py-2 px-3 text-white/60">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {memberReportRows.slice(0, 200).map((r) => (
                            <tr key={r.id} className="border-b border-white/5">
                              <td className="py-2 px-3 text-white/60">{formatDate(r.createdAt)}</td>
                              <td className="py-2 px-3 text-[#118bdd] font-mono">{r.userId}</td>
                              <td className="py-2 px-3 text-white">{r.name}</td>
                              <td className="py-2 px-3 text-white/60">{r.mobile}</td>
                              <td className="py-2 px-3 text-white/60">{r.sponsorId}</td>
                              <td className="py-2 px-3 text-white/60">{r.sponsorName}</td>
                              <td className="py-2 px-3 text-white/60">L{r.qualifiedLevel}</td>
                              <td className="py-2 px-3 text-white/60">{r.achievedOffer}</td>
                              <td className="py-2 px-3 text-white/60">{r.blockStatus}</td>
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
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 px-3 text-white/60">Date & Time</th>
                            <th className="text-left py-2 px-3 text-white/60">ID</th>
                            <th className="text-left py-2 px-3 text-white/60">User Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Received Help</th>
                            <th className="text-left py-2 px-3 text-white/60">From Level</th>
                            <th className="text-left py-2 px-3 text-white/60">Status</th>
                            <th className="text-left py-2 px-3 text-white/60">Help # in Level</th>
                          </tr>
                        </thead>
                        <tbody>
                          {receiveHelpReportRows.slice(0, 300).map((r) => (
                            <tr key={r.id} className="border-b border-white/5">
                              <td className="py-2 px-3 text-white/60">{formatDate(r.createdAt)}</td>
                              <td className="py-2 px-3 text-[#118bdd] font-mono">{r.userId}</td>
                              <td className="py-2 px-3 text-white">{r.userName}</td>
                              <td className="py-2 px-3 text-emerald-400">{formatCurrency(r.amount)}</td>
                              <td className="py-2 px-3 text-white/60">{r.level}</td>
                              <td className="py-2 px-3 text-white/60">{r.status}</td>
                              <td className="py-2 px-3 text-white/60">{r.helpNumberInLevel}</td>
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
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 px-3 text-white/60">Date & Time</th>
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
                              <td className="py-2 px-3 text-white/60">{formatDate(r.createdAt)}</td>
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

                  <TabsContent value="offer-achievers" className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
                      <Input type="date" value={offerFilters.dateFrom} onChange={(e) => setOfferFilters({ ...offerFilters, dateFrom: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input type="date" value={offerFilters.dateTo} onChange={(e) => setOfferFilters({ ...offerFilters, dateTo: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="User ID" value={offerFilters.userId} onChange={(e) => setOfferFilters({ ...offerFilters, userId: e.target.value.replace(/\D/g, '').slice(0, 7) })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Name" value={offerFilters.name} onChange={(e) => setOfferFilters({ ...offerFilters, name: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Complete Level" type="number" min={1} max={10} value={offerFilters.level} onChange={(e) => setOfferFilters({ ...offerFilters, level: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                      <select value={offerFilters.offer} onChange={(e) => setOfferFilters({ ...offerFilters, offer: e.target.value })} className="px-3 h-10 bg-[#1f2937] border border-white/10 rounded-md text-white">
                        <option value="">All Offers</option>
                        <option value="National Tour Achiever">National Tour Achiever</option>
                        <option value="International Tour Achiever">International Tour Achiever</option>
                        <option value="International Family Tour Achiever">International Family Tour Achiever</option>
                      </select>
                      <Input placeholder="Sponsor ID" value={offerFilters.sponsorId} onChange={(e) => setOfferFilters({ ...offerFilters, sponsorId: e.target.value.replace(/\D/g, '').slice(0, 7) })} className="bg-[#1f2937] border-white/10 text-white" />
                      <Input placeholder="Sponsor Name" value={offerFilters.sponsorName} onChange={(e) => setOfferFilters({ ...offerFilters, sponsorName: e.target.value })} className="bg-[#1f2937] border-white/10 text-white" />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 px-3 text-white/60">Date</th>
                            <th className="text-left py-2 px-3 text-white/60">ID</th>
                            <th className="text-left py-2 px-3 text-white/60">Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Mobile</th>
                            <th className="text-left py-2 px-3 text-white/60">Complete Level</th>
                            <th className="text-left py-2 px-3 text-white/60">Offer</th>
                            <th className="text-left py-2 px-3 text-white/60">Sponsor ID</th>
                            <th className="text-left py-2 px-3 text-white/60">Sponsor Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Sponsor Mobile</th>
                          </tr>
                        </thead>
                        <tbody>
                          {offerAchieverRows.slice(0, 200).map((r) => (
                            <tr key={r.id} className="border-b border-white/5">
                              <td className="py-2 px-3 text-white/60">{formatDate(r.achievedAt)}</td>
                              <td className="py-2 px-3 text-[#118bdd] font-mono">{r.userId}</td>
                              <td className="py-2 px-3 text-white">{r.name}</td>
                              <td className="py-2 px-3 text-white/60">{r.mobile}</td>
                              <td className="py-2 px-3 text-white/60">{r.completeLevel}</td>
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
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 px-3 text-white/60">Level</th>
                            <th className="text-left py-2 px-3 text-white/60">User ID</th>
                            <th className="text-left py-2 px-3 text-white/60">Name</th>
                            <th className="text-left py-2 px-3 text-white/60">Sponsor</th>
                            <th className="text-left py-2 px-3 text-white/60">Get Help</th>
                            <th className="text-left py-2 px-3 text-white/60">Give Help</th>
                            <th className="text-left py-2 px-3 text-white/60">Net</th>
                            <th className="text-left py-2 px-3 text-white/60">Qualified</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLevelReport.slice(0, 300).map((row, index) => (
                            <tr key={`${row.userId}_${index}`} className="border-b border-white/5">
                              <td className="py-2 px-3"><Badge className="bg-[#118bdd]/20 text-[#118bdd]">Level {row.level}</Badge></td>
                              <td className="py-2 px-3 text-[#118bdd] font-mono">{row.userId}</td>
                              <td className="py-2 px-3 text-white">{row.fullName}</td>
                              <td className="py-2 px-3 text-white/60">{row.sponsorId}</td>
                              <td className="py-2 px-3 text-emerald-400">{formatCurrency(row.getHelpAmount)}</td>
                              <td className="py-2 px-3 text-orange-400">{formatCurrency(row.giveHelpAmount)}</td>
                              <td className="py-2 px-3 text-purple-400">{formatCurrency(row.netAmount)}</td>
                              <td className="py-2 px-3">{row.isQualified ? <Badge className="bg-emerald-500/20 text-emerald-400">Yes</Badge> : <Badge className="bg-red-500/20 text-red-400">No</Badge>}</td>
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
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 px-3 text-white/60">Date & Time</th>
                            <th className="text-left py-2 px-3 text-white/60">From ID</th>
                            <th className="text-left py-2 px-3 text-white/60">From User</th>
                            <th className="text-left py-2 px-3 text-white/60">Amount</th>
                            <th className="text-left py-2 px-3 text-white/60">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {safetyPoolRows.slice(0, 300).map((r) => (
                            <tr key={r.id} className="border-b border-white/5">
                              <td className="py-2 px-3 text-white/60">{formatDate(r.createdAt)}</td>
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
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-[#1f2937]">
                        <th className="text-left py-4 px-6 text-white/60 font-medium">Level</th>
                        <th className="text-left py-4 px-6 text-white/60 font-medium">Users</th>
                        <th className="text-left py-4 px-6 text-white/60 font-medium">Per User Help</th>
                        <th className="text-left py-4 px-6 text-white/60 font-medium">Total Get Help</th>
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
                          <td className="py-4 px-6 text-emerald-400">{formatCurrency(row.totalGetHelp)}</td>
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

                <div className="flex items-center gap-4 p-4 rounded-lg bg-[#1f2937]">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.reEntryEnabled}
                      onChange={(e) => handleUpdateSettings('reEntryEnabled', e.target.checked)}
                      className="w-4 h-4 rounded border-white/20"
                    />
                    <Label className="text-white/80 mb-0">Enable Re-Entry System</Label>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 rounded-lg bg-[#1f2937]">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.safetyPoolEnabled}
                      onChange={(e) => handleUpdateSettings('safetyPoolEnabled', e.target.checked)}
                      className="w-4 h-4 rounded border-white/20"
                    />
                    <Label className="text-white/80 mb-0">Enable Safety Pool</Label>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 rounded-lg bg-[#1f2937]">
                  <div className="flex items-center gap-2">
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
        <DialogContent className="glass border-red-500/40 bg-[#111827] max-w-lg">
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
      {selectedUser && (
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
              <div className="flex gap-3">
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
      )}

      {/* Generated PINs Dialog */}
      <Dialog open={showPinDialog} onOpenChange={setShowPinDialog}>
        <DialogContent className="glass border-white/10 bg-[#111827] max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Generated PINs</DialogTitle>
            <DialogDescription className="text-white/60">
              Copy these PINs and share them with the recipient.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {generatedPins.map((pin) => (
              <div key={pin.id} className="flex items-center justify-between p-3 rounded-lg bg-[#1f2937]">
                <span className="font-mono text-lg text-white">{pin.pinCode}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyPin(pin.pinCode)}
                  className="border-white/20 text-white hover:bg-white/10"
                >
                  {copiedPin === pin.pinCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
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
        <DialogContent className="glass border-white/10 bg-[#111827] max-w-lg">
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

                    <div className="flex gap-3">
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
    </div>
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
