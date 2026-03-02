import type {
  User, Wallet, Transaction, MatrixNode, SafetyPoolTransaction,
  GracePeriod, Notification, AdminSettings, PaymentMethod, Payment,
  Pin, PinTransfer, OtpRecord, PinPurchaseRequest, EmailLog,
  ImpersonationSession
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
  { level: 1, users: 2, perUserHelp: 5, totalGetHelp: 10, giveHelp: 10, netBalance: 0, directRequired: 0, qualifiedGetHelp: 10, unqualifiedCarryForward: 0 },
  { level: 2, users: 4, perUserHelp: 10, totalGetHelp: 40, giveHelp: 20, netBalance: 20, directRequired: 2, qualifiedGetHelp: 40, unqualifiedCarryForward: 0 },
  { level: 3, users: 8, perUserHelp: 20, totalGetHelp: 160, giveHelp: 40, netBalance: 120, directRequired: 3, qualifiedGetHelp: 160, unqualifiedCarryForward: 0 },
  { level: 4, users: 16, perUserHelp: 40, totalGetHelp: 640, giveHelp: 80, netBalance: 560, directRequired: 4, qualifiedGetHelp: 640, unqualifiedCarryForward: 0 },
  { level: 5, users: 32, perUserHelp: 80, totalGetHelp: 2560, giveHelp: 160, netBalance: 2400, directRequired: 5, qualifiedGetHelp: 2560, unqualifiedCarryForward: 0 },
  { level: 6, users: 64, perUserHelp: 160, totalGetHelp: 10240, giveHelp: 320, netBalance: 9920, directRequired: 10, qualifiedGetHelp: 10240, unqualifiedCarryForward: 0 },
  { level: 7, users: 128, perUserHelp: 320, totalGetHelp: 40960, giveHelp: 640, netBalance: 40320, directRequired: 20, qualifiedGetHelp: 40960, unqualifiedCarryForward: 0 },
  { level: 8, users: 256, perUserHelp: 640, totalGetHelp: 163840, giveHelp: 1280, netBalance: 162560, directRequired: 40, qualifiedGetHelp: 163840, unqualifiedCarryForward: 0 },
  { level: 9, users: 512, perUserHelp: 1280, totalGetHelp: 655360, giveHelp: 2560, netBalance: 652800, directRequired: 80, qualifiedGetHelp: 655360, unqualifiedCarryForward: 0 },
  { level: 10, users: 1024, perUserHelp: 2560, totalGetHelp: 2621440, giveHelp: 5120, netBalance: 2616320, directRequired: 100, qualifiedGetHelp: 2621440, unqualifiedCarryForward: 0 }
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

// Generic DB Operations
class Database {
  private static readonly REMOTE_SYNC_BASE_URL = (
    (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_BACKEND_URL || 'http://localhost:4000'
  ).replace(/\/+$/, '');
  private static readonly REMOTE_SYNC_KEYS = new Set<string>(
    Object.values(DB_KEYS).filter((key) => key !== DB_KEYS.CURRENT_USER && key !== DB_KEYS.SESSION)
  );
  private static remoteSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private static remoteSyncInFlight = false;
  private static remoteSyncQueued = false;
  // When true, createTransaction/addToSafetyPool become no-ops to save memory
  static _bulkRebuildMode = false;
  private static _bulkSafetyPoolTotal = 0;

  // ===== In-memory parsed-object cache =====
  // Eliminates redundant JSON.parse() on hot-path reads.
  private static _cache = new Map<string, unknown>();

  /** Return cached parsed value or parse from localStorage and cache it. */
  private static getCached<T>(key: string, fallback: T): T {
    if (this._cache.has(key)) return this._cache.get(key) as T;
    const raw = localStorage.getItem(key);
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

  private static shouldSyncKey(key: string): boolean {
    return this.REMOTE_SYNC_KEYS.has(key);
  }

  private static getRemoteSyncEndpoint(): string {
    return `${this.REMOTE_SYNC_BASE_URL}/api/state`;
  }

  private static getPersistedSnapshot(): Record<string, string> {
    const state: Record<string, string> = {};
    for (const key of this.REMOTE_SYNC_KEYS) {
      const value = localStorage.getItem(key);
      if (typeof value === 'string') {
        state[key] = value;
      }
    }
    return state;
  }

  private static hasLocalPersistedData(): boolean {
    for (const key of this.REMOTE_SYNC_KEYS) {
      if (localStorage.getItem(key) !== null) {
        return true;
      }
    }
    return false;
  }

  private static setStorageItem(key: string, value: string): void {
    localStorage.setItem(key, value);
    // Don't invalidate here — callers using setCached() already updated the cache.
    // Only sync remote.
    if (this.shouldSyncKey(key)) {
      this.scheduleRemoteSync();
    }
  }

  private static removeStorageItem(key: string): void {
    localStorage.removeItem(key);
    this.invalidateCache(key);
    if (this.shouldSyncKey(key)) {
      this.scheduleRemoteSync();
    }
  }

  private static scheduleRemoteSync(): void {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      return;
    }

    if (this.remoteSyncTimer) {
      clearTimeout(this.remoteSyncTimer);
    }

    this.remoteSyncTimer = setTimeout(() => {
      this.remoteSyncTimer = null;
      void this.flushRemoteSync();
    }, 250);
  }

  private static async flushRemoteSync(): Promise<void> {
    if (this.remoteSyncInFlight) {
      this.remoteSyncQueued = true;
      return;
    }

    this.remoteSyncInFlight = true;
    try {
      const response = await fetch(this.getRemoteSyncEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: this.getPersistedSnapshot() })
      });
      if (!response.ok) {
        throw new Error(`Remote sync failed with HTTP ${response.status}`);
      }
    } catch {
      console.warn('[DB Sync] Failed to push local state to backend. App will continue locally.');
    } finally {
      this.remoteSyncInFlight = false;
      if (this.remoteSyncQueued) {
        this.remoteSyncQueued = false;
        void this.flushRemoteSync();
      }
    }
  }

  static async hydrateFromServer(): Promise<void> {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      return;
    }

    try {
      const response = await fetch(this.getRemoteSyncEndpoint(), { method: 'GET' });
      if (!response.ok) {
        console.warn(`[DB Sync] Failed to load state from backend (HTTP ${response.status}). Using local browser state.`);
        return;
      }

      const payload = await response.json() as { state?: Record<string, unknown> };
      const serverState = payload?.state && typeof payload.state === 'object' ? payload.state : {};
      const hasServerState = Object.keys(serverState).length > 0;

      if (hasServerState) {
        for (const key of this.REMOTE_SYNC_KEYS) {
          const value = serverState[key];
          if (typeof value === 'string') {
            localStorage.setItem(key, value);
          } else {
            localStorage.removeItem(key);
          }
        }
        this.invalidateAllCaches();
        return;
      }

      if (this.hasLocalPersistedData()) {
        const pushResponse = await fetch(this.getRemoteSyncEndpoint(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: this.getPersistedSnapshot() })
        });
        if (!pushResponse.ok) {
          console.warn(`[DB Sync] Failed to seed backend from local state (HTTP ${pushResponse.status}).`);
        }
      }
    } catch {
      console.warn('[DB Sync] Backend unavailable during startup. Using local browser state.');
    }
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

  static getUserByUserId(userId: string): User | undefined {
    return this.getUsers().find(u => u.userId === userId);
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
    const wallets: Wallet[] = this.getCached<Wallet[]>(DB_KEYS.WALLETS, []);
    const normalized = wallets.map((w) => ({
      ...w,
      matrixWallet: w.matrixWallet ?? 0,
      lockedIncomeWallet: w.lockedIncomeWallet ?? 0
    }));
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
        tx.type === 'get_help'
        && tx.amount > 0
        && (desc.startsWith('locked first-two help at level') || desc.startsWith('locked receive help at level'))
      ) {
        locked += tx.amount;
        continue;
      }
      if (tx.type === 'get_help' && tx.amount > 0 && desc.startsWith('released locked receive help at level')) {
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
      switch (tx.type) {
        case 'direct_income':
        case 'level_income':
          incomeWallet += tx.amount;
          matrixWallet += tx.amount;
          if (tx.amount > 0) totalReceived += tx.amount;
          relevantCount += 1;
          break;
        case 'get_help': {
          const desc = (tx.description || '').toLowerCase();
          const isLockedReceive = desc.startsWith('locked receive help at level')
            || desc.startsWith('locked first-two help at level');
          if (!isLockedReceive) {
            incomeWallet += tx.amount;
            matrixWallet += tx.amount;
            if (tx.amount > 0) totalReceived += tx.amount;
          }
          relevantCount += 1;
          break;
        }
        case 'give_help':
          if (
            !(tx.description || '').toLowerCase().includes('from locked income')
            && !(tx.description || '').toLowerCase().includes('from matrix contribution')
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
        case 'admin_credit':
          if ((tx.description || '').toLowerCase().includes('income wallet')) {
            incomeWallet += tx.amount;
            if (tx.amount > 0) totalReceived += tx.amount;
            relevantCount += 1;
          }
          break;
        case 'admin_debit':
          if ((tx.description || '').toLowerCase().includes('income wallet')) {
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
    const nodeMap = new Map(matrix.map((node) => [node.userId, node]));
    const rootNode = nodeMap.get(user.userId);
    if (!rootNode) return trackerLevel;

    let matrixDepthLevel = 0;
    const queue: Array<{ nodeUserId: string; depth: number }> = [];

    if (rootNode.leftChild) queue.push({ nodeUserId: rootNode.leftChild, depth: 1 });
    if (rootNode.rightChild) queue.push({ nodeUserId: rootNode.rightChild, depth: 1 });

    while (queue.length > 0) {
      const current = queue.shift()!;
      matrixDepthLevel = Math.max(matrixDepthLevel, current.depth);

      const node = nodeMap.get(current.nodeUserId);
      if (!node) continue;

      if (node.leftChild) queue.push({ nodeUserId: node.leftChild, depth: current.depth + 1 });
      if (node.rightChild) queue.push({ nodeUserId: node.rightChild, depth: current.depth + 1 });
    }

    const cappedMatrixLevel = Math.min(matrixDepthLevel, helpDistributionTable.length);
    return Math.max(trackerLevel, cappedMatrixLevel);
  }

  static getQualifiedLevel(userId: string): number {
    const user = this.getUserById(userId);
    if (!user) return 0;

    let qualifiedLevel = 0;
    for (const levelData of helpDistributionTable) {
      if (!this.isQualifiedForLevel(user, levelData.level)) break;
      qualifiedLevel = levelData.level;
    }

    return qualifiedLevel;
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

    for (const tx of txs) {
      const level = this.resolveTransactionLevel(tx);
      if (!level) continue;
      const desc = (tx.description || '').toLowerCase();
      const slot = ensureTxLevel(level);

      if (tx.type === 'get_help' && tx.amount > 0) {
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
        slot.firstTwo -= Math.abs(tx.amount);
      }
    }

    for (const levelData of helpDistributionTable) {
      const level = levelData.level;
      const state = tracker.levels[String(level)];
      const txDerived = txLevelMap.get(level) || { firstTwo: 0, qualification: 0 };
      const trackerFirstTwo = state?.lockedAmount || 0;
      const trackerQualification = state?.lockedReceiveAmount || 0;
      const lockedFirstTwoAmount = Math.max(0, Math.max(trackerFirstTwo, txDerived.firstTwo));
      const lockedQualificationAmount = Math.max(0, Math.max(trackerQualification, txDerived.qualification));
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
        reasons.push(`Locked because first two helps at this level are reserved for auto give-help settlement.`);
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

  private static isLevelCompleteForTracker(tracker: UserHelpTracker, level: number): boolean {
    const state = tracker.levels[String(level)];
    const levelData = helpDistributionTable[level - 1];
    if (!state || !levelData) return false;
    return state.receiveEvents >= levelData.users;
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

    if (!next.nationalTour && this.isLevelCompleteForTracker(tracker, 5)) {
      next.nationalTour = true;
      next.nationalTourDate = now;
      changed = true;
    }
    if (!next.internationalTour && this.isLevelCompleteForTracker(tracker, 7)) {
      next.internationalTour = true;
      next.internationalTourDate = now;
      changed = true;
    }
    if (!next.familyTour && this.isLevelCompleteForTracker(tracker, 10)) {
      next.familyTour = true;
      next.familyTourDate = now;
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
    const prefix = `locked first-two help at level ${level}`;
    return this.getTransactions().filter((tx) =>
      tx.userId === userId
      && tx.type === 'get_help'
      && tx.amount > 0
      && (tx.description || '').toLowerCase().startsWith(prefix)
    ).length;
  }

  private static canReceiveAtLevel(userId: string, level: number): boolean {
    const levelData = helpDistributionTable[level - 1];
    if (!levelData) return false;
    const tracker = this.getUserHelpTracker(userId);
    const state = this.ensureLevelTrackerState(tracker, level);
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

    const recipientLevel = Math.min(
      helpDistributionTable.length,
      Math.max(1, Math.floor(level || 1))
    );

    while (remaining > 0.0001) {
      const senderWallet = this.getWallet(userId);
      if (!senderWallet) break;

      const senderMatrixWallet = senderWallet.matrixWallet || 0;
      const senderLockedIncomeWallet = senderWallet.lockedIncomeWallet || 0;
      const sourceAvailable = useLockedIncome
        ? senderLockedIncomeWallet
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

        this.createTransaction({
          id: `tx_${Date.now()}_give_help_${level}`,
          userId,
          type: 'give_help',
          amount: -safetyAmount,
          level,
          status: 'completed',
          description: `${description} to safety pool`,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
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

      this.createTransaction({
        id: `tx_${Date.now()}_give_help_${recipientLevel}`,
        userId,
        type: 'give_help',
        amount: -transferAmount,
        toUserId: recipient.id,
        level: recipientLevel,
        status: 'completed',
        description: `${description} to ${recipient.fullName} (${recipient.userId})`,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
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
          id: `tx_${Date.now()}_upline_help_locked_first_two_${recipientLevel}`,
          userId: recipient.id,
          type: 'get_help',
          amount: transferAmount,
          fromUserId: userId,
          level: recipientLevel,
          status: 'completed',
          description: `Locked first-two help at level ${recipientLevel}${fromSuffix}`,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        });

        if (lockedFirstTwoCount + 1 === 2 && recipientState.lockedAmount > 0) {
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
      } else if (receiveIndex % 5 === 0) {
        this.addToSafetyPool(transferAmount, recipient.id, `Every 5th help deduction at level ${recipientLevel}`);
        this.createTransaction({
          id: `tx_${Date.now()}_upline_help_safety_${recipientLevel}`,
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
          id: `tx_${Date.now()}_upline_help_${recipientLevel}`,
          userId: recipient.id,
          type: 'get_help',
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
          id: `tx_${Date.now()}_upline_help_locked_${recipientLevel}`,
          userId: recipient.id,
          type: 'get_help',
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

  private static consumeLockedIncomeAcrossLevels(
    tracker: UserHelpTracker,
    preferredLevel: number,
    amount: number
  ): {
    success: boolean;
    consumedFromLockedAmount: number;
    consumedFromLockedReceiveAmount: number;
  } {
    let remaining = Math.max(0, amount);
    let consumedFromLockedAmount = 0;
    let consumedFromLockedReceiveAmount = 0;

    const levels = Object.keys(tracker.levels)
      .map((k) => Number(k))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= helpDistributionTable.length)
      .sort((a, b) => a - b);
    const ordered = [preferredLevel, ...levels.filter((l) => l !== preferredLevel)];

    for (const level of ordered) {
      if (remaining <= 0) break;
      const key = String(level);
      const state = tracker.levels[key];
      if (!state) continue;

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
    }

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

      const consumed = this.consumeLockedIncomeAcrossLevels(fromTracker, level, amount);
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
        id: `tx_${Date.now()}_matrix_locked_give_${level}`,
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
        id: `tx_${Date.now()}_receive_help_${level}`,
        userId: user.id,
        type: 'get_help',
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
        id: `tx_${Date.now()}_receive_help_5th_${level}`,
        userId: user.id,
        type: 'get_help',
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
        id: `tx_${Date.now()}_level_safety_${level}`,
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
        id: `tx_${Date.now()}_receive_help_${level}`,
        userId: user.id,
        type: 'get_help',
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
        id: `tx_${Date.now()}_receive_help_locked_${level}`,
        userId: user.id,
        type: 'get_help',
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
      const transferred = this.executeGiveHelp(
        user.id,
        pendingAmount,
        item.level,
        `Released locked give help at level ${item.level} from locked income`,
        { useLockedIncome: true }
      );
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
        id: `tx_${Date.now()}_release_receive_${level}`,
        userId,
        type: 'get_help',
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
    if (tx.type === 'get_help' || tx.type === 'give_help') {
      return true;
    }
    if (tx.type === 'level_income' && (tx.description || '').startsWith('Helping amount from ')) {
      return true;
    }
    if (tx.type === 'safety_pool' && tx.description?.startsWith('Every 5th help deduction at level')) {
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
        id: `tx_${Date.now()}_backfill_activation_${member.userId}`,
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
            id: `tx_${Date.now()}_backfill_direct_${member.userId}`,
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
    onProgress?: (done: number, total: number) => void
  ): Promise<MatrixLogicRebuildReport> {
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

      const shouldAutoActivate = !next.isAdmin && next.accountStatus !== 'temp_blocked' && next.accountStatus !== 'permanent_blocked';
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

    // Enable bulk rebuild mode: skip creating transaction records to save memory
    this._bulkRebuildMode = true;
    this._bulkSafetyPoolTotal = 0;
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
      // Disable bulk rebuild mode
      this._bulkRebuildMode = false;
    }

    // Write the accumulated safety pool total
    const currentPool = this.getSafetyPool();
    currentPool.totalAmount += this._bulkSafetyPoolTotal;
    this.saveSafetyPool(currentPool);

    report.reconciliation = this.reconcileHelpTrackers();
    const finalPool = this.getSafetyPool();
    const finalPoolTotal = finalPool.transactions.reduce((sum, tx) => sum + tx.amount, 0) + this._bulkSafetyPoolTotal;
    this.saveSafetyPool({
      totalAmount: finalPoolTotal,
      transactions: finalPool.transactions
    });

    // Single sync at the end (instead of thousands during rebuild)
    this.scheduleRemoteSync();

    return report;
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
      fundWallet: 0,
      getHelpWallet: 0,
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
    const data = localStorage.getItem(DB_KEYS.PIN_TRANSFERS);
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
    const data = localStorage.getItem(DB_KEYS.PIN_PURCHASE_REQUESTS);
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
      id: `tx_${Date.now()}_pin_purchase`,
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
        id: `tx_${Date.now()}_pin_relock`,
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

  // ==================== OTP RECORDS ====================
  static getOtpRecords(): OtpRecord[] {
    const data = localStorage.getItem(DB_KEYS.OTP_RECORDS);
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
    const data = localStorage.getItem(DB_KEYS.EMAIL_LOGS);
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
  static getTransactions(): Transaction[] {
    const transactions: Transaction[] = this.getCached<Transaction[]>(DB_KEYS.TRANSACTIONS, []);
    let changed = false;

    for (const tx of transactions) {
      if (tx.type !== 'get_help') continue;
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
    this.setCached(DB_KEYS.TRANSACTIONS, transactions);
  }

  static getUserTransactions(userId: string): Transaction[] {
    return this.getTransactions()
      .filter(t => t.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  static createTransaction(transaction: Transaction): Transaction {
    // In bulk rebuild mode, skip creating transaction records to save memory
    if (this._bulkRebuildMode) return transaction;
    const transactions = this.getTransactions();
    transactions.push(transaction);
    this.saveTransactions(transactions);
    return transaction;
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
    const downline: MatrixNode[] = [];

    const findDownline = (parentId: string, depth: number) => {
      if (depth > maxDepth) return;
      const children = matrix.filter(m => m.parentId === parentId);
      for (const child of children) {
        downline.push(child);
        findDownline(child.userId, depth + 1);
      }
    };

    findDownline(userId, 1);
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

      const node = nodeMap.get(nodeId);
      if (!node) return { total: 0, active: 0 };

      let total = 1;
      let active = node.isActive ? 1 : 0;

      if (node.leftChild) {
        const leftCounts = countTeam(node.leftChild);
        total += leftCounts.total;
        active += leftCounts.active;
      }
      if (node.rightChild) {
        const rightCounts = countTeam(node.rightChild);
        total += rightCounts.total;
        active += rightCounts.active;
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
      id: `sp_${Date.now()}`,
      amount,
      fromUserId,
      reason,
      createdAt: new Date().toISOString()
    });
    this.saveSafetyPool(pool);
  }

  // ==================== GRACE PERIODS ====================
  static getGracePeriods(): GracePeriod[] {
    const data = localStorage.getItem(DB_KEYS.GRACE_PERIODS);
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
    const data = localStorage.getItem(DB_KEYS.PAYMENT_METHODS);
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
    const data = localStorage.getItem(DB_KEYS.PAYMENTS);
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
          id: `tx_${Date.now()}_deposit`,
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
    const data = localStorage.getItem(DB_KEYS.IMPERSONATION);
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
      if (tabSession) {
        tabSession.setItem(DB_KEYS.CURRENT_USER, JSON.stringify(user));
      } else {
        localStorage.setItem(DB_KEYS.CURRENT_USER, JSON.stringify(user));
      }
      // Remove legacy global user session so tabs stop overriding each other.
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

    // Backward compatibility for legacy sessions stored in localStorage.
    const legacyData = localStorage.getItem(DB_KEYS.CURRENT_USER);
    if (!legacyData) return null;
    if (tabSession) {
      tabSession.setItem(DB_KEYS.CURRENT_USER, legacyData);
    }
    const parsed = JSON.parse(legacyData) as User;
    const fresh = parsed?.id ? this.getUserById(parsed.id) : undefined;
    return fresh || parsed;
  }

  // ==================== STATS ====================
  static getStats() {
    const users = this.getUsers();
    const wallets = this.getWallets();
    const pool = this.getSafetyPool();
    const transactions = this.getTransactions();

    const activeUsers = users.filter(u => u.isActive).length;
    const totalHelpDistributed = transactions
      .filter(t => t.type === 'get_help' && t.status === 'completed')
      .reduce((sum, t) => sum + t.amount, 0);

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
      const getHelpAmount = userTransactions
        .filter(t => t.type === 'get_help' && t.status === 'completed')
        .reduce((sum, t) => sum + t.amount, 0);
      const giveHelpAmount = userTransactions
        .filter(t => t.type === 'give_help' && t.status === 'completed')
        .reduce((sum, t) => sum + t.amount, 0);

      // Qualification uses cumulative direct requirement: 0, 2, 5, 9, 14...
      const isQualified = userLevel <= 0 ? true : this.isQualifiedForLevel(user, userLevel);

      reports.push({
        level: userLevel,
        userId: user.userId,
        fullName: user.fullName,
        sponsorId: user.sponsorId || '-',
        getHelpAmount,
        giveHelpAmount,
        netAmount: getHelpAmount - giveHelpAmount,
        isQualified,
        directCount: user.directCount,
        date: user.activatedAt || user.createdAt
      });
    }

    return reports.sort((a, b) => a.level - b.level || a.userId.localeCompare(b.userId));
  }

  // ==================== INITIALIZATION ====================
  static initializeDemoData(): void {
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

    const settingsData = localStorage.getItem(DB_KEYS.SETTINGS);
    if (!settingsData) {
      this.saveSettings(defaultSettings);
    }

    const paymentMethodData = localStorage.getItem(DB_KEYS.PAYMENT_METHODS);
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

    const normalizedAdmins = adminUsers.map((u) => ({
      ...u,
      isAdmin: true,
      isActive: true,
      accountStatus: 'active' as const,
      blockedAt: null,
      blockedUntil: null,
      blockedReason: null,
      sponsorId: null,
      parentId: null,
      position: null
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
        fundWallet: 0,
        getHelpWallet: 0,
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
  getHelpAmount: number;
  giveHelpAmount: number;
  netAmount: number;
  isQualified: boolean;
  directCount: number;
  date: string;
}
