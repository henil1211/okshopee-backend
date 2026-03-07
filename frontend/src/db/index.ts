import type {
  User, Wallet, Transaction, MatrixNode, SafetyPoolTransaction,
  GracePeriod, Notification, AdminSettings, PaymentMethod, Payment,
  Pin, PinTransfer, OtpRecord, PinPurchaseRequest, EmailLog,
  ImpersonationSession, SupportTicket, SupportTicketAttachment,
  SupportTicketCategory, SupportTicketMessage, SupportTicketPriority,
  SupportTicketStatus
} from '@/types';

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
  MATRIX_PENDING_CONTRIBUTIONS: 'mlm_matrix_pending_contributions'
};

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

// Initialize default admin settings
const defaultSettings: AdminSettings = {
  activationAmount: 11,
  pinAmount: 11,
  directIncomePercent: 45.45,
  helpingAmountPercent: 45.45,
  adminFeePercent: 9.09,
  withdrawalFeePercent: 5,
  gracePeriodHours: 72,
  maxLevels: 10,
  matrixViewMaxLevels: 20,
  reEntryEnabled: true,
  safetyPoolEnabled: true,
  activationDeadlineDays: 7,
  directReferralDeadlineDays: 15,
  requireOtpForTransactions: true,
  masterPassword: 'master@2024' // Default master password
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
    minAmount: 11,
    maxAmount: 50000,
    processingFee: 0,
    processingTime: 'Within 24 hours'
  }
];

const SUPPORT_TICKET_CATEGORIES: SupportTicketCategory[] = [
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
}

interface UserHelpTracker {
  userId: string;
  levels: Record<string, LevelHelpTrackerState>;
  lockedQueue: LockedGiveHelpItem[];
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
}

interface HelpTrackerReconciliationReport {
  scannedTrackers: number;
  createdTrackers: number;
  removedTrackers: number;
  repairedLevels: number;
  repairedQueueItems: number;
  walletSyncs: number;
  issues: string[];
}

