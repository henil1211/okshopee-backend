import type {
  User, Wallet, Transaction, MatrixNode, SafetyPoolTransaction,
  GracePeriod, Notification, AdminSettings, PaymentMethod, Payment, PaymentStatus,
  Pin, PinTransfer, OtpRecord, PinPurchaseRequest, EmailLog,
  ImpersonationSession, SupportTicket, SupportTicketAttachment,
  AdminAnnouncement,
  GhostReceiveHelpRepairLog,
  SupportTicketCategory, SupportTicketMessage, SupportTicketPriority,
  SupportTicketStatus,
  MarketplaceCategory, MarketplaceRetailer, MarketplaceBanner, MarketplaceDeal,
  MarketplaceInvoice, RewardRedemption
} from '@/types';

import { resolveBackendBaseUrl } from '@/utils/backendBaseUrl';

// Database Keys
const DB_KEYS = {
  USERS: 'mlm_users',
  WALLETS: 'mlm_wallets',
  TRANSACTIONS: 'mlm_transactions',
  MATRIX: 'mlm_matrix',
  SAFETY_POOL: 'mlm_safety_pool',
  GRACE_PERIODS: 'mlm_grace_periods',
  RE_ENTRIES: 'mlm_reentries',
  NOTIFICATIONS: 'mlm_notifications',
  ANNOUNCEMENTS: 'mlm_announcements',
  SETTINGS: 'mlm_settings',
  PAYMENT_METHODS: 'mlm_payment_methods',
  PAYMENTS: 'mlm_payments',
  CURRENT_USER: 'mlm_current_user',
  SESSION: 'mlm_session',
  // PIN System Keys
  PINS: 'mlm_pins',
  PIN_TRANSFERS: 'mlm_pin_transfers',
  PIN_PURCHASE_REQUESTS: 'mlm_pin_purchase_requests',
  OTP_RECORDS: 'mlm_otp_records',
  EMAIL_LOGS: 'mlm_email_logs',
  IMPERSONATION: 'mlm_impersonation',
  SUPPORT_TICKETS: 'mlm_support_tickets',
  HELP_TRACKERS: 'mlm_help_trackers',
  MATRIX_PENDING_CONTRIBUTIONS: 'mlm_matrix_pending_contributions',
  GHOST_HELP_REPAIR_LOG: 'mlm_ghost_help_repair_log',
  // Marketplace Keys
  MARKETPLACE_CATEGORIES: 'mlm_marketplace_categories',
  MARKETPLACE_RETAILERS: 'mlm_marketplace_retailers',
  MARKETPLACE_BANNERS: 'mlm_marketplace_banners',
  MARKETPLACE_DEALS: 'mlm_marketplace_deals',
  MARKETPLACE_INVOICES: 'mlm_marketplace_invoices',
  MARKETPLACE_REDEMPTIONS: 'mlm_marketplace_redemptions'
};

const HELP_FLOW_DEBUG_KEY = 'mlm_help_flow_debug';
const DUPLICATE_CONTRIBUTION_BLOCK_KEY = 'mlm_duplicate_contribution_blocks';
const APP_STORAGE_VERSION = '2026-04-14-1';
const APP_STORAGE_VERSION_KEY = 'mlm_app_storage_version';

function resetBrowserStateOnBuildChange(): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;

  try {
    const storedVersion = localStorage.getItem(APP_STORAGE_VERSION_KEY);
    if (storedVersion === APP_STORAGE_VERSION) return;

    for (const key of Object.values(DB_KEYS)) {
      localStorage.removeItem(key);
    }
    localStorage.removeItem(HELP_FLOW_DEBUG_KEY);
    localStorage.removeItem(DUPLICATE_CONTRIBUTION_BLOCK_KEY);
    localStorage.setItem(APP_STORAGE_VERSION_KEY, APP_STORAGE_VERSION);
  } catch {
    // Best-effort cleanup only.
  }
}

resetBrowserStateOnBuildChange();

// Generate 7-digit unique ID
function generateSevenDigitId(): string {
  return Math.floor(1000000 + Math.random() * 9000000).toString();
}

// Generate PIN code (7-digit alphanumeric)
function generatePinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding confusing chars like 0, O, 1, I
  let pin = '';
  for (let i = 0; i < 7; i++) {
    pin += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pin;
}

// Generate numeric OTP
function generateOTP(length: number = 6): string {
  return Math.floor(Math.pow(10, length - 1) + Math.random() * 9 * Math.pow(10, length - 1)).toString();
}

let eventIdCounter = 0;
function generateEventId(prefix: string, tag?: string): string {
  eventIdCounter = (eventIdCounter + 1) % 1000000;
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const safeTag = String(tag || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return safeTag
    ? `${prefix}_${ts}_${eventIdCounter}_${rand}_${safeTag}`
    : `${prefix}_${ts}_${eventIdCounter}_${rand}`;
}

function normalizeMarketplaceSlug(value: string): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getMarketplaceCategoryId(slug: string): string {
  return `mcat_${normalizeMarketplaceSlug(slug)}`;
}

function getMarketplaceCategoryIcon(name: string, slug?: string, fallback: string = 'ShoppingBag'): string {
  const normalized = `${normalizeMarketplaceSlug(name)} ${normalizeMarketplaceSlug(slug || '')}`.trim();

  if (/(^|\s)(kids|kid|baby|kidswear)(\s|$)/.test(normalized)) return 'Baby';
  if (/(^|\s)(beauty|skin-care|skin)(\s|$)/.test(normalized)) return 'SoapDispenserDroplet';
  if (/(^|\s)(jewellery|jewelry|jewel)(\s|$)/.test(normalized)) return 'Gem';
  if (/(^|\s)(toys|toy|gifts|gift)(\s|$)/.test(normalized)) return 'Gift';
  if (/(^|\s)(perfume|fragrance)(\s|$)/.test(normalized)) return 'SprayCan';
  if (/(^|\s)(female-only|women-only|women|ladies)(\s|$)/.test(normalized)) return 'Venus';
  if (/(^|\s)(men-only|mens|men|male)(\s|$)/.test(normalized)) return 'Mars';
  if (/(^|\s)(astrology|astro)(\s|$)/.test(normalized)) return 'WandSparkles';
  if (/(^|\s)(home|kitchen)(\s|$)/.test(normalized)) return 'CookingPot';
  if (/(^|\s)(health|medicine|medical|pharma)(\s|$)/.test(normalized)) return 'Pill';
  if (/(^|\s)(finance|loan|bank|insurance)(\s|$)/.test(normalized)) return 'BadgeCent';
  if (/(^|\s)(gadgets|gadget|accessories|accessory|electronic|electronics)(\s|$)/.test(normalized)) return 'Smartphone';
  if (/(^|\s)(tour|travel|booking|trip|flight)(\s|$)/.test(normalized)) return 'Plane';
  if (/(^|\s)(car|bike|automotive)(\s|$)/.test(normalized)) return 'Car';
  if (/(^|\s)(education|study|learning|course)(\s|$)/.test(normalized)) return 'GraduationCap';
  if (/(^|\s)(fashion|clothing|apparel)(\s|$)/.test(normalized)) return 'Handbag';
  if (/(^|\s)(popular|store|ecommerce|shopping)(\s|$)/.test(normalized)) return 'Store';

  return fallback;
}

// Initialize default admin settings
const defaultSettings: AdminSettings = {
  activationAmount: 11,
  pinAmount: 11,
  directIncomePercent: 45.45,
  helpingAmountPercent: 45.45,
  adminFeePercent: 9.09,
  withdrawalFeePercent: 5,
  depositProcessingHours: 72,
  withdrawalProcessingHours: 72,
  gracePeriodHours: 72,
  maxLevels: 10,
  matrixViewMaxLevels: 20,
  reEntryEnabled: true,
  safetyPoolEnabled: true,
  marketplaceEnabled: true,
  activationDeadlineDays: 0,
  directReferralDeadlineDays: 30,
  requireOtpForTransactions: true,
  masterPassword: 'master@2024', // Default master password
  lockedIncomeStrictFrom: new Date().toISOString()
};

// Updated Help Distribution Table - New Logic with Qualification
export const helpDistributionTable = [
  // directRequired here means NEW direct refers required for this level (incremental)
  { level: 1, users: 2, perUserHelp: 5, totalReceiveHelp: 10, giveHelp: 10, netBalance: 0, directRequired: 0, qualifiedReceiveHelp: 10, unqualifiedCarryForward: 0 },
  { level: 2, users: 4, perUserHelp: 10, totalReceiveHelp: 40, giveHelp: 20, netBalance: 20, directRequired: 2, qualifiedReceiveHelp: 40, unqualifiedCarryForward: 0 },
  { level: 3, users: 8, perUserHelp: 20, totalReceiveHelp: 160, giveHelp: 40, netBalance: 120, directRequired: 3, qualifiedReceiveHelp: 160, unqualifiedCarryForward: 0 },
  { level: 4, users: 16, perUserHelp: 40, totalReceiveHelp: 640, giveHelp: 80, netBalance: 560, directRequired: 4, qualifiedReceiveHelp: 640, unqualifiedCarryForward: 0 },
  { level: 5, users: 32, perUserHelp: 80, totalReceiveHelp: 2560, giveHelp: 160, netBalance: 2400, directRequired: 5, qualifiedReceiveHelp: 2560, unqualifiedCarryForward: 0 },
  { level: 6, users: 64, perUserHelp: 160, totalReceiveHelp: 10240, giveHelp: 320, netBalance: 9920, directRequired: 10, qualifiedReceiveHelp: 10240, unqualifiedCarryForward: 0 },
  { level: 7, users: 128, perUserHelp: 320, totalReceiveHelp: 40960, giveHelp: 640, netBalance: 40320, directRequired: 20, qualifiedReceiveHelp: 40960, unqualifiedCarryForward: 0 },
  { level: 8, users: 256, perUserHelp: 640, totalReceiveHelp: 163840, giveHelp: 1280, netBalance: 162560, directRequired: 40, qualifiedReceiveHelp: 163840, unqualifiedCarryForward: 0 },
  { level: 9, users: 512, perUserHelp: 1280, totalReceiveHelp: 655360, giveHelp: 2560, netBalance: 652800, directRequired: 80, qualifiedReceiveHelp: 655360, unqualifiedCarryForward: 0 },
  { level: 10, users: 1024, perUserHelp: 2560, totalReceiveHelp: 2621440, giveHelp: 5120, netBalance: 2616320, directRequired: 100, qualifiedReceiveHelp: 2621440, unqualifiedCarryForward: 0 }
];

// Default Payment Methods
const defaultPaymentMethods: PaymentMethod[] = [
  {
    id: 'crypto_usdt',
    name: 'USDT (BEP-20)',
    type: 'crypto',
    icon: 'usdt',
    description: 'Pay with USDT BEP-20',
    instructions: 'Send USDT BEP-20 to the provided wallet address. Upload transaction proof for verification.',
    walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    isActive: true,
    minAmount: 10,
    maxAmount: 50000,
    processingFee: 0,
    processingTime: 'Within 72 hours'
  }
];

const SUPPORT_TICKET_CATEGORIES: SupportTicketCategory[] = [
  'profile_update',
  'deposit_withdrawal',
  'network_matrix',
  'activation_pin',
  'affiliate_shopping',
  'other',
  // Legacy
  'account_issues',
  'deposit_payment_issues',
  'withdrawal_issues',
  'referral_matrix_issues',
  'technical_issues'
];

const SUPPORT_TICKET_STATUSES: SupportTicketStatus[] = [
  'open',
  'in_progress',
  'awaiting_user_response',
  'resolved',
  'closed'
];

const SUPPORT_TICKET_PRIORITIES: SupportTicketPriority[] = ['low', 'medium', 'high'];

interface LockedGiveHelpItem {
  id: string;
  level: number;
  amount: number;
  fromUserId?: string;
  createdAt: string;
  releasedAt?: string;
  status: 'locked' | 'released';
}

interface LevelHelpTrackerState {
  level: number;
  perUserHelp: number;
  directRequired: number;
  leftEvents: number;
  rightEvents: number;
  matchedEvents: number;
  receiveEvents: number;
  receivedAmount: number;
  giveEvents: number;
  givenAmount: number;
  lockedAmount: number;
  lockedReceiveAmount: number;
  safetyDeducted: number;
  manualCompletion?: boolean;
}

interface UserHelpTracker {
  userId: string;
  levels: Record<string, LevelHelpTrackerState>;
  lockedQueue: LockedGiveHelpItem[];
  processedContributionKeys?: Record<string, string>;
}

interface PendingMatrixContribution {
  id: string;
  fromUserId: string;
  toUserId: string;
  level: number;
  side: 'left' | 'right';
  status: 'pending' | 'completed';
  createdAt: string;
  completedAt?: string;
}

interface MatrixHelpEventOptions {
  skipFromWalletDebit?: boolean;
}

interface GiveHelpExecuteOptions {
  useLockedIncome?: boolean;
  lockedIncomeLevel?: number;
}

export interface LockedIncomeBreakdownItem {
  level: number;
  lockedAmount: number;
  lockedFirstTwoAmount: number;
  lockedQualificationAmount: number;
  requiredDirect: number;
  currentDirect: number;
  remainingDirect: number;
  qualified: boolean;
  reason: string;
}

export interface PendingMatrixDebugLevelRow {
  level: number;
  pending: number;
  blocked: number;
  ready: number;
}

export interface PendingMatrixDebugItem {
  id: string;
  level: number;
  side: 'left' | 'right';
  toUserId: string;
  toUserName: string;
  createdAt: string;
  status: 'ready' | 'blocked';
  reason: string;
}

export interface PendingMatrixDebugReport {
  fromUserId: string;
  totalPending: number;
  blockedAtItemId: string | null;
  blockedReason: string | null;
  levels: PendingMatrixDebugLevelRow[];
  items: PendingMatrixDebugItem[];
}

export interface PendingMatrixIncomingDebugLevelRow {
  level: number;
  pending: number;
  blocked: number;
  ready: number;
}

export interface PendingMatrixIncomingDebugItem {
  id: string;
  level: number;
  side: 'left' | 'right';
  fromUserId: string;
  fromUserName: string;
  createdAt: string;
  status: 'ready' | 'blocked';
  reason: string;
}

export interface PendingMatrixIncomingDebugReport {
  toUserId: string;
  totalPending: number;
  blockedSenders: number;
  levels: PendingMatrixIncomingDebugLevelRow[];
  items: PendingMatrixIncomingDebugItem[];
}

export interface HelpFlowDebugEntry {
  id: string;
  createdAt: string;
  fromUserId: string;
  fromUserName: string;
  fromUserPublicId?: string;
  sourceLevel: number;
  targetLevel: number;
  amount: number;
  toUserId?: string;
  toUserName?: string;
  toUserPublicId?: string;
  outcome: 'sent' | 'safety_pool';
  reason: string;
}

export interface DuplicateContributionBlockEntry {
  id: string;
  createdAt: string;
  contributionKey: string;
  fromUserId?: string;
  fromUserName?: string;
  fromUserPublicId?: string;
  toUserId: string;
  toUserName?: string;
  toUserPublicId?: string;
  level: number;
  side: 'left' | 'right';
  via: 'activation' | 'pending';
  reason: 'duplicate_contribution_key';
}

export interface HistoricalAutoRecoveryDetail {
  id: string;
  kind: 'referral_income_mismatch' | 'duplicate_give_help_mismatch';
  referenceId: string;
  userId: string;
  userName: string;
  reason: string;
  beforeDue: number;
  recoveredNow: number;
  afterDue: number;
  status: 'active' | 'cleared' | 'no_change';
  note: string;
  createdAt: string;
}

export interface FundTransferIntegrityMismatchRow {
  id: string;
  kind: 'missing_sender_debit' | 'missing_recipient_credit' | 'duplicate_recipient_credit';
  senderUserId: string;
  senderName: string;
  recipientUserId: string;
  recipientName: string;
  amount: number;
  createdAt: string;
  debitTxId?: string;
  creditTxId?: string;
  matchedTxId?: string;
  note: string;
}

export type RemoteSyncState = 'synced' | 'syncing' | 'pending' | 'offline';

export interface RemoteSyncStatus {
  state: RemoteSyncState;
  message: string;
  dirtyKeys: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  pendingSinceAt: string | null;
}

export interface SensitiveActionSyncGate {
  allowed: boolean;
  message: string;
  status: RemoteSyncStatus;
}

// Generic DB Operations
class Database {
  private static readonly REMOTE_SYNC_BASE_URL = (() => {
    const configured = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_BACKEND_URL;
    return resolveBackendBaseUrl(configured);
  })();
  private static readonly REMOTE_SYNC_KEYS = new Set<string>(
    Object.values(DB_KEYS).filter(
      (key) => key !== DB_KEYS.CURRENT_USER
        && key !== DB_KEYS.SESSION
        && key !== DB_KEYS.PAYMENT_METHODS
    )
  );
  private static readonly STARTUP_REMOTE_SYNC_BATCHES = [
    [DB_KEYS.USERS, DB_KEYS.WALLETS, DB_KEYS.SETTINGS],
  ] as const;
  private static readonly STARTUP_DEFERRED_SYNC_BATCHES = [
    [DB_KEYS.MATRIX],
    [DB_KEYS.TRANSACTIONS, DB_KEYS.SAFETY_POOL, DB_KEYS.GHOST_HELP_REPAIR_LOG],
    [DB_KEYS.NOTIFICATIONS, DB_KEYS.ANNOUNCEMENTS, DB_KEYS.SUPPORT_TICKETS],
    [DB_KEYS.MARKETPLACE_CATEGORIES, DB_KEYS.MARKETPLACE_RETAILERS, DB_KEYS.MARKETPLACE_BANNERS, DB_KEYS.MARKETPLACE_DEALS],
    [DB_KEYS.MARKETPLACE_INVOICES, DB_KEYS.MARKETPLACE_REDEMPTIONS]
  ] as const;
  private static readonly ADMIN_REMOTE_SYNC_BATCHES = [
    [DB_KEYS.USERS],
    [DB_KEYS.WALLETS],
    [DB_KEYS.SETTINGS, DB_KEYS.SAFETY_POOL],
    [DB_KEYS.TRANSACTIONS, DB_KEYS.GHOST_HELP_REPAIR_LOG],
    [DB_KEYS.NOTIFICATIONS, DB_KEYS.ANNOUNCEMENTS, DB_KEYS.SUPPORT_TICKETS],
    [DB_KEYS.PINS, DB_KEYS.PIN_TRANSFERS, DB_KEYS.PIN_PURCHASE_REQUESTS, DB_KEYS.PAYMENTS],
    [DB_KEYS.MATRIX, DB_KEYS.HELP_TRACKERS, DB_KEYS.MATRIX_PENDING_CONTRIBUTIONS, DB_KEYS.GRACE_PERIODS, DB_KEYS.RE_ENTRIES],
    [DB_KEYS.MARKETPLACE_CATEGORIES, DB_KEYS.MARKETPLACE_RETAILERS, DB_KEYS.MARKETPLACE_BANNERS, DB_KEYS.MARKETPLACE_DEALS],
    [DB_KEYS.MARKETPLACE_INVOICES, DB_KEYS.MARKETPLACE_REDEMPTIONS]
  ] as const;
  private static remoteSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private static remoteSyncInFlight = false;
  private static remoteSyncQueued = false;
  private static remoteSyncSuspendDepth = 0;
  private static remoteSyncPending = false;
  private static remoteSyncDirtyKeys = new Set<string>();
  private static remoteSyncApplyingServerState = false;
  private static remoteSyncRetryTimer: ReturnType<typeof setInterval> | null = null;
  private static remoteSyncRetryBound = false;
  private static remoteStateUpdatedAt: string | null = null;
  private static hydratedRemoteKeys = new Set<string>();
  private static readonly REMOTE_SYNC_RETRY_INTERVAL_MS = 45_000;
  private static readonly REMOTE_SYNC_REQUEST_TIMEOUT_MS = 10_000;
  private static readonly SENSITIVE_ACTION_BLOCK_AFTER_PENDING_MS = 2 * 60 * 1000;
  // Large, bursty datasets can exceed browser quota and block the main thread.
  // Keep these keys in-memory and sync to backend in batches.
  private static readonly MEMORY_ONLY_LOCAL_KEYS = new Set<string>([
    DB_KEYS.USERS,
    DB_KEYS.WALLETS,
    DB_KEYS.MATRIX,
    DB_KEYS.TRANSACTIONS,
    DB_KEYS.SAFETY_POOL,
    DB_KEYS.HELP_TRACKERS,
    DB_KEYS.MATRIX_PENDING_CONTRIBUTIONS
  ]);
  private static remoteSyncListeners = new Set<(status: RemoteSyncStatus) => void>();
  private static remoteSyncStatus: RemoteSyncStatus = {
    state: 'pending',
    message: 'Waiting for first server sync',
    dirtyKeys: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    pendingSinceAt: new Date().toISOString()
  };
  private static volatileSyncState = new Map<string, string>();
  private static volatileSyncObjects = new Map<string, unknown>();
  private static volatileSyncSerialized = new Map<string, string>();
  private static memoryOnlyLocalKeysPrepared = false;
  private static localStateTransactionWrites: Map<string, string | null> | null = null;
  private static localStateTransactionDirtyKeys = new Set<string>();
  // When true, createTransaction/addToSafetyPool become no-ops to save memory
  static _bulkRebuildMode = false;
  private static _bulkSafetyPoolTotal = 0;
  private static _autoLockedHelpProcessingUsers = new Set<string>();
  // Cooldown: prevents duplicate system fee processing during sync races
  private static _systemFeeLastProcessed = new Map<string, number>();

  // ===== In-memory parsed-object cache =====
  // Eliminates redundant JSON.parse() on hot-path reads.
  private static _cache = new Map<string, unknown>();

  private static emitRemoteSyncStatus(): void {
    const snapshot: RemoteSyncStatus = {
      ...this.remoteSyncStatus,
      dirtyKeys: this.remoteSyncDirtyKeys.size
    };
    this.remoteSyncStatus = snapshot;
    for (const listener of this.remoteSyncListeners) {
      try {
        listener(snapshot);
      } catch {
        // Listener errors must not break sync flow.
      }
    }
  }

  private static markSyncPending(message: string = 'Changes pending sync'): void {
    const now = new Date().toISOString();
    this.remoteSyncStatus = {
      ...this.remoteSyncStatus,
      state: 'pending',
      message,
      dirtyKeys: this.remoteSyncDirtyKeys.size,
      pendingSinceAt: this.remoteSyncStatus.pendingSinceAt || now
    };
    this.emitRemoteSyncStatus();
  }

  private static markSyncing(message: string = 'Syncing with server'): void {
    this.remoteSyncStatus = {
      ...this.remoteSyncStatus,
      state: 'syncing',
      message,
      lastAttemptAt: new Date().toISOString(),
      dirtyKeys: this.remoteSyncDirtyKeys.size
    };
    this.emitRemoteSyncStatus();
  }

  private static markSynced(message: string = 'Synced'): void {
    const now = new Date().toISOString();
    this.remoteSyncStatus = {
      ...this.remoteSyncStatus,
      state: 'synced',
      message,
      dirtyKeys: this.remoteSyncDirtyKeys.size,
      lastAttemptAt: now,
      lastSuccessAt: now,
      pendingSinceAt: null
    };
    this.emitRemoteSyncStatus();
  }

  private static markOffline(message: string = 'Backend unreachable. Retrying automatically.'): void {
    const now = new Date().toISOString();
    this.remoteSyncStatus = {
      ...this.remoteSyncStatus,
      state: 'offline',
      message,
      dirtyKeys: this.remoteSyncDirtyKeys.size,
      lastAttemptAt: now,
      lastErrorAt: now,
      pendingSinceAt: this.remoteSyncStatus.pendingSinceAt || now
    };
    this.emitRemoteSyncStatus();
  }

  static getRemoteSyncStatus(): RemoteSyncStatus {
    return {
      ...this.remoteSyncStatus,
      dirtyKeys: this.remoteSyncDirtyKeys.size
    };
  }

  static subscribeRemoteSyncStatus(listener: (status: RemoteSyncStatus) => void): () => void {
    this.remoteSyncListeners.add(listener);
    listener(this.getRemoteSyncStatus());
    return () => {
      this.remoteSyncListeners.delete(listener);
    };
  }

  static getSensitiveActionSyncGate(): SensitiveActionSyncGate {
    const status = this.getRemoteSyncStatus();

    if (status.state === 'offline') {
      return {
        allowed: false,
        message: 'Server sync is offline. Please wait until sync status is synced.',
        status
      };
    }

    if (status.state === 'pending') {
      const pendingSince = status.pendingSinceAt ? new Date(status.pendingSinceAt).getTime() : 0;
      if (pendingSince > 0 && Date.now() - pendingSince >= this.SENSITIVE_ACTION_BLOCK_AFTER_PENDING_MS) {
        return {
          allowed: false,
          message: 'Sync has been pending for over 2 minutes. Please wait for sync before transfers or activation.',
          status
        };
      }
    }

    return {
      allowed: true,
      message: '',
      status
    };
  }

  private static async retryBackgroundSyncTick(): Promise<void> {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return;
    if (this.remoteSyncSuspendDepth > 0 || this.remoteSyncInFlight) return;

    const hasDirtyWork = this.remoteSyncDirtyKeys.size > 0 || this.remoteSyncPending || this.remoteSyncQueued;
    if (hasDirtyWork) {
      await this.flushRemoteSync();
      return;
    }

    const status = this.remoteSyncStatus.state;
    if (status !== 'offline' && status !== 'pending') return;

    // Use batched approach instead of downloading everything at once
    try {
      await this.hydrateFromServerBatches(this.getStartupRemoteSyncBatches(), {
        strict: false,
        maxAttempts: 2,
        timeoutMs: 60000,
        retryDelayMs: 2000,
        continueOnError: true,
        requireAnySuccess: true
      });
      // If critical data loaded, load deferred in background too
      void this.hydrateFromServerBatches(this.getStartupDeferredRemoteSyncBatches(), {
        strict: false,
        maxAttempts: 1,
        timeoutMs: 60000,
        retryDelayMs: 1000,
        continueOnError: true,
        requireAnySuccess: false
      }).catch(() => { /* deferred data is non-critical */ });
    } catch {
      this.markOffline('Backend still unavailable. Retrying automatically.');
    }
  }

  static startBackgroundSyncLoop(): void {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return;
    if (!this.remoteSyncRetryBound) {
      window.addEventListener('online', () => {
        void this.retryBackgroundSyncTick();
      });
      window.addEventListener('offline', () => {
        this.markOffline('You are offline. Sync will resume when connection returns.');
      });
      this.remoteSyncRetryBound = true;
    }
    if (this.remoteSyncRetryTimer) return;
    this.remoteSyncRetryTimer = setInterval(() => {
      void this.retryBackgroundSyncTick();
    }, this.REMOTE_SYNC_RETRY_INTERVAL_MS);
    void this.retryBackgroundSyncTick();
  }

  /** Return cached parsed value or parse from storage and cache it. */
  private static getCached<T>(key: string, fallback: T): T {
    if (this._cache.has(key)) return this._cache.get(key) as T;
    if (this.MEMORY_ONLY_LOCAL_KEYS.has(key) && this.volatileSyncObjects.has(key)) {
      const volatileObject = this.volatileSyncObjects.get(key) as T;
      this._cache.set(key, volatileObject);
      return volatileObject;
    }
    const raw = this.getStorageItem(key);
    if (raw === null) return fallback;
    try {
      const parsed = JSON.parse(raw) as T;
      this._cache.set(key, parsed);
      return parsed;
    } catch {
      return fallback;
    }
  }

  /** Write to localStorage + update cache with the already-parsed object. */
  private static setCached<T>(key: string, value: T): void {
    this._cache.set(key, value);
    if (this.MEMORY_ONLY_LOCAL_KEYS.has(key)) {
      this.ensureMemoryOnlyLocalKeyPolicy();
      this.volatileSyncObjects.set(key, value as unknown);
      this.volatileSyncSerialized.delete(key);
      this.volatileSyncState.delete(key);
      if (this.localStateTransactionWrites) {
        this.localStateTransactionDirtyKeys.add(key);
        return;
      }
      this.markKeyDirtyForRemoteSync(key);
      return;
    }
    this.setStorageItem(key, JSON.stringify(value));
  }

  /** Invalidate a single cache key (called on raw writes). */
  private static invalidateCache(key: string): void {
    this._cache.delete(key);
  }

  /** Invalidate all cached keys (e.g. after server hydration). */
  static invalidateAllCaches(): void {
    this._cache.clear();
  }

  private static getSessionStorage(): Storage | null {
    try {
      return sessionStorage;
    } catch {
      return null;
    }
  }

  private static isQuotaExceededError(error: unknown): boolean {
    if (!(error instanceof DOMException)) return false;
    return (
      error.name === 'QuotaExceededError'
      || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || error.code === 22
      || error.code === 1014
    );
  }

  private static shouldSyncKey(key: string): boolean {
    return this.REMOTE_SYNC_KEYS.has(key);
  }

  private static getRemoteSyncEndpoint(keys?: Iterable<string>): string {
    const base = `${this.REMOTE_SYNC_BASE_URL}/api/state`;
    const requestedKeys = Array.from(keys || []).filter((key) => this.REMOTE_SYNC_KEYS.has(key));
    if (requestedKeys.length === 0) {
      return base;
    }
    const params = new URLSearchParams();
    params.set('keys', requestedKeys.join(','));
    return `${base}?${params.toString()}`;
  }

  private static getRemoteSyncWriteEndpoint(options?: { destructive?: boolean; force?: boolean }): string {
    const base = `${this.REMOTE_SYNC_BASE_URL}/api/state`;
    const params = new URLSearchParams();
    if (options?.destructive) params.set('destructive', '1');
    if (options?.force) params.set('force', '1');
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  private static getPersistedSnapshot(keys?: Iterable<string>): Record<string, string> {
    const state: Record<string, string> = {};
    const keysToRead = keys || this.REMOTE_SYNC_KEYS;
    for (const key of keysToRead) {
      const value = this.getStorageItem(key);
      if (typeof value === 'string') {
        state[key] = value;
      }
    }
    return state;
  }

  private static getSyncRequestBody(options?: { keys?: Iterable<string>; full?: boolean }): { state: Record<string, string>; baseUpdatedAt: string | null } {
    const keys = options?.full ? this.REMOTE_SYNC_KEYS : options?.keys;
    return {
      state: this.getPersistedSnapshot(keys),
      baseUpdatedAt: this.remoteStateUpdatedAt
    };
  }

  private static hasLocalPersistedData(): boolean {
    for (const key of this.REMOTE_SYNC_KEYS) {
      if (this.getStorageItem(key) !== null) {
        return true;
      }
    }
    return false;
  }

  static hasLocalUsersData(): boolean {
    try {
      const raw = this.getStorageItem(DB_KEYS.USERS);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  }

  private static getStorageItem(key: string): string | null {
    this.ensureMemoryOnlyLocalKeyPolicy();
    if (this.localStateTransactionWrites?.has(key)) {
      return this.localStateTransactionWrites.get(key) ?? null;
    }
    const volatileValue = this.volatileSyncState.get(key);
    if (typeof volatileValue === 'string') return volatileValue;
    if (this.volatileSyncObjects.has(key)) {
      const cachedSerialized = this.volatileSyncSerialized.get(key);
      if (typeof cachedSerialized === 'string') return cachedSerialized;
      try {
        const serialized = JSON.stringify(this.volatileSyncObjects.get(key));
        this.volatileSyncSerialized.set(key, serialized);
        return serialized;
      } catch {
        return null;
      }
    }
    return localStorage.getItem(key);
  }

  private static markKeyDirtyForRemoteSync(key: string): void {
    if (!this.shouldSyncKey(key) || this.remoteSyncApplyingServerState) return;
    this.remoteSyncDirtyKeys.add(key);
    this.scheduleRemoteSync();
  }

  private static setStorageItem(key: string, value: string): void {
    this.ensureMemoryOnlyLocalKeyPolicy();
    if (this.localStateTransactionWrites) {
      this.localStateTransactionWrites.set(key, value);
      this.localStateTransactionDirtyKeys.add(key);
      if (this.MEMORY_ONLY_LOCAL_KEYS.has(key)) {
        this.volatileSyncObjects.delete(key);
        this.volatileSyncSerialized.delete(key);
        this.volatileSyncState.set(key, value);
      }
      return;
    }
    if (this.MEMORY_ONLY_LOCAL_KEYS.has(key)) {
      // Keep heavy keys out of localStorage to prevent quota exhaustion.
      this.volatileSyncObjects.delete(key);
      this.volatileSyncSerialized.delete(key);
      this.volatileSyncState.set(key, value);
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
      this.markKeyDirtyForRemoteSync(key);
      return;
    }
    const shouldSync = this.shouldSyncKey(key);
    try {
      localStorage.setItem(key, value);
      // If write succeeds, we can clear the volatile entry (if any)
      if (shouldSync) this.volatileSyncState.delete(key);
    } catch (error) {
      if (!this.isQuotaExceededError(error)) throw error;

      // Handle QuotaExceeded by falling back to in-memory storage
      this.volatileSyncState.set(key, value);
      console.warn(`[DB] localStorage quota exceeded while writing ${key}; using in-memory sync state.`);
    }
    if (shouldSync && !this.remoteSyncApplyingServerState) {
      this.remoteSyncDirtyKeys.add(key);
      this.scheduleRemoteSync();
    }
  }

  private static removeStorageItem(key: string): void {
    this.ensureMemoryOnlyLocalKeyPolicy();
    if (this.localStateTransactionWrites) {
      this.localStateTransactionWrites.set(key, null);
      this.localStateTransactionDirtyKeys.add(key);
      this.volatileSyncState.delete(key);
      this.volatileSyncObjects.delete(key);
      this.volatileSyncSerialized.delete(key);
      this.invalidateCache(key);
      return;
    }
    localStorage.removeItem(key);
    this.volatileSyncState.delete(key);
    this.volatileSyncObjects.delete(key);
    this.volatileSyncSerialized.delete(key);
    this.invalidateCache(key);
    if (this.shouldSyncKey(key) && !this.remoteSyncApplyingServerState) {
      this.remoteSyncDirtyKeys.add(key);
      this.scheduleRemoteSync();
    }
  }

  private static scheduleRemoteSync(): void {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      return;
    }
    this.markSyncPending();

    if (this.remoteSyncSuspendDepth > 0) {
      this.remoteSyncPending = true;
      return;
    }

    if (this.remoteSyncTimer) {
      clearTimeout(this.remoteSyncTimer);
    }

    this.remoteSyncTimer = setTimeout(() => {
      this.remoteSyncTimer = null;
      void this.flushRemoteSync();
    }, 1200);
  }

  private static ensureMemoryOnlyLocalKeyPolicy(): void {
    if (this.memoryOnlyLocalKeysPrepared || typeof localStorage === 'undefined') return;
    for (const key of this.MEMORY_ONLY_LOCAL_KEYS) {
      try {
        const existing = localStorage.getItem(key);
        if (typeof existing === 'string' && !this.volatileSyncState.has(key) && !this.volatileSyncObjects.has(key)) {
          try {
            const parsed = JSON.parse(existing);
            this.volatileSyncObjects.set(key, parsed);
            this.volatileSyncSerialized.set(key, existing);
          } catch {
            this.volatileSyncState.set(key, existing);
          }
        }
        localStorage.removeItem(key);
      } catch {
        // ignore best-effort migration/cleanup
      }
    }
    this.memoryOnlyLocalKeysPrepared = true;
  }


  /** Immediate, awaitable remote sync. Returns when sync is complete. */
  static async syncNow(): Promise<void> {
    if (this.remoteSyncTimer) {
      clearTimeout(this.remoteSyncTimer);
      this.remoteSyncTimer = null;
    }
    return this.flushRemoteSync();
  }

  private static async flushRemoteSync(options?: { full?: boolean }): Promise<void> {
    if (this.remoteSyncSuspendDepth > 0) {
      this.remoteSyncPending = true;
      this.markSyncPending();
      return;
    }

    if (this.remoteSyncInFlight) {
      this.remoteSyncQueued = true;
      return;
    }

    const keysToSync = options?.full
      ? new Set<string>(this.REMOTE_SYNC_KEYS)
      : new Set<string>(this.remoteSyncDirtyKeys);

    if (keysToSync.size === 0) {
      if (this.remoteSyncStatus.state !== 'synced') {
        this.markSynced();
      }
      return;
    }

    this.remoteSyncInFlight = true;
    this.markSyncing(`Syncing ${keysToSync.size} update(s)`);
    let staleConflict = false;
    try {
      const requestBody = this.getSyncRequestBody({
        keys: keysToSync,
        full: !!options?.full
      });
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeout = setTimeout(() => controller?.abort(), this.REMOTE_SYNC_REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(this.getRemoteSyncWriteEndpoint(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller?.signal
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        if (response.status === 409) {
          staleConflict = true;
          this.remoteSyncPending = false;
          this.remoteSyncQueued = false;
          this.remoteSyncDirtyKeys.clear();
          this.markSyncing('Refreshing from server');
          void this.hydrateFromServer({ strict: true, maxAttempts: 2, timeoutMs: 15000, retryDelayMs: 500 });
        }
        throw new Error(`Remote sync failed with HTTP ${response.status}`);
      }
      const payload = await response.json() as { updatedAt?: unknown };
      this.remoteStateUpdatedAt = typeof payload?.updatedAt === 'string' ? payload.updatedAt : null;
      if (options?.full) {
        this.remoteSyncDirtyKeys.clear();
      } else {
        for (const key of keysToSync) {
          this.remoteSyncDirtyKeys.delete(key);
        }
      }
      if (this.remoteSyncDirtyKeys.size > 0) {
        this.markSyncPending();
      } else {
        this.markSynced();
      }
    } catch {
      if (!staleConflict) {
        console.warn('[DB Sync] Failed to push local state to backend. App will continue locally.');
        this.markOffline();
      }
    } finally {
      this.remoteSyncInFlight = false;
      if (this.remoteSyncSuspendDepth > 0) {
        this.remoteSyncPending = this.remoteSyncPending || this.remoteSyncQueued;
        this.remoteSyncQueued = false;
      } else if (this.remoteSyncQueued) {
        this.remoteSyncQueued = false;
        void this.flushRemoteSync();
      }
    }
    if (this.remoteSyncSuspendDepth > 0) {
      return;
    }
  }

  static pauseRemoteSync(): void {
    this.remoteSyncSuspendDepth += 1;
    if (this.remoteSyncTimer) {
      clearTimeout(this.remoteSyncTimer);
      this.remoteSyncTimer = null;
      this.remoteSyncPending = true;
      this.markSyncPending();
    }
  }

  static resumeRemoteSync(flushPending: boolean = true): void {
    if (this.remoteSyncSuspendDepth <= 0) {
      this.remoteSyncSuspendDepth = 0;
      return;
    }
    this.remoteSyncSuspendDepth -= 1;
    if (this.remoteSyncSuspendDepth === 0 && flushPending && this.remoteSyncPending) {
      this.remoteSyncPending = false;
      this.scheduleRemoteSync();
    }
  }

  static async runWithRemoteSyncPaused<T>(work: () => Promise<T> | T): Promise<T> {
    this.pauseRemoteSync();
    try {
      return await work();
    } finally {
      this.resumeRemoteSync(true);
    }
  }

  private static applyRawStateValue(key: string, value: string | null): void {
    this.invalidateCache(key);
    if (value === null) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
      this.volatileSyncState.delete(key);
      this.volatileSyncObjects.delete(key);
      this.volatileSyncSerialized.delete(key);
      return;
    }

    if (this.MEMORY_ONLY_LOCAL_KEYS.has(key)) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
      try {
        const parsed = JSON.parse(value);
        this.volatileSyncObjects.set(key, parsed);
        this.volatileSyncSerialized.set(key, value);
        this.volatileSyncState.delete(key);
      } catch {
        this.volatileSyncObjects.delete(key);
        this.volatileSyncSerialized.delete(key);
        this.volatileSyncState.set(key, value);
      }
      return;
    }

    try {
      localStorage.setItem(key, value);
      this.volatileSyncState.delete(key);
    } catch (error) {
      if (!this.isQuotaExceededError(error)) throw error;
      this.volatileSyncState.set(key, value);
    }
  }

  private static restoreRawStateSnapshot(snapshot: Record<string, string | null>): void {
    this.invalidateAllCaches();
    for (const key of this.REMOTE_SYNC_KEYS) {
      this.applyRawStateValue(key, Object.prototype.hasOwnProperty.call(snapshot, key) ? snapshot[key] : null);
    }
  }

  static async runWithLocalStateTransaction<T>(
    work: () => Promise<T> | T,
    options?: {
      syncOnCommit?: boolean;
      syncOptions?: {
        destructive?: boolean;
        full?: boolean;
        force?: boolean;
        timeoutMs?: number;
        maxAttempts?: number;
        retryDelayMs?: number;
      };
    }
  ): Promise<T> {
    if (this.localStateTransactionWrites) {
      return await work();
    }

    const baseSnapshot: Record<string, string | null> = {};
    for (const key of this.REMOTE_SYNC_KEYS) {
      baseSnapshot[key] = this.getStorageItem(key);
    }
    const remoteSyncDirtySnapshot = new Set(this.remoteSyncDirtyKeys);
    const remoteSyncStatusSnapshot: RemoteSyncStatus = { ...this.remoteSyncStatus };
    const remoteStateUpdatedAtSnapshot = this.remoteStateUpdatedAt;
    const remoteSyncPendingSnapshot = this.remoteSyncPending;
    const remoteSyncQueuedSnapshot = this.remoteSyncQueued;

    this.localStateTransactionWrites = new Map();
    this.localStateTransactionDirtyKeys = new Set();

    try {
      const result = await work();
      const pendingWrites = new Map(this.localStateTransactionWrites);
      const pendingDirtyKeys = new Set(this.localStateTransactionDirtyKeys);

      this.localStateTransactionWrites = null;
      this.localStateTransactionDirtyKeys = new Set();

      this.invalidateAllCaches();
      for (const [key, value] of pendingWrites) {
        this.applyRawStateValue(key, value);
      }

      for (const key of pendingDirtyKeys) {
        this.remoteSyncDirtyKeys.add(key);
      }

      if (options?.syncOnCommit && pendingDirtyKeys.size > 0) {
        const synced = await this.forceRemoteSyncNowWithOptions(options.syncOptions);
        if (!synced) {
          throw new Error('Failed to persist rebuilt state to backend');
        }
      } else if (pendingDirtyKeys.size > 0) {
        this.markSyncPending();
      }

      return result;
    } catch (error) {
      this.localStateTransactionWrites = null;
      this.localStateTransactionDirtyKeys = new Set();
      this.restoreRawStateSnapshot(baseSnapshot);
      this.remoteSyncDirtyKeys = new Set(remoteSyncDirtySnapshot);
      this.remoteSyncStatus = { ...remoteSyncStatusSnapshot };
      this.remoteStateUpdatedAt = remoteStateUpdatedAtSnapshot;
      this.remoteSyncPending = remoteSyncPendingSnapshot;
      this.remoteSyncQueued = remoteSyncQueuedSnapshot;
      this.emitRemoteSyncStatus();
      throw error;
    }
  }

  static async commitCriticalAction<T>(
    work: () => Promise<T> | T,
    syncOptions?: {
      destructive?: boolean;
      full?: boolean;
      force?: boolean;
      timeoutMs?: number;
      maxAttempts?: number;
      retryDelayMs?: number;
    }
  ): Promise<T> {
    return this.runWithLocalStateTransaction(work, {
      syncOnCommit: true,
      syncOptions: {
        full: false,
        force: true,
        timeoutMs: 60000,
        maxAttempts: 3,
        retryDelayMs: 1500,
        ...syncOptions
      }
    });
  }

  static async hydrateFromServer(options?: {
    strict?: boolean;
    maxAttempts?: number;
    timeoutMs?: number;
    retryDelayMs?: number;
    keys?: Iterable<string>;
  }): Promise<void> {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      return;
    }

    const strict = !!options?.strict;
    this.markSyncing('Syncing latest server data');
    const maxAttempts = Math.max(1, Number(options?.maxAttempts ?? (strict ? 2 : 1)));
    const timeoutMs = Math.max(1000, Number(options?.timeoutMs ?? (strict ? 15000 : 5000)));
    const retryDelayMs = Math.max(100, Number(options?.retryDelayMs ?? (strict ? 1500 : 300)));
    const requestedKeys = Array.from(options?.keys || []);
    const syncKeys = requestedKeys.length > 0
      ? requestedKeys.filter((key) => this.REMOTE_SYNC_KEYS.has(key))
      : Array.from(this.REMOTE_SYNC_KEYS);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeout = setTimeout(() => controller?.abort(), timeoutMs);
        let response: Response;
        try {
          const endpoint = this.getRemoteSyncEndpoint(syncKeys);
          const separator = endpoint.includes('?') ? '&' : '?';
          response = await fetch(`${endpoint}${separator}t=${Date.now()}`, {
            method: 'GET',
            signal: controller?.signal
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          throw new Error(`Failed to load state from backend (HTTP ${response.status})`);
        }

        const payload = await response.json() as { state?: Record<string, unknown>; updatedAt?: unknown };
        const serverState = payload?.state && typeof payload.state === 'object' ? payload.state : {};
        const hasServerState = Object.keys(serverState).length > 0;

        if (hasServerState) {
          // Clear caches before batch update
          this.invalidateAllCaches();
          this.pauseRemoteSync();
          this.remoteSyncApplyingServerState = true;
          this.remoteSyncPending = false;
          this.remoteSyncQueued = false;
          this.remoteSyncDirtyKeys.clear();
          try {
            for (const key of syncKeys) {
              const value = serverState[key];
              if (typeof value === 'string') {
                this.setStorageItem(key, value);
                this.hydratedRemoteKeys.add(key);
              } else if (key in serverState) {
                // Server explicitly has this key but value is null/empty — clear local
                this.removeStorageItem(key);
                this.hydratedRemoteKeys.add(key);
              }
              // If the key is not in serverState at all, keep local data intact
            }
          } finally {
            this.remoteSyncPending = false;
            this.remoteSyncQueued = false;
            this.remoteSyncDirtyKeys.clear();
            this.remoteSyncApplyingServerState = false;

            // Re-mark local-only keys as dirty: if a sync key has local data but
            // was NOT present on the server, it still needs to be pushed upstream.
            for (const key of syncKeys) {
              if (!(key in serverState)) {
                const localValue = this.getStorageItem(key);
                if (typeof localValue === 'string') {
                  this.remoteSyncDirtyKeys.add(key);
                }
              }
            }

            this.resumeRemoteSync(this.remoteSyncDirtyKeys.size > 0);
          }
          this.remoteStateUpdatedAt = typeof payload?.updatedAt === 'string' ? payload.updatedAt : null;
          if (this.remoteSyncDirtyKeys.size > 0) {
            this.markSyncPending();
          } else {
            this.markSynced('Synced with server');
          }
          return;
        }

        // In strict mode, never auto-seed backend from browser-local state.
        if (strict) {
          throw new Error('Backend returned empty state in strict mode.');
        }

        // Server has no state yet. Seed it from local browser state if available.
        if (this.hasLocalPersistedData()) {
          const pushController = typeof AbortController !== 'undefined' ? new AbortController() : null;
          const pushTimeout = setTimeout(() => pushController?.abort(), 5000);
          let pushResponse: Response;
          try {
            pushResponse = await fetch(this.getRemoteSyncEndpoint(), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(this.getSyncRequestBody({ full: true })),
              signal: pushController?.signal
            });
          } finally {
            clearTimeout(pushTimeout);
          }
          if (!pushResponse.ok) {
            throw new Error(`Failed to seed backend from local state (HTTP ${pushResponse.status})`);
          }
          const pushPayload = await pushResponse.json() as { updatedAt?: unknown };
          this.remoteStateUpdatedAt = typeof pushPayload?.updatedAt === 'string' ? pushPayload.updatedAt : null;
        } else {
          this.remoteStateUpdatedAt = typeof payload?.updatedAt === 'string' ? payload.updatedAt : null;
        }
        this.markSynced('Synced with server');
        return;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    if (strict) {
      this.markOffline('Could not load server data. Retrying automatically.');
      throw lastError instanceof Error ? lastError : new Error('Backend hydration failed');
    }

    console.warn('[DB Sync] Backend unavailable during startup. Using local browser state.');
    this.markOffline('Using local data. Retrying server sync in background.');
  }

  // ==================== USERS ====================
  static getUsers(): User[] {
    const CACHE_KEY_USERS_NORMALIZED = '__users_normalized';
    if (this._cache.has(CACHE_KEY_USERS_NORMALIZED)) {
      return this._cache.get(CACHE_KEY_USERS_NORMALIZED) as User[];
    }
    const users: User[] = this.getCached<User[]>(DB_KEYS.USERS, []);
    const normalized = users.map((u) => ({
      ...u,
      accountStatus: u.accountStatus || 'active',
      blockedAt: u.blockedAt ?? null,
      blockedUntil: u.blockedUntil ?? null,
      blockedReason: u.blockedReason ?? null
    }));

    // Deduplicate by userId – keep the record with the best resolution score
    const seenUserIds = new Map<string, number>();
    const duplicateIndices = new Set<number>();
    for (let i = 0; i < normalized.length; i++) {
      const uid = (normalized[i].userId || '').trim();
      if (!uid) continue;
      if (seenUserIds.has(uid)) {
        const prevIdx = seenUserIds.get(uid)!;
        const prevScore = this.getDuplicateResolutionScore(normalized[prevIdx]);
        const currScore = this.getDuplicateResolutionScore(normalized[i]);
        if (currScore > prevScore) {
          duplicateIndices.add(prevIdx);
          seenUserIds.set(uid, i);
        } else {
          duplicateIndices.add(i);
        }
      } else {
        seenUserIds.set(uid, i);
      }
    }

    const deduplicated = duplicateIndices.size > 0
      ? normalized.filter((_, i) => !duplicateIndices.has(i))
      : normalized;

    this._cache.set(CACHE_KEY_USERS_NORMALIZED, deduplicated);
    return deduplicated;
  }

  static saveUsers(users: User[]): void {
    this._cache.delete('__users_normalized');
    this.setCached(DB_KEYS.USERS, users);
  }

  static getUserById(id: string): User | undefined {
    return this.getUsers().find(u => u.id === id);
  }

  private static getDuplicateResolutionScore(
    user: User,
    txCountByUserId?: Map<string, number>,
    walletByUserId?: Map<string, Wallet>,
    matrixUserIds?: Set<string>
  ): number {
    const txCount = txCountByUserId?.get(user.id) || 0;
    const wallet = walletByUserId?.get(user.id);
    const walletMagnitude = wallet
      ? (
        Math.abs(wallet.depositWallet || 0)
        + Math.abs(wallet.incomeWallet || 0)
        + Math.abs(wallet.matrixWallet || 0)
        + Math.abs(wallet.lockedIncomeWallet || 0)
        + Math.abs(wallet.totalReceived || 0)
      )
      : 0;

    let score = 0;
    if ((user.userId || '').trim() === '1000001') score += 1_000_000_000;
    if (user.isAdmin) score += 100_000_000;
    if (this.isNetworkActiveUser(user)) score += 10_000_000;
    score += Math.max(0, user.directCount || 0) * 10_000;
    score += txCount * 100;
    score += Math.floor(walletMagnitude);
    if (matrixUserIds?.has(user.userId)) score += 50_000;
    return score;
  }

  static getUserByUserId(userId: string): User | undefined {
    const cleanUserId = String(userId || '').trim();
    if (!cleanUserId) return undefined;

    const matches = this.getUsers().filter((u) => String(u.userId || '').trim() === cleanUserId);
    if (matches.length <= 1) return matches[0];

    const txCountByUserId = new Map<string, number>();
    for (const tx of this.getTransactions()) {
      txCountByUserId.set(tx.userId, (txCountByUserId.get(tx.userId) || 0) + 1);
    }
    const walletByUserId = new Map(this.getWallets().map((w) => [w.userId, w]));
    const matrixUserIds = new Set(this.getMatrix().map((node) => node.userId));

    return [...matches].sort((a, b) => {
      const scoreDiff = this.getDuplicateResolutionScore(b, txCountByUserId, walletByUserId, matrixUserIds)
        - this.getDuplicateResolutionScore(a, txCountByUserId, walletByUserId, matrixUserIds);
      if (scoreDiff !== 0) return scoreDiff;
      const aCreated = new Date(a.createdAt || 0).getTime();
      const bCreated = new Date(b.createdAt || 0).getTime();
      return aCreated - bCreated;
    })[0];
  }

  private static transactionRefMatchesUser(ref: string | undefined, target: User | undefined): boolean {
    if (!ref || !target) return false;
    if (ref === target.id || ref === target.userId) return true;
    const resolved = this.getUserById(ref) || this.getUserByUserId(ref);
    return !!resolved && resolved.userId === target.userId;
  }

  private static normalizeIdentityText(value?: string | null): string {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private static normalizeIdentityPhone(value?: string | null): string {
    return String(value || '')
      .replace(/[^\d+]/g, '')
      .replace(/^00/, '+')
      .trim();
  }

  private static parseReferralIncomeDescription(description?: string | null): { fullName: string; userId: string } | null {
    const match = String(description || '').match(/Referral income from\s+(.+?)\s+\((\d{7})\)/i);
    if (!match) return null;
    return {
      fullName: match[1].trim(),
      userId: match[2]
    };
  }

  private static resolveLikelyReferralSourceForDirectIncome(tx: Transaction, sponsor?: User): User | undefined {
    const fromResolved = tx.fromUserId ? this.resolveUserByRef(tx.fromUserId) : undefined;
    if (fromResolved) {
      return this.getUserByUserId(fromResolved.userId) || fromResolved;
    }

    const parsed = this.parseReferralIncomeDescription(tx.description);
    if (!parsed) return undefined;

    const byDescriptionId = this.getUserByUserId(parsed.userId);
    if (byDescriptionId) {
      return byDescriptionId;
    }

    if (!sponsor) return undefined;

    const normalizedName = this.normalizeIdentityText(parsed.fullName);
    const candidates = this.getUsers().filter((user) =>
      user.sponsorId === sponsor.userId
      && this.normalizeIdentityText(user.fullName) === normalizedName
    );

    if (candidates.length !== 1) return undefined;
    return this.getUserByUserId(candidates[0].userId) || candidates[0];
  }

  private static hasActivationEvidenceForUser(user: User | undefined, transactions?: Transaction[]): boolean {
    if (!user) return false;
    if (this.getMatrixNode(user.userId)) return true;

    const txs = transactions || this.getTransactions();
    return txs.some((tx) =>
      this.transactionRefMatchesUser(tx.userId, user)
      && tx.status === 'completed'
      && (tx.type === 'pin_used' || tx.type === 'activation')
    );
  }

  private static findExistingReferralIncomeCreditTx(
    sponsor: User | undefined,
    referral: User | undefined,
    transactions?: Transaction[]
  ): Transaction | undefined {
    if (!sponsor || !referral) return undefined;
    const txs = transactions || this.getTransactions();

    return txs.find((tx) => {
      if (tx.type !== 'direct_income' || tx.status !== 'completed') return false;
      const likelySource = this.resolveLikelyReferralSourceForDirectIncome(tx, sponsor);
      if (!this.directIncomeTxBelongsToSponsor(tx, sponsor, likelySource)) return false;

      if (tx.fromUserId && this.transactionRefMatchesUser(tx.fromUserId, referral)) {
        return true;
      }

      return !!likelySource && likelySource.userId === referral.userId;
    });
  }

  private static resolveLikelySponsorForDirectIncome(tx: Transaction): User | undefined {
    if (tx.type !== 'direct_income') return undefined;

    const sponsorFromTxUser = this.resolveUserByRef(tx.userId);
    if (sponsorFromTxUser) {
      return this.getUserByUserId(sponsorFromTxUser.userId) || sponsorFromTxUser;
    }

    const likelySource = this.resolveLikelyReferralSourceForDirectIncome(tx);
    if (!likelySource?.sponsorId) return undefined;

    return this.getUserByUserId(likelySource.sponsorId);
  }

  private static directIncomeTxBelongsToSponsor(
    tx: Transaction,
    sponsor: User | undefined,
    likelySource?: User
  ): boolean {
    if (!sponsor) return false;
    if (tx.type !== 'direct_income' || tx.status !== 'completed') return false;

    if (this.transactionRefMatchesUser(tx.userId, sponsor)) {
      return true;
    }

    const resolvedSource = likelySource || this.resolveLikelyReferralSourceForDirectIncome(tx, sponsor);
    return !!resolvedSource && String(resolvedSource.sponsorId || '').trim() === sponsor.userId;
  }

  private static hasLogicalReceiveHelpCredit(params: {
    recipient: User | undefined;
    sender: User | undefined;
    level: number;
    amount: number;
    transactions?: Transaction[];
    includeHistoryOnly?: boolean;
  }): boolean {
    const recipient = params.recipient;
    const sender = params.sender;
    if (!recipient || !sender) return false;

    const targetLevel = Number(params.level);
    const targetAmount = Math.abs(Number(params.amount || 0));
    if (!Number.isFinite(targetLevel) || targetLevel < 1) return false;
    if (!(targetAmount > 0)) return false;

    const txs = params.transactions || this.getTransactions();
    return txs.some((tx) => {
      if (tx.type !== 'receive_help' || tx.status !== 'completed') return false;
      if (!this.transactionRefMatchesUser(tx.userId, recipient)) return false;
      if (Number(tx.level) !== targetLevel) return false;

      const effectiveAmount = Math.abs(Number((params.includeHistoryOnly ? (tx.displayAmount ?? tx.amount) : tx.amount) || 0));
      if (Math.abs(effectiveAmount - targetAmount) > 0.009) return false;
      if (!params.includeHistoryOnly && !(Number(tx.amount || 0) > 0)) return false;

      if (tx.fromUserId && this.transactionRefMatchesUser(tx.fromUserId, sender)) {
        return true;
      }

      return String(tx.description || '').includes(`(${sender.userId})`);
    });
  }

  private static isValidMatrixSenderForRecipientLevel(
    recipient: User | undefined,
    sender: User | undefined,
    level: number
  ): boolean {
    if (!recipient || !sender) return false;
    const expectedLevel = this.getMatrixDepthBetween(recipient.userId, sender.userId);
    return expectedLevel === level;
  }

  static hasCompletedReferralIncomeForIdentity(params: {
    sponsorInternalId: string;
    referredInternalId?: string;
    referredUserId?: string;
    fullName?: string;
    email?: string;
    phone?: string;
    referenceTime?: string;
    matchWindowMs?: number;
  }): boolean {
    const normalizedUserId = String(params.referredUserId || '').trim();
    const normalizedName = this.normalizeIdentityText(params.fullName);
    const normalizedEmail = String(params.email || '').trim().toLowerCase();
    const normalizedPhone = this.normalizeIdentityPhone(params.phone);
    const sponsorUser = this.resolveUserByRef(params.sponsorInternalId);
    const referenceTime = new Date(params.referenceTime || '').getTime();
    const windowMs = Math.max(60_000, Number(params.matchWindowMs || 10 * 60 * 1000));
    const hasStrongIdentityParams = !!(
      params.referredInternalId
      || normalizedUserId
      || normalizedEmail
      || normalizedPhone
    );

    return this.getTransactions().some((tx) => {
      if (tx.type !== 'direct_income' || tx.status !== 'completed') {
        return false;
      }

      const resolvedSource = tx.fromUserId ? this.resolveUserByRef(tx.fromUserId) : undefined;
      const likelySource = this.resolveLikelyReferralSourceForDirectIncome(tx, sponsorUser);
      const sourceForIdentity = resolvedSource || likelySource;

      if (sponsorUser) {
        if (!this.directIncomeTxBelongsToSponsor(tx, sponsorUser, sourceForIdentity)) return false;
      } else if (tx.userId !== params.sponsorInternalId) {
        return false;
      }
      const parsed = this.parseReferralIncomeDescription(tx.description);

      if (params.referredInternalId && tx.fromUserId === params.referredInternalId) {
        return true;
      }
      if (normalizedUserId) {
        if (resolvedSource?.userId === normalizedUserId) return true;
        if (parsed?.userId === normalizedUserId) return true;
      }
      if (normalizedEmail && sourceForIdentity && String(sourceForIdentity.email || '').trim().toLowerCase() === normalizedEmail) {
        return true;
      }
      if (normalizedPhone && sourceForIdentity && this.normalizeIdentityPhone(sourceForIdentity.phone) === normalizedPhone) {
        return true;
      }

      const createdAt = new Date(tx.completedAt || tx.createdAt || '').getTime();
      const withinWindow = Number.isFinite(referenceTime) && Number.isFinite(createdAt)
        ? Math.abs(createdAt - referenceTime) <= windowMs
        : true;

      if (normalizedName && withinWindow && !hasStrongIdentityParams) {
        if (sourceForIdentity && this.normalizeIdentityText(sourceForIdentity.fullName) === normalizedName) return true;
        if (parsed && this.normalizeIdentityText(parsed.fullName) === normalizedName) return true;
      }

      return false;
    });
  }

  static getCanonicalDirectIncomeDescription(tx: Transaction): string {
    const fallback = String(tx.description || '')
      .replace(/\s*\[Redemption:[^\]]+\]\s*/g, ' ')
      .replace(/Direct sponsor income/gi, 'Referral income')
      .replace(/No sponsor - direct income/gi, 'No sponsor - referral income')
      .trim();

    if (tx.type !== 'direct_income') return fallback;

    const sponsor = this.resolveUserByRef(tx.userId);
    const source = this.resolveLikelyReferralSourceForDirectIncome(tx, sponsor);
    if (!source) return fallback;
    return `Referral income from ${source.fullName} (${source.userId})`;
  }

  private static getRelatedInternalUserIdsForUserRef(userRef: string): Set<string> {
    const ids = new Set<string>();
    const resolvedUser = this.getUserById(userRef) || this.getUserByUserId(userRef);

    if (!resolvedUser) {
      if (userRef) ids.add(userRef);
      return ids;
    }

    ids.add(resolvedUser.id);
    ids.add(resolvedUser.userId);

    for (const user of this.getUsers()) {
      if (user.userId === resolvedUser.userId) {
        ids.add(user.id);
      }
    }

    const canonical = this.getUserByUserId(resolvedUser.userId);
    if (canonical) {
      ids.add(canonical.id);
      ids.add(canonical.userId);
    }

    return ids;
  }

  private static giveHelpTargetsUser(tx: Transaction, target: User | undefined): boolean {
    if (!target) return false;
    return this.transactionRefMatchesUser(tx.toUserId, target)
      || (tx.description || '').includes(`(${target.userId})`);
  }

  private static getTransactionTime(tx: Transaction): number {
    const raw = tx.completedAt || tx.createdAt || '';
    const value = new Date(raw).getTime();
    return Number.isFinite(value) ? value : 0;
  }

  private static isLockedFirstTwoReceiveDescription(description: string | undefined, level?: number): boolean {
    const desc = String(description || '').toLowerCase();
    const prefix = typeof level === 'number'
      ? `locked first-two help at level ${level}`
      : 'locked first-two help at level';
    return desc.includes(prefix);
  }

  private static isLockedQualifiedReceiveDescription(description: string | undefined, level?: number): boolean {
    const desc = String(description || '').toLowerCase();
    const prefix = typeof level === 'number'
      ? `locked receive help at level ${level}`
      : 'locked receive help at level';
    return desc.includes(prefix);
  }

  private static isReleasedLockedReceiveDescription(description: string | undefined, level?: number): boolean {
    const desc = String(description || '').toLowerCase();
    const prefix = typeof level === 'number'
      ? `released locked receive help at level ${level}`
      : 'released locked receive help at level';
    return desc.includes(prefix);
  }

  private static getUnsettledLockedReceiveEffectiveAmount(
    tx: Transaction,
    allTransactions?: Transaction[]
  ): number {
    if (tx.type !== 'receive_help' || tx.status !== 'completed') return 0;
    if (
      !this.isLockedFirstTwoReceiveDescription(tx.description)
      && !this.isLockedQualifiedReceiveDescription(tx.description)
    ) {
      return 0;
    }

    const directAmount = Number(tx.amount || 0);
    if (directAmount > 0) {
      return Math.abs(directAmount);
    }

    const displayAmount = Number(tx.displayAmount || 0);
    if (!(displayAmount > 0)) return 0;

    const level = this.resolveTransactionLevel(tx);
    if (!level) return 0;

    const txs = allTransactions || this.getTransactions();
    const txTime = this.getTransactionTime(tx);
    const settledByGiveHelp = txs.some((candidate) =>
      candidate.userId === tx.userId
      && candidate.type === 'give_help'
      && candidate.status === 'completed'
      && (candidate.amount || 0) < 0
      && String(candidate.description || '').toLowerCase().includes('from locked income')
      && this.resolveTransactionLevel(candidate) === Math.min(helpDistributionTable.length, level + 1)
      && Math.abs(this.getTransactionTime(candidate) - txTime) <= 10 * 60 * 1000
    );

    return settledByGiveHelp ? 0 : Math.abs(displayAmount);
  }

  private static isReceiveHelpSettlementForGiveTx(
    receiveTx: Transaction,
    giveTx: Transaction,
    recipient: User | undefined,
    sender: User | undefined,
    opts?: { allowHistoryOnly?: boolean }
  ): boolean {
    if (!recipient || !sender) return false;
    if (receiveTx.type !== 'receive_help' || receiveTx.status !== 'completed') return false;
    if (!this.transactionRefMatchesUser(receiveTx.userId, recipient)) return false;

    const allowHistoryOnly = !!opts?.allowHistoryOnly;
    const effectiveAmount = allowHistoryOnly
      ? Math.abs((receiveTx.displayAmount ?? receiveTx.amount) || 0)
      : Math.abs(receiveTx.amount || 0);
    if (!(effectiveAmount > 0)) return false;

    if (receiveTx.sourceGiveHelpTxId === giveTx.id) return true;

    const giveLevel = this.resolveTransactionLevel(giveTx);
    const receiveLevel = this.resolveTransactionLevel(receiveTx);
    const giveAmount = Math.abs(giveTx.amount || 0);
    if (
      !this.transactionRefMatchesUser(receiveTx.fromUserId, sender)
      || giveLevel !== receiveLevel
      || effectiveAmount !== giveAmount
    ) {
      return false;
    }

    const MATCH_WINDOW_MS = 10 * 60 * 1000;
    return Math.abs(this.getTransactionTime(receiveTx) - this.getTransactionTime(giveTx)) <= MATCH_WINDOW_MS;
  }

  private static resolveUserByRef(userRef: string): User | undefined {
    return this.getUserById(userRef) || this.getUserByUserId(userRef);
  }

  static getUserByEmail(email: string): User | undefined {
    return this.getUsers().find(u => u.email.toLowerCase() === email.toLowerCase());
  }

  static generateUniqueUserId(): string {
    let userId = generateSevenDigitId();
    while (this.getUserByUserId(userId)) {
      userId = generateSevenDigitId();
    }
    return userId;
  }

  static createUser(user: User): User {
    const users = this.getUsers();
    const existingById = users.find((u) => u.id === user.id);
    if (existingById) return existingById;

    const existingByUserId = users.find((u) => u.userId === user.userId);
    if (existingByUserId) {
      if (!this.getWallet(existingByUserId.id)) {
        this.createWallet(existingByUserId.id);
      }
      return existingByUserId;
    }

    users.push(user);
    this.saveUsers(users);

    // Create wallet for user with $0
    this.createWallet(user.id);

    return user;
  }

  static updateUser(id: string, updates: Partial<User>): User | null {
    const users = this.getUsers();
    const index = users.findIndex(u => u.id === id);
    if (index === -1) return null;

    const existingUser = users[index];
    const changedKeys = Object.keys(updates).filter((key) => !Object.is((existingUser as any)[key], (updates as any)[key]));
    if (changedKeys.length === 0) {
      return existingUser;
    }

    const prevActive = existingUser.isActive;
    users[index] = { ...existingUser, ...updates };
    this.saveUsers(users);

    // Sync MatrixNode.isActive when user active status changes
    if ('isActive' in updates && updates.isActive !== prevActive) {
      const matrix = this.getMatrix();
      const mIdx = matrix.findIndex(m => m.userId === users[index].userId);
      if (mIdx !== -1 && matrix[mIdx].isActive !== updates.isActive) {
        matrix[mIdx] = { ...matrix[mIdx], isActive: !!updates.isActive };
        this.saveMatrix(matrix);
      }
    }

    return users[index];
  }

  static blockUser(userId: string, type: 'temporary' | 'permanent', hours: number = 24, reason: string = 'Blocked by admin'): User | null {
    const updates: Partial<User> = {
      accountStatus: type === 'temporary' ? 'temp_blocked' : 'permanent_blocked',
      blockedAt: new Date().toISOString(),
      blockedReason: reason,
      blockedUntil: type === 'temporary' ? new Date(Date.now() + (hours * 60 * 60 * 1000)).toISOString() : null,
      isActive: false
    };
    return this.updateUser(userId, updates);
  }

  static unblockUser(userId: string): User | null {
    return this.updateUser(userId, {
      accountStatus: 'active',
      blockedAt: null,
      blockedUntil: null,
      blockedReason: null,
      isActive: true
    });
  }

  static reactivateUser(userId: string): User | null {
    return this.updateUser(userId, {
      isActive: true,
      deactivationReason: null,
      reactivatedAt: new Date().toISOString(),
    });
  }

  // Check if user is in upline/downline chain
  static isInSameChain(fromUserId: string, toUserId: string): boolean {
    const fromUser = this.getUserById(fromUserId);
    const toUser = this.getUserById(toUserId);

    if (!fromUser || !toUser) return false;
    if (fromUser.id === toUser.id) return false;

    const isAncestor = (ancestor: User, descendant: User): boolean => {
      let currentId = descendant.sponsorId;
      while (currentId) {
        const current = this.getUserByUserId(currentId);
        if (!current) break;
        if (current.id === ancestor.id) return true;
        currentId = current.sponsorId;
      }
      return false;
    };

    // Downline relation
    if (isAncestor(fromUser, toUser)) return true;

    // Upline relation
    if (isAncestor(toUser, fromUser)) return true;

    // Fallback matrix relation check
    let currentId = toUser.sponsorId;
    while (currentId) {
      const current = this.getUserByUserId(currentId);
      if (!current) break;
      if (current.id === fromUserId) return true;
      currentId = current.sponsorId;
    }

    const downline = this.getUserDownline(fromUser.userId);
    if (downline.some(node => node.userId === toUser.userId)) return true;

    return false;
  }

  // ==================== WALLETS ====================
  private static normalizeMarketplaceRewardPointBalances(wallets: Wallet[]): Wallet[] {
    if (wallets.length === 0) return wallets;

    const users = this.getUsers();
    const publicUserIdByWalletId = new Map<string, string>();
    for (const user of users) {
      publicUserIdByWalletId.set(user.id, user.userId);
    }

    const invoices = this.getCached<MarketplaceInvoice[]>(DB_KEYS.MARKETPLACE_INVOICES, []);
    const redemptions = this.getCached<RewardRedemption[]>(DB_KEYS.MARKETPLACE_REDEMPTIONS, []);
    const earnedByUserId = new Map<string, number>();
    const reservedByUserId = new Map<string, number>();
    const redeemedByUserId = new Map<string, number>();

    for (const invoice of invoices) {
      if (invoice.status !== 'approved') continue;
      const currentEarned = earnedByUserId.get(invoice.userId) || 0;
      earnedByUserId.set(invoice.userId, currentEarned + Number(invoice.rewardPoints || 0));
    }

    for (const redemption of redemptions) {
      const rp = Number(redemption.rewardPoints || 0);
      if (redemption.status === 'pending' || redemption.status === 'approved') {
        const currentReserved = reservedByUserId.get(redemption.userId) || 0;
        reservedByUserId.set(redemption.userId, currentReserved + rp);
      }
      if (redemption.status === 'approved') {
        const currentRedeemed = redeemedByUserId.get(redemption.userId) || 0;
        redeemedByUserId.set(redemption.userId, currentRedeemed + rp);
      }
    }

    let changed = false;
    const normalized = wallets.map((wallet) => {
      const publicUserId = publicUserIdByWalletId.get(wallet.userId) || wallet.userId;
      const earned = earnedByUserId.get(publicUserId) || 0;
      const redeemed = redeemedByUserId.get(publicUserId) || 0;
      const reserved = reservedByUserId.get(publicUserId) || 0;
      const available = Math.max(0, earned - reserved);

      if (
        Math.abs((wallet.rewardPoints || 0) - available) <= 0.0001
        && Math.abs((wallet.totalRewardPointsEarned || 0) - earned) <= 0.0001
        && Math.abs((wallet.totalRewardPointsRedeemed || 0) - redeemed) <= 0.0001
      ) {
        return wallet;
      }

      changed = true;
      return {
        ...wallet,
        rewardPoints: available,
        totalRewardPointsEarned: earned,
        totalRewardPointsRedeemed: redeemed,
      };
    });

    if (changed) {
      this.saveWallets(normalized);
    }

    return normalized;
  }

  static getWallets(): Wallet[] {
    const CACHE_KEY_WALLETS_NORMALIZED = '__wallets_normalized';
    if (this._cache.has(CACHE_KEY_WALLETS_NORMALIZED)) {
      return this._cache.get(CACHE_KEY_WALLETS_NORMALIZED) as Wallet[];
    }
    const wallets = this.getCached<Record<string, unknown>[]>(DB_KEYS.WALLETS, []);
    const pins = this.getPins();
    const unusedPinCountByUserId = new Map<string, number>();
    for (const pin of pins) {
      if (pin.status !== 'unused') continue;
      const current = unusedPinCountByUserId.get(pin.ownerId) || 0;
      unusedPinCountByUserId.set(pin.ownerId, current + 1);
    }
    let hasLegacyFields = false;
    const normalized: Wallet[] = wallets.map((raw) => {
      const source = raw || {};
      if (
        Object.prototype.hasOwnProperty.call(source, 'fundWallet')
        || Object.prototype.hasOwnProperty.call(source, 'receiveHelpWallet')
        || Object.prototype.hasOwnProperty.call(source, 'getHelpWallet')
        || !Object.prototype.hasOwnProperty.call(source, 'royaltyWallet')
      ) {
        hasLegacyFields = true;
      }
      const {
        fundWallet: _legacyFundWallet,
        receiveHelpWallet: _legacyReceiveHelpWallet,
        getHelpWallet: _legacyGetHelpWallet,
        ...rest
      } = source as Record<string, unknown>;
      const userId = typeof rest.userId === 'string' ? rest.userId : String(rest.userId || '');
      const depositWalletValue = Number(rest.depositWallet);
      const pinWalletValue = Number(rest.pinWallet);
      const normalizedStoredPinWallet = Number.isFinite(pinWalletValue) ? pinWalletValue : 0;
      const computedPinWallet = unusedPinCountByUserId.get(userId) || 0;
      if (normalizedStoredPinWallet !== computedPinWallet) {
        hasLegacyFields = true;
      }
      const incomeWalletValue = Number(rest.incomeWallet);
      const royaltyWalletValue = Number(rest.royaltyWallet);
      const matrixWalletValue = Number(rest.matrixWallet);
      const lockedIncomeWalletValue = Number(rest.lockedIncomeWallet);
      const giveHelpLockedValue = Number(rest.giveHelpLocked);
      const totalReceivedValue = Number(rest.totalReceived);
      const totalGivenValue = Number(rest.totalGiven);
      const fundRecoveryDueValue = Number(rest.fundRecoveryDue);
      const fundRecoveryRecoveredTotalValue = Number(rest.fundRecoveryRecoveredTotal);
      const fundRecoveryReasonValue = rest.fundRecoveryReason;
      const pendingSystemFeeValue = Number(rest.pendingSystemFee);
      const lastSystemFeeDateValue = rest.lastSystemFeeDate;
      return {
        userId,
        depositWallet: Number.isFinite(depositWalletValue) ? depositWalletValue : 0,
        fundRecoveryDue: Number.isFinite(fundRecoveryDueValue) ? fundRecoveryDueValue : 0,
        fundRecoveryRecoveredTotal: Number.isFinite(fundRecoveryRecoveredTotalValue) ? fundRecoveryRecoveredTotalValue : 0,
        fundRecoveryReason: typeof fundRecoveryReasonValue === 'string' && fundRecoveryReasonValue.trim()
          ? fundRecoveryReasonValue.trim()
          : null,
        pinWallet: computedPinWallet,
        incomeWallet: Number.isFinite(incomeWalletValue) ? incomeWalletValue : 0,
        royaltyWallet: Number.isFinite(royaltyWalletValue) ? royaltyWalletValue : 0,
        matrixWallet: Number.isFinite(matrixWalletValue) ? matrixWalletValue : 0,
        lockedIncomeWallet: Number.isFinite(lockedIncomeWalletValue) ? lockedIncomeWalletValue : 0,
        giveHelpLocked: Number.isFinite(giveHelpLockedValue) ? giveHelpLockedValue : 0,
        totalReceived: Number.isFinite(totalReceivedValue) ? totalReceivedValue : 0,
        totalGiven: Number.isFinite(totalGivenValue) ? totalGivenValue : 0,
        pendingSystemFee: Number.isFinite(pendingSystemFeeValue) ? pendingSystemFeeValue : 0,
        lastSystemFeeDate: typeof lastSystemFeeDateValue === 'string' ? lastSystemFeeDateValue : null,
        rewardPoints: Number.isFinite(Number(rest.rewardPoints)) ? Number(rest.rewardPoints) : 0,
        totalRewardPointsEarned: Number.isFinite(Number(rest.totalRewardPointsEarned)) ? Number(rest.totalRewardPointsEarned) : 0,
        totalRewardPointsRedeemed: Number.isFinite(Number(rest.totalRewardPointsRedeemed)) ? Number(rest.totalRewardPointsRedeemed) : 0,
      };
    });
    let finalWallets = normalized;
    if (hasLegacyFields) {
      this.saveWallets(normalized);
      finalWallets = normalized;
    }
    finalWallets = this.normalizeMarketplaceRewardPointBalances(finalWallets);
    this._cache.set(CACHE_KEY_WALLETS_NORMALIZED, finalWallets);
    return finalWallets;
  }

  static saveWallets(wallets: Wallet[]): void {
    this._cache.delete('__wallets_normalized');
    this.setCached(DB_KEYS.WALLETS, wallets);
  }

  static getWallet(userId: string): Wallet | undefined {
    return this.getWallets().find(w => w.userId === userId);
  }

  private static computeFundWalletFromTransactionsForUserIds(userIds: Set<string>): {
    balance: number;
    relevantCount: number;
    creditTotal: number;
    debitTotal: number;
  } {
    const allTransactions = this.getTransactions();
    const txs = this.getTransactions()
      .filter((t) => userIds.has(t.userId))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const MATCH_WINDOW_MS = 15 * 60 * 1000;

    const hasMatchingSenderDebitForCredit = (creditTx: Transaction): boolean => {
      if (creditTx.type !== 'p2p_transfer' || creditTx.status !== 'completed' || !(Number(creditTx.amount || 0) > 0)) {
        return false;
      }

      const recipient = this.resolveUserByRef(creditTx.userId);
      const sender = creditTx.fromUserId ? this.resolveUserByRef(creditTx.fromUserId) : undefined;
      if (!recipient || !sender) return false;

      // Self-transfer credits are valid even when source is an income/royalty transfer event.
      if (recipient.id === sender.id) return true;

      const amount = Math.abs(Number(creditTx.amount || 0));
      const creditTime = this.getTransactionTime(creditTx);

      return allTransactions.some((candidate) => {
        if (candidate.type !== 'p2p_transfer' || candidate.status !== 'completed' || !(candidate.amount < 0)) return false;
        if (!this.transactionRefMatchesUser(candidate.userId, sender)) return false;
        if (Math.abs(Math.abs(Number(candidate.amount || 0)) - amount) > 0.009) return false;

        const candidateTargetsRecipient = this.transactionRefMatchesUser(candidate.toUserId, recipient)
          || this.transactionRefMatchesUser(candidate.toUserId, this.getUserByUserId(recipient.userId));
        if (!candidateTargetsRecipient) return false;

        if (creditTx.sourceTransferTxId && candidate.id === creditTx.sourceTransferTxId) return true;

        return Math.abs(this.getTransactionTime(candidate) - creditTime) <= MATCH_WINDOW_MS;
      });
    };

    let balance = 0;
    let relevantCount = 0;
    let creditTotal = 0;
    let debitTotal = 0;

    for (const tx of txs) {
      const desc = String(tx.description || '').toLowerCase();

      if (tx.type === 'deposit' && tx.status === 'completed' && tx.amount > 0) {
        balance += tx.amount;
        creditTotal += tx.amount;
        relevantCount += 1;
        continue;
      }

      if (tx.type === 'admin_credit' && tx.status === 'completed' && tx.amount > 0 && (desc.includes('deposit wallet') || desc.includes('fund wallet'))) {
        balance += tx.amount;
        creditTotal += tx.amount;
        relevantCount += 1;
        continue;
      }

      if (tx.type === 'admin_debit' && tx.status === 'completed' && tx.amount < 0 && (desc.includes('deposit wallet') || desc.includes('fund wallet'))) {
        const amount = Math.abs(tx.amount);
        balance -= amount;
        debitTotal += amount;
        relevantCount += 1;
        continue;
      }

      if (tx.type === 'fund_recovery' && tx.status === 'completed' && tx.amount < 0) {
        const amount = Math.abs(tx.amount);
        balance -= amount;
        debitTotal += amount;
        relevantCount += 1;
        continue;
      }

      if (tx.type === 'p2p_transfer' && tx.status === 'completed') {
        if (tx.amount > 0 && !hasMatchingSenderDebitForCredit(tx)) {
          continue;
        }
        balance += tx.amount;
        if (tx.amount >= 0) {
          creditTotal += tx.amount;
        } else {
          debitTotal += Math.abs(tx.amount);
        }
        relevantCount += 1;
        continue;
      }

      if (
        tx.type === 'income_transfer'
        && tx.status === 'completed'
        && tx.amount < 0
        && desc.includes('to your fund wallet')
      ) {
        // If a matching fund-wallet credit does not exist, treat this as a self transfer into fund wallet.
        const amount = Math.abs(tx.amount);
        const hasExistingCredit = txs.some((creditTx) =>
          creditTx.userId === tx.userId
          && creditTx.type === 'p2p_transfer'
          && creditTx.status === 'completed'
          && Math.abs((creditTx.displayAmount ?? creditTx.amount) || 0) === amount
          && (
            creditTx.sourceTransferTxId === tx.id
            || (
              String(creditTx.description || '').toLowerCase().includes('income wallet transfer')
              && Math.abs(this.getTransactionTime(creditTx) - this.getTransactionTime(tx)) <= MATCH_WINDOW_MS
            )
          )
        );
        if (!hasExistingCredit) {
          balance += amount;
          creditTotal += amount;
          relevantCount += 1;
        }
        continue;
      }

      if (tx.type === 'pin_purchase' && tx.status === 'completed' && tx.amount < 0 && desc.includes('fund wallet')) {
        const amount = Math.abs(tx.amount);
        balance -= amount;
        debitTotal += amount;
        relevantCount += 1;
        continue;
      }

      if (tx.type === 'activation' && tx.status === 'completed' && tx.amount < 0 && desc.includes('fund wallet')) {
        const amount = Math.abs(tx.amount);
        balance -= amount;
        debitTotal += amount;
        relevantCount += 1;
        continue;
      }

      if (tx.type === 'system_fee' && tx.status === 'completed' && tx.amount < 0 && desc.includes('deposit wallet')) {
        const amount = Math.abs(tx.amount);
        balance -= amount;
        debitTotal += amount;
        relevantCount += 1;
        continue;
      }
    }

    // If completed deposits exist in payment history without matching deposit transactions, count them.
    for (const payment of this.getPayments()) {
      if (!userIds.has(payment.userId)) continue;
      if (payment.status !== 'completed') continue;

      const paymentAmount = Number(payment.amount || 0);
      if (!(paymentAmount > 0)) continue;

      const paymentTime = new Date(payment.verifiedAt || payment.createdAt || 0).getTime();
      const hasDepositTx = txs.some((tx) =>
        tx.userId === payment.userId
        && tx.type === 'deposit'
        && tx.status === 'completed'
        && Number(tx.amount || 0) === paymentAmount
        && Math.abs(this.getTransactionTime(tx) - paymentTime) <= MATCH_WINDOW_MS
      );
      if (hasDepositTx) continue;

      balance += paymentAmount;
      creditTotal += paymentAmount;
      relevantCount += 1;
    }

    // If completed paid-from-wallet PIN requests exist without matching pin_purchase debits, count them.
    for (const request of this.getPinPurchaseRequests()) {
      if (!userIds.has(request.userId)) continue;
      if (request.status !== 'completed' || !request.paidFromWallet) continue;

      const requestAmount = Math.abs(Number(request.amount || 0));
      if (!(requestAmount > 0)) continue;

      const requestTime = new Date(request.processedAt || request.createdAt || 0).getTime();
      const hasPinPurchaseTx = txs.some((tx) =>
        tx.userId === request.userId
        && tx.type === 'pin_purchase'
        && tx.status === 'completed'
        && Math.abs(Number(tx.amount || 0)) === requestAmount
        && Number(tx.amount || 0) < 0
        && Math.abs(this.getTransactionTime(tx) - requestTime) <= MATCH_WINDOW_MS
      );
      if (hasPinPurchaseTx) continue;

      balance -= requestAmount;
      debitTotal += requestAmount;
      relevantCount += 1;
    }

    return {
      balance: Math.max(0, Math.round(balance * 100) / 100),
      relevantCount,
      creditTotal: Math.round(creditTotal * 100) / 100,
      debitTotal: Math.round(debitTotal * 100) / 100
    };
  }

  private static cleanupMisleadingFundRecoverySetupTransactions(userIds?: Set<string>): number {
    const transactions = this.getTransactions();
    const filtered = transactions.filter((tx) => {
      if (userIds && !userIds.has(tx.userId)) return true;
      const desc = String(tx.description || '').toLowerCase();
      const isMisleadingSetup =
        tx.type === 'fund_recovery'
        && tx.status === 'completed'
        && tx.amount < 0
        && desc.startsWith('admin recovery due created for unsupported direct pin buys');
      return !isMisleadingSetup;
    });

    const removed = transactions.length - filtered.length;
    if (removed > 0) {
      this.saveTransactions(filtered);
    }
    return removed;
  }

  private static normalizeRecoveryReason(reason: string): string {
    return String(reason || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private static buildReferralMismatchRecoveryReason(mismatch: {
    referredName: string;
    likelyCorrectUserId: string;
  }): string {
    const referredName = String(mismatch.referredName || '').trim() || 'Unknown user';
    const likelyCorrectUserId = String(mismatch.likelyCorrectUserId || '').trim();
    return `duplicate referral income credits for ${referredName}${likelyCorrectUserId ? ` (${likelyCorrectUserId})` : ''}`;
  }

  private static refineActiveRecoveryReason(targetUser: User, recoveryReason: string, currentDue: number): string {
    const normalizedReason = this.normalizeRecoveryReason(recoveryReason);
    if (normalizedReason !== 'duplicate referral income credits') {
      return recoveryReason;
    }

    const matches = this.scanReferralIncomeMismatches().filter((row) => {
      if (row.sponsorUserId !== targetUser.userId) return false;
      if ((row.currentRecoveryDue || 0) <= 0.009) return false;
      return Math.abs((row.currentRecoveryDue || 0) - currentDue) <= 0.009;
    });

    if (matches.length === 1) {
      return this.buildReferralMismatchRecoveryReason(matches[0]);
    }

    return recoveryReason;
  }

  private static getRecoveryProgressForReason(
    userRef: string,
    recoveryReason: string,
    targetAmount: number,
    transactions?: Transaction[]
  ): {
    recoveredSoFar: number;
    currentRecoveryDue: number;
    remainingRecoveryAmount: number;
  } {
    const resolved = this.resolveUserByRef(userRef);
    if (!resolved) {
      return { recoveredSoFar: 0, currentRecoveryDue: 0, remainingRecoveryAmount: Math.max(0, Math.round((targetAmount || 0) * 100) / 100) };
    }

    const canonical = this.getUserByUserId(resolved.userId) || resolved;
    const normalizedReason = this.normalizeRecoveryReason(recoveryReason);
    const roundedTargetAmount = Math.max(0, Math.round((targetAmount || 0) * 100) / 100);
    const wallet = this.getWallet(canonical.id);
    const currentRecoveryDue = (
      wallet && this.normalizeRecoveryReason(String(wallet.fundRecoveryReason || '')) === normalizedReason
    )
      ? Math.max(0, Math.round((wallet.fundRecoveryDue || 0) * 100) / 100)
      : 0;

    const txSource = transactions || this.getTransactions();
    const recoveredSoFar = Math.round(txSource.reduce((sum, tx) => {
      if (!this.transactionRefMatchesUser(tx.userId, canonical)) return sum;
      if (tx.type !== 'fund_recovery' || tx.status !== 'completed' || !(Number(tx.amount || 0) < 0)) return sum;

      const txAdminReason = this.normalizeRecoveryReason(String(tx.adminReason || ''));
      const txDescription = this.normalizeRecoveryReason(String(tx.description || ''));
      const matchesReason = txAdminReason
        ? txAdminReason === normalizedReason
        : txDescription.includes(normalizedReason);

      return matchesReason ? sum + Math.abs(Number(tx.amount || 0)) : sum;
    }, 0) * 100) / 100;

    const remainingRecoveryAmount = Math.max(
      0,
      Math.round((roundedTargetAmount - recoveredSoFar - currentRecoveryDue) * 100) / 100
    );

    return {
      recoveredSoFar,
      currentRecoveryDue,
      remainingRecoveryAmount
    };
  }

  static getFundWalletForensics(userRef: string): {
    publicUserId: string;
    fullName: string;
    canonicalInternalId: string;
    relatedInternalIds: string[];
    duplicateInternalIds: string[];
    storedCanonicalBalance: number;
    storedCombinedBalance: number;
    currentRecoveryDue: number;
    totalRecoveredSoFar: number;
    computedCanonicalBalance: number;
    computedCombinedBalance: number;
    canonicalRelevantCount: number;
    combinedRelevantCount: number;
    combinedCreditTotal: number;
    combinedDebitTotal: number;
    nonPinFundDebitTotal: number;
    missingSelfFundCreditCandidates: number;
    directPinPurchaseCount: number;
    directPinPurchaseAmount: number;
    unsupportedDirectPinBuyAmount: number;
    walletBreakdown: Array<{
      internalId: string;
      storedBalance: number;
      computedBalance: number;
      relevantCount: number;
      txCount: number;
    }>;
  } | null {
    const resolved = this.getUserById(userRef) || this.getUserByUserId(userRef);
    if (!resolved) return null;

    const canonical = this.getUserByUserId(resolved.userId) || resolved;
    this.cleanupMisleadingFundRecoverySetupTransactions(new Set([canonical.id]));
    const relatedUsers = this.getUsers().filter((user) => user.userId === canonical.userId);
    const relatedInternalIds = Array.from(new Set([
      canonical.id,
      ...relatedUsers.map((user) => user.id).filter(Boolean)
    ]));

    const combinedSet = new Set(relatedInternalIds);
    const canonicalSet = new Set([canonical.id]);
    const combinedComputed = this.computeFundWalletFromTransactionsForUserIds(combinedSet);
    const canonicalComputed = this.computeFundWalletFromTransactionsForUserIds(canonicalSet);

    const transactions = this.getTransactions();
    const MATCH_WINDOW_MS = 10 * 60 * 1000;
    const timeOf = (tx: Transaction) => this.getTransactionTime(tx);

    const missingSelfFundCreditCandidates = transactions.filter((tx) =>
      combinedSet.has(tx.userId)
      && tx.type === 'income_transfer'
      && tx.status === 'completed'
      && tx.amount < 0
      && String(tx.description || '').toLowerCase().includes('to your fund wallet')
      && !transactions.some((candidate) =>
        combinedSet.has(candidate.userId)
        && candidate.type === 'p2p_transfer'
        && candidate.status === 'completed'
        && (
          candidate.sourceTransferTxId === tx.id
          || (
            Math.abs((candidate.displayAmount ?? candidate.amount) || 0) === Math.abs(tx.amount || 0)
            && Math.abs(timeOf(candidate) - timeOf(tx)) <= MATCH_WINDOW_MS
          )
        )
      )
    ).length;

    const directFundPinPurchases = transactions.filter((tx) =>
      combinedSet.has(tx.userId)
      && tx.type === 'pin_purchase'
      && tx.status === 'completed'
      && tx.amount < 0
      && String(tx.description || '').toLowerCase().includes('direct pin buy from fund wallet')
    );
    const directPinPurchaseAmount = Math.round(
      directFundPinPurchases.reduce((sum, tx) => sum + Math.abs(tx.amount || 0), 0) * 100
    ) / 100;
    const nonPinFundDebitTotal = Math.max(0, Math.round((combinedComputed.debitTotal - directPinPurchaseAmount) * 100) / 100);
    const availableForDirectPins = Math.max(0, Math.round((combinedComputed.creditTotal - nonPinFundDebitTotal) * 100) / 100);
    const unsupportedDirectPinBuyAmount = Math.max(0, Math.round((directPinPurchaseAmount - availableForDirectPins) * 100) / 100);
    const pinRecoveryProgress = this.getRecoveryProgressForReason(
      canonical.id,
      'unsupported direct PIN buys',
      unsupportedDirectPinBuyAmount,
      transactions
    );

    const walletBreakdown = relatedInternalIds.map((internalId) => {
      const computed = this.computeFundWalletFromTransactionsForUserIds(new Set([internalId]));
      return {
        internalId,
        storedBalance: Math.round(((this.getWallet(internalId)?.depositWallet || 0)) * 100) / 100,
        computedBalance: computed.balance,
        relevantCount: computed.relevantCount,
        txCount: transactions.filter((tx) => tx.userId === internalId).length
      };
    });

    return {
      publicUserId: canonical.userId,
      fullName: canonical.fullName,
      canonicalInternalId: canonical.id,
      relatedInternalIds,
      duplicateInternalIds: relatedInternalIds.filter((id) => id !== canonical.id),
      storedCanonicalBalance: Math.round(((this.getWallet(canonical.id)?.depositWallet || 0)) * 100) / 100,
      storedCombinedBalance: Math.round(walletBreakdown.reduce((sum, row) => sum + row.storedBalance, 0) * 100) / 100,
      currentRecoveryDue: pinRecoveryProgress.currentRecoveryDue,
      totalRecoveredSoFar: pinRecoveryProgress.recoveredSoFar,
      computedCanonicalBalance: canonicalComputed.balance,
      computedCombinedBalance: combinedComputed.balance,
      canonicalRelevantCount: canonicalComputed.relevantCount,
      combinedRelevantCount: combinedComputed.relevantCount,
      combinedCreditTotal: combinedComputed.creditTotal,
      combinedDebitTotal: combinedComputed.debitTotal,
      nonPinFundDebitTotal,
      missingSelfFundCreditCandidates,
      directPinPurchaseCount: directFundPinPurchases.length,
      directPinPurchaseAmount,
      unsupportedDirectPinBuyAmount,
      walletBreakdown
    };
  }

  static startFundRecoveryForUnsupportedPinBuys(userRef: string): {
    success: boolean;
    message: string;
    recoveryDue?: number;
    recoveredNow?: number;
  } {
    const forensic = this.getFundWalletForensics(userRef);
    if (!forensic) {
      return { success: false, message: 'User not found' };
    }

    const wallet = this.getWallet(forensic.canonicalInternalId);
    if (!wallet) {
      return { success: false, message: 'Wallet not found' };
    }

    const targetDue = Math.round((forensic.unsupportedDirectPinBuyAmount || 0) * 100) / 100;
    if (targetDue <= 0) {
      return { success: false, message: 'No unsupported direct PIN buy amount found for this user' };
    }

    const recoveryProgress = this.getRecoveryProgressForReason(
      forensic.canonicalInternalId,
      'unsupported direct PIN buys',
      targetDue
    );
    if (recoveryProgress.currentRecoveryDue > 0.009) {
      return {
        success: true,
        message: `Recovery already active for $${recoveryProgress.currentRecoveryDue.toFixed(2)}`,
        recoveryDue: recoveryProgress.currentRecoveryDue
      };
    }
    if (recoveryProgress.remainingRecoveryAmount <= 0.009) {
      return {
        success: true,
        message: `Recovery already completed for $${targetDue.toFixed(2)}`,
        recoveryDue: 0,
        recoveredNow: 0
      };
    }

    return this.activateFundRecoveryForUser(
      this.getUserById(forensic.canonicalInternalId) || this.getUserByUserId(forensic.publicUserId)!,
      recoveryProgress.remainingRecoveryAmount,
      'unsupported direct PIN buys'
    );
  }

  private static activateFundRecoveryForUser(
    targetUser: User,
    targetDue: number,
    recoveryReason: string
  ): {
    success: boolean;
    message: string;
    recoveryDue?: number;
    recoveredNow?: number;
  } {
    this.repairFundWalletConsistency(targetUser.id);
    this.repairIncomeWalletConsistency(targetUser.id);
    const wallet = this.getWallet(targetUser.id);
    if (!wallet) {
      return { success: false, message: 'Wallet not found' };
    }

    const roundedTargetDue = Math.round((targetDue || 0) * 100) / 100;
    if (roundedTargetDue <= 0) {
      return { success: false, message: 'No recoverable amount found for this user' };
    }

    const normalizedReason = this.normalizeRecoveryReason(recoveryReason);
    const currentDue = this.normalizeRecoveryReason(String(wallet.fundRecoveryReason || '')) === normalizedReason
      ? Math.round((wallet.fundRecoveryDue || 0) * 100) / 100
      : 0;
    if (currentDue > 0.009) {
      return {
        success: true,
        message: `Recovery already active for $${currentDue.toFixed(2)}`,
        recoveryDue: currentDue
      };
    }

    const fundBalance = Math.max(0, Math.round((wallet.depositWallet || 0) * 100) / 100);
    const incomeBalance = Math.max(0, Math.round((wallet.incomeWallet || 0) * 100) / 100);
    let remaining = roundedTargetDue;
    const fundTake = Math.min(fundBalance, remaining);
    remaining = Math.round((remaining - fundTake) * 100) / 100;
    const incomeTake = Math.min(incomeBalance, remaining);
    remaining = Math.round((remaining - incomeTake) * 100) / 100;
    const recoveredNow = Math.round((fundTake + incomeTake) * 100) / 100;

    if (recoveredNow > 0.0001) {
      this.updateWallet(targetUser.id, {
        depositWallet: Math.round((fundBalance - fundTake) * 100) / 100,
        incomeWallet: Math.round((incomeBalance - incomeTake) * 100) / 100,
        fundRecoveryDue: remaining,
        fundRecoveryRecoveredTotal: Math.round(((wallet.fundRecoveryRecoveredTotal || 0) + recoveredNow) * 100) / 100,
        fundRecoveryReason: remaining > 0.0001 ? recoveryReason : null
      });

      if (fundTake > 0.0001) {
        this.addToSafetyPool(fundTake, targetUser.id, `Recovery from ${recoveryReason} via current fund wallet balance`);
        this.createTransaction({
          id: generateEventId('tx', 'fund_recovery_manual_fund'),
          userId: targetUser.id,
          type: 'fund_recovery',
          amount: -fundTake,
          status: 'completed',
          description: `Admin debited from fund wallet to recover ${recoveryReason}. Remaining recovery due: $${remaining.toFixed(2)}`,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          adminReason: recoveryReason
        });
      }

      if (incomeTake > 0.0001) {
        this.addToSafetyPool(incomeTake, targetUser.id, `Recovery from ${recoveryReason} via current income wallet balance`);
        this.createTransaction({
          id: generateEventId('tx', 'fund_recovery_manual_income'),
          userId: targetUser.id,
          type: 'fund_recovery',
          amount: -incomeTake,
          status: 'completed',
          description: `Admin debited from income wallet to recover ${recoveryReason}. Remaining recovery due: $${remaining.toFixed(2)}`,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          adminReason: recoveryReason
        });
      }

      if (remaining <= 0.0001) {
        return {
          success: true,
          message: `Recovered $${recoveredNow.toFixed(2)} immediately from current wallet balance`,
          recoveryDue: 0,
          recoveredNow
        };
      }

      return {
        success: true,
        message: `Recovered $${recoveredNow.toFixed(2)} immediately. Recovery due of $${remaining.toFixed(2)} is now active`,
        recoveryDue: remaining,
        recoveredNow
      };
    }

    this.updateWallet(targetUser.id, {
      fundRecoveryDue: roundedTargetDue,
      fundRecoveryReason: recoveryReason
    });

    return {
      success: true,
      message: `Recovery due of $${roundedTargetDue.toFixed(2)} is now active`,
      recoveryDue: roundedTargetDue,
      recoveredNow: 0
    };
  }

  static applyActiveFundRecoveryNow(userRef: string): {
    success: boolean;
    message: string;
    recoveryDue?: number;
    recoveredNow?: number;
  } {
    const targetUser = this.resolveUserByRef(userRef);
    if (!targetUser) {
      return { success: false, message: 'User not found' };
    }

    this.repairFundWalletConsistency(targetUser.id);
    this.repairIncomeWalletConsistency(targetUser.id);

    const wallet = this.getWallet(targetUser.id);
    if (!wallet) {
      return { success: false, message: 'Wallet not found' };
    }

    const currentDue = Math.max(0, Math.round(Number(wallet.fundRecoveryDue || 0) * 100) / 100);
    const recoveryReason = this.refineActiveRecoveryReason(
      targetUser,
      String(wallet.fundRecoveryReason || '').trim(),
      currentDue
    );
    if (currentDue <= 0.009 || !recoveryReason) {
      return { success: false, message: 'No active fund recovery due found for this user' };
    }

    const fundBalance = Math.max(0, Math.round(Number(wallet.depositWallet || 0) * 100) / 100);
    const incomeBalance = Math.max(0, Math.round(Number(wallet.incomeWallet || 0) * 100) / 100);

    let remaining = currentDue;
    const fundTake = Math.min(fundBalance, remaining);
    remaining = Math.round((remaining - fundTake) * 100) / 100;
    const incomeTake = Math.min(incomeBalance, remaining);
    remaining = Math.round((remaining - incomeTake) * 100) / 100;
    const recoveredNow = Math.round((fundTake + incomeTake) * 100) / 100;

    if (recoveredNow <= 0.0001) {
      return {
        success: true,
        message: `Recovery is active for $${currentDue.toFixed(2)}, but no current fund/income balance is available to deduct right now`,
        recoveryDue: currentDue,
        recoveredNow: 0
      };
    }

    this.updateWallet(targetUser.id, {
      depositWallet: Math.round((fundBalance - fundTake) * 100) / 100,
      incomeWallet: Math.round((incomeBalance - incomeTake) * 100) / 100,
      fundRecoveryDue: remaining,
      fundRecoveryRecoveredTotal: Math.round(((wallet.fundRecoveryRecoveredTotal || 0) + recoveredNow) * 100) / 100,
      fundRecoveryReason: remaining > 0.0001 ? recoveryReason : null
    });

    if (fundTake > 0.0001) {
      this.addToSafetyPool(fundTake, targetUser.id, `Recovery from ${recoveryReason} via current fund wallet balance`);
      this.createTransaction({
        id: generateEventId('tx', 'fund_recovery_force_fund'),
        userId: targetUser.id,
        type: 'fund_recovery',
        amount: -fundTake,
        status: 'completed',
        description: `Admin debited from fund wallet to recover ${recoveryReason}. Remaining recovery due: $${remaining.toFixed(2)}`,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        adminReason: recoveryReason
      });
    }

    if (incomeTake > 0.0001) {
      this.addToSafetyPool(incomeTake, targetUser.id, `Recovery from ${recoveryReason} via current income wallet balance`);
      this.createTransaction({
        id: generateEventId('tx', 'fund_recovery_force_income'),
        userId: targetUser.id,
        type: 'fund_recovery',
        amount: -incomeTake,
        status: 'completed',
        description: `Admin debited from income wallet to recover ${recoveryReason}. Remaining recovery due: $${remaining.toFixed(2)}`,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        adminReason: recoveryReason
      });
    }

    return {
      success: true,
      message: remaining > 0.0001
        ? `Recovered $${recoveredNow.toFixed(2)} now. Remaining active recovery due: $${remaining.toFixed(2)}`
        : `Recovered $${recoveredNow.toFixed(2)} and cleared the active recovery due`,
      recoveryDue: remaining,
      recoveredNow
    };
  }

  static startFundRecoveryForReferralIncomeMismatch(userRef: string, likelyCorrectUserId?: string): {
    success: boolean;
    message: string;
    recoveryDue?: number;
    recoveredNow?: number;
  } {
    const cleanUserId = String(userRef || '').trim();
    const cleanLikelyCorrectUserId = String(likelyCorrectUserId || '').trim();
    if (!cleanUserId) {
      return { success: false, message: 'User not found' };
    }

    const mismatch = this.scanReferralIncomeMismatches().find((row) =>
      row.sponsorUserId === cleanUserId
      && (!cleanLikelyCorrectUserId || row.likelyCorrectUserId === cleanLikelyCorrectUserId)
    );
    if (!mismatch) {
      return { success: false, message: 'No referral income mismatch found for this user' };
    }

    const canonicalUser = this.getUserByUserId(mismatch.sponsorUserId);
    if (!canonicalUser) {
      return { success: false, message: 'User not found' };
    }

    const targetDue = Math.round((mismatch.extraCreditedAmount || 0) * 100) / 100;
    if (targetDue <= 0) {
      return { success: false, message: 'No extra referral income amount found for this user' };
    }

    const recoveryReason = this.buildReferralMismatchRecoveryReason(mismatch);
    const specificRecoveryProgress = this.getRecoveryProgressForReason(canonicalUser.id, recoveryReason, targetDue);
    const legacyRecoveryProgress = this.getRecoveryProgressForReason(canonicalUser.id, 'duplicate referral income credits', targetDue);
    const specificCoverage = (specificRecoveryProgress.currentRecoveryDue || 0) + (specificRecoveryProgress.recoveredSoFar || 0);
    const legacyCoverage = (legacyRecoveryProgress.currentRecoveryDue || 0) + (legacyRecoveryProgress.recoveredSoFar || 0);
    const recoveryProgress = legacyCoverage > specificCoverage
      ? legacyRecoveryProgress
      : specificRecoveryProgress;
    if (recoveryProgress.currentRecoveryDue > 0.009) {
      return {
        success: true,
        message: `Recovery already active for $${recoveryProgress.currentRecoveryDue.toFixed(2)}`,
        recoveryDue: recoveryProgress.currentRecoveryDue,
        recoveredNow: 0
      };
    }
    if (recoveryProgress.remainingRecoveryAmount <= 0.009) {
      return {
        success: true,
        message: `Recovery already completed for $${targetDue.toFixed(2)}`,
        recoveryDue: 0,
        recoveredNow: 0
      };
    }

    return this.activateFundRecoveryForUser(canonicalUser, recoveryProgress.remainingRecoveryAmount, recoveryReason);
  }

  static scanUsersForUnsupportedDirectFundPinBuys(): Array<{
    userId: string;
    fullName: string;
    canonicalInternalId: string;
    directPinPurchaseCount: number;
    directPinPurchaseAmount: number;
    unsupportedDirectPinBuyAmount: number;
    missingSelfFundCreditCandidates: number;
    storedFundWallet: number;
    currentRecoveryDue: number;
    totalRecoveredSoFar: number;
    remainingRecoveryAmount: number;
    txnDerivedFundWallet: number;
    combinedCreditTotal: number;
    nonPinFundDebitTotal: number;
    duplicateInternalIds: number;
  }> {
    const seen = new Set<string>();
    const rows: Array<{
      userId: string;
      fullName: string;
      canonicalInternalId: string;
      directPinPurchaseCount: number;
      directPinPurchaseAmount: number;
      unsupportedDirectPinBuyAmount: number;
      missingSelfFundCreditCandidates: number;
      storedFundWallet: number;
      currentRecoveryDue: number;
      totalRecoveredSoFar: number;
      remainingRecoveryAmount: number;
      txnDerivedFundWallet: number;
      combinedCreditTotal: number;
      nonPinFundDebitTotal: number;
      duplicateInternalIds: number;
    }> = [];

    for (const user of this.getUsers()) {
      const publicUserId = String(user.userId || '').trim();
      if (!publicUserId || seen.has(publicUserId)) continue;
      seen.add(publicUserId);

      const forensic = this.getFundWalletForensics(publicUserId);
      if (!forensic) continue;
      if (forensic.directPinPurchaseAmount <= 0) continue;
      if (forensic.unsupportedDirectPinBuyAmount <= 0.009 && forensic.missingSelfFundCreditCandidates <= 0) continue;

      rows.push({
        userId: forensic.publicUserId,
        fullName: forensic.fullName,
        canonicalInternalId: forensic.canonicalInternalId,
        directPinPurchaseCount: forensic.directPinPurchaseCount,
        directPinPurchaseAmount: forensic.directPinPurchaseAmount,
        unsupportedDirectPinBuyAmount: forensic.unsupportedDirectPinBuyAmount,
        missingSelfFundCreditCandidates: forensic.missingSelfFundCreditCandidates,
        storedFundWallet: forensic.storedCombinedBalance,
        currentRecoveryDue: forensic.currentRecoveryDue,
        totalRecoveredSoFar: forensic.totalRecoveredSoFar,
        remainingRecoveryAmount: Math.max(
          0,
          Math.round((forensic.unsupportedDirectPinBuyAmount - forensic.totalRecoveredSoFar - forensic.currentRecoveryDue) * 100) / 100
        ),
        txnDerivedFundWallet: forensic.computedCombinedBalance,
        combinedCreditTotal: forensic.combinedCreditTotal,
        nonPinFundDebitTotal: forensic.nonPinFundDebitTotal,
        duplicateInternalIds: forensic.duplicateInternalIds.length
      });
    }

    return rows.sort((a, b) =>
      b.unsupportedDirectPinBuyAmount - a.unsupportedDirectPinBuyAmount
      || b.directPinPurchaseAmount - a.directPinPurchaseAmount
      || a.userId.localeCompare(b.userId)
    );
  }

  private static buildReferralIncomeMismatchRowsFromTransactions(transactions: Transaction[]): Array<{
    sponsorUserId: string;
    sponsorName: string;
    referredName: string;
    likelyCorrectUserId: string;
    directIncomeCount: number;
    extraDirectIncomeCount: number;
    totalCreditedAmount: number;
    extraCreditedAmount: number;
    currentRecoveryDue: number;
    totalRecoveredSoFar: number;
    remainingRecoveryAmount: number;
    wrongUserIds: string[];
    firstCreatedAt: string;
    lastCreatedAt: string;
  }> {
    const completedDirectIncomeTxs = transactions.filter((tx) => tx.type === 'direct_income' && tx.status === 'completed');
    const grouped = new Map<string, {
      sponsorUserId: string;
      sponsorName: string;
      referredName: string;
      likelyCorrectUserId: string;
      entries: Array<{ tx: Transaction; parsedUserId: string; createdAtMs: number; isCanonical: boolean }>;
      wrongUserIds: Set<string>;
    }>();

    for (const tx of completedDirectIncomeTxs) {
      const sponsor = this.resolveLikelySponsorForDirectIncome(tx);
      if (!sponsor) continue;

      const parsed = this.parseReferralIncomeDescription(tx.description);
      const likelySource = this.resolveLikelyReferralSourceForDirectIncome(tx, sponsor);
      if (!likelySource) continue;

      const likelyCorrectUserId = likelySource.userId;
      const referredName = likelySource.fullName || parsed?.fullName || 'Unknown user';
      const groupKey = `${sponsor.userId}__${likelyCorrectUserId}`;
      const existing = grouped.get(groupKey) || {
        sponsorUserId: sponsor.userId,
        sponsorName: sponsor.fullName,
        referredName,
        likelyCorrectUserId,
        entries: [],
        wrongUserIds: new Set<string>()
      };

      const parsedUserId = String(parsed?.userId || '').trim();
      const parsedExists = parsedUserId ? !!this.getUserByUserId(parsedUserId) : false;
      const isCanonical = (
        (tx.fromUserId ? this.transactionRefMatchesUser(tx.fromUserId, likelySource) : false)
        || (!!parsedUserId && parsedUserId === likelyCorrectUserId)
      );

      if (parsedUserId && (!parsedExists || parsedUserId !== likelyCorrectUserId)) {
        existing.wrongUserIds.add(parsedUserId);
      }

      existing.entries.push({
        tx,
        parsedUserId,
        createdAtMs: new Date(tx.completedAt || tx.createdAt || '').getTime(),
        isCanonical
      });
      grouped.set(groupKey, existing);
    }

    return Array.from(grouped.values())
      .map((group) => {
        const sorted = [...group.entries].sort((a, b) => a.createdAtMs - b.createdAtMs);
        let keepIndex = sorted.findIndex((entry) => entry.isCanonical);
        if (keepIndex < 0) keepIndex = 0;

        const extraEntries = sorted.filter((_, index) => index !== keepIndex);
        const totalCreditedAmount = sorted.reduce((sum, entry) => sum + Math.abs(Number(entry.tx.amount || 0)), 0);
        const extraCreditedAmount = extraEntries.reduce((sum, entry) => sum + Math.abs(Number(entry.tx.amount || 0)), 0);
        const sponsorUser = this.getUserByUserId(group.sponsorUserId);
        const specificRecoveryReason = this.buildReferralMismatchRecoveryReason({
          referredName: group.referredName,
          likelyCorrectUserId: group.likelyCorrectUserId
        });
        const specificRecoveryProgress = this.getRecoveryProgressForReason(
          sponsorUser?.id || group.sponsorUserId,
          specificRecoveryReason,
          extraCreditedAmount,
          transactions
        );
        const legacyRecoveryProgress = this.getRecoveryProgressForReason(
          sponsorUser?.id || group.sponsorUserId,
          'duplicate referral income credits',
          extraCreditedAmount,
          transactions
        );
        const specificCoverage = (specificRecoveryProgress.currentRecoveryDue || 0) + (specificRecoveryProgress.recoveredSoFar || 0);
        const legacyCoverage = (legacyRecoveryProgress.currentRecoveryDue || 0) + (legacyRecoveryProgress.recoveredSoFar || 0);
        const recoveryProgress = legacyCoverage > specificCoverage
          ? legacyRecoveryProgress
          : specificRecoveryProgress;

        return {
          sponsorUserId: group.sponsorUserId,
          sponsorName: group.sponsorName,
          referredName: group.referredName,
          likelyCorrectUserId: group.likelyCorrectUserId,
          directIncomeCount: sorted.length,
          extraDirectIncomeCount: extraEntries.length,
          totalCreditedAmount,
          extraCreditedAmount,
          currentRecoveryDue: recoveryProgress.currentRecoveryDue,
          totalRecoveredSoFar: recoveryProgress.recoveredSoFar,
          remainingRecoveryAmount: recoveryProgress.remainingRecoveryAmount,
          wrongUserIds: Array.from(group.wrongUserIds),
          firstCreatedAt: sorted[0]?.tx.createdAt || '',
          lastCreatedAt: sorted[sorted.length - 1]?.tx.createdAt || ''
        };
      })
      .filter((row) => row.extraDirectIncomeCount > 0 || row.wrongUserIds.length > 0)
      .sort((a, b) =>
        b.extraCreditedAmount - a.extraCreditedAmount
        || b.directIncomeCount - a.directIncomeCount
        || a.sponsorUserId.localeCompare(b.sponsorUserId)
      );
  }

  static scanReferralIncomeMismatches(): Array<{
    sponsorUserId: string;
    sponsorName: string;
    referredName: string;
    likelyCorrectUserId: string;
    directIncomeCount: number;
    extraDirectIncomeCount: number;
    totalCreditedAmount: number;
    extraCreditedAmount: number;
    currentRecoveryDue: number;
    totalRecoveredSoFar: number;
    remainingRecoveryAmount: number;
    wrongUserIds: string[];
    firstCreatedAt: string;
    lastCreatedAt: string;
  }> {
    return this.buildReferralIncomeMismatchRowsFromTransactions(this.getTransactions());
  }

  private static buildDuplicateLockedGiveHelpMismatchRows(transactions: Transaction[]): Array<{
    mismatchKey: string;
    senderUserId: string;
    senderName: string;
    recipientUserId: string;
    recipientName: string;
    level: number;
    giveAmount: number;
    giveCount: number;
    extraGiveCount: number;
    receiveCount: number;
    extraReceiveCount: number;
    totalGivenAmount: number;
    extraGivenAmount: number;
    extraCreditedAmount: number;
    currentRecoveryDue: number;
    totalRecoveredSoFar: number;
    remainingRecoveryAmount: number;
    clusterStartedAt: string;
    clusterEndedAt: string;
  }> {
    const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
    const lockedGiveTxs = transactions.filter((tx) =>
      tx.type === 'give_help'
      && tx.status === 'completed'
      && tx.amount < 0
      && String(tx.description || '').toLowerCase().includes('from locked income')
    );
    const completedReceiveTxs = transactions.filter((tx) =>
      tx.type === 'receive_help'
      && tx.status === 'completed'
      && tx.amount > 0
      && !!tx.fromUserId
    );

    const grouped = new Map<string, {
      sender: User;
      recipient: User;
      level: number;
      amount: number;
      entries: Transaction[];
    }>();

    for (const tx of lockedGiveTxs) {
      const sender = this.resolveUserByRef(tx.userId);
      const recipient = (tx.toUserId && this.resolveUserByRef(tx.toUserId))
        || ((tx.description || '').match(/\((\d{7})\)/)?.[1] ? this.getUserByUserId((tx.description || '').match(/\((\d{7})\)/)?.[1] || '') : undefined);
      const level = this.resolveTransactionLevel(tx);
      const amount = Math.abs(Number(tx.amount || 0));
      if (!sender || !recipient || !level || !(amount > 0)) continue;

      const key = `${sender.id}__${recipient.id}__${level}__${amount.toFixed(2)}`;
      const bucket = grouped.get(key) || { sender, recipient, level, amount, entries: [] };
      bucket.entries.push(tx);
      grouped.set(key, bucket);
    }

    const rows: Array<{
      mismatchKey: string;
      senderUserId: string;
      senderName: string;
      recipientUserId: string;
      recipientName: string;
      level: number;
      giveAmount: number;
      giveCount: number;
      extraGiveCount: number;
      receiveCount: number;
      extraReceiveCount: number;
      totalGivenAmount: number;
      extraGivenAmount: number;
      extraCreditedAmount: number;
      currentRecoveryDue: number;
      totalRecoveredSoFar: number;
      remainingRecoveryAmount: number;
      clusterStartedAt: string;
      clusterEndedAt: string;
    }> = [];

    for (const group of grouped.values()) {
      const sorted = [...group.entries].sort((a, b) => this.getTransactionTime(a) - this.getTransactionTime(b));
      let cluster: Transaction[] = [];

      const flushCluster = () => {
        if (cluster.length < 2) {
          cluster = [];
          return;
        }

        const firstTx = cluster[0];
        const lastTx = cluster[cluster.length - 1];
        const firstTime = this.getTransactionTime(firstTx);
        const lastTime = this.getTransactionTime(lastTx);
        const matchingReceives = completedReceiveTxs.filter((receiveTx) =>
          this.transactionRefMatchesUser(receiveTx.userId, group.recipient)
          && this.transactionRefMatchesUser(receiveTx.fromUserId, group.sender)
          && this.resolveTransactionLevel(receiveTx) === group.level
          && Math.abs(Number(receiveTx.amount || 0)) === group.amount
          && this.getTransactionTime(receiveTx) >= (firstTime - DUPLICATE_WINDOW_MS)
          && this.getTransactionTime(receiveTx) <= (lastTime + DUPLICATE_WINDOW_MS)
        );

        const giveCount = cluster.length;
        const extraGiveCount = Math.max(0, giveCount - 1);
        const receiveCount = matchingReceives.length;
        const extraReceiveCount = Math.max(0, receiveCount - 1);
        const extraCreditedCount = Math.min(extraGiveCount, extraReceiveCount);
        const recoveryReason = `duplicate give-help credits of ${group.sender.fullName} (${group.sender.userId})`;
        const recoveryProgress = this.getRecoveryProgressForReason(
          group.recipient.id,
          recoveryReason,
          Math.round((extraCreditedCount * group.amount) * 100) / 100,
          transactions
        );

        rows.push({
          mismatchKey: `${group.sender.userId}__${group.recipient.userId}__L${group.level}__${firstTx.id}`,
          senderUserId: group.sender.userId,
          senderName: group.sender.fullName,
          recipientUserId: group.recipient.userId,
          recipientName: group.recipient.fullName,
          level: group.level,
          giveAmount: group.amount,
          giveCount,
          extraGiveCount,
          receiveCount,
          extraReceiveCount,
          totalGivenAmount: Math.round((giveCount * group.amount) * 100) / 100,
          extraGivenAmount: Math.round((extraGiveCount * group.amount) * 100) / 100,
          extraCreditedAmount: Math.round((extraCreditedCount * group.amount) * 100) / 100,
          currentRecoveryDue: recoveryProgress.currentRecoveryDue,
          totalRecoveredSoFar: recoveryProgress.recoveredSoFar,
          remainingRecoveryAmount: recoveryProgress.remainingRecoveryAmount,
          clusterStartedAt: firstTx.createdAt || '',
          clusterEndedAt: lastTx.createdAt || ''
        });

        cluster = [];
      };

      for (const tx of sorted) {
        if (cluster.length === 0) {
          cluster.push(tx);
          continue;
        }

        const previousTx = cluster[cluster.length - 1];
        if (this.getTransactionTime(tx) - this.getTransactionTime(previousTx) <= DUPLICATE_WINDOW_MS) {
          cluster.push(tx);
        } else {
          flushCluster();
          cluster.push(tx);
        }
      }

      flushCluster();
    }

    return rows
      .filter((row) => row.extraGiveCount > 0)
      .sort((a, b) =>
        b.extraCreditedAmount - a.extraCreditedAmount
        || b.extraGivenAmount - a.extraGivenAmount
        || a.senderUserId.localeCompare(b.senderUserId)
      );
  }

  static scanDuplicateLockedGiveHelpMismatches(): Array<{
    mismatchKey: string;
    senderUserId: string;
    senderName: string;
    recipientUserId: string;
    recipientName: string;
    level: number;
    giveAmount: number;
    giveCount: number;
    extraGiveCount: number;
    receiveCount: number;
    extraReceiveCount: number;
    totalGivenAmount: number;
    extraGivenAmount: number;
    extraCreditedAmount: number;
    currentRecoveryDue: number;
    totalRecoveredSoFar: number;
    remainingRecoveryAmount: number;
    clusterStartedAt: string;
    clusterEndedAt: string;
  }> {
    return this.buildDuplicateLockedGiveHelpMismatchRows(this.getTransactions());
  }

  static startFundRecoveryForDuplicateLockedGiveHelpMismatch(mismatchKey: string): {
    success: boolean;
    message: string;
    recoveryDue?: number;
    recoveredNow?: number;
  } {
    const cleanKey = String(mismatchKey || '').trim();
    if (!cleanKey) {
      return { success: false, message: 'Mismatch not found' };
    }

    const mismatch = this.scanDuplicateLockedGiveHelpMismatches().find((row) => row.mismatchKey === cleanKey);
    if (!mismatch) {
      return { success: false, message: 'Duplicate give-help mismatch not found' };
    }

    if ((mismatch.extraCreditedAmount || 0) <= 0.009) {
      return { success: false, message: 'No extra recipient credit found to recover for this mismatch' };
    }

    const recipient = this.getUserByUserId(mismatch.recipientUserId);
    if (!recipient) {
      return { success: false, message: 'Recipient user not found' };
    }

    const recoveryReason = `duplicate give-help credits of ${mismatch.senderName} (${mismatch.senderUserId})`;
    const recoveryProgress = this.getRecoveryProgressForReason(recipient.id, recoveryReason, mismatch.extraCreditedAmount);
    if (recoveryProgress.currentRecoveryDue > 0.009) {
      return {
        success: true,
        message: `Recovery already active for $${recoveryProgress.currentRecoveryDue.toFixed(2)}`,
        recoveryDue: recoveryProgress.currentRecoveryDue,
        recoveredNow: 0
      };
    }
    if (recoveryProgress.remainingRecoveryAmount <= 0.009) {
      return {
        success: true,
        message: `Recovery already completed for $${Number(mismatch.extraCreditedAmount || 0).toFixed(2)}`,
        recoveryDue: 0,
        recoveredNow: 0
      };
    }

    return this.activateFundRecoveryForUser(
      recipient,
      recoveryProgress.remainingRecoveryAmount,
      recoveryReason
    );
  }

  static scanFundTransferIntegrityMismatches(): FundTransferIntegrityMismatchRow[] {
    const WINDOW_MS = 15 * 60 * 1000;
    const transactions = this.getTransactions().filter((tx) => (
      tx.type === 'p2p_transfer'
      && tx.status === 'completed'
      && Math.abs(Number(tx.amount || 0)) > 0.009
    ));

    const debits: Array<{
      tx: Transaction;
      sender: User;
      recipient: User;
      amount: number;
      time: number;
    }> = [];
    const credits: Array<{
      tx: Transaction;
      sender: User;
      recipient: User;
      amount: number;
      time: number;
    }> = [];

    for (const tx of transactions) {
      const amount = Math.abs(Number(tx.amount || 0));
      if (!(amount > 0.009)) continue;

      if (Number(tx.amount || 0) < 0) {
        const sender = this.resolveUserByRef(tx.userId);
        const recipient = this.resolveUserByRef(tx.toUserId || '');
        if (!sender || !recipient) continue;
        if (sender.userId === recipient.userId) continue;
        debits.push({
          tx,
          sender,
          recipient,
          amount,
          time: this.getTransactionTime(tx)
        });
      } else {
        const recipient = this.resolveUserByRef(tx.userId);
        const sender = this.resolveUserByRef(tx.fromUserId || '');
        if (!sender || !recipient) continue;
        if (sender.userId === recipient.userId) continue;
        credits.push({
          tx,
          sender,
          recipient,
          amount,
          time: this.getTransactionTime(tx)
        });
      }
    }

    const mismatches: FundTransferIntegrityMismatchRow[] = [];
    const usedCreditIndices = new Set<number>();

    for (const debit of debits) {
      const candidateIndices = credits
        .map((credit, index) => ({ credit, index }))
        .filter(({ credit, index }) => {
          if (usedCreditIndices.has(index)) return false;
          if (credit.sender.userId !== debit.sender.userId) return false;
          if (credit.recipient.userId !== debit.recipient.userId) return false;
          if (Math.abs(credit.amount - debit.amount) > 0.009) return false;
          return Math.abs(credit.time - debit.time) <= WINDOW_MS;
        })
        .sort((a, b) => Math.abs(a.credit.time - debit.time) - Math.abs(b.credit.time - debit.time));

      if (candidateIndices.length === 0) {
        mismatches.push({
          id: `mismatch_missing_recipient_credit_${debit.tx.id}`,
          kind: 'missing_recipient_credit',
          senderUserId: debit.sender.userId,
          senderName: debit.sender.fullName,
          recipientUserId: debit.recipient.userId,
          recipientName: debit.recipient.fullName,
          amount: debit.amount,
          createdAt: debit.tx.completedAt || debit.tx.createdAt || new Date().toISOString(),
          debitTxId: debit.tx.id,
          note: 'Sender was debited but matching recipient credit was not found.'
        });
        continue;
      }

      const primary = candidateIndices[0];
      usedCreditIndices.add(primary.index);

      if (candidateIndices.length > 1) {
        for (const duplicate of candidateIndices.slice(1)) {
          usedCreditIndices.add(duplicate.index);
          mismatches.push({
            id: `mismatch_duplicate_credit_${duplicate.credit.tx.id}`,
            kind: 'duplicate_recipient_credit',
            senderUserId: debit.sender.userId,
            senderName: debit.sender.fullName,
            recipientUserId: debit.recipient.userId,
            recipientName: debit.recipient.fullName,
            amount: duplicate.credit.amount,
            createdAt: duplicate.credit.tx.completedAt || duplicate.credit.tx.createdAt || new Date().toISOString(),
            debitTxId: debit.tx.id,
            creditTxId: duplicate.credit.tx.id,
            matchedTxId: primary.credit.tx.id,
            note: 'Multiple recipient credits matched one sender debit.'
          });
        }
      }
    }

    for (let index = 0; index < credits.length; index += 1) {
      if (usedCreditIndices.has(index)) continue;
      const credit = credits[index];
      mismatches.push({
        id: `mismatch_missing_sender_debit_${credit.tx.id}`,
        kind: 'missing_sender_debit',
        senderUserId: credit.sender.userId,
        senderName: credit.sender.fullName,
        recipientUserId: credit.recipient.userId,
        recipientName: credit.recipient.fullName,
        amount: credit.amount,
        createdAt: credit.tx.completedAt || credit.tx.createdAt || new Date().toISOString(),
        creditTxId: credit.tx.id,
        note: 'Recipient was credited but matching sender debit was not found.'
      });
    }

    return mismatches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  static rerouteSafetyPooledLockedGiveHelpToUpline(userRef: string): {
    rerouted: number;
    scanned: number;
    examples: string[];
  } {
    const sender = this.resolveUserByRef(userRef);
    if (!sender) {
      throw new Error('User not found');
    }

    const transactions = this.getTransactions();
    const examples: string[] = [];
    let rerouted = 0;
    let scanned = 0;

    const candidateTxs = transactions
      .filter((tx) =>
        tx.userId === sender.id
        && tx.type === 'give_help'
        && tx.status === 'completed'
        && tx.amount < 0
        && !tx.toUserId
        && /from locked income/i.test(tx.description || '')
        && (/to safety pool/i.test(tx.description || '') || /to upline/i.test(tx.description || ''))
      )
      .sort((a, b) => this.getTransactionTime(a) - this.getTransactionTime(b));

    for (const giveTx of candidateTxs) {
      scanned += 1;
      const level = this.resolveTransactionLevel(giveTx);
      const amount = Math.abs(Number(giveTx.amount || 0));
      if (!level || amount <= 0.0001) continue;

      const recipient = this.findEligibleUplineForGiveHelp(sender, level);
      if (!recipient) {
        if (examples.length < 6) {
          examples.push(`No qualified upline found now for ${sender.userId} level ${level} $${amount.toFixed(2)}`);
        }
        continue;
      }

      const alreadySettled = transactions.some((receiveTx) =>
        this.isReceiveHelpSettlementForGiveTx(receiveTx, giveTx, recipient, sender)
      );
      if (alreadySettled) {
        if (examples.length < 6) {
          examples.push(`Already settled: ${sender.userId} -> ${recipient.userId} level ${level} $${amount.toFixed(2)}`);
        }
        continue;
      }

      const previousDescription = giveTx.description;
      const previousToUserId = giveTx.toUserId;
      const nextDescription = `Auto give help at level ${level} from locked income to ${recipient.fullName} (${recipient.userId})`;

      try {
        this.deductFromSafetyPool(
          amount,
          sender.id,
          `Re-routed safety-pooled locked give-help of ${sender.fullName} (${sender.userId}) to ${recipient.fullName} (${recipient.userId})`
        );

        giveTx.toUserId = recipient.id;
        giveTx.description = nextDescription;
        this.saveTransactions(transactions);

        const restored = this.restoreReceiveHelpFromGiveHelpTxId({
          recipientUserId: recipient.userId,
          giveHelpTxId: giveTx.id
        });

        if (!restored.created) {
          throw new Error('Matching receive-help entry already exists');
        }

        rerouted += 1;
        if (examples.length < 6) {
          examples.push(`Re-routed $${amount.toFixed(2)} from safety pool to ${recipient.fullName} (${recipient.userId})`);
        }
      } catch (error) {
        giveTx.toUserId = previousToUserId;
        giveTx.description = previousDescription;
        this.saveTransactions(transactions);

        try {
          this.addToSafetyPool(
            amount,
            sender.id,
            `Reverted failed reroute of locked give-help for ${sender.fullName} (${sender.userId})`
          );
        } catch {
          // Best effort rollback only.
        }

        if (examples.length < 6) {
          const message = error instanceof Error ? error.message : 'Unknown reroute failure';
          examples.push(`Failed to re-route $${amount.toFixed(2)} for ${sender.userId}: ${message}`);
        }
      }
    }

    return { rerouted, scanned, examples };
  }

  static getMaxTotalReceivedByPublicUserId(publicUserId: string): number {
    const cleanUserId = String(publicUserId || '').trim();
    if (!cleanUserId) return 0;

    const storedUsers = this.getUsers();
    const matchingInternalIds = new Set(
      storedUsers
        .filter((user) => (user.userId || '').trim() === cleanUserId)
        .map((user) => user.id)
        .filter(Boolean)
    );

    const canonicalUser = this.getUserByUserId(cleanUserId);
    if (canonicalUser?.id) {
      matchingInternalIds.add(canonicalUser.id);
    }

    if (matchingInternalIds.size === 0) {
      return 0;
    }

    const matchingWallets = this.getWallets().filter((wallet) => matchingInternalIds.has(wallet.userId));
    if (matchingWallets.length === 0) {
      return Math.max(
        0,
        ...Array.from(matchingInternalIds).map((internalId) => this.computeIncomeLedgerFromTransactions(internalId).totalReceived || 0)
      );
    }

    const storedMax = Math.max(...matchingWallets.map((wallet) => Number(wallet.totalReceived) || 0), 0);
    const computedMax = Math.max(
      0,
      ...Array.from(matchingInternalIds).map((internalId) => this.computeIncomeLedgerFromTransactions(internalId).totalReceived || 0)
    );

    return Math.max(storedMax, computedMax);
  }

  private static parseWithdrawalFee(description: string): number {
    if (!description) return 0;
    const match = description.match(/Fee:\s*\$([0-9]+(?:\.[0-9]+)?)/i);
    if (!match) return 0;
    const fee = Number(match[1]);
    return Number.isFinite(fee) ? fee : 0;
  }

  private static resolveTransactionLevel(tx: Transaction): number | null {
    const numericLevel = Number(tx.level);
    if (Number.isFinite(numericLevel) && numericLevel >= 1 && numericLevel <= helpDistributionTable.length) {
      return numericLevel;
    }

    const desc = tx.description || '';
    const levelMatch = desc.match(/\blevel\s+(\d+)\b/i);
    if (!levelMatch) return null;
    const parsedLevel = Number(levelMatch[1]);
    if (!Number.isFinite(parsedLevel) || parsedLevel < 1 || parsedLevel > helpDistributionTable.length) {
      return null;
    }
    return parsedLevel;
  }

  private static getLockedIncomeStrictCutoff(): number | null {
    const settings = this.getSettings();
    const raw = settings.lockedIncomeStrictFrom;
    if (!raw) return null;
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  private static shouldUseLegacyLockedConsumption(tx: Transaction): boolean {
    const cutoff = this.getLockedIncomeStrictCutoff();
    if (cutoff === null) return false;
    const raw = tx.completedAt || tx.createdAt || '';
    const parsed = new Date(raw).getTime();
    if (!Number.isFinite(parsed)) return false;
    return parsed < cutoff;
  }

  private static getLockedIncomeSourceLevel(tx: Transaction, resolvedLevel?: number | null): number {
    const explicitLevel = Number(resolvedLevel);
    const derivedLevel = this.resolveTransactionLevel(tx);
    const numericLevel = Number.isFinite(explicitLevel) ? explicitLevel : (derivedLevel ?? NaN);
    if (!Number.isFinite(numericLevel) || numericLevel <= 1) {
      return 1;
    }
    return Math.max(1, Math.floor(numericLevel) - 1);
  }

  private static computeLockedIncomeFromTransactions(userId: string): number {
    const txs = this.getTransactions()
      .filter((t) => t.userId === userId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    let locked = 0;
    for (const tx of txs) {
      const desc = (tx.description || '').toLowerCase();
      const effectiveLockedReceiveAmount = this.getUnsettledLockedReceiveEffectiveAmount(tx, txs);
      if (effectiveLockedReceiveAmount > 0) {
        locked += effectiveLockedReceiveAmount;
        continue;
      }
      if (tx.type === 'receive_help' && tx.amount > 0 && this.isReleasedLockedReceiveDescription(desc)) {
        locked -= tx.amount;
        continue;
      }
      if (tx.type === 'give_help' && desc.includes('from locked income')) {
        locked -= Math.abs(tx.amount);
      }
    }

    return Math.max(0, Math.round(locked * 100) / 100);
  }

  static repairLockedIncomeTrackerFromTransactions(userId: string): { updated: boolean; levels: number } {
    const tracker = this.getUserHelpTracker(userId);
    const txLevelMap = new Map<number, { firstTwo: number; qualification: number }>();

    const ensureTxLevel = (level: number) => {
      const existing = txLevelMap.get(level);
      if (existing) return existing;
      const created = { firstTwo: 0, qualification: 0 };
      txLevelMap.set(level, created);
      return created;
    };

    const consumeTxDerivedLockedAcrossLevels = (preferredLevel: number, amount: number, allowCrossLevel: boolean) => {
      let remaining = Math.max(0, amount);
      if (remaining <= 0) return;

      if (!allowCrossLevel) {
        const level = preferredLevel;
        const slot = ensureTxLevel(level);
        const usedQualification = Math.min(Math.max(0, slot.qualification), remaining);
        slot.qualification -= usedQualification;
        remaining -= usedQualification;

        if (remaining <= 0) return;
        const usedFirstTwo = Math.min(Math.max(0, slot.firstTwo), remaining);
        slot.firstTwo -= usedFirstTwo;
        return;
      }

      const levels = Array.from(txLevelMap.keys())
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= helpDistributionTable.length)
        .sort((a, b) => a - b);
      const ordered = levels.includes(preferredLevel)
        ? [preferredLevel, ...levels.filter((l) => l !== preferredLevel)]
        : levels;

      for (const level of ordered) {
        if (remaining <= 0) break;
        const slot = ensureTxLevel(level);
        const used = Math.min(Math.max(0, slot.qualification), remaining);
        slot.qualification -= used;
        remaining -= used;
      }
      for (const level of ordered) {
        if (remaining <= 0) break;
        const slot = ensureTxLevel(level);
        const used = Math.min(Math.max(0, slot.firstTwo), remaining);
        slot.firstTwo -= used;
        remaining -= used;
      }
    };

    const txs = this.getTransactions()
      .filter((t) => t.userId === userId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (const tx of txs) {
      const level = this.resolveTransactionLevel(tx);
      if (!level) continue;
      const desc = (tx.description || '').toLowerCase();
      const slot = ensureTxLevel(level);

      const effectiveLockedReceiveAmount = this.getUnsettledLockedReceiveEffectiveAmount(tx, txs);
      if (effectiveLockedReceiveAmount > 0) {
        if (this.isLockedFirstTwoReceiveDescription(desc)) {
          slot.firstTwo += effectiveLockedReceiveAmount;
        } else if (this.isLockedQualifiedReceiveDescription(desc)) {
          slot.qualification += effectiveLockedReceiveAmount;
        }
        continue;
      }
      if (tx.type === 'receive_help' && tx.amount > 0 && this.isReleasedLockedReceiveDescription(desc)) {
        slot.qualification -= tx.amount;
        continue;
      }

      if (tx.type === 'give_help' && desc.includes('from locked income')) {
        const allowCrossLevel = this.shouldUseLegacyLockedConsumption(tx);
        const sourceLevel = this.getLockedIncomeSourceLevel(tx, level);
        consumeTxDerivedLockedAcrossLevels(sourceLevel, Math.abs(tx.amount), allowCrossLevel);
      }
    }

    let updated = false;
    let levels = 0;
    const levelsToSync = new Set<number>([
      ...txLevelMap.keys(),
      ...Object.keys(tracker.levels || {})
        .map((key) => Number(key))
        .filter((level) => Number.isInteger(level) && level >= 1 && level <= helpDistributionTable.length)
    ]);
    for (const level of [...levelsToSync].sort((a, b) => a - b)) {
      const values = txLevelMap.get(level) || { firstTwo: 0, qualification: 0 };
      const state = this.ensureLevelTrackerState(tracker, level);
      const nextFirstTwo = Math.max(0, Math.round(values.firstTwo * 100) / 100);
      const nextQual = Math.max(0, Math.round(values.qualification * 100) / 100);
      const observedReceiveEvents = this.getObservedReceiveEventCount(userId, level);
      const changed = Math.abs(state.lockedAmount - nextFirstTwo) > 0.0001
        || Math.abs(state.lockedReceiveAmount - nextQual) > 0.0001
        || Math.abs((state.receiveEvents || 0) - observedReceiveEvents) > 0.0001;
      if (!changed) continue;
      state.lockedAmount = nextFirstTwo;
      state.lockedReceiveAmount = nextQual;
      state.receiveEvents = observedReceiveEvents;
      tracker.levels[String(level)] = state;
      updated = true;
      levels += 1;
    }

    if (updated) {
      this.saveUserHelpTracker(tracker);
    }

    return { updated, levels };
  }

  private static computeIncomeLedgerFromTransactions(userId: string): {
    incomeWallet: number;
    matrixWallet: number;
    totalReceived: number;
    totalGiven: number;
    relevantCount: number;
  } {
    const txs = this.getTransactions()
      .filter((t) => t.userId === userId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    let incomeWallet = 0;
    let matrixWallet = 0;
    let totalReceived = 0;
    let totalGiven = 0;
    let relevantCount = 0;

    for (const tx of txs) {
      const txDesc = (tx.description || '').toLowerCase();
      const isNonEarningCreditType =
        tx.type === 'activation'
        || tx.type === 'income_transfer'
        || tx.type === 'royalty_transfer'
        || tx.type === 'pin_used'
        || tx.type === 'pin_purchase'
        || tx.type === 'pin_transfer'
        || tx.type === 'deposit'
        || tx.type === 'p2p_transfer'
        || tx.type === 'reentry';
      const isIncomeWalletAdminCredit = tx.type !== 'admin_credit' || txDesc.includes('income wallet');

      const lifetimeCreditAmount = tx.type === 'receive_help'
        ? Math.abs((tx.displayAmount ?? tx.amount) || 0)
        : tx.amount;
      // Lifetime earnings: all positive credits that are actually earnings (not activation/fund/pin flows).
      if (lifetimeCreditAmount > 0 && !isNonEarningCreditType && isIncomeWalletAdminCredit) {
        totalReceived += lifetimeCreditAmount;
      }

      switch (tx.type) {
        case 'direct_income':
        case 'level_income':
          incomeWallet += tx.amount;
          matrixWallet += tx.amount;
          relevantCount += 1;
          break;
        case 'royalty_income':
          relevantCount += 1;
          break;
        case 'royalty_transfer':
          if (tx.amount > 0 && txDesc.includes('income wallet')) {
            incomeWallet += tx.amount;
          }
          relevantCount += 1;
          break;
        case 'receive_help': {
          const isLockedReceive = this.isLockedQualifiedReceiveDescription(txDesc)
            || this.isLockedFirstTwoReceiveDescription(txDesc);
          if (!isLockedReceive) {
            incomeWallet += tx.amount;
            matrixWallet += tx.amount;
          }
          relevantCount += 1;
          break;
        }
        case 'give_help':
          if (
            !txDesc.includes('from locked income')
            && !txDesc.includes('from matrix contribution')
          ) {
            if (tx.amount >= 0) {
              incomeWallet += tx.amount;
              matrixWallet += tx.amount;
            } else {
              const incomeOutflow = Math.min(Math.abs(tx.amount), Math.max(0, incomeWallet));
              const matrixOutflow = Math.min(Math.abs(tx.amount), Math.max(0, matrixWallet));
              incomeWallet -= incomeOutflow;
              matrixWallet -= matrixOutflow;
            }
          }
          totalGiven += Math.abs(tx.amount);
          relevantCount += 1;
          break;
        case 'safety_pool':
          if (tx.amount >= 0) {
            incomeWallet += tx.amount;
          } else {
            const safetyOutflow = Math.min(Math.abs(tx.amount), Math.max(0, incomeWallet));
            incomeWallet -= safetyOutflow;
          }
          relevantCount += 1;
          break;
        case 'withdrawal': {
          const fee = this.parseWithdrawalFee(tx.description || '');
          // Legacy records stored net amount as positive. New records store gross withdrawal as negative.
          const withdrawalOutflow = tx.amount < 0 ? Math.abs(tx.amount) : Math.abs(tx.amount) + fee;
          // Guard against incomplete legacy history creating artificial negative debt.
          const appliedOutflow = Math.min(withdrawalOutflow, Math.max(0, incomeWallet));
          incomeWallet -= appliedOutflow;
          relevantCount += 1;
          break;
        }
        case 'income_transfer':
          if (tx.amount >= 0) {
            incomeWallet += tx.amount;
          } else {
            const isUserInitiatedIncomeToFundTransfer = txDesc.includes('to your fund wallet')
              || txDesc.includes('to fund wallet of');
            const transferOutflow = isUserInitiatedIncomeToFundTransfer
              ? Math.abs(tx.amount)
              : Math.min(Math.abs(tx.amount), Math.max(0, incomeWallet));
            incomeWallet -= transferOutflow;
            totalGiven += Math.abs(tx.amount);
          }
          relevantCount += 1;
          break;
        case 'admin_credit':
          if (txDesc.includes('income wallet')) {
            incomeWallet += tx.amount;
            relevantCount += 1;
          }
          break;
        case 'admin_debit':
          if (txDesc.includes('income wallet')) {
            const debitOutflow = Math.min(Math.abs(tx.amount), Math.max(0, incomeWallet));
            incomeWallet -= debitOutflow;
            totalGiven += Math.abs(tx.amount);
            relevantCount += 1;
          }
          break;
        case 'fund_recovery':
          if (txDesc.includes('income wallet')) {
            const recoveryOutflow = Math.min(Math.abs(tx.amount), Math.max(0, incomeWallet));
            incomeWallet -= recoveryOutflow;
            relevantCount += 1;
          }
          break;
        case 'system_fee':
          if (txDesc.includes('income wallet')) {
            const feeOutflow = Math.min(Math.abs(tx.amount), Math.max(0, incomeWallet));
            incomeWallet -= feeOutflow;
          }
          relevantCount += 1;
          break;
        default:
          break;
      }
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    return {
      incomeWallet: Math.max(0, round2(incomeWallet)),
      matrixWallet: Math.max(0, round2(matrixWallet)),
      totalReceived: Math.max(0, round2(totalReceived)),
      totalGiven: Math.max(0, round2(totalGiven)),
      relevantCount
    };
  }

  static repairIncomeWalletConsistency(userId?: string): {
    scanned: number;
    repaired: number;
  } {
    const wallets = this.getWallets();
    const targetIds = userId ? new Set([userId]) : new Set(wallets.map((w) => w.userId));
    let repaired = 0;

    for (const wallet of wallets) {
      if (!targetIds.has(wallet.userId)) continue;
      const computed = this.computeIncomeLedgerFromTransactions(wallet.userId);
      if (computed.relevantCount === 0) continue;

      const incomeDiff = Math.abs((wallet.incomeWallet || 0) - computed.incomeWallet);
      const matrixDiff = Math.abs((wallet.matrixWallet || 0) - computed.matrixWallet);
      const receivedDiff = Math.abs((wallet.totalReceived || 0) - computed.totalReceived);
      const givenDiff = Math.abs((wallet.totalGiven || 0) - computed.totalGiven);
      if (incomeDiff <= 0.0001 && matrixDiff <= 0.0001 && receivedDiff <= 0.0001 && givenDiff <= 0.0001) continue;
      this.updateWallet(wallet.userId, {
        incomeWallet: computed.incomeWallet,
        matrixWallet: computed.matrixWallet,
        totalReceived: computed.totalReceived,
        totalGiven: computed.totalGiven
      });
      repaired += 1;
    }

    if (repaired > 0) {
      this.saveWallets(wallets);
    }

    return { scanned: targetIds.size, repaired };
  }

  static repairFundWalletConsistency(userId?: string): {
    scanned: number;
    repaired: number;
  } {
    const wallets = this.getWallets();
    const targetIds = userId ? new Set([userId]) : new Set(wallets.map((w) => w.userId));
    let repaired = 0;

    for (const wallet of wallets) {
      if (!targetIds.has(wallet.userId)) continue;
      const computed = this.computeFundWalletFromTransactionsForUserIds(new Set([wallet.userId]));
      if (computed.relevantCount === 0) continue;
      if (Math.abs((wallet.depositWallet || 0) - computed.balance) <= 0.0001) continue;
      this.updateWallet(wallet.userId, {
        depositWallet: computed.balance
      });
      repaired += 1;
    }

    if (repaired > 0) {
      this.saveWallets(wallets);
    }

    return { scanned: targetIds.size, repaired };
  }

  static repairRoyaltyWalletConsistency(userId?: string): {
    scanned: number;
    repaired: number;
  } {
    const wallets = this.getWallets();
    const targetIds = userId ? new Set([userId]) : new Set(wallets.map((w) => w.userId));
    let repaired = 0;

    const computeRoyaltyWalletFromTransactions = (targetUserId: string): { balance: number; relevantCount: number } => {
      const txs = this.getTransactions()
        .filter((t) => t.userId === targetUserId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      let balance = 0;
      let relevantCount = 0;

      for (const tx of txs) {
        if (tx.status !== 'completed') continue;

        if (tx.type === 'royalty_income') {
          balance += Number(tx.amount || 0);
          relevantCount += 1;
          continue;
        }

        if (tx.type === 'royalty_transfer' && Number(tx.amount || 0) < 0) {
          balance -= Math.abs(Number(tx.amount || 0));
          relevantCount += 1;
          continue;
        }

        if (tx.type === 'admin_debit' && String(tx.description || '').toLowerCase().includes('royalty wallet')) {
          balance -= Math.abs(Number(tx.amount || 0));
          relevantCount += 1;
        }
      }

      return {
        balance: Math.max(0, Math.round(balance * 100) / 100),
        relevantCount
      };
    };

    for (const wallet of wallets) {
      if (!targetIds.has(wallet.userId)) continue;
      const computed = computeRoyaltyWalletFromTransactions(wallet.userId);
      if (computed.relevantCount === 0) continue;
      if (Math.abs((wallet.royaltyWallet || 0) - computed.balance) <= 0.0001) continue;
      wallet.royaltyWallet = computed.balance;
      repaired += 1;
    }

    if (repaired > 0) {
      this.saveWallets(wallets);
    }

    return { scanned: targetIds.size, repaired };
  }

  static repairGhostReceiveHelpTransactions(userId?: string): {
    scanned: number;
    repaired: number;
    affectedUsers: number;
  } {
    const transactions = this.getTransactions();
    const scopedRecipient = userId ? this.resolveUserByRef(userId) : undefined;
    const affectedUserIds = new Set<string>();
    const logs = this.getGhostReceiveHelpRepairLogs();
    let repaired = 0;
    let scanned = 0;
    const auditEntries: Array<{
      recipientId: string;
      recipientUserId: string;
      recipientName: string;
      amount: number;
      level: number;
      sourceLabel: string;
      originalTxId: string;
      reason: string;
    }> = [];

    const parseSourceLabelFromDescription = (description: string): string => {
      const fromMatch = String(description || '').match(/from\s+(.+?)\s*\((\d{7})\)/i);
      if (fromMatch) {
        return `${fromMatch[1].trim()} (${fromMatch[2]})`;
      }
      const anyId = String(description || '').match(/\b(\d{7})\b/);
      if (anyId) {
        return `Unknown (${anyId[1]})`;
      }
      return 'Unknown (N/A)';
    };

    for (const tx of transactions) {
      if (scopedRecipient && !this.transactionRefMatchesUser(tx.userId, scopedRecipient)) continue;
      if (tx.type !== 'receive_help') continue;
      if (!(tx.amount > 0)) continue;
      scanned += 1;
      const sender = tx.fromUserId ? this.resolveUserByRef(tx.fromUserId) : undefined;
      const recipient = this.resolveUserByRef(tx.userId);
      const txLevel = this.resolveTransactionLevel(tx) || Number(tx.level) || 0;
      const senderMissing = !sender;
      const senderOutOfTree = !senderMissing
        && !!recipient
        && txLevel > 0
        && !this.isValidMatrixSenderForRecipientLevel(recipient, sender, txLevel);

      if (senderMissing || senderOutOfTree) {
        const originalDesc = tx.description || '';
        const originalAmount = tx.amount;
        tx.amount = 0;
        tx.status = 'reversed';
        const reason = senderMissing
          ? 'missing sender'
          : `sender is not in recipient matrix at level ${txLevel}`;
        tx.description = `Reversed ghost receive help (${reason}). ${originalDesc}`.trim();
        logs.push({
          id: generateEventId('repair', 'ghost_receive_help'),
          createdAt: new Date().toISOString(),
          txId: tx.id,
          userId: tx.userId,
          userPublicId: recipient?.userId || '',
          amount: originalAmount,
          reason: senderMissing
            ? 'Missing or invalid sender'
            : `Sender-recipient matrix mismatch at level ${txLevel}`,
          originalDescription: originalDesc
        });
        if (recipient?.id) {
          affectedUserIds.add(recipient.id);
          auditEntries.push({
            recipientId: recipient.id,
            recipientUserId: recipient.userId,
            recipientName: recipient.fullName,
            amount: Math.abs(Number(originalAmount || 0)),
            level: txLevel,
            sourceLabel: sender
              ? `${sender.fullName} (${sender.userId})`
              : parseSourceLabelFromDescription(originalDesc),
            originalTxId: tx.id,
            reason: senderMissing
              ? 'Missing sender record'
              : `Sender-recipient matrix mismatch at level ${txLevel}`
          });
        }
        repaired += 1;
      }
    }

    if (repaired > 0) {
      this.saveTransactions(transactions);
      this.saveGhostReceiveHelpRepairLogs(logs);

      for (const audit of auditEntries) {
        this.createTransaction({
          id: generateEventId('tx', 'ghost_receive_reversal_audit'),
          userId: audit.recipientId,
          type: 'admin_debit',
          amount: 0,
          status: 'completed',
          description: `System reversal audit: reversed invalid receive-help credit of $${audit.amount.toFixed(2)} at level ${audit.level} for ${audit.recipientName} (${audit.recipientUserId}). Source: ${audit.sourceLabel}. Reason: ${audit.reason}. Original Tx: ${audit.originalTxId}`,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          adminReason: 'ghost_receive_help_reversal_audit'
        });
      }

      for (const userId of affectedUserIds) {
        this.repairLockedIncomeTrackerFromTransactions(userId);
        this.repairIncomeWalletConsistency(userId);
        this.syncLockedIncomeWallet(userId);

        const tracker = this.getUserHelpTracker(userId);
        const giveHelpLocked = Object.values(tracker.levels).reduce(
          (sum, state) => sum + (state.lockedAmount || 0),
          0
        );
        const wallet = this.getWallet(userId);
        if (wallet) {
          this.updateWallet(userId, {
            giveHelpLocked: Math.max(0, Math.round(giveHelpLocked * 100) / 100)
          });
        }
      }
    }

    return { scanned, repaired, affectedUsers: affectedUserIds.size };
  }

  static restoreMissingReceiveHelpFromUserId(params: {
    recipientUserId: string;
    fromUserId: string;
    level?: number;
  }): { created: boolean; description?: string } {
    const recipientPublicId = String(params.recipientUserId || '').replace(/\D/g, '').slice(0, 7);
    const fromPublicId = String(params.fromUserId || '').replace(/\D/g, '').slice(0, 7);
    if (recipientPublicId.length !== 7 || fromPublicId.length !== 7) {
      throw new Error('Enter valid 7-digit User IDs');
    }
    const recipient = this.getUserByUserId(recipientPublicId);
    if (!recipient) throw new Error('Recipient user not found');
    const sender = this.getUserByUserId(fromPublicId);
    if (!sender) throw new Error('Sender user not found');

    let level: number;
    if (Number.isFinite(params.level)) {
      const parsedLevel = Number(params.level);
      if (!Number.isFinite(parsedLevel) || parsedLevel < 1 || parsedLevel > helpDistributionTable.length) {
        throw new Error('Unable to detect level. Enter level manually.');
      }
      level = parsedLevel;
    } else {
      const detectedLevel = this.getMatrixDepthBetween(recipient.userId, sender.userId);
      if (
        detectedLevel === null
        || !Number.isFinite(detectedLevel)
        || detectedLevel < 1
        || detectedLevel > helpDistributionTable.length
      ) {
        throw new Error('Unable to detect level. Enter level manually.');
      }
      level = detectedLevel;
    }

    if (!this.isValidMatrixSenderForRecipientLevel(recipient, sender, level)) {
      throw new Error(`Sender is not in recipient matrix at level ${level}`);
    }

    const amount = helpDistributionTable[level - 1]?.perUserHelp || 0;
    const toTime = (tx: Transaction): number => {
      const raw = tx.completedAt || tx.createdAt || '';
      const n = new Date(raw).getTime();
      return Number.isFinite(n) ? n : 0;
    };
    const MATCH_WINDOW_MS = 10 * 60 * 1000;
    const allTransactions = this.getTransactions();
    const relevantGiveTxs = allTransactions
      .filter((tx) =>
        this.transactionRefMatchesUser(tx.userId, sender)
        && tx.type === 'give_help'
        && tx.status === 'completed'
        && this.resolveTransactionLevel(tx) === level
        && Math.abs(tx.amount || 0) === amount
        && this.giveHelpTargetsUser(tx, recipient)
      )
      .sort((a, b) => toTime(a) - toTime(b));

    const relevantReceiveTxs = allTransactions
      .filter((tx) =>
        this.transactionRefMatchesUser(tx.userId, recipient)
        && tx.type === 'receive_help'
        && tx.status === 'completed'
        && Number(tx.level) === level
        && tx.amount > 0
        && this.transactionRefMatchesUser(tx.fromUserId, sender)
        && Math.abs(tx.amount || 0) === amount
      )
      .sort((a, b) => toTime(a) - toTime(b));

    const usedReceiveIds = new Set<string>();
    let unmatchedGiveTx: Transaction | undefined;
    for (const giveTx of relevantGiveTxs) {
      const giveTime = toTime(giveTx);
      const matchingReceive = relevantReceiveTxs.find((tx) => {
        if (usedReceiveIds.has(tx.id)) return false;
        return Math.abs(toTime(tx) - giveTime) <= MATCH_WINDOW_MS;
      });
      if (matchingReceive) {
        usedReceiveIds.add(matchingReceive.id);
        continue;
      }
      unmatchedGiveTx = giveTx;
      break;
    }

    if (!unmatchedGiveTx) {
      if (relevantReceiveTxs.length > 0) return { created: false };
      throw new Error('No matching give-help debit found for this sender, recipient, and level.');
    }

    const fromSuffix = ` from ${sender.fullName} (${sender.userId})`;
    const lockedFirstTwoCount = this.getLockedFirstTwoReceiveCount(recipient.id, level);
    const description = lockedFirstTwoCount < 2
      ? `Locked first-two help at level ${level}${fromSuffix}`
      : (
        this.isQualifiedForLevel(recipient, level)
          ? `Received help at level ${level}${fromSuffix}`
          : `Locked receive help at level ${level}${fromSuffix}`
      );

    this.createTransaction({
      id: generateEventId('tx', `restore_receive_l${level}`),
      userId: recipient.id,
      type: 'receive_help',
      amount,
      fromUserId: sender.id,
      level,
      status: 'completed',
      description,
      sourceGiveHelpTxId: unmatchedGiveTx.id,
      createdAt: unmatchedGiveTx?.completedAt || unmatchedGiveTx?.createdAt || new Date().toISOString(),
      completedAt: unmatchedGiveTx?.completedAt || unmatchedGiveTx?.createdAt || new Date().toISOString()
    });

    this.repairLockedIncomeTrackerFromTransactions(recipient.id);
    this.repairIncomeWalletConsistency(recipient.id);
    this.syncLockedIncomeWallet(recipient.id);

    return { created: true, description };
  }

  static restoreReceiveHelpHistoryOnly(params: {
    recipientUserId: string;
    fromUserId: string;
    level?: number;
  }): { created: boolean; description?: string } {
    const recipientPublicId = String(params.recipientUserId || '').replace(/\D/g, '').slice(0, 7);
    const fromPublicId = String(params.fromUserId || '').replace(/\D/g, '').slice(0, 7);
    if (recipientPublicId.length !== 7 || fromPublicId.length !== 7) {
      throw new Error('Enter valid 7-digit User IDs');
    }
    const recipient = this.getUserByUserId(recipientPublicId);
    if (!recipient) throw new Error('Recipient user not found');
    const sender = this.getUserByUserId(fromPublicId);
    if (!sender) throw new Error('Sender user not found');

    let level: number;
    if (Number.isFinite(params.level)) {
      const parsedLevel = Number(params.level);
      if (!Number.isFinite(parsedLevel) || parsedLevel < 1 || parsedLevel > helpDistributionTable.length) {
        throw new Error('Unable to detect level. Enter level manually.');
      }
      level = parsedLevel;
    } else {
      const detectedLevel = this.getMatrixDepthBetween(recipient.userId, sender.userId);
      if (
        detectedLevel === null
        || !Number.isFinite(detectedLevel)
        || detectedLevel < 1
        || detectedLevel > helpDistributionTable.length
      ) {
        throw new Error('Unable to detect level. Enter level manually.');
      }
      level = detectedLevel;
    }

    if (!this.isValidMatrixSenderForRecipientLevel(recipient, sender, level)) {
      throw new Error(`Sender is not in recipient matrix at level ${level}`);
    }

    const fromSuffix = ` from ${sender.fullName} (${sender.userId})`;
    const displayAmount = helpDistributionTable[level - 1]?.perUserHelp || 0;
    const toTime = (tx: Transaction): number => {
      const raw = tx.completedAt || tx.createdAt || '';
      const n = new Date(raw).getTime();
      return Number.isFinite(n) ? n : 0;
    };
    const MATCH_WINDOW_MS = 10 * 60 * 1000;
    const allTransactions = this.getTransactions();
    const relevantGiveTxs = allTransactions
      .filter((tx) =>
        this.transactionRefMatchesUser(tx.userId, sender)
        && tx.type === 'give_help'
        && tx.status === 'completed'
        && this.resolveTransactionLevel(tx) === level
        && Math.abs(tx.amount || 0) === displayAmount
        && this.giveHelpTargetsUser(tx, recipient)
      )
      .sort((a, b) => toTime(a) - toTime(b));

    const relevantReceiveTxs = allTransactions
      .filter((tx) =>
        this.transactionRefMatchesUser(tx.userId, recipient)
        && tx.type === 'receive_help'
        && tx.status === 'completed'
        && Number(tx.level) === level
        && this.transactionRefMatchesUser(tx.fromUserId, sender)
        && Math.abs((tx.displayAmount ?? tx.amount) || 0) === displayAmount
      )
      .sort((a, b) => toTime(a) - toTime(b));

    const usedReceiveIds = new Set<string>();
    let unmatchedGiveTx: Transaction | undefined;
    for (const giveTx of relevantGiveTxs) {
      const giveTime = toTime(giveTx);
      const matchingReceive = relevantReceiveTxs.find((tx) => {
        if (usedReceiveIds.has(tx.id)) return false;
        return Math.abs(toTime(tx) - giveTime) <= MATCH_WINDOW_MS;
      });
      if (matchingReceive) {
        usedReceiveIds.add(matchingReceive.id);
        continue;
      }
      unmatchedGiveTx = giveTx;
      break;
    }

    if (!unmatchedGiveTx) {
      if (relevantReceiveTxs.length > 0) return { created: false };
      throw new Error('No matching give-help debit found for this sender, recipient, and level.');
    }

    const description = `Received help at level ${level}${fromSuffix}`;

    this.createTransaction({
      id: generateEventId('tx', `history_receive_l${level}`),
      userId: recipient.id,
      type: 'receive_help',
      amount: 0,
      displayAmount,
      fromUserId: sender.id,
      level,
      status: 'completed',
      description,
      sourceGiveHelpTxId: unmatchedGiveTx.id,
      createdAt: unmatchedGiveTx?.completedAt || unmatchedGiveTx?.createdAt || new Date().toISOString(),
      completedAt: unmatchedGiveTx?.completedAt || unmatchedGiveTx?.createdAt || new Date().toISOString()
    });

    return { created: true, description };
  }

  static manualAdminReceiveHelpCredit(params: {
    recipientUserId: string;
    fromUserId: string;
    level: number;
    amount?: number;
  }): { created: boolean; description: string } {
    const recipientPublicId = String(params.recipientUserId || '').replace(/\D/g, '').slice(0, 7);
    const fromPublicId = String(params.fromUserId || '').replace(/\D/g, '').slice(0, 7);
    if (recipientPublicId.length !== 7 || fromPublicId.length !== 7) {
      throw new Error('Enter valid 7-digit User IDs');
    }

    const recipient = this.getUserByUserId(recipientPublicId);
    if (!recipient) throw new Error('Recipient user not found');
    const sender = this.getUserByUserId(fromPublicId);
    if (!sender) throw new Error('Sender user not found');

    const level = Number(params.level);
    if (!Number.isFinite(level) || level < 1 || level > helpDistributionTable.length) {
      throw new Error('Enter a valid level number');
    }

    const amount = Number(params.amount || helpDistributionTable[level - 1]?.perUserHelp || 0);
    if (!(amount > 0)) {
      throw new Error('Unable to determine valid help amount for this level');
    }

    const fromSuffix = ` from ${sender.fullName} (${sender.userId})`;
    const lockedFirstTwoCount = this.getLockedFirstTwoReceiveCount(recipient.id, level);
    const requiredDirect = this.getCumulativeDirectRequired(level);
    const currentDirect = this.getEffectiveDirectCount(recipient);
    const baseDescription = lockedFirstTwoCount < 2
      ? `Locked first-two help at level ${level}${fromSuffix}`
      : (
        this.isQualifiedForLevel(recipient, level)
          ? `Received help at level ${level}${fromSuffix}`
          : `Locked receive help at level ${level}${fromSuffix} (requires ${requiredDirect} direct, current ${currentDirect})`
      );
    const description = `${baseDescription} [Manual admin recovery]`;

    this.createTransaction({
      id: generateEventId('tx', `manual_receive_l${level}`),
      userId: recipient.id,
      type: 'receive_help',
      amount,
      fromUserId: sender.id,
      level,
      status: 'completed',
      description,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    });

    this.repairLockedIncomeTrackerFromTransactions(recipient.id);
    this.repairIncomeWalletConsistency(recipient.id);
    this.syncLockedIncomeWallet(recipient.id);

    return { created: true, description };
  }

  static repairMissingSelfFundCredits(userId?: string): {
    repaired: number;
    examples: string[];
  } {
    const transactions = this.getTransactions();
    const examples: string[] = [];
    const targetUserIds = userId ? new Set([userId]) : null;
    const walletCreditByUserId = new Map<string, number>();
    let changed = false;
    let repaired = 0;

    const isScoped = (tx: Transaction) => !targetUserIds || targetUserIds.has(tx.userId);
    const timeOf = (tx: Transaction) => this.getTransactionTime(tx);
    const MATCH_WINDOW_MS = 10 * 60 * 1000;

    for (const tx of transactions) {
      if (!isScoped(tx)) continue;
      if (tx.type !== 'income_transfer' || tx.status !== 'completed' || !(tx.amount < 0)) continue;

      const user = this.getUserById(tx.userId);
      if (!user) continue;
      const isSelfTransfer = this.transactionRefMatchesUser(tx.toUserId, user)
        || (tx.description || '').toLowerCase().includes('to your fund wallet');
      if (!isSelfTransfer) continue;

      const amount = Math.abs(tx.amount || 0);
      if (!(amount > 0)) continue;

      const existingCredit = transactions.some((creditTx) =>
        creditTx.userId === tx.userId
        && creditTx.type === 'p2p_transfer'
        && creditTx.status === 'completed'
        && Math.abs((creditTx.displayAmount ?? creditTx.amount) || 0) === amount
        && (
          creditTx.sourceTransferTxId === tx.id
          || (
            (creditTx.description || '').toLowerCase().includes('income wallet transfer')
            && Math.abs(timeOf(creditTx) - timeOf(tx)) <= MATCH_WINDOW_MS
          )
        )
      );
      if (existingCredit) continue;

      const timestamp = tx.completedAt || tx.createdAt || new Date().toISOString();
      transactions.push(this.normalizeTransactionRecord({
        id: generateEventId('tx', 'repair_self_fund_credit'),
        userId: tx.userId,
        type: 'p2p_transfer',
        amount,
        fromUserId: tx.userId,
        toUserId: tx.userId,
        sourceTransferTxId: tx.id,
        status: 'completed',
        description: 'Fund wallet credited from your income wallet transfer',
        createdAt: timestamp,
        completedAt: timestamp
      } as Transaction));
      walletCreditByUserId.set(tx.userId, (walletCreditByUserId.get(tx.userId) || 0) + amount);
      if (examples.length < 8) {
        examples.push(`${user.userId}: repaired self fund credit $${amount.toFixed(2)} from transfer ${tx.id}`);
      }
      repaired += 1;
      changed = true;
    }

    if (!changed) {
      if (userId) {
        this.repairFundWalletConsistency(userId);
      }
      return { repaired: 0, examples };
    }

    this.saveTransactions(transactions);
    for (const [targetId, totalCredit] of walletCreditByUserId.entries()) {
      const wallet = this.getWallet(targetId);
      if (!wallet) continue;
      this.updateWallet(targetId, {
        depositWallet: Math.round(((wallet.depositWallet || 0) + totalCredit) * 100) / 100
      });
      this.repairFundWalletConsistency(targetId);
    }

    return { repaired, examples };
  }

  static repairMissingP2PTransferDebits(userRef?: string): {
    repaired: number;
    examples: string[];
  } {
    const targetUser = userRef
      ? (this.getUserById(userRef) || this.getUserByUserId(userRef))
      : null;

    if (userRef && !targetUser) {
      throw new Error('User not found');
    }

    const targetUserIds = targetUser ? new Set(this.getRelatedInternalUserIdsForUserRef(targetUser.id)) : null;
    const transactions = this.getTransactions();
    const MATCH_WINDOW_MS = 15 * 60 * 1000;
    const createdTransactions: Transaction[] = [];
    const touchedSenderIds = new Set<string>();
    const examples: string[] = [];

    const credits = transactions
      .filter((tx) => tx.type === 'p2p_transfer' && tx.status === 'completed' && tx.amount > 0)
      .sort((a, b) => this.getTransactionTime(a) - this.getTransactionTime(b));

    for (const creditTx of credits) {
      const recipient = this.resolveUserByRef(creditTx.userId);
      const sender = creditTx.fromUserId ? this.resolveUserByRef(creditTx.fromUserId) : undefined;
      if (!recipient || !sender) continue;

      // Ignore self credits (e.g., income->fund / royalty->fund self moves).
      if (recipient.id === sender.id) continue;

      if (targetUserIds && !targetUserIds.has(recipient.id) && !targetUserIds.has(sender.id)) {
        continue;
      }

      const amount = Math.abs(Number(creditTx.amount || 0));
      if (!(amount > 0)) continue;

      const creditTime = this.getTransactionTime(creditTx);
      const hasSenderDebit = transactions.some((candidate) => {
        if (candidate.type !== 'p2p_transfer' || candidate.status !== 'completed' || !(candidate.amount < 0)) return false;
        if (!this.transactionRefMatchesUser(candidate.userId, sender)) return false;
        if (Math.abs(Math.abs(Number(candidate.amount || 0)) - amount) > 0.009) return false;

        const candidateTargetsRecipient = this.transactionRefMatchesUser(candidate.toUserId, recipient)
          || this.transactionRefMatchesUser(candidate.toUserId, this.getUserByUserId(recipient.userId));
        if (!candidateTargetsRecipient) return false;

        if (creditTx.sourceTransferTxId && candidate.id === creditTx.sourceTransferTxId) return true;

        return Math.abs(this.getTransactionTime(candidate) - creditTime) <= MATCH_WINDOW_MS;
      });

      if (hasSenderDebit) continue;

      createdTransactions.push(this.normalizeTransactionRecord({
        id: generateEventId('tx', 'repair_missing_p2p_debit'),
        userId: sender.id,
        type: 'p2p_transfer',
        amount: -amount,
        toUserId: recipient.id,
        fromUserId: sender.id,
        status: 'completed',
        description: `Recovered missing fund wallet transfer debit to ${recipient.fullName} (${recipient.userId})`,
        createdAt: creditTx.completedAt || creditTx.createdAt || new Date().toISOString(),
        completedAt: creditTx.completedAt || creditTx.createdAt || new Date().toISOString()
      } as Transaction));
      touchedSenderIds.add(sender.id);

      if (examples.length < 10) {
        examples.push(`${sender.userId}: recovered missing transfer debit of $${amount.toFixed(2)} to ${recipient.userId}`);
      }
    }

    if (createdTransactions.length === 0) {
      return { repaired: 0, examples };
    }

    this.saveTransactions([...transactions, ...createdTransactions]);
    for (const senderId of touchedSenderIds) {
      this.repairFundWalletConsistency(senderId);
    }

    return { repaired: createdTransactions.length, examples };
  }

  static reconcileAllFinancialLedgers(userRef?: string): {
    depositsRecovered: number;
    pinPurchasesRecovered: number;
    p2pDebitsRecovered: number;
    selfFundCreditsRepaired: number;
    brokenSelfTransfersRemoved: number;
    fundWalletsRepaired: number;
    incomeWalletsRepaired: number;
    royaltyWalletsRepaired: number;
    examples: string[];
  } {
    const targetUser = userRef
      ? (this.getUserById(userRef) || this.getUserByUserId(userRef))
      : null;

    if (userRef && !targetUser) {
      throw new Error('User not found');
    }

    const scopeRef = targetUser?.id;
    const paymentAndPin = this.recoverMissingPaymentAndPinTransactions(scopeRef);
    const p2p = this.repairMissingP2PTransferDebits(scopeRef);
    const selfFund = this.repairMissingSelfFundCredits(scopeRef);
    const brokenSelf = this.removeBrokenSelfIncomeToFundTransfer(scopeRef);

    const fund = targetUser
      ? this.repairFundWalletConsistency(targetUser.id)
      : this.repairFundWalletConsistency();
    const income = targetUser
      ? this.repairIncomeWalletConsistency(targetUser.id)
      : this.repairIncomeWalletConsistency();
    const royalty = targetUser
      ? this.repairRoyaltyWalletConsistency(targetUser.id)
      : this.repairRoyaltyWalletConsistency();

    return {
      depositsRecovered: paymentAndPin.depositsCreated,
      pinPurchasesRecovered: paymentAndPin.pinPurchasesCreated,
      p2pDebitsRecovered: p2p.repaired,
      selfFundCreditsRepaired: selfFund.repaired,
      brokenSelfTransfersRemoved: brokenSelf.removed,
      fundWalletsRepaired: fund.repaired,
      incomeWalletsRepaired: income.repaired,
      royaltyWalletsRepaired: royalty.repaired,
      examples: [
        ...paymentAndPin.examples,
        ...p2p.examples,
        ...selfFund.examples,
        ...brokenSelf.examples
      ].slice(0, 20)
    };
  }

  static resyncWalletLedgersFromHistory(userRef?: string): {
    usersScoped: number;
    usersTrackersUpdated: number;
    depositsRecovered: number;
    pinPurchasesRecovered: number;
    fundWalletsRepaired: number;
    incomeWalletsRepaired: number;
    royaltyWalletsRepaired: number;
    lockedIncomeWalletsSynced: number;
  } {
    const targetUser = userRef
      ? (this.getUserById(userRef) || this.getUserByUserId(userRef))
      : null;

    if (userRef && !targetUser) {
      throw new Error('User not found');
    }

    const scopedUsers = targetUser ? [targetUser] : this.getUsers();
    const scopeRef = targetUser?.id;

    const recovered = this.recoverMissingPaymentAndPinTransactions(scopeRef);

    let usersTrackersUpdated = 0;
    for (const user of scopedUsers) {
      const tracker = this.repairLockedIncomeTrackerFromTransactions(user.id);
      if (tracker.updated) {
        usersTrackersUpdated += 1;
      }
    }

    const fund = targetUser
      ? this.repairFundWalletConsistency(targetUser.id)
      : this.repairFundWalletConsistency();
    const income = targetUser
      ? this.repairIncomeWalletConsistency(targetUser.id)
      : this.repairIncomeWalletConsistency();
    const royalty = targetUser
      ? this.repairRoyaltyWalletConsistency(targetUser.id)
      : this.repairRoyaltyWalletConsistency();
    const locked = targetUser
      ? this.syncLockedIncomeWallet(targetUser.id)
      : this.syncLockedIncomeWallet();

    // Keep giveHelpLocked aligned with tracker after wallet rebuild.
    for (const user of scopedUsers) {
      const tracker = this.getUserHelpTracker(user.id);
      const giveHelpLocked = Object.values(tracker.levels).reduce(
        (sum, state) => sum + (state.lockedAmount || 0),
        0
      );
      const wallet = this.getWallet(user.id);
      if (!wallet) continue;

      const nextGiveHelpLocked = Math.max(0, Math.round(giveHelpLocked * 100) / 100);
      if (Math.abs((wallet.giveHelpLocked || 0) - nextGiveHelpLocked) > 0.0001) {
        this.updateWallet(user.id, {
          giveHelpLocked: nextGiveHelpLocked
        });
      }
    }

    return {
      usersScoped: scopedUsers.length,
      usersTrackersUpdated,
      depositsRecovered: recovered.depositsCreated,
      pinPurchasesRecovered: recovered.pinPurchasesCreated,
      fundWalletsRepaired: fund.repaired,
      incomeWalletsRepaired: income.repaired,
      royaltyWalletsRepaired: royalty.repaired,
      lockedIncomeWalletsSynced: locked.synced
    };
  }

  static recoverMissingPaymentAndPinTransactions(userRef?: string): {
    depositsCreated: number;
    pinPurchasesCreated: number;
    examples: string[];
  } {
    const targetUser = userRef
      ? (this.getUserById(userRef) || this.getUserByUserId(userRef))
      : null;

    if (userRef && !targetUser) {
      throw new Error('User not found');
    }

    const targetUserIds = targetUser ? new Set([targetUser.id]) : null;
    const transactions = this.getTransactions();
    const examples: string[] = [];
    const createdTransactions: Transaction[] = [];
    const MATCH_WINDOW_MS = 15 * 60 * 1000;
    let depositsCreated = 0;
    let pinPurchasesCreated = 0;

    const isScopedUser = (id: string) => !targetUserIds || targetUserIds.has(id);

    for (const payment of this.getPayments()) {
      if (!isScopedUser(payment.userId) || payment.status !== 'completed') continue;

      const recoveryTxId = `tx_recover_deposit_${payment.id}`;
      const paymentTime = new Date(payment.verifiedAt || payment.createdAt || 0).getTime();
      const hasExisting = transactions.some((tx) =>
        tx.id === recoveryTxId
        || (
          tx.userId === payment.userId
          && tx.type === 'deposit'
          && tx.status === 'completed'
          && Number(tx.amount || 0) === Number(payment.amount || 0)
          && (tx.description || '') === `Deposit via ${payment.methodName}`
          && Math.abs(this.getTransactionTime(tx) - paymentTime) <= MATCH_WINDOW_MS
        )
      );
      if (hasExisting) continue;

      createdTransactions.push(this.normalizeTransactionRecord({
        id: recoveryTxId,
        userId: payment.userId,
        type: 'deposit',
        amount: payment.amount,
        status: 'completed',
        description: `Deposit via ${payment.methodName}`,
        createdAt: payment.verifiedAt || payment.createdAt || new Date().toISOString(),
        completedAt: payment.verifiedAt || payment.createdAt || new Date().toISOString()
      }));
      depositsCreated += 1;

      const user = this.getUserById(payment.userId);
      if (examples.length < 10) {
        examples.push(`${user?.userId || payment.userId}: recovered deposit log for $${Number(payment.amount || 0).toFixed(2)}`);
      }
    }

    for (const request of this.getPinPurchaseRequests()) {
      if (!isScopedUser(request.userId) || request.status !== 'completed') continue;

      const amount = request.paidFromWallet ? -request.amount : 0;
      const description = request.paidFromWallet
        ? `Purchased ${request.quantity} PIN(s)`
        : `PIN purchase approved (${request.quantity} PINs)`;
      const recoveryTxId = `tx_recover_pin_purchase_${request.id}`;
      const requestTime = new Date(request.processedAt || request.createdAt || 0).getTime();
      const hasExisting = transactions.some((tx) =>
        tx.id === recoveryTxId
        || (
          tx.userId === request.userId
          && tx.type === 'pin_purchase'
          && tx.status === 'completed'
          && Number(tx.amount || 0) === Number(amount || 0)
          && (tx.description || '') === description
          && Math.abs(this.getTransactionTime(tx) - requestTime) <= MATCH_WINDOW_MS
        )
      );
      if (hasExisting) continue;

      createdTransactions.push(this.normalizeTransactionRecord({
        id: recoveryTxId,
        userId: request.userId,
        type: 'pin_purchase',
        amount,
        status: 'completed',
        description,
        createdAt: request.processedAt || request.createdAt || new Date().toISOString(),
        completedAt: request.processedAt || request.createdAt || new Date().toISOString()
      }));
      pinPurchasesCreated += 1;

      const user = this.getUserById(request.userId);
      if (examples.length < 10) {
        examples.push(
          `${user?.userId || request.userId}: recovered PIN purchase log for ${request.quantity} PIN(s) ($${Number(request.amount || 0).toFixed(2)})`
        );
      }
    }

    if (createdTransactions.length === 0) {
      return { depositsCreated: 0, pinPurchasesCreated: 0, examples };
    }

    this.saveTransactions([...transactions, ...createdTransactions]);
    return { depositsCreated, pinPurchasesCreated, examples };
  }

  static recoverMissingReferralAndLevelOneHelp(userRef?: string): {
    directIncomeCreated: number;
    levelOneHelpCreated: number;
    examples: string[];
  } {
    const targetUser = userRef
      ? (this.getUserById(userRef) || this.getUserByUserId(userRef))
      : null;

    if (userRef && !targetUser) {
      throw new Error('User not found');
    }

    const users = this.getUsers();
    const transactions = this.getTransactions();
    const createdTransactions: Transaction[] = [];
    const examples: string[] = [];
    let directIncomeCreated = 0;
    let levelOneHelpCreated = 0;
    let changedExisting = false;

    if (!targetUser) {
      return { directIncomeCreated: 0, levelOneHelpCreated: 0, examples };
    }

    const activeDirectReferrals = users.filter((user) =>
      user.sponsorId === targetUser.userId
      && this.isNetworkActiveUser(user)
      && this.hasActivationEvidenceForUser(user, transactions)
    );

    for (const referral of activeDirectReferrals) {
      const hasDirectIncome = !!this.findExistingReferralIncomeCreditTx(targetUser, referral, transactions);
      if (hasDirectIncome) continue;

      const timestamp = referral.activatedAt || referral.createdAt || new Date().toISOString();
      createdTransactions.push(this.normalizeTransactionRecord({
        id: generateEventId('tx', 'recover_direct_income'),
        userId: targetUser.id,
        type: 'direct_income',
        amount: 5,
        fromUserId: referral.id,
        status: 'completed',
        description: `Referral income from ${referral.fullName} (${referral.userId})`,
        createdAt: timestamp,
        completedAt: timestamp
      }));
      directIncomeCreated += 1;
      if (examples.length < 10) {
        examples.push(`${targetUser.userId}: recovered referral income from ${referral.userId}`);
      }
    }

    const matrixChildrenMap = this.buildMatrixChildrenMap(this.getMatrix());
    const activeMatrixChildren = (matrixChildrenMap.get(targetUser.userId) || [])
      .map((childUserId) => this.getUserByUserId(childUserId))
      .filter((user): user is User =>
        !!user
        && user.parentId === targetUser.userId
        && this.isNetworkActiveUser(user)
        && this.hasActivationEvidenceForUser(user, transactions)
      );
    let lockedFirstTwoCount = this.getLockedFirstTwoReceiveCount(targetUser.id, 1);
    const levelOneSafetyPoolReasons = [
      'No active immediate upline for activation help',
      'No active immediate upline for activation help (side unresolved)'
    ];
    const levelOneAmount = helpDistributionTable[0]?.perUserHelp || 5;
    const firstSettledGiveHelpTx = transactions
      .filter((tx) =>
        tx.userId === targetUser.id
        && tx.type === 'give_help'
        && tx.status === 'completed'
        && tx.amount < 0
        && this.resolveTransactionLevel(tx) === 2
        && Math.abs(tx.amount || 0) >= levelOneAmount * 2
        && String(tx.description || '').toLowerCase().includes('from locked income')
      )
      .sort((a, b) => this.getTransactionTime(a) - this.getTransactionTime(b))[0];
    const firstTwoAlreadyConsumed = transactions.some((tx) =>
      tx.id === firstSettledGiveHelpTx?.id
    );

    for (const child of activeMatrixChildren) {
      const existingReceiveHelp = transactions.find((tx) =>
        tx.type === 'receive_help'
        && tx.status === 'completed'
        && this.transactionRefMatchesUser(tx.userId, targetUser)
        && Number(tx.level) === 1
        && (
          (tx.fromUserId && this.transactionRefMatchesUser(tx.fromUserId, child))
          || String(tx.description || '').includes(`(${child.userId})`)
        )
      );
      if (existingReceiveHelp) {
        const isRecoveredLockedFirstTwo =
          existingReceiveHelp.amount > 0
          && this.isLockedFirstTwoReceiveDescription(existingReceiveHelp.description, 1);
        const isHistoryOnlyRecoveredLockedFirstTwo =
          this.isLockedFirstTwoReceiveDescription(existingReceiveHelp.description, 1)
          && Number(existingReceiveHelp.amount || 0) <= 0
          && Math.abs(Number(existingReceiveHelp.displayAmount || 0)) === levelOneAmount;

        if (!firstTwoAlreadyConsumed && isHistoryOnlyRecoveredLockedFirstTwo) {
          existingReceiveHelp.amount = levelOneAmount;
          existingReceiveHelp.displayAmount = undefined;
          changedExisting = true;
          levelOneHelpCreated += 1;
          if (lockedFirstTwoCount < 2) {
            lockedFirstTwoCount += 1;
          }
          if (examples.length < 10) {
            examples.push(`${targetUser.userId}: converted history-only level 1 help from ${child.userId} into real locked credit`);
          }
          continue;
        }

        if (firstTwoAlreadyConsumed && isRecoveredLockedFirstTwo) {
          existingReceiveHelp.displayAmount = Math.abs((existingReceiveHelp.displayAmount ?? existingReceiveHelp.amount) || levelOneAmount);
          existingReceiveHelp.amount = 0;
          existingReceiveHelp.description = `Locked first-two help at level 1 from ${child.fullName} (${child.userId})`;
          if (firstSettledGiveHelpTx) {
            const giveTime = this.getTransactionTime(firstSettledGiveHelpTx);
            if (giveTime > 1000) {
              const ts = new Date(giveTime - 1000).toISOString();
              existingReceiveHelp.createdAt = ts;
              existingReceiveHelp.completedAt = ts;
            }
          }
          changedExisting = true;
          levelOneHelpCreated += 1;
          if (examples.length < 10) {
            examples.push(`${targetUser.userId}: converted settled level 1 help from ${child.userId} to history-only`);
          }
        }
        continue;
      }

      const matchingSafetyPoolEntry = this.getSafetyPool().transactions
        .filter((entry) =>
          entry.fromUserId === child.id
          && Number(entry.amount || 0) === levelOneAmount
          && levelOneSafetyPoolReasons.includes(String(entry.reason || ''))
        )
        .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())[0];

      if (matchingSafetyPoolEntry) {
        const shouldCreateHistoryOnly = firstTwoAlreadyConsumed && lockedFirstTwoCount < 2;
        const timestamp = child.activatedAt || child.createdAt || matchingSafetyPoolEntry.createdAt || new Date().toISOString();
        const restoredHistoryTimestamp = firstSettledGiveHelpTx
          ? (() => {
              const giveTime = this.getTransactionTime(firstSettledGiveHelpTx);
              return giveTime > 1000 ? new Date(giveTime - 1000).toISOString() : timestamp;
            })()
          : timestamp;
        const description = shouldCreateHistoryOnly
          ? `Locked first-two help at level 1 from ${child.fullName} (${child.userId})`
          : (
            lockedFirstTwoCount < 2
              ? `Locked first-two help at level 1 from ${child.fullName} (${child.userId})`
              : (
                this.isQualifiedForLevel(targetUser, 1)
                  ? `Received help at level 1 from ${child.fullName} (${child.userId})`
                  : `Locked receive help at level 1 from ${child.fullName} (${child.userId})`
              )
          );

        this.deductFromSafetyPool(
          levelOneAmount,
          child.id,
          `Recovered activation level 1 help for ${targetUser.fullName} (${targetUser.userId}) from ${child.fullName} (${child.userId})`
        );

        createdTransactions.push(this.normalizeTransactionRecord({
          id: generateEventId('tx', 'recover_receive_help_l1'),
          userId: targetUser.id,
          type: 'receive_help',
          amount: shouldCreateHistoryOnly ? 0 : levelOneAmount,
          displayAmount: shouldCreateHistoryOnly ? levelOneAmount : undefined,
          fromUserId: child.id,
          level: 1,
          status: 'completed',
          description,
          createdAt: shouldCreateHistoryOnly ? restoredHistoryTimestamp : timestamp,
          completedAt: shouldCreateHistoryOnly ? restoredHistoryTimestamp : timestamp
        }));

        if (!shouldCreateHistoryOnly && lockedFirstTwoCount < 2) {
          lockedFirstTwoCount += 1;
        }
        levelOneHelpCreated += 1;
        if (examples.length < 10) {
          examples.push(`${targetUser.userId}: re-routed safety-pooled level 1 help from ${child.userId}`);
        }
        continue;
      }

      if (this.hasLogicalReceiveHelpCredit({
        recipient: targetUser,
        sender: child,
        level: 1,
        amount: levelOneAmount,
        transactions,
        includeHistoryOnly: true
      })) {
        continue;
      }

      const timestamp = child.activatedAt || child.createdAt || new Date().toISOString();
      const restoredHistoryTimestamp = firstSettledGiveHelpTx
        ? (() => {
            const giveTime = this.getTransactionTime(firstSettledGiveHelpTx);
            return giveTime > 1000 ? new Date(giveTime - 1000).toISOString() : timestamp;
          })()
        : timestamp;
      const shouldCreateHistoryOnly = firstTwoAlreadyConsumed && lockedFirstTwoCount < 2;
      const description = shouldCreateHistoryOnly
        ? `Locked first-two help at level 1 from ${child.fullName} (${child.userId})`
        : (
          lockedFirstTwoCount < 2
            ? `Locked first-two help at level 1 from ${child.fullName} (${child.userId})`
            : (
              this.isQualifiedForLevel(targetUser, 1)
                ? `Received help at level 1 from ${child.fullName} (${child.userId})`
                : `Locked receive help at level 1 from ${child.fullName} (${child.userId})`
            )
        );

      createdTransactions.push(this.normalizeTransactionRecord({
        id: generateEventId('tx', 'recover_receive_help_l1'),
        userId: targetUser.id,
        type: 'receive_help',
        amount: shouldCreateHistoryOnly ? 0 : levelOneAmount,
        displayAmount: shouldCreateHistoryOnly ? levelOneAmount : undefined,
        fromUserId: child.id,
        level: 1,
        status: 'completed',
        description,
        createdAt: shouldCreateHistoryOnly ? restoredHistoryTimestamp : timestamp,
        completedAt: shouldCreateHistoryOnly ? restoredHistoryTimestamp : timestamp
      }));
      if (!shouldCreateHistoryOnly && lockedFirstTwoCount < 2) {
        lockedFirstTwoCount += 1;
      }
      levelOneHelpCreated += 1;
      if (examples.length < 10) {
        examples.push(
          shouldCreateHistoryOnly
            ? `${targetUser.userId}: restored settled level 1 history from ${child.userId}`
            : `${targetUser.userId}: recovered level 1 receive-help from ${child.userId}`
        );
      }
    }

    if (createdTransactions.length === 0 && !changedExisting) {
      return { directIncomeCreated: 0, levelOneHelpCreated: 0, examples };
    }

    this.saveTransactions(changedExisting ? transactions.concat(createdTransactions) : [...transactions, ...createdTransactions]);

    // Run the same post-help settlement sequence that a live matched help event would
    // trigger so recovered level-1 helps immediately affect locked income, lifetime
    // earnings, and auto give-help instead of remaining as history-only rows.
    this.repairLockedIncomeTrackerFromTransactions(targetUser.id);
    this.repairIncomeWalletConsistency(targetUser.id);
    this.syncLockedIncomeWallet(targetUser.id);
    this.attemptAutoLockedHelpSettlement(targetUser.id);
    this.repairLockedIncomeTrackerFromTransactions(targetUser.id);
    this.repairIncomeWalletConsistency(targetUser.id);
    this.syncLockedIncomeWallet(targetUser.id);

    return { directIncomeCreated, levelOneHelpCreated, examples };
  }

  static recoverMissingReferralIncomeForUser(userRef?: string): {
    directIncomeCreated: number;
    examples: string[];
  } {
    let targetUser = userRef
      ? (this.getUserById(userRef) || this.getUserByUserId(userRef))
      : null;

    // During startup a stale internal ID can exist in session storage briefly.
    // Never throw here from wallet bootstrap; just skip until identity resolves.
    if (userRef && !targetUser) {
      const sessionUser = this.getCurrentUser();
      if (sessionUser?.userId) {
        targetUser = this.getUserByUserId(sessionUser.userId) || null;
      }
    }

    if (!targetUser) {
      return { directIncomeCreated: 0, examples: [] };
    }

    const users = this.getUsers();
    const transactions = this.getTransactions();
    const createdTransactions: Transaction[] = [];
    const examples: string[] = [];
    let directIncomeCreated = 0;

    const activeDirectReferrals = users.filter((user) =>
      user.sponsorId === targetUser.userId
      && this.isNetworkActiveUser(user)
      && this.hasActivationEvidenceForUser(user, transactions)
    );

    for (const referral of activeDirectReferrals) {
      const hasDirectIncome = !!this.findExistingReferralIncomeCreditTx(targetUser, referral, transactions);
      if (hasDirectIncome) continue;

      const timestamp = referral.activatedAt || referral.createdAt || new Date().toISOString();
      createdTransactions.push(this.normalizeTransactionRecord({
        id: generateEventId('tx', 'recover_direct_income'),
        userId: targetUser.id,
        type: 'direct_income',
        amount: 5,
        fromUserId: referral.id,
        status: 'completed',
        description: `Referral income from ${referral.fullName} (${referral.userId})`,
        createdAt: timestamp,
        completedAt: timestamp
      }));
      directIncomeCreated += 1;
      if (examples.length < 10) {
        examples.push(`${targetUser.userId}: recovered referral income from ${referral.userId}`);
      }
    }

    if (createdTransactions.length === 0) {
      return { directIncomeCreated: 0, examples };
    }

    this.saveTransactions([...transactions, ...createdTransactions]);
    this.repairIncomeWalletConsistency(targetUser.id);
    return { directIncomeCreated, examples };
  }

  static forceReleaseFirstTwoLockedHelp(userRef: string, level: number = 1): {
    released: number;
    reason: string;
  } {
    const user = this.getUserById(userRef) || this.getUserByUserId(userRef);
    if (!user) {
      throw new Error('User not found');
    }

    const levelIndex = Math.max(1, Math.min(helpDistributionTable.length, Math.floor(level)));
    const levelData = helpDistributionTable[levelIndex - 1];
    if (!levelData) {
      throw new Error('Invalid level');
    }

    let wallet = this.getWallet(user.id);
    if (!wallet) {
      wallet = this.createWallet(user.id);
    }

    this.repairLockedIncomeTrackerFromTransactions(user.id);
    this.syncLockedIncomeWallet(user.id);

    let refreshedWallet = this.getWallet(user.id) || wallet;
    let lockedWallet = Math.max(0, refreshedWallet.lockedIncomeWallet || 0);
    if (lockedWallet <= 0.0001) {
      const bootstrapped = this.bootstrapLockedFirstTwoFromHistory(user.id, levelIndex);
      if (bootstrapped > 0.0001) {
        refreshedWallet = this.getWallet(user.id) || refreshedWallet;
        lockedWallet = Math.max(0, refreshedWallet.lockedIncomeWallet || 0);
      }
    }
    if (lockedWallet <= 0.0001) {
      return { released: 0, reason: 'No locked income to release' };
    }

    const maxFirstTwo = Math.max(0, levelData.perUserHelp * 2);
    const amountToRelease = Math.min(lockedWallet, maxFirstTwo);
    if (amountToRelease <= 0.0001) {
      return { released: 0, reason: 'No releasable amount' };
    }

    const tracker = this.getUserHelpTracker(user.id);
    const state = this.ensureLevelTrackerState(tracker, levelIndex);
    if ((state.lockedAmount || 0) < amountToRelease) {
      state.lockedAmount = amountToRelease;
      tracker.levels[String(levelIndex)] = state;
      this.saveUserHelpTracker(tracker);
    }

    const targetLevel = Math.min(helpDistributionTable.length, levelIndex + 1);
    const transferred = this.executeGiveHelp(
      user.id,
      amountToRelease,
      targetLevel,
      `Force release locked give help at level ${targetLevel} from locked income`,
      { useLockedIncome: true, lockedIncomeLevel: levelIndex }
    );

    if (transferred > 0) {
      state.lockedAmount = Math.max(0, (state.lockedAmount || 0) - transferred);
      state.givenAmount += transferred;
      if (levelData.perUserHelp > 0) {
        state.giveEvents = Math.min(2, (state.giveEvents || 0) + Math.floor(transferred / levelData.perUserHelp));
      }
      tracker.levels[String(levelIndex)] = state;
      this.saveUserHelpTracker(tracker);
    }

    this.repairLockedIncomeTrackerFromTransactions(user.id);
    this.syncLockedIncomeWallet(user.id);

    return {
      released: transferred,
      reason: transferred > 0 ? 'Released locked help via forced settlement' : 'No eligible upline or transfer failed'
    };
  }

  private static bootstrapLockedFirstTwoFromHistory(userId: string, level: number): number {
    if (!userId) return 0;
    let wallet = this.getWallet(userId);
    if (!wallet) {
      wallet = this.createWallet(userId);
    }

    const allTransactions = this.getTransactions();
    const relevant = allTransactions
      .filter((tx) =>
        tx.userId === userId
        && tx.type === 'receive_help'
        && tx.status === 'completed'
        && this.resolveTransactionLevel(tx) === level
        && this.isLockedFirstTwoReceiveDescription(tx.description, level)
      )
      .sort((a, b) => this.getTransactionTime(a) - this.getTransactionTime(b));

    const deduped: Transaction[] = [];
    const seen = new Map<string, number>();
    for (const tx of relevant) {
      const effectiveAmount = this.getUnsettledLockedReceiveEffectiveAmount(tx, allTransactions);
      if (!(effectiveAmount > 0)) continue;
      const key = `${tx.fromUserId || ''}__${effectiveAmount.toFixed(2)}__${level}`;
      const txTime = this.getTransactionTime(tx);
      const lastSeen = seen.get(key);
      if (lastSeen !== undefined && Math.abs(txTime - lastSeen) <= 2 * 60 * 1000) {
        continue;
      }
      seen.set(key, txTime);
      deduped.push(tx);
    }

    if (deduped.length === 0) return 0;

    const levelPerUserHelp = helpDistributionTable[level - 1]?.perUserHelp || 0;
    const maxBootstrap = Math.max(0, levelPerUserHelp * 2);
    const bootstrapAmount = Math.min(
      maxBootstrap,
      deduped.reduce((sum, tx) => sum + this.getUnsettledLockedReceiveEffectiveAmount(tx, allTransactions), 0)
    );
    if (bootstrapAmount <= 0.0001) return 0;

    const tracker = this.getUserHelpTracker(userId);
    const state = this.ensureLevelTrackerState(tracker, level);
    state.receiveEvents = Math.max(state.receiveEvents || 0, Math.min(2, deduped.length));
    state.lockedAmount = Math.max(state.lockedAmount || 0, bootstrapAmount);
    tracker.levels[String(level)] = state;
    this.saveUserHelpTracker(tracker);

    this.updateWallet(userId, {
      lockedIncomeWallet: Math.max(wallet.lockedIncomeWallet || 0, bootstrapAmount),
      giveHelpLocked: Math.max(wallet.giveHelpLocked || 0, bootstrapAmount)
    });

    return bootstrapAmount;
  }

  static reverseTemporarySelfFundCredits(userId?: string): {
    reversed: number;
    examples: string[];
  } {
    const transactions = this.getTransactions();
    const targetUserIds = userId ? new Set([userId]) : null;
    const examples: string[] = [];
    let changed = false;
    let reversed = 0;

    for (const tx of transactions) {
      if (targetUserIds && !targetUserIds.has(tx.userId)) continue;
      if (tx.type !== 'p2p_transfer') continue;
      if (tx.status !== 'completed') continue;
      if (!(tx.amount > 0)) continue;
      if (!String(tx.id || '').includes('repair_self_fund_credit')) continue;

      const originalAmount = Math.abs(tx.amount || 0);
      tx.amount = 0;
      tx.displayAmount = 0;
      tx.status = 'reversed';
      tx.description = 'Reversed temporary self fund credit';
      reversed += 1;
      changed = true;

      const user = this.getUserById(tx.userId);
      if (examples.length < 8) {
        examples.push(`${user?.userId || tx.userId}: reversed temporary self fund credit $${originalAmount.toFixed(2)}`);
      }
    }

    if (!changed) {
      if (userId) {
        this.repairFundWalletConsistency(userId);
      }
      return { reversed: 0, examples };
    }

    this.saveTransactions(transactions);

    if (userId) {
      this.repairFundWalletConsistency(userId);
    } else {
      const touchedUserIds = new Set(
        transactions
          .filter((tx) => tx.status === 'reversed' && tx.description === 'Reversed temporary self fund credit')
          .map((tx) => tx.userId)
      );
      for (const touchedUserId of touchedUserIds) {
        this.repairFundWalletConsistency(touchedUserId);
      }
    }

    return { reversed, examples };
  }

  static removeBrokenSelfIncomeToFundTransfer(userId?: string): {
    removed: number;
    examples: string[];
  } {
    const transactions = this.getTransactions();
    const targetUserIds = userId ? new Set([userId]) : null;
    const examples: string[] = [];
    const touchedUserIds = new Set<string>();
    let changed = false;
    let removed = 0;

    for (const tx of transactions) {
      if (targetUserIds && !targetUserIds.has(tx.userId)) continue;

      const isBrokenSelfIncomeTransfer = tx.type === 'income_transfer'
        && tx.status === 'completed'
        && tx.amount < 0
        && String(tx.description || '').toLowerCase().includes('to your fund wallet')
        && !transactions.some((candidate) =>
          candidate.userId === tx.userId
          && candidate.type === 'p2p_transfer'
          && (candidate.status === 'completed' || candidate.status === 'reversed')
          && (
            candidate.sourceTransferTxId === tx.id
            || (
              Math.abs((candidate.displayAmount ?? candidate.amount) || 0) === Math.abs(tx.amount || 0)
              && Math.abs(this.getTransactionTime(candidate) - this.getTransactionTime(tx)) <= 10 * 60 * 1000
            )
          )
        );

      const isReversedTempSelfFundCredit = tx.type === 'p2p_transfer'
        && tx.status === 'reversed'
        && String(tx.description || '').toLowerCase() === 'reversed temporary self fund credit';

      if (!isBrokenSelfIncomeTransfer && !isReversedTempSelfFundCredit) continue;

      const originalAmount = Math.abs((tx.displayAmount ?? tx.amount) || 0);
      const user = this.getUserById(tx.userId);
      tx.status = 'cancelled';
      tx.amount = 0;
      tx.displayAmount = 0;
      tx.description = isBrokenSelfIncomeTransfer
        ? 'Removed invalid self income-to-fund transfer'
        : 'Removed temporary self fund-credit history';
      changed = true;
      removed += 1;
      touchedUserIds.add(tx.userId);

      if (examples.length < 8) {
        examples.push(`${user?.userId || tx.userId}: removed ${isBrokenSelfIncomeTransfer ? 'broken self transfer' : 'temporary self credit'} $${originalAmount.toFixed(2)}`);
      }
    }

    if (changed) {
      this.saveTransactions(transactions);
      for (const touchedUserId of touchedUserIds) {
        this.repairIncomeWalletConsistency(touchedUserId);
        this.repairFundWalletConsistency(touchedUserId);
        this.repairLockedIncomeTrackerFromTransactions(touchedUserId);
        this.syncLockedIncomeWallet(touchedUserId);
      }
    }

    return { removed, examples };
  }

  static scanHelpLedgerMismatches(userId?: string): {
    scannedGiveHelp: number;
    giveWithoutReceive: number;
    restoredWithoutDebit: number;
    examples: string[];
  } {
    const transactions = this.getTransactions();
    const toTime = (tx: Transaction): number => {
      const raw = tx.completedAt || tx.createdAt || '';
      const n = new Date(raw).getTime();
      return Number.isFinite(n) ? n : 0;
    };
    const MATCH_WINDOW_MS = 10 * 60 * 1000;
    const examples: string[] = [];

    const scopeMatches = (tx: Transaction, resolvedRecipientId?: string): boolean => {
      if (!userId) return true;
      return tx.userId === userId || tx.fromUserId === userId || tx.toUserId === userId || resolvedRecipientId === userId;
    };

    const completedReceiveTxs = transactions.filter((tx) =>
      tx.type === 'receive_help'
      && tx.status === 'completed'
      && tx.amount > 0
      && !!tx.fromUserId
    );

    let scannedGiveHelp = 0;
    let giveWithoutReceive = 0;
    for (const giveTx of transactions) {
      if (giveTx.type !== 'give_help' || giveTx.status !== 'completed' || !(giveTx.amount < 0)) continue;

      const sender = this.getUserById(giveTx.userId);
      const recipient = (giveTx.toUserId && this.getUserById(giveTx.toUserId))
        || (giveTx.toUserId && this.getUserByUserId(String(giveTx.toUserId)))
        || ((giveTx.description || '').match(/\((\d{7})\)/)?.[1] ? this.getUserByUserId((giveTx.description || '').match(/\((\d{7})\)/)?.[1] || '') : undefined);

      if (!sender || !recipient) continue;
      if (!scopeMatches(giveTx, recipient.id)) continue;

      scannedGiveHelp += 1;
      const level = this.resolveTransactionLevel(giveTx);
      const amount = Math.abs(giveTx.amount || 0);
      if (!level || amount <= 0) continue;

      const match = completedReceiveTxs.find((receiveTx) =>
        receiveTx.userId === recipient.id
        && this.transactionRefMatchesUser(receiveTx.fromUserId, sender)
        && this.resolveTransactionLevel(receiveTx) === level
        && Math.abs(receiveTx.amount || 0) === amount
        && Math.abs(toTime(receiveTx) - toTime(giveTx)) <= MATCH_WINDOW_MS
      );

      if (!match) {
        giveWithoutReceive += 1;
        if (examples.length < 8) {
          examples.push(`Missing receive-help for give-help: ${sender.userId} -> ${recipient.userId} level ${level} $${amount.toFixed(2)}`);
        }
      }
    }

    let restoredWithoutDebit = 0;
    for (const receiveTx of completedReceiveTxs) {
      const txId = String(receiveTx.id || '');
      const isManualRestore = txId.includes('restore_receive_') || txId.includes('history_receive_') || txId.includes('repair_receive_');
      if (!isManualRestore) continue;
      if (!scopeMatches(receiveTx)) continue;

      const sender = receiveTx.fromUserId ? this.getUserById(receiveTx.fromUserId) : undefined;
      const recipient = this.getUserById(receiveTx.userId);
      const level = this.resolveTransactionLevel(receiveTx);
      const amount = Math.abs((receiveTx.displayAmount ?? receiveTx.amount) || 0);
      if (!sender || !recipient || !level || amount <= 0) continue;

      const matchingGive = transactions.find((giveTx) =>
        this.transactionRefMatchesUser(giveTx.userId, sender)
        && giveTx.type === 'give_help'
        && giveTx.status === 'completed'
        && this.resolveTransactionLevel(giveTx) === level
        && Math.abs(giveTx.amount || 0) === amount
        && this.giveHelpTargetsUser(giveTx, recipient)
        && Math.abs(toTime(giveTx) - toTime(receiveTx)) <= MATCH_WINDOW_MS
      );

      if (!matchingGive) {
        restoredWithoutDebit += 1;
        if (examples.length < 8) {
          examples.push(`Manual restore without debit: ${sender.userId} -> ${recipient.userId} level ${level} $${amount.toFixed(2)}`);
        }
      }
    }

    return {
      scannedGiveHelp,
      giveWithoutReceive,
      restoredWithoutDebit,
      examples
    };
  }

  static findGiveHelpDebitsTargetingUser(userId: string): Array<{
    txId: string;
    senderId?: string;
    senderUserId?: string;
    senderName?: string;
    level: number;
    amount: number;
    createdAt: string;
    description: string;
  }> {
    if (!userId) return [];
    const recipient = this.getUserById(userId);
    if (!recipient) return [];
    const allTransactions = this.getTransactions();

    return allTransactions
      .filter((tx) =>
        tx.type === 'give_help'
        && tx.status === 'completed'
        && tx.amount < 0
        && this.giveHelpTargetsUser(tx, recipient)
      )
      .filter((tx) => {
        const sender = this.getUserById(tx.userId) || (tx.userId ? this.getUserByUserId(tx.userId) : undefined);
        if (!sender) return true;
        const alreadyMatched = allTransactions.some((receiveTx) =>
          this.isReceiveHelpSettlementForGiveTx(receiveTx, tx, recipient, sender)
        );
        return !alreadyMatched;
      })
      .map((tx) => {
        const sender = this.getUserById(tx.userId) || (tx.userId ? this.getUserByUserId(tx.userId) : undefined);
        return {
          txId: tx.id,
          senderId: sender?.id,
          senderUserId: sender?.userId,
          senderName: sender?.fullName,
          level: this.resolveTransactionLevel(tx) || Number(tx.level) || 0,
          amount: Math.abs(tx.amount || 0),
          createdAt: tx.completedAt || tx.createdAt,
          description: tx.description || ''
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  static restoreReceiveHelpFromGiveHelpTxId(params: {
    recipientUserId: string;
    giveHelpTxId: string;
    historyOnly?: boolean;
  }): { created: boolean; description?: string } {
    const recipientPublicId = String(params.recipientUserId || '').replace(/\D/g, '').slice(0, 7);
    if (recipientPublicId.length !== 7) {
      throw new Error('Enter valid 7-digit recipient User ID');
    }

    const recipient = this.getUserByUserId(recipientPublicId);
    if (!recipient) throw new Error('Recipient user not found');

    const giveTx = this.getTransactions().find((tx) =>
      tx.id === params.giveHelpTxId
      && tx.type === 'give_help'
      && tx.status === 'completed'
      && tx.amount < 0
    );
    if (!giveTx) throw new Error('Give-help transaction not found');
    if (!this.giveHelpTargetsUser(giveTx, recipient)) {
      throw new Error('Selected give-help transaction does not target this recipient');
    }

    const sender = this.getUserById(giveTx.userId) || (giveTx.userId ? this.getUserByUserId(giveTx.userId) : undefined);
    if (!sender) throw new Error('Sender user not found for this give-help transaction');

    const level = this.resolveTransactionLevel(giveTx);
    if (!level || level < 1 || level > helpDistributionTable.length) {
      throw new Error('Unable to detect level from selected give-help transaction');
    }

    const amount = Math.abs(giveTx.amount || 0);
    if (!(amount > 0)) {
      throw new Error('Selected give-help transaction has invalid amount');
    }

    const existing = this.getTransactions().some((tx) =>
      this.isReceiveHelpSettlementForGiveTx(tx, giveTx, recipient, sender, {
        allowHistoryOnly: !!params.historyOnly
      })
    );
    if (existing) return { created: false };

    const fromSuffix = ` from ${sender.fullName} (${sender.userId})`;
    const lockedFirstTwoCount = this.getLockedFirstTwoReceiveCount(recipient.id, level);
    const requiredDirect = this.getCumulativeDirectRequired(level);
    const currentDirect = this.getEffectiveDirectCount(recipient);
    let description = '';

    if (params.historyOnly) {
      description = `Received help at level ${level}${fromSuffix}`;
      this.createTransaction({
        id: generateEventId('tx', `history_receive_exact_l${level}`),
        userId: recipient.id,
        type: 'receive_help',
        amount: 0,
        displayAmount: amount,
        fromUserId: sender.id,
        level,
        status: 'completed',
        description,
        sourceGiveHelpTxId: giveTx.id,
        createdAt: giveTx.completedAt || giveTx.createdAt || new Date().toISOString(),
        completedAt: giveTx.completedAt || giveTx.createdAt || new Date().toISOString()
      });
      return { created: true, description };
    }

    if (lockedFirstTwoCount < 2) {
      description = `Locked first-two help at level ${level}${fromSuffix}`;
    } else if (this.isQualifiedForLevel(recipient, level)) {
      description = `Received help at level ${level}${fromSuffix}`;
    } else {
      description = `Locked receive help at level ${level}${fromSuffix} (requires ${requiredDirect} direct, current ${currentDirect})`;
    }

    this.createTransaction({
      id: generateEventId('tx', `restore_exact_receive_l${level}`),
      userId: recipient.id,
      type: 'receive_help',
      amount,
      fromUserId: sender.id,
      level,
      status: 'completed',
      description,
      sourceGiveHelpTxId: giveTx.id,
      createdAt: giveTx.completedAt || giveTx.createdAt || new Date().toISOString(),
      completedAt: giveTx.completedAt || giveTx.createdAt || new Date().toISOString()
    });

    this.repairLockedIncomeTrackerFromTransactions(recipient.id);
    this.repairIncomeWalletConsistency(recipient.id);
    this.syncLockedIncomeWallet(recipient.id);

    return { created: true, description };
  }

  static reverseInvalidRestoredReceiveHelp(userId?: string): {
    reversed: number;
    examples: string[];
  } {
    const transactions = this.getTransactions();
    const examples: string[] = [];
    const affectedUserIds = new Set<string>();
    let changed = false;
    let reversed = 0;

    const scopeMatches = (tx: Transaction): boolean => {
      if (!userId) return true;
      return tx.userId === userId || tx.fromUserId === userId || tx.toUserId === userId;
    };

    for (const receiveTx of transactions) {
      const txId = String(receiveTx.id || '');
      const isManualRestore = txId.includes('restore_receive_') || txId.includes('history_receive_') || txId.includes('repair_receive_');
      if (!isManualRestore) continue;
      if (receiveTx.status !== 'completed') continue;
      if (!scopeMatches(receiveTx)) continue;

      const sender = receiveTx.fromUserId ? this.getUserById(receiveTx.fromUserId) : undefined;
      const recipient = this.getUserById(receiveTx.userId);
      const level = this.resolveTransactionLevel(receiveTx);
      const amount = Math.abs((receiveTx.displayAmount ?? receiveTx.amount) || 0);
      if (!sender || !recipient || !level || amount <= 0) continue;

      const linkedGiveId = String(receiveTx.sourceGiveHelpTxId || '').trim();
      const matchingGive = linkedGiveId
        ? transactions.find((giveTx) =>
            giveTx.id === linkedGiveId
            && this.transactionRefMatchesUser(giveTx.userId, sender)
            && giveTx.type === 'give_help'
            && giveTx.status === 'completed'
          )
        : transactions.find((giveTx) =>
            this.transactionRefMatchesUser(giveTx.userId, sender)
            && giveTx.type === 'give_help'
            && giveTx.status === 'completed'
            && this.resolveTransactionLevel(giveTx) === level
            && Math.abs(giveTx.amount || 0) === amount
            && this.giveHelpTargetsUser(giveTx, recipient)
          );

      if (matchingGive) continue;

      const originalAmount = receiveTx.amount;
      const originalDisplayAmount = receiveTx.displayAmount;
      const originalDescription = receiveTx.description || '';
      receiveTx.amount = 0;
      receiveTx.displayAmount = 0;
      receiveTx.status = 'reversed';
      receiveTx.description = `Reversed invalid restored receive help (no matching sender debit). ${originalDescription}`.trim();
      changed = true;
      reversed += 1;
      affectedUserIds.add(recipient.id);

      if (examples.length < 8) {
        examples.push(
          `Reversed invalid restored credit: ${sender.userId} -> ${recipient.userId} level ${level} $${Math.abs(originalDisplayAmount ?? originalAmount).toFixed(2)}`
        );
      }
    }

    if (changed) {
      this.saveTransactions(transactions);
      for (const affectedUserId of affectedUserIds) {
        this.repairLockedIncomeTrackerFromTransactions(affectedUserId);
        this.repairIncomeWalletConsistency(affectedUserId);
        this.syncLockedIncomeWallet(affectedUserId);
      }
    }

    return { reversed, examples };
  }

  static repairMissingIncomingReceiveHelp(userId: string): { scanned: number; created: number; existing: number } {
    if (!userId) return { scanned: 0, created: 0, existing: 0 };

    const recipient = this.getUserById(userId);
    if (!recipient) return { scanned: 0, created: 0, existing: 0 };

    const transactions = this.getTransactions();
    const incomingGiveTxs = transactions.filter((tx) =>
      tx.type === 'give_help'
      && tx.status === 'completed'
      && tx.amount < 0
      && (tx.description || '').toLowerCase().includes('from locked income')
      && (
        tx.toUserId === userId
        || tx.toUserId === recipient.userId
        || (tx.description || '').includes(`(${recipient.userId})`)
      )
    );
    if (incomingGiveTxs.length === 0) return { scanned: 0, created: 0, existing: 0 };

    const toTime = (tx: Transaction): number => {
      const raw = tx.completedAt || tx.createdAt || '';
      const n = new Date(raw).getTime();
      return Number.isFinite(n) ? n : 0;
    };
    const MATCH_WINDOW_MS = 10 * 60 * 1000;

    const receiveTxsByKey = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      if (!this.transactionRefMatchesUser(tx.userId, recipient)) continue;
      if (tx.type !== 'receive_help' || tx.status !== 'completed' || !(tx.amount > 0)) continue;
      const level = this.resolveTransactionLevel(tx);
      if (!level || !tx.fromUserId) continue;
      const key = `${tx.fromUserId}|${userId}|${level}|${Math.abs(tx.amount).toFixed(2)}`;
      const list = receiveTxsByKey.get(key) || [];
      list.push(tx);
      receiveTxsByKey.set(key, list);
    }
    for (const list of receiveTxsByKey.values()) {
      list.sort((a, b) => toTime(a) - toTime(b));
    }

    let created = 0;
    let existing = 0;
    const usedReceiveIds = new Set<string>();

    const sortedGiveTxs = [...incomingGiveTxs].sort((a, b) => toTime(a) - toTime(b));
    for (const giveTx of sortedGiveTxs) {
      const sender = this.getUserById(giveTx.userId);
      const level = this.resolveTransactionLevel(giveTx);
      const amount = Math.abs(giveTx.amount || 0);
      if (!sender || !level || amount <= 0) continue;

      const key = `${sender.id}|${userId}|${level}|${amount.toFixed(2)}`;
      const giveTime = toTime(giveTx);
      const matchingReceive = (receiveTxsByKey.get(key) || []).find((tx) => {
        if (usedReceiveIds.has(tx.id)) return false;
        const timeDiff = Math.abs(toTime(tx) - giveTime);
        return timeDiff <= MATCH_WINDOW_MS;
      });

      if (matchingReceive) {
        usedReceiveIds.add(matchingReceive.id);
        existing += 1;
        continue;
      }

      const fromSuffix = ` from ${sender.fullName} (${sender.userId})`;
      const lockedFirstTwoCount = this.getLockedFirstTwoReceiveCount(userId, level);
      const description = lockedFirstTwoCount < 2
        ? `Locked first-two help at level ${level}${fromSuffix}`
        : (
          this.isQualifiedForLevel(recipient, level)
            ? `Received help at level ${level}${fromSuffix}`
            : `Locked receive help at level ${level}${fromSuffix}`
        );

      this.createTransaction({
        id: generateEventId('tx', `repair_receive_l${level}`),
        userId,
        type: 'receive_help',
        amount,
        fromUserId: sender.id,
        level,
        status: 'completed',
        description,
        createdAt: giveTx.completedAt || giveTx.createdAt || new Date().toISOString(),
        completedAt: giveTx.completedAt || giveTx.createdAt || new Date().toISOString()
      });
      created += 1;
    }

    if (created > 0 || existing > 0) {
      this.repairLockedIncomeTrackerFromTransactions(userId);
      this.repairIncomeWalletConsistency(userId);
      this.syncLockedIncomeWallet(userId);
    }

    return { scanned: incomingGiveTxs.length, created, existing };
  }

  static repairHistoricalReferralAndHelpMismatches(): {
    usersScanned: number;
    usersTouched: number;
    ghostReceiveHelpReversed: number;
    invalidRestoredReceiveHelpReversed: number;
    referralIncomeRecovered: number;
    levelOneHelpRecovered: number;
    missingIncomingReceiveHelpRecovered: number;
    referralMismatchRecoveriesActivated: number;
    duplicateGiveMismatchRecoveriesActivated: number;
    recoveredNowAmount: number;
    recoveryDetails: HistoricalAutoRecoveryDetail[];
  } {
    const canonicalUsers = new Map<string, User>();
    for (const user of this.getUsers()) {
      if (!user?.userId) continue;
      if (!canonicalUsers.has(user.userId)) {
        canonicalUsers.set(user.userId, this.getUserByUserId(user.userId) || user);
      }
    }

    const reverseInvalid = this.reverseInvalidRestoredReceiveHelp();
    const ghostRepair = this.repairGhostReceiveHelpTransactions();

    let usersTouched = 0;
    let referralIncomeRecovered = 0;
    let levelOneHelpRecovered = 0;
    let missingIncomingReceiveHelpRecovered = 0;

    let referralMismatchRecoveriesActivated = 0;
    let duplicateGiveMismatchRecoveriesActivated = 0;
    let recoveredNowAmount = 0;
    const recoveryDetails: HistoricalAutoRecoveryDetail[] = [];

    for (const user of canonicalUsers.values()) {
      const referralAndHelp = this.recoverMissingReferralAndLevelOneHelp(user.id);
      const incomingHelp = this.repairMissingIncomingReceiveHelp(user.id);

      const touched = (
        referralAndHelp.directIncomeCreated
        + referralAndHelp.levelOneHelpCreated
        + incomingHelp.created
      ) > 0;

      if (touched) usersTouched += 1;
      referralIncomeRecovered += referralAndHelp.directIncomeCreated;
      levelOneHelpRecovered += referralAndHelp.levelOneHelpCreated;
      missingIncomingReceiveHelpRecovered += incomingHelp.created;
    }

    for (const mismatch of this.scanReferralIncomeMismatches()) {
      if ((mismatch.extraCreditedAmount || 0) <= 0.009) continue;
      const targetUser = this.getUserByUserId(mismatch.sponsorUserId);
      if (!targetUser) continue;
      const reason = this.buildReferralMismatchRecoveryReason(mismatch);
      const activation = this.startFundRecoveryForReferralIncomeMismatch(
        mismatch.sponsorUserId,
        mismatch.likelyCorrectUserId
      );
      const beforeDue = Math.max(0, Number(activation.recoveryDue || 0));
      let recoveredNow = Math.max(0, Number(activation.recoveredNow || 0));
      let afterDue = beforeDue;
      let note = activation.message;
      if (activation.success && (((activation.recoveryDue || 0) > 0.009) || ((activation.recoveredNow || 0) > 0.0001))) {
        referralMismatchRecoveriesActivated += 1;
      }

      if (beforeDue > 0.009) {
        const applyNow = this.applyActiveFundRecoveryNow(mismatch.sponsorUserId);
        note = `${note} ${applyNow.message}`.trim();
        if (applyNow.success) {
          recoveredNow += Math.max(0, Number(applyNow.recoveredNow || 0));
          afterDue = Math.max(0, Number(applyNow.recoveryDue || 0));
        }
      }

      recoveredNowAmount += recoveredNow;
      recoveryDetails.push({
        id: generateEventId('repair', 'referral_recovery_detail'),
        kind: 'referral_income_mismatch',
        referenceId: `${mismatch.sponsorUserId}__${mismatch.likelyCorrectUserId || 'unknown'}`,
        userId: targetUser.userId,
        userName: targetUser.fullName,
        reason,
        beforeDue: Math.round(beforeDue * 100) / 100,
        recoveredNow: Math.round(recoveredNow * 100) / 100,
        afterDue: Math.round(afterDue * 100) / 100,
        status: afterDue > 0.009 ? 'active' : (recoveredNow > 0.0001 ? 'cleared' : 'no_change'),
        note,
        createdAt: new Date().toISOString()
      });
    }

    for (const mismatch of this.scanDuplicateLockedGiveHelpMismatches()) {
      if ((mismatch.extraCreditedAmount || 0) <= 0.009) continue;
      const targetUser = this.getUserByUserId(mismatch.recipientUserId);
      if (!targetUser) continue;
      const reason = `duplicate give-help credits of ${mismatch.senderName} (${mismatch.senderUserId})`;
      const activation = this.startFundRecoveryForDuplicateLockedGiveHelpMismatch(mismatch.mismatchKey);
      const beforeDue = Math.max(0, Number(activation.recoveryDue || 0));
      let recoveredNow = Math.max(0, Number(activation.recoveredNow || 0));
      let afterDue = beforeDue;
      let note = activation.message;
      if (activation.success && (((activation.recoveryDue || 0) > 0.009) || ((activation.recoveredNow || 0) > 0.0001))) {
        duplicateGiveMismatchRecoveriesActivated += 1;
      }

      if (beforeDue > 0.009) {
        const applyNow = this.applyActiveFundRecoveryNow(mismatch.recipientUserId);
        note = `${note} ${applyNow.message}`.trim();
        if (applyNow.success) {
          recoveredNow += Math.max(0, Number(applyNow.recoveredNow || 0));
          afterDue = Math.max(0, Number(applyNow.recoveryDue || 0));
        }
      }

      recoveredNowAmount += recoveredNow;
      recoveryDetails.push({
        id: generateEventId('repair', 'duplicate_give_recovery_detail'),
        kind: 'duplicate_give_help_mismatch',
        referenceId: mismatch.mismatchKey,
        userId: targetUser.userId,
        userName: targetUser.fullName,
        reason,
        beforeDue: Math.round(beforeDue * 100) / 100,
        recoveredNow: Math.round(recoveredNow * 100) / 100,
        afterDue: Math.round(afterDue * 100) / 100,
        status: afterDue > 0.009 ? 'active' : (recoveredNow > 0.0001 ? 'cleared' : 'no_change'),
        note,
        createdAt: new Date().toISOString()
      });
    }

    this.repairIncomeWalletConsistency();
    this.syncLockedIncomeWallet();

    return {
      usersScanned: canonicalUsers.size,
      usersTouched,
      ghostReceiveHelpReversed: ghostRepair.repaired,
      invalidRestoredReceiveHelpReversed: reverseInvalid.reversed,
      referralIncomeRecovered,
      levelOneHelpRecovered,
      missingIncomingReceiveHelpRecovered,
      referralMismatchRecoveriesActivated,
      duplicateGiveMismatchRecoveriesActivated,
      recoveredNowAmount: Math.round(recoveredNowAmount * 100) / 100,
      recoveryDetails
    };
  }


  static recoverMissingUserFromMatrix(params: {
    userId: string;
    fullName?: string;
    email?: string;
    phone?: string;
    country?: string;
    sponsorId?: string | null;
    loginPassword?: string;
    transactionPassword?: string;
    restoreSponsorIncome?: boolean;
  }): {
    user: User;
    created: boolean;
    sponsorIncomeRestored: boolean;
    sponsorUserId?: string;
    generatedLoginPassword?: string;
    generatedTransactionPassword?: string;
  } {
    const cleanUserId = String(params.userId || '').replace(/\D/g, '').slice(0, 7);
    if (cleanUserId.length !== 7) {
      throw new Error('Enter a valid 7-digit User ID');
    }

    const existing = this.getUserByUserId(cleanUserId);
    if (existing) {
      return { user: existing, created: false, sponsorIncomeRestored: false };
    }

    const matrixNode = this.getMatrixNode(cleanUserId);
    if (!matrixNode) {
      throw new Error('Matrix node not found for this User ID');
    }

    const resolvedName = (params.fullName || '').trim() || matrixNode.username || `Member ${cleanUserId}`;
    const resolvedSponsorId = (params.sponsorId || '').trim() || matrixNode.parentId || null;
    const resolvedEmailBase = (params.email || '').trim() || `recovered.${cleanUserId}@auto.local`;
    const email = this.getUserByEmail(resolvedEmailBase)
      ? `recovered.${cleanUserId}.${Date.now()}@auto.local`
      : resolvedEmailBase;
    const loginPasswordInput = (params.loginPassword || '').trim();
    const txPasswordInput = String(params.transactionPassword || '').replace(/\D/g, '');
    const generatedLoginPassword = loginPasswordInput ? undefined : `Temp@${cleanUserId}`;
    const generatedTransactionPassword = txPasswordInput.length >= 4 && txPasswordInput.length <= 6
      ? undefined
      : cleanUserId.slice(-4);
    const loginPassword = loginPasswordInput || generatedLoginPassword || `Temp@${cleanUserId}`;
    const transactionPassword = txPasswordInput.length >= 4 && txPasswordInput.length <= 6
      ? txPasswordInput
      : (generatedTransactionPassword || cleanUserId.slice(-4));

    const side = this.normalizeMatrixSide(matrixNode.position);
    const now = new Date().toISOString();
    const user: User = {
      id: `user_recovered_${cleanUserId}`,
      userId: cleanUserId,
      email,
      password: loginPassword,
      fullName: resolvedName,
      phone: (params.phone || '').trim(),
      country: (params.country || '').trim(),
      isActive: !!matrixNode.isActive,
      isAdmin: false,
      accountStatus: 'active',
      blockedAt: null,
      blockedUntil: null,
      blockedReason: null,
      deactivationReason: null,
      reactivatedAt: null,
      createdAt: now,
      activatedAt: now,
      gracePeriodEnd: null,
      sponsorId: resolvedSponsorId,
      parentId: matrixNode.parentId || null,
      position: side,
      level: 0,
      directCount: 0,
      totalEarnings: 0,
      isCapped: false,
      capLevel: 0,
      reEntryCount: 0,
      cycleCount: 0,
      requiredDirectForNextLevel: 2,
      completedDirectForCurrentLevel: 0,
      transactionPassword,
      emailVerified: false,
      achievements: {
        nationalTour: false,
        internationalTour: false,
        familyTour: false
      }
    };

    this.createUser(user);

    const matrix = this.getMatrix();
    const nodeIndex = matrix.findIndex((node) => node.userId === cleanUserId);
    if (nodeIndex !== -1) {
      const existingNode = matrix[nodeIndex];
      const nextNode = {
        ...existingNode,
        username: resolvedName,
        isActive: !!user.isActive,
        parentId: existingNode.parentId || matrixNode.parentId,
        position: typeof existingNode.position === 'number' ? existingNode.position : (side === 'right' ? 1 : 0)
      };
      matrix[nodeIndex] = nextNode;
      if (nextNode.parentId) {
        const parentIdx = matrix.findIndex((node) => node.userId === nextNode.parentId);
        if (parentIdx !== -1) {
          if (side === 'left') matrix[parentIdx].leftChild = cleanUserId;
          if (side === 'right') matrix[parentIdx].rightChild = cleanUserId;
        }
      }
      this.saveMatrix(matrix);
    }

    let sponsorIncomeRestored = false;
    let sponsorUserId: string | undefined;
    if (resolvedSponsorId) {
      const sponsor = this.getUserByUserId(resolvedSponsorId);
      if (sponsor) {
        sponsorUserId = sponsor.userId;
        const directCount = this.getUsers().filter((member) => member.sponsorId === sponsor.userId).length;
        if (directCount !== sponsor.directCount) {
          this.updateUser(sponsor.id, { directCount });
        }

        if (params.restoreSponsorIncome !== false) {
          const hasDirectIncome = this.hasCompletedReferralIncomeForIdentity({
            sponsorInternalId: sponsor.id,
            referredInternalId: user.id,
            referredUserId: user.userId,
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            referenceTime: user.createdAt
          });
          if (!hasDirectIncome) {
            const directIncome = 5;
            const sponsorWallet = this.getWallet(sponsor.id);
            if (sponsorWallet) {
              this.updateWallet(sponsor.id, {
                incomeWallet: sponsorWallet.incomeWallet + directIncome,
                totalReceived: sponsorWallet.totalReceived + directIncome
              });
            }
            this.createTransaction({
              id: generateEventId('tx', 'direct_income_recovery'),
              userId: sponsor.id,
              type: 'direct_income',
              amount: directIncome,
              fromUserId: user.id,
              status: 'completed',
              description: `Referral income from ${user.fullName} (${user.userId})`,
              createdAt: now,
              completedAt: now
            });
            this.deductPendingSystemFee(sponsor.id);
            sponsorIncomeRestored = true;
          }
        }
      }
    }

    return {
      user,
      created: true,
      sponsorIncomeRestored,
      sponsorUserId,
      generatedLoginPassword,
      generatedTransactionPassword
    };
  }

  static relinkRecoveredUserPinUsage(userId: string, pinCodeHint?: string): {
    userId: string;
    scannedUsedPins: number;
    orphanCandidates: number;
    relinked: number;
  } {
    const cleanUserId = String(userId || '').replace(/\D/g, '').slice(0, 7);
    if (cleanUserId.length !== 7) {
      throw new Error('Enter a valid 7-digit User ID');
    }

    const targetUser = this.getUserByUserId(cleanUserId);
    if (!targetUser) {
      throw new Error('Target user not found');
    }

    const pinCode = String(pinCodeHint || '').trim().toUpperCase();
    const userInternalIds = new Set(this.getUsers().map((member) => member.id));
    const pinUsedTxs = this.getTransactions().filter((tx) => (
      tx.type === 'pin_used'
      && tx.status === 'completed'
      && tx.userId === targetUser.id
    ));
    const eligiblePinIds = new Set(
      pinUsedTxs.map((tx) => String(tx.pinId || '').trim()).filter(Boolean)
    );
    const eligiblePinCodes = new Set(
      pinUsedTxs.map((tx) => String(tx.pinCode || '').trim().toUpperCase()).filter(Boolean)
    );
    if (pinCode) {
      eligiblePinCodes.add(pinCode);
    }

    let scannedUsedPins = 0;
    let orphanCandidates = 0;
    let relinked = 0;
    const now = new Date().toISOString();
    const pins = this.getPins();

    const nextPins = pins.map((pin) => {
      if (pin.status !== 'used') {
        return pin;
      }
      scannedUsedPins += 1;

      const normalizedPinCode = String(pin.pinCode || '').trim().toUpperCase();
      if (pinCode && normalizedPinCode !== pinCode) {
        return pin;
      }

      const usedById = String(pin.usedById || '').trim();
      const registrationUserId = String(pin.registrationUserId || '').trim();
      const orphanUsedBy = !!usedById && !userInternalIds.has(usedById);
      const orphanRegistration = !!registrationUserId && !userInternalIds.has(registrationUserId);
      if (!orphanUsedBy && !orphanRegistration) {
        return pin;
      }

      orphanCandidates += 1;
      const hasEligiblePinHistory = eligiblePinIds.has(pin.id) || (normalizedPinCode && eligiblePinCodes.has(normalizedPinCode));
      if (!hasEligiblePinHistory) {
        return pin;
      }

      if (pin.usedById === targetUser.id && pin.registrationUserId === targetUser.id) {
        return pin;
      }

      relinked += 1;
      return {
        ...pin,
        usedById: targetUser.id,
        registrationUserId: targetUser.id,
        usedAt: pin.usedAt || now,
        status: 'used' as Pin['status']
      };
    });

    if (relinked > 0) {
      this.savePins(nextPins);
    }

    return {
      userId: targetUser.userId,
      scannedUsedPins,
      orphanCandidates,
      relinked
    };
  }

  static assignUsedPinToUser(params: {
    pinCode: string;
    targetUserId: string;
  }): {
    pinCode: string;
    targetUserId: string;
    updated: boolean;
    createdPinUsedHistory: boolean;
  } {
    const normalizedPinCode = String(params.pinCode || '').trim().toUpperCase();
    if (!normalizedPinCode) {
      throw new Error('PIN code is required');
    }

    const cleanTargetUserId = String(params.targetUserId || '').replace(/\D/g, '').slice(0, 7);
    if (cleanTargetUserId.length !== 7) {
      throw new Error('Enter a valid 7-digit User ID');
    }

    const targetUser = this.getUserByUserId(cleanTargetUserId);
    if (!targetUser) {
      throw new Error('Target user not found');
    }

    const pins = this.getPins();
    const pinIndex = pins.findIndex((pin) => String(pin.pinCode || '').trim().toUpperCase() === normalizedPinCode);
    if (pinIndex === -1) {
      throw new Error('PIN not found');
    }

    const pin = pins[pinIndex];
    if (pin.status !== 'used') {
      throw new Error('Only used PIN can be assigned with this action');
    }

    const existingUsedById = String(pin.usedById || '').trim();
    const existingUser = existingUsedById ? this.getUserById(existingUsedById) : undefined;
    if (existingUser && existingUser.id !== targetUser.id) {
      throw new Error(`PIN is already linked to ${existingUser.userId}. Clear that mapping first.`);
    }

    const now = new Date().toISOString();
    let updated = false;
    if (pin.usedById !== targetUser.id || pin.registrationUserId !== targetUser.id || !pin.usedAt) {
      pins[pinIndex] = {
        ...pin,
        status: 'used' as Pin['status'],
        usedById: targetUser.id,
        registrationUserId: targetUser.id,
        usedAt: pin.usedAt || now
      };
      this.savePins(pins);
      updated = true;
    }

    const alreadyHasPinUsedHistory = this.getTransactions().some((tx) => (
      tx.type === 'pin_used'
      && tx.status === 'completed'
      && tx.userId === targetUser.id
      && (
        String(tx.pinId || '').trim() === pin.id
        || String(tx.pinCode || '').trim().toUpperCase() === normalizedPinCode
      )
    ));

    let createdPinUsedHistory = false;
    if (!alreadyHasPinUsedHistory) {
      this.createTransaction({
        id: generateEventId('tx', 'pin_used_manual_link'),
        userId: targetUser.id,
        type: 'pin_used',
        amount: Number(pin.amount || 11),
        pinCode: normalizedPinCode,
        pinId: pin.id,
        status: 'completed',
        description: `PIN usage manually linked by admin for ${targetUser.fullName} (${targetUser.userId})`,
        createdAt: now,
        completedAt: now
      });
      createdPinUsedHistory = true;
    }

    return {
      pinCode: normalizedPinCode,
      targetUserId: targetUser.userId,
      updated,
      createdPinUsedHistory
    };
  }

  static ensureRegistrationConsistency(params: {
    userId: string;
    fullName?: string;
    email?: string;
    phone?: string;
    country?: string;
    sponsorId?: string | null;
    loginPassword?: string;
    transactionPassword?: string;
    pinCode?: string;
  }): {
    user: User;
    recoveredUser: boolean;
    relinkedPins: number;
    sponsorDirectCountSynced: boolean;
  } {
    const cleanUserId = String(params.userId || '').replace(/\D/g, '').slice(0, 7);
    if (cleanUserId.length !== 7) {
      throw new Error('Invalid registration user ID');
    }

    let recoveredUser = false;
    let user = this.getUserByUserId(cleanUserId);
    if (!user) {
      const matrixNode = this.getMatrixNode(cleanUserId);
      if (!matrixNode) {
        throw new Error('Registration is incomplete: user and matrix node are both missing');
      }

      const recovered = this.recoverMissingUserFromMatrix({
        userId: cleanUserId,
        fullName: params.fullName,
        email: params.email,
        phone: params.phone,
        country: params.country,
        sponsorId: params.sponsorId,
        loginPassword: params.loginPassword,
        transactionPassword: params.transactionPassword,
        restoreSponsorIncome: false
      });
      recoveredUser = recovered.created;
      user = this.getUserByUserId(cleanUserId) || recovered.user;
    }

    const relink = this.relinkRecoveredUserPinUsage(cleanUserId, params.pinCode);

    let sponsorDirectCountSynced = false;
    if (user.sponsorId) {
      const sponsor = this.getUserByUserId(user.sponsorId);
      if (sponsor) {
        const actualDirectCount = this.getUsers().filter((member) => member.sponsorId === sponsor.userId).length;
        if ((sponsor.directCount || 0) !== actualDirectCount) {
          this.updateUser(sponsor.id, { directCount: actualDirectCount });
          sponsorDirectCountSynced = true;
        }
      }
    }

    return {
      user,
      recoveredUser,
      relinkedPins: relink.relinked,
      sponsorDirectCountSynced
    };
  }

  static syncLockedIncomeWallet(userId?: string): {
    scanned: number;
    synced: number;
  } {
    const wallets = this.getWallets();
    const targetIds = userId ? new Set([userId]) : new Set(wallets.map((w) => w.userId));
    let synced = 0;

    for (const wallet of wallets) {
      if (!targetIds.has(wallet.userId)) continue;
      const txLockedIncomeTotal = this.computeLockedIncomeFromTransactions(wallet.userId);
      const lockedIncomeTotal = Math.max(0, Math.round(txLockedIncomeTotal * 100) / 100);

      if (Math.abs((wallet.lockedIncomeWallet || 0) - lockedIncomeTotal) > 0.0001) {
        wallet.lockedIncomeWallet = lockedIncomeTotal;
        synced += 1;
      }
    }

    if (synced > 0) {
      this.saveWallets(wallets);
    }

    return { scanned: targetIds.size, synced };
  }

  private static reconcileLockedIncomeState(userId: string): void {
    if (!userId) return;

    this.repairLockedIncomeTrackerFromTransactions(userId);
    this.syncLockedIncomeWallet(userId);

    const tracker = this.getUserHelpTracker(userId);
    const giveHelpLocked = Object.values(tracker.levels).reduce(
      (sum, state) => sum + (state.lockedAmount || 0),
      0
    );
    const wallet = this.getWallet(userId);
    if (wallet) {
      this.updateWallet(userId, {
        giveHelpLocked: Math.max(0, Math.round(giveHelpLocked * 100) / 100)
      });
    }
  }

  static rebuildLockedIncomeTracker(userId: string): {
    updated: boolean;
    levels: number;
    giveHelpLocked: number;
    lockedIncomeWallet: number;
  } {
    if (!userId) {
      return { updated: false, levels: 0, giveHelpLocked: 0, lockedIncomeWallet: 0 };
    }

    const trackerResult = this.repairLockedIncomeTrackerFromTransactions(userId);
    this.syncLockedIncomeWallet(userId);

    const tracker = this.getUserHelpTracker(userId);
    const giveHelpLocked = Object.values(tracker.levels).reduce(
      (sum, state) => sum + (state.lockedAmount || 0),
      0
    );
    const roundedGiveHelpLocked = Math.max(0, Math.round(giveHelpLocked * 100) / 100);
    const wallet = this.getWallet(userId);
    if (wallet) {
      this.updateWallet(userId, {
        giveHelpLocked: roundedGiveHelpLocked
      });
    }

    return {
      updated: trackerResult.updated,
      levels: trackerResult.levels,
      giveHelpLocked: roundedGiveHelpLocked,
      lockedIncomeWallet: wallet?.lockedIncomeWallet || 0
    };
  }

  static rebuildLockedIncomeTrackerForAllUsers(): {
    usersScanned: number;
    usersUpdated: number;
    levelsUpdated: number;
  } {
    const users = this.getUsers();
    let usersUpdated = 0;
    let levelsUpdated = 0;

    for (const user of users) {
      const result = this.rebuildLockedIncomeTracker(user.id);
      if (result.updated) {
        usersUpdated += 1;
        levelsUpdated += result.levels;
      }
    }

    return {
      usersScanned: users.length,
      usersUpdated,
      levelsUpdated
    };
  }

  // ==================== HELP TRACKERS ====================
  static getHelpTrackers(): UserHelpTracker[] {
    return this.getCached<UserHelpTracker[]>(DB_KEYS.HELP_TRACKERS, []);
  }

  static saveHelpTrackers(trackers: UserHelpTracker[]): void {
    this.setCached(DB_KEYS.HELP_TRACKERS, trackers);
  }

  static getGhostReceiveHelpRepairLogs(): GhostReceiveHelpRepairLog[] {
    return this.getCached<GhostReceiveHelpRepairLog[]>(DB_KEYS.GHOST_HELP_REPAIR_LOG, []);
  }

  static saveGhostReceiveHelpRepairLogs(logs: GhostReceiveHelpRepairLog[]): void {
    this.setCached(DB_KEYS.GHOST_HELP_REPAIR_LOG, logs);
  }

  static backfillReceiveHelpSenderIds(): {
    scanned: number;
    updated: number;
  } {
    const transactions = this.getTransactions();
    const users = this.getUsers();
    const byUserId = new Map(users.map((u) => [u.userId, u]));
    let scanned = 0;
    let updated = 0;

    for (const tx of transactions) {
      if (tx.type !== 'receive_help') continue;
      if (tx.fromUserId) continue;
      scanned += 1;
      const desc = tx.description || '';
      const match = desc.match(/from\s+(.+?)\s*\((\d{7})\)/i);
      if (!match) continue;
      const senderPublicId = match[2];
      const sender = byUserId.get(senderPublicId);
      if (!sender) continue;
      tx.fromUserId = sender.id;
      updated += 1;
    }

    if (updated > 0) {
      this.saveTransactions(transactions);
    }

    return { scanned, updated };
  }

  static getUserHelpTracker(userId: string): UserHelpTracker {
    const trackers = this.getHelpTrackers();
    const existing = trackers.find(t => t.userId === userId);
    if (existing) return existing;

    const created: UserHelpTracker = {
      userId,
      levels: {},
      lockedQueue: [],
      processedContributionKeys: {}
    };
    trackers.push(created);
    this.saveHelpTrackers(trackers);
    return created;
  }

  static saveUserHelpTracker(tracker: UserHelpTracker): void {
    const trackers = this.getHelpTrackers();
    const index = trackers.findIndex(t => t.userId === tracker.userId);
    if (index === -1) {
      trackers.push(tracker);
    } else {
      trackers[index] = tracker;
    }
    this.saveHelpTrackers(trackers);
  }

  private static hasProcessedContributionKey(tracker: UserHelpTracker, key: string): boolean {
    if (!key) return false;
    return !!tracker.processedContributionKeys?.[key];
  }

  private static markProcessedContributionKey(tracker: UserHelpTracker, key: string): void {
    if (!key) return;
    const now = new Date().toISOString();
    const updated: Record<string, string> = {
      ...(tracker.processedContributionKeys || {}),
      [key]: now
    };

    const entries = Object.entries(updated);
    const MAX_KEYS = 1500;
    const KEEP_KEYS = 1200;
    if (entries.length > MAX_KEYS) {
      entries.sort((a, b) => {
        const aTime = new Date(a[1] || 0).getTime();
        const bTime = new Date(b[1] || 0).getTime();
        return bTime - aTime;
      });
      tracker.processedContributionKeys = Object.fromEntries(entries.slice(0, KEEP_KEYS));
      return;
    }

    tracker.processedContributionKeys = updated;
  }

  static getPendingMatrixContributions(): PendingMatrixContribution[] {
    return this.getCached<PendingMatrixContribution[]>(DB_KEYS.MATRIX_PENDING_CONTRIBUTIONS, []);
  }

  static savePendingMatrixContributions(items: PendingMatrixContribution[]): void {
    this.setCached(DB_KEYS.MATRIX_PENDING_CONTRIBUTIONS, items);
  }

  private static dedupePendingMatrixContributions(): void {
    const items = this.getPendingMatrixContributions();
    if (items.length <= 1) return;

    const getTime = (item: PendingMatrixContribution) => {
      const parsed = new Date(item.createdAt || item.completedAt || '').getTime();
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const grouped = new Map<string, PendingMatrixContribution[]>();
    for (const item of items) {
      const key = `${item.fromUserId}|${item.toUserId}|${item.level}`;
      const bucket = grouped.get(key) || [];
      bucket.push(item);
      grouped.set(key, bucket);
    }

    const deduped: PendingMatrixContribution[] = [];
    let changed = false;

    for (const bucket of grouped.values()) {
      if (bucket.length === 1) {
        deduped.push(bucket[0]);
        continue;
      }

      changed = true;
      const completed = bucket
        .filter((item) => item.status === 'completed')
        .sort((a, b) => getTime(a) - getTime(b));
      if (completed.length > 0) {
        deduped.push(completed[0]);
        continue;
      }

      const pending = bucket
        .filter((item) => item.status === 'pending')
        .sort((a, b) => getTime(a) - getTime(b));
      if (pending.length > 0) {
        deduped.push(pending[0]);
        continue;
      }

      deduped.push(bucket.sort((a, b) => getTime(a) - getTime(b))[0]);
    }

    if (changed) {
      deduped.sort((a, b) => getTime(a) - getTime(b));
      this.savePendingMatrixContributions(deduped);
    }
  }

  private static enqueuePendingMatrixContribution(
    fromUserId: string,
    toUserId: string,
    level: number,
    side: 'left' | 'right'
  ): void {
    const items = this.getPendingMatrixContributions();
    const exists = items.some((i) =>
      i.fromUserId === fromUserId
      && i.toUserId === toUserId
      && i.level === level
    );
    if (exists) return;

    items.push({
      id: `pmc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fromUserId,
      toUserId,
      level,
      side,
      status: 'pending',
      createdAt: new Date().toISOString()
    });
    this.savePendingMatrixContributions(items);
  }

  static processPendingMatrixContributionsForUser(fromUserId: string, limit?: number): void {
    if (!fromUserId) return;
    this.dedupePendingMatrixContributions();

    // Build an ordered list of IDs to process (snapshot of pending items for this user).
    const initialItems = this.getPendingMatrixContributions();
    const pendingIds = initialItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.fromUserId === fromUserId && item.status === 'pending')
      .sort((a, b) => a.item.level - b.item.level || a.index - b.index)
      .map(({ item }) => item.id);
    if (pendingIds.length === 0) return;

    const fromUser = this.getUserById(fromUserId);
    const fromLabel = fromUser ? `${(fromUser as any).userId || fromUserId}` : fromUserId;
    console.warn(`[PENDING-PROC] Processing ${pendingIds.length} pending items for ${fromLabel}`);

    for (const itemId of pendingIds) {
      // Re-read from storage EVERY iteration to get fresh state
      // (nested calls during registerMatrixContribution may have modified storage).
      const freshItems = this.getPendingMatrixContributions();
      const freshItem = freshItems.find(i => i.id === itemId);
      if (!freshItem || freshItem.status !== 'pending') continue; // Already handled by nested call

      const toUser = this.getUserById(freshItem.toUserId);
      const toLabel = toUser ? `${(toUser as any).userId || freshItem.toUserId}` : freshItem.toUserId;
      const senderTracker = this.getUserHelpTracker(freshItem.fromUserId);
      const debitLevel = Math.max(1, freshItem.level - 1);
      const debitState = senderTracker.levels[String(debitLevel)];
      const senderWallet = this.getWallet(freshItem.fromUserId);
      console.warn(`[PENDING-ITEM] Level ${freshItem.level} → ${toLabel}: debitLevel=${debitLevel}, lockedAmount=$${debitState?.lockedAmount || 0}, lockedReceiveAmount=$${debitState?.lockedReceiveAmount || 0}, walletLocked=$${senderWallet?.lockedIncomeWallet || 0}`);

      // Pre-mark as completed and save BEFORE processing
      freshItem.status = 'completed';
      freshItem.completedAt = new Date().toISOString();
      this.savePendingMatrixContributions(freshItems);

      const ok = this.registerMatrixContribution(
        freshItem.toUserId,
        freshItem.level,
        freshItem.side,
        freshItem.fromUserId,
        { skipFromWalletDebit: false }
      );
      if (!ok) {
        console.warn(`[PENDING-ITEM] Level ${freshItem.level} → ${toLabel}: FAILED, rolling back`);
        // Rollback — re-read fresh state again to avoid overwriting nested changes
        const rollbackItems = this.getPendingMatrixContributions();
        const rollbackItem = rollbackItems.find(i => i.id === itemId);
        if (rollbackItem) {
          rollbackItem.status = 'pending';
          rollbackItem.completedAt = undefined;
          this.savePendingMatrixContributions(rollbackItems);
        }
        // Continue to try higher-level items instead of breaking — different levels
        // draw from different level-specific locked-income pools, so a failure at
        // level N does not necessarily prevent level N+1 from succeeding.
        continue;
      }
      console.warn(`[PENDING-ITEM] Level ${freshItem.level} → ${toLabel}: SUCCESS`);

      // If a limit is set, count successful items and stop when reached.
      if (limit !== undefined) {
        limit--;
        if (limit <= 0) break;
      }
    }
  }

  /**
   * Sweep ALL users that have pending matrix contributions and attempt to
   * process them.  This catches cascading help chains where an ancestor
   * received locked income from a descendant's activation and can now fund
   * their own higher-level contributions.
   *
   * To avoid infinite loops, the sweep runs at most `maxPasses` rounds.
   * Each round iterates over every distinct sender that still has pending
   * items.  If no progress is made in a round (zero items flipped from
   * pending to completed), the sweep stops early.
   */
  static sweepPendingContributions(maxPasses = 12): void {
    for (let pass = 0; pass < maxPasses; pass++) {
      const items = this.getPendingMatrixContributions();
      const pendingSenders = new Set<string>();
      for (const item of items) {
        if (item.status === 'pending') {
          pendingSenders.add(item.fromUserId);
        }
      }
      if (pendingSenders.size === 0) return;

      const beforeCount = items.filter(i => i.status === 'pending').length;

      for (const senderId of pendingSenders) {
        this.processPendingMatrixContributionsForUser(senderId);
      }

      const afterItems = this.getPendingMatrixContributions();
      const afterCount = afterItems.filter(i => i.status === 'pending').length;
      // No progress — stop sweeping.
      if (afterCount >= beforeCount) return;
    }
  }

  /**
   * Repair orphaned pending contributions whose locked income was consumed by
   * the old executeGiveHelp fallback.  For each user with pending items, check
   * whether their first-two at the required debit level completed; if so,
   * re-inject the expected locked income into their wallet / tracker so the
   * sweep can process them.
   */
  static repairAndSweepPendingContributions(): { repairedUsers: number; processedItems: number; stillPending: number } {
    const allPending = this.getPendingMatrixContributions().filter(i => i.status === 'pending');
    if (allPending.length === 0) return { repairedUsers: 0, processedItems: 0, stillPending: 0 };

    // Group pending items by sender
    const bySender = new Map<string, typeof allPending>();
    for (const item of allPending) {
      const list = bySender.get(item.fromUserId) || [];
      list.push(item);
      bySender.set(item.fromUserId, list);
    }

    let repairedUsers = 0;

    for (const [senderId, items] of bySender) {
      const sender = this.getUserById(senderId);
      if (!sender || !this.isNetworkActiveUser(sender)) continue;

      const tracker = this.getUserHelpTracker(senderId);
      const wallet = this.getWallet(senderId);
      if (!wallet) continue;

      let walletInjection = 0;

      for (const item of items) {
        // The pending at level L debits locked income from level L-1.
        const debitLevel = Math.max(1, item.level - 1);
        const debitKey = String(debitLevel);
        const debitState = tracker.levels[debitKey];
        if (!debitState) continue;

        // Only repair if first-two at the debit level completed (receiveEvents >= 2)
        if ((debitState.receiveEvents || 0) < 2) continue;

        const levelData = helpDistributionTable[item.level - 1];
        if (!levelData) continue;
        const neededAmount = levelData.perUserHelp;

        // Check if locked income at the debit level was consumed by executeGiveHelp fallback.
        // If lockedAmount is 0 but first-two completed, the income was consumed by the fallback.
        const currentLocked = debitState.lockedAmount || 0;
        const currentLockedReceive = debitState.lockedReceiveAmount || 0;
        const availableAtLevel = currentLocked + currentLockedReceive;

        if (availableAtLevel >= neededAmount) continue; // Already has enough — no repair needed

        // Re-inject the missing locked income at the debit level.
        const deficit = neededAmount - availableAtLevel;
        debitState.lockedAmount = (debitState.lockedAmount || 0) + deficit;
        tracker.levels[debitKey] = debitState;
        walletInjection += deficit;
      }

      if (walletInjection > 0) {
        this.saveUserHelpTracker(tracker);
        this.updateWallet(senderId, {
          lockedIncomeWallet: (wallet.lockedIncomeWallet || 0) + walletInjection,
          giveHelpLocked: (wallet.giveHelpLocked || 0) + walletInjection
        });
        repairedUsers++;
      }
    }

    // Now sweep to process the repaired items
    const beforeCount = this.getPendingMatrixContributions().filter(i => i.status === 'pending').length;
    this.sweepPendingContributions(5);
    const afterItems = this.getPendingMatrixContributions();
    const afterCount = afterItems.filter(i => i.status === 'pending').length;

    return {
      repairedUsers,
      processedItems: beforeCount - afterCount,
      stillPending: afterCount
    };
  }

  private static getPendingMatrixContributionBlockReason(item: PendingMatrixContribution): string | null {
    if (item.level < 1 || item.level > helpDistributionTable.length) {
      return `Invalid level ${item.level}.`;
    }

    const recipient = this.getUserById(item.toUserId);
    if (!recipient) return 'Recipient user not found.';
    if (!this.isNetworkActiveUser(recipient)) {
      return 'Recipient account is inactive or blocked.';
    }

    const recipientWallet = this.getWallet(recipient.id);
    if (!recipientWallet) return 'Recipient wallet not found.';

    const sender = item.fromUserId ? this.getUserById(item.fromUserId) : undefined;
    if (item.fromUserId && !sender) return 'Sender user not found.';
    if (!sender) return null;
    if (!this.isNetworkActiveUser(sender)) {
      return 'Sender account is inactive or blocked.';
    }

    const senderWallet = this.getWallet(sender.id);
    if (!senderWallet) return 'Sender wallet not found.';

    return null;
  }

  private static getPendingMatrixContributionExecutionBlockReason(
    item: PendingMatrixContribution,
    simulatedLockedWallet: number,
    simulatedLevelLocks: Map<number, { lockedAmount: number; lockedReceiveAmount: number }>
  ): string | null {
    const basicReason = this.getPendingMatrixContributionBlockReason(item);
    if (basicReason) return basicReason;

    const levelData = helpDistributionTable[item.level - 1];
    const requiredAmount = levelData?.perUserHelp || 0;
    if (requiredAmount <= 0) {
      return `Invalid help amount configured for level ${item.level}.`;
    }

    const debitLevel = Math.max(1, item.level - 1);
    const sourceState = simulatedLevelLocks.get(debitLevel) || {
      lockedAmount: 0,
      lockedReceiveAmount: 0
    };
    const sourcePool = (sourceState.lockedAmount || 0) + (sourceState.lockedReceiveAmount || 0);
    const formatAmount = (value: number) => `$${value.toFixed(2)}`;

    if (simulatedLockedWallet + 0.0001 < requiredAmount) {
      return `Needs ${formatAmount(requiredAmount)} in locked wallet, but sender currently has only ${formatAmount(simulatedLockedWallet)} available.`;
    }

    if (sourcePool + 0.0001 < requiredAmount) {
      return `Needs ${formatAmount(requiredAmount)} from level ${debitLevel} locked pool, but only ${formatAmount(sourcePool)} is available there (first-two ${formatAmount(sourceState.lockedAmount || 0)}, referral-rule ${formatAmount(sourceState.lockedReceiveAmount || 0)}).`;
    }

    return null;
  }

  private static buildPendingMatrixQueueDebugRows(fromUserId: string): {
    rows: PendingMatrixDebugItem[];
    blockedAtItemId: string | null;
    blockedReason: string | null;
  } {
    const pending = this.getPendingMatrixContributions()
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.fromUserId === fromUserId && item.status === 'pending')
      .sort((a, b) => a.item.level - b.item.level || a.index - b.index)
      .map(({ item }) => item);

    const sender = this.getUserById(fromUserId);
    const senderWallet = sender ? this.getWallet(sender.id) : undefined;
    const senderTracker = sender ? this.getUserHelpTracker(sender.id) : undefined;
    let simulatedLockedWallet = senderWallet?.lockedIncomeWallet || 0;
    const simulatedLevelLocks = new Map<number, { lockedAmount: number; lockedReceiveAmount: number }>();

    if (senderTracker) {
      for (const [key, state] of Object.entries(senderTracker.levels || {})) {
        const level = Number(key);
        if (!Number.isInteger(level) || level < 1 || level > helpDistributionTable.length) continue;
        simulatedLevelLocks.set(level, {
          lockedAmount: state?.lockedAmount || 0,
          lockedReceiveAmount: state?.lockedReceiveAmount || 0
        });
      }
    }

    let blockedAtItemId: string | null = null;
    let blockedReason: string | null = null;
    const rows: PendingMatrixDebugItem[] = [];

    for (const item of pending) {
      const recipient = this.getUserById(item.toUserId);
      const toUserId = recipient?.userId || item.toUserId;
      const toUserName = recipient?.fullName || 'Unknown user';

      if (blockedAtItemId) {
        rows.push({
          id: item.id,
          level: item.level,
          side: item.side,
          toUserId,
          toUserName,
          createdAt: item.createdAt,
          status: 'blocked',
          reason: `Blocked by earlier failed item ${blockedAtItemId}.`
        });
        continue;
      }

      const reason = this.getPendingMatrixContributionExecutionBlockReason(
        item,
        simulatedLockedWallet,
        simulatedLevelLocks
      );

      if (reason) {
        blockedAtItemId = item.id;
        blockedReason = reason;
        rows.push({
          id: item.id,
          level: item.level,
          side: item.side,
          toUserId,
          toUserName,
          createdAt: item.createdAt,
          status: 'blocked',
          reason
        });
        continue;
      }

      const requiredAmount = helpDistributionTable[item.level - 1]?.perUserHelp || 0;
      const debitLevel = Math.max(1, item.level - 1);
      const sourceState = simulatedLevelLocks.get(debitLevel) || {
        lockedAmount: 0,
        lockedReceiveAmount: 0
      };
      const totalSourceBefore = (sourceState.lockedAmount || 0) + (sourceState.lockedReceiveAmount || 0);
      const takeLockedReceive = Math.min(sourceState.lockedReceiveAmount || 0, requiredAmount);
      const takeLockedAmount = Math.max(0, requiredAmount - takeLockedReceive);

      rows.push({
        id: item.id,
        level: item.level,
        side: item.side,
        toUserId,
        toUserName,
        createdAt: item.createdAt,
        status: 'ready',
        reason: `Ready to process using $${requiredAmount.toFixed(2)} from level ${debitLevel} locked pool. Wallet locked: $${simulatedLockedWallet.toFixed(2)}. Source pool before send: $${totalSourceBefore.toFixed(2)}.`
      });

      simulatedLockedWallet = Math.max(0, simulatedLockedWallet - requiredAmount);
      sourceState.lockedReceiveAmount = Math.max(0, (sourceState.lockedReceiveAmount || 0) - takeLockedReceive);
      sourceState.lockedAmount = Math.max(0, (sourceState.lockedAmount || 0) - takeLockedAmount);
      simulatedLevelLocks.set(debitLevel, sourceState);
    }

    return {
      rows,
      blockedAtItemId,
      blockedReason
    };
  }

  static getPendingMatrixContributionsDebug(fromUserId: string): PendingMatrixDebugReport {
    this.reconcileLockedIncomeState(fromUserId);
    const { rows, blockedAtItemId, blockedReason } = this.buildPendingMatrixQueueDebugRows(fromUserId);

    const levelMap = new Map<number, PendingMatrixDebugLevelRow>();
    for (const row of rows) {
      const existing = levelMap.get(row.level) || { level: row.level, pending: 0, blocked: 0, ready: 0 };
      existing.pending += 1;
      if (row.status === 'blocked') existing.blocked += 1;
      if (row.status === 'ready') existing.ready += 1;
      levelMap.set(row.level, existing);
    }

    return {
      fromUserId,
      totalPending: rows.length,
      blockedAtItemId,
      blockedReason,
      levels: Array.from(levelMap.values()).sort((a, b) => a.level - b.level),
      items: rows
    };
  }

  static getIncomingPendingMatrixContributionsDebug(toUserId: string): PendingMatrixIncomingDebugReport {
    if (!toUserId) {
      return {
        toUserId,
        totalPending: 0,
        blockedSenders: 0,
        levels: [],
        items: []
      };
    }

    const pendingWithIndex = this.getPendingMatrixContributions()
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === 'pending');

    const senderQueues = new Map<string, Array<{ item: PendingMatrixContribution; index: number }>>();
    for (const entry of pendingWithIndex) {
      const queue = senderQueues.get(entry.item.fromUserId) || [];
      queue.push(entry);
      senderQueues.set(entry.item.fromUserId, queue);
    }

    const rows: PendingMatrixIncomingDebugItem[] = [];
    for (const [fromUserId, queue] of senderQueues.entries()) {
      const ordered = [...queue].sort((a, b) => a.item.level - b.item.level || a.index - b.index);
      const simulated = this.buildPendingMatrixQueueDebugRows(fromUserId);
      const rowMap = new Map(simulated.rows.map((row) => [row.id, row]));

      for (const { item } of ordered) {
        if (item.toUserId !== toUserId) continue;
        const sender = this.getUserById(fromUserId);
        const simulatedRow = rowMap.get(item.id);
        rows.push({
          id: item.id,
          level: item.level,
          side: item.side,
          fromUserId: sender?.userId || fromUserId,
          fromUserName: sender?.fullName || 'Unknown user',
          createdAt: item.createdAt,
          status: simulatedRow?.status || 'blocked',
          reason: simulatedRow?.reason || 'Unable to evaluate pending item.'
        });
      }
    }

    const levelMap = new Map<number, PendingMatrixIncomingDebugLevelRow>();
    for (const row of rows) {
      const existing = levelMap.get(row.level) || { level: row.level, pending: 0, blocked: 0, ready: 0 };
      existing.pending += 1;
      if (row.status === 'blocked') existing.blocked += 1;
      if (row.status === 'ready') existing.ready += 1;
      levelMap.set(row.level, existing);
    }

    return {
      toUserId,
      totalPending: rows.length,
      blockedSenders: new Set(rows.filter((row) => row.status === 'blocked').map((row) => row.fromUserId)).size,
      levels: Array.from(levelMap.values()).sort((a, b) => a.level - b.level),
      items: rows
    };
  }

  static getHelpFlowDebugEntries(): HelpFlowDebugEntry[] {
    return this.getCached<HelpFlowDebugEntry[]>(HELP_FLOW_DEBUG_KEY, []);
  }

  static getHelpFlowDebugForUser(
    userId: string,
    view: 'sent' | 'received' = 'sent',
    limit = 50
  ): HelpFlowDebugEntry[] {
    if (!userId) return [];
    const entries = this.getHelpFlowDebugEntries()
      .filter((entry) => (view === 'sent' ? entry.fromUserId === userId : entry.toUserId === userId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return entries.slice(0, Math.max(0, limit));
  }

  static clearHelpFlowDebugForUser(userId: string): void {
    if (!userId) return;
    const entries = this.getHelpFlowDebugEntries()
      .filter((entry) => entry.fromUserId !== userId && entry.toUserId !== userId);
    this.setCached(HELP_FLOW_DEBUG_KEY, entries);
  }

  private static addHelpFlowDebugEntry(entry: HelpFlowDebugEntry): void {
    const entries = this.getHelpFlowDebugEntries();
    entries.push(entry);
    const trimmed = entries.length > 500 ? entries.slice(entries.length - 500) : entries;
    this.setCached(HELP_FLOW_DEBUG_KEY, trimmed);
  }

  static getDuplicateContributionBlockEntries(limit = 200): DuplicateContributionBlockEntry[] {
    const entries = this.getCached<DuplicateContributionBlockEntry[]>(DUPLICATE_CONTRIBUTION_BLOCK_KEY, [])
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return entries.slice(0, Math.max(0, limit));
  }

  static clearDuplicateContributionBlockEntries(): void {
    this.setCached(DUPLICATE_CONTRIBUTION_BLOCK_KEY, []);
  }

  private static addDuplicateContributionBlockEntry(entry: DuplicateContributionBlockEntry): void {
    const entries = this.getCached<DuplicateContributionBlockEntry[]>(DUPLICATE_CONTRIBUTION_BLOCK_KEY, []);
    const lastSimilar = entries.length > 0 ? entries[entries.length - 1] : null;
    if (
      lastSimilar
      && lastSimilar.contributionKey === entry.contributionKey
      && Math.abs(new Date(entry.createdAt).getTime() - new Date(lastSimilar.createdAt).getTime()) <= 2000
    ) {
      return;
    }

    entries.push(entry);
    const trimmed = entries.length > 500 ? entries.slice(entries.length - 500) : entries;
    this.setCached(DUPLICATE_CONTRIBUTION_BLOCK_KEY, trimmed);
  }

  static getCumulativeDirectRequired(level: number): number {
    if (level <= 1) return 0;
    let total = 0;
    for (let i = 1; i <= level; i++) {
      const levelData = helpDistributionTable[i - 1];
      if (!levelData) break;
      total += levelData.directRequired;
    }
    return total;
  }

  static isNetworkActiveUser(user?: User | null): boolean {
    if (!user) return false;
    if (user.accountStatus === 'temp_blocked' || user.accountStatus === 'permanent_blocked') {
      return true;
    }
    if (user.accountStatus !== 'active') return false;
    return !!user.isActive || user.deactivationReason === 'direct_referral_deadline';
  }

  static getEffectiveDirectCount(user: User): number {
    const computedDirect = this.getUsers().filter((member) =>
      !member.isAdmin
      && member.sponsorId === user.userId
      && this.isNetworkActiveUser(member)
    ).length;
    return Math.max(user.directCount || 0, computedDirect);
  }

  static isQualifiedForLevel(user: User, level: number): boolean {
    if (level < 1 || level > helpDistributionTable.length) return false;
    const requiredDirect = this.getCumulativeDirectRequired(level);
    return this.getEffectiveDirectCount(user) >= requiredDirect;
  }

  private static buildMatrixChildrenMap(matrix: MatrixNode[]): Map<string, string[]> {
    const nodeMap = new Map(matrix.map((node) => [node.userId, node]));
    const childMap = new Map<string, Set<string>>();

    const pushChild = (parentUserId: string | undefined, childUserId: string | undefined) => {
      if (!parentUserId || !childUserId) return;
      if (!nodeMap.has(parentUserId) || !nodeMap.has(childUserId)) return;
      let bucket = childMap.get(parentUserId);
      if (!bucket) {
        bucket = new Set<string>();
        childMap.set(parentUserId, bucket);
      }
      bucket.add(childUserId);
    };

    // Primary topology source.
    for (const node of matrix) {
      pushChild(node.parentId, node.userId);
    }

    // Fallback for legacy rows where parentId might be missing but child pointers exist.
    for (const node of matrix) {
      pushChild(node.userId, node.leftChild);
      pushChild(node.userId, node.rightChild);
    }

    const normalized = new Map<string, string[]>();
    for (const [parent, children] of childMap.entries()) {
      normalized.set(parent, Array.from(children));
    }
    return normalized;
  }

  private static getMatrixDepthBetween(uplineUserId: string, downlineUserId: string): number | null {
    if (!uplineUserId || !downlineUserId) return null;
    if (uplineUserId === downlineUserId) return 0;
    const matrix = this.getMatrix();
    if (!matrix.length) return null;

    const childrenMap = this.buildMatrixChildrenMap(matrix);
    const visited = new Set<string>([uplineUserId]);
    const queue: Array<{ userId: string; depth: number }> = [{ userId: uplineUserId, depth: 0 }];
    const maxDepth = helpDistributionTable.length;

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;
      const children = childrenMap.get(current.userId) || [];
      for (const childUserId of children) {
        if (visited.has(childUserId)) continue;
        if (childUserId === downlineUserId) return current.depth + 1;
        visited.add(childUserId);
        queue.push({ userId: childUserId, depth: current.depth + 1 });
      }
    }

    return null;
  }

  static getCurrentMatrixLevel(userId: string): number {
    const tracker = this.getUserHelpTracker(userId);
    let trackerLevel = 0;

    for (const levelData of helpDistributionTable) {
      const state = tracker.levels[String(levelData.level)];
      if (!state || state.receiveEvents < levelData.users) break;
      trackerLevel = levelData.level;
    }

    const user = this.getUserById(userId);
    if (!user) return trackerLevel;

    const matrix = this.getMatrix();
    const childrenMap = this.buildMatrixChildrenMap(matrix);
    const rootExists = matrix.some((node) => node.userId === user.userId);
    if (!rootExists) return trackerLevel;

    let matrixDepthLevel = 0;
    const queue: Array<{ nodeUserId: string; depth: number }> = [{ nodeUserId: user.userId, depth: 0 }];
    const visited = new Set<string>([user.userId]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = childrenMap.get(current.nodeUserId) || [];
      for (const childUserId of children) {
        if (visited.has(childUserId)) continue;
        const nextDepth = current.depth + 1;
        matrixDepthLevel = Math.max(matrixDepthLevel, nextDepth);
        visited.add(childUserId);
        queue.push({ nodeUserId: childUserId, depth: nextDepth });
      }
    }

    const cappedMatrixLevel = Math.min(matrixDepthLevel, helpDistributionTable.length);
    return Math.max(trackerLevel, cappedMatrixLevel);
  }

  /**
   * Highest level where the user has received all help for that level.
   * This is a completion display metric, separate from direct-referral qualification.
   */
  static getQualifiedLevel(userRef: string): number {
    const user = this.resolveUserByRef(userRef);
    if (!user) return 0;
    const tracker = this.getUserHelpTracker(user.id);
    let level = 0;
    for (const ld of helpDistributionTable) {
      const trackerReceive = tracker.levels[String(ld.level)]?.receiveEvents || 0;
      const observedReceive = this.getObservedReceiveEventCount(user.id, ld.level);
      const manualCompletion = !!tracker.levels[String(ld.level)]?.manualCompletion;
      const effectiveReceive = manualCompletion ? ld.users : Math.max(trackerReceive, observedReceive);
      if (effectiveReceive < ld.users) break;
      level = ld.level;
    }
    return level;
  }

  static recalculateQualifiedLevel(userRef: string): { before: number; after: number; syncedLevels: number } {
    const user = this.resolveUserByRef(userRef);
    if (!user) {
      throw new Error('User not found');
    }

    const before = this.getQualifiedLevel(user.id);
    const tracker = this.getUserHelpTracker(user.id);
    let syncedLevels = 0;

    for (const ld of helpDistributionTable) {
      const state = this.ensureLevelTrackerState(tracker, ld.level);
      const observedReceive = this.getObservedReceiveEventCount(user.id, ld.level);
      const nextReceiveEvents = state.manualCompletion
        ? Math.max(state.receiveEvents || 0, ld.users)
        : observedReceive;

      if (nextReceiveEvents !== (state.receiveEvents || 0)) {
        state.receiveEvents = nextReceiveEvents;
        tracker.levels[String(ld.level)] = state;
        syncedLevels += 1;
      }
    }

    if (syncedLevels > 0) {
      this.saveUserHelpTracker(tracker);
    }

    const after = this.getQualifiedLevel(user.id);
    return { before, after, syncedLevels };
  }

  static markLevelHelpComplete(userRef: string, level: number): { before: number; after: number; level: number } {
    const user = this.resolveUserByRef(userRef);
    if (!user) {
      throw new Error('User not found');
    }
    if (!Number.isFinite(level) || level < 1 || level > helpDistributionTable.length) {
      throw new Error('Invalid level');
    }

    const before = this.getQualifiedLevel(user.id);
    const tracker = this.getUserHelpTracker(user.id);
    const state = this.ensureLevelTrackerState(tracker, level);
    const levelData = helpDistributionTable[level - 1];

    state.receiveEvents = Math.max(state.receiveEvents || 0, levelData.users);
    state.receivedAmount = Math.max(state.receivedAmount || 0, levelData.totalReceiveHelp);
    state.manualCompletion = true;
    tracker.levels[String(level)] = state;
    this.saveUserHelpTracker(tracker);

    const after = this.getQualifiedLevel(user.id);
    return { before, after, level };
  }

  static getMatrixNodesCountAtLevel(userId: string, targetDepth: number): number {
    if (targetDepth < 1 || targetDepth > helpDistributionTable.length) return 0;

    const user = this.getUserById(userId);
    if (!user) return 0;

    const matrix = this.getMatrix();
    const childrenMap = this.buildMatrixChildrenMap(matrix);
    const rootExists = matrix.some((node) => node.userId === user.userId);
    if (!rootExists) return 0;

    let countAtDepth = 0;
    const queue: Array<{ nodeUserId: string; depth: number }> = [{ nodeUserId: user.userId, depth: 0 }];
    const visited = new Set<string>([user.userId]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth === targetDepth) {
        countAtDepth++;
        continue;
      }
      if (current.depth > targetDepth) continue;

      const children = childrenMap.get(current.nodeUserId) || [];
      for (const childUserId of children) {
        if (visited.has(childUserId)) continue;
        visited.add(childUserId);
        queue.push({ nodeUserId: childUserId, depth: current.depth + 1 });
      }
    }

    return countAtDepth;
  }


  static getLevelFillProgress(userRef: string): { level: number; filled: number; required: number } {
    const user = this.resolveUserByRef(userRef);
    const fallbackRequired = helpDistributionTable[0]?.users || 0;
    if (!user) {
      return { level: 1, filled: 0, required: fallbackRequired };
    }

    const level = Math.max(1, this.getCurrentMatrixLevel(user.id));
    const required = helpDistributionTable[level - 1]?.users || 0;
    const filled = this.getMatrixNodesCountAtLevel(user.id, level);
    return { level, filled, required };
  }

  static getLockedIncomeBreakdown(userId: string): LockedIncomeBreakdownItem[] {
    const user = this.getUserById(userId);
    if (!user) return [];

    const currentDirect = this.getEffectiveDirectCount(user);
    const rows: LockedIncomeBreakdownItem[] = [];
    const txLevelMap = new Map<number, { firstTwo: number; qualification: number }>();

    const ensureTxLevel = (level: number) => {
      const existing = txLevelMap.get(level);
      if (existing) return existing;
      const created = { firstTwo: 0, qualification: 0 };
      txLevelMap.set(level, created);
      return created;
    };

    const txs = this.getTransactions()
      .filter((t) => t.userId === userId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const consumeTxDerivedLockedAcrossLevels = (preferredLevel: number, amount: number, allowCrossLevel: boolean) => {
      let remaining = Math.max(0, amount);
      if (remaining <= 0) return;

      if (!allowCrossLevel) {
        // Strict rule: only consume locked income from the same level.
        const level = preferredLevel;
        const slot = ensureTxLevel(level);
        const usedQualification = Math.min(Math.max(0, slot.qualification), remaining);
        slot.qualification -= usedQualification;
        remaining -= usedQualification;

        if (remaining <= 0) return;
        const usedFirstTwo = Math.min(Math.max(0, slot.firstTwo), remaining);
        slot.firstTwo -= usedFirstTwo;
        return;
      }

      const levels = Array.from(txLevelMap.keys())
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= helpDistributionTable.length)
        .sort((a, b) => a - b);
      const ordered = levels.includes(preferredLevel)
        ? [preferredLevel, ...levels.filter((l) => l !== preferredLevel)]
        : levels;

      // Legacy behavior: consume across levels to cover the give-help amount.
      for (const level of ordered) {
        if (remaining <= 0) break;
        const slot = ensureTxLevel(level);
        const used = Math.min(Math.max(0, slot.qualification), remaining);
        slot.qualification -= used;
        remaining -= used;
      }
      for (const level of ordered) {
        if (remaining <= 0) break;
        const slot = ensureTxLevel(level);
        const used = Math.min(Math.max(0, slot.firstTwo), remaining);
        slot.firstTwo -= used;
        remaining -= used;
      }
    };

    for (const tx of txs) {
      const level = this.resolveTransactionLevel(tx);
      if (!level) continue;
      const desc = (tx.description || '').toLowerCase();
      const slot = ensureTxLevel(level);

      if (tx.type === 'receive_help' && tx.amount > 0) {
        if (this.isLockedFirstTwoReceiveDescription(desc)) {
          slot.firstTwo += tx.amount;
        } else if (this.isLockedQualifiedReceiveDescription(desc)) {
          slot.qualification += tx.amount;
        } else if (this.isReleasedLockedReceiveDescription(desc)) {
          slot.qualification -= tx.amount;
        }
        continue;
      }

      if (tx.type === 'give_help' && desc.includes('from locked income')) {
        const allowCrossLevel = this.shouldUseLegacyLockedConsumption(tx);
        const sourceLevel = this.getLockedIncomeSourceLevel(tx, level);
        consumeTxDerivedLockedAcrossLevels(sourceLevel, Math.abs(tx.amount), allowCrossLevel);
      }
    }

    for (const levelData of helpDistributionTable) {
      const level = levelData.level;
      const txDerived = txLevelMap.get(level) || { firstTwo: 0, qualification: 0 };
      // Prefer transaction-derived values here so the popup stays aligned with the
      // real wallet/ledger state even if a level tracker entry went stale.
      const lockedFirstTwoAmount = Math.max(0, txDerived.firstTwo);
      const lockedQualificationAmount = Math.max(0, txDerived.qualification);
      const lockedAmount = lockedFirstTwoAmount + lockedQualificationAmount;
      if (lockedAmount <= 0) continue;

      const requiredDirect = this.getCumulativeDirectRequired(level);
      const remainingDirect = Math.max(0, requiredDirect - currentDirect);
      const reasons: string[] = [];

      if (lockedQualificationAmount > 0) {
        reasons.push(
          remainingDirect > 0
            ? `Locked due to Direct Referral Rule: Level ${level} requires ${requiredDirect} directs, you currently have ${currentDirect}.`
            : `Locked receive for Level ${level} is waiting for automatic release.`
        );
      }
      if (lockedFirstTwoAmount > 0) {
        reasons.push(`Locked because first two received helps at this level are reserved for auto give-help settlement.`);
      }

      rows.push({
        level,
        lockedAmount,
        lockedFirstTwoAmount,
        lockedQualificationAmount,
        requiredDirect,
        currentDirect,
        remainingDirect,
        qualified: remainingDirect === 0,
        reason: reasons.join(' ')
      });
    }

    return rows.sort((a, b) => a.level - b.level);
  }

  private static isTourQualifiedForLevel(user: User, tracker: UserHelpTracker, level: number): boolean {
    const levelData = helpDistributionTable[level - 1];
    if (!levelData) return false;
    const state = tracker.levels[String(level)];
    const trackerReceiveEvents = state?.receiveEvents || 0;
    const observedReceiveEvents = this.getObservedReceiveEventCount(user.id, level);
    const effectiveReceiveEvents = Math.max(trackerReceiveEvents, observedReceiveEvents);
    const hasFullLevelHelp = effectiveReceiveEvents >= levelData.users;
    const hasFullMatrixLevel = this.getMatrixNodesCountAtLevel(user.id, level) >= levelData.users;
    const hasDirectQualification = this.isQualifiedForLevel(user, level);
    return hasFullLevelHelp && hasFullMatrixLevel && hasDirectQualification;
  }

  static isTourQualified(userRef: string, level: number): boolean {
    const user = this.resolveUserByRef(userRef);
    if (!user) return false;
    const tracker = this.getUserHelpTracker(user.id);
    return this.isTourQualifiedForLevel(user, tracker, level);
  }

  static syncUserAchievements(userId: string): User | null {
    const user = this.getUserById(userId);
    if (!user) return null;

    const tracker = this.getUserHelpTracker(userId);
    const current = user.achievements || {
      nationalTour: false,
      internationalTour: false,
      familyTour: false
    };
    const next = { ...current };
    const now = new Date().toISOString();
    let changed = false;

    const nationalTourQualified = this.isTourQualifiedForLevel(user, tracker, 4);
    if ((!!next.nationalTour) !== nationalTourQualified) {
      next.nationalTour = nationalTourQualified;
      next.nationalTourDate = nationalTourQualified ? (next.nationalTourDate || now) : undefined;
      changed = true;
    }

    const internationalTourQualified = this.isTourQualifiedForLevel(user, tracker, 5);
    if ((!!next.internationalTour) !== internationalTourQualified) {
      next.internationalTour = internationalTourQualified;
      next.internationalTourDate = internationalTourQualified ? (next.internationalTourDate || now) : undefined;
      changed = true;
    }

    const familyTourQualified = this.isTourQualifiedForLevel(user, tracker, 6);
    if ((!!next.familyTour) !== familyTourQualified) {
      next.familyTour = familyTourQualified;
      next.familyTourDate = familyTourQualified ? (next.familyTourDate || now) : undefined;
      changed = true;
    }

    if (!changed) return user;
    return this.updateUser(userId, { achievements: next });
  }

  static getRelativeSide(ancestorUserId: string, descendantUserId: string): 'left' | 'right' | null {
    const matrix = this.getMatrix();
    const nodeMap = new Map(matrix.map(m => [m.userId, m]));
    const ancestorNode = nodeMap.get(ancestorUserId);
    if (!ancestorNode) return null;

    let currentUserId = descendantUserId;
    while (true) {
      const currentNode = nodeMap.get(currentUserId);
      if (!currentNode || !currentNode.parentId) return null;
      if (currentNode.parentId === ancestorUserId) {
        if (ancestorNode.leftChild === currentUserId) return 'left';
        if (ancestorNode.rightChild === currentUserId) return 'right';
        // Fallback to stored position when child pointers are stale/missing.
        if (currentNode.position === 0) return 'left';
        if (currentNode.position === 1) return 'right';
        return null;
      }
      currentUserId = currentNode.parentId;
    }
  }

  private static getLockedFirstTwoReceiveCount(userId: string, level: number): number {
    if (this._bulkRebuildMode) {
      const tracker = this.getUserHelpTracker(userId);
      const state = tracker.levels[String(level)];
      const receiveEvents = Math.max(0, Math.floor(Number(state?.receiveEvents || 0)));
      return Math.min(2, receiveEvents);
    }

    const txs = this.getTransactions();
    const observed = txs.filter((tx) =>
      tx.userId === userId
      && tx.type === 'receive_help'
      && this.getUnsettledLockedReceiveEffectiveAmount(tx, txs) > 0
      && this.isLockedFirstTwoReceiveDescription(tx.description, level)
    ).length;
    return Math.min(2, observed);
  }

  private static getObservedReceiveEventCount(userId: string, level: number): number {
    // Count only real receive-help events for the level.
    // Exclude release events because they are wallet unlock bookkeeping, not new receives.
    // Also collapse near-identical duplicate receive rows from the same sender/level/amount
    // so accidental duplicate credits do not block legitimate future help routing.
    const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
    const allTransactions = this.getTransactions();
    const relevant = allTransactions
      .filter((tx) => {
        if (tx.userId !== userId) return false;
        if (tx.type !== 'receive_help') return false;
        if (!(this.getUnsettledLockedReceiveEffectiveAmount(tx, allTransactions) > 0)) return false;
        const txLevel = Number(tx.level);
        if (!Number.isFinite(txLevel) || txLevel !== level) return false;
        if (this.isReleasedLockedReceiveDescription(tx.description, level)) return false;
        return true;
      })
      .sort((a, b) => this.getTransactionTime(a) - this.getTransactionTime(b));

    const seen = new Map<string, number>();
    let count = 0;

    for (const tx of relevant) {
      const effectiveAmount = this.getUnsettledLockedReceiveEffectiveAmount(tx, allTransactions);
      const key = `${tx.fromUserId || ''}__${Math.abs(Number(effectiveAmount || 0)).toFixed(2)}__${level}`;
      const txTime = this.getTransactionTime(tx);
      const lastSeenTime = seen.get(key);
      if (lastSeenTime !== undefined && Math.abs(txTime - lastSeenTime) <= DUPLICATE_WINDOW_MS) {
        continue;
      }
      seen.set(key, txTime);
      count += 1;
    }

    return count;
  }

  private static canReceiveAtLevel(userId: string, level: number): boolean {
    const levelData = helpDistributionTable[level - 1];
    if (!levelData) return false;
    const tracker = this.getUserHelpTracker(userId);
    const state = this.ensureLevelTrackerState(tracker, level);
    if (!this._bulkRebuildMode && !state.manualCompletion) {
      const observed = this.getObservedReceiveEventCount(userId, level);
      if (observed !== (state.receiveEvents || 0)) {
        state.receiveEvents = observed;
        tracker.levels[String(level)] = state;
        this.saveUserHelpTracker(tracker);
      }
    }
    return (state.receiveEvents || 0) < levelData.users;
  }

  private static findEligibleUplineForGiveHelp(user: User, level: number): User | null {
    // Route strictly by level depth:
    // level-1 -> immediate upline, level-2 -> upper upline, etc.
    let currentUplineUserId = user.parentId || user.sponsorId;
    let depth = 1;
    while (currentUplineUserId) {
      const upline = this.getUserByUserId(currentUplineUserId);
      if (!upline) break;

      if (depth === level) {
        if (
          this.isNetworkActiveUser(upline)
          && this.canReceiveAtLevel(upline.id, level)
        ) {
          return upline;
        }
        return null;
      }

      currentUplineUserId = upline.parentId || upline.sponsorId;
      depth += 1;
    }
    return null;
  }

  static executeGiveHelp(
    userId: string,
    amount: number,
    level: number,
    description: string,
    options: GiveHelpExecuteOptions = {}
  ): number {
    const user = this.getUserById(userId);
    if (!user) return 0;
    const useLockedIncome = !!options.useLockedIncome;
    const sourceLockedLevel = Math.max(
      1,
      Math.min(
        helpDistributionTable.length,
        Number.isFinite(Number(options.lockedIncomeLevel)) ? Number(options.lockedIncomeLevel) : level
      )
    );
    let remaining = Math.max(0, amount);
    let totalTransferred = 0;
    const giveTxByTarget = new Map<string, {
      amount: number;
      level: number;
      description: string;
      toUserId?: string;
    }>();

    const recipientLevel = Math.min(
      helpDistributionTable.length,
      Math.max(1, Math.floor(level || 1))
    );

    const queueGiveTx = (
      key: string,
      payload: { amount: number; level: number; description: string; toUserId?: string }
    ) => {
      if (payload.amount <= 0.0001) return;
      const existing = giveTxByTarget.get(key);
      if (existing) {
        existing.amount += payload.amount;
        giveTxByTarget.set(key, existing);
        return;
      }
      giveTxByTarget.set(key, { ...payload });
    };

    while (remaining > 0.0001) {
      const senderWallet = this.getWallet(userId);
      if (!senderWallet) break;

      const senderMatrixWallet = senderWallet.matrixWallet || 0;
      const senderLockedIncomeWallet = senderWallet.lockedIncomeWallet || 0;
      const senderTracker = useLockedIncome ? this.getUserHelpTracker(userId) : null;
      const senderLevelState = senderTracker
        ? this.ensureLevelTrackerState(senderTracker, sourceLockedLevel)
        : null;
      const senderLevelLockedAmount = senderLevelState?.lockedAmount || 0;
      const sourceAvailable = useLockedIncome
        ? Math.min(senderLockedIncomeWallet, senderLevelLockedAmount)
        : Math.min(senderWallet.incomeWallet, senderMatrixWallet);
      if (sourceAvailable <= 0.0001) break;

      const requiredAmount = helpDistributionTable[recipientLevel - 1]?.perUserHelp || 0;
      if (requiredAmount <= 0) break;
      if (remaining + 0.0001 < requiredAmount) break;
      if (sourceAvailable + 0.0001 < requiredAmount) break;

      const recipient = this.findEligibleUplineForGiveHelp(user, recipientLevel);
      if (!recipient) {
        const safetyAmount = requiredAmount;

        if (useLockedIncome) {
          this.updateWallet(userId, {
            lockedIncomeWallet: Math.max(0, senderLockedIncomeWallet - safetyAmount),
            totalGiven: senderWallet.totalGiven + safetyAmount
          });
        } else {
          this.updateWallet(userId, {
            incomeWallet: senderWallet.incomeWallet - safetyAmount,
            matrixWallet: Math.max(0, senderMatrixWallet - safetyAmount),
            totalGiven: senderWallet.totalGiven + safetyAmount
          });
        }

      const lockedGiveDesc = `Auto give help at level ${recipientLevel} from locked income to safety pool (no qualified upline)`;
      queueGiveTx('safety_pool', {
        amount: safetyAmount,
        level: recipientLevel,
        description: useLockedIncome ? lockedGiveDesc : `${description} to safety pool`
      });
      this.addToSafetyPool(safetyAmount, userId, `No qualified upline for level ${recipientLevel}`);
      if (useLockedIncome) {
        this.addHelpFlowDebugEntry({
          id: generateEventId('helpflow', `safety_l${recipientLevel}`),
          createdAt: new Date().toISOString(),
          fromUserId: user.id,
          fromUserName: user.fullName,
          fromUserPublicId: user.userId,
          sourceLevel: sourceLockedLevel,
          targetLevel: recipientLevel,
          amount: safetyAmount,
          outcome: 'safety_pool',
          reason: `No qualified upline for level ${recipientLevel}`
        });
      }
      totalTransferred += safetyAmount;
      remaining -= safetyAmount;
      break;
    }

      const transferAmount = requiredAmount;
      const recipientWallet = this.getWallet(recipient.id);
      if (!recipientWallet) break;

      if (useLockedIncome) {
        this.updateWallet(userId, {
          lockedIncomeWallet: Math.max(0, senderLockedIncomeWallet - transferAmount),
          totalGiven: senderWallet.totalGiven + transferAmount
        });
      } else {
        this.updateWallet(userId, {
          incomeWallet: senderWallet.incomeWallet - transferAmount,
          matrixWallet: Math.max(0, senderMatrixWallet - transferAmount),
          totalGiven: senderWallet.totalGiven + transferAmount
        });
      }

      const lockedRecipientDesc = `Auto give help at level ${recipientLevel} from locked income to ${recipient.fullName} (${recipient.userId})`;
      queueGiveTx(`recipient:${recipient.id}`, {
        amount: transferAmount,
        toUserId: recipient.id,
        level: recipientLevel,
        description: useLockedIncome ? lockedRecipientDesc : `${description} to ${recipient.fullName} (${recipient.userId})`
      });
      if (useLockedIncome) {
        this.addHelpFlowDebugEntry({
          id: generateEventId('helpflow', `auto_l${recipientLevel}`),
          createdAt: new Date().toISOString(),
          fromUserId: user.id,
          fromUserName: user.fullName,
          fromUserPublicId: user.userId,
          sourceLevel: sourceLockedLevel,
          targetLevel: recipientLevel,
          amount: transferAmount,
          toUserId: recipient.id,
          toUserName: recipient.fullName,
          toUserPublicId: recipient.userId,
          outcome: 'sent',
          reason: description
        });
      }

      const recipientTracker = this.getUserHelpTracker(recipient.id);
      const recipientState = this.ensureLevelTrackerState(recipientTracker, recipientLevel);
      recipientState.receiveEvents += 1;
      const receiveIndex = recipientState.receiveEvents;
      const fromSuffix = ` from ${user.fullName} (${user.userId})`;
      const lockedFirstTwoCount = this.getLockedFirstTwoReceiveCount(recipient.id, recipientLevel);

      if (lockedFirstTwoCount < 2) {
        this.updateWallet(recipient.id, {
          lockedIncomeWallet: (recipientWallet.lockedIncomeWallet || 0) + transferAmount,
          totalReceived: recipientWallet.totalReceived + transferAmount,
          giveHelpLocked: (recipientWallet.giveHelpLocked || 0) + transferAmount
        });
        recipientState.receivedAmount += transferAmount;
        recipientState.lockedAmount += transferAmount;

        this.createTransaction({
          id: generateEventId('tx', `upline_help_locked_first_two_l${recipientLevel}`),
          userId: recipient.id,
          type: 'receive_help',
          amount: transferAmount,
          fromUserId: userId,
          level: recipientLevel,
          status: 'completed',
          description: `Locked first-two help at level ${recipientLevel}${fromSuffix}`,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        });

        if (lockedFirstTwoCount + 1 === 2 && recipientState.lockedAmount > 0) {
          // Keep first-two release routing consistent with processMatchedHelpEvent:
          // pending matrix contributions must consume the locked amount first so
          // the help goes to the correct queued upline before fallback routing.
          recipientTracker.levels[String(recipientLevel)] = recipientState;
          this.saveUserHelpTracker(recipientTracker);
          this.processPendingMatrixContributionsForUser(recipient.id);

          // Reload tracker from storage after nested processing to avoid stale overwrite
          const freshRecTracker = this.getUserHelpTracker(recipient.id);
          const freshRecState = this.ensureLevelTrackerState(freshRecTracker, recipientLevel);

          const walletAfterPending = this.getWallet(recipient.id);
          const consumedByPending =
            (recipientWallet.lockedIncomeWallet || 0) + transferAmount - (walletAfterPending?.lockedIncomeWallet || 0);

          if (consumedByPending > 0) {
            freshRecState.givenAmount += consumedByPending;
            const levelPerUserHelp = helpDistributionTable[recipientLevel - 1]?.perUserHelp || 0;
            if (levelPerUserHelp > 0) {
              freshRecState.giveEvents = Math.min(
                2,
                freshRecState.giveEvents + Math.floor(consumedByPending / levelPerUserHelp)
              );
            }
            freshRecState.lockedAmount = Math.max(0, freshRecState.lockedAmount - consumedByPending);
            if (walletAfterPending) {
              this.updateWallet(recipient.id, {
                giveHelpLocked: Math.max(0, (walletAfterPending.giveHelpLocked || 0) - consumedByPending)
              });
            }
          } else {
            const hasPending = this.getPendingMatrixContributions().some(
              (i) => i.fromUserId === recipient.id && i.status === 'pending'
            );
            if (!hasPending) {
              const lockedToTransfer = freshRecState.lockedAmount;
              const targetLevel = Math.min(helpDistributionTable.length, recipientLevel + 1);
              const transferred = this.executeGiveHelp(
                recipient.id,
                lockedToTransfer,
                targetLevel,
                `Auto give help at level ${targetLevel} from locked income`,
                { useLockedIncome: true, lockedIncomeLevel: recipientLevel }
              );
              if (transferred > 0) {
                freshRecState.givenAmount += transferred;
                const levelPerUserHelp2 = helpDistributionTable[recipientLevel - 1]?.perUserHelp || 0;
                if (levelPerUserHelp2 > 0) {
                  freshRecState.giveEvents = Math.min(
                    2,
                    freshRecState.giveEvents + Math.floor(transferred / levelPerUserHelp2)
                  );
                }
                freshRecState.lockedAmount = Math.max(0, freshRecState.lockedAmount - transferred);
                const latestRecipientWallet = this.getWallet(recipient.id);
                if (latestRecipientWallet) {
                  this.updateWallet(recipient.id, {
                    giveHelpLocked: Math.max(0, (latestRecipientWallet.giveHelpLocked || 0) - transferred)
                  });
                }
              }
            }
          }

          // Merge fresh state back to avoid stale overwrite
          Object.assign(recipientTracker, freshRecTracker);
          Object.assign(recipientState, freshRecState);
          recipientTracker.levels[String(recipientLevel)] = recipientState;
        }
      } else if (receiveIndex === 5 && (recipientState.safetyDeducted || 0) <= 0) {
        this.addToSafetyPool(transferAmount, recipient.id, `5th help deduction at level ${recipientLevel}`);
        this.createTransaction({
          id: generateEventId('tx', `upline_help_safety_l${recipientLevel}`),
          userId: recipient.id,
          type: 'safety_pool',
          amount: -transferAmount,
          level: recipientLevel,
          status: 'completed',
          description: `5th help deduction at level ${recipientLevel}`,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        });
        recipientState.safetyDeducted += transferAmount;
      } else if (this.isQualifiedForLevel(recipient, recipientLevel)) {
        this.updateWallet(recipient.id, {
          incomeWallet: recipientWallet.incomeWallet + transferAmount,
          matrixWallet: (recipientWallet.matrixWallet || 0) + transferAmount,
          totalReceived: recipientWallet.totalReceived + transferAmount
        });
        recipientState.receivedAmount += transferAmount;

        this.createTransaction({
          id: generateEventId('tx', `upline_help_l${recipientLevel}`),
          userId: recipient.id,
          type: 'receive_help',
          amount: transferAmount,
          fromUserId: userId,
          level: recipientLevel,
          status: 'completed',
          description: `Received help at level ${recipientLevel}${fromSuffix}`,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        });
        // Auto-deduct pending system fee now that income arrived
        this.deductPendingSystemFee(recipient.id);
      } else {
        this.updateWallet(recipient.id, {
          lockedIncomeWallet: (recipientWallet.lockedIncomeWallet || 0) + transferAmount
        });
        recipientState.lockedReceiveAmount += transferAmount;

        this.createTransaction({
          id: generateEventId('tx', `upline_help_locked_l${recipientLevel}`),
          userId: recipient.id,
          type: 'receive_help',
          amount: transferAmount,
          fromUserId: userId,
          level: recipientLevel,
          status: 'completed',
          description: `Locked receive help at level ${recipientLevel} from ${user.fullName} (${user.userId})`,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        });
      }

      recipientTracker.levels[String(recipientLevel)] = recipientState;
      this.saveUserHelpTracker(recipientTracker);
      this.syncUserAchievements(recipient.id);
      this.processPendingMatrixContributionsForUser(recipient.id);

      try {
        this.restoreMissingReceiveHelpFromUserId({
          recipientUserId: recipient.userId,
          fromUserId: user.userId,
          level: recipientLevel
        });
      } catch {
        // Best-effort consistency backstop only.
      }

      totalTransferred += transferAmount;
      remaining -= transferAmount;
    }

    if (giveTxByTarget.size > 0) {
      const nowIso = new Date().toISOString();
      for (const tx of giveTxByTarget.values()) {
        this.createTransaction({
          id: generateEventId('tx', `give_help_l${tx.level}`),
          userId,
          type: 'give_help',
          amount: -tx.amount,
          toUserId: tx.toUserId,
          level: tx.level,
          status: 'completed',
          description: tx.description,
          createdAt: nowIso,
          completedAt: nowIso
        });

        if (tx.toUserId) {
          const recipient = this.getUserById(tx.toUserId);
          if (recipient) {
            try {
              this.restoreMissingReceiveHelpFromUserId({
                recipientUserId: recipient.userId,
                fromUserId: user.userId,
                level: tx.level
              });
            } catch {
              // Best-effort consistency backstop only.
            }
          }
        }
      }
    }

    return totalTransferred;
  }

  private static ensureLevelTrackerState(
    tracker: UserHelpTracker,
    level: number
  ): LevelHelpTrackerState {
    const key = String(level);
    const existing = tracker.levels[key];
    if (existing) {
      const toNum = (v: unknown) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      const normalized: LevelHelpTrackerState = {
        level,
        perUserHelp: helpDistributionTable[level - 1].perUserHelp,
        directRequired: this.getCumulativeDirectRequired(level),
        leftEvents: Math.max(0, Math.floor(toNum((existing as any).leftEvents))),
        rightEvents: Math.max(0, Math.floor(toNum((existing as any).rightEvents))),
        matchedEvents: Math.max(0, Math.floor(toNum((existing as any).matchedEvents))),
        receiveEvents: Math.max(0, Math.floor(toNum((existing as any).receiveEvents))),
        receivedAmount: Math.max(0, toNum((existing as any).receivedAmount)),
        giveEvents: Math.max(0, Math.floor(toNum((existing as any).giveEvents))),
        givenAmount: Math.max(0, toNum((existing as any).givenAmount)),
        lockedAmount: Math.max(0, toNum((existing as any).lockedAmount)),
        lockedReceiveAmount: Math.max(0, toNum((existing as any).lockedReceiveAmount)),
        safetyDeducted: Math.max(0, toNum((existing as any).safetyDeducted)),
        manualCompletion: !!(existing as any).manualCompletion
      };
      tracker.levels[key] = normalized;
      return normalized;
    }
    const levelData = helpDistributionTable[level - 1];
    const created: LevelHelpTrackerState = {
      level,
      perUserHelp: levelData.perUserHelp,
      directRequired: this.getCumulativeDirectRequired(level),
      leftEvents: 0,
      rightEvents: 0,
      matchedEvents: 0,
      receiveEvents: 0,
      receivedAmount: 0,
      giveEvents: 0,
      givenAmount: 0,
      lockedAmount: 0,
      lockedReceiveAmount: 0,
      safetyDeducted: 0,
      manualCompletion: false
    };
    tracker.levels[key] = created;
    return created;
  }

  private static consumeLockedIncomeAtLevel(
    tracker: UserHelpTracker,
    level: number,
    amount: number
  ): {
    success: boolean;
    consumedFromLockedAmount: number;
    consumedFromLockedReceiveAmount: number;
  } {
    let remaining = Math.max(0, amount);
    let consumedFromLockedAmount = 0;
    let consumedFromLockedReceiveAmount = 0;

    const key = String(level);
    const state = tracker.levels[key];
    if (!state) {
      return {
        success: false,
        consumedFromLockedAmount,
        consumedFromLockedReceiveAmount
      };
    }

    // Calculate consumption before mutating — only apply if we can consume the full amount
    const takeLockedReceive = Math.min(state.lockedReceiveAmount || 0, remaining);
    consumedFromLockedReceiveAmount += takeLockedReceive;
    remaining -= takeLockedReceive;

    const takeLockedFirstTwo = Math.min(state.lockedAmount || 0, remaining);
    consumedFromLockedAmount += takeLockedFirstTwo;
    remaining -= takeLockedFirstTwo;

    const success = remaining <= 0.0001;
    if (success) {
      // Only mutate state on success to prevent partial consumption corruption
      if (takeLockedReceive > 0) {
        state.lockedReceiveAmount = Math.max(0, (state.lockedReceiveAmount || 0) - takeLockedReceive);
      }
      if (takeLockedFirstTwo > 0) {
        state.lockedAmount = Math.max(0, (state.lockedAmount || 0) - takeLockedFirstTwo);
      }
      tracker.levels[key] = state;
    }

    return {
      success,
      consumedFromLockedAmount,
      consumedFromLockedReceiveAmount
    };
  }

  static processMatchedHelpEvent(
    userId: string,
    level: number,
    fromUserId?: string,
    options: MatrixHelpEventOptions = {}
  ): boolean {
    const user = this.getUserById(userId);
    if (!user || !this.isNetworkActiveUser(user)) return false;
    const fromUser = fromUserId ? this.getUserById(fromUserId) : undefined;
    if (!fromUserId || !fromUser) {
      console.warn(`[HELP-DEBUG] Level ${level}: missing or invalid sender for ${user.userId}.`);
      return false;
    }
    // Keep sender attribution in history even for pending/synthetic matrix contributions.
    const fromSuffix = fromUser ? ` from ${fromUser.fullName} (${fromUser.userId})` : '';
    const matchedFromUserId: string | undefined = fromUserId;

    const levelData = helpDistributionTable[level - 1];
    if (!levelData) return false;
    const amount = levelData.perUserHelp;

    const wallet = this.getWallet(user.id);
    if (!wallet) return false;

    const tracker = this.getUserHelpTracker(user.id);
    const key = String(level);
    const levelState = this.ensureLevelTrackerState(tracker, level);
    if (!this._bulkRebuildMode) {
      const observed = this.getObservedReceiveEventCount(user.id, level);
      if (observed !== (levelState.receiveEvents || 0)) {
        levelState.receiveEvents = observed;
        tracker.levels[key] = levelState;
        this.saveUserHelpTracker(tracker);
      }
    }
    // Hard cap per level (L1=2, L2=4, L3=8 ...). This prevents overflow receives.
    if ((levelState.receiveEvents || 0) >= levelData.users) {
      tracker.levels[key] = levelState;
      this.saveUserHelpTracker(tracker);
      return true;
    }

    // Matched contribution consumes sender's total locked-income pool.
    if (fromUser && !options.skipFromWalletDebit) {
      const fromWallet = this.getWallet(fromUser.id);
      if (!fromWallet) return false;
      if (!this.isNetworkActiveUser(fromUser)) return false;

      const fromTracker = this.getUserHelpTracker(fromUser.id);
      // Source lock level is one step behind the recipient matrix depth.
      // Example: level-1 first-two lock ($10) funds level-2 ancestor contribution ($10).
      const debitLockedLevel = Math.max(1, level - 1);
      const fromState = this.ensureLevelTrackerState(fromTracker, debitLockedLevel);
      const walletLockedAvailable = fromWallet.lockedIncomeWallet || 0;
      if (walletLockedAvailable < amount) {
        console.warn(`[HELP-DEBUG] Level ${level}: sender ${fromUser.userId} wallet locked $${walletLockedAvailable} < needed $${amount}. BLOCKED.`);
        return false;
      }
      const consumed = this.consumeLockedIncomeAtLevel(fromTracker, debitLockedLevel, amount);
      if (!consumed.success) {
        const debitState = fromTracker.levels[String(debitLockedLevel)];
        console.warn(`[HELP-DEBUG] Level ${level}: sender ${fromUser.userId} consumeLockedIncomeAtLevel(${debitLockedLevel}, $${amount}) FAILED. lockedAmount=${debitState?.lockedAmount || 0}, lockedReceiveAmount=${debitState?.lockedReceiveAmount || 0}`);
        return false;
      }

      this.updateWallet(fromUser.id, {
        lockedIncomeWallet: walletLockedAvailable - amount,
        totalGiven: fromWallet.totalGiven + amount,
        giveHelpLocked: Math.max(0, (fromWallet.giveHelpLocked || 0) - consumed.consumedFromLockedAmount)
      });

      fromState.givenAmount += amount;
      fromState.giveEvents = Math.min(2, (fromState.giveEvents || 0) + 1);
      fromTracker.levels[String(debitLockedLevel)] = fromState;
      this.saveUserHelpTracker(fromTracker);

      this.createTransaction({
        id: generateEventId('tx', `matrix_locked_give_l${level}`),
        userId: fromUser.id,
        type: 'give_help',
        amount: -amount,
        toUserId: user.id,
        level,
        status: 'completed',
        description: `Auto give help at level ${level} from locked income to ${user.fullName} (${user.userId})`,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      });

      this.addHelpFlowDebugEntry({
        id: generateEventId('helpflow', `auto_l${level}`),
        createdAt: new Date().toISOString(),
        fromUserId: fromUser.id,
        fromUserName: fromUser.fullName,
        fromUserPublicId: fromUser.userId,
        sourceLevel: debitLockedLevel,
        targetLevel: level,
        amount,
        toUserId: user.id,
        toUserName: user.fullName,
        toUserPublicId: user.userId,
        outcome: 'sent',
        reason: 'Auto give help via pending matrix'
      });
    }
    // Note: when skipFromWalletDebit is true (activation flow), no sender-side
    // transaction is created — the activation fee split handles the sender's ledger.

    levelState.receiveEvents += 1;
    const receiveIndex = levelState.receiveEvents;
    const lockedFirstTwoCount = this.getLockedFirstTwoReceiveCount(user.id, level);

    // First two receive-help events are locked first, then transferred together.
    if (lockedFirstTwoCount < 2) {
      this.updateWallet(user.id, {
        lockedIncomeWallet: (wallet.lockedIncomeWallet || 0) + amount,
        totalReceived: wallet.totalReceived + amount,
        giveHelpLocked: (wallet.giveHelpLocked || 0) + amount
      });
      levelState.receivedAmount += amount;
      levelState.lockedAmount += amount;

      this.createTransaction({
        id: generateEventId('tx', `receive_help_l${level}`),
        userId: user.id,
        type: 'receive_help',
        amount,
        fromUserId: matchedFromUserId,
        level,
        status: 'completed',
        description: `Locked first-two help at level ${level}${fromSuffix}`,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      });

      if (lockedFirstTwoCount + 1 === 2 && levelState.lockedAmount > 0) {
        // Process pending matrix contributions so locked income flows
        // up to higher-level recipients.  No limit — allow the full cascade.
        tracker.levels[key] = levelState;
        this.saveUserHelpTracker(tracker);

        console.warn(`[HELP-CASCADE] ${user.userId} first-two complete at level ${level}, lockedAmount=$${levelState.lockedAmount}. Processing pending contributions...`);
        this.processPendingMatrixContributionsForUser(user.id);

        // CRITICAL: Reload tracker from storage after nested processing.
        // The nested processPendingMatrixContributionsForUser -> registerMatrixContribution
        // -> processMatchedHelpEvent chain may have modified this user's tracker
        // (e.g. updating giveEvents at higher levels).  Using the stale 'tracker'
        // object would overwrite those changes when we save at the end.
        const freshTracker = this.getUserHelpTracker(user.id);
        const freshLevelState = this.ensureLevelTrackerState(freshTracker, level);

        // Pending contributions handle all upward help flow.
        // Remaining locked income stays until more pending contributions can process.
        const walletAfterPending = this.getWallet(user.id);
        const consumedByPending = (wallet.lockedIncomeWallet || 0) + amount - (walletAfterPending?.lockedIncomeWallet || 0);
        console.warn(`[HELP-CASCADE] ${user.userId} level ${level} post-pending: consumedByPending=$${consumedByPending}, walletLocked before=$${(wallet.lockedIncomeWallet || 0) + amount}, after=$${walletAfterPending?.lockedIncomeWallet || 0}`);
        if (consumedByPending > 0) {
          freshLevelState.givenAmount += consumedByPending;
          freshLevelState.giveEvents = Math.min(2, freshLevelState.giveEvents + 1);
          freshLevelState.lockedAmount = Math.max(0, freshLevelState.lockedAmount - consumedByPending);
          if (walletAfterPending) {
            this.updateWallet(user.id, {
              giveHelpLocked: Math.max(0, (walletAfterPending.giveHelpLocked || 0) - consumedByPending)
            });
          }
        } else {
          // Only use the executeGiveHelp fallback for users with ZERO pending
          // contributions (e.g., the root/admin user who has no upline pending).
          // For normal users the locked income must stay locked so it can fund
          // their higher-level pending contributions when those become processable.
          const hasPending = this.getPendingMatrixContributions().some(
            (i) => i.fromUserId === user.id && i.status === 'pending'
          );
          if (!hasPending) {
            const lockedToTransfer = freshLevelState.lockedAmount;
            const targetLevel = Math.min(helpDistributionTable.length, level + 1);
            const transferred = this.executeGiveHelp(
              user.id,
              lockedToTransfer,
              targetLevel,
              `Auto give help at level ${targetLevel} from locked income`,
              { useLockedIncome: true, lockedIncomeLevel: level }
            );
            if (transferred > 0) {
              freshLevelState.givenAmount += transferred;
              freshLevelState.giveEvents = Math.min(2, freshLevelState.giveEvents + Math.floor(transferred / amount));
              freshLevelState.lockedAmount = Math.max(0, freshLevelState.lockedAmount - transferred);
              const latestWallet = this.getWallet(user.id);
              if (latestWallet) {
                this.updateWallet(user.id, {
                  giveHelpLocked: Math.max(0, (latestWallet.giveHelpLocked || 0) - transferred)
                });
              }
            }
          }
        }

        // Use fresh tracker/levelState for the final save to avoid overwriting
        // changes made by nested processing at other levels.
        // Replace stale references so the final save at the end of the method
        // writes the fresh data.
        Object.assign(tracker, freshTracker);
        Object.assign(levelState, freshLevelState);
        tracker.levels[key] = levelState;
      }
    } else if (receiveIndex === 5 && (levelState.safetyDeducted || 0) <= 0) {
      // Every 5th receive-help event per level is diverted to safety pool.
      // Show a receive transaction first so user sees the help came in.
      this.createTransaction({
        id: generateEventId('tx', `receive_help_5th_l${level}`),
        userId: user.id,
        type: 'receive_help',
        amount,
        fromUserId: matchedFromUserId,
        level,
        status: 'completed',
        description: `Received help at level ${level}${fromSuffix} (5th help - transferred to safety pool)`,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      });
      // Then deduct to safety pool.
      this.addToSafetyPool(amount, user.id, `5th help deduction at level ${level}`);
      this.createTransaction({
        id: generateEventId('tx', `level_safety_l${level}`),
        userId: user.id,
        type: 'safety_pool',
        amount: -amount,
        level,
        status: 'completed',
        description: `5th help deduction at level ${level} - transferred to safety pool`,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      });
      levelState.safetyDeducted += amount;
    } else if (this.isQualifiedForLevel(user, level)) {
      this.updateWallet(user.id, {
        incomeWallet: wallet.incomeWallet + amount,
        matrixWallet: (wallet.matrixWallet || 0) + amount,
        totalReceived: wallet.totalReceived + amount
      });
      levelState.receivedAmount += amount;

      this.createTransaction({
        id: generateEventId('tx', `receive_help_l${level}`),
        userId: user.id,
        type: 'receive_help',
        amount,
        fromUserId: matchedFromUserId,
        level,
        status: 'completed',
        description: `Received help at level ${level}${fromSuffix}`,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      });
      // Auto-deduct pending system fee now that income arrived
      this.deductPendingSystemFee(user.id);
    } else {
      // Post first-two receive-help stays blocked until qualification is completed.
      const requiredDirect = this.getCumulativeDirectRequired(level);
      const currentDirect = this.getEffectiveDirectCount(user);
      this.updateWallet(user.id, {
        lockedIncomeWallet: (wallet.lockedIncomeWallet || 0) + amount
      });
      levelState.lockedReceiveAmount += amount;

      this.createTransaction({
        id: generateEventId('tx', `receive_help_locked_l${level}`),
        userId: user.id,
        type: 'receive_help',
        amount,
        fromUserId: matchedFromUserId,
        level,
        status: 'completed',
        description: `Locked receive help at level ${level}${fromSuffix} (requires ${requiredDirect} direct, current ${currentDirect})`,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      });
    }

    tracker.levels[key] = levelState;
    this.saveUserHelpTracker(tracker);
    this.syncUserAchievements(user.id);
    this.processPendingMatrixContributionsForUser(user.id);
    this.attemptAutoLockedHelpSettlement(user.id);

    if (fromUser && !options.skipFromWalletDebit) {
      try {
        this.restoreMissingReceiveHelpFromUserId({
          recipientUserId: user.userId,
          fromUserId: fromUser.userId,
          level
        });
      } catch {
        // Best-effort consistency backstop only.
      }
    }

    return true;
  }

  static registerMatrixContribution(
    userId: string,
    level: number,
    side: 'left' | 'right',
    fromUserId?: string,
    options: MatrixHelpEventOptions = {}
  ): boolean {
    if (level < 1 || level > helpDistributionTable.length) return false;

    const recipient = this.getUserById(userId);
    const tracker = this.getUserHelpTracker(userId);
    const key = String(level);
    const state = this.ensureLevelTrackerState(tracker, level);
    const prevLeft = state.leftEvents;
    const prevRight = state.rightEvents;
    const prevMatched = state.matchedEvents;
    const contributionKey = fromUserId
      ? `matrix|${fromUserId}|${userId}|${level}|${side}|${options.skipFromWalletDebit ? 1 : 0}`
      : '';

    if (contributionKey && this.hasProcessedContributionKey(tracker, contributionKey)) {
      const sender = fromUserId ? this.getUserById(fromUserId) : undefined;
      const fallbackRecipient = recipient || this.getUserById(userId);
      this.addDuplicateContributionBlockEntry({
        id: generateEventId('dup', 'matrix_contribution_block'),
        createdAt: new Date().toISOString(),
        contributionKey,
        fromUserId,
        fromUserName: sender?.fullName,
        fromUserPublicId: sender?.userId,
        toUserId: userId,
        toUserName: fallbackRecipient?.fullName,
        toUserPublicId: fallbackRecipient?.userId,
        level,
        side,
        via: options.skipFromWalletDebit ? 'activation' : 'pending',
        reason: 'duplicate_contribution_key'
      });
      return true;
    }

    const markContributionProcessed = () => {
      if (!contributionKey) return;
      const latestTracker = this.getUserHelpTracker(userId);
      if (this.hasProcessedContributionKey(latestTracker, contributionKey)) return;
      this.markProcessedContributionKey(latestTracker, contributionKey);
      this.saveUserHelpTracker(latestTracker);
    };

    if (side === 'left') {
      state.leftEvents += 1;
    } else {
      state.rightEvents += 1;
    }
    state.matchedEvents += 1;
    tracker.levels[key] = state;
    this.saveUserHelpTracker(tracker);

    if (recipient && !this.isNetworkActiveUser(recipient)) {
      const levelData = helpDistributionTable[level - 1];
      const amount = levelData?.perUserHelp || 0;
      let diverted = false;

      if (fromUserId && amount > 0) {
        const recipientLabel = recipient.userId || userId;
        if (options.skipFromWalletDebit) {
          this.addToSafetyPool(amount, fromUserId, `Recipient inactive at level ${level} (${recipientLabel})`);
          diverted = true;
        } else {
          const sender = this.getUserById(fromUserId);
          if (sender && this.isNetworkActiveUser(sender)) {
            const senderWallet = this.getWallet(sender.id);
            if (senderWallet) {
              const debitLevel = Math.max(1, level - 1);
              const walletLockedAvailable = senderWallet.lockedIncomeWallet || 0;
              if (walletLockedAvailable >= amount) {
                const senderTracker = this.getUserHelpTracker(sender.id);
                const consumed = this.consumeLockedIncomeAtLevel(senderTracker, debitLevel, amount);
                if (consumed.success) {
                  this.updateWallet(sender.id, {
                    lockedIncomeWallet: walletLockedAvailable - amount,
                    totalGiven: senderWallet.totalGiven + amount,
                    giveHelpLocked: Math.max(0, (senderWallet.giveHelpLocked || 0) - consumed.consumedFromLockedAmount)
                  });
                  this.saveUserHelpTracker(senderTracker);
                  this.addToSafetyPool(amount, sender.id, `Recipient inactive at level ${level} (${recipientLabel})`);
                  this.createTransaction({
                    id: generateEventId('tx', `give_help_safety_l${level}`),
                    userId: sender.id,
                    type: 'give_help',
                    amount: -amount,
                    level,
                    status: 'completed',
                    description: `Auto give help at level ${level} from locked income to ${recipient.fullName} (${recipient.userId})`,
                    createdAt: new Date().toISOString(),
                    completedAt: new Date().toISOString()
                  });
                  this.addHelpFlowDebugEntry({
                    id: generateEventId('helpflow', `safety_inactive_l${level}`),
                    createdAt: new Date().toISOString(),
                    fromUserId: sender.id,
                    fromUserName: sender.fullName,
                    fromUserPublicId: sender.userId,
                    sourceLevel: debitLevel,
                    targetLevel: level,
                    amount,
                    outcome: 'safety_pool',
                    reason: `Recipient inactive (${recipientLabel})`
                  });
                  diverted = true;
                }
              }
            }
          }
        }
      }

      if (diverted) {
        markContributionProcessed();
        return true;
      }

      state.leftEvents = prevLeft;
      state.rightEvents = prevRight;
      state.matchedEvents = prevMatched;
      tracker.levels[key] = state;
      this.saveUserHelpTracker(tracker);
      return false;
    }

    const processed = this.processMatchedHelpEvent(userId, level, fromUserId, options);
    if (!processed) {
      state.leftEvents = prevLeft;
      state.rightEvents = prevRight;
      state.matchedEvents = prevMatched;
      tracker.levels[key] = state;
      this.saveUserHelpTracker(tracker);
      return false;
    }
    markContributionProcessed();
    return true;
  }

  static releaseLockedGiveHelp(userId: string): void {
    const user = this.getUserById(userId);
    if (!user) return;
    this.reconcileLockedIncomeState(userId);

    const tracker = this.getUserHelpTracker(userId);
    let changed = false;
    let releasedTotal = 0;

    for (const item of tracker.lockedQueue) {
      if (item.status !== 'locked') continue;
      if (!this.isQualifiedForLevel(user, item.level)) continue;

      const pendingAmount = item.amount;
      const walletBefore = this.getWallet(user.id);
      const lockedBefore = walletBefore?.lockedIncomeWallet || 0;
      this.processPendingMatrixContributionsForUser(userId);
      const walletAfter = this.getWallet(user.id);
      const lockedAfter = walletAfter?.lockedIncomeWallet || 0;
      let transferred = Math.max(0, lockedBefore - lockedAfter);

      if (transferred <= 0) {
        const targetLevel = Math.min(helpDistributionTable.length, item.level + 1);
        transferred = this.executeGiveHelp(
          user.id,
          pendingAmount,
          targetLevel,
          `Released locked give help at level ${targetLevel} from locked income`,
          { useLockedIncome: true, lockedIncomeLevel: item.level }
        );
      }
      if (transferred <= 0) continue;

      if (transferred >= pendingAmount) {
        item.status = 'released';
        item.releasedAt = new Date().toISOString();
      } else {
        item.amount = pendingAmount - transferred;
      }
      releasedTotal += transferred;
      changed = true;

      const state = tracker.levels[String(item.level)];
      if (state) {
        state.lockedAmount = Math.max(0, state.lockedAmount - transferred);
        state.givenAmount += transferred;
        tracker.levels[String(item.level)] = state;
      }
      break; // One give-help per call
    }

    // Skip second loop if first loop already processed something (one per call).
    if (!changed) {
      // New first-two lock model stores pending give-help in level.lockedAmount (not lockedQueue).
      // Process ONE level at a time (level-by-level flow) — sorted by level ascending.
      const sortedLevels = Object.entries(tracker.levels)
        .map(([k, s]) => ({ level: Number(k), state: s }))
        .filter(({ level }) => Number.isInteger(level) && level >= 1 && level <= helpDistributionTable.length)
        .sort((a, b) => a.level - b.level);

      for (const { level, state } of sortedLevels) {
        const pendingFirstTwoLocked = state.lockedAmount || 0;
        if (pendingFirstTwoLocked <= 0) continue;
        if ((state.receiveEvents || 0) < 2) continue;

        // Try pending contributions first (correct upward routing)
        const walletBefore = this.getWallet(user.id);
        const lockedBefore = walletBefore?.lockedIncomeWallet || 0;
        this.processPendingMatrixContributionsForUser(userId);
        const walletAfter = this.getWallet(user.id);
        const lockedAfter = walletAfter?.lockedIncomeWallet || 0;
        const consumedByPending = lockedBefore - lockedAfter;

        if (consumedByPending > 0) {
          state.lockedAmount = Math.max(0, pendingFirstTwoLocked - consumedByPending);
          state.givenAmount += consumedByPending;
          state.giveEvents = Math.min(2, state.giveEvents + 1);
          tracker.levels[String(level)] = state;
          releasedTotal += consumedByPending;
          changed = true;
          break; // One level per call
        }

        // Fallback: executeGiveHelp only if no pending contributions for this user
        const hasPending = this.getPendingMatrixContributions().some(
          (i) => i.fromUserId === userId && i.status === 'pending'
        );
        if (hasPending) continue;
        const targetLevel = Math.min(helpDistributionTable.length, level + 1);
        const transferred = this.executeGiveHelp(
          user.id,
          pendingFirstTwoLocked,
          targetLevel,
          `Released locked give help at level ${targetLevel} from locked income`,
          { useLockedIncome: true, lockedIncomeLevel: level }
        );
        if (transferred <= 0) continue;

        const levelPerUserHelp = helpDistributionTable[level - 1]?.perUserHelp || 0;
        state.lockedAmount = Math.max(0, pendingFirstTwoLocked - transferred);
        state.givenAmount += transferred;
        if (levelPerUserHelp > 0) {
          state.giveEvents = Math.min(2, state.giveEvents + Math.floor(transferred / levelPerUserHelp));
        }
        tracker.levels[String(level)] = state;
        releasedTotal += transferred;
        changed = true;
        break; // One level per call
      }
    } // end if (!changed)

    if (releasedTotal > 0) {
      const wallet = this.getWallet(user.id);
      if (wallet) {
        this.updateWallet(user.id, {
          giveHelpLocked: Math.max(0, wallet.giveHelpLocked - releasedTotal)
        });
      }
    }

    if (changed) {
      // Reload tracker from storage to avoid overwriting changes made by
      // nested processPendingMatrixContributionsForUser calls.
      const freshTracker = this.getUserHelpTracker(userId);
      // Merge our local level state changes into the fresh tracker
      for (const [k, s] of Object.entries(tracker.levels)) {
        if (s) freshTracker.levels[k] = s;
      }
      freshTracker.lockedQueue = tracker.lockedQueue;
      this.saveUserHelpTracker(freshTracker);
      this.processPendingMatrixContributionsForUser(userId);
    }
  }

  static hasLockedIncomeAutoProcessingWork(userId: string): boolean {
    const user = this.getUserById(userId);
    const wallet = this.getWallet(userId);
    if (!user || !wallet) return false;

    const tracker = this.getUserHelpTracker(userId);
    const trackerLockedFirstTwo = Object.values(tracker.levels || {}).reduce(
      (sum, state) => sum + (state.lockedAmount || 0),
      0
    );
    const trackerLockedQualification = Object.values(tracker.levels || {}).reduce(
      (sum, state) => sum + (state.lockedReceiveAmount || 0),
      0
    );
    const hasAnyLockedSignal =
      (wallet.lockedIncomeWallet || 0) > 0.0001
      || (wallet.giveHelpLocked || 0) > 0.0001
      || trackerLockedFirstTwo > 0.0001
      || trackerLockedQualification > 0.0001;

    if (!hasAnyLockedSignal) {
      return false;
    }

    if ((wallet.giveHelpLocked || 0) > 0.0001 || trackerLockedFirstTwo > 0.0001) {
      if ((tracker.lockedQueue || []).some((item) => item.status === 'locked' && this.isQualifiedForLevel(user, item.level))) {
        return true;
      }

      for (const [key, state] of Object.entries(tracker.levels || {})) {
        const level = Number(key);
        if (!Number.isInteger(level) || level < 1 || level > helpDistributionTable.length) continue;
        if ((state.lockedAmount || 0) <= 0.0001) continue;
        if ((state.receiveEvents || 0) < 2) continue;
        return true;
      }
    }

    if ((wallet.lockedIncomeWallet || 0) > 0.0001 || trackerLockedQualification > 0.0001) {
      for (const [key, state] of Object.entries(tracker.levels || {})) {
        const level = Number(key);
        if (!Number.isInteger(level) || level < 1 || level > helpDistributionTable.length) continue;
        if ((state.lockedReceiveAmount || 0) <= 0.0001) continue;
        if (!this.isQualifiedForLevel(user, level)) continue;
        return true;
      }
    }

    return false;
  }

  static attemptAutoLockedHelpSettlement(userId: string): void {
    if (!userId || this.remoteSyncSuspendDepth > 0 || this._bulkRebuildMode) return;
    if (this._autoLockedHelpProcessingUsers.has(userId)) return;
    if (!this.hasLockedIncomeAutoProcessingWork(userId)) return;

    this._autoLockedHelpProcessingUsers.add(userId);
    try {
      this.reconcileLockedIncomeState(userId);
      this.dedupePendingMatrixContributions();
      this.processPendingMatrixContributionsForUser(userId);
      this.releaseLockedGiveHelp(userId);
      this.releaseLockedReceiveHelp(userId);

      if (this.hasLockedIncomeAutoProcessingWork(userId)) {
        this.sweepPendingContributions(3);
        this.processPendingMatrixContributionsForUser(userId);
        this.releaseLockedGiveHelp(userId);
        this.releaseLockedReceiveHelp(userId);
      }
    } finally {
      this._autoLockedHelpProcessingUsers.delete(userId);
    }
  }

  static releaseLockedReceiveHelp(userId: string): void {
    const user = this.getUserById(userId);
    if (!user) return;

    const tracker = this.getUserHelpTracker(userId);
    let changed = false;

    for (const [key, state] of Object.entries(tracker.levels)) {
      const level = Number(key);
      if (!Number.isInteger(level) || level < 1 || level > helpDistributionTable.length) continue;
      if ((state.lockedReceiveAmount || 0) <= 0) continue;
      if (!this.isQualifiedForLevel(user, level)) continue;

      const wallet = this.getWallet(userId);
      if (!wallet) continue;

      const releaseAmount = state.lockedReceiveAmount;
      this.updateWallet(userId, {
        incomeWallet: wallet.incomeWallet + releaseAmount,
        matrixWallet: (wallet.matrixWallet || 0) + releaseAmount,
        lockedIncomeWallet: Math.max(0, (wallet.lockedIncomeWallet || 0) - releaseAmount),
        totalReceived: wallet.totalReceived + releaseAmount
      });

      this.createTransaction({
        id: generateEventId('tx', `release_receive_l${level}`),
        userId,
        type: 'receive_help',
        amount: releaseAmount,
        level,
        status: 'completed',
        description: `Released locked receive help at level ${level}`,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      });

      // Auto-deduct pending system fee now that locked income was released
      this.deductPendingSystemFee(userId);

      state.receivedAmount += releaseAmount;
      state.lockedReceiveAmount = 0;
      tracker.levels[key] = state;
      changed = true;
    }

    if (changed) {
      this.saveUserHelpTracker(tracker);
      this.processPendingMatrixContributionsForUser(userId);
    }
  }

  static processMatrixHelpForNewMember(newMemberUserId: string, fromUserId: string): void {
    const matrix = this.getMatrix();
    const nodeMap = new Map(matrix.map(m => [m.userId, m]));
    const newNode = nodeMap.get(newMemberUserId);
    if (!newNode) return;

    let currentParentUserId = newNode.parentId;
    let depth = 1;
    const immediateUplineFallbackReason = 'No active immediate upline for activation help';

    while (currentParentUserId && depth <= 10) {
      const ancestor = this.getUserByUserId(currentParentUserId);
      if (!ancestor) break;

      const side = this.getRelativeSide(ancestor.userId, newMemberUserId);
      if (side) {
        if (depth === 1) {
          const ok = this.registerMatrixContribution(
            ancestor.id,
            1,
            side,
            fromUserId,
            { skipFromWalletDebit: true }
          );
          if (!ok) {
            this.addToSafetyPool(helpDistributionTable[0].perUserHelp, fromUserId, immediateUplineFallbackReason);
          }
        } else {
          this.enqueuePendingMatrixContribution(fromUserId, ancestor.id, depth, side);
        }
      } else if (depth === 1) {
        // Never drop level-1 activation help silently when side cannot be resolved.
        this.addToSafetyPool(
          helpDistributionTable[0].perUserHelp,
          fromUserId,
          `${immediateUplineFallbackReason} (side unresolved)`
        );
      }

      const parentNode = nodeMap.get(currentParentUserId);
      currentParentUserId = parentNode?.parentId;
      depth += 1;
    }

    this.processPendingMatrixContributionsForUser(fromUserId);

    // After this activation, ancestors may now have enough locked income
    // (from the help events just registered) to process THEIR OWN pending
    // contributions at higher levels.  Sweep the full ancestor chain.
    // Skip during bulk operations (remoteSyncSuspendDepth > 0) to avoid O(N²)
    // freeze — the caller should invoke sweepPendingContributions() once after
    // the entire batch completes.
    if (this.remoteSyncSuspendDepth === 0) {
      this.sweepPendingContributions();
    }
    this.attemptAutoLockedHelpSettlement(fromUserId);
  }


  static createWallet(userId: string): Wallet {
    const wallet: Wallet = {
      userId,
      depositWallet: 0,
      fundRecoveryDue: 0,
      fundRecoveryRecoveredTotal: 0,
      fundRecoveryReason: null,
      pinWallet: 0,
      incomeWallet: 0,
      royaltyWallet: 0,
      matrixWallet: 0,
      lockedIncomeWallet: 0,
      giveHelpLocked: 0,
      totalReceived: 0,
      totalGiven: 0,
      pendingSystemFee: 0,
      lastSystemFeeDate: null,
      rewardPoints: 0,
      totalRewardPointsEarned: 0,
      totalRewardPointsRedeemed: 0,
    };
    const wallets = this.getWallets();
    wallets.push(wallet);
    this.saveWallets(wallets);
    return wallet;
  }

  static updateWallet(userId: string, updates: Partial<Wallet>): Wallet | null {
    const wallets = this.getWallets();
    const index = wallets.findIndex(w => w.userId === userId);
    if (index === -1) return null;

    const existingWallet = wallets[index];
    const changedKeys = Object.keys(updates).filter((key) => !Object.is((existingWallet as any)[key], (updates as any)[key]));
    if (changedKeys.length === 0) {
      return existingWallet;
    }

    const mergedWallet = { ...existingWallet, ...updates };
    wallets[index] = mergedWallet;
    this.saveWallets(wallets);
    return wallets[index];
  }

  private static executeAutoFundRecovery(userId: string, amount: number, walletType: 'income' | 'fund', currentDebt: number, reason: string): void {
    const wallet = this.getWallet(userId);
    if (!wallet || amount <= 0.0001) return;

    const recoveryAmount = Math.min(amount, currentDebt);
    const updates: Partial<Wallet> = {
      fundRecoveryDue: Math.round((currentDebt - recoveryAmount) * 100) / 100,
      fundRecoveryRecoveredTotal: Math.round(((wallet.fundRecoveryRecoveredTotal || 0) + recoveryAmount) * 100) / 100
    };

    if (walletType === 'income') {
      updates.incomeWallet = Math.round(((wallet.incomeWallet || 0) - recoveryAmount) * 100) / 100;
    } else {
      updates.depositWallet = Math.round(((wallet.depositWallet || 0) - recoveryAmount) * 100) / 100;
    }

    if ((updates.fundRecoveryDue ?? 0) <= 0.0001) {
      updates.fundRecoveryReason = null;
    }

    // Direct mutation of the cached wallet and saving
    this.updateWallet(userId, updates);

    // Record the deduction transaction
    this.addToSafetyPool(recoveryAmount, userId, `Auto-Recovery from ${reason} via ${walletType} wallet credit`);
    this.createTransaction({
      id: generateEventId('tx', `fund_recovery_auto_${walletType}`),
      userId,
      type: 'fund_recovery',
      amount: -recoveryAmount,
      status: 'completed',
      description: `Auto-deducted from ${walletType} wallet credit toward admin recovery due for ${reason}. Remaining recovery due: $${Number(updates.fundRecoveryDue).toFixed(2)}`,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      adminReason: reason
    });
  }

  // ==================== MONTHLY SYSTEM FEE ====================

  private static _createSystemFeeTransaction(
    userId: string, amount: number, sourceWallet: string
  ): void {
    this.createTransaction({
      id: generateEventId('tx', 'system_fee'),
      userId,
      type: 'system_fee' as any,
      amount: -amount,
      status: 'completed',
      description: `Monthly system fee ($${amount}) deducted from ${sourceWallet}`,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    });
  }

  static checkDirectReferralDeadline(userId: string): {
    deactivated: boolean;
    deadlineActive: boolean;
    deadlineEnd: string | null;
    effectiveDirects: number;
    requiredDirects: number;
  } {
    const noAction = { deactivated: false, deadlineActive: false, deadlineEnd: null, effectiveDirects: 0, requiredDirects: 2 };
    if (this._bulkRebuildMode) return noAction;

    const user = this.getUserById(userId);
    if (!user || user.isAdmin || !user.activatedAt || !user.isActive) return noAction;

    const requiredDirects = 2;
    const effectiveDirects = this.getEffectiveDirectCount(user);

    // Already met 2 direct requirement — no deadline concern
    if (effectiveDirects >= requiredDirects) {
      return { deactivated: false, deadlineActive: false, deadlineEnd: null, effectiveDirects, requiredDirects };
    }

    // Compute deadline from reactivatedAt (if admin reactivated) or activatedAt
    const settings = this.getSettings();
    const deadlineDays = settings.directReferralDeadlineDays || 30;
    const baseDate = new Date(user.reactivatedAt || user.activatedAt);
    const deadlineEnd = new Date(baseDate.getTime() + deadlineDays * 24 * 60 * 60 * 1000);
    const now = new Date();

    if (now < deadlineEnd) {
      // Deadline still active, user still has time
      return { deactivated: false, deadlineActive: true, deadlineEnd: deadlineEnd.toISOString(), effectiveDirects, requiredDirects };
    }

    // Deadline passed — auto-deactivate
    this.updateUser(userId, {
      isActive: false,
      deactivationReason: 'direct_referral_deadline',
    });

    return { deactivated: true, deadlineActive: false, deadlineEnd: deadlineEnd.toISOString(), effectiveDirects, requiredDirects };
  }

  static processMonthlySystemFee(userId: string): { deducted: boolean; pending: boolean; alreadyCurrent: boolean } {
    if (this._bulkRebuildMode) return { deducted: false, pending: false, alreadyCurrent: true };

    // Guard 1: Wait until initial backend sync is complete so transaction history is accurate
    const syncStatus = this.getRemoteSyncStatus();
    if (!syncStatus.lastSuccessAt) {
      return { deducted: false, pending: false, alreadyCurrent: true };
    }

    // Guard 2: Cooldown persisted via sessionStorage to survive page refreshes
    const cooldownKey = `__sysFee_${userId}`;
    try {
      const lastStr = sessionStorage.getItem(cooldownKey);
      if (lastStr && Date.now() - parseInt(lastStr, 10) < 5 * 60 * 1000) {
        return { deducted: false, pending: false, alreadyCurrent: true };
      }
    } catch (_e) { /* sessionStorage may be unavailable */ }

    const user = this.getUserById(userId);
    if (!user || !this.isNetworkActiveUser(user) || !user.activatedAt) {
      return { deducted: false, pending: false, alreadyCurrent: true };
    }

    const wallet = this.getWallet(userId);
    if (!wallet) return { deducted: false, pending: false, alreadyCurrent: true };

    const activatedAt = new Date(user.activatedAt);
    const now = new Date();

    // Use transaction history as source of truth for last fee date
    const allTx = this.getUserTransactions(userId);
    const feeTxs = allTx.filter(t => (t.type as string) === 'system_fee' && t.status === 'completed');

    // Count how many monthly fees are owed
    // Starting from activatedAt + 1 month, each month a $1 fee is due
    const feeStartDate = new Date(activatedAt);
    feeStartDate.setMonth(feeStartDate.getMonth() + 1);

    if (now < feeStartDate) {
      // Not even 1 month since activation
      return { deducted: false, pending: false, alreadyCurrent: true };
    }

    // Count total months owed since activation
    let totalMonthsOwed = 0;
    const cursor = new Date(feeStartDate);
    while (cursor <= now) {
      totalMonthsOwed++;
      cursor.setMonth(cursor.getMonth() + 1);
    }

    // Count how many already paid (from transaction history)
    const totalPaid = feeTxs.length;

    // Remaining unpaid months
    const unpaidMonths = Math.max(0, totalMonthsOwed - totalPaid);

    if (unpaidMonths <= 0) {
      // All caught up
      if ((wallet.pendingSystemFee || 0) > 0) {
        this.updateWallet(userId, { pendingSystemFee: 0 });
      }
      this._systemFeeLastProcessed.set(userId, Date.now());
      try { sessionStorage.setItem(cooldownKey, Date.now().toString()); } catch (_e) { /* */ }
      return { deducted: false, pending: false, alreadyCurrent: true };
    }

    let totalDeducted = 0;

    // Re-read wallet for freshest balances
    let freshWallet = this.getWallet(userId);
    if (!freshWallet) return { deducted: false, pending: false, alreadyCurrent: true };

    // Deduct as many months as possible, $1 at a time
    for (let i = 0; i < unpaidMonths; i++) {
      // Re-read wallet each iteration since balance changes
      freshWallet = this.getWallet(userId)!;
      if (!freshWallet) break;

      // Priority 1: depositWallet
      if (freshWallet.depositWallet >= 1) {
        this.updateWallet(userId, {
          depositWallet: freshWallet.depositWallet - 1,
          lastSystemFeeDate: now.toISOString(),
        });
        this._createSystemFeeTransaction(userId, 1, 'deposit wallet');
        this.addToSafetyPool(1, userId, 'Monthly system fee');
        totalDeducted++;
        continue;
      }

      // Priority 2: incomeWallet
      if (freshWallet.incomeWallet >= 1) {
        this.updateWallet(userId, {
          incomeWallet: freshWallet.incomeWallet - 1,
          lastSystemFeeDate: now.toISOString(),
        });
        this._createSystemFeeTransaction(userId, 1, 'income wallet');
        this.addToSafetyPool(1, userId, 'Monthly system fee');
        totalDeducted++;
        continue;
      }

      // No more funds — remaining months stay pending
      break;
    }

    const remainingUnpaid = unpaidMonths - totalDeducted;
    this.updateWallet(userId, {
      pendingSystemFee: remainingUnpaid,
      ...(totalDeducted > 0 ? { lastSystemFeeDate: now.toISOString() } : {})
    });

    // Mark this user as processed (cooldown)
    this._systemFeeLastProcessed.set(userId, Date.now());
    try { sessionStorage.setItem(cooldownKey, Date.now().toString()); } catch (_e) { /* */ }

    return {
      deducted: totalDeducted > 0,
      pending: remainingUnpaid > 0,
      alreadyCurrent: false
    };
  }

  static deductPendingSystemFee(userId: string): boolean {
    if (this._bulkRebuildMode) return false;

    let wallet = this.getWallet(userId);
    if (!wallet || (wallet.pendingSystemFee || 0) <= 0) return false;

    let remaining = wallet.pendingSystemFee;
    let deductedAny = false;

    // Deduct $1 at a time until pending is cleared or wallets are empty
    while (remaining > 0) {
      wallet = this.getWallet(userId)!;
      if (!wallet) break;

      // Priority 1: depositWallet
      if (wallet.depositWallet >= 1) {
        this.updateWallet(userId, {
          depositWallet: wallet.depositWallet - 1,
          lastSystemFeeDate: new Date().toISOString(),
          pendingSystemFee: remaining - 1
        });
        this._createSystemFeeTransaction(userId, 1, 'deposit wallet');
        this.addToSafetyPool(1, userId, 'Monthly system fee (deferred)');
        remaining--;
        deductedAny = true;
        continue;
      }

      // Priority 2: incomeWallet
      if (wallet.incomeWallet >= 1) {
        this.updateWallet(userId, {
          incomeWallet: wallet.incomeWallet - 1,
          lastSystemFeeDate: new Date().toISOString(),
          pendingSystemFee: remaining - 1
        });
        this._createSystemFeeTransaction(userId, 1, 'income wallet');
        this.addToSafetyPool(1, userId, 'Monthly system fee (deferred)');
        remaining--;
        deductedAny = true;
        continue;
      }

      // No more funds available
      break;
    }

    return deductedAny;
  }

  // ==================== PINS ====================
  static getPins(): Pin[] {
    return this.getCached<Pin[]>(DB_KEYS.PINS, []);
  }

  static savePins(pins: Pin[]): void {
    this.setCached(DB_KEYS.PINS, pins);
    this.syncPinWalletFromPins(pins);
  }

  private static syncPinWalletFromPins(pins: Pin[]): void {
    const wallets = this.getWallets();
    if (wallets.length === 0) return;

    const unusedPinCountByUserId = new Map<string, number>();
    for (const pin of pins) {
      if (pin.status !== 'unused') continue;
      const current = unusedPinCountByUserId.get(pin.ownerId) || 0;
      unusedPinCountByUserId.set(pin.ownerId, current + 1);
    }

    let changed = false;
    const updatedWallets = wallets.map((wallet) => {
      const nextPinWallet = unusedPinCountByUserId.get(wallet.userId) || 0;
      if ((wallet.pinWallet || 0) === nextPinWallet) return wallet;
      changed = true;
      return { ...wallet, pinWallet: nextPinWallet };
    });

    if (changed) {
      this.saveWallets(updatedWallets);
    }
  }

  static getPinById(id: string): Pin | undefined {
    return this.getPins().find(p => p.id === id);
  }

  static getPinByCode(pinCode: string): Pin | undefined {
    return this.getPins().find(p => p.pinCode === pinCode.toUpperCase());
  }

  static getUserPins(userId: string): Pin[] {
    return this.getPins().filter(p => p.ownerId === userId);
  }

  static getUnusedPins(userId: string): Pin[] {
    return this.getPins().filter(p => p.ownerId === userId && p.status === 'unused');
  }

  static getUsedPins(userId: string): Pin[] {
    return this.getPins().filter(p => p.ownerId === userId && p.status === 'used');
  }

  static getReceivedPins(userId: string): Pin[] {
    return this.getPins().filter(p => p.ownerId === userId && p.transferredFrom);
  }

  static getSuspendedPins(): Pin[] {
    return this.getPins().filter(p => p.status === 'suspended');
  }

  static generateUniquePinCode(): string {
    let pinCode = generatePinCode();
    while (this.getPinByCode(pinCode)) {
      pinCode = generatePinCode();
    }
    return pinCode;
  }

  // Generate PINs for a user (admin function)
  static generatePins(quantity: number, ownerId: string, createdBy: string): Pin[] {
    const pins: Pin[] = [];
    const allPins = this.getPins();

    for (let i = 0; i < quantity; i++) {
      const pin: Pin = {
        id: `pin_${Date.now()}_${i}`,
        pinCode: this.generateUniquePinCode(),
        amount: 11,
        status: 'unused',
        ownerId,
        createdBy,
        createdAt: new Date().toISOString()
      };
      pins.push(pin);
      allPins.push(pin);
    }

    this.savePins(allPins);
    return pins;
  }

  // Use PIN for registration
  static consumePin(pinCode: string, usedById: string): Pin | null {
    const pins = this.getPins();
    const index = pins.findIndex(p => p.pinCode === pinCode.toUpperCase());
    if (index === -1) return null;
    if (pins[index].status === 'suspended') return null;
    if (pins[index].status !== 'unused') return null;

    const user = this.getUserById(usedById);
    if (!user) {
      throw new Error('User record not found for this PIN usage');
    }

    pins[index].status = 'used';
    pins[index].usedAt = new Date().toISOString();
    pins[index].usedById = usedById;
    pins[index].registrationUserId = usedById;

    this.savePins(pins);
    return pins[index];
  }

  // Backward-compatible alias
  static usePin(pinCode: string, usedById: string): Pin | null {
    return this.consumePin(pinCode, usedById);
  }

  // Transfer PIN to another user
  static transferPin(pinId: string, toUserId: string, fromUserId: string): Pin | null {
    const pins = this.getPins();
    const index = pins.findIndex(p => p.id === pinId);
    if (index === -1) return null;
    if (pins[index].ownerId !== fromUserId) return null;
    if (pins[index].status === 'suspended') {
      throw new Error('Suspended PIN cannot be transferred');
    }
    if (pins[index].status !== 'unused') return null;

    // Check if in same chain
    if (!this.isInSameChain(fromUserId, toUserId)) {
      throw new Error('PIN can only be transferred to upline or downline members');
    }

    const fromUser = this.getUserById(fromUserId);
    const toUser = this.getUserById(toUserId);

    pins[index].ownerId = toUserId;
    pins[index].transferredFrom = fromUserId;
    pins[index].transferredAt = new Date().toISOString();

    this.savePins(pins);

    // Create transfer record
    this.createPinTransfer({
      id: `pt_${Date.now()}`,
      pinId,
      pinCode: pins[index].pinCode,
      fromUserId,
      fromUserName: fromUser?.fullName || '',
      toUserId,
      toUserName: toUser?.fullName || '',
      transferredAt: new Date().toISOString()
    });

    return pins[index];
  }

  static reclaimPinsFromUser(targetUserId: string, adminId: string, quantity: number, reason: string): Pin[] {
    const admin = this.getUserById(adminId);
    const targetUser = this.getUserByUserId(targetUserId) || this.getUserById(targetUserId);
    if (!admin || !targetUser) return [];
    if (quantity < 1) return [];

    const pins = this.getPins();
    const now = new Date().toISOString();
    const candidates = pins
      .filter((pin) => pin.ownerId === targetUser.id && pin.status === 'unused')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const selected = candidates.slice(0, quantity);
    if (selected.length === 0) return [];

    const selectedIds = new Set(selected.map((pin) => pin.id));
    const updatedPins = pins.map((pin) => {
      if (!selectedIds.has(pin.id)) return pin;
      return {
        ...pin,
        ownerId: adminId,
        transferredFrom: targetUser.id,
        transferredAt: now
      };
    });

    this.savePins(updatedPins);

    selected.forEach((pin) => {
      this.createPinTransfer({
        id: `pt_${Date.now()}_${pin.id}`,
        pinId: pin.id,
        pinCode: pin.pinCode,
        fromUserId: targetUser.id,
        fromUserName: targetUser.fullName,
        toUserId: adminId,
        toUserName: admin.fullName,
        transferredAt: now,
        notes: reason ? `Admin take-back: ${reason}` : 'Admin take-back'
      });
    });

    return selected;
  }

  static suspendPin(pinId: string, adminId: string, reason: string): Pin | null {
    const pins = this.getPins();
    const index = pins.findIndex(p => p.id === pinId);
    if (index === -1) return null;
    if (pins[index].status === 'used') {
      return null;
    }

    pins[index] = {
      ...pins[index],
      status: 'suspended',
      suspendedAt: new Date().toISOString(),
      suspendedBy: adminId,
      suspensionReason: reason
    };
    this.savePins(pins);
    return pins[index];
  }

  static unsuspendPin(pinId: string): Pin | null {
    const pins = this.getPins();
    const index = pins.findIndex(p => p.id === pinId);
    if (index === -1) return null;
    if (pins[index].status !== 'suspended') {
      return null;
    }

    pins[index] = {
      ...pins[index],
      status: 'unused',
      suspendedAt: undefined,
      suspendedBy: undefined,
      suspensionReason: undefined
    };
    this.savePins(pins);
    return pins[index];
  }

  // ==================== PIN TRANSFERS ====================
  static getPinTransfers(): PinTransfer[] {
    const data = this.getStorageItem(DB_KEYS.PIN_TRANSFERS);
    return data ? JSON.parse(data) : [];
  }

  static savePinTransfers(transfers: PinTransfer[]): void {
    this.setStorageItem(DB_KEYS.PIN_TRANSFERS, JSON.stringify(transfers));
  }

  static getUserPinTransfers(userId: string): PinTransfer[] {
    return this.getPinTransfers().filter(
      t => t.fromUserId === userId || t.toUserId === userId
    );
  }

  static createPinTransfer(transfer: PinTransfer): PinTransfer {
    const transfers = this.getPinTransfers();
    transfers.push(transfer);
    this.savePinTransfers(transfers);
    return transfer;
  }

  // ==================== PIN PURCHASE REQUESTS ====================
  static getPinPurchaseRequests(): PinPurchaseRequest[] {
    const data = this.getStorageItem(DB_KEYS.PIN_PURCHASE_REQUESTS);
    return data ? JSON.parse(data) : [];
  }

  static savePinPurchaseRequests(requests: PinPurchaseRequest[]): void {
    this.setStorageItem(DB_KEYS.PIN_PURCHASE_REQUESTS, JSON.stringify(requests));
  }

  static getUserPinPurchaseRequests(userId: string): PinPurchaseRequest[] {
    return this.getPinPurchaseRequests().filter(r => r.userId === userId);
  }

  static getPendingPinPurchaseRequests(): PinPurchaseRequest[] {
    return this.getPinPurchaseRequests().filter(r => r.status === 'pending');
  }

  static createPinPurchaseRequest(request: PinPurchaseRequest): PinPurchaseRequest {
    const requests = this.getPinPurchaseRequests();
    requests.push(request);
    this.savePinPurchaseRequests(requests);
    return request;
  }

  static updatePinPurchaseRequest(id: string, updates: Partial<PinPurchaseRequest>): PinPurchaseRequest | null {
    const requests = this.getPinPurchaseRequests();
    const index = requests.findIndex(r => r.id === id);
    if (index === -1) return null;

    requests[index] = { ...requests[index], ...updates };
    this.savePinPurchaseRequests(requests);
    return requests[index];
  }

  // Approve PIN purchase and generate PINs
  static approvePinPurchase(requestId: string, adminId: string): PinPurchaseRequest | null {
    const request = this.getPinPurchaseRequests().find(r => r.id === requestId);
    if (!request || request.status !== 'pending') return null;

    // Generate PINs for the user
    const pins = this.generatePins(request.quantity, request.userId, adminId);

    const updated = this.updatePinPurchaseRequest(requestId, {
      status: 'completed',
      processedAt: new Date().toISOString(),
      processedBy: adminId,
      pinsGenerated: pins.map(p => p.pinCode)
    });

    // Create transaction record
    const amount = request.paidFromWallet ? -request.amount : 0;
    this.createTransaction({
      id: generateEventId('tx', 'pin_purchase'),
      userId: request.userId,
      type: 'pin_purchase',
      amount,
      status: 'completed',
      description: request.paidFromWallet
        ? `Purchased ${request.quantity} PIN(s)`
        : `PIN purchase approved (${request.quantity} PINs)`,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    });

    return updated;
  }

  static reopenPinPurchaseRequest(requestId: string, adminId: string): PinPurchaseRequest | null {
    const request = this.getPinPurchaseRequests().find(r => r.id === requestId);
    if (!request) {
      throw new Error('Request not found');
    }
    if (request.status === 'pending') {
      return request;
    }

    if (request.status === 'completed') {
      const generatedCodes = request.pinsGenerated || [];
      if (generatedCodes.length > 0) {
        const allPins = this.getPins();
        const generatedPins = generatedCodes
          .map(code => allPins.find(p => p.pinCode === code))
          .filter((p): p is Pin => !!p);

        if (generatedPins.length !== generatedCodes.length) {
          throw new Error('Cannot reopen approved request because generated PIN records are missing');
        }

        const invalidPin = generatedPins.find(
          p => p.ownerId !== request.userId || p.status !== 'unused' || !!p.usedById || !!p.transferredFrom
        );
        if (invalidPin) {
          throw new Error('Cannot reopen approved request because one or more generated PINs are already used/transferred');
        }

        const remainingPins = allPins.filter(p => !generatedCodes.includes(p.pinCode));
        this.savePins(remainingPins);
      }
    }

    if (request.status === 'cancelled' && request.paidFromWallet) {
      const wallet = this.getWallet(request.userId);
      if (!wallet) {
        throw new Error('Wallet not found for this request');
      }
      if (wallet.depositWallet < request.amount) {
        throw new Error('Cannot reopen: insufficient fund wallet balance to relock request amount');
      }

      this.updateWallet(request.userId, {
        depositWallet: wallet.depositWallet - request.amount
      });

      this.createTransaction({
        id: generateEventId('tx', 'pin_relock'),
        userId: request.userId,
        type: 'admin_debit',
        amount: -request.amount,
        status: 'completed',
        description: `Re-opened PIN purchase request by admin (${adminId})`,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      });
    }

    return this.updatePinPurchaseRequest(requestId, {
      status: 'pending',
      processedAt: undefined,
      processedBy: undefined,
      adminNotes: `Reopened by admin (${adminId})`,
      pinsGenerated: undefined
    });
  }

  // ==================== SUPPORT TICKETS ====================
  private static generateSupportTicketId(): string {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `TKT-${stamp}-${rand}`;
  }

  private static normalizeSupportCategory(value: unknown): SupportTicketCategory {
    const candidate = String(value || '').trim().toLowerCase() as SupportTicketCategory;
    return SUPPORT_TICKET_CATEGORIES.includes(candidate) ? candidate : 'other';
  }

  private static normalizeSupportStatus(value: unknown): SupportTicketStatus {
    const candidate = String(value || '').trim().toLowerCase() as SupportTicketStatus;
    return SUPPORT_TICKET_STATUSES.includes(candidate) ? candidate : 'open';
  }

  private static normalizeSupportPriority(value: unknown): SupportTicketPriority {
    const candidate = String(value || '').trim().toLowerCase() as SupportTicketPriority;
    return SUPPORT_TICKET_PRIORITIES.includes(candidate) ? candidate : 'medium';
  }

  private static normalizeSupportAttachment(
    raw: any,
    fallbackUploadedBy: string,
    messageId?: string
  ): SupportTicketAttachment {
    return {
      id: String(raw?.id || generateEventId('att', 'support')),
      file_name: String(raw?.file_name || raw?.fileName || 'attachment'),
      file_type: String(raw?.file_type || raw?.fileType || ''),
      file_size: Number(raw?.file_size ?? raw?.fileSize ?? 0) || 0,
      data_url: String(raw?.data_url || raw?.dataUrl || ''),
      file_url: String(raw?.file_url || raw?.fileUrl || ''),
      uploaded_by: String(raw?.uploaded_by || raw?.uploadedBy || fallbackUploadedBy || ''),
      uploaded_at: String(raw?.uploaded_at || raw?.uploadedAt || new Date().toISOString()),
      message_id: String(raw?.message_id || raw?.messageId || messageId || '')
    };
  }

  private static normalizeSupportMessage(raw: any, fallbackUserId: string): SupportTicketMessage {
    const senderType: 'user' | 'admin' = raw?.sender_type === 'admin' ? 'admin' : 'user';
    const messageId = String(raw?.id || generateEventId('msg', `support_${senderType}`));
    const rawAttachments = Array.isArray(raw?.attachments) ? raw.attachments : [];
    return {
      id: messageId,
      sender_type: senderType,
      sender_user_id: String(raw?.sender_user_id || raw?.senderUserId || fallbackUserId || ''),
      sender_name: String(raw?.sender_name || raw?.senderName || (senderType === 'admin' ? 'Admin' : 'User')),
      message: String(raw?.message || ''),
      attachments: rawAttachments
        .map((item: any) => this.normalizeSupportAttachment(item, fallbackUserId, messageId))
        .filter((item: SupportTicketAttachment) => item.data_url || item.file_url),
      created_at: String(raw?.created_at || raw?.createdAt || new Date().toISOString()),
      edited_at: raw?.edited_at || raw?.editedAt ? String(raw?.edited_at || raw?.editedAt) : undefined,
      edited_by: raw?.edited_by === 'admin' ? 'admin' : raw?.edited_by === 'user' ? 'user' : undefined
    };
  }

  static getSupportTickets(): SupportTicket[] {
    const rawTickets = this.getCached<any[]>(DB_KEYS.SUPPORT_TICKETS, []);
    if (!Array.isArray(rawTickets)) return [];

    const normalized = rawTickets.map((ticket, index) => {
      const fallbackUserId = String(ticket?.user_id || ticket?.userId || '');
      const messagesRaw = Array.isArray(ticket?.messages) ? ticket.messages : [];
      const messages: SupportTicketMessage[] = messagesRaw.map((msg: any) => this.normalizeSupportMessage(msg, fallbackUserId));

      const topLevelAttachmentsRaw = Array.isArray(ticket?.attachments) ? ticket.attachments : [];
      const topLevelAttachments = topLevelAttachmentsRaw
        .map((item: any) => this.normalizeSupportAttachment(item, fallbackUserId))
        .filter((item: SupportTicketAttachment) => item.data_url || item.file_url);

      const messageAttachments = messages.flatMap((msg: SupportTicketMessage) => msg.attachments);
      const attachmentsById = new Map<string, SupportTicketAttachment>();
      [...topLevelAttachments, ...messageAttachments].forEach((attachment) => {
        if (attachment.data_url || attachment.file_url) attachmentsById.set(attachment.id, attachment);
      });

      const lastAdminMessage = [...messages].reverse().find((msg: SupportTicketMessage) => msg.sender_type === 'admin');

      return {
        ticket_id: String(ticket?.ticket_id || ticket?.ticketId || `TKT-LEGACY-${index + 1}`),
        user_id: fallbackUserId,
        category: this.normalizeSupportCategory(ticket?.category),
        subject: String(ticket?.subject || ''),
        priority: this.normalizeSupportPriority(ticket?.priority),
        status: this.normalizeSupportStatus(ticket?.status),
        messages,
        attachments: Array.from(attachmentsById.values()),
        created_at: String(ticket?.created_at || ticket?.createdAt || new Date().toISOString()),
        updated_at: String(ticket?.updated_at || ticket?.updatedAt || new Date().toISOString()),
        admin_reply: String(ticket?.admin_reply || ticket?.adminReply || lastAdminMessage?.message || ''),
        name: String(ticket?.name || ''),
        email: String(ticket?.email || '')
      } as SupportTicket;
    });

    return normalized.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }

  static saveSupportTickets(tickets: SupportTicket[]): void {
    this.setCached(DB_KEYS.SUPPORT_TICKETS, tickets);
  }

  static getSupportTicketById(ticketId: string): SupportTicket | null {
    return this.getSupportTickets().find((ticket) => ticket.ticket_id === ticketId) || null;
  }

  static getUserSupportTickets(userIdOrUserCode: string): SupportTicket[] {
    const userByInternalId = this.getUserById(userIdOrUserCode);
    const userByCode = this.getUserByUserId(userIdOrUserCode);
    const userCode = userByInternalId?.userId || userByCode?.userId || userIdOrUserCode;
    return this.getSupportTickets().filter((ticket) => ticket.user_id === userCode);
  }

  static createSupportTicket(params: {
    user_id: string;
    name: string;
    email: string;
    category: SupportTicketCategory;
    subject: string;
    message: string;
    priority: SupportTicketPriority;
    attachments?: SupportTicketAttachment[];
  }): SupportTicket {
    const now = new Date().toISOString();
    const ticket_id = this.generateSupportTicketId();
    const messageId = generateEventId('msg', 'support_user');

    const attachments = (params.attachments || [])
      .map((attachment) => this.normalizeSupportAttachment(attachment, params.user_id, messageId))
      .filter((attachment) => attachment.data_url || attachment.file_url);

    const initialMessage: SupportTicketMessage = {
      id: messageId,
      sender_type: 'user',
      sender_user_id: params.user_id,
      sender_name: params.name || params.user_id,
      message: String(params.message || '').trim(),
      attachments,
      created_at: now
    };

    const ticket: SupportTicket = {
      ticket_id,
      user_id: params.user_id,
      category: this.normalizeSupportCategory(params.category),
      subject: String(params.subject || '').trim(),
      priority: this.normalizeSupportPriority(params.priority),
      status: 'open',
      messages: [initialMessage],
      attachments,
      created_at: now,
      updated_at: now,
      admin_reply: '',
      name: String(params.name || '').trim(),
      email: String(params.email || '').trim()
    };

    const tickets = this.getSupportTickets();
    tickets.unshift(ticket);
    this.saveSupportTickets(tickets);

    const admins = this.getUsers().filter((member) => member.isAdmin);
    admins.forEach((admin) => {
      this.createNotification({
        id: generateEventId('notif', 'support_ticket'),
        userId: admin.id,
        title: 'New Support Ticket',
        message: `Ticket ${ticket.ticket_id} submitted by ${ticket.user_id}: ${ticket.subject}`,
        type: 'info',
        isRead: false,
        createdAt: now
      });
    });

    return ticket;
  }

  static addSupportTicketMessage(params: {
    ticket_id: string;
    sender_type: 'user' | 'admin';
    sender_user_id: string;
    sender_name: string;
    message: string;
    attachments?: SupportTicketAttachment[];
  }): SupportTicket | null {
    const tickets = this.getSupportTickets();
    const index = tickets.findIndex((item) => item.ticket_id === params.ticket_id);
    if (index === -1) return null;

    const now = new Date().toISOString();
    const messageId = generateEventId('msg', params.sender_type === 'admin' ? 'support_admin' : 'support_user');
    const attachments = (params.attachments || [])
      .map((attachment) => this.normalizeSupportAttachment(attachment, params.sender_user_id, messageId))
      .filter((attachment) => attachment.data_url || attachment.file_url);

    const newMessage: SupportTicketMessage = {
      id: messageId,
      sender_type: params.sender_type,
      sender_user_id: params.sender_user_id,
      sender_name: params.sender_name || (params.sender_type === 'admin' ? 'Admin' : 'User'),
      message: String(params.message || '').trim(),
      attachments,
      created_at: now
    };

    let nextStatus = tickets[index].status;
    if (params.sender_type === 'admin' && nextStatus !== 'closed') {
      nextStatus = 'awaiting_user_response';
    }
    if (
      params.sender_type === 'user'
      && (nextStatus === 'awaiting_user_response' || nextStatus === 'resolved' || nextStatus === 'closed')
    ) {
      nextStatus = 'open';
    }

    const updatedTicket: SupportTicket = {
      ...tickets[index],
      messages: [...tickets[index].messages, newMessage],
      attachments: [...tickets[index].attachments, ...attachments],
      status: nextStatus,
      updated_at: now,
      admin_reply: params.sender_type === 'admin' ? newMessage.message : tickets[index].admin_reply
    };

    tickets[index] = updatedTicket;
    this.saveSupportTickets(tickets);

    // Notify the ticket owner when admin replies
    if (params.sender_type === 'admin') {
      const ticketOwner = this.getUserByUserId(updatedTicket.user_id);
      if (ticketOwner) {
        this.createNotification({
          id: generateEventId('notif', 'support_reply'),
          userId: ticketOwner.id,
          title: 'Support Team Replied',
          message: `Admin replied to your ticket ${updatedTicket.ticket_id}: "${updatedTicket.subject}"`,
          type: 'info',
          isRead: false,
          createdAt: now
        });
      }
    }

    return updatedTicket;
  }

  static updateSupportTicketMessage(params: {
    ticket_id: string;
    message_id: string;
    editor_type: 'user' | 'admin';
    editor_user_id: string;
    message: string;
  }): SupportTicket | null {
    const tickets = this.getSupportTickets();
    const ticketIndex = tickets.findIndex((item) => item.ticket_id === params.ticket_id);
    if (ticketIndex === -1) return null;

    const ticket = tickets[ticketIndex];
    const messageIndex = ticket.messages.findIndex((msg) => msg.id === params.message_id);
    if (messageIndex === -1) return null;

    const existingMessage = ticket.messages[messageIndex];
    if (existingMessage.sender_type !== params.editor_type) {
      throw new Error('You can edit only your own support messages');
    }
    if (String(existingMessage.sender_user_id || '') !== String(params.editor_user_id || '')) {
      throw new Error('Message ownership mismatch');
    }

    const nextMessageText = String(params.message || '').trim();
    if (!nextMessageText) {
      throw new Error('Message cannot be empty');
    }

    if (nextMessageText === String(existingMessage.message || '').trim()) {
      return ticket;
    }

    const now = new Date().toISOString();
    const updatedMessage: SupportTicketMessage = {
      ...existingMessage,
      message: nextMessageText,
      edited_at: now,
      edited_by: params.editor_type
    };

    const nextMessages = [...ticket.messages];
    nextMessages[messageIndex] = updatedMessage;

    const lastAdminMessage = [...nextMessages].reverse().find((msg) => msg.sender_type === 'admin');
    const updatedTicket: SupportTicket = {
      ...ticket,
      messages: nextMessages,
      updated_at: now,
      admin_reply: lastAdminMessage?.message || ticket.admin_reply
    };

    tickets[ticketIndex] = updatedTicket;
    this.saveSupportTickets(tickets);
    return updatedTicket;
  }

  static updateSupportTicketStatus(
    ticketId: string,
    status: SupportTicketStatus,
    options?: { adminReply?: string }
  ): SupportTicket | null {
    const tickets = this.getSupportTickets();
    const index = tickets.findIndex((item) => item.ticket_id === ticketId);
    if (index === -1) return null;

    const now = new Date().toISOString();
    const prevStatus = tickets[index].status;
    const newStatus = this.normalizeSupportStatus(status);
    tickets[index] = {
      ...tickets[index],
      status: newStatus,
      updated_at: now,
      admin_reply: options?.adminReply ? String(options.adminReply).trim() : tickets[index].admin_reply
    };
    this.saveSupportTickets(tickets);

    // Notify the ticket owner when status changes
    if (prevStatus !== newStatus) {
      const ticketOwner = this.getUserByUserId(tickets[index].user_id);
      if (ticketOwner) {
        const statusLabels: Record<string, string> = {
          open: 'Open', in_progress: 'In Progress',
          awaiting_user_response: 'Awaiting Your Response',
          resolved: 'Resolved', closed: 'Closed'
        };
        this.createNotification({
          id: generateEventId('notif', 'support_status'),
          userId: ticketOwner.id,
          title: 'Ticket Status Updated',
          message: `Your ticket ${tickets[index].ticket_id} status changed to "${statusLabels[newStatus] || newStatus}"`,
          type: newStatus === 'resolved' ? 'success' : 'info',
          isRead: false,
          createdAt: now
        });
      }
    }

    return tickets[index];
  }

  // ==================== OTP RECORDS ====================
  static getOtpRecords(): OtpRecord[] {
    const data = this.getStorageItem(DB_KEYS.OTP_RECORDS);
    return data ? JSON.parse(data) : [];
  }

  static saveOtpRecords(records: OtpRecord[]): void {
    this.setStorageItem(DB_KEYS.OTP_RECORDS, JSON.stringify(records));
  }

  static generateOtp(userId: string, email: string, purpose: OtpRecord['purpose']): OtpRecord {
    // Invalidate existing OTPs for this user/purpose
    const records = this.getOtpRecords();
    const updated = records.map(r =>
      (r.userId === userId && r.purpose === purpose && !r.isUsed)
        ? { ...r, isUsed: true }
        : r
    );

    const otp: OtpRecord = {
      id: `otp_${Date.now()}`,
      userId,
      email,
      otp: generateOTP(),
      purpose,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
      isUsed: false
    };

    updated.push(otp);
    this.saveOtpRecords(updated);
    return otp;
  }

  static verifyOtp(userId: string, otp: string, purpose: OtpRecord['purpose']): boolean {
    const records = this.getOtpRecords();
    const record = records.find(
      r => r.userId === userId &&
        r.otp === otp &&
        r.purpose === purpose &&
        !r.isUsed &&
        new Date(r.expiresAt) > new Date()
    );

    if (!record) return false;

    // Mark as used
    record.isUsed = true;
    this.saveOtpRecords(records);
    return true;
  }

  static getEmailLogs(): EmailLog[] {
    const data = this.getStorageItem(DB_KEYS.EMAIL_LOGS);
    return data ? JSON.parse(data) : [];
  }

  static saveEmailLogs(logs: EmailLog[]): void {
    this.setStorageItem(DB_KEYS.EMAIL_LOGS, JSON.stringify(logs));
  }

  static createEmailLog(log: EmailLog): EmailLog {
    const logs = this.getEmailLogs();
    logs.push(log);
    this.saveEmailLogs(logs);
    return log;
  }

  static updateEmailLog(id: string, updates: Partial<EmailLog>): EmailLog | null {
    const logs = this.getEmailLogs();
    const index = logs.findIndex(l => l.id === id);
    if (index === -1) return null;
    logs[index] = { ...logs[index], ...updates };
    this.saveEmailLogs(logs);
    return logs[index];
  }

  static scanSuspiciousWithdrawalSubmissions(windowMinutes: number = 20): Array<{
    otpId: string;
    userId: string;
    internalUserId: string;
    fullName: string;
    email: string;
    otpCreatedAt: string;
    issue: string;
  }> {
    const windowMs = Math.max(1, windowMinutes) * 60 * 1000;
    const records = this.getOtpRecords()
      .filter((record) => record.purpose === 'withdrawal' && record.isUsed)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const transactions = this.getTransactions().filter((tx) => tx.type === 'withdrawal');

    return records.flatMap((record) => {
      const resolvedUser = this.resolveUserByRef(record.userId) || this.getUserByEmail(record.email);
      if (!resolvedUser) {
        return [{
          otpId: record.id,
          userId: record.userId,
          internalUserId: record.userId,
          fullName: 'Unknown user',
          email: record.email,
          otpCreatedAt: record.createdAt,
          issue: 'Used withdrawal OTP found, but the user record could not be resolved.'
        }];
      }

      const candidateRefs = new Set<string>([
        resolvedUser.id,
        resolvedUser.userId,
        record.userId
      ].filter(Boolean));

      const otpTime = new Date(record.createdAt).getTime();
      const matchingTx = transactions.find((tx) => {
        const txUser = this.resolveUserByRef(tx.userId);
        const txCandidateRefs = new Set<string>([
          tx.userId,
          tx.requesterUserId || '',
          txUser?.id || '',
          txUser?.userId || ''
        ].filter(Boolean));
        const sameUser = Array.from(candidateRefs).some((ref) => txCandidateRefs.has(ref));
        if (!sameUser) return false;

        const txTime = new Date(tx.createdAt).getTime();
        return txTime >= otpTime - 2 * 60 * 1000 && txTime <= otpTime + windowMs;
      });

      if (matchingTx) return [];

      return [{
        otpId: record.id,
        userId: resolvedUser.userId,
        internalUserId: resolvedUser.id,
        fullName: resolvedUser.fullName,
        email: record.email,
        otpCreatedAt: record.createdAt,
        issue: `Used withdrawal OTP has no recorded withdrawal request within ${windowMinutes} minutes.`
      }];
    });
  }

  // ==================== TRANSACTIONS ====================
  private static normalizeTransactionType(type: unknown): unknown {
    if (type === 'get_help') return 'receive_help';
    return type;
  }

  static async forceRemoteSyncNow(): Promise<void> {
    await this.forceRemoteSyncNowWithOptions();
  }

  static async authenticateUserViaBackend(userId: string, password: string): Promise<{ success: boolean; user?: User; message: string }> {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      return { success: false, message: 'Backend authentication is unavailable in this environment.' };
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutMs = 30000;
    const timeout = setTimeout(() => controller?.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.REMOTE_SYNC_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller?.signal,
        body: JSON.stringify({ userId, password })
      });

      const payload = await response.json().catch(() => ({} as Record<string, unknown>));
      if (!response.ok || payload?.ok === false) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : typeof payload?.message === 'string'
              ? payload.message
              : `Login failed (HTTP ${response.status})`;
        return { success: false, message };
      }

      const user = payload?.user as User | undefined;
      if (!user || typeof user !== 'object' || !user.id || !user.userId) {
        return { success: false, message: 'Backend returned invalid user data.' };
      }

      return { success: true, user, message: 'Login successful' };
    } catch (error) {
      const message =
        error instanceof Error
          ? (error.name === 'AbortError' ? `Login request timed out after ${timeoutMs}ms` : error.message)
          : 'Failed to contact backend login service.';
      return { success: false, message };
    } finally {
      clearTimeout(timeout);
    }
  }

  static getStartupRemoteSyncKeys(): string[] {
    return this.STARTUP_REMOTE_SYNC_BATCHES.flatMap((batch) => [...batch]);
  }

  static getStartupRemoteSyncBatches(): string[][] {
    return this.STARTUP_REMOTE_SYNC_BATCHES.map((batch) => [...batch]);
  }

  static getStartupDeferredRemoteSyncBatches(): string[][] {
    return this.STARTUP_DEFERRED_SYNC_BATCHES.map((batch) => [...batch]);
  }

  static getAdminCriticalRemoteSyncBatches(): string[][] {
    return [
      [DB_KEYS.USERS],
      [DB_KEYS.WALLETS],
      [DB_KEYS.SETTINGS, DB_KEYS.SAFETY_POOL]
    ];
  }

  static getAdminDeferredRemoteSyncBatches(): string[][] {
    return this.ADMIN_REMOTE_SYNC_BATCHES
      .map((batch) => [...batch])
      .filter((batch) => {
        const joined = batch.join(',');
        return joined !== DB_KEYS.USERS
          && joined !== DB_KEYS.WALLETS
          && joined !== `${DB_KEYS.SETTINGS},${DB_KEYS.SAFETY_POOL}`;
      });
  }

  static getAdminRemoteSyncBatches(): string[][] {
    return this.ADMIN_REMOTE_SYNC_BATCHES.map((batch) => [...batch]);
  }

  static async hydrateFromServerBatches(
    batches: Iterable<Iterable<string>>,
    options?: {
      strict?: boolean;
      maxAttempts?: number;
      timeoutMs?: number;
      retryDelayMs?: number;
      continueOnError?: boolean;
      requireAnySuccess?: boolean;
      onBatchError?: (keys: string[], error: unknown) => void;
    }
  ): Promise<void> {
    const normalizedBatches = Array.from(batches || [])
      .map((batch) => Array.from(batch || []).filter((key) => this.REMOTE_SYNC_KEYS.has(key)));
    let successCount = 0;
    let lastError: unknown = null;

    for (const keys of normalizedBatches) {
      if (keys.length === 0) {
        continue;
      }

      try {
        await this.hydrateFromServer({
          strict: options?.strict,
          maxAttempts: options?.maxAttempts,
          timeoutMs: options?.timeoutMs,
          retryDelayMs: options?.retryDelayMs,
          keys
        });
        successCount += 1;
      } catch (error) {
        lastError = error;
        options?.onBatchError?.(keys, error);
        if (!options?.continueOnError) {
          throw error;
        }
      }
    }

    if (options?.requireAnySuccess && successCount === 0) {
      throw lastError instanceof Error ? lastError : new Error('Backend hydration failed for all requested batches');
    }
  }

  static async forceRemoteSyncNowWithOptions(options?: {
    destructive?: boolean;
    full?: boolean;
    force?: boolean;
    timeoutMs?: number;
    maxAttempts?: number;
    retryDelayMs?: number;
  }): Promise<boolean> {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      return false;
    }

    if (this.remoteSyncTimer) {
      clearTimeout(this.remoteSyncTimer);
      this.remoteSyncTimer = null;
    }

    // Avoid racing an already-in-flight auto sync.
    while (this.remoteSyncInFlight) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    this.remoteSyncQueued = false;
    this.remoteSyncPending = false;
    this.markSyncing('Syncing all data to server');

    const maxAttempts = Math.max(1, Number(options?.maxAttempts ?? 2));
    const retryDelayMs = Math.max(100, Number(options?.retryDelayMs ?? 300));
    const timeoutMs = Math.max(1500, Number(options?.timeoutMs ?? this.REMOTE_SYNC_REQUEST_TIMEOUT_MS));
    const useFullSnapshot = options?.full !== false;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let finalUpdatedAt = this.remoteStateUpdatedAt;
      let anyFailed = false;

      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeout = setTimeout(() => controller?.abort(), timeoutMs);

        try {
          const targetKeys = useFullSnapshot
            ? Array.from(this.REMOTE_SYNC_KEYS)
            : Array.from(this.remoteSyncDirtyKeys);

          const heavyKeys = [
            'mlm_transactions',
            'mlm_help_trackers',
            'mlm_matrix',
            'mlm_users',
            'mlm_payments',
            'mlm_wallets',
            DB_KEYS.SUPPORT_TICKETS,
            DB_KEYS.MARKETPLACE_INVOICES,
            DB_KEYS.MARKETPLACE_REDEMPTIONS
          ];
          const batches: string[][] = [];

          const others = targetKeys.filter(k => !heavyKeys.includes(k));
          if (others.length > 0) batches.push(others);

          heavyKeys.forEach(hk => {
            if (targetKeys.includes(hk)) batches.push([hk]);
          });

          for (const batch of batches) {
            if (batch.length === 0) continue;
            const batchState: Record<string, string> = {};
            for (const key of batch) {
              const val = this.getStorageItem(key);
              const isObj = key === 'mlm_safety_pool' || key === 'mlm_settings';
              batchState[key] = typeof val === 'string' ? val : (isObj ? '{}' : '[]');
            }

            const payload = {
              state: batchState,
              baseUpdatedAt: finalUpdatedAt
            };

            const endpointUrl = this.getRemoteSyncWriteEndpoint(options);
            const separator = endpointUrl.includes('?') ? '&' : '?';
            const finalEndpoint = `${endpointUrl}${separator}chunk=1`;

            console.log(`[DB Sync Debug] Chunk ${batch.join(',')} -> ${finalEndpoint}`);
            console.log(`[DB Sync Debug] Using baseUpdatedAt: ${finalUpdatedAt}`);

            const response = await fetch(finalEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: controller?.signal
            });

            if (!response.ok) {
              const errText = await response.text().catch(() => '');
              console.error(`[DB Sync Error] HTTP ${response.status} from backend. Body: ${errText}`);

              if (response.status === 409 && attempt < maxAttempts) {
                console.warn('[DB Sync] Forced sync rejected due to stale snapshot. Re-hydrating from backend and retrying.');
                anyFailed = true;
                break;
              }
              throw new Error(`Remote sync failed with HTTP ${response.status}`);
            }

            const respPayload = await response.json() as { updatedAt?: unknown };
            if (typeof respPayload?.updatedAt === 'string') {
              finalUpdatedAt = respPayload.updatedAt;
            }
          }
        } finally {
          clearTimeout(timeout);
        }

        if (anyFailed) {
          await this.hydrateFromServer();
          continue;
        }

        this.remoteStateUpdatedAt = finalUpdatedAt;
        this.remoteSyncDirtyKeys.clear();
        this.markSynced('All changes synced');
        return true;
      } catch (e) {
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
      }
    }
    console.warn('[DB Sync] Failed to force-push local state to backend.');
    this.markOffline('Could not sync to backend. Retrying automatically.');
    return false;
  }

  static async forceRemoteSyncKeysNow(
    keys: Iterable<string>,
    options?: {
      destructive?: boolean;
      force?: boolean;
      timeoutMs?: number;
      maxAttempts?: number;
      retryDelayMs?: number;
    }
  ): Promise<boolean> {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      return false;
    }

    const targetKeys = Array.from(new Set(Array.from(keys || []).filter((key) => this.REMOTE_SYNC_KEYS.has(key))));
    if (targetKeys.length === 0) {
      return true;
    }

    if (this.remoteSyncTimer) {
      clearTimeout(this.remoteSyncTimer);
      this.remoteSyncTimer = null;
    }

    while (this.remoteSyncInFlight) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    this.remoteSyncQueued = false;
    this.remoteSyncPending = false;
    this.markSyncing(`Syncing ${targetKeys.length} data key${targetKeys.length === 1 ? '' : 's'} to server`);

    const maxAttempts = Math.max(1, Number(options?.maxAttempts ?? 2));
    const retryDelayMs = Math.max(100, Number(options?.retryDelayMs ?? 300));
    const timeoutMs = Math.max(1500, Number(options?.timeoutMs ?? this.REMOTE_SYNC_REQUEST_TIMEOUT_MS));

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let finalUpdatedAt = this.remoteStateUpdatedAt;
      let anyFailed = false;

      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeout = setTimeout(() => controller?.abort(), timeoutMs);

        try {
          for (const key of targetKeys) {
            const val = this.getStorageItem(key);
            const isObj = key === 'mlm_safety_pool' || key === 'mlm_settings';
            const payload = {
              state: {
                [key]: typeof val === 'string' ? val : (isObj ? '{}' : '[]')
              },
              baseUpdatedAt: finalUpdatedAt
            };

            const endpointUrl = this.getRemoteSyncWriteEndpoint(options);
            const separator = endpointUrl.includes('?') ? '&' : '?';
            const finalEndpoint = `${endpointUrl}${separator}chunk=1`;

            console.log(`[DB Sync Debug] Key ${key} -> ${finalEndpoint}`);
            console.log(`[DB Sync Debug] Using baseUpdatedAt: ${finalUpdatedAt}`);

            const response = await fetch(finalEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: controller?.signal
            });

            if (!response.ok) {
              const errText = await response.text().catch(() => '');
              console.error(`[DB Sync Error] HTTP ${response.status} from backend for ${key}. Body: ${errText}`);

              if (response.status === 409 && attempt < maxAttempts) {
                console.warn(`[DB Sync] Key ${key} rejected due to stale snapshot. Re-hydrating from backend and retrying.`);
                anyFailed = true;
                break;
              }
              throw new Error(`Remote sync failed with HTTP ${response.status}`);
            }

            const respPayload = await response.json() as { updatedAt?: unknown };
            if (typeof respPayload?.updatedAt === 'string') {
              finalUpdatedAt = respPayload.updatedAt;
            }
          }
        } finally {
          clearTimeout(timeout);
        }

        if (anyFailed) {
          await this.hydrateFromServer();
          continue;
        }

        this.remoteStateUpdatedAt = finalUpdatedAt;
        for (const key of targetKeys) {
          this.remoteSyncDirtyKeys.delete(key);
        }
        if (this.remoteSyncDirtyKeys.size > 0) {
          this.markSyncPending();
        } else {
          this.markSynced('All changes synced');
        }
        return true;
      } catch (e) {
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
      }
    }

    console.warn(`[DB Sync] Failed to force-push selected keys to backend: ${targetKeys.join(', ')}`);
    this.markOffline('Could not sync selected data to backend. Retrying automatically.');
    return false;
  }

  static async ensureFreshData(options?: {
    keys?: Iterable<string>;
    timeoutMs?: number;
    maxAttempts?: number;
    retryDelayMs?: number;
  }): Promise<void> {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return;

    const timeoutMs = Math.max(2000, Number(options?.timeoutMs ?? 12000));
    const maxAttempts = Math.max(1, Number(options?.maxAttempts ?? 2));
    const retryDelayMs = Math.max(100, Number(options?.retryDelayMs ?? 800));

    try {
      await this.forceRemoteSyncNowWithOptions({
        full: false,
        force: true,
        timeoutMs: Math.max(timeoutMs, 15000),
        maxAttempts,
        retryDelayMs: Math.max(300, retryDelayMs)
      });
    } catch {
      // best-effort sync
    }

    try {
      await this.hydrateFromServer({
        strict: true,
        maxAttempts,
        timeoutMs,
        retryDelayMs,
        keys: options?.keys
      });
    } catch {
      // best-effort sync
    }
  }

  static getRegistrationFreshDataKeys(): string[] {
    return [
      DB_KEYS.USERS,
      DB_KEYS.PINS,
      DB_KEYS.MATRIX,
      DB_KEYS.ANNOUNCEMENTS
    ];
  }

  static getPinFreshDataKeys(): string[] {
    return [DB_KEYS.PINS];
  }

  static getTransactionFreshDataKeys(): string[] {
    return [DB_KEYS.TRANSACTIONS];
  }

  private static hasHydratedRemoteKey(key: string): boolean {
    return this.hydratedRemoteKeys.has(key);
  }

  private static toSimpleUserLabel(refText?: string): string {
    const raw = String(refText || '').trim();
    if (!raw) return 'unknown user';

    const resolved = this.resolveUserByRef(raw);
    if (resolved?.userId) return `user ${resolved.userId}`;

    const sevenDigitMatch = raw.match(/\b(\d{7})\b/);
    if (sevenDigitMatch) return `user ${sevenDigitMatch[1]}`;

    return 'unknown user';
  }

  private static simplifySystemRecoveryDescription(description: string): string {
    const desc = String(description || '').trim();
    if (!desc) return desc;

    if (/refund for invalid give_help due to cascaded ghost income/i.test(desc)) {
      return 'System correction: Refunded an invalid give-help entry';
    }

    const ghostReceiveMatch = desc.match(/ghost receive help at level\s*(\d+)\s*from non-existent user\s*(.+)$/i);
    if (ghostReceiveMatch) {
      const level = ghostReceiveMatch[1];
      const userLabel = this.toSimpleUserLabel(ghostReceiveMatch[2]);
      return `System correction: Removed invalid level ${level} help from ${userLabel}`;
    }

    const duplicateReceiveMatch = desc.match(/duplicate receive help at level\s*(\d+)\s*from\s*(.+)$/i);
    if (duplicateReceiveMatch) {
      const level = duplicateReceiveMatch[1];
      const userLabel = this.toSimpleUserLabel(duplicateReceiveMatch[2]);
      return `System correction: Removed duplicate level ${level} help from ${userLabel}`;
    }

    const duplicateDirectMatch = desc.match(/duplicate direct income received from\s*(.+)$/i);
    if (duplicateDirectMatch) {
      const userLabel = this.toSimpleUserLabel(duplicateDirectMatch[1]);
      return `System correction: Removed duplicate referral income from ${userLabel}`;
    }

    const cascadedReceiveMatch = desc.match(/receive_help from\s*(.+?)\s*invalid due to cascaded ghost deduction/i);
    if (cascadedReceiveMatch) {
      const userLabel = this.toSimpleUserLabel(cascadedReceiveMatch[1]);
      return `System correction: Removed invalid receive help from ${userLabel}`;
    }

    const removedInvalidReceiveMatch = desc.match(/removed invalid receive help from user\s*(.+)$/i);
    if (removedInvalidReceiveMatch) {
      const userLabel = this.toSimpleUserLabel(removedInvalidReceiveMatch[1]);
      return `System correction: Removed invalid receive help from ${userLabel}`;
    }

    return desc;
  }

  private static normalizeTransactionRecord(tx: Transaction): Transaction {
    const normalizedType = this.normalizeTransactionType((tx as any).type);
    let nextTx: Transaction = tx;
    if (normalizedType !== (tx as any).type) {
      nextTx = {
        ...nextTx,
        type: normalizedType as Transaction['type']
      };
    }
    if (nextTx.description === 'Fund wallet credited from your income wallet transfer [Repair]') {
      nextTx = {
        ...nextTx,
        description: 'Fund wallet credited from your income wallet transfer'
      };
    }
    if (nextTx.type === 'fund_recovery') {
      const nextDescription = this.simplifySystemRecoveryDescription(String(nextTx.description || ''));
      if (nextDescription && nextDescription !== nextTx.description) {
        nextTx = {
          ...nextTx,
          description: nextDescription
        };
      }
    }
    return nextTx;
  }

  static getTransactions(): Transaction[] {
    const transactions: Transaction[] = this.getCached<Transaction[]>(DB_KEYS.TRANSACTIONS, []);
    let changed = false;
    const duplicateGiveMismatchRows = this.buildDuplicateLockedGiveHelpMismatchRows(transactions);
    const referralMismatchRows = this.buildReferralIncomeMismatchRowsFromTransactions(transactions);

    for (const tx of transactions) {
      const normalized = this.normalizeTransactionRecord(tx);
      if (normalized !== tx) {
        Object.assign(tx, normalized);
        changed = true;
      }
      if (
        tx.type === 'fund_recovery'
        && tx.status === 'completed'
        && tx.amount < 0
      ) {
        const desc = String(tx.description || '');
        const oldGenericFund = /^Admin debited from fund wallet to recover duplicate matrix give-help credits\./i.test(desc);
        const oldGenericIncome = /^Admin debited from income wallet to recover duplicate matrix give-help credits\./i.test(desc);
        const oldGenericReferralFund = /^Admin debited from fund wallet to recover duplicate referral income credits\b/i.test(desc);
        const oldGenericReferralIncome = /^Admin debited from income wallet to recover duplicate referral income credits\b/i.test(desc);
        if (oldGenericFund || oldGenericIncome) {
          const walletLabel = oldGenericIncome ? 'income' : 'fund';
          const matchingMismatch = duplicateGiveMismatchRows.find((row) =>
            this.transactionRefMatchesUser(tx.userId, this.getUserByUserId(row.recipientUserId))
            && Math.abs(Math.abs(Number(tx.amount || 0)) - row.extraCreditedAmount) <= 0.009
          );
          if (matchingMismatch) {
            const nextDescription = `Admin debited from ${walletLabel} wallet to recover duplicate give-help credits of ${matchingMismatch.senderName} (${matchingMismatch.senderUserId}). Remaining recovery due: $0.00`;
            if (tx.description !== nextDescription) {
              tx.description = nextDescription;
              changed = true;
            }
          }
        }
        if (oldGenericReferralFund || oldGenericReferralIncome) {
          const walletLabel = oldGenericReferralIncome ? 'income' : 'fund';
          const remainingDueMatch = desc.match(/Remaining recovery due:\s*\$([0-9]+(?:\.[0-9]{1,2})?)/i);
          const remainingDue = remainingDueMatch ? Math.round(Number(remainingDueMatch[1]) * 100) / 100 : 0;
          const recoveredAmount = Math.round(Math.abs(Number(tx.amount || 0)) * 100) / 100;
          const targetTotal = Math.round((recoveredAmount + remainingDue) * 100) / 100;
          const sponsorMatches = referralMismatchRows.filter((row) =>
            this.transactionRefMatchesUser(tx.userId, this.getUserByUserId(row.sponsorUserId))
          );
          const matchingMismatch = sponsorMatches.find((row) =>
            Math.abs((row.extraCreditedAmount || 0) - targetTotal) <= 0.009
          ) || (sponsorMatches.length === 1 ? sponsorMatches[0] : undefined);

          if (matchingMismatch) {
            const recoveryReason = this.buildReferralMismatchRecoveryReason(matchingMismatch);
            const nextDescription = `Admin debited from ${walletLabel} wallet to recover ${recoveryReason}. Remaining recovery due: $${remainingDue.toFixed(2)}`;
            if (tx.description !== nextDescription) {
              tx.description = nextDescription;
              changed = true;
            }
            if (String(tx.adminReason || '').trim() !== recoveryReason) {
              tx.adminReason = recoveryReason;
              changed = true;
            }
          }
        }
      }
      if (tx.type !== 'receive_help') continue;
      if (!tx.fromUserId || !tx.level) continue;
      if (!tx.description || !/^Received help at level \d+$/i.test(tx.description.trim())) continue;

      const fromUser = this.getUserById(tx.fromUserId);
      const fromSuffix = fromUser ? ` from ${fromUser.fullName} (${fromUser.userId})` : '';
      const nextDescription = `Received help at level ${tx.level}${fromSuffix}`;
      if (tx.description !== nextDescription) {
        tx.description = nextDescription;
        changed = true;
      }
    }

    if (changed) {
      this.saveTransactions(transactions);
    }

    return transactions;
  }

  static saveTransactions(transactions: Transaction[]): void {
    const normalized = transactions.map((tx) => this.normalizeTransactionRecord(tx));
    this.setCached(DB_KEYS.TRANSACTIONS, normalized);
  }

  static adminEditTransaction(
    txId: string,
    payload: {
      amount: number;
      status: Transaction['status'];
      description: string;
      reason: string;
      editedByAdminUserId?: string;
    }
  ): { success: boolean; message: string; transaction?: Transaction } {
    const id = String(txId || '').trim();
    if (!id) return { success: false, message: 'Transaction ID is required' };

    const nextAmount = Math.round(Number(payload.amount || 0) * 100) / 100;
    if (!Number.isFinite(nextAmount)) {
      return { success: false, message: 'Enter a valid transaction amount' };
    }

    const nextStatus = payload.status;
    const allowedStatuses: Transaction['status'][] = ['pending', 'completed', 'failed', 'cancelled', 'reversed'];
    if (!allowedStatuses.includes(nextStatus)) {
      return { success: false, message: 'Select a valid transaction status' };
    }

    const nextDescription = String(payload.description || '').trim();
    if (!nextDescription) {
      return { success: false, message: 'Description is required' };
    }

    const editReason = String(payload.reason || '').trim();
    if (!editReason) {
      return { success: false, message: 'Edit reason is required' };
    }

    const transactions = this.getTransactions();
    const index = transactions.findIndex((tx) => tx.id === id);
    if (index === -1) {
      return { success: false, message: 'Transaction not found' };
    }

    const existing = transactions[index];
    const now = new Date().toISOString();
    const updated: Transaction = {
      ...existing,
      displayAmount: nextAmount,
      status: nextStatus,
      description: nextDescription,
      adminReason: editReason,
      processedByAdminUserId: payload.editedByAdminUserId || existing.processedByAdminUserId,
      completedAt: nextStatus === 'completed'
        ? (existing.completedAt || now)
        : existing.completedAt
    };

    transactions[index] = updated;
    this.saveTransactions(transactions);

    return {
      success: true,
      message: 'Transaction updated successfully (display only)',
      transaction: updated
    };
  }

  static adminDeleteTransaction(
    txId: string,
    _payload?: {
      reason?: string;
      deletedByAdminUserId?: string;
    }
  ): { success: boolean; message: string } {
    const id = String(txId || '').trim();
    if (!id) {
      return { success: false, message: 'Transaction ID is required' };
    }

    const transactions = this.getTransactions();
    const index = transactions.findIndex((tx) => tx.id === id);
    if (index === -1) {
      return { success: false, message: 'Transaction not found' };
    }

    transactions.splice(index, 1);
    this.saveTransactions(transactions);

    return {
      success: true,
      message: 'Transaction deleted successfully'
    };
  }

  private static findDuplicateSensitiveTransaction(
    candidate: Transaction,
    transactions: Transaction[]
  ): Transaction | undefined {
    const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
    const candidateTime = this.getTransactionTime(candidate);
    const candidateLevel = this.resolveTransactionLevel(candidate) || Number(candidate.level) || 0;
    const candidateAmount = Math.abs(Number((candidate.displayAmount ?? candidate.amount) || 0));

    if (candidate.type === 'direct_income' && candidate.status === 'completed' && candidateAmount > 0) {
      const sponsor = this.resolveLikelySponsorForDirectIncome(candidate);
      const referral = this.resolveLikelyReferralSourceForDirectIncome(candidate, sponsor);
      if (sponsor && referral) {
        return this.findExistingReferralIncomeCreditTx(sponsor, referral, transactions);
      }

      const candidateDescription = this.getCanonicalDirectIncomeDescription(candidate);
      return transactions.find((tx) => {
        if (tx.type !== 'direct_income' || tx.status !== 'completed') return false;
        if (sponsor) {
          if (!this.directIncomeTxBelongsToSponsor(tx, sponsor)) return false;
        } else if (tx.userId !== candidate.userId) {
          return false;
        }
        return this.getCanonicalDirectIncomeDescription(tx) === candidateDescription;
      });
    }

    if (
      candidate.type === 'receive_help'
      && candidate.status === 'completed'
      && candidateLevel > 0
      && candidateAmount > 0
    ) {
      const recipient = this.resolveUserByRef(candidate.userId);
      const sender = candidate.fromUserId ? this.resolveUserByRef(candidate.fromUserId) : undefined;
      return transactions.find((tx) => {
        if (tx.type !== 'receive_help' || tx.status !== 'completed') return false;
        if (Number(tx.level) !== candidateLevel) return false;

        const existingAmount = Math.abs(Number((tx.displayAmount ?? tx.amount) || 0));
        if (Math.abs(existingAmount - candidateAmount) > 0.009) return false;

        if (candidate.sourceGiveHelpTxId && tx.sourceGiveHelpTxId === candidate.sourceGiveHelpTxId) {
          return true;
        }

        if (
          recipient
          && sender
          && this.transactionRefMatchesUser(tx.userId, recipient)
          && (
            (tx.fromUserId && this.transactionRefMatchesUser(tx.fromUserId, sender))
            || String(tx.description || '').includes(`(${sender.userId})`)
          )
          && Math.abs(this.getTransactionTime(tx) - candidateTime) <= DUPLICATE_WINDOW_MS
        ) {
          return true;
        }

        return false;
      });
    }

    if (
      candidate.type === 'give_help'
      && candidate.status === 'completed'
      && Number(candidate.amount || 0) < 0
      && candidateLevel > 0
      && candidateAmount > 0
      && String(candidate.description || '').toLowerCase().includes('from locked income')
    ) {
      const sender = this.resolveUserByRef(candidate.userId);
      const recipient = candidate.toUserId ? this.resolveUserByRef(candidate.toUserId) : undefined;
      return transactions.find((tx) => {
        if (tx.type !== 'give_help' || tx.status !== 'completed' || !(Number(tx.amount || 0) < 0)) return false;
        if (!String(tx.description || '').toLowerCase().includes('from locked income')) return false;
        if ((this.resolveTransactionLevel(tx) || Number(tx.level) || 0) !== candidateLevel) return false;

        const existingAmount = Math.abs(Number(tx.amount || 0));
        if (Math.abs(existingAmount - candidateAmount) > 0.009) return false;
        if (sender && !this.transactionRefMatchesUser(tx.userId, sender)) return false;

        if (recipient) {
          if (!this.giveHelpTargetsUser(tx, recipient)) return false;
        } else if (candidate.toUserId && tx.toUserId !== candidate.toUserId) {
          return false;
        }

        return Math.abs(this.getTransactionTime(tx) - candidateTime) <= DUPLICATE_WINDOW_MS;
      });
    }

    return undefined;
  }

  static getUserTransactions(userId: string): Transaction[] {
    const candidateIds = this.getRelatedInternalUserIdsForUserRef(userId);
    this.cleanupMisleadingFundRecoverySetupTransactions(candidateIds);
    const all = this.getTransactions();
    const indexed = all
      .map((tx, index) => ({ tx, index }))
      .filter(({ tx }) => candidateIds.has(tx.userId));

    const parseIdTime = (id: string | undefined): number => {
      const match = String(id || '').match(/_(\d{10,13})(?:_|$)/);
      if (!match) return 0;
      const n = Number(match[1]);
      if (!Number.isFinite(n)) return 0;
      return match[1].length === 10 ? n * 1000 : n;
    };

    indexed.sort((a, b) => {
      const timeDiff = new Date(b.tx.createdAt).getTime() - new Date(a.tx.createdAt).getTime();
      if (timeDiff !== 0) return timeDiff;

      const idTimeDiff = parseIdTime(b.tx.id) - parseIdTime(a.tx.id);
      if (idTimeDiff !== 0) return idTimeDiff;

      // Final tie-breaker for exact same timestamp/id-time: later inserted first.
      return b.index - a.index;
    });

    return indexed.map(({ tx }) => tx);
  }

  static createTransaction(transaction: Transaction): Transaction {
    // In bulk rebuild mode, skip creating transaction records to save memory
    if (this._bulkRebuildMode) return transaction;
    const transactions = this.getTransactions();
    const normalized = this.normalizeTransactionRecord(transaction);

    if (
      normalized.type === 'receive_help'
      && normalized.status === 'completed'
      && Number(normalized.amount || 0) > 0
    ) {
      const recipient = this.resolveUserByRef(normalized.userId);
      const sender = normalized.fromUserId ? this.resolveUserByRef(normalized.fromUserId) : undefined;
      if (!recipient || !sender) {
        return normalized;
      }
    }

    const existing = this.findDuplicateSensitiveTransaction(normalized, transactions);
    if (existing) {
      return existing;
    }
    transactions.push(normalized);
    this.saveTransactions(transactions);

    // PROACTIVE AUTO-FUND RECOVERY TRIGGER
    // If this is a credit transaction and user has debt, swallow it immediately
    if (!this._bulkRebuildMode && normalized.status === 'completed' && normalized.amount > 0) {
      const creditType = normalized.type;
      const isIncomeCredit = ['direct_income', 'level_income', 'receive_help', 'royalty_income', 'admin_credit'].includes(creditType);
      const isFundCredit = ['deposit', 'p2p_transfer'].includes(creditType);

      if (isIncomeCredit || isFundCredit) {
         const wallet = this.getWallet(normalized.userId);
         const debt = Number(wallet?.fundRecoveryDue || 0);
         if (debt > 0.0001) {
            const reason = String(wallet?.fundRecoveryReason || 'system correction').trim();
            this.executeAutoFundRecovery(
              normalized.userId, 
              normalized.amount, 
              isIncomeCredit ? 'income' : 'fund', 
              debt, 
              reason
            );
         }
      }
    }

    return normalized;
  }

  static getWithdrawalTransactions(): Transaction[] {
    return this.getTransactions()
      .filter((tx) => tx.type === 'withdrawal')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  static processWithdrawalRequest(params: {
    transactionId: string;
    adminUserId: string;
    action: 'approve' | 'reject';
    adminReason?: string;
    adminReceipt?: string;
  }): { success: boolean; message: string; transaction?: Transaction } {
    const transactions = this.getTransactions();
    const index = transactions.findIndex((tx) => tx.id === params.transactionId && tx.type === 'withdrawal');
    if (index === -1) return { success: false, message: 'Withdrawal request not found' };

    const request = transactions[index];
    if (request.status !== 'pending') {
      return { success: false, message: `Withdrawal request is already ${request.status}` };
    }

    const now = new Date().toISOString();
    const reason = String(params.adminReason || '').trim();
    const receipt = String(params.adminReceipt || '').trim();

    if (params.action === 'approve') {
      const completedAmount = Math.abs(Number(request.amount || 0));
      const approved: Transaction = {
        ...request,
        status: 'completed',
        description: `Withdrawal Completed of $${completedAmount.toFixed(2)} Amount`,
        completedAt: now,
        processedByAdminUserId: params.adminUserId,
        ...(reason ? { adminReason: reason } : {}),
        ...(receipt ? { adminReceipt: receipt } : {})
      };
      transactions[index] = approved;
      this.saveTransactions(transactions);
      return { success: true, message: 'Withdrawal marked as completed', transaction: approved };
    }

    const refundAmount = Math.abs(Number(request.amount || 0));
    if (refundAmount > 0) {
      const requestUser = this.resolveUserByRef(request.userId);
      const walletOwnerId = requestUser?.id || request.userId;
      const wallet = this.getWallet(walletOwnerId);
      if (wallet) {
        this.updateWallet(walletOwnerId, {
          incomeWallet: (wallet.incomeWallet || 0) + refundAmount
        });
      }

      this.createTransaction({
        id: generateEventId('tx', 'withdraw_refund'),
        userId: walletOwnerId,
        type: 'income_transfer',
        amount: refundAmount,
        status: 'completed',
        description: reason
          ? `Withdrawal request rejected. Amount refunded to income wallet. Reason: ${reason}`
          : 'Withdrawal request rejected. Amount refunded to income wallet.',
        createdAt: now,
        completedAt: now
      });
    }

    const rejectedDescription = reason
      ? `Withdrawal Rejected due to: ${reason}`
      : 'Withdrawal Rejected by admin';

    const rejected: Transaction = {
      ...request,
      status: 'failed',
      description: rejectedDescription,
      completedAt: now,
      processedByAdminUserId: params.adminUserId,
      ...(reason ? { adminReason: reason } : {}),
      ...(receipt ? { adminReceipt: receipt } : {})
    };
    transactions[index] = rejected;
    this.saveTransactions(transactions);
    return { success: true, message: 'Withdrawal request rejected and refunded', transaction: rejected };
  }

  // ==================== MATRIX ====================
  private static sanitizeMatrixReferences(matrix: MatrixNode[]): { matrix: MatrixNode[]; changed: boolean } {
    const nodeMap = new Map(matrix.map((node) => [node.userId, node]));
    let changed = false;

    const normalized = matrix.map((node) => {
      const next: MatrixNode = { ...node };

      if (next.parentId && !nodeMap.has(next.parentId)) {
        delete next.parentId;
        changed = true;
      }

      if (next.leftChild && !nodeMap.has(next.leftChild)) {
        delete next.leftChild;
        changed = true;
      }

      if (next.rightChild && !nodeMap.has(next.rightChild)) {
        delete next.rightChild;
        changed = true;
      }

      if (next.leftChild && next.rightChild && next.leftChild === next.rightChild) {
        delete next.rightChild;
        changed = true;
      }

      return next;
    });

    // Repair pass: rebuild leftChild/rightChild from parentId + position
    const normalizedMap = new Map(normalized.map((node) => [node.userId, node]));
    for (const node of normalized) {
      if (!node.parentId) continue;
      const parent = normalizedMap.get(node.parentId);
      if (!parent) continue;
      // Use loose equality to handle string/number position values
      const isLeft = node.position == 0 || node.position === 'left' as any;
      const isRight = node.position == 1 || node.position === 'right' as any;
      if (isLeft && parent.leftChild !== node.userId) {
        parent.leftChild = node.userId;
        changed = true;
      }
      if (isRight && parent.rightChild !== node.userId) {
        parent.rightChild = node.userId;
        changed = true;
      }
    }

    return { matrix: normalized, changed };
  }

  static getMatrix(): MatrixNode[] {
    const CACHE_KEY_MATRIX_NORMALIZED = '__matrix_normalized';
    if (this._cache.has(CACHE_KEY_MATRIX_NORMALIZED)) {
      return this._cache.get(CACHE_KEY_MATRIX_NORMALIZED) as MatrixNode[];
    }
    const parsed = this.getCached<unknown>(DB_KEYS.MATRIX, []);
    const matrix = Array.isArray(parsed) ? (parsed as MatrixNode[]) : [];
    const { matrix: normalized, changed } = this.sanitizeMatrixReferences(matrix);
    if (changed) {
      this.saveMatrix(normalized);
    }
    this._cache.set(CACHE_KEY_MATRIX_NORMALIZED, normalized);
    return normalized;
  }

  static saveMatrix(matrix: MatrixNode[]): void {
    this._cache.delete('__matrix_normalized');
    this.setCached(DB_KEYS.MATRIX, matrix);
  }

  static getMatrixNode(userId: string): MatrixNode | undefined {
    return this.getMatrix().find(m => m.userId === userId);
  }

  static getUserDownline(userId: string, maxDepth: number = Number.POSITIVE_INFINITY): MatrixNode[] {
    const matrix = this.getMatrix();
    if (!matrix.length) return [];

    const childrenMap = this.buildMatrixChildrenMap(matrix);
    const nodeMap = new Map(matrix.map((node) => [node.userId, node]));
    const limit = Number.isFinite(maxDepth) ? Math.max(1, Math.floor(maxDepth)) : Number.MAX_SAFE_INTEGER;
    const visited = new Set<string>([userId]);
    const downline: MatrixNode[] = [];
    const queue: Array<{ userId: string; depth: number }> = [{ userId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= limit) continue;

      const children = childrenMap.get(current.userId) || [];
      for (const childUserId of children) {
        if (visited.has(childUserId)) continue;
        visited.add(childUserId);

        const childNode = nodeMap.get(childUserId);
        if (!childNode) continue;
        downline.push(childNode);
        queue.push({ userId: childUserId, depth: current.depth + 1 });
      }
    }

    return downline;
  }

  static getTeamCounts(userId: string): { left: number; right: number; leftActive: number; rightActive: number } {
    const matrix = this.getMatrix();
    // Build Map once — O(N) — then traverse with O(1) lookups instead of O(N) per node.
    const nodeMap = new Map<string, MatrixNode>(matrix.map(m => [m.userId, m]));
    const userNode = nodeMap.get(userId);

    if (!userNode) {
      return { left: 0, right: 0, leftActive: 0, rightActive: 0 };
    }

    const countTeam = (nodeId: string | undefined): { total: number; active: number } => {
      if (!nodeId) return { total: 0, active: 0 };

      const visited = new Set<string>();
      const stack: string[] = [nodeId];
      let total = 0;
      let active = 0;

      while (stack.length > 0) {
        const currentId = stack.pop()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const node = nodeMap.get(currentId);
        if (!node) continue;

        total += 1;
        if (node.isActive) active += 1;

        if (node.leftChild) stack.push(node.leftChild);
        if (node.rightChild) stack.push(node.rightChild);
      }

      return { total, active };
    };

    const leftStats = userNode.leftChild ? countTeam(userNode.leftChild) : { total: 0, active: 0 };
    const rightStats = userNode.rightChild ? countTeam(userNode.rightChild) : { total: 0, active: 0 };

    return {
      left: leftStats.total,
      right: rightStats.total,
      leftActive: leftStats.active,
      rightActive: rightStats.active
    };
  }

  private static normalizeMatrixSide(position: unknown): 'left' | 'right' | null {
    if (position === 'left' || position === 0 || position === '0') return 'left';
    if (position === 'right' || position === 1 || position === '1') return 'right';
    return null;
  }

  private static ensureMatrixNodeForUser(userId: string, visited: Set<string> = new Set()): MatrixNode | undefined {
    const existingNode = this.getMatrixNode(userId);
    if (existingNode) return existingNode;
    if (visited.has(userId)) return undefined;
    visited.add(userId);

    const user = this.getUserByUserId(userId);
    if (!user) return undefined;

    let parentNode: MatrixNode | undefined;
    if (user.parentId) {
      parentNode = this.ensureMatrixNodeForUser(user.parentId, visited);
      if (!parentNode) return undefined;
    } else if (!user.isAdmin && user.userId !== '1000001') {
      return undefined;
    }

    const side = user.parentId ? this.normalizeMatrixSide(user.position) : 'left';
    if (user.parentId && !side) return undefined;

    this.addMatrixNode({
      userId: user.userId,
      username: user.fullName,
      level: parentNode ? parentNode.level + 1 : 0,
      position: side === 'right' ? 1 : 0,
      parentId: parentNode?.userId,
      isActive: !!user.isActive && user.accountStatus !== 'permanent_blocked' && user.accountStatus !== 'temp_blocked'
    });

    return this.getMatrixNode(userId);
  }

  static findNextPosition(sponsorId: string): { parentId: string; position: 'left' | 'right' } | null {
    const sponsorNode = this.getMatrixNode(sponsorId) || this.ensureMatrixNodeForUser(sponsorId);
    if (!sponsorNode) return null;

    const matrix = this.getMatrix();
    const nodeMap = new Map<string, MatrixNode>(matrix.map((node) => [node.userId, node]));
    const childSideMap = new Map<string, { left?: string; right?: string }>();

    const setChild = (parentId: string | undefined, side: 'left' | 'right' | null, childId: string | undefined) => {
      if (!parentId || !childId || !side) return;
      if (!nodeMap.has(parentId) || !nodeMap.has(childId)) return;

      const existing = childSideMap.get(parentId) || {};
      if (side === 'left' && !existing.left) existing.left = childId;
      if (side === 'right' && !existing.right) existing.right = childId;
      childSideMap.set(parentId, existing);
    };

    for (const node of matrix) {
      setChild(node.parentId, this.normalizeMatrixSide(node.position), node.userId);
    }

    for (const node of matrix) {
      setChild(node.userId, 'left', node.leftChild);
      setChild(node.userId, 'right', node.rightChild);
    }

    const queue: string[] = [sponsorNode.userId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const currentNode = nodeMap.get(currentId);
      if (!currentNode) continue;

      const children = childSideMap.get(currentId) || {};
      const leftChild = children.left;
      const rightChild = children.right;

      if (!leftChild) {
        return { parentId: currentId, position: 'left' };
      }

      if (!rightChild) {
        return { parentId: currentId, position: 'right' };
      }

      queue.push(leftChild, rightChild);
    }

    return null;
  }

  static addMatrixNode(node: MatrixNode): MatrixNode {
    const matrix = this.getMatrix();
    if (node.parentId) {
      const parentNode = matrix.find((m) => m.userId === node.parentId);
      if (parentNode) {
        if (node.position === 0 && !parentNode.leftChild) {
          parentNode.leftChild = node.userId;
        }
        if (node.position === 1 && !parentNode.rightChild) {
          parentNode.rightChild = node.userId;
        }
      }
    }
    matrix.push(node);
    this.saveMatrix(matrix);
    return node;
  }

  // ==================== SAFETY POOL ====================
  static getSafetyPool(): { totalAmount: number; transactions: SafetyPoolTransaction[] } {
    return this.getCached<{ totalAmount: number; transactions: SafetyPoolTransaction[] }>(
      DB_KEYS.SAFETY_POOL,
      { totalAmount: 0, transactions: [] }
    );
  }

  static saveSafetyPool(pool: { totalAmount: number; transactions: SafetyPoolTransaction[] }): void {
    this.setCached(DB_KEYS.SAFETY_POOL, pool);
  }

  static addToSafetyPool(amount: number, fromUserId: string, reason: string): void {
    // In bulk rebuild mode, only track total — skip individual entries to save memory
    if (this._bulkRebuildMode) {
      this._bulkSafetyPoolTotal += amount;
      return;
    }
    const pool = this.getSafetyPool();
    pool.totalAmount += amount;
    pool.transactions.push({
      id: generateEventId('sp', reason),
      amount,
      fromUserId,
      reason,
      createdAt: new Date().toISOString()
    });
    this.saveSafetyPool(pool);
  }

  static deductFromSafetyPool(amount: number, fromUserId: string, reason: string): void {
    const normalizedAmount = Number(amount || 0);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      throw new Error('Invalid safety pool deduction amount');
    }

    if (this._bulkRebuildMode) {
      this._bulkSafetyPoolTotal -= normalizedAmount;
      return;
    }

    const pool = this.getSafetyPool();
    if ((pool.totalAmount || 0) < normalizedAmount) {
      throw new Error('Insufficient safety pool balance');
    }

    pool.totalAmount = Math.max(0, (pool.totalAmount || 0) - normalizedAmount);
    pool.transactions.push({
      id: generateEventId('sp', reason),
      amount: -normalizedAmount,
      fromUserId,
      reason,
      createdAt: new Date().toISOString()
    });
    this.saveSafetyPool(pool);
  }

  // ==================== GRACE PERIODS ====================
  static getGracePeriods(): GracePeriod[] {
    const data = this.getStorageItem(DB_KEYS.GRACE_PERIODS);
    return data ? JSON.parse(data) : [];
  }

  static saveGracePeriods(periods: GracePeriod[]): void {
    this.setStorageItem(DB_KEYS.GRACE_PERIODS, JSON.stringify(periods));
  }

  static getUserGracePeriod(userId: string): GracePeriod | undefined {
    return this.getGracePeriods().find(g => g.userId === userId && !g.isCompleted);
  }

  static createGracePeriod(period: GracePeriod): GracePeriod {
    const periods = this.getGracePeriods();
    periods.push(period);
    this.saveGracePeriods(periods);
    return period;
  }

  // ==================== NOTIFICATIONS / ANNOUNCEMENTS ====================
  static getAnnouncements(): AdminAnnouncement[] {
    return this.getCached<AdminAnnouncement[]>(DB_KEYS.ANNOUNCEMENTS, [])
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  static saveAnnouncements(announcements: AdminAnnouncement[]): void {
    this.setCached(DB_KEYS.ANNOUNCEMENTS, announcements);
  }

  static getNotifications(): Notification[] {
    return this.getCached<Notification[]>(DB_KEYS.NOTIFICATIONS, []);
  }

  static saveNotifications(notifications: Notification[]): void {
    this.setCached(DB_KEYS.NOTIFICATIONS, notifications);
  }

  static getUserNotifications(userId: string): Notification[] {
    const announcements = this.getAnnouncements();
    const nowTs = Date.now();
    const announcementById = new Map(
      announcements.map((announcement) => [announcement.id, announcement] as const)
    );
    return this.getNotifications()
      .filter(n => n.userId === userId)
      .filter((notification) => {
        if (!notification.announcementId) return true;
        const announcement = announcementById.get(notification.announcementId);
        if (!announcement) return true; // don't hide if announcements aren't synced yet
        if (announcement.isRecalled) return false;
        if (announcement.expiresAt && Date.parse(announcement.expiresAt) <= nowTs) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  static createNotification(notification: Notification): Notification {
    const notifications = this.getNotifications();
    notifications.push(notification);
    this.saveNotifications(notifications);
    return notification;
  }

  static broadcastNotificationToAllUsers(params: {
    title: string;
    message: string;
    type?: Notification['type'];
    imageUrl?: string;
    includeAdmins?: boolean;
    announcementId?: string;
  }): Notification[] {
    const title = String(params.title || '').trim();
    const message = String(params.message || '').trim();
    if (!title || !message) return [];

    const now = new Date().toISOString();
    const imageUrl = String(params.imageUrl || '').trim();
    const users = this.getUsers().filter((member) => (params.includeAdmins ? true : !member.isAdmin));
    if (users.length === 0) return [];

    const notifications = this.getNotifications();
    const created: Notification[] = users.map((member) => ({
      id: generateEventId('notif', 'admin_announcement'),
      userId: member.id,
      title,
      message,
      type: params.type || 'info',
      isRead: false,
      createdAt: now,
      ...(params.announcementId ? { announcementId: params.announcementId } : {}),
      ...(imageUrl ? { imageUrl } : {})
    }));

    notifications.push(...created);
    this.saveNotifications(notifications);
    return created;
  }

  static createAnnouncement(params: {
    title: string;
    message: string;
    imageUrl?: string;
    type?: Notification['type'];
    createdById: string;
    createdByUserId: string;
    includeAdmins?: boolean;
    isPermanent?: boolean;
    durationDays?: number;
    includeFutureUsers?: boolean;
  }): AdminAnnouncement | null {
    const title = String(params.title || '').trim();
    const message = String(params.message || '').trim();
    if (!title || !message) return null;

    const imageUrl = String(params.imageUrl || '').trim();
    const isPermanent = params.isPermanent ?? true;
    const durationDays = isPermanent ? undefined : Math.max(1, Number(params.durationDays || 0));
    const expiresAt = isPermanent || !durationDays
      ? undefined
      : new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    const includeFutureUsers = params.includeFutureUsers ?? isPermanent;
    const announcementId = generateEventId('ann', 'broadcast');
    const created = this.broadcastNotificationToAllUsers({
      title,
      message,
      type: params.type || 'info',
      imageUrl: imageUrl || undefined,
      includeAdmins: params.includeAdmins ?? true,
      announcementId
    });

    if (created.length === 0) return null;

    const announcement: AdminAnnouncement = {
      id: announcementId,
      title,
      message,
      type: params.type || 'info',
      totalRecipients: created.length,
      createdAt: new Date().toISOString(),
      createdById: params.createdById,
      createdByUserId: params.createdByUserId,
      isRecalled: false,
      isPermanent,
      includeFutureUsers,
      ...(durationDays ? { durationDays } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(params.includeAdmins !== undefined ? { includeAdmins: params.includeAdmins } : {}),
      ...(imageUrl ? { imageUrl } : {})
    };

    const announcements = this.getAnnouncements();
    announcements.unshift(announcement);
    this.saveAnnouncements(announcements);
    return announcement;
  }

  static updateAnnouncement(params: {
    id: string;
    title: string;
    message: string;
    imageUrl?: string;
    type?: Notification['type'];
    updatedByUserId: string;
    isPermanent?: boolean;
    durationDays?: number;
    includeFutureUsers?: boolean;
  }): {
    success: boolean;
    message: string;
    announcement?: AdminAnnouncement;
  } {
    const id = String(params.id || '').trim();
    const title = String(params.title || '').trim();
    const message = String(params.message || '').trim();
    const imageUrl = String(params.imageUrl || '').trim();
    if (!id) {
      return { success: false, message: 'Announcement ID is required' };
    }
    if (!title || !message) {
      return { success: false, message: 'Title and message are required' };
    }

    const announcements = this.getAnnouncements();
    const index = announcements.findIndex((announcement) => announcement.id === id);
    if (index === -1) {
      return { success: false, message: 'Announcement not found' };
    }

    const existing = announcements[index];
    if (existing.isRecalled) {
      return { success: false, message: 'Recalled announcements cannot be edited' };
    }

    const now = new Date().toISOString();
    const isPermanent = params.isPermanent ?? existing.isPermanent ?? true;
    const durationDays = isPermanent ? undefined : Math.max(1, Number(params.durationDays || existing.durationDays || 0));
    const expiresAt = isPermanent || !durationDays
      ? undefined
      : new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    const includeFutureUsers = params.includeFutureUsers ?? existing.includeFutureUsers ?? isPermanent;

    const updatedAnnouncement: AdminAnnouncement = {
      ...existing,
      title,
      message,
      type: params.type || existing.type || 'info',
      imageUrl: imageUrl || '',
      updatedAt: now,
      updatedByUserId: String(params.updatedByUserId || '').trim(),
      isPermanent,
      includeFutureUsers,
      ...(durationDays ? { durationDays } : {}),
      ...(expiresAt ? { expiresAt } : {})
    };
    announcements[index] = updatedAnnouncement;
    this.saveAnnouncements(announcements);

    const notifications = this.getNotifications();
    let updatedNotifications = 0;
    const refreshed = notifications.map((notification) => {
      if (notification.announcementId !== id) return notification;
      updatedNotifications += 1;
      return {
        ...notification,
        title,
        message,
        type: params.type || notification.type || 'info',
        imageUrl: imageUrl || undefined
      };
    });
    if (updatedNotifications > 0) {
      this.saveNotifications(refreshed);
    }

    return {
      success: true,
      message: updatedNotifications > 0
        ? `Announcement updated for ${updatedNotifications} notification(s).`
        : 'Announcement updated.',
      announcement: updatedAnnouncement
    };
  }

  static recallAnnouncement(announcementId: string, recalledByUserId: string): {
    success: boolean;
    message: string;
    removedNotifications: number;
    announcement?: AdminAnnouncement;
  } {
    const id = String(announcementId || '').trim();
    if (!id) {
      return { success: false, message: 'Announcement ID is required', removedNotifications: 0 };
    }

    const announcements = this.getAnnouncements();
    const index = announcements.findIndex((announcement) => announcement.id === id);
    if (index === -1) {
      const currentNotifications = this.getNotifications();
      const related = currentNotifications.filter((notification) => notification.announcementId === id);
      if (related.length === 0) {
        return { success: false, message: 'Announcement not found', removedNotifications: 0 };
      }
      const earliest = related.reduce((min, n) => {
        if (!min) return n;
        return new Date(n.createdAt).getTime() < new Date(min.createdAt).getTime() ? n : min;
      }, null as Notification | null);
      const placeholder: AdminAnnouncement = {
        id,
        title: earliest?.title || 'Announcement',
        message: earliest?.message || '',
        imageUrl: earliest?.imageUrl,
        type: earliest?.type || 'info',
        totalRecipients: related.length,
        createdAt: earliest?.createdAt || new Date().toISOString(),
        createdById: 'system',
        createdByUserId: 'system',
        isRecalled: false,
        isPermanent: true,
        includeFutureUsers: true
      };
      announcements.unshift(placeholder);
    }

    const existing = announcements[index];
    const currentNotifications = this.getNotifications();
    const filteredNotifications = currentNotifications.filter((notification) => notification.announcementId !== id);
    const removedNotifications = currentNotifications.length - filteredNotifications.length;
    if (removedNotifications > 0) {
      this.saveNotifications(filteredNotifications);
    }

    const now = new Date().toISOString();
    const recalledAnnouncement: AdminAnnouncement = {
      ...existing,
      isRecalled: true,
      recalledAt: existing.recalledAt || now,
      recalledByUserId: existing.recalledByUserId || String(recalledByUserId || '').trim()
    };
    announcements[index] = recalledAnnouncement;
    this.saveAnnouncements(announcements);

    if (existing.isRecalled) {
      return {
        success: true,
        message: removedNotifications > 0
          ? `Announcement was already recalled. Removed ${removedNotifications} remaining notification(s).`
          : 'Announcement was already recalled.',
        removedNotifications,
        announcement: recalledAnnouncement
      };
    }

    return {
      success: true,
      message: `Announcement recalled successfully. Removed ${removedNotifications} notification(s).`,
      removedNotifications,
      announcement: recalledAnnouncement
    };
  }

  static applyAnnouncementsForNewUser(userId: string): {
    created: number;
  } {
    const user = this.getUserById(userId);
    if (!user) return { created: 0 };

    const announcements = this.getAnnouncements();
    const nowTs = Date.now();
    const notifications = this.getNotifications();
    let created = 0;
    let updatedAnnouncements = false;

    for (const announcement of announcements) {
      if (announcement.isRecalled) continue;
      if (announcement.expiresAt && Date.parse(announcement.expiresAt) <= nowTs) continue;
      if (!announcement.includeFutureUsers) continue;
      if (user.isAdmin && announcement.includeAdmins === false) continue;

      const alreadyNotified = notifications.some(
        (n) => n.userId === user.id && n.announcementId === announcement.id
      );
      if (alreadyNotified) continue;

      notifications.push({
        id: generateEventId('notif', 'admin_announcement'),
        userId: user.id,
        title: announcement.title,
        message: announcement.message,
        type: announcement.type || 'info',
        isRead: false,
        createdAt: new Date().toISOString(),
        announcementId: announcement.id,
        ...(announcement.imageUrl ? { imageUrl: announcement.imageUrl } : {})
      });
      announcement.totalRecipients = (announcement.totalRecipients || 0) + 1;
      updatedAnnouncements = true;
      created += 1;
    }

    if (created > 0) {
      this.saveNotifications(notifications);
    }
    if (updatedAnnouncements) {
      this.saveAnnouncements(announcements);
    }

    return { created };
  }

  static markNotificationRead(notificationId: string): void {
    const notifications = this.getNotifications();
    const index = notifications.findIndex(n => n.id === notificationId);
    if (index !== -1) {
      notifications[index].isRead = true;
      this.saveNotifications(notifications);
    }
  }

  // ==================== SETTINGS ====================
  static getSettings(): AdminSettings {
    const data = this.getCached<AdminSettings | null>(DB_KEYS.SETTINGS, null);
    if (!data) return defaultSettings;
    const merged = { ...defaultSettings, ...data };
    // Migrate: ensure directReferralDeadlineDays is 30 (was previously defaulted to 15)
    if (merged.directReferralDeadlineDays === 15) {
      merged.directReferralDeadlineDays = 30;
      this.saveSettings(merged);
    }
    if (!merged.lockedIncomeStrictFrom) {
      merged.lockedIncomeStrictFrom = new Date().toISOString();
      this.saveSettings(merged);
    }
    return merged;
  }

  static saveSettings(settings: AdminSettings): void {
    this.setCached(DB_KEYS.SETTINGS, settings);
  }

  // ==================== PAYMENT METHODS ====================
  static getPaymentMethods(): PaymentMethod[] {
    const data = this.getStorageItem(DB_KEYS.PAYMENT_METHODS);
    return data ? JSON.parse(data) : defaultPaymentMethods;
  }

  static savePaymentMethods(methods: PaymentMethod[]): void {
    this.setStorageItem(DB_KEYS.PAYMENT_METHODS, JSON.stringify(methods));
  }

  static async fetchPaymentMethodsFromBackend(): Promise<PaymentMethod[]> {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      return this.getPaymentMethods();
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), 45000);

    try {
      const response = await fetch(`${this.REMOTE_SYNC_BASE_URL}/api/payment-methods?t=${Date.now()}`, {
        method: 'GET',
        signal: controller?.signal
      });

      if (!response.ok) {
        throw new Error(`Payment methods request failed with HTTP ${response.status}`);
      }

      const payload = await response.json() as { methods?: unknown };
      const methods = Array.isArray(payload?.methods) ? payload.methods as PaymentMethod[] : [];
      this.savePaymentMethods(methods);
      this.hydratedRemoteKeys.add(DB_KEYS.PAYMENT_METHODS);
      return methods;
    } finally {
      clearTimeout(timeout);
    }
  }

  static async savePaymentMethodsToBackend(methods: PaymentMethod[]): Promise<boolean> {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      this.savePaymentMethods(methods);
      return false;
    }

    const normalized = Array.isArray(methods) ? methods : [];
    this.savePaymentMethods(normalized);

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), 30000);

    try {
      const response = await fetch(`${this.REMOTE_SYNC_BASE_URL}/api/payment-methods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ methods: normalized }),
        signal: controller?.signal
      });

      if (!response.ok) {
        throw new Error(`Payment methods save failed with HTTP ${response.status}`);
      }

      const payload = await response.json() as { updatedAt?: unknown };
      if (typeof payload?.updatedAt === 'string') {
        this.remoteStateUpdatedAt = payload.updatedAt;
      }
      try {
        const echoed = await this.fetchPaymentMethodsFromBackend();
        if (Array.isArray(normalized) && Array.isArray(echoed) && echoed.length !== normalized.length) {
          throw new Error(`Backend stored ${echoed.length} payment methods instead of ${normalized.length}`);
        }
      } catch (verificationError) {
        throw verificationError instanceof Error
          ? verificationError
          : new Error('Payment methods saved, but verification failed');
      }
      this.remoteSyncDirtyKeys.delete(DB_KEYS.PAYMENT_METHODS);
      this.hydratedRemoteKeys.add(DB_KEYS.PAYMENT_METHODS);
      return true;
    } finally {
      clearTimeout(timeout);
    }
  }

  static addPaymentMethod(method: PaymentMethod): void {
    const methods = this.getPaymentMethods();
    methods.push(method);
    this.savePaymentMethods(methods);
  }

  static getPaymentMethod(id: string): PaymentMethod | undefined {
    return this.getPaymentMethods().find(m => m.id === id);
  }

  static updatePaymentMethod(id: string, updates: Partial<PaymentMethod>): PaymentMethod | null {
    const methods = this.getPaymentMethods();
    const index = methods.findIndex(m => m.id === id);
    if (index === -1) return null;

    methods[index] = { ...methods[index], ...updates };
    this.savePaymentMethods(methods);
    return methods[index];
  }

  // ==================== PAYMENTS ====================
  static getPayments(): Payment[] {
    const data = this.getStorageItem(DB_KEYS.PAYMENTS);
    return data ? JSON.parse(data) : [];
  }

  static savePayments(payments: Payment[]): void {
    this.setStorageItem(DB_KEYS.PAYMENTS, JSON.stringify(payments));
  }

  static getUserPayments(userId: string): Payment[] {
    return this.getPayments()
      .filter(p => p.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  static getPendingPayments(): Payment[] {
    return this.getPayments()
      .filter(p => p.status === 'pending' || p.status === 'under_review')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  static getAllCompletedPayments(): Payment[] {
    return this.getPayments();
  }

  static createPayment(payment: Payment): Payment {
    const payments = this.getPayments();
    payments.push(payment);
    this.savePayments(payments);
    return payment;
  }

  static updatePayment(paymentId: string, updates: Partial<Payment>): Payment | null {
    const payments = this.getPayments();
    const index = payments.findIndex(p => p.id === paymentId);
    if (index === -1) return null;

    const previousStatus = payments[index].status;
    payments[index] = { ...payments[index], ...updates };
    this.savePayments(payments);

    if (updates.status === 'completed' && previousStatus !== 'completed' && payments[index].status === 'completed') {
      const wallet = this.getWallet(payments[index].userId);
      if (wallet) {
        this.updateWallet(payments[index].userId, {
          depositWallet: wallet.depositWallet + payments[index].amount
        });

        this.createTransaction({
          id: generateEventId('tx', 'deposit'),
          userId: payments[index].userId,
          type: 'deposit',
          amount: payments[index].amount,
          status: 'completed',
          description: `Deposit via ${payments[index].methodName}`,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        });
      }
    }

    return payments[index];
  }

  static reversePayment(paymentId: string, adminId: string, reason: string): Payment {
    const payments = this.getPayments();
    const index = payments.findIndex(p => p.id === paymentId);
    if (index === -1) {
      throw new Error('Payment not found');
    }
    const payment = payments[index];
    if (payment.status !== 'completed') {
      throw new Error('Only completed deposits can be reversed');
    }
    const wallet = this.getWallet(payment.userId);
    if (!wallet) {
      throw new Error('User wallet not found');
    }
    if (wallet.depositWallet < payment.amount) {
      throw new Error('Insufficient fund wallet balance to reverse this deposit');
    }

    const now = new Date().toISOString();
    const note = reason ? `Reversed: ${reason}` : 'Reversed by admin';

    this.updateWallet(payment.userId, {
      depositWallet: wallet.depositWallet - payment.amount
    });

    payments[index] = {
      ...payment,
      status: 'reversed' as PaymentStatus,
      adminNotes: note,
      verifiedAt: now,
      verifiedBy: adminId
    };
    this.savePayments(payments);

    this.createTransaction({
      id: generateEventId('tx', 'deposit_reversal'),
      userId: payment.userId,
      type: 'admin_debit',
      amount: -payment.amount,
      status: 'completed',
      description: `Deposit reversed by admin${reason ? `: ${reason}` : ''}`,
      createdAt: now,
      completedAt: now,
      adminReason: reason || undefined,
      processedByAdminUserId: adminId
    });

    return payments[index];
  }

  static approvePayment(paymentId: string, adminId: string): Payment | null {
    const payment = this.getPayments().find(p => p.id === paymentId);
    if (!payment || payment.status === 'completed' || payment.status === 'reversed') return null;

    const updatedPayment = this.updatePayment(paymentId, {
      status: 'completed',
      verifiedAt: new Date().toISOString(),
      verifiedBy: adminId
    });

    return updatedPayment;
  }

  static rejectPayment(paymentId: string, adminId: string, reason: string): Payment | null {
    const payment = this.getPayments().find(p => p.id === paymentId);
    if (!payment || payment.status === 'completed' || payment.status === 'reversed') return null;

    const updatedPayment = this.updatePayment(paymentId, {
      status: 'failed',
      adminNotes: reason,
      verifiedAt: new Date().toISOString(),
      verifiedBy: adminId
    });

    return updatedPayment;
  }

  // ==================== IMPERSONATION ====================
  static getImpersonationSessions(): ImpersonationSession[] {
    const data = this.getStorageItem(DB_KEYS.IMPERSONATION);
    return data ? JSON.parse(data) : [];
  }

  static saveImpersonationSessions(sessions: ImpersonationSession[]): void {
    this.setStorageItem(DB_KEYS.IMPERSONATION, JSON.stringify(sessions));
  }

  static getActiveImpersonation(adminId: string): ImpersonationSession | undefined {
    return this.getImpersonationSessions().find(
      s => s.adminId === adminId && s.isActive
    );
  }

  static startImpersonation(session: ImpersonationSession): ImpersonationSession {
    // End any existing session for this admin
    const sessions = this.getImpersonationSessions().map(s =>
      s.adminId === session.adminId ? { ...s, isActive: false } : s
    );
    sessions.push(session);
    this.saveImpersonationSessions(sessions);
    return session;
  }

  static endImpersonation(adminId: string): void {
    const sessions = this.getImpersonationSessions().map(s =>
      s.adminId === adminId ? { ...s, isActive: false } : s
    );
    this.saveImpersonationSessions(sessions);
  }

  // ==================== SESSION ====================
  static setCurrentUser(user: User | null): void {
    const tabSession = this.getSessionStorage();
    if (user) {
      const canonicalUser = this.getUserByUserId(user.userId) || this.getUserById(user.id) || user;
      const value = JSON.stringify(canonicalUser);
      if (tabSession) {
        tabSession.setItem(DB_KEYS.CURRENT_USER, value);
      } else {
        this.setStorageItem(DB_KEYS.CURRENT_USER, value);
      }
      // Remove legacy global user session so tabs stop overriding each other.
      // This is handled via standard removeStorageItem which clears both local and volatile.
      this.removeStorageItem(DB_KEYS.CURRENT_USER);
    } else {
      if (tabSession) {
        tabSession.removeItem(DB_KEYS.CURRENT_USER);
      }
      this.removeStorageItem(DB_KEYS.CURRENT_USER);
    }
  }

  static getCurrentUser(): User | null {
    const tabSession = this.getSessionStorage();
    const tabData = tabSession?.getItem(DB_KEYS.CURRENT_USER);
    if (tabData) {
      const parsed = JSON.parse(tabData) as User;
      const fresh = parsed?.userId ? this.getUserByUserId(parsed.userId) : undefined;
      if (fresh && fresh.id !== parsed.id) {
        this.setCurrentUser(fresh);
      }
      return fresh || (parsed?.id ? this.getUserById(parsed.id) : undefined) || parsed;
    }

    // Backward compatibility for legacy sessions / fallback storage.
    const legacyData = this.getStorageItem(DB_KEYS.CURRENT_USER);
    if (!legacyData) return null;
    const parsed = JSON.parse(legacyData) as User;
    const fresh = parsed?.userId ? this.getUserByUserId(parsed.userId) : undefined;
    if (fresh && fresh.id !== parsed.id) {
      this.setCurrentUser(fresh);
    }
    return fresh || (parsed?.id ? this.getUserById(parsed.id) : undefined) || parsed;
  }

  // ==================== STATS ====================
  static getTotalDeposits(): number {
    return this.getPayments()
      .filter((p) => p.status === 'completed')
      .reduce((sum, p) => sum + p.amount, 0);
  }

  static getTotalWithdrawals(): number {
    return this.getTransactions()
      .filter((tx) => tx.type === 'withdrawal' && tx.status === 'completed')
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  }

  static getTotalLockedIncome(): number {
    return this.getWallets()
      .reduce((sum, w) => sum + (w.lockedIncomeWallet || 0), 0);
  }

  static getRequiredDirectsForLevel(level: number): number {
    return helpDistributionTable
      .filter((l) => l.level <= level)
      .reduce((sum, l) => sum + (l.directRequired || 0), 0);
  }

  static getStats() {
    const users = this.getUsers();
    const wallets = this.getWallets();
    const pool = this.getSafetyPool();
    const transactions = this.getTransactions();
    const pins = this.getPins();

    const activeUsers = users.filter(u => u.isActive).length;
    const totalHelpDistributed = transactions
      .filter(t => t.type === 'receive_help' && t.status === 'completed')
      .reduce((sum, t) => sum + t.amount, 0);
    const totalDeposits = this.getTotalDeposits();
    const totalWithdrawals = this.getTotalWithdrawals();
    const totalLockedIncome = wallets.reduce((sum, wallet) => sum + (wallet.lockedIncomeWallet || 0), 0);
    const totalIncomeWalletBalance = wallets.reduce((sum, wallet) => sum + (wallet.incomeWallet || 0), 0);
    const totalFundWalletBalance = wallets.reduce((sum, wallet) => sum + (wallet.depositWallet || 0), 0);

    // Count all PIN inventory in system (including admin-owned PINs).
    const totalPinsInSystem = pins.length;
    const totalPinAmountInSystem = pins.reduce((sum, pin) => sum + (Number(pin.amount) || 0), 0);

    // Bulk IDs created without PIN should still contribute virtual PIN sale count/amount.
    const bulkNoPinActivationTransactions = transactions.filter((tx) =>
      tx.type === 'activation'
      && tx.status === 'completed'
      && tx.description === 'Account activation by admin without PIN'
      && tx.amount > 0
    );
    const bulkNoPinCount = bulkNoPinActivationTransactions.length;
    const bulkNoPinAmount = bulkNoPinActivationTransactions.reduce((sum, tx) => sum + tx.amount, 0);

    const totalPinsSold = totalPinsInSystem + bulkNoPinCount;
    const totalPinSoldAmount = totalPinAmountInSystem + bulkNoPinAmount;

    // Balance Amount Remaining = Safety Pool + Pin Sold + Deposits - Withdrawals - Income Wallet - Locked Income
    const balanceAmountRemaining =
      pool.totalAmount
      + totalPinSoldAmount
      + totalDeposits
      - totalWithdrawals
      - totalIncomeWalletBalance
      - totalLockedIncome;

    const averageEarnings = wallets.length > 0
      ? wallets.reduce((sum, w) => sum + w.totalReceived, 0) / wallets.length
      : 0;

    const topEarners = users
      .map(u => ({
        userId: u.userId,
        username: u.fullName,
        fullName: u.fullName,
        totalEarnings: wallets.find(w => w.userId === u.id)?.totalReceived || 0
      }))
      .sort((a, b) => b.totalEarnings - a.totalEarnings)
      .slice(0, 10);

    return {
      totalUsers: users.length,
      activeUsers,
      totalHelpDistributed,
      totalInSafetyPool: pool.totalAmount,
      totalPinsSold,
      totalPinSoldAmount,
      totalIncomeWalletBalance,
      totalFundWalletBalance,
      totalLockedIncome,
      totalDeposits,
      totalWithdrawals,
      balanceAmountRemaining,
      averageEarnings,
      topEarners
    };
  }

  // Get level-wise report
  static getLevelWiseReport(level?: number, _startDate?: string, _endDate?: string): LevelWiseReport[] {
    const users = this.getUsers();
    const matrix = this.getMatrix();
    const transactions = this.getTransactions();

    const reports: LevelWiseReport[] = [];

    for (const user of users.filter(u => u.isActive)) {
      const matrixNode = matrix.find(m => m.userId === user.userId);
      if (!matrixNode) continue;

      const userLevel = this.getCurrentMatrixLevel(user.id);
      if (level !== undefined && userLevel !== level) continue;

      const userTransactions = transactions.filter(t => t.userId === user.id);
      const receiveHelpAmount = userTransactions
        .filter(t => t.type === 'receive_help' && t.status === 'completed')
        .reduce((sum, t) => sum + t.amount, 0);
      const giveHelpAmount = userTransactions
        .filter(t => t.type === 'give_help' && t.status === 'completed')
        .reduce((sum, t) => sum + t.amount, 0);
      const directReferralIncome = userTransactions
        .filter(t => t.type === 'direct_income' && t.status === 'completed')
        .reduce((sum, t) => sum + t.amount, 0);

      // Qualification uses cumulative direct requirement: 0, 2, 5, 9, 14...
      const isQualified = userLevel <= 0 ? true : this.isQualifiedForLevel(user, userLevel);
      const qualifiedLevel = this.getQualifiedLevel(user.id);
      const wallet = this.getWallet(user.id);
      const lockedHelp = (wallet?.lockedIncomeWallet || 0) + (wallet?.giveHelpLocked || 0);
      const levelProgress = this.getLevelFillProgress(user.id);
      const levelFilledText = `Level ${levelProgress.level} (${levelProgress.filled}/${levelProgress.required} filled)`;

      reports.push({
        level: userLevel,
        userId: user.userId,
        fullName: user.fullName,
        receiveHelpAmount,
        giveHelpAmount,
        netAmount: receiveHelpAmount - giveHelpAmount,
        directReferralIncome,
        incomeWallet: wallet?.incomeWallet || 0,
        totalEarning: user.totalEarnings || 0,
        lockedHelp,
        qualifiedLevel,
        isQualified,
        directCount: user.directCount || 0,
        date: user.activatedAt || user.createdAt,
        levelFilledText
      } as any);
    }

    return reports.sort((a, b) => a.level - b.level || a.userId.localeCompare(b.userId));
  }

  private static repairDuplicateUserIds(): void {
    const users = this.getUsers();
    if (users.length <= 1) return;

    const groupedByUserId = new Map<string, User[]>();
    for (const user of users) {
      const key = (user.userId || '').trim();
      if (!key) continue;
      const existing = groupedByUserId.get(key) || [];
      existing.push(user);
      groupedByUserId.set(key, existing);
    }

    const duplicateGroups = Array.from(groupedByUserId.values()).filter((group) => group.length > 1);
    if (duplicateGroups.length === 0) return;

    const transactions = this.getTransactions();
    const wallets = this.getWallets();
    const matrix = this.getMatrix();

    const txCountByUserId = new Map<string, number>();
    for (const tx of transactions) {
      txCountByUserId.set(tx.userId, (txCountByUserId.get(tx.userId) || 0) + 1);
    }
    const walletByUserId = new Map(wallets.map((wallet) => [wallet.userId, wallet]));
    const matrixUserIds = new Set(matrix.map((node) => node.userId));

    const idRemap = new Map<string, string>();
    const mergedCanonicalByUserId = new Map<string, User>();

    const getTime = (value?: string | null): number => {
      if (!value) return Number.POSITIVE_INFINITY;
      const time = new Date(value).getTime();
      return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
    };

    for (const group of duplicateGroups) {
      const sorted = [...group].sort((a, b) => {
        const scoreDiff = this.getDuplicateResolutionScore(b, txCountByUserId, walletByUserId, matrixUserIds)
          - this.getDuplicateResolutionScore(a, txCountByUserId, walletByUserId, matrixUserIds);
        if (scoreDiff !== 0) return scoreDiff;
        return getTime(a.createdAt) - getTime(b.createdAt);
      });

      const canonical = sorted[0];
      const rest = sorted.slice(1);
      for (const duplicate of rest) {
        idRemap.set(duplicate.id, canonical.id);
      }

      const mergedDirectCount = Math.max(...group.map((u) => Number(u.directCount) || 0));
      const mergedTotalEarnings = Math.max(...group.map((u) => Number(u.totalEarnings) || 0));
      const earliestCreatedAt = [...group]
        .map((u) => u.createdAt)
        .filter(Boolean)
        .sort((a, b) => getTime(a) - getTime(b))[0] || canonical.createdAt;
      const earliestActivatedAt = [...group]
        .map((u) => u.activatedAt)
        .filter((value): value is string => !!value)
        .sort((a, b) => getTime(a) - getTime(b))[0] || canonical.activatedAt;
      const anyActive = group.some((u) => u.isActive && (u.accountStatus || 'active') === 'active');
      const mergedIsAdmin = group.some((u) => u.isAdmin);

      mergedCanonicalByUserId.set(canonical.userId, {
        ...canonical,
        isAdmin: mergedIsAdmin,
        isActive: anyActive || canonical.isActive,
        accountStatus: anyActive ? 'active' : (canonical.accountStatus || 'active'),
        blockedAt: anyActive ? null : (canonical.blockedAt ?? null),
        blockedUntil: anyActive ? null : (canonical.blockedUntil ?? null),
        blockedReason: anyActive ? null : (canonical.blockedReason ?? null),
        directCount: mergedDirectCount,
        totalEarnings: mergedTotalEarnings,
        createdAt: earliestCreatedAt,
        activatedAt: earliestActivatedAt
      });
    }

    if (idRemap.size === 0) return;

    const dedupedUsers: User[] = [];
    for (const user of users) {
      if (idRemap.has(user.id)) continue;
      const merged = mergedCanonicalByUserId.get(user.userId);
      if (merged && merged.id === user.id) {
        dedupedUsers.push(merged);
      } else {
        dedupedUsers.push(user);
      }
    }
    this.saveUsers(dedupedUsers);

    const remapId = (value?: string): string | undefined => {
      if (!value) return value;
      return idRemap.get(value) || value;
    };

    const mergedWalletByUser = new Map<string, Wallet>();
    for (const wallet of wallets) {
      const mappedUserId = remapId(wallet.userId) || wallet.userId;
      const existing = mergedWalletByUser.get(mappedUserId);
      if (!existing) {
        mergedWalletByUser.set(mappedUserId, { ...wallet, userId: mappedUserId });
        continue;
      }
      mergedWalletByUser.set(mappedUserId, {
        ...existing,
        userId: mappedUserId,
        depositWallet: (existing.depositWallet || 0) + (wallet.depositWallet || 0),
        fundRecoveryDue: (existing.fundRecoveryDue || 0) + (wallet.fundRecoveryDue || 0),
        fundRecoveryRecoveredTotal: (existing.fundRecoveryRecoveredTotal || 0) + (wallet.fundRecoveryRecoveredTotal || 0),
        fundRecoveryReason: existing.fundRecoveryReason || wallet.fundRecoveryReason || null,
        pinWallet: (existing.pinWallet || 0) + (wallet.pinWallet || 0),
        incomeWallet: (existing.incomeWallet || 0) + (wallet.incomeWallet || 0),
        royaltyWallet: (existing.royaltyWallet || 0) + (wallet.royaltyWallet || 0),
        matrixWallet: (existing.matrixWallet || 0) + (wallet.matrixWallet || 0),
        lockedIncomeWallet: (existing.lockedIncomeWallet || 0) + (wallet.lockedIncomeWallet || 0),
        giveHelpLocked: (existing.giveHelpLocked || 0) + (wallet.giveHelpLocked || 0),
        totalReceived: (existing.totalReceived || 0) + (wallet.totalReceived || 0),
        totalGiven: (existing.totalGiven || 0) + (wallet.totalGiven || 0)
      });
    }
    for (const user of dedupedUsers) {
      if (mergedWalletByUser.has(user.id)) continue;
      mergedWalletByUser.set(user.id, {
        userId: user.id,
        depositWallet: 0,
        fundRecoveryDue: 0,
        fundRecoveryRecoveredTotal: 0,
        fundRecoveryReason: null,
        pinWallet: 0,
        incomeWallet: 0,
        royaltyWallet: 0,
        matrixWallet: 0,
        lockedIncomeWallet: 0,
        giveHelpLocked: 0,
        totalReceived: 0,
        totalGiven: 0,
        pendingSystemFee: 0,
        lastSystemFeeDate: null,
        rewardPoints: 0,
        totalRewardPointsEarned: 0,
        totalRewardPointsRedeemed: 0,
      });
    }
    this.saveWallets(Array.from(mergedWalletByUser.values()));

    let txChanged = false;
    const remappedTransactions = transactions.map((tx) => {
      const userId = remapId(tx.userId) || tx.userId;
      const fromUserId = remapId(tx.fromUserId);
      const toUserId = remapId(tx.toUserId);
      if (userId === tx.userId && fromUserId === tx.fromUserId && toUserId === tx.toUserId) return tx;
      txChanged = true;
      return { ...tx, userId, fromUserId, toUserId };
    });
    if (txChanged) {
      this.saveTransactions(remappedTransactions);
    }

    const mergeLevelState = (
      base: LevelHelpTrackerState | undefined,
      incoming: LevelHelpTrackerState
    ): LevelHelpTrackerState => {
      if (!base) return { ...incoming };
      return {
        ...base,
        leftEvents: Math.max(base.leftEvents || 0, incoming.leftEvents || 0),
        rightEvents: Math.max(base.rightEvents || 0, incoming.rightEvents || 0),
        matchedEvents: Math.max(base.matchedEvents || 0, incoming.matchedEvents || 0),
        receiveEvents: Math.max(base.receiveEvents || 0, incoming.receiveEvents || 0),
        receivedAmount: Math.max(base.receivedAmount || 0, incoming.receivedAmount || 0),
        giveEvents: Math.max(base.giveEvents || 0, incoming.giveEvents || 0),
        givenAmount: Math.max(base.givenAmount || 0, incoming.givenAmount || 0),
        lockedAmount: Math.max(base.lockedAmount || 0, incoming.lockedAmount || 0),
        lockedReceiveAmount: Math.max(base.lockedReceiveAmount || 0, incoming.lockedReceiveAmount || 0),
        safetyDeducted: Math.max(base.safetyDeducted || 0, incoming.safetyDeducted || 0)
      };
    };

    const trackers = this.getHelpTrackers();
    const mergedTrackers = new Map<string, UserHelpTracker>();
    for (const tracker of trackers) {
      const mappedUserId = remapId(tracker.userId) || tracker.userId;
      const existing = mergedTrackers.get(mappedUserId);
      if (!existing) {
        mergedTrackers.set(mappedUserId, {
          userId: mappedUserId,
          levels: Object.fromEntries(
            Object.entries(tracker.levels || {}).map(([level, state]) => [level, { ...state }])
          ),
          lockedQueue: [...(tracker.lockedQueue || [])],
          processedContributionKeys: { ...(tracker.processedContributionKeys || {}) }
        });
        continue;
      }

      const nextLevels: Record<string, LevelHelpTrackerState> = { ...existing.levels };
      for (const [level, state] of Object.entries(tracker.levels || {})) {
        nextLevels[level] = mergeLevelState(nextLevels[level], state as LevelHelpTrackerState);
      }

      const queueById = new Map<string, LockedGiveHelpItem>();
      for (const item of [...(existing.lockedQueue || []), ...(tracker.lockedQueue || [])]) {
        queueById.set(item.id, { ...item });
      }

      mergedTrackers.set(mappedUserId, {
        userId: mappedUserId,
        levels: nextLevels,
        lockedQueue: Array.from(queueById.values()),
        processedContributionKeys: {
          ...(existing.processedContributionKeys || {}),
          ...(tracker.processedContributionKeys || {})
        }
      });
    }
    this.saveHelpTrackers(Array.from(mergedTrackers.values()));

    const pending = this.getPendingMatrixContributions();
    let pendingChanged = false;
    const remappedPending = pending.map((item) => {
      const fromUserId = remapId(item.fromUserId) || item.fromUserId;
      const toUserId = remapId(item.toUserId) || item.toUserId;
      if (fromUserId === item.fromUserId && toUserId === item.toUserId) return item;
      pendingChanged = true;
      return { ...item, fromUserId, toUserId };
    });
    if (pendingChanged) {
      this.savePendingMatrixContributions(remappedPending);
    }

    const pins = this.getPins();
    let pinsChanged = false;
    const remappedPins = pins.map((pin) => {
      const ownerId = remapId(pin.ownerId) || pin.ownerId;
      const createdBy = remapId(pin.createdBy) || pin.createdBy;
      const usedById = remapId(pin.usedById);
      const transferredFrom = remapId(pin.transferredFrom);
      if (
        ownerId === pin.ownerId
        && createdBy === pin.createdBy
        && usedById === pin.usedById
        && transferredFrom === pin.transferredFrom
      ) {
        return pin;
      }
      pinsChanged = true;
      return { ...pin, ownerId, createdBy, usedById, transferredFrom };
    });
    if (pinsChanged) {
      this.savePins(remappedPins);
    }

    const transfers = this.getPinTransfers();
    let transfersChanged = false;
    const remappedTransfers = transfers.map((transfer) => {
      const fromUserId = remapId(transfer.fromUserId) || transfer.fromUserId;
      const toUserId = remapId(transfer.toUserId) || transfer.toUserId;
      if (fromUserId === transfer.fromUserId && toUserId === transfer.toUserId) return transfer;
      transfersChanged = true;
      return { ...transfer, fromUserId, toUserId };
    });
    if (transfersChanged) {
      this.savePinTransfers(remappedTransfers);
    }

    const requests = this.getPinPurchaseRequests();
    let requestsChanged = false;
    const remappedRequests = requests.map((request) => {
      const userId = remapId(request.userId) || request.userId;
      const processedBy = remapId(request.processedBy);
      if (userId === request.userId && processedBy === request.processedBy) return request;
      requestsChanged = true;
      return { ...request, userId, processedBy };
    });
    if (requestsChanged) {
      this.savePinPurchaseRequests(remappedRequests);
    }

    const payments = this.getPayments();
    let paymentsChanged = false;
    const remappedPayments = payments.map((payment) => {
      const userId = remapId(payment.userId) || payment.userId;
      const verifiedBy = remapId(payment.verifiedBy);
      if (userId === payment.userId && verifiedBy === payment.verifiedBy) return payment;
      paymentsChanged = true;
      return { ...payment, userId, verifiedBy };
    });
    if (paymentsChanged) {
      this.savePayments(remappedPayments);
    }

    const notifications = this.getNotifications();
    let notificationsChanged = false;
    const remappedNotifications = notifications.map((notification) => {
      const userId = remapId(notification.userId) || notification.userId;
      if (userId === notification.userId) return notification;
      notificationsChanged = true;
      return { ...notification, userId };
    });
    if (notificationsChanged) {
      this.saveNotifications(remappedNotifications);
    }

    const announcements = this.getAnnouncements();
    let announcementsChanged = false;
    const remappedAnnouncements = announcements.map((announcement) => {
      const createdById = remapId(announcement.createdById) || announcement.createdById;
      if (createdById === announcement.createdById) return announcement;
      announcementsChanged = true;
      return { ...announcement, createdById };
    });
    if (announcementsChanged) {
      this.saveAnnouncements(remappedAnnouncements);
    }

    const periods = this.getGracePeriods();
    let periodsChanged = false;
    const remappedPeriods = periods.map((period) => {
      const userId = remapId(period.userId) || period.userId;
      if (userId === period.userId) return period;
      periodsChanged = true;
      return { ...period, userId };
    });
    if (periodsChanged) {
      this.saveGracePeriods(remappedPeriods);
    }

    const otpRecords = this.getOtpRecords();
    let otpChanged = false;
    const remappedOtpRecords = otpRecords.map((record) => {
      const userId = remapId(record.userId) || record.userId;
      if (userId === record.userId) return record;
      otpChanged = true;
      return { ...record, userId };
    });
    if (otpChanged) {
      this.saveOtpRecords(remappedOtpRecords);
    }

    const impersonationSessions = this.getImpersonationSessions();
    let impersonationChanged = false;
    const remappedSessions = impersonationSessions.map((session) => {
      const adminId = remapId(session.adminId) || session.adminId;
      const targetUserId = remapId(session.targetUserId) || session.targetUserId;
      if (adminId === session.adminId && targetUserId === session.targetUserId) return session;
      impersonationChanged = true;
      return { ...session, adminId, targetUserId };
    });
    if (impersonationChanged) {
      this.saveImpersonationSessions(remappedSessions);
    }

    const matrixByUserId = new Map<string, MatrixNode>();
    const matrixScore = (node: MatrixNode): number => {
      let score = 0;
      if (node.leftChild) score += 5;
      if (node.rightChild) score += 5;
      if (!node.parentId) score += 3;
      if (node.isActive) score += 2;
      return score;
    };
    for (const node of matrix) {
      const existing = matrixByUserId.get(node.userId);
      if (!existing || matrixScore(node) > matrixScore(existing)) {
        matrixByUserId.set(node.userId, { ...node });
      }
    }
    const dedupedMatrix = Array.from(matrixByUserId.values()).map((node) => ({ ...node }));
    for (const node of dedupedMatrix) {
      delete node.leftChild;
      delete node.rightChild;
    }
    const matrixNodeByUserId = new Map(dedupedMatrix.map((node) => [node.userId, node]));
    for (const node of dedupedMatrix) {
      if (!node.parentId) continue;
      const parent = matrixNodeByUserId.get(node.parentId);
      if (!parent) {
        delete node.parentId;
        continue;
      }
      if (node.position === 0) parent.leftChild = node.userId;
      if (node.position === 1) parent.rightChild = node.userId;
    }
    this.saveMatrix(dedupedMatrix);

    const currentUser = this.getCurrentUser();
    if (currentUser) {
      const mappedCurrentUserId = remapId(currentUser.id) || currentUser.id;
      const freshCurrentUser = dedupedUsers.find((user) => user.id === mappedCurrentUserId)
        || this.getUserByUserId(currentUser.userId);
      if (freshCurrentUser) {
        this.setCurrentUser(freshCurrentUser);
      }
    }

    this.repairIncomeWalletConsistency();
    this.syncLockedIncomeWallet();
  }

  // ==================== INITIALIZATION ====================
  static initializeDemoData(): void {
    this.repairDuplicateUserIds();

    const adminUserId = '1000001';
    const users = this.getUsers();
    let adminUser = users.find((u) => u.userId === adminUserId);

    if (!adminUser) {
      // Create admin user with 7-digit ID
      const seedAdminUser: User = {
        id: `user_${Date.now()}`,
        userId: adminUserId,
        email: 'vikasjain246@gmail.com',
        password: 'Vika@#$2112116',
        fullName: 'Vikas Jain',
        phone: '+1234567890',
        country: 'USA',
        isActive: true,
        isAdmin: true,
        accountStatus: 'active',
        blockedAt: null,
        blockedUntil: null,
        blockedReason: null,
        createdAt: new Date().toISOString(),
        activatedAt: new Date().toISOString(),
        gracePeriodEnd: null,
        sponsorId: null,
        parentId: null,
        position: null,
        level: 0,
        directCount: 0,
        totalEarnings: 0,
        isCapped: false,
        capLevel: 0,
        reEntryCount: 0,
        cycleCount: 0,
        requiredDirectForNextLevel: 0,
        completedDirectForCurrentLevel: 0,
        transactionPassword: 'trans123',
        emailVerified: true,
        achievements: {
          nationalTour: false,
          internationalTour: false,
          familyTour: false
        }
      };
      adminUser = this.createUser(seedAdminUser);
    } else {
      // Self-heal reserved admin account if it exists but lost admin privileges.
      const updatedAdmin = this.updateUser(adminUser.id, {
        isAdmin: true,
        isActive: true,
        accountStatus: 'active',
        blockedAt: null,
        blockedUntil: null,
        blockedReason: null,
        email: 'vikasjain246@gmail.com',
        password: 'Vika@#$2112116',
        fullName: 'Vikas Jain'
      });
      adminUser = updatedAdmin || adminUser;
    }

    if (!this.getWallet(adminUser.id)) {
      this.createWallet(adminUser.id);
    }

    const adminMatrixNode = this.getMatrix().find((node) => node.userId === adminUserId);
    if (!adminMatrixNode) {
      this.addMatrixNode({
        userId: adminUserId,
        username: adminUser.fullName,
        level: 0,
        position: 0,
        isActive: true
      });
    }

    const settingsData = this.getStorageItem(DB_KEYS.SETTINGS);
    if (!settingsData) {
      this.saveSettings(defaultSettings);
    }

    const paymentMethodData = this.getStorageItem(DB_KEYS.PAYMENT_METHODS);
    if (!paymentMethodData || this.getPaymentMethods().length === 0) {
      this.savePaymentMethods(defaultPaymentMethods);
    }

    if (this.getUserPins(adminUser.id).length === 0) {
      this.generatePins(10, adminUser.id, adminUser.id);
    }

    console.log('Demo data initialized');
  }

  static deleteAllNonAdminIds(): {
    deletedUsers: number;
    deletedTransactions: number;
    deletedPins: number;
    deletedMatrixNodes: number;
  } {
    const currentUser = this.getCurrentUser();
    const users = this.getUsers();
    const adminUsers = users.filter((u) => u.isAdmin || u.userId === '1000001');

    if (adminUsers.length === 0) {
      this.clearAll();
      this.initializeDemoData();
      return {
        deletedUsers: users.length,
        deletedTransactions: 0,
        deletedPins: 0,
        deletedMatrixNodes: 0
      };
    }

    // Deduplicate admins by userId to prevent multiple cloned reserved admins
    // (e.g. repeated 1000001 records from earlier sync conflicts).
    const dedupedAdminMap = new Map<string, User>();
    const adminUsersSorted = [...adminUsers].sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      return bTime - aTime;
    });
    for (const admin of adminUsersSorted) {
      const key = (admin.userId || '').trim() || admin.id;
      if (!dedupedAdminMap.has(key)) {
        dedupedAdminMap.set(key, admin);
      }
    }
    const dedupedAdmins = Array.from(dedupedAdminMap.values());

    const normalizedAdmins = dedupedAdmins.map((u) => ({
      ...u,
      isAdmin: true,
      isActive: true,
      accountStatus: 'active' as const,
      blockedAt: null,
      blockedUntil: null,
      blockedReason: null,
      sponsorId: null,
      parentId: null,
      position: null,
      level: 0,
      directCount: 0,
      totalEarnings: 0,
      isCapped: false,
      capLevel: 0,
      reEntryCount: 0,
      cycleCount: 0,
      requiredDirectForNextLevel: 0,
      completedDirectForCurrentLevel: 0
    }));
    const primaryAdmin = normalizedAdmins.find((u) => u.userId === '1000001') || normalizedAdmins[0];
    const adminIdSet = new Set(normalizedAdmins.map((u) => u.id));

    const deletedUsers = Math.max(0, users.length - normalizedAdmins.length);
    const deletedTransactions = this.getTransactions().length;
    const deletedPins = this.getPins().length;
    const deletedMatrixNodes = this.getMatrix().length;

    this.saveUsers(normalizedAdmins);
    this.saveWallets(
      normalizedAdmins.map((admin) => ({
        userId: admin.id,
        depositWallet: 0,
        fundRecoveryDue: 0,
        fundRecoveryRecoveredTotal: 0,
        fundRecoveryReason: null,
        pinWallet: 0,
        incomeWallet: 0,
        royaltyWallet: 0,
        matrixWallet: 0,
        lockedIncomeWallet: 0,
        giveHelpLocked: 0,
        totalReceived: 0,
        totalGiven: 0,
        pendingSystemFee: 0,
        lastSystemFeeDate: null,
        rewardPoints: 0,
        totalRewardPointsEarned: 0,
        totalRewardPointsRedeemed: 0,
      }))
    );
    this.saveMatrix([
      {
        userId: primaryAdmin.userId,
        username: primaryAdmin.fullName,
        level: 0,
        position: 0,
        isActive: true
      }
    ]);

    this.saveTransactions([]);
    this.saveSafetyPool({ totalAmount: 0, transactions: [] });
    this.saveGracePeriods([]);
    this.setStorageItem(DB_KEYS.RE_ENTRIES, JSON.stringify([]));
    this.saveNotifications([]);
    this.saveAnnouncements([]);
    this.savePayments([]);
    this.savePins([]);
    this.savePinTransfers([]);
    this.savePinPurchaseRequests([]);
    this.saveSupportTickets([]);
    this.saveOtpRecords([]);
    this.saveEmailLogs([]);
    this.saveImpersonationSessions([]);
    this.saveHelpTrackers([]);
    this.savePendingMatrixContributions([]);

    const adminForSession =
      (currentUser && adminIdSet.has(currentUser.id) && normalizedAdmins.find((u) => u.id === currentUser.id))
      || primaryAdmin;
    this.setCurrentUser(adminForSession);

    if (this.getUserPins(primaryAdmin.id).length === 0) {
      this.generatePins(10, primaryAdmin.id, primaryAdmin.id);
    }

    return {
      deletedUsers,
      deletedTransactions,
      deletedPins,
      deletedMatrixNodes
    };
  }

  // ==================== MARKETPLACE: CATEGORIES ====================

  static readonly DEFAULT_MARKETPLACE_CATEGORIES: Omit<MarketplaceCategory, 'id'>[] = [
    { name: 'Fashion', slug: 'fashion', icon: 'Handbag', sortOrder: 1, isActive: true },
    { name: 'Beauty & Skin Care', slug: 'beauty-skin-care', icon: 'SoapDispenserDroplet', sortOrder: 2, isActive: true },
    { name: 'Jewellery', slug: 'jewellery', icon: 'Gem', sortOrder: 3, isActive: true },
    { name: 'Kidswear', slug: 'kidswear', icon: 'Baby', sortOrder: 4, isActive: true },
    { name: 'Toys & Gifts', slug: 'toys-gifts', icon: 'Gift', sortOrder: 5, isActive: true },
    { name: 'Perfume', slug: 'perfume', icon: 'SprayCan', sortOrder: 6, isActive: true },
    { name: 'Female Only', slug: 'female-only', icon: 'Venus', sortOrder: 7, isActive: true },
    { name: 'Men Only', slug: 'men-only', icon: 'Mars', sortOrder: 8, isActive: true },
    { name: 'Astrology', slug: 'astrology', icon: 'WandSparkles', sortOrder: 9, isActive: true },
    { name: 'Home & Kitchen', slug: 'home-kitchen', icon: 'CookingPot', sortOrder: 10, isActive: true },
    { name: 'Health Care & Medicine', slug: 'health-care-medicine', icon: 'Pill', sortOrder: 11, isActive: true },
    { name: 'Finance', slug: 'finance', icon: 'BadgeCent', sortOrder: 12, isActive: true },
    { name: 'Gadgets & Accessories', slug: 'gadgets-accessories', icon: 'Smartphone', sortOrder: 13, isActive: true },
    { name: 'Tour & Travel Booking', slug: 'tour-travel-booking', icon: 'Plane', sortOrder: 14, isActive: true },
    { name: 'Car & Bike', slug: 'car-bike', icon: 'Car', sortOrder: 15, isActive: true },
    { name: 'Education', slug: 'education', icon: 'GraduationCap', sortOrder: 16, isActive: true },
  ];

  private static normalizeMarketplaceLinks(): {
    categories: MarketplaceCategory[];
    retailers: MarketplaceRetailer[];
  } {
    const defaultSlugSet = new Set(this.DEFAULT_MARKETPLACE_CATEGORIES.map((category) => normalizeMarketplaceSlug(category.slug)));
    const rawCategories = this.getCached<MarketplaceCategory[]>(DB_KEYS.MARKETPLACE_CATEGORIES, []);
    const rawRetailers = this.getCached<MarketplaceRetailer[]>(DB_KEYS.MARKETPLACE_RETAILERS, []);

    let categoriesChanged = false;
    let retailersChanged = false;

    const sourceCategories = rawCategories.length > 0
      ? rawCategories
      : this.DEFAULT_MARKETPLACE_CATEGORIES.map((category) => ({
          ...category,
          id: getMarketplaceCategoryId(category.slug),
        }));

    if (rawCategories.length === 0) {
      categoriesChanged = true;
    }

    const legacyCategoryIdMap = new Map<string, string>();
    const categoriesBySlug = new Map<string, MarketplaceCategory>();
    const normalizedCategories: MarketplaceCategory[] = [];

    for (const category of sourceCategories) {
      const normalizedSlug = normalizeMarketplaceSlug(category.slug || category.name);
      const normalizedId = defaultSlugSet.has(normalizedSlug)
        ? getMarketplaceCategoryId(normalizedSlug)
        : category.id;
      const normalizedCategory: MarketplaceCategory = {
        ...category,
        slug: normalizedSlug,
        id: normalizedId,
        icon: getMarketplaceCategoryIcon(category.name, normalizedSlug, category.icon || 'ShoppingBag'),
      };

      if (
        normalizedCategory.slug !== category.slug
        || normalizedCategory.id !== category.id
        || normalizedCategory.icon !== category.icon
      ) {
        categoriesChanged = true;
      }

      legacyCategoryIdMap.set(category.id, normalizedId);

      const existingCategory = categoriesBySlug.get(normalizedSlug);
      if (!existingCategory) {
        categoriesBySlug.set(normalizedSlug, normalizedCategory);
        normalizedCategories.push(normalizedCategory);
        continue;
      }

      if (existingCategory.id !== normalizedId) {
        legacyCategoryIdMap.set(existingCategory.id, normalizedId);
      }
      categoriesChanged = true;
    }

    const categoryIdSet = new Set(normalizedCategories.map((category) => category.id));
    const normalizedRetailers = rawRetailers.map((retailer) => {
      let nextCategoryId = retailer.categoryId;

      if (legacyCategoryIdMap.has(nextCategoryId)) {
        nextCategoryId = legacyCategoryIdMap.get(nextCategoryId) || nextCategoryId;
      } else if (!categoryIdSet.has(nextCategoryId)) {
        const matchedCategory = normalizedCategories.find((category) =>
          nextCategoryId === category.slug ||
          nextCategoryId === category.name ||
          nextCategoryId.endsWith(`_${category.slug}`)
        );
        if (matchedCategory) {
          nextCategoryId = matchedCategory.id;
        }
      }

      if (nextCategoryId !== retailer.categoryId) {
        retailersChanged = true;
        return { ...retailer, categoryId: nextCategoryId };
      }

      return retailer;
    });

    if (categoriesChanged) {
      this.setCached(DB_KEYS.MARKETPLACE_CATEGORIES, normalizedCategories);
    }
    if (retailersChanged) {
      this.setCached(DB_KEYS.MARKETPLACE_RETAILERS, normalizedRetailers);
    }

    return {
      categories: normalizedCategories,
      retailers: normalizedRetailers,
    };
  }

  static getMarketplaceCategories(): MarketplaceCategory[] {
    return this.normalizeMarketplaceLinks().categories;
  }

  static saveMarketplaceCategories(cats: MarketplaceCategory[]): void {
    this.setCached(DB_KEYS.MARKETPLACE_CATEGORIES, cats);
  }

  static updateMarketplaceCategory(id: string, updates: Partial<MarketplaceCategory>): MarketplaceCategory | null {
    const cats = this.getMarketplaceCategories();
    const idx = cats.findIndex(c => c.id === id);
    if (idx === -1) return null;
    cats[idx] = { ...cats[idx], ...updates };
    this.saveMarketplaceCategories(cats);
    return cats[idx];
  }

  static createMarketplaceCategory(cat: Omit<MarketplaceCategory, 'id'>): MarketplaceCategory {
    const cats = this.getMarketplaceCategories();
    const normalizedSlug = normalizeMarketplaceSlug(cat.slug || cat.name);
    const newCat: MarketplaceCategory = {
      ...cat,
      slug: normalizedSlug,
      id: getMarketplaceCategoryId(normalizedSlug),
    };
    cats.push(newCat);
    this.saveMarketplaceCategories(cats);
    return newCat;
  }

  static deleteMarketplaceCategory(id: string): boolean {
    const cats = this.getMarketplaceCategories();
    const filtered = cats.filter(c => c.id !== id);
    if (filtered.length === cats.length) return false;
    this.saveMarketplaceCategories(filtered);
    return true;
  }

  // ==================== MARKETPLACE: RETAILERS ====================

  static getMarketplaceRetailers(): MarketplaceRetailer[] {
    return this.normalizeMarketplaceLinks().retailers;
  }

  static saveMarketplaceRetailers(retailers: MarketplaceRetailer[]): void {
    this.setCached(DB_KEYS.MARKETPLACE_RETAILERS, retailers);
  }

  static createMarketplaceRetailer(retailer: Omit<MarketplaceRetailer, 'id'>): MarketplaceRetailer {
    const retailers = this.getMarketplaceRetailers();
    const newRetailer: MarketplaceRetailer = { ...retailer, id: generateEventId('mret', retailer.name.slice(0, 20)) };
    retailers.push(newRetailer);
    this.saveMarketplaceRetailers(retailers);
    return newRetailer;
  }

  static updateMarketplaceRetailer(id: string, updates: Partial<MarketplaceRetailer>): MarketplaceRetailer | null {
    const retailers = this.getMarketplaceRetailers();
    const idx = retailers.findIndex(r => r.id === id);
    if (idx === -1) return null;
    retailers[idx] = { ...retailers[idx], ...updates };
    this.saveMarketplaceRetailers(retailers);
    return retailers[idx];
  }

  static deleteMarketplaceRetailer(id: string): boolean {
    const retailers = this.getMarketplaceRetailers();
    const filtered = retailers.filter(r => r.id !== id);
    if (filtered.length === retailers.length) return false;
    this.saveMarketplaceRetailers(filtered);
    return true;
  }

  // ==================== MARKETPLACE: BANNERS ====================

  static getMarketplaceBanners(): MarketplaceBanner[] {
    return this.getCached<MarketplaceBanner[]>(DB_KEYS.MARKETPLACE_BANNERS, []);
  }

  static saveMarketplaceBanners(banners: MarketplaceBanner[]): void {
    this.setCached(DB_KEYS.MARKETPLACE_BANNERS, banners);
  }

  static createMarketplaceBanner(banner: Omit<MarketplaceBanner, 'id'>): MarketplaceBanner {
    const banners = this.getMarketplaceBanners();
    const newBanner: MarketplaceBanner = { ...banner, id: generateEventId('mban', banner.title.slice(0, 20)) };
    banners.push(newBanner);
    this.saveMarketplaceBanners(banners);
    return newBanner;
  }

  static updateMarketplaceBanner(id: string, updates: Partial<MarketplaceBanner>): MarketplaceBanner | null {
    const banners = this.getMarketplaceBanners();
    const idx = banners.findIndex(b => b.id === id);
    if (idx === -1) return null;
    banners[idx] = { ...banners[idx], ...updates };
    this.saveMarketplaceBanners(banners);
    return banners[idx];
  }

  static deleteMarketplaceBanner(id: string): boolean {
    const banners = this.getMarketplaceBanners();
    const filtered = banners.filter(b => b.id !== id);
    if (filtered.length === banners.length) return false;
    this.saveMarketplaceBanners(filtered);
    return true;
  }

  // ==================== MARKETPLACE: DEALS ====================

  static getMarketplaceDeals(): MarketplaceDeal[] {
    return this.getCached<MarketplaceDeal[]>(DB_KEYS.MARKETPLACE_DEALS, []);
  }

  static saveMarketplaceDeals(deals: MarketplaceDeal[]): void {
    this.setCached(DB_KEYS.MARKETPLACE_DEALS, deals);
  }

  static createMarketplaceDeal(deal: Omit<MarketplaceDeal, 'id'>): MarketplaceDeal {
    const deals = this.getMarketplaceDeals();
    const newDeal: MarketplaceDeal = { ...deal, id: generateEventId('mdeal', deal.title.slice(0, 20)) };
    deals.push(newDeal);
    this.saveMarketplaceDeals(deals);
    return newDeal;
  }

  static updateMarketplaceDeal(id: string, updates: Partial<MarketplaceDeal>): MarketplaceDeal | null {
    const deals = this.getMarketplaceDeals();
    const idx = deals.findIndex(d => d.id === id);
    if (idx === -1) return null;
    deals[idx] = { ...deals[idx], ...updates };
    this.saveMarketplaceDeals(deals);
    return deals[idx];
  }

  static deleteMarketplaceDeal(id: string): boolean {
    const deals = this.getMarketplaceDeals();
    const filtered = deals.filter(d => d.id !== id);
    if (filtered.length === deals.length) return false;
    this.saveMarketplaceDeals(filtered);
    return true;
  }

  // ==================== MARKETPLACE: INVOICES (Phase 2) ====================

  static getMarketplaceInvoices(): MarketplaceInvoice[] {
    return this.getCached<MarketplaceInvoice[]>(DB_KEYS.MARKETPLACE_INVOICES, []);
  }

  static saveMarketplaceInvoices(invoices: MarketplaceInvoice[]): void {
    this.setCached(DB_KEYS.MARKETPLACE_INVOICES, invoices);
  }

  static getUserInvoices(userId: string): MarketplaceInvoice[] {
    return this.getMarketplaceInvoices()
      .filter(inv => inv.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  static getPendingInvoices(): MarketplaceInvoice[] {
    return this.getMarketplaceInvoices()
      .filter(inv => inv.status === 'pending')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  static createMarketplaceInvoice(invoice: Omit<MarketplaceInvoice, 'id'>): MarketplaceInvoice {
    const invoices = this.getMarketplaceInvoices();
    const newInvoice: MarketplaceInvoice = {
      ...invoice,
      id: generateEventId('minv', invoice.userId),
      rpRevoked: false,
      rpRevokedAt: null,
      rpRevokedBy: null
    };
    invoices.push(newInvoice);
    this.saveMarketplaceInvoices(invoices);
    return newInvoice;
  }

  static approveMarketplaceInvoice(invoiceId: string, adminId: string, rewardPoints: number): MarketplaceInvoice | null {
    const invoices = this.getMarketplaceInvoices();
    const idx = invoices.findIndex(inv => inv.id === invoiceId);
    if (idx === -1) return null;
    invoices[idx] = {
      ...invoices[idx],
      status: 'approved',
      rewardPoints,
      processedAt: new Date().toISOString(),
      processedBy: adminId,
      rpRevoked: false,
      rpRevokedAt: null,
      rpRevokedBy: null
    };
    this.saveMarketplaceInvoices(invoices);
    // Add reward points to user's wallet
    // Invoice stores user.userId (7-digit), but wallet uses user.id (internal UUID)
    const invoiceUser = this.getUserByUserId(invoices[idx].userId);
    const walletUserId = invoiceUser ? invoiceUser.id : invoices[idx].userId;
    const wallet = this.getWallet(walletUserId);
    if (wallet) {
      this.updateWallet(walletUserId, {
        rewardPoints: (wallet.rewardPoints || 0) + rewardPoints,
        totalRewardPointsEarned: (wallet.totalRewardPointsEarned || 0) + rewardPoints,
      });
    }
    return invoices[idx];
  }

  static revokeMarketplaceInvoiceRewardPoints(invoiceId: string, adminId: string): {
    success: boolean;
    message: string;
    invoice: MarketplaceInvoice | null;
  } {
    const invoices = this.getMarketplaceInvoices();
    const idx = invoices.findIndex((inv) => inv.id === invoiceId);
    if (idx === -1) {
      return { success: false, message: 'Invoice not found', invoice: null };
    }

    const invoice = invoices[idx];
    if (invoice.status !== 'approved') {
      return { success: false, message: 'Only approved invoices can be taken back', invoice };
    }

    if (invoice.rpRevoked) {
      return { success: false, message: 'Reward points already taken back for this invoice', invoice };
    }

    const rp = Number(invoice.rewardPoints || 0);
    if (rp <= 0) {
      return { success: false, message: 'No reward points found on this invoice', invoice };
    }

    const invoiceUser = this.getUserByUserId(invoice.userId);
    const walletUserId = invoiceUser ? invoiceUser.id : invoice.userId;
    const wallet = this.getWallet(walletUserId);
    if (!wallet) {
      return { success: false, message: 'User wallet not found', invoice };
    }

    const currentRP = Number(wallet.rewardPoints || 0);
    if (currentRP < rp) {
      return {
        success: false,
        message: `Cannot take back ${rp} RP. User currently has only ${currentRP} RP available.`,
        invoice
      };
    }

    this.updateWallet(walletUserId, {
      rewardPoints: currentRP - rp,
      totalRewardPointsEarned: Math.max(0, Number(wallet.totalRewardPointsEarned || 0) - rp)
    });

    const now = new Date().toISOString();
    const updatedInvoice: MarketplaceInvoice = {
      ...invoice,
      status: 'pending',
      rewardPoints: 0,
      adminNotes: `RP corrected by admin (${adminId})`,
      processedAt: null,
      processedBy: null,
      rpRevoked: true,
      rpRevokedAt: now,
      rpRevokedBy: adminId
    };
    invoices[idx] = updatedInvoice;
    this.saveMarketplaceInvoices(invoices);

    return {
      success: true,
      message: `${rp} RP taken back. Invoice moved to pending for re-approval.`,
      invoice: updatedInvoice
    };
  }

  static rejectMarketplaceInvoice(invoiceId: string, adminId: string, notes: string): MarketplaceInvoice | null {
    const invoices = this.getMarketplaceInvoices();
    const idx = invoices.findIndex(inv => inv.id === invoiceId);
    if (idx === -1) return null;
    invoices[idx] = {
      ...invoices[idx],
      status: 'rejected',
      adminNotes: notes,
      processedAt: new Date().toISOString(),
      processedBy: adminId,
    };
    this.saveMarketplaceInvoices(invoices);
    return invoices[idx];
  }

  // ==================== MARKETPLACE: REDEMPTIONS (Phase 2) ====================

  private static ensureMarketplaceRedemptionTransactions(redemptions: RewardRedemption[]): void {
    if (!this.hasHydratedRemoteKey(DB_KEYS.TRANSACTIONS)) {
      return;
    }

    let changed = false;

    for (const redemption of redemptions) {
      if (redemption.status !== 'approved') continue;

      const redemptionTag = `[Redemption:${redemption.id}]`;
      const targetUser = this.getUserByUserId(redemption.userId);
      const walletUserId = targetUser ? targetUser.id : redemption.userId;
      const existingTransaction = this.getTransactions().some((tx) =>
        tx.userId === walletUserId
        && tx.type === 'admin_credit'
        && (tx.description || '').includes(redemptionTag)
      );

      if (existingTransaction) continue;

      this.createTransaction({
        id: generateEventId('tx', 'reward_redemption_income'),
        userId: walletUserId,
        type: 'admin_credit',
        amount: redemption.usdtAmount,
        status: 'completed',
        description: `Reward points redemption credited to income wallet (${redemption.rewardPoints} RP) ${redemptionTag}`,
        createdAt: redemption.processedAt || redemption.createdAt || new Date().toISOString(),
        completedAt: redemption.processedAt || redemption.createdAt || new Date().toISOString(),
      });
      this.repairIncomeWalletConsistency(walletUserId);
      changed = true;
    }

    if (changed) {
      this.markKeyDirtyForRemoteSync(DB_KEYS.TRANSACTIONS);
      this.markKeyDirtyForRemoteSync(DB_KEYS.WALLETS);
    }
  }

  static getMarketplaceRedemptions(): RewardRedemption[] {
    const redemptions = this.getCached<RewardRedemption[]>(DB_KEYS.MARKETPLACE_REDEMPTIONS, []);
    this.ensureMarketplaceRedemptionTransactions(redemptions);
    return redemptions;
  }

  static saveMarketplaceRedemptions(redemptions: RewardRedemption[]): void {
    this.setCached(DB_KEYS.MARKETPLACE_REDEMPTIONS, redemptions);
  }

  static getUserRedemptions(userId: string): RewardRedemption[] {
    return this.getMarketplaceRedemptions()
      .filter(r => r.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  static getPendingRedemptions(): RewardRedemption[] {
    return this.getMarketplaceRedemptions()
      .filter(r => r.status === 'pending')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  static createRedemptionRequest(userId: string, rewardPoints: number): RewardRedemption | null {
    // userId could be either 7-digit userId or internal id — resolve to wallet userId
    const userObj = this.getUserByUserId(userId);
    const walletUserId = userObj ? userObj.id : userId;
    const wallet = this.getWallet(walletUserId);
    if (!wallet) return null;
    const currentRP = wallet.rewardPoints || 0;
    if (currentRP < rewardPoints) return null;
    // Deduct RP immediately on request
    this.updateWallet(walletUserId, { rewardPoints: currentRP - rewardPoints });
    const redemption: RewardRedemption = {
      id: generateEventId('mred', userId),
      userId,
      rewardPoints,
      usdtAmount: rewardPoints * 0.01,
      status: 'pending',
      adminNotes: '',
      createdAt: new Date().toISOString(),
      processedAt: null,
      processedBy: null,
    };
    const redemptions = this.getMarketplaceRedemptions();
    redemptions.push(redemption);
    this.saveMarketplaceRedemptions(redemptions);
    return redemption;
  }

  static approveRedemption(redemptionId: string, adminId: string): RewardRedemption | null {
    const redemptions = this.getMarketplaceRedemptions();
    const idx = redemptions.findIndex(r => r.id === redemptionId);
    if (idx === -1) return null;
    redemptions[idx] = {
      ...redemptions[idx],
      status: 'approved',
      processedAt: new Date().toISOString(),
      processedBy: adminId,
    };
    this.saveMarketplaceRedemptions(redemptions);
    // Credit income wallet
    const redUser = this.getUserByUserId(redemptions[idx].userId);
    const redWalletUserId = redUser ? redUser.id : redemptions[idx].userId;
    const redWallet = this.getWallet(redWalletUserId);
    if (redWallet) {
      this.updateWallet(redWalletUserId, {
        incomeWallet: (redWallet.incomeWallet || 0) + redemptions[idx].usdtAmount,
        totalRewardPointsRedeemed: (redWallet.totalRewardPointsRedeemed || 0) + redemptions[idx].rewardPoints,
      });
      this.createTransaction({
        id: generateEventId('tx', 'reward_redemption_income'),
        userId: redWalletUserId,
        type: 'admin_credit',
        amount: redemptions[idx].usdtAmount,
        status: 'completed',
        description: `Reward points redemption credited to income wallet (${redemptions[idx].rewardPoints} RP) [Redemption:${redemptions[idx].id}]`,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      this.repairIncomeWalletConsistency(redWalletUserId);
    }
    return redemptions[idx];
  }

  static rejectRedemption(redemptionId: string, adminId: string, notes: string): RewardRedemption | null {
    const redemptions = this.getMarketplaceRedemptions();
    const idx = redemptions.findIndex(r => r.id === redemptionId);
    if (idx === -1) return null;
    // Refund RP back to user
    const rejUser = this.getUserByUserId(redemptions[idx].userId);
    const rejWalletUserId = rejUser ? rejUser.id : redemptions[idx].userId;
    const rejWallet = this.getWallet(rejWalletUserId);
    if (rejWallet) {
      this.updateWallet(rejWalletUserId, {
        rewardPoints: (rejWallet.rewardPoints || 0) + redemptions[idx].rewardPoints,
      });
    }
    redemptions[idx] = {
      ...redemptions[idx],
      status: 'rejected',
      adminNotes: notes,
      processedAt: new Date().toISOString(),
      processedBy: adminId,
    };
    this.saveMarketplaceRedemptions(redemptions);
    return redemptions[idx];
  }

  static clearAll(): void {
    Object.values(DB_KEYS).forEach(key => {
      this.removeStorageItem(key);
    });
    const tabSession = this.getSessionStorage();
    if (tabSession) {
      tabSession.removeItem(DB_KEYS.CURRENT_USER);
      tabSession.removeItem(DB_KEYS.SESSION);
    }
  }
}

export default Database;

// DEV ONLY: expose Database on window for console testing
if (typeof window !== 'undefined') {
  (window as any).Database = Database;
}
export { DB_KEYS, generateSevenDigitId, generatePinCode };

// Level-wise Report interface (local)
interface LevelWiseReport {
  level: number;
  userId: string;
  fullName: string;
  sponsorId: string;
  receiveHelpAmount: number;
  giveHelpAmount: number;
  netAmount: number;
  isQualified: boolean;
  directCount: number;
  date: string;
}