interface MatrixLogicRebuildReport {
  activatedUsers: number;
  activatedMatrixNodes: number;
  repositionedMatrixNodes: number;
  directCountsUpdated: number;
  removedMatrixTransactions: number;
  removedMatrixSafetyPoolEntries: number;
  trackersReset: number;
  replayedMembers: number;
  backfilledActivationUsers: number;
  backfilledDirectIncomeEntries: number;
  backfilledAdminFeeEntries: number;
  reconciliation: HelpTrackerReconciliationReport;
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
  private static readonly MATRIX_REBUILD_LOCK_KEY = '__refernex_matrix_rebuild_lock__';
  private static readonly MATRIX_REBUILD_LOCK_TTL_MS = 15 * 60 * 1000;
  private static readonly REMOTE_SYNC_BASE_URL = (
    (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_BACKEND_URL || 'http://localhost:4000'
  ).replace(/\/+$/, '');
  private static readonly REMOTE_SYNC_KEYS = new Set<string>(
    Object.values(DB_KEYS).filter((key) => key !== DB_KEYS.CURRENT_USER && key !== DB_KEYS.SESSION)
  );
  private static readonly STARTUP_REMOTE_SYNC_KEYS = [
    DB_KEYS.USERS,
    DB_KEYS.WALLETS,
    DB_KEYS.SAFETY_POOL,
    DB_KEYS.SETTINGS
  ] as const;
  private static readonly ADMIN_REMOTE_SYNC_BATCHES = [
    [DB_KEYS.USERS, DB_KEYS.WALLETS, DB_KEYS.SAFETY_POOL, DB_KEYS.SETTINGS],
    [DB_KEYS.TRANSACTIONS],
    [DB_KEYS.PINS, DB_KEYS.PIN_TRANSFERS, DB_KEYS.PIN_PURCHASE_REQUESTS, DB_KEYS.PAYMENT_METHODS, DB_KEYS.PAYMENTS],
    [DB_KEYS.MATRIX, DB_KEYS.GRACE_PERIODS, DB_KEYS.RE_ENTRIES]
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

  // ===== In-memory parsed-object cache =====
  // Eliminates redundant JSON.parse() on hot-path reads.
  private static _cache = new Map<string, unknown>();

  private static acquireMatrixRebuildLock(): boolean {
    if (typeof window === 'undefined' || !window.localStorage) {
      return true;
    }

    const now = Date.now();
    try {
      const raw = window.localStorage.getItem(this.MATRIX_REBUILD_LOCK_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { startedAt?: number };
        const startedAt = Number(parsed?.startedAt || 0);
        if (startedAt > 0 && now - startedAt < this.MATRIX_REBUILD_LOCK_TTL_MS) {
          return false;
        }
      }
    } catch {
      // Ignore malformed lock state and overwrite it below.
    }

    window.localStorage.setItem(this.MATRIX_REBUILD_LOCK_KEY, JSON.stringify({ startedAt: now }));
    return true;
  }

  private static releaseMatrixRebuildLock(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    window.localStorage.removeItem(this.MATRIX_REBUILD_LOCK_KEY);
  }

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

    try {
      await this.hydrateFromServer({
        strict: false,
        maxAttempts: 1,
        timeoutMs: 8000,
        retryDelayMs: 500
      });
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
        return;
      }
      if (this.remoteSyncQueued) {
        this.remoteSyncQueued = false;
        void this.flushRemoteSync();
      }
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
          this.volatileSyncState.clear();
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
              } else {
                this.removeStorageItem(key);
              }
            }
          } finally {
            this.remoteSyncPending = false;
            this.remoteSyncQueued = false;
            this.remoteSyncDirtyKeys.clear();
            this.remoteSyncApplyingServerState = false;
            this.resumeRemoteSync(false);
          }
          this.remoteStateUpdatedAt = typeof payload?.updatedAt === 'string' ? payload.updatedAt : null;
          this.markSynced('Synced with server');
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
    this._cache.set(CACHE_KEY_USERS_NORMALIZED, normalized);
    return normalized;
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
    if (user.isActive && user.accountStatus === 'active') score += 10_000_000;
    score += Math.max(0, user.directCount || 0) * 10_000;
    score += txCount * 100;
    score += Math.floor(walletMagnitude);
    if (matrixUserIds?.has(user.userId)) score += 50_000;
    return score;
  }

  static getUserByUserId(userId: string): User | undefined {
    const matches = this.getUsers().filter(u => u.userId === userId);
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

    users[index] = { ...users[index], ...updates };
    this.saveUsers(users);
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
      const matrixWalletValue = Number(rest.matrixWallet);
      const lockedIncomeWalletValue = Number(rest.lockedIncomeWallet);
      const giveHelpLockedValue = Number(rest.giveHelpLocked);
      const totalReceivedValue = Number(rest.totalReceived);
      const totalGivenValue = Number(rest.totalGiven);
      return {
        userId,
        depositWallet: Number.isFinite(depositWalletValue) ? depositWalletValue : 0,
        pinWallet: computedPinWallet,
        incomeWallet: Number.isFinite(incomeWalletValue) ? incomeWalletValue : 0,
        matrixWallet: Number.isFinite(matrixWalletValue) ? matrixWalletValue : 0,
        lockedIncomeWallet: Number.isFinite(lockedIncomeWalletValue) ? lockedIncomeWalletValue : 0,
        giveHelpLocked: Number.isFinite(giveHelpLockedValue) ? giveHelpLockedValue : 0,
        totalReceived: Number.isFinite(totalReceivedValue) ? totalReceivedValue : 0,
        totalGiven: Number.isFinite(totalGivenValue) ? totalGivenValue : 0
      };
    });
    if (hasLegacyFields) {
      this.saveWallets(normalized);
    }
    this._cache.set(CACHE_KEY_WALLETS_NORMALIZED, normalized);
    return normalized;
  }

  static saveWallets(wallets: Wallet[]): void {
    this._cache.delete('__wallets_normalized');
    this.setCached(DB_KEYS.WALLETS, wallets);
  }

  static getWallet(userId: string): Wallet | undefined {
    return this.getWallets().find(w => w.userId === userId);
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

  private static computeLockedIncomeFromTransactions(userId: string): number {
    const txs = this.getTransactions()
      .filter((t) => t.userId === userId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    let locked = 0;
    for (const tx of txs) {
      const desc = (tx.description || '').toLowerCase();
      if (
        tx.type === 'receive_help'
        && tx.amount > 0
        && (desc.startsWith('locked first-two help at level') || desc.startsWith('locked receive help at level'))
      ) {
        locked += tx.amount;
        continue;
      }
      if (tx.type === 'receive_help' && tx.amount > 0 && desc.startsWith('released locked receive help at level')) {
        locked -= tx.amount;
        continue;
      }
      if (tx.type === 'give_help' && desc.includes('from locked income')) {
        locked -= Math.abs(tx.amount);
      }
    }

    return Math.max(0, Math.round(locked * 100) / 100);
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
        || tx.type === 'pin_used'
        || tx.type === 'pin_purchase'
        || tx.type === 'pin_transfer'
        || tx.type === 'deposit'
        || tx.type === 'p2p_transfer'
        || tx.type === 'reentry';
      const isIncomeWalletAdminCredit = tx.type !== 'admin_credit' || txDesc.includes('income wallet');

      // Lifetime earnings: all positive credits that are actually earnings (not activation/fund/pin flows).
      if (tx.amount > 0 && !isNonEarningCreditType && isIncomeWalletAdminCredit) {
        totalReceived += tx.amount;
      }

      switch (tx.type) {
        case 'direct_income':
        case 'level_income':
          incomeWallet += tx.amount;
          matrixWallet += tx.amount;
          relevantCount += 1;
          break;
        case 'receive_help': {
          const isLockedReceive = txDesc.startsWith('locked receive help at level')
            || txDesc.startsWith('locked first-two help at level');
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
            const transferOutflow = Math.min(Math.abs(tx.amount), Math.max(0, incomeWallet));
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

      wallet.incomeWallet = computed.incomeWallet;
      wallet.matrixWallet = computed.matrixWallet;
      wallet.totalReceived = computed.totalReceived;
      wallet.totalGiven = computed.totalGiven;
      repaired += 1;
    }

    if (repaired > 0) {
      this.saveWallets(wallets);
    }

    return { scanned: targetIds.size, repaired };
  }

  static syncLockedIncomeWallet(userId?: string): {
    scanned: number;
    synced: number;
  } {
    const wallets = this.getWallets();
    const targetIds = userId ? new Set([userId]) : new Set(wallets.map((w) => w.userId));
    const trackerMap = new Map(this.getHelpTrackers().map((t) => [t.userId, t]));
    let synced = 0;

    for (const wallet of wallets) {
      if (!targetIds.has(wallet.userId)) continue;
      const tracker = trackerMap.get(wallet.userId);
      const trackerLockedIncomeTotal = tracker
        ? Object.values(tracker.levels).reduce(
          (sum, state) => sum + (state.lockedReceiveAmount || 0) + (state.lockedAmount || 0),
          0
        )
        : 0;
      const txLockedIncomeTotal = this.computeLockedIncomeFromTransactions(wallet.userId);
      const lockedIncomeTotal = Math.max(
        0,
        Math.round(Math.max(trackerLockedIncomeTotal, txLockedIncomeTotal) * 100) / 100
      );

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

  // ==================== HELP TRACKERS ====================
  static getHelpTrackers(): UserHelpTracker[] {
    return this.getCached<UserHelpTracker[]>(DB_KEYS.HELP_TRACKERS, []);
  }

  static saveHelpTrackers(trackers: UserHelpTracker[]): void {
    this.setCached(DB_KEYS.HELP_TRACKERS, trackers);
  }

  static getUserHelpTracker(userId: string): UserHelpTracker {
    const trackers = this.getHelpTrackers();
    const existing = trackers.find(t => t.userId === userId);
    if (existing) return existing;

    const created: UserHelpTracker = {
      userId,
      levels: {},
      lockedQueue: []
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

  static getPendingMatrixContributions(): PendingMatrixContribution[] {
    return this.getCached<PendingMatrixContribution[]>(DB_KEYS.MATRIX_PENDING_CONTRIBUTIONS, []);
  }

  static savePendingMatrixContributions(items: PendingMatrixContribution[]): void {
    this.setCached(DB_KEYS.MATRIX_PENDING_CONTRIBUTIONS, items);
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

    // Build an ordered list of IDs to process (snapshot of pending items for this user).
    const initialItems = this.getPendingMatrixContributions();
    const pendingIds = initialItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.fromUserId === fromUserId && item.status === 'pending')
      .sort((a, b) => a.item.level - b.item.level || a.index - b.index)
      .map(({ item }) => item.id);
    if (pendingIds.length === 0) return;

    for (const itemId of pendingIds) {
      // Re-read from storage EVERY iteration to get fresh state
      // (nested calls during registerMatrixContribution may have modified storage).
      const freshItems = this.getPendingMatrixContributions();
      const freshItem = freshItems.find(i => i.id === itemId);
      if (!freshItem || freshItem.status !== 'pending') continue; // Already handled by nested call

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
        // Rollback — re-read fresh state again to avoid overwriting nested changes
        const rollbackItems = this.getPendingMatrixContributions();
        const rollbackItem = rollbackItems.find(i => i.id === itemId);
        if (rollbackItem) {
          rollbackItem.status = 'pending';
          rollbackItem.completedAt = undefined;
          this.savePendingMatrixContributions(rollbackItems);
        }
        break;
      }

      // If a limit is set, count successful items and stop when reached.
      if (limit !== undefined) {
        limit--;
        if (limit <= 0) break;
      }
    }
  }

  private static getPendingMatrixContributionBlockReason(item: PendingMatrixContribution): string | null {
    if (item.level < 1 || item.level > helpDistributionTable.length) {
      return `Invalid level ${item.level}.`;
    }

    const recipient = this.getUserById(item.toUserId);
    if (!recipient) return 'Recipient user not found.';
    if (!recipient.isActive || recipient.accountStatus !== 'active') {
      return 'Recipient account is inactive or blocked.';
    }

    const recipientWallet = this.getWallet(recipient.id);
    if (!recipientWallet) return 'Recipient wallet not found.';

    const sender = item.fromUserId ? this.getUserById(item.fromUserId) : undefined;
    if (item.fromUserId && !sender) return 'Sender user not found.';
    if (!sender) return null;
    if (!sender.isActive || sender.accountStatus !== 'active') {
      return 'Sender account is inactive or blocked.';
    }

    const senderWallet = this.getWallet(sender.id);
    if (!senderWallet) return 'Sender wallet not found.';

    return null;
  }

  static getPendingMatrixContributionsDebug(fromUserId: string): PendingMatrixDebugReport {
    const pending = this.getPendingMatrixContributions()
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.fromUserId === fromUserId && item.status === 'pending')
      .sort((a, b) => a.item.level - b.item.level || a.index - b.index)
      .map(({ item }) => item);

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

      const reason = this.getPendingMatrixContributionBlockReason(item);
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
      } else {
        rows.push({
          id: item.id,
          level: item.level,
          side: item.side,
          toUserId,
          toUserName,
          createdAt: item.createdAt,
          status: 'ready',
          reason: 'Ready to process.'
        });
      }
    }

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
      let blockedAtItemId: string | null = null;

      for (const { item } of ordered) {
        let status: 'ready' | 'blocked' = 'ready';
        let reason = 'Ready to process.';

        if (blockedAtItemId) {
          status = 'blocked';
          reason = `Sender queue blocked by earlier failed item ${blockedAtItemId}.`;
        } else {
          const blockReason = this.getPendingMatrixContributionBlockReason(item);
          if (blockReason) {
            status = 'blocked';
            reason = blockReason;
            blockedAtItemId = item.id;
          }
        }

        if (item.toUserId !== toUserId) continue;
        const sender = this.getUserById(fromUserId);
        rows.push({
          id: item.id,
          level: item.level,
          side: item.side,
          fromUserId: sender?.userId || fromUserId,
          fromUserName: sender?.fullName || 'Unknown user',
          createdAt: item.createdAt,
          status,
          reason
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

  static getEffectiveDirectCount(user: User): number {
    const computedDirect = this.getUsers().filter((member) =>
      !member.isAdmin
      && member.sponsorId === user.userId
      && member.isActive
      && member.accountStatus === 'active'
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

  static getQualifiedLevel(userRef: string): number {
    const user = this.resolveUserByRef(userRef);
    if (!user) return 0;

    const tracker = this.getUserHelpTracker(user.id);
    let qualifiedLevel = 0;

    if (tracker && tracker.levels) {
      for (let i = 0; i < helpDistributionTable.length; i++) {
        const lvl = i + 1;
        const requiredUsers = helpDistributionTable[i].users;
        const fill = tracker.levels[String(lvl)]?.receiveEvents || 0;
        if (fill >= requiredUsers) {
          qualifiedLevel = lvl;
        } else {
          break;
        }
      }
    }

    return qualifiedLevel;
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

    const tracker = this.getUserHelpTracker(userId);
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

    const consumeTxDerivedLockedAcrossLevels = (preferredLevel: number, amount: number) => {
      let remaining = Math.max(0, amount);
      if (remaining <= 0) return;

      const levels = Array.from(txLevelMap.keys())
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= helpDistributionTable.length)
        .sort((a, b) => a - b);
      const ordered = levels.includes(preferredLevel)
        ? [preferredLevel, ...levels.filter((l) => l !== preferredLevel)]
        : levels;

      // Match backend locked-income consumption order:
      // first qualification-lock, then first-two lock.
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
        if (desc.startsWith('locked first-two help at level')) {
          slot.firstTwo += tx.amount;
        } else if (desc.startsWith('locked receive help at level')) {
          slot.qualification += tx.amount;
        } else if (desc.startsWith('released locked receive help at level')) {
          slot.qualification -= tx.amount;
        }
        continue;
      }

      if (tx.type === 'give_help' && desc.includes('from locked income')) {
        consumeTxDerivedLockedAcrossLevels(level, Math.abs(tx.amount));
      }
    }

    for (const levelData of helpDistributionTable) {
      const level = levelData.level;
      const state = tracker.levels[String(level)];
      const txDerived = txLevelMap.get(level) || { firstTwo: 0, qualification: 0 };
      const trackerFirstTwo = state?.lockedAmount || 0;
      const trackerQualification = state?.lockedReceiveAmount || 0;
      const hasTrackerState = !!state;
      const lockedFirstTwoAmount = Math.max(0, hasTrackerState ? trackerFirstTwo : txDerived.firstTwo);
      const lockedQualificationAmount = Math.max(0, hasTrackerState ? trackerQualification : txDerived.qualification);
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

    const nationalTourQualified = this.isTourQualifiedForLevel(user, tracker, 3);
    if ((!!next.nationalTour) !== nationalTourQualified) {
      next.nationalTour = nationalTourQualified;
      next.nationalTourDate = nationalTourQualified ? (next.nationalTourDate || now) : undefined;
      changed = true;
    }

    const internationalTourQualified = this.isTourQualifiedForLevel(user, tracker, 4);
    if ((!!next.internationalTour) !== internationalTourQualified) {
      next.internationalTour = internationalTourQualified;
      next.internationalTourDate = internationalTourQualified ? (next.internationalTourDate || now) : undefined;
      changed = true;
    }

    const familyTourQualified = this.isTourQualifiedForLevel(user, tracker, 5);
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

    const prefix = `locked first-two help at level ${level}`;
    const observed = this.getTransactions().filter((tx) =>
      tx.userId === userId
      && tx.type === 'receive_help'
      && tx.amount > 0
      && (tx.description || '').toLowerCase().startsWith(prefix)
    ).length;
    return Math.min(2, observed);
  }

  private static getObservedReceiveEventCount(userId: string, level: number): number {
    // Count only real receive-help events for the level.
    // Exclude release events because they are wallet unlock bookkeeping, not new receives.
    return this.getTransactions().filter((tx) => {
      if (tx.userId !== userId) return false;
      if (tx.type !== 'receive_help') return false;
      if (!(tx.amount > 0)) return false;
      const txLevel = Number(tx.level);
      if (!Number.isFinite(txLevel) || txLevel !== level) return false;
      const desc = (tx.description || '').toLowerCase();
      if (desc.startsWith('released locked receive help at level')) return false;
      return true;
    }).length;
  }

  private static canReceiveAtLevel(userId: string, level: number): boolean {
    const levelData = helpDistributionTable[level - 1];
    if (!levelData) return false;
    const tracker = this.getUserHelpTracker(userId);
    const state = this.ensureLevelTrackerState(tracker, level);
    if (!this._bulkRebuildMode) {
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
          upline.isActive
          && upline.accountStatus === 'active'
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
        ? this.ensureLevelTrackerState(senderTracker, recipientLevel)
        : null;
      const senderLevelLockedAmount = senderLevelState?.lockedAmount || 0;
      const sourceAvailable = useLockedIncome
        ? Math.min(senderLockedIncomeWallet, senderLevelLockedAmount)
        : Math.min(senderWallet.incomeWallet, senderMatrixWallet);
      if (sourceAvailable <= 0.0001) break;

      const recipient = this.findEligibleUplineForGiveHelp(user, recipientLevel);
      if (!recipient) {
        const safetyAmount = Math.min(remaining, sourceAvailable);
        if (safetyAmount <= 0.0001) break;

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

        queueGiveTx('safety_pool', {
          amount: safetyAmount,
          level,
          description: `${description} to safety pool`
        });
        this.addToSafetyPool(safetyAmount, userId, `No qualified upline for level ${level}`);
        totalTransferred += safetyAmount;
        remaining -= safetyAmount;
        break;
      }

      const requiredAmount = helpDistributionTable[recipientLevel - 1]?.perUserHelp || 0;
      if (requiredAmount <= 0) break;
      if (remaining + 0.0001 < requiredAmount) break;
      if (sourceAvailable + 0.0001 < requiredAmount) break;

      const transferAmount = requiredAmount;

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

      queueGiveTx(`recipient:${recipient.id}`, {
        amount: transferAmount,
        toUserId: recipient.id,
        level: recipientLevel,
        description: `${description} to ${recipient.fullName} (${recipient.userId})`
      });

      const recipientWallet = this.getWallet(recipient.id);
      if (!recipientWallet) break;

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
          this.processPendingMatrixContributionsForUser(recipient.id, 1);

          const walletAfterPending = this.getWallet(recipient.id);
          const consumedByPending =
            (recipientWallet.lockedIncomeWallet || 0) + transferAmount - (walletAfterPending?.lockedIncomeWallet || 0);

          if (consumedByPending > 0) {
            recipientState.givenAmount += consumedByPending;
            const levelPerUserHelp = helpDistributionTable[recipientLevel - 1]?.perUserHelp || 0;
            if (levelPerUserHelp > 0) {
              recipientState.giveEvents = Math.min(
                2,
                recipientState.giveEvents + Math.floor(consumedByPending / levelPerUserHelp)
              );
            }
            recipientState.lockedAmount = Math.max(0, recipientState.lockedAmount - consumedByPending);
            if (walletAfterPending) {
              this.updateWallet(recipient.id, {
                giveHelpLocked: Math.max(0, (walletAfterPending.giveHelpLocked || 0) - consumedByPending)
              });
            }
          } else {
            const lockedToTransfer = recipientState.lockedAmount;
            const transferred = this.executeGiveHelp(
              recipient.id,
              lockedToTransfer,
              recipientLevel,
              `Auto give help at level ${recipientLevel} from locked income`,
              { useLockedIncome: true }
            );
            if (transferred > 0) {
              recipientState.givenAmount += transferred;
              const levelPerUserHelp = helpDistributionTable[recipientLevel - 1]?.perUserHelp || 0;
              if (levelPerUserHelp > 0) {
                recipientState.giveEvents = Math.min(
                  2,
                  recipientState.giveEvents + Math.floor(transferred / levelPerUserHelp)
                );
              }
              recipientState.lockedAmount = Math.max(0, recipientState.lockedAmount - transferred);
              const latestRecipientWallet = this.getWallet(recipient.id);
              if (latestRecipientWallet) {
                this.updateWallet(recipient.id, {
                  giveHelpLocked: Math.max(0, (latestRecipientWallet.giveHelpLocked || 0) - transferred)
                });
              }
            }
          }
        }
      } else if (receiveIndex % 5 === 0) {
        this.addToSafetyPool(transferAmount, recipient.id, `Every 5th help deduction at level ${recipientLevel}`);
        this.createTransaction({
          id: generateEventId('tx', `upline_help_safety_l${recipientLevel}`),
          userId: recipient.id,
          type: 'safety_pool',
          amount: -transferAmount,
          level: recipientLevel,
          status: 'completed',
          description: `Every 5th help deduction at level ${recipientLevel}`,
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
        safetyDeducted: Math.max(0, toNum((existing as any).safetyDeducted))
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
      safetyDeducted: 0
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

    const takeLockedReceive = Math.min(state.lockedReceiveAmount || 0, remaining);
    if (takeLockedReceive > 0) {
      state.lockedReceiveAmount = Math.max(0, (state.lockedReceiveAmount || 0) - takeLockedReceive);
      consumedFromLockedReceiveAmount += takeLockedReceive;
      remaining -= takeLockedReceive;
    }

    const takeLockedFirstTwo = Math.min(state.lockedAmount || 0, remaining);
    if (takeLockedFirstTwo > 0) {
      state.lockedAmount = Math.max(0, (state.lockedAmount || 0) - takeLockedFirstTwo);
      consumedFromLockedAmount += takeLockedFirstTwo;
      remaining -= takeLockedFirstTwo;
    }

    tracker.levels[key] = state;

    return {
      success: remaining <= 0.0001,
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
    if (!user || !user.isActive || user.accountStatus !== 'active') return false;
    const fromUser = fromUserId ? this.getUserById(fromUserId) : undefined;
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
      if (!fromUser.isActive || fromUser.accountStatus !== 'active') return false;

      const fromTracker = this.getUserHelpTracker(fromUser.id);
      const fromState = this.ensureLevelTrackerState(fromTracker, level);
      const walletLockedAvailable = fromWallet.lockedIncomeWallet || 0;
      if (walletLockedAvailable < amount) {
        return false;
      }

      // Source lock level is one step behind the recipient matrix depth.
      // Example: level-1 first-two lock ($10) funds level-2 ancestor contribution ($10).
      const debitLockedLevel = Math.max(1, level - 1);
      const consumed = this.consumeLockedIncomeAtLevel(fromTracker, debitLockedLevel, amount);
      if (!consumed.success) {
        return false;
      }

      this.updateWallet(fromUser.id, {
        lockedIncomeWallet: walletLockedAvailable - amount,
        totalGiven: fromWallet.totalGiven + amount,
        giveHelpLocked: Math.max(0, (fromWallet.giveHelpLocked || 0) - consumed.consumedFromLockedAmount)
      });

      fromState.givenAmount += amount;
      fromState.giveEvents = Math.min(2, (fromState.giveEvents || 0) + 1);
      fromTracker.levels[String(level)] = fromState;
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
        // Process pending matrix contributions FIRST so locked income flows
        // up to the correct higher-level recipient before executeGiveHelp consumes it.
        tracker.levels[key] = levelState;
        this.saveUserHelpTracker(tracker);
        this.processPendingMatrixContributionsForUser(user.id, 1);

        // Pending contributions handle all upward help flow.
        // Remaining locked income stays until more pending contributions can process.
        const walletAfterPending = this.getWallet(user.id);
        const consumedByPending = (wallet.lockedIncomeWallet || 0) + amount - (walletAfterPending?.lockedIncomeWallet || 0);
        if (consumedByPending > 0) {
          levelState.givenAmount += consumedByPending;
          levelState.giveEvents = Math.min(2, levelState.giveEvents + 1);
          levelState.lockedAmount = Math.max(0, levelState.lockedAmount - consumedByPending);
          if (walletAfterPending) {
            this.updateWallet(user.id, {
              giveHelpLocked: Math.max(0, (walletAfterPending.giveHelpLocked || 0) - consumedByPending)
            });
          }
        } else {
          // Fallback for users with no pending contributions (e.g., root user):
          // release locked income via executeGiveHelp (routes to safety pool if no upline).
          const lockedToTransfer = levelState.lockedAmount;
          const transferred = this.executeGiveHelp(
            user.id,
            lockedToTransfer,
            level,
            `Auto give help at level ${level} from locked income`,
            { useLockedIncome: true }
          );
          if (transferred > 0) {
            levelState.givenAmount += transferred;
            levelState.giveEvents = Math.min(2, levelState.giveEvents + Math.floor(transferred / amount));
            levelState.lockedAmount = Math.max(0, levelState.lockedAmount - transferred);
            const latestWallet = this.getWallet(user.id);
            if (latestWallet) {
              this.updateWallet(user.id, {
                giveHelpLocked: Math.max(0, (latestWallet.giveHelpLocked || 0) - transferred)
              });
            }
          }
        }
      }
    } else if (receiveIndex % 5 === 0) {
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
      this.addToSafetyPool(amount, user.id, `Every 5th help deduction at level ${level}`);
      this.createTransaction({
        id: generateEventId('tx', `level_safety_l${level}`),
        userId: user.id,
        type: 'safety_pool',
        amount: -amount,
        level,
        status: 'completed',
        description: `Every 5th help deduction at level ${level} - transferred to safety pool`,
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

    const tracker = this.getUserHelpTracker(userId);
    const key = String(level);
    const state = this.ensureLevelTrackerState(tracker, level);
    const prevLeft = state.leftEvents;
    const prevRight = state.rightEvents;
    const prevMatched = state.matchedEvents;

    if (side === 'left') {
      state.leftEvents += 1;
    } else {
      state.rightEvents += 1;
    }
    state.matchedEvents += 1;
    tracker.levels[key] = state;
    this.saveUserHelpTracker(tracker);

    const processed = this.processMatchedHelpEvent(userId, level, fromUserId, options);
    if (!processed) {
      state.leftEvents = prevLeft;
      state.rightEvents = prevRight;
      state.matchedEvents = prevMatched;
      tracker.levels[key] = state;
      this.saveUserHelpTracker(tracker);
      return false;
    }
    return true;
  }

  static releaseLockedGiveHelp(userId: string): void {
    const user = this.getUserById(userId);
    if (!user) return;

    const tracker = this.getUserHelpTracker(userId);
    let changed = false;
    let releasedTotal = 0;

    for (const item of tracker.lockedQueue) {
      if (item.status !== 'locked') continue;
      if (!this.isQualifiedForLevel(user, item.level)) continue;

      const pendingAmount = item.amount;
      const walletBefore = this.getWallet(user.id);
      const lockedBefore = walletBefore?.lockedIncomeWallet || 0;
      this.processPendingMatrixContributionsForUser(userId, 1);
      const walletAfter = this.getWallet(user.id);
      const lockedAfter = walletAfter?.lockedIncomeWallet || 0;
      let transferred = Math.max(0, lockedBefore - lockedAfter);

      if (transferred <= 0) {
        transferred = this.executeGiveHelp(
          user.id,
          pendingAmount,
          item.level,
          `Released locked give help at level ${item.level} from locked income`,
          { useLockedIncome: true }
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
        this.processPendingMatrixContributionsForUser(userId, 1);
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

        // Fallback: executeGiveHelp if no pending contributions available
        const transferred = this.executeGiveHelp(
          user.id,
          pendingFirstTwoLocked,
          level,
          `Released locked give help at level ${level} from locked income`,
          { useLockedIncome: true }
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
      this.saveUserHelpTracker(tracker);
      this.processPendingMatrixContributionsForUser(userId);
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
  }

  private static isMatrixTransactionForRebuild(tx: Transaction): boolean {
    if (tx.type === 'receive_help' || tx.type === 'give_help') {
      return true;
    }
    if (tx.type === 'level_income' && (tx.description || '').startsWith('Helping amount from ')) {
      return true;
    }
    if (
      tx.type === 'safety_pool'
      && (
        tx.description?.startsWith('Every 5th help deduction at level')
        || tx.description?.includes('to safety pool')
        || tx.description?.startsWith('No qualified upline for level')
      )
    ) {
      return true;
    }
    return false;
  }

  private static isMatrixSafetyPoolReasonForRebuild(reason: string): boolean {
    if (!reason) return false;
    return reason.startsWith('Every 5th help deduction at level')
      || reason.startsWith('No qualified upline for level')
      || reason.startsWith('No active immediate upline for activation help')
      || reason === 'No qualified upline';
  }

  private static hasActivationTransaction(userId: string): boolean {
    return this.getTransactions().some((tx) =>
      tx.userId === userId
      && tx.status === 'completed'
      && (tx.type === 'pin_used' || tx.type === 'activation')
    );
  }

  private static hasDirectIncomeFromDownline(sponsorUserId: string, fromUserId: string): boolean {
    return this.getTransactions().some((tx) =>
      tx.userId === sponsorUserId
      && tx.fromUserId === fromUserId
      && tx.type === 'direct_income'
      && tx.status === 'completed'
    );
  }

  private static hasAdminFeeSafetyEntry(fromUserId: string): boolean {
    const pool = this.getSafetyPool();
    return pool.transactions.some((tx) => tx.fromUserId === fromUserId && tx.reason === 'Admin fee');
  }

  private static backfillMissingActivationEffects(users: User[]): {
    users: number;
    sponsorCredits: number;
    adminFees: number;
  } {
    let usersBackfilled = 0;
    let sponsorCredits = 0;
    let adminFees = 0;

    for (const member of users) {
      if (member.isAdmin) continue;
      if (this.hasActivationTransaction(member.id)) continue;

      this.createTransaction({
        id: generateEventId('tx', `backfill_activation_${member.userId}`),
        userId: member.id,
        type: 'activation',
        amount: 11,
        status: 'completed',
        description: 'Backfilled activation for legacy account',
        createdAt: member.activatedAt || member.createdAt || new Date().toISOString(),
        completedAt: new Date().toISOString()
      });
      usersBackfilled += 1;

      const sponsor = member.sponsorId ? this.getUserByUserId(member.sponsorId) : undefined;
      if (sponsor && !this.hasDirectIncomeFromDownline(sponsor.id, member.id)) {
        const sponsorWallet = this.getWallet(sponsor.id);
        if (sponsorWallet) {
          this.updateWallet(sponsor.id, {
            incomeWallet: sponsorWallet.incomeWallet + 5,
            totalReceived: sponsorWallet.totalReceived + 5
          });
          this.createTransaction({
            id: generateEventId('tx', `backfill_direct_${member.userId}`),
            userId: sponsor.id,
            type: 'direct_income',
            amount: 5,
            fromUserId: member.id,
            status: 'completed',
            description: `Direct sponsor income from ${member.fullName} (${member.userId})`,
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          });
          sponsorCredits += 1;
        }
      } else if (!sponsor) {
        this.addToSafetyPool(5, member.id, 'No sponsor - direct income');
      }

      if (!this.hasAdminFeeSafetyEntry(member.id)) {
        this.addToSafetyPool(1, member.id, 'Admin fee');
        adminFees += 1;
      }
    }

    return {
      users: usersBackfilled,
      sponsorCredits,
      adminFees
    };
  }

  private static compareUsersByJoinOrder(a: User, b: User): number {
    const aTimeRaw = new Date(a.createdAt).getTime();
    const bTimeRaw = new Date(b.createdAt).getTime();
    const aTime = Number.isFinite(aTimeRaw) ? aTimeRaw : 0;
    const bTime = Number.isFinite(bTimeRaw) ? bTimeRaw : 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.userId.localeCompare(b.userId);
  }

  private static findNextPositionInMap(
    nodeMap: Map<string, MatrixNode>,
    sponsorUserId: string
  ): { parentId: string; position: 'left' | 'right' } | null {
    const queue: string[] = [sponsorUserId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentNode = nodeMap.get(currentId);
      if (!currentNode) continue;

      const hasLeft = !!(currentNode.leftChild && nodeMap.has(currentNode.leftChild));
      const hasRight = !!(currentNode.rightChild && nodeMap.has(currentNode.rightChild));

      if (!hasLeft) {
        currentNode.leftChild = undefined;
        return { parentId: currentId, position: 'left' };
      }

      if (!hasRight) {
        currentNode.rightChild = undefined;
        return { parentId: currentId, position: 'right' };
      }

      queue.push(currentNode.leftChild!, currentNode.rightChild!);
    }

    return null;
  }

  private static rebuildMatrixTopology(users: User[]): {
    matrix: MatrixNode[];
    users: User[];
    repositionedMatrixNodes: number;
  } {
    const rootUser = users.find((u) => u.userId === '1000001') || users.find((u) => u.isAdmin) || null;
    const rootUserId = rootUser?.userId || '1000001';
    const rootUserName = rootUser?.fullName || 'System Admin';

    const nodeMap = new Map<string, MatrixNode>();
    nodeMap.set(rootUserId, {
      userId: rootUserId,
      username: rootUserName,
      level: 0,
      position: 0,
      isActive: true
    });

    const placementByUserId = new Map<string, { parentId: string | null; position: 'left' | 'right' | null }>();
    placementByUserId.set(rootUserId, { parentId: null, position: null });

    const placeMember = (member: User, preferredSponsorId?: string | null): boolean => {
      const sponsorRoot = preferredSponsorId && nodeMap.has(preferredSponsorId) ? preferredSponsorId : rootUserId;
      const placement =
        this.findNextPositionInMap(nodeMap, sponsorRoot)
        || this.findNextPositionInMap(nodeMap, rootUserId);
      if (!placement) return false;

      const parentNode = nodeMap.get(placement.parentId);
      if (!parentNode) return false;

      const matrixNode: MatrixNode = {
        userId: member.userId,
        username: member.fullName || member.userId,
        level: (parentNode.level || 0) + 1,
        position: placement.position === 'left' ? 0 : 1,
        parentId: placement.parentId,
        isActive: member.isActive && member.accountStatus === 'active'
      };

      nodeMap.set(member.userId, matrixNode);
      if (placement.position === 'left') {
        parentNode.leftChild = member.userId;
      } else {
        parentNode.rightChild = member.userId;
      }

      placementByUserId.set(member.userId, {
        parentId: placement.parentId,
        position: placement.position
      });
      return true;
    };

    const orderedMembers = [...users]
      .filter((u) => u.userId !== rootUserId && !u.isAdmin)
      .sort((a, b) => this.compareUsersByJoinOrder(a, b));

    let pending = orderedMembers;
    let guard = 0;
    while (pending.length > 0 && guard < orderedMembers.length + 5) {
      const nextPending: User[] = [];
      let placedInPass = 0;

      for (const member of pending) {
        if (member.sponsorId && !nodeMap.has(member.sponsorId)) {
          nextPending.push(member);
          continue;
        }

        if (placeMember(member, member.sponsorId)) {
          placedInPass += 1;
        } else {
          nextPending.push(member);
        }
      }

      if (nextPending.length === 0) break;

      if (placedInPass === 0) {
        for (const member of nextPending) {
          placeMember(member, rootUserId);
        }
        pending = [];
        break;
      }

      pending = nextPending;
      guard += 1;
    }

    let repositionedMatrixNodes = 0;
    const rebuiltUsers = users.map((member) => {
      if (member.userId === rootUserId) {
        if (member.parentId !== null || member.position !== null) {
          repositionedMatrixNodes += 1;
        }
        return { ...member, parentId: null, position: null };
      }

      const placement = placementByUserId.get(member.userId);
      if (!placement) return member;

      if ((member.parentId || null) !== (placement.parentId || null) || (member.position || null) !== placement.position) {
        repositionedMatrixNodes += 1;
      }

      return {
        ...member,
        parentId: placement.parentId,
        position: placement.position
      };
    });

    const rebuiltMatrix = Array.from(nodeMap.values()).sort((a, b) =>
      (a.level - b.level) || a.userId.localeCompare(b.userId)
    );

    return {
      matrix: rebuiltMatrix,
      users: rebuiltUsers,
      repositionedMatrixNodes
    };
  }

  static async activateUsersAndRebuildMatrixLogic(
    onProgress?: (done: number, total: number) => void,
    options?: {
      preserveMatrixTransactions?: boolean;
      activateLegacyInactiveUsers?: boolean;
    }
  ): Promise<MatrixLogicRebuildReport> {
    if (!this.acquireMatrixRebuildLock()) {
      throw new Error('A matrix rebuild is already running. Wait for it to finish, then refresh once before trying again.');
    }

    try {
      return await this.runWithRemoteSyncPaused(async () => {
        return this.runWithLocalStateTransaction(async () => {
          const preserveMatrixTransactions = !!options?.preserveMatrixTransactions;
          const activateLegacyInactiveUsers = options?.activateLegacyInactiveUsers !== false;
          const users = this.getUsers();
          const matrix = this.getMatrix();

          const report: MatrixLogicRebuildReport = {
            activatedUsers: 0,
            activatedMatrixNodes: 0,
            repositionedMatrixNodes: 0,
            directCountsUpdated: 0,
            removedMatrixTransactions: 0,
            removedMatrixSafetyPoolEntries: 0,
            trackersReset: 0,
            replayedMembers: 0,
            backfilledActivationUsers: 0,
            backfilledDirectIncomeEntries: 0,
            backfilledAdminFeeEntries: 0,
            reconciliation: {
              scannedTrackers: 0,
              createdTrackers: 0,
              removedTrackers: 0,
              repairedLevels: 0,
              repairedQueueItems: 0,
              walletSyncs: 0,
              issues: []
            }
          };

          const directCountsBySponsor = new Map<string, number>();
          for (const member of users) {
            if (!member.sponsorId) continue;
            directCountsBySponsor.set(member.sponsorId, (directCountsBySponsor.get(member.sponsorId) || 0) + 1);
          }

          const normalizedUsers = users.map((u) => {
            const next: User = { ...u };
            const computedDirect = directCountsBySponsor.get(u.userId) || 0;
            if ((next.directCount || 0) !== computedDirect) {
              next.directCount = computedDirect;
              report.directCountsUpdated += 1;
            }

            const shouldAutoActivate = activateLegacyInactiveUsers
              && !next.isAdmin
              && next.accountStatus !== 'temp_blocked'
              && next.accountStatus !== 'permanent_blocked';
            if (shouldAutoActivate) {
              const wasInactive = !next.isActive || next.accountStatus !== 'active';
              if (wasInactive) {
                report.activatedUsers += 1;
              }
              next.isActive = true;
              next.accountStatus = 'active';
              if (!next.activatedAt) {
                next.activatedAt = new Date().toISOString();
              }
            }

            return next;
          });
          const rebuiltTopology = this.rebuildMatrixTopology(normalizedUsers);
          report.repositionedMatrixNodes = rebuiltTopology.repositionedMatrixNodes;
          const normalizedUsersWithTopology = rebuiltTopology.users;
          this.saveUsers(normalizedUsersWithTopology);

          const backfill = this.backfillMissingActivationEffects(normalizedUsersWithTopology);
          report.backfilledActivationUsers = backfill.users;
          report.backfilledDirectIncomeEntries = backfill.sponsorCredits;
          report.backfilledAdminFeeEntries = backfill.adminFees;

          const userByUserId = new Map(normalizedUsersWithTopology.map((u) => [u.userId, u]));
          const previousNodeByUserId = new Map(matrix.map((node) => [node.userId, node]));
          const normalizedMatrix = rebuiltTopology.matrix.map((node) => {
            const owner = userByUserId.get(node.userId);
            if (!owner) return node;
            const shouldNodeBeActive = owner.isActive && owner.accountStatus === 'active';
            if (node.isActive !== shouldNodeBeActive) {
              return { ...node, isActive: shouldNodeBeActive };
            }
            return node;
          });
          for (const node of normalizedMatrix) {
            const previous = previousNodeByUserId.get(node.userId);
            if (previous && previous.isActive !== node.isActive) {
              report.activatedMatrixNodes += 1;
            }
          }
          this.saveMatrix(normalizedMatrix);

          const transactions = this.getTransactions();
          const keptTransactions: Transaction[] = [];
          for (const tx of transactions) {
            if (!this.isMatrixTransactionForRebuild(tx)) {
              keptTransactions.push(tx);
              continue;
            }
            report.removedMatrixTransactions += 1;
          }
          this.saveTransactions(keptTransactions);

          // Rebuild baseline wallets deterministically from non-matrix ledger.
          const wallets = this.getWallets();
          for (const wallet of wallets) {
            const computed = this.computeIncomeLedgerFromTransactions(wallet.userId);
            wallet.incomeWallet = computed.incomeWallet;
            wallet.matrixWallet = computed.matrixWallet;
            wallet.totalReceived = computed.totalReceived;
            wallet.totalGiven = computed.totalGiven;
            wallet.giveHelpLocked = 0;
            wallet.lockedIncomeWallet = 0;
          }
          this.saveWallets(wallets);

          const pool = this.getSafetyPool();
          const keptPoolTx = pool.transactions.filter((tx) => !this.isMatrixSafetyPoolReasonForRebuild(tx.reason));
          report.removedMatrixSafetyPoolEntries = pool.transactions.length - keptPoolTx.length;
          const rebuiltPoolTotal = keptPoolTx.reduce((sum, tx) => sum + tx.amount, 0);
          this.saveSafetyPool({
            totalAmount: rebuiltPoolTotal,
            transactions: keptPoolTx
          });

          const resetTrackers: UserHelpTracker[] = normalizedUsersWithTopology.map((u) => ({
            userId: u.id,
            levels: {},
            lockedQueue: []
          }));
          this.saveHelpTrackers(resetTrackers);
          this.savePendingMatrixContributions([]);
          report.trackersReset = resetTrackers.length;

          const nodeMap = new Map(normalizedMatrix.map((node) => [node.userId, node]));
          const replayUsers = [...normalizedUsersWithTopology]
            .filter((u) => !u.isAdmin)
            .sort((a, b) => this.compareUsersByJoinOrder(a, b));

          // Yield to browser every BATCH_SIZE users to prevent "page unresponsive"
          const BATCH_SIZE = 50;
          const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

          const useBulkRebuildMode = !preserveMatrixTransactions;
          this._bulkSafetyPoolTotal = 0;
          if (useBulkRebuildMode) {
            // Bulk mode skips matrix transaction writes to reduce memory/latency on very large datasets.
            this._bulkRebuildMode = true;
          }
          try {

            for (let i = 0; i < replayUsers.length; i++) {
              const replayUser = replayUsers[i];
              const replayNode = nodeMap.get(replayUser.userId);
              if (!replayNode?.parentId) continue;
              this.processMatrixHelpForNewMember(replayUser.userId, replayUser.id);
              report.replayedMembers += 1;

              // Yield to browser periodically so the page stays responsive
              if ((i + 1) % BATCH_SIZE === 0) {
                if (onProgress) onProgress(i + 1, replayUsers.length);
                await yieldToUI();
              }
            }
            if (onProgress) onProgress(replayUsers.length, replayUsers.length);

          } finally {
            if (useBulkRebuildMode) {
              this._bulkRebuildMode = false;
            }
          }

          // Write the accumulated safety pool total
          if (useBulkRebuildMode) {
            const currentPool = this.getSafetyPool();
            currentPool.totalAmount += this._bulkSafetyPoolTotal;
            this.saveSafetyPool(currentPool);
          }

          report.reconciliation = this.reconcileHelpTrackers();
          const finalPool = this.getSafetyPool();
          const finalPoolTotal = finalPool.transactions.reduce((sum, tx) => sum + tx.amount, 0)
            + (useBulkRebuildMode ? this._bulkSafetyPoolTotal : 0);
          this.saveSafetyPool({
            totalAmount: finalPoolTotal,
            transactions: finalPool.transactions
          });

          return report;
        }, {
          syncOnCommit: true,
          syncOptions: {
            full: true,
            force: true,
            timeoutMs: 300000,
            maxAttempts: 2,
            retryDelayMs: 5000
          }
        });
      });
    } finally {
      this.releaseMatrixRebuildLock();
    }
  }

  static reconcileHelpTrackers(): HelpTrackerReconciliationReport {
    const report: HelpTrackerReconciliationReport = {
      scannedTrackers: 0,
      createdTrackers: 0,
      removedTrackers: 0,
      repairedLevels: 0,
      repairedQueueItems: 0,
      walletSyncs: 0,
      issues: []
    };

    const users = this.getUsers();
    const userIdSet = new Set(users.map(u => u.id));
    const rawTrackers = this.getHelpTrackers();
    report.scannedTrackers = rawTrackers.length;

    const now = new Date().toISOString();
    const cleanedTrackers: UserHelpTracker[] = [];
    const isValidDate = (v?: string) => !!v && !Number.isNaN(new Date(v).getTime());
    const toSafeNumber = (v: unknown) => {
      const num = Number(v);
      return Number.isFinite(num) ? num : 0;
    };

    for (const tracker of rawTrackers) {
      if (!userIdSet.has(tracker.userId)) {
        report.removedTrackers += 1;
        report.issues.push(`Removed tracker for missing userId: ${tracker.userId}`);
        continue;
      }

      const normalizedLevels: Record<string, LevelHelpTrackerState> = {};
      const rawLevels = tracker.levels || {};
      for (const [key, state] of Object.entries(rawLevels)) {
        const level = Number(key);
        if (!Number.isInteger(level) || level < 1 || level > helpDistributionTable.length) {
          report.repairedLevels += 1;
          report.issues.push(`Dropped invalid level "${key}" for userId: ${tracker.userId}`);
          continue;
        }

        const table = helpDistributionTable[level - 1];
        const leftEvents = Math.max(0, Math.floor(toSafeNumber(state.leftEvents)));
        const rightEvents = Math.max(0, Math.floor(toSafeNumber(state.rightEvents)));
        const maxEvents = Math.min(leftEvents + rightEvents, table.users);
        let matchedEvents = Math.max(0, Math.floor(toSafeNumber(state.matchedEvents)));
        if (matchedEvents > maxEvents) {
          matchedEvents = maxEvents;
          report.repairedLevels += 1;
        }

        let receiveEvents = Math.max(0, Math.floor(toSafeNumber(state.receiveEvents)));
        if (receiveEvents < matchedEvents) {
          receiveEvents = matchedEvents;
          report.repairedLevels += 1;
        }
        if (receiveEvents > maxEvents) {
          receiveEvents = maxEvents;
          report.repairedLevels += 1;
        }

        let giveEvents = Math.max(0, Math.floor(toSafeNumber(state.giveEvents)));
        if (giveEvents > 2) {
          giveEvents = 2;
          report.repairedLevels += 1;
        }
        if (giveEvents > receiveEvents) {
          giveEvents = receiveEvents;
          report.repairedLevels += 1;
        }

        normalizedLevels[String(level)] = {
          level,
          perUserHelp: table.perUserHelp,
          directRequired: this.getCumulativeDirectRequired(level),
          leftEvents,
          rightEvents,
          matchedEvents,
          receiveEvents,
          receivedAmount: Math.max(0, toSafeNumber(state.receivedAmount)),
          giveEvents,
          givenAmount: Math.max(0, toSafeNumber(state.givenAmount)),
          lockedAmount: Math.max(0, toSafeNumber(state.lockedAmount)),
          lockedReceiveAmount: Math.max(0, toSafeNumber((state as any).lockedReceiveAmount)),
          safetyDeducted: Math.max(0, toSafeNumber(state.safetyDeducted))
        };
      }

      const rawQueue = Array.isArray(tracker.lockedQueue) ? tracker.lockedQueue : [];
      const normalizedQueue: LockedGiveHelpItem[] = [];
      for (const item of rawQueue) {
        const level = Number(item.level);
        const amount = toSafeNumber(item.amount);
        if (!Number.isInteger(level) || level < 1 || level > helpDistributionTable.length || amount <= 0) {
          report.repairedQueueItems += 1;
          continue;
        }

        const status: LockedGiveHelpItem['status'] = item.status === 'released' ? 'released' : 'locked';
        const normalizedItem: LockedGiveHelpItem = {
          id: item.id || `lgh_repair_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          level,
          amount,
          fromUserId: item.fromUserId,
          createdAt: isValidDate(item.createdAt) ? item.createdAt : now,
          status
        };

        if (status === 'released') {
          normalizedItem.releasedAt = isValidDate(item.releasedAt) ? item.releasedAt : now;
        }

        normalizedQueue.push(normalizedItem);
      }

      const queueLockedByLevel = new Map<number, number>();
      for (const item of normalizedQueue) {
        if (item.status !== 'locked') continue;
        queueLockedByLevel.set(item.level, (queueLockedByLevel.get(item.level) || 0) + item.amount);
      }

      for (const [level, lockedAmount] of queueLockedByLevel.entries()) {
        const key = String(level);
        if (!normalizedLevels[key]) {
          const table = helpDistributionTable[level - 1];
          normalizedLevels[key] = {
            level,
            perUserHelp: table.perUserHelp,
            directRequired: this.getCumulativeDirectRequired(level),
            leftEvents: 0,
            rightEvents: 0,
            matchedEvents: 0,
            receiveEvents: 0,
            receivedAmount: 0,
            giveEvents: 0,
            givenAmount: 0,
            lockedAmount,
            lockedReceiveAmount: 0,
            safetyDeducted: 0
          };
          report.repairedLevels += 1;
        }
      }

      for (const [key, state] of Object.entries(normalizedLevels)) {
        const level = Number(key);
        const queueLockedAmount = queueLockedByLevel.get(level) || 0;
        const mergedLockedAmount = Math.max(state.lockedAmount || 0, queueLockedAmount);
        if (Math.abs(state.lockedAmount - mergedLockedAmount) > 0.0001) {
          state.lockedAmount = mergedLockedAmount;
          normalizedLevels[key] = state;
          report.repairedLevels += 1;
        }
      }

      cleanedTrackers.push({
        userId: tracker.userId,
        levels: normalizedLevels,
        lockedQueue: normalizedQueue
      });
    }

    const trackerUserSet = new Set(cleanedTrackers.map(t => t.userId));
    for (const user of users) {
      if (!trackerUserSet.has(user.id)) {
        cleanedTrackers.push({
          userId: user.id,
          levels: {},
          lockedQueue: []
        });
        trackerUserSet.add(user.id);
        report.createdTrackers += 1;
      }
    }

    this.saveHelpTrackers(cleanedTrackers);

    const trackerMap = new Map(cleanedTrackers.map(t => [t.userId, t]));
    const wallets = this.getWallets();
    let walletChanged = false;
    for (const wallet of wallets) {
      const tracker = trackerMap.get(wallet.userId);
      if (!tracker) continue;
      const queueLockedGiveTotal = tracker.lockedQueue
        .filter(i => i.status === 'locked')
        .reduce((sum, i) => sum + i.amount, 0);
      const levelLockedGiveTotal = Object.values(tracker.levels)
        .reduce((sum, state) => sum + (state.lockedAmount || 0), 0);
      const lockedGiveTotal = Math.max(queueLockedGiveTotal, levelLockedGiveTotal);
      const lockedIncomeTotal = Object.values(tracker.levels)
        .reduce((sum, state) => sum + (state.lockedReceiveAmount || 0) + (state.lockedAmount || 0), 0);

      if (Math.abs((wallet.giveHelpLocked || 0) - lockedGiveTotal) > 0.0001) {
        wallet.giveHelpLocked = lockedGiveTotal;
        walletChanged = true;
        report.walletSyncs += 1;
      }
      if (Math.abs((wallet.lockedIncomeWallet || 0) - lockedIncomeTotal) > 0.0001) {
        wallet.lockedIncomeWallet = lockedIncomeTotal;
        walletChanged = true;
        report.walletSyncs += 1;
      }
    }

    if (walletChanged) {
      this.saveWallets(wallets);
    }

    for (const user of users) {
      this.releaseLockedGiveHelp(user.id);
      this.releaseLockedReceiveHelp(user.id);
      this.syncUserAchievements(user.id);
    }

    return report;
  }

  static createWallet(userId: string): Wallet {
    const wallet: Wallet = {
      userId,
      depositWallet: 0,
      pinWallet: 0,
      incomeWallet: 0,
      matrixWallet: 0,
      lockedIncomeWallet: 0,
      giveHelpLocked: 0,
      totalReceived: 0,
      totalGiven: 0
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

    wallets[index] = { ...wallets[index], ...updates };
    this.saveWallets(wallets);
    return wallets[index];
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
    this.createTransaction({
      id: generateEventId('tx', 'pin_purchase'),
      userId: request.userId,
      type: 'pin_purchase',
      amount: -request.amount,
      status: 'completed',
      description: `Purchased ${request.quantity} PIN(s)`,
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
    return SUPPORT_TICKET_CATEGORIES.includes(candidate) ? candidate : 'technical_issues';
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
        .filter((item: SupportTicketAttachment) => item.data_url),
      created_at: String(raw?.created_at || raw?.createdAt || new Date().toISOString())
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
        .filter((item: SupportTicketAttachment) => item.data_url);

      const messageAttachments = messages.flatMap((msg: SupportTicketMessage) => msg.attachments);
      const attachmentsById = new Map<string, SupportTicketAttachment>();
      [...topLevelAttachments, ...messageAttachments].forEach((attachment) => {
        if (attachment.data_url) attachmentsById.set(attachment.id, attachment);
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
      .filter((attachment) => attachment.data_url);

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
      .filter((attachment) => attachment.data_url);

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
    tickets[index] = {
      ...tickets[index],
      status: this.normalizeSupportStatus(status),
      updated_at: now,
      admin_reply: options?.adminReply ? String(options.adminReply).trim() : tickets[index].admin_reply
    };
    this.saveSupportTickets(tickets);
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
    const timeoutMs = 15000;
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
    return [...this.STARTUP_REMOTE_SYNC_KEYS];
  }

  static getAdminRemoteSyncBatches(): string[][] {
    return this.ADMIN_REMOTE_SYNC_BATCHES.map((batch) => [...batch]);
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

          const heavyKeys = ['mlm_transactions', 'mlm_help_trackers', 'mlm_matrix', 'mlm_users', 'mlm_payments', 'mlm_wallets'];
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

  private static normalizeTransactionRecord(tx: Transaction): Transaction {
    const normalizedType = this.normalizeTransactionType((tx as any).type);
    if (normalizedType === (tx as any).type) return tx;
    return {
      ...tx,
      type: normalizedType as Transaction['type']
    };
  }

  static getTransactions(): Transaction[] {
    const transactions: Transaction[] = this.getCached<Transaction[]>(DB_KEYS.TRANSACTIONS, []);
    let changed = false;

    for (const tx of transactions) {
      const normalized = this.normalizeTransactionRecord(tx);
      if (normalized !== tx) {
        Object.assign(tx, normalized);
        changed = true;
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

  static getUserTransactions(userId: string): Transaction[] {
    const all = this.getTransactions();
    const indexed = all
      .map((tx, index) => ({ tx, index }))
      .filter(({ tx }) => tx.userId === userId);

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
    transactions.push(normalized);
    this.saveTransactions(transactions);
    return normalized;
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

  static findNextPosition(sponsorId: string): { parentId: string; position: 'left' | 'right' } | null {
    const matrix = this.getMatrix();
    // Build Map once — O(N) — then BFS with O(1) lookups.
    const nodeMap = new Map<string, MatrixNode>(matrix.map(m => [m.userId, m]));

    const queue: string[] = [sponsorId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentNode = nodeMap.get(currentId);

      if (!currentNode) continue;

      if (!currentNode.leftChild) {
        return { parentId: currentId, position: 'left' };
      }

      if (!currentNode.rightChild) {
        return { parentId: currentId, position: 'right' };
      }

      queue.push(currentNode.leftChild);
      queue.push(currentNode.rightChild);
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

  // ==================== NOTIFICATIONS ====================
  static getNotifications(): Notification[] {
    return this.getCached<Notification[]>(DB_KEYS.NOTIFICATIONS, []);
  }

  static saveNotifications(notifications: Notification[]): void {
    this.setCached(DB_KEYS.NOTIFICATIONS, notifications);
  }

  static getUserNotifications(userId: string): Notification[] {
    return this.getNotifications()
      .filter(n => n.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  static createNotification(notification: Notification): Notification {
    const notifications = this.getNotifications();
    notifications.push(notification);
    this.saveNotifications(notifications);
    return notification;
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
    return { ...defaultSettings, ...data };
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

    payments[index] = { ...payments[index], ...updates };
    this.savePayments(payments);

    if (updates.status === 'completed' && payments[index].status === 'completed') {
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

  static approvePayment(paymentId: string, adminId: string): Payment | null {
    const payment = this.getPayments().find(p => p.id === paymentId);
    if (!payment) return null;

    const updatedPayment = this.updatePayment(paymentId, {
      status: 'completed',
      verifiedAt: new Date().toISOString(),
      verifiedBy: adminId
    });

    return updatedPayment;
  }

  static rejectPayment(paymentId: string, adminId: string, reason: string): Payment | null {
    const payment = this.getPayments().find(p => p.id === paymentId);
    if (!payment) return null;

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
      const value = JSON.stringify(user);
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
      const fresh = parsed?.id ? this.getUserById(parsed.id) : undefined;
      return fresh || parsed;
    }

    // Backward compatibility for legacy sessions / fallback storage.
    const legacyData = this.getStorageItem(DB_KEYS.CURRENT_USER);
    if (!legacyData) return null;
    const parsed = JSON.parse(legacyData) as User;
    const fresh = parsed?.id ? this.getUserById(parsed.id) : undefined;
    return fresh || parsed;
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
        pinWallet: (existing.pinWallet || 0) + (wallet.pinWallet || 0),
        incomeWallet: (existing.incomeWallet || 0) + (wallet.incomeWallet || 0),
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
        pinWallet: 0,
        incomeWallet: 0,
        matrixWallet: 0,
        lockedIncomeWallet: 0,
        giveHelpLocked: 0,
        totalReceived: 0,
        totalGiven: 0
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
          lockedQueue: [...(tracker.lockedQueue || [])]
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
        lockedQueue: Array.from(queueById.values())
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
        email: 'admin@matrixmlm.com',
        password: 'admin123',
        fullName: 'System Administrator',
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
        blockedReason: null
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
        pinWallet: 0,
        incomeWallet: 0,
        matrixWallet: 0,
        lockedIncomeWallet: 0,
        giveHelpLocked: 0,
        totalReceived: 0,
        totalGiven: 0
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



