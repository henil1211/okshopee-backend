import { create } from 'zustand';
import type {
  User, Wallet, Transaction, MatrixNode, Notification,
  AdminSettings, DashboardStats, Pin, PinTransfer, PinPurchaseRequest, RegisterData, PaymentMethodType
} from '@/types';
import Database from '@/db';
import { isValidPhoneNumber, normalizePhoneNumber } from '@/utils/helpers';

type SystemEmailPurpose = 'otp' | 'welcome' | 'system';

async function dispatchSystemEmail(params: {
  to: string;
  subject: string;
  body: string;
  purpose: SystemEmailPurpose;
  metadata?: Record<string, string>;
  timeoutMs?: number;
}): Promise<{ success: boolean; mode: 'api' | 'local'; error?: string }> {
  const logId = `email_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  Database.createEmailLog({
    id: logId,
    to: params.to,
    subject: params.subject,
    body: params.body,
    purpose: params.purpose,
    provider: 'local',
    status: 'queued',
    createdAt: new Date().toISOString(),
    metadata: params.metadata
  });

  const env = (import.meta as { env?: Record<string, string | boolean | undefined> }).env || {};
  const configuredMailApi = typeof env.VITE_MAIL_API_URL === 'string' ? env.VITE_MAIL_API_URL.trim() : '';
  const backendBase = typeof env.VITE_BACKEND_URL === 'string' ? env.VITE_BACKEND_URL.trim() : '';
  const isProd = env.PROD === true || env.PROD === 'true';
  const backendMailApi = backendBase ? `${backendBase.replace(/\/+$/, '')}/api/send-mail` : '';
  const localhostApi = 'http://127.0.0.1:4000/api/send-mail';
  // Only use the same-origin URL if no backend URL is configured at all
  const hasExplicitBackend = !!(configuredMailApi || backendMailApi);
  const sameOriginApi = !hasExplicitBackend && typeof window !== 'undefined' ? `${window.location.origin.replace(/\/+$/, '')}/api/send-mail` : '';
  const requestTimeoutMs = Number.isFinite(Number(params.timeoutMs)) ? Math.max(1500, Number(params.timeoutMs)) : 8000;
  const candidates = [configuredMailApi, backendMailApi, sameOriginApi, !isProd ? localhostApi : ''].filter(Boolean);
  const seen = new Set<string>();
  const apiUrls = candidates.filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });

  if (apiUrls.length === 0) {
    const message = 'Mail API URL is not configured';
    Database.updateEmailLog(logId, { status: 'failed', provider: 'local', error: message });
    return { success: false, mode: 'local', error: message };
  }

  let firstError = '';
  for (const apiUrl of apiUrls) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), requestTimeoutMs);
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller?.signal,
        body: JSON.stringify({
          to: params.to,
          subject: params.subject,
          text: params.body,
          body: params.body,
          purpose: params.purpose,
          metadata: params.metadata
        })
      });

      const payload = await response.json().catch(() => ({} as Record<string, unknown>));
      if (!response.ok || payload?.ok === false) {
        const err =
          typeof payload?.error === 'string'
            ? payload.error
            : typeof payload?.message === 'string'
              ? payload.message
              : `HTTP ${response.status}`;
        throw new Error(err);
      }

      Database.updateEmailLog(logId, { status: 'sent', provider: 'api' });
      return { success: true, mode: 'api' };
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? (error.name === 'AbortError' ? `Email API timeout after ${requestTimeoutMs}ms` : error.message)
          : 'Unknown email error';
      if (!firstError) firstError = msg;
    } finally {
      clearTimeout(timeout);
    }
  }

  const resolvedError = firstError || 'Email API request failed';
  Database.updateEmailLog(logId, { status: 'failed', provider: 'api', error: resolvedError });
  return { success: false, mode: 'api', error: resolvedError };
}

// Auth Store - Updated with PIN-based registration
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  impersonatedUser: User | null; // For admin impersonation
  login: (userId: string, password: string) => Promise<{ success: boolean; message: string }>;
  adminLoginAsUser: (targetUserId: string, masterPassword: string) => Promise<{ success: boolean; message: string }>;
  endImpersonation: () => void;
  register: (userData: RegisterData) => Promise<{ success: boolean; message: string; userId?: string }>;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  verifyTransactionPassword: (userId: string, transactionPassword: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: Database.getCurrentUser(),
  isAuthenticated: !!Database.getCurrentUser(),
  isLoading: false,
  impersonatedUser: null,

  login: async (userId: string, password: string) => {
    if (import.meta.env.PROD) {
      const backendAuth = await Database.authenticateUserViaBackend(userId, password);
      if (!backendAuth.success || !backendAuth.user) {
        return { success: false, message: backendAuth.message };
      }
      Database.setCurrentUser(backendAuth.user);
      set({ user: backendAuth.user, isAuthenticated: true });
      void Database.hydrateFromServer({
        strict: true,
        maxAttempts: 2,
        timeoutMs: 45000,
        retryDelayMs: 1500,
        keys: Database.getStartupRemoteSyncKeys()
      }).catch((error) => {
        console.warn('Post-login hydration failed:', error);
      });
      return { success: true, message: backendAuth.message };
    }

    const syncStatusBeforeLogin = Database.getRemoteSyncStatus();
    let user = Database.getUserByUserId(userId);
    if (!user || syncStatusBeforeLogin.state !== 'synced') {
      try {
        await Database.hydrateFromServer({
          strict: true,
          maxAttempts: 3,
          timeoutMs: 45000,
          retryDelayMs: 1500
        });
      } catch {
        // Retry lookup below. If hydration still fails, return a sync-specific message instead of a false "not found".
      }
      user = Database.getUserByUserId(userId);
    }
    if (!user) {
      const syncStatus = Database.getRemoteSyncStatus();
      if (syncStatus.state !== 'synced') {
        return { success: false, message: 'Server data is still syncing. Please wait a moment and try again.' };
      }
      return { success: false, message: 'User ID not found' };
    }
    if (user.accountStatus === 'permanent_blocked') {
      return { success: false, message: `Account permanently blocked${user.blockedReason ? `: ${user.blockedReason}` : ''}` };
    }
    if (user.accountStatus === 'temp_blocked') {
      const blockedUntil = user.blockedUntil ? new Date(user.blockedUntil) : null;
      if (blockedUntil && blockedUntil > new Date()) {
        return {
          success: false,
          message: `Account temporarily blocked until ${blockedUntil.toLocaleString()}${user.blockedReason ? `: ${user.blockedReason}` : ''}`
        };
      }
      const unblocked = Database.unblockUser(user.id);
      if (unblocked) {
        user = unblocked;
      }
    }
    if (!user.isActive) {
      return { success: false, message: 'Account is inactive. Contact admin.' };
    }
    if (user.password !== password) {
      return { success: false, message: 'Invalid password' };
    }
    Database.setCurrentUser(user);
    set({ user, isAuthenticated: true });
    return { success: true, message: 'Login successful' };
  },

  // Admin master password login as any user
  adminLoginAsUser: async (targetUserId: string, masterPassword: string) => {
    const settings = Database.getSettings();
    const adminUser = get().user;

    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can impersonate users' };
    }

    if (masterPassword !== settings.masterPassword) {
      return { success: false, message: 'Invalid master password' };
    }

    const targetUser = Database.getUserByUserId(targetUserId);
    if (!targetUser) {
      return { success: false, message: 'Target user not found' };
    }

    // Start impersonation session
    Database.startImpersonation({
      adminId: adminUser.id,
      adminUserId: adminUser.userId,
      targetUserId: targetUser.id,
      targetUserName: targetUser.fullName,
      startedAt: new Date().toISOString(),
      isActive: true
    });

    set({ impersonatedUser: targetUser });
    return { success: true, message: `Now logged in as ${targetUser.fullName}` };
  },

  endImpersonation: () => {
    const adminUser = get().user;
    if (adminUser) {
      Database.endImpersonation(adminUser.id);
    }
    set({ impersonatedUser: null });
  },

  register: async (userData: RegisterData) => {
    const registrationGate = Database.getSensitiveActionSyncGate();
    if (!registrationGate.allowed) {
      return { success: false, message: registrationGate.message };
    }

    const { fullName, email, password, transactionPassword, phone, country, sponsorId, pinCode } = userData;
    const normalizedPhone = normalizePhoneNumber(phone);

    // Check if email exists
    if (Database.getUserByEmail(email)) {
      return { success: false, message: 'Email already exists' };
    }

    if (!isValidPhoneNumber(phone)) {
      return { success: false, message: 'Enter a valid mobile number' };
    }

    const phoneExists = Database.getUsers().some(
      (existing) => normalizePhoneNumber(existing.phone) === normalizedPhone
    );
    if (phoneExists) {
      return { success: false, message: 'Mobile number already exists' };
    }

    // Validate PIN - MANDATORY
    if (!pinCode) {
      return { success: false, message: 'PIN is required for registration' };
    }

    const pin = Database.getPinByCode(pinCode);
    if (!pin) {
      return { success: false, message: 'Invalid PIN code' };
    }
    if (pin.status === 'suspended') {
      return { success: false, message: 'PIN is suspended by admin' };
    }
    if (pin.status !== 'unused') {
      return { success: false, message: 'PIN has already been used' };
    }

    // Validate sponsor if provided
    let sponsor = null;
    if (sponsorId) {
      sponsor = Database.getUserByUserId(sponsorId);
      if (!sponsor) {
        return { success: false, message: 'Invalid Sponsor ID' };
      }
      if (!sponsor.isActive || sponsor.accountStatus !== 'active') {
        return { success: false, message: 'Sponsor account is inactive or blocked' };
      }
    }

    // Generate unique 7-digit ID
    const newUserId = Database.generateUniqueUserId();

    // Find placement in matrix (Top to Bottom, Left to Right)
    let parentId: string | null = null;
    let position: 'left' | 'right' | null = null;

    if (sponsor) {
      const placement = Database.findNextPosition(sponsor.userId);
      if (placement) {
        parentId = placement.parentId;
        position = placement.position;
      }
    }

    // User "level" tracks plan progress (starts at 0). Matrix depth is tracked separately on matrix nodes.
    const matrixDepthLevel = parentId ? (Database.getMatrixNode(parentId)?.level || 0) + 1 : 0;

    // Create new user - ACTIVE immediately with PIN
    const newUser: User = {
      id: `user_${Date.now()}`,
      userId: newUserId,
      email,
      password,
      fullName,
      phone: normalizedPhone,
      country,
      isActive: true, // Active immediately with PIN
      isAdmin: false,
      accountStatus: 'active',
      blockedAt: null,
      blockedUntil: null,
      blockedReason: null,
      createdAt: new Date().toISOString(),
      activatedAt: new Date().toISOString(), // Activated immediately
      gracePeriodEnd: null,
      sponsorId: sponsor?.userId || null,
      parentId,
      position,
      level: 0,
      directCount: 0,
      totalEarnings: 0,
      isCapped: false,
      capLevel: 0,
      reEntryCount: 0,
      cycleCount: 0,
      requiredDirectForNextLevel: 2,
      completedDirectForCurrentLevel: 0,
      transactionPassword, // Store transaction password
      emailVerified: false, // Will be verified via OTP
      achievements: {
        nationalTour: false,
        internationalTour: false,
        familyTour: false
      }
    };

    Database.createUser(newUser);

    // Use the PIN for this registration
    Database.consumePin(pinCode, newUser.id);

    // Add to matrix
    const matrixNode: MatrixNode = {
      userId: newUserId,
      username: fullName,
      level: matrixDepthLevel,
      position: position === 'left' ? 0 : 1,
      parentId: parentId || undefined,
      isActive: true
    };
    Database.addMatrixNode(matrixNode);

    // Update parent's child reference
    if (parentId && position) {
      const matrix = Database.getMatrix();
      const parentNode = matrix.find(m => m.userId === parentId);
      if (parentNode) {
        if (position === 'left') {
          parentNode.leftChild = newUserId;
        } else {
          parentNode.rightChild = newUserId;
        }
        Database.saveMatrix(matrix);
      }
    }

    // Update sponsor's direct count
    if (sponsor) {
      Database.updateUser(sponsor.id, {
        directCount: sponsor.directCount + 1
      });
      Database.releaseLockedGiveHelp(sponsor.id);
      Database.releaseLockedReceiveHelp(sponsor.id);
    }

    // Create PIN usage transaction
    Database.createTransaction({
      id: `tx_${Date.now()}_pin_used`,
      userId: newUser.id,
      type: 'pin_used',
      amount: 11,
      pinCode: pin.pinCode,
      pinId: pin.id,
      status: 'completed',
      description: 'Account activation using PIN',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    });

    // Distribute activation amount (from PIN value)
    const directIncome = 5;
    const adminFee = 1;

    // Direct sponsor income
    if (sponsor) {
      const sponsorWallet = Database.getWallet(sponsor.id);
      if (sponsorWallet) {
        Database.updateWallet(sponsor.id, {
          incomeWallet: sponsorWallet.incomeWallet + directIncome,
          totalReceived: sponsorWallet.totalReceived + directIncome
        });

        Database.createTransaction({
          id: `tx_${Date.now()}_sponsor`,
          userId: sponsor.id,
          type: 'direct_income',
          amount: directIncome,
          fromUserId: newUser.id,
          status: 'completed',
          description: `Direct sponsor income from ${newUser.fullName} (${newUser.userId})`,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        });
      }
    } else {
      Database.addToSafetyPool(directIncome, newUser.id, 'No sponsor - direct income');
    }

    // Admin fee to safety pool
    Database.addToSafetyPool(adminFee, newUser.id, 'Admin fee');

    // Process matrix-level help payouts (binary tree event tracking, give-help/receive-help)
    Database.processMatrixHelpForNewMember(newUserId, newUser.id);

    // Send welcome notification
    Database.createNotification({
      id: `notif_${Date.now()}`,
      userId: newUser.id,
      title: 'Welcome To ReferNex',
      message: `Your account has been created successfully. Your User ID is ${newUserId}. Transaction Password: ${transactionPassword}`,
      type: 'success',
      isRead: false,
      createdAt: new Date().toISOString()
    });

    const welcomeSubject = 'Welcome To ReferNex';
    const welcomeBody = [
      `Hello ${newUser.fullName},`,
      '',
      'Your account is now active.',
      `Name: ${newUser.fullName}`,
      `User ID: ${newUser.userId}`,
      `Password: ${password}`,
      `Transaction Password: ${transactionPassword}`,
      '',
      'Keep these credentials secure.'
    ].join('\n');
    const synced = await Database.forceRemoteSyncNowWithOptions();
    if (!synced) {
      try {
        await Database.hydrateFromServer({ strict: true, maxAttempts: 1, timeoutMs: 8000, retryDelayMs: 500 });
      } catch {
        // If hydrate also fails, caller still gets explicit failure.
      }
      return { success: false, message: 'Registration could not be saved to backend. Please try again.' };
    }

    void dispatchSystemEmail({
      to: newUser.email,
      subject: welcomeSubject,
      body: welcomeBody,
      purpose: 'welcome',
      timeoutMs: 5000,
      metadata: {
        userId: newUser.userId
      }
    });
    return { success: true, message: `Registration successful. Your ID is: ${newUserId}`, userId: newUserId };
  },

  logout: () => {
    const { impersonatedUser } = get();
    if (impersonatedUser) {
      // End impersonation but keep admin logged in
      get().endImpersonation();
    } else {
      // Full logout
      Database.setCurrentUser(null);
      set({ user: null, isAuthenticated: false });
    }
  },

  updateUser: async (updates) => {
    const { user, impersonatedUser } = get();
    const targetUser = impersonatedUser || user;

    if (targetUser) {
      const updatedUser = Database.updateUser(targetUser.id, updates);
      if (updatedUser) {
        if (impersonatedUser) {
          set({ impersonatedUser: updatedUser });
        } else {
          Database.setCurrentUser(updatedUser);
          set({ user: updatedUser });
        }
        // Sync to backend and wait for it
        await Database.syncNow();
      }
    }
  },

  verifyTransactionPassword: (userId: string, transactionPassword: string): boolean => {
    const user = Database.getUserById(userId);
    return user?.transactionPassword === transactionPassword;
  }
}));

// Wallet Store - Updated with three wallet system
interface WalletState {
  wallet: Wallet | null;
  transactions: Transaction[];
  loadWallet: (userId: string) => void;
  transferFunds: (
    fromUserId: string,
    toUserId: string,
    amount: number,
    sourceWallet?: 'fund' | 'income',
    security?: {
      transactionPassword?: string;
      otp?: string;
    }
  ) => Promise<{ success: boolean; message: string }>;
  withdraw: (userId: string, amount: number, walletAddress: string) => Promise<{ success: boolean; message: string }>;
  refreshTransactions: (userId: string) => void;
}

export const useWalletStore = create<WalletState>((set, get) => ({
  wallet: null,
  transactions: [],

  loadWallet: (userId: string) => {
    // Auto-settle any pending locked give-help / qualified locked receive-help in real time.
    // Loop because each call only releases ONE item — repeat until nothing left to release.
    const MAX_RELEASE_PASSES = 20;
    for (let i = 0; i < MAX_RELEASE_PASSES; i++) {
      const walletBefore = Database.getWallet(userId);
      const lockedBefore = walletBefore?.lockedIncomeWallet || 0;
      const giveLockedBefore = walletBefore?.giveHelpLocked || 0;
      Database.releaseLockedGiveHelp(userId);
      Database.releaseLockedReceiveHelp(userId);
      const walletAfter = Database.getWallet(userId);
      const lockedAfter = walletAfter?.lockedIncomeWallet || 0;
      const giveLockedAfter = walletAfter?.giveHelpLocked || 0;
      // Stop if nothing changed this pass
      if (Math.abs(lockedBefore - lockedAfter) < 0.01 && Math.abs(giveLockedBefore - giveLockedAfter) < 0.01) break;
    }
    // Keep income wallet aligned with transaction ledger for legacy/updated logic transitions.
    Database.repairIncomeWalletConsistency(userId);
    // Keep locked income wallet aligned with tracker-level locks.
    Database.syncLockedIncomeWallet(userId);
    const wallet = Database.getWallet(userId);
    const transactions = Database.getUserTransactions(userId);
    set({ wallet, transactions });
  },

  transferFunds: async (
    fromUserId: string,
    toUserId: string,
    amount: number,
    sourceWallet: 'fund' | 'income' = 'fund',
    security?: {
      transactionPassword?: string;
      otp?: string;
    }
  ) => {
    const transferGate = Database.getSensitiveActionSyncGate();
    if (!transferGate.allowed) {
      return { success: false, message: transferGate.message };
    }

    if (amount <= 0) {
      return { success: false, message: 'Invalid amount' };
    }

    const fromWallet = Database.getWallet(fromUserId);
    const fromUser = Database.getUserById(fromUserId);

    if (!fromWallet || !fromUser) {
      return { success: false, message: 'Sender wallet not found' };
    }

    const normalizedTarget = (toUserId || '').trim();

    if (sourceWallet === 'income') {
      if (fromWallet.incomeWallet < amount) {
        return { success: false, message: 'Insufficient income wallet balance' };
      }

      const toUser = normalizedTarget ? Database.getUserByUserId(normalizedTarget) : fromUser;
      const toWallet = toUser ? Database.getWallet(toUser.id) : null;
      if (!toUser || !toWallet) {
        return { success: false, message: 'Recipient not found' };
      }

      const isSelfTransfer = toUser.id === fromUserId;
      if (!isSelfTransfer && !Database.isInSameChain(fromUserId, toUser.id)) {
        return { success: false, message: 'Transfer allowed only to upline or downline' };
      }
      if (!isSelfTransfer) {
        const txPassword = (security?.transactionPassword || '').trim();
        if (!txPassword || fromUser.transactionPassword !== txPassword) {
          return { success: false, message: 'Invalid transaction password' };
        }
        const otp = (security?.otp || '').trim();
        if (!otp || !Database.verifyOtp(fromUserId, otp, 'transaction')) {
          return { success: false, message: 'Invalid or expired OTP' };
        }
      }

      Database.updateWallet(fromUserId, {
        incomeWallet: fromWallet.incomeWallet - amount
      });

      Database.updateWallet(toUser.id, {
        depositWallet: toWallet.depositWallet + amount
      });

      const now = new Date().toISOString();
      Database.createTransaction({
        id: `tx_${Date.now()}_income_send`,
        userId: fromUserId,
        type: 'income_transfer',
        amount: -amount,
        toUserId: toUser.id,
        status: 'completed',
        description: isSelfTransfer
          ? 'Transferred from income wallet to your fund wallet'
          : `Transferred from income wallet to fund wallet of ${toUser.fullName} (${toUser.userId})`,
        createdAt: now,
        completedAt: now
      });

      if (!isSelfTransfer) {
        Database.createTransaction({
          id: `tx_${Date.now()}_income_recv`,
          userId: toUser.id,
          type: 'p2p_transfer',
          amount,
          fromUserId,
          status: 'completed',
          description: `Fund wallet received from ${fromUser.fullName} (${fromUser.userId}) via income wallet transfer`,
          createdAt: now,
          completedAt: now
        });
      }

      get().loadWallet(fromUserId);
      return {
        success: true,
        message: isSelfTransfer
          ? 'Income transferred to your fund wallet successfully'
          : 'Income transferred to recipient fund wallet successfully'
      };
    }

    const toUser = Database.getUserByUserId(normalizedTarget);
    const toWallet = toUser ? Database.getWallet(toUser.id) : null;
    if (!toUser || !toWallet) {
      return { success: false, message: 'Recipient not found' };
    }

    // Check if transfer is allowed (upline/downline chain only)
    if (!Database.isInSameChain(fromUserId, toUser.id)) {
      return { success: false, message: 'Transfer allowed only to upline or downline' };
    }

    if (fromWallet.depositWallet < amount) {
      return { success: false, message: 'Insufficient fund wallet balance' };
    }
    const txPassword = (security?.transactionPassword || '').trim();
    if (!txPassword || fromUser.transactionPassword !== txPassword) {
      return { success: false, message: 'Invalid transaction password' };
    }
    const otp = (security?.otp || '').trim();
    if (!otp || !Database.verifyOtp(fromUserId, otp, 'transaction')) {
      return { success: false, message: 'Invalid or expired OTP' };
    }

    // Fund wallet P2P transfer (upline/downline only)
    Database.updateWallet(fromUserId, {
      depositWallet: fromWallet.depositWallet - amount
    });

    Database.updateWallet(toUser.id, {
      depositWallet: toWallet.depositWallet + amount
    });

    // Create transaction records
    Database.createTransaction({
      id: `tx_${Date.now()}_send`,
      userId: fromUserId,
      type: 'p2p_transfer',
      amount: -amount,
      toUserId: toUser.id,
      status: 'completed',
      description: `Fund wallet transfer to ${toUser.fullName} (${toUser.userId})`,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    });

    Database.createTransaction({
      id: `tx_${Date.now()}_recv`,
      userId: toUser.id,
      type: 'p2p_transfer',
      amount,
      fromUserId,
      status: 'completed',
      description: `Fund wallet transfer from ${fromUser.fullName} (${fromUser.userId})`,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    });

    get().loadWallet(fromUserId);

    return { success: true, message: 'Transfer successful' };
  },

  withdraw: async (userId: string, amount: number, walletAddress: string) => {
    const withdrawalGate = Database.getSensitiveActionSyncGate();
    if (!withdrawalGate.allowed) {
      return { success: false, message: withdrawalGate.message };
    }

    const settings = Database.getSettings();
    const wallet = Database.getWallet(userId);
    const user = Database.getUserById(userId);

    if (!wallet || !user) {
      return { success: false, message: 'User not found' };
    }

    if (amount <= 0) {
      return { success: false, message: 'Invalid amount' };
    }

    // Use income wallet for withdrawals
    const availableWithdrawableBalance = Math.max(0, wallet.incomeWallet - (wallet.giveHelpLocked || 0));
    if (availableWithdrawableBalance < amount) {
      return { success: false, message: 'Insufficient withdrawable balance (some amount is locked for give-help)' };
    }

    const fee = amount * (settings.withdrawalFeePercent / 100);
    const netAmount = amount - fee;

    // Deduct from wallet
    Database.updateWallet(userId, {
      incomeWallet: wallet.incomeWallet - amount
    });

    // Create withdrawal transaction
    Database.createTransaction({
      id: `tx_${Date.now()}_withdraw`,
      userId,
      type: 'withdrawal',
      amount: -amount,
      status: 'completed',
      description: `Withdrawal to ${walletAddress} (Fee: $${fee})`,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    });

    get().loadWallet(userId);

    return { success: true, message: `Withdrawal of $${netAmount} successful (Fee: $${fee})` };
  },

  refreshTransactions: (userId: string) => {
    const transactions = Database.getUserTransactions(userId);
    set({ transactions });
  }
}));

// PIN Store - New store for PIN wallet functionality
interface PinState {
  pins: Pin[];
  unusedPins: Pin[];
  usedPins: Pin[];
  receivedPins: Pin[];
  transfers: PinTransfer[];
  purchaseRequests: PinPurchaseRequest[];
  loadPins: (userId: string) => void;
  transferPin: (pinId: string, fromUserId: string, toUserId: string) => Promise<{ success: boolean; message: string }>;
  requestPinPurchase: (
    userId: string,
    quantity: number,
    options?: {
      paymentMethod?: PaymentMethodType;
      paymentProof?: string;
      paymentTxHash?: string;
      paidFromWallet?: boolean;
    }
  ) => Promise<{ success: boolean; message: string }>;
  buyPinsDirect: (userId: string, quantity: number) => Promise<{ success: boolean; message: string }>;
  loadPurchaseRequests: (userId: string) => void;
  copyPinToClipboard: (pinCode: string) => Promise<boolean>;
}

export const usePinStore = create<PinState>((set, get) => ({
  pins: [],
  unusedPins: [],
  usedPins: [],
  receivedPins: [],
  transfers: [],
  purchaseRequests: [],

  loadPins: (userId: string) => {
    const pins = Database.getUserPins(userId);
    const unusedPins = Database.getUnusedPins(userId);
    const usedPins = Database.getUsedPins(userId);
    const receivedPins = Database.getReceivedPins(userId);
    const transfers = Database.getUserPinTransfers(userId);

    set({
      pins,
      unusedPins,
      usedPins,
      receivedPins,
      transfers
    });
  },

  transferPin: async (pinId: string, fromUserId: string, toUserId: string) => {
    try {
      // Check if in same chain
      if (!Database.isInSameChain(fromUserId, toUserId)) {
        return { success: false, message: 'PIN can only be transferred to upline or downline members' };
      }

      const toUser = Database.getUserByUserId(toUserId);
      if (!toUser) {
        return { success: false, message: 'Recipient not found' };
      }

      const result = Database.transferPin(pinId, toUser.id, fromUserId);
      if (!result) {
        return { success: false, message: 'Failed to transfer PIN' };
      }

      // Reload pins
      get().loadPins(fromUserId);

      return { success: true, message: `PIN transferred to ${toUser.fullName}` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Transfer failed';
      return { success: false, message };
    }
  },

  requestPinPurchase: async (userId: string, quantity: number, options) => {
    if (quantity < 1) {
      return { success: false, message: 'Quantity must be at least 1' };
    }

    const settings = Database.getSettings();
    const amount = quantity * settings.pinAmount;
    const wallet = Database.getWallet(userId);
    if (!wallet) {
      return { success: false, message: 'Wallet not found' };
    }
    const paidFromWallet = options?.paidFromWallet === true;

    if (paidFromWallet) {
      if (wallet.depositWallet < amount) {
        return { success: false, message: 'Insufficient fund wallet balance' };
      }
      Database.updateWallet(userId, {
        depositWallet: wallet.depositWallet - amount
      });
    } else if (!options?.paymentProof) {
      return { success: false, message: 'Payment screenshot is required for manual verification' };
    }

    Database.createTransaction({
      id: `tx_${Date.now()}_pin_request`,
      userId,
      type: 'pin_purchase',
      amount: paidFromWallet ? -amount : 0,
      status: 'pending',
      description: paidFromWallet
        ? `PIN purchase request from fund wallet (${quantity} PINs)`
        : `PIN purchase request with manual payment proof (${quantity} PINs)`,
      createdAt: new Date().toISOString()
    });

    const request: PinPurchaseRequest = {
      id: `ppr_${Date.now()}`,
      userId,
      quantity,
      amount,
      status: 'pending',
      purchaseType: 'request',
      paymentMethod: options?.paymentMethod || 'crypto',
      paymentProof: options?.paymentProof,
      paymentTxHash: options?.paymentTxHash,
      paidFromWallet,
      createdAt: new Date().toISOString()
    };

    Database.createPinPurchaseRequest(request);
    get().loadPurchaseRequests(userId);

    return {
      success: true,
      message: paidFromWallet
        ? `PIN purchase request for ${quantity} PIN(s) submitted from fund wallet`
        : `PIN purchase request for ${quantity} PIN(s) submitted for admin verification`
    };
  },

  buyPinsDirect: async (userId: string, quantity: number) => {
    if (quantity < 1) {
      return { success: false, message: 'Quantity must be at least 1' };
    }

    const settings = Database.getSettings();
    const amount = quantity * settings.pinAmount;
    const wallet = Database.getWallet(userId);
    if (!wallet) {
      return { success: false, message: 'Wallet not found' };
    }
    if (wallet.depositWallet < amount) {
      return { success: false, message: 'Insufficient fund wallet balance for direct buy' };
    }

    const now = new Date().toISOString();
    const adminUser = Database.getUsers().find(u => u.isAdmin);
    const processedBy = adminUser?.id || userId;

    Database.updateWallet(userId, {
      depositWallet: wallet.depositWallet - amount
    });

    const pins = Database.generatePins(quantity, userId, processedBy);

    Database.createTransaction({
      id: `tx_${Date.now()}_pin_direct_buy`,
      userId,
      type: 'pin_purchase',
      amount: -amount,
      status: 'completed',
      description: `Direct PIN buy from fund wallet (${quantity} PINs)`,
      createdAt: now,
      completedAt: now
    });

    Database.createPinPurchaseRequest({
      id: `ppr_${Date.now()}_direct`,
      userId,
      quantity,
      amount,
      status: 'completed',
      purchaseType: 'direct',
      paidFromWallet: true,
      adminNotes: 'Auto-approved direct buy from fund wallet',
      createdAt: now,
      processedAt: now,
      processedBy,
      pinsGenerated: pins.map(p => p.pinCode)
    });

    Database.createNotification({
      id: `notif_${Date.now()}_direct_pin`,
      userId,
      title: 'PIN Purchase Successful',
      message: `${quantity} PIN(s) purchased instantly from fund wallet.`,
      type: 'success',
      isRead: false,
      createdAt: now
    });

    get().loadPins(userId);
    get().loadPurchaseRequests(userId);

    return { success: true, message: `${quantity} PIN(s) purchased instantly` };
  },

  loadPurchaseRequests: (userId: string) => {
    const requests = Database.getUserPinPurchaseRequests(userId);
    set({ purchaseRequests: requests });
  },

  copyPinToClipboard: async (pinCode: string) => {
    try {
      await navigator.clipboard.writeText(pinCode);
      return true;
    } catch {
      return false;
    }
  }
}));

// Matrix Store
interface MatrixState {
  matrix: MatrixNode[];
  userDownline: MatrixNode[];
  loadMatrix: () => void;
  loadUserDownline: (userId: string) => void;
  getDownlineStats: (userId: string) => { left: number; right: number; leftActive: number; rightActive: number };
}

export const useMatrixStore = create<MatrixState>((set) => ({
  matrix: [],
  userDownline: [],

  loadMatrix: () => {
    const matrix = Database.getMatrix();
    set({ matrix });
  },

  loadUserDownline: (userId: string) => {
    const downline = Database.getUserDownline(userId);
    set({ userDownline: downline });
  },

  getDownlineStats: (userId: string) => {
    return Database.getTeamCounts(userId);
  }
}));

// Admin Store - Updated with PIN management and impersonation
interface AdminState {
  settings: AdminSettings;
  stats: DashboardStats | null;
  allUsers: User[];
  allTransactions: Transaction[];
  allPins: Pin[];
  allPinRequests: PinPurchaseRequest[];
  pendingPinRequests: PinPurchaseRequest[];
  safetyPoolAmount: number;
  loadSettings: () => void;
  loadStats: () => void;
  loadAllUsers: () => void;
  loadAllTransactions: () => void;
  loadAllPins: () => void;
  loadAllPinRequests: () => void;
  loadPendingPinRequests: () => void;
  updateSettings: (settings: Partial<AdminSettings>) => void;
  generatePins: (quantity: number, ownerId: string) => Promise<{ success: boolean; message: string; pins?: Pin[] }>;
  approvePinPurchase: (requestId: string) => Promise<{ success: boolean; message: string }>;
  rejectPinPurchase: (requestId: string, reason: string) => Promise<{ success: boolean; message: string }>;
  reopenPinPurchase: (requestId: string) => Promise<{ success: boolean; message: string }>;
  suspendPin: (pinId: string, reason: string) => Promise<{ success: boolean; message: string }>;
  unsuspendPin: (pinId: string) => Promise<{ success: boolean; message: string }>;
  blockUser: (targetUserId: string, type: 'temporary' | 'permanent', reason?: string, hours?: number) => Promise<{ success: boolean; message: string }>;
  unblockUser: (targetUserId: string) => Promise<{ success: boolean; message: string }>;
  addFundsToUser: (userId: string, amount: number, walletType: 'deposit' | 'income') => Promise<{ success: boolean; message: string }>;
  bulkCreateUsersWithoutPin: (params: {
    sponsorUserId: string;
    quantity: number;
    namePrefix: string;
    country: string;
    password: string;
    transactionPassword: string;
    onProgress?: (progress: {
      stage: 'creating' | 'finalizing' | 'syncing' | 'completed' | 'failed';
      processed: number;
      total: number;
      created: number;
      failed: number;
      message: string;
    }) => void;
  }) => Promise<{ success: boolean; message: string; createdUserIds?: string[]; failed?: string[] }>;
  getLevelWiseReport: (level?: number, startDate?: string, endDate?: string) => any[];
  reconcileHelpTrackers: () => Promise<{ success: boolean; message: string; report?: any }>;
  activateUsersAndRebuildMatrix: () => Promise<{ success: boolean; message: string; report?: any }>;
  repairMisroutedSafetyPool: () => Promise<{ success: boolean; message: string; report?: any }>;
  deleteAllIdsFromSystem: () => Promise<{ success: boolean; message: string; report?: any }>;
}

export const useAdminStore = create<AdminState>((set, get) => ({
  settings: Database.getSettings(),
  stats: null,
  allUsers: [],
  allTransactions: [],
  allPins: [],
  allPinRequests: [],
  pendingPinRequests: [],
  safetyPoolAmount: 0,

  loadSettings: () => {
    const settings = Database.getSettings();
    set({ settings });
  },

  loadStats: () => {
    const stats = Database.getStats();
    const pool = Database.getSafetyPool();
    const totalDeposits = Database.getTotalDeposits();
    const totalWithdrawals = Database.getTotalWithdrawals();
    const totalLockedIncome = Database.getTotalLockedIncome();

    set({
      stats: {
        ...stats,
        totalDeposits,
        totalWithdrawals,
        totalLockedIncome
      },
      safetyPoolAmount: pool.totalAmount
    });
  },

  loadAllUsers: () => {
    const users = Database.getUsers();
    set({ allUsers: users });
  },

  loadAllTransactions: () => {
    const transactions = Database.getTransactions();
    set({ allTransactions: transactions });
  },

  loadAllPins: () => {
    const pins = Database.getPins();
    set({ allPins: pins });
  },

  loadAllPinRequests: () => {
    const requests = Database.getPinPurchaseRequests()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    set({ allPinRequests: requests });
  },

  loadPendingPinRequests: () => {
    const requests = Database.getPendingPinPurchaseRequests();
    set({ pendingPinRequests: requests });
  },

  updateSettings: (newSettings: Partial<AdminSettings>) => {
    const currentSettings = get().settings;
    const updatedSettings = { ...currentSettings, ...newSettings };
    Database.saveSettings(updatedSettings);
    set({ settings: updatedSettings });
  },

  generatePins: async (quantity: number, ownerId: string) => {
    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can generate PINs' };
    }

    const pins = Database.generatePins(quantity, ownerId, adminUser.id);
    get().loadAllPins();

    return { success: true, message: `Generated ${quantity} PIN(s)`, pins };
  },

  approvePinPurchase: async (requestId: string) => {
    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can approve PIN purchases' };
    }

    const result = Database.approvePinPurchase(requestId, adminUser.id);
    if (!result) {
      return { success: false, message: 'Failed to approve PIN purchase' };
    }

    get().loadPendingPinRequests();
    get().loadAllPinRequests();
    get().loadAllPins();

    return { success: true, message: 'PIN purchase approved and PINs generated' };
  },

  rejectPinPurchase: async (requestId: string, reason: string) => {
    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can reject PIN purchases' };
    }

    const request = Database.getPinPurchaseRequests().find(r => r.id === requestId);
    if (!request) {
      return { success: false, message: 'Request not found' };
    }

    const wallet = Database.getWallet(request.userId);
    if (request.paidFromWallet && wallet) {
      Database.updateWallet(request.userId, {
        depositWallet: wallet.depositWallet + request.amount
      });
      Database.createTransaction({
        id: `tx_${Date.now()}_pin_refund`,
        userId: request.userId,
        type: 'admin_credit',
        amount: request.amount,
        status: 'completed',
        description: 'Refund for rejected PIN purchase request',
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      });
    }

    const result = Database.updatePinPurchaseRequest(requestId, {
      status: 'cancelled',
      processedAt: new Date().toISOString(),
      processedBy: adminUser.id,
      adminNotes: reason
    });

    if (!result) {
      return { success: false, message: 'Failed to reject PIN purchase' };
    }

    get().loadPendingPinRequests();
    get().loadAllPinRequests();

    return { success: true, message: 'PIN purchase rejected' };
  },

  reopenPinPurchase: async (requestId: string) => {
    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can reopen PIN purchase requests' };
    }

    try {
      const result = Database.reopenPinPurchaseRequest(requestId, adminUser.id);
      if (!result) {
        return { success: false, message: 'Failed to reopen PIN purchase request' };
      }
      get().loadPendingPinRequests();
      get().loadAllPinRequests();
      get().loadAllPins();
      return { success: true, message: 'Request reopened. You can now approve or reject again.' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to reopen request';
      return { success: false, message };
    }
  },

  suspendPin: async (pinId: string, reason: string) => {
    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can suspend PINs' };
    }

    const result = Database.suspendPin(pinId, adminUser.id, reason);
    if (!result) {
      return { success: false, message: 'Failed to suspend PIN' };
    }

    get().loadAllPins();
    return { success: true, message: 'PIN suspended successfully' };
  },

  unsuspendPin: async (pinId: string) => {
    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can unsuspend PINs' };
    }

    const result = Database.unsuspendPin(pinId);
    if (!result) {
      return { success: false, message: 'Failed to unsuspend PIN' };
    }

    get().loadAllPins();
    return { success: true, message: 'PIN unsuspended successfully' };
  },

  blockUser: async (targetUserId: string, type: 'temporary' | 'permanent', reason: string = 'Blocked by admin', hours: number = 24) => {
    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can block users' };
    }

    const targetUser = Database.getUserByUserId(targetUserId);
    if (!targetUser) {
      return { success: false, message: 'User not found' };
    }

    if (targetUser.isAdmin) {
      return { success: false, message: 'Admin account cannot be blocked' };
    }

    const result = Database.blockUser(targetUser.id, type, hours, reason);
    if (!result) {
      return { success: false, message: 'Failed to block user' };
    }

    get().loadAllUsers();
    return {
      success: true,
      message: type === 'temporary'
        ? `User temporarily blocked for ${hours} hour(s)`
        : 'User permanently blocked'
    };
  },

  unblockUser: async (targetUserId: string) => {
    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can unblock users' };
    }

    const targetUser = Database.getUserByUserId(targetUserId);
    if (!targetUser) {
      return { success: false, message: 'User not found' };
    }

    const result = Database.unblockUser(targetUser.id);
    if (!result) {
      return { success: false, message: 'Failed to unblock user' };
    }

    get().loadAllUsers();
    return { success: true, message: 'User unblocked successfully' };
  },

  addFundsToUser: async (userId: string, amount: number, walletType: 'deposit' | 'income' = 'deposit') => {
    const user = Database.getUserByUserId(userId);
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    const wallet = Database.getWallet(user.id);
    if (!wallet) {
      return { success: false, message: 'User wallet not found' };
    }

    if (walletType === 'deposit') {
      Database.updateWallet(user.id, {
        depositWallet: wallet.depositWallet + amount
      });
    } else {
      Database.updateWallet(user.id, {
        incomeWallet: wallet.incomeWallet + amount
      });
    }

    Database.createTransaction({
      id: `tx_${Date.now()}_admin`,
      userId: user.id,
      type: 'admin_credit',
      amount,
      status: 'completed',
      description: `Admin fund addition to ${walletType} wallet`,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    });

    return { success: true, message: `Added $${amount} to user's ${walletType} wallet` };
  },

  bulkCreateUsersWithoutPin: async (params) => {
    const bulkActivationGate = Database.getSensitiveActionSyncGate();
    if (!bulkActivationGate.allowed) {
      return { success: false, message: bulkActivationGate.message };
    }

    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can create IDs without PIN' };
    }

    const sponsor = Database.getUserByUserId(params.sponsorUserId);
    if (!sponsor) {
      return { success: false, message: 'Sponsor ID not found' };
    }
    if (!sponsor.isActive || sponsor.accountStatus !== 'active') {
      return { success: false, message: 'Sponsor account is inactive or blocked' };
    }

    const quantity = Math.floor(Number(params.quantity));
    if (!Number.isFinite(quantity) || quantity < 1) {
      return { success: false, message: 'Quantity must be at least 1' };
    }
    // Full-state sync can time out on very large batches in production.
    // Keep batch size bounded to improve reliability on Render/hosted networks.
    if (quantity > 100) {
      return { success: false, message: 'Use maximum 100 IDs per batch for reliable backend sync' };
    }
    if (!params.namePrefix?.trim()) {
      return { success: false, message: 'Name prefix is required' };
    }
    if (!params.country?.trim()) {
      return { success: false, message: 'Country is required' };
    }
    if (!params.password || params.password.length < 6) {
      return { success: false, message: 'Password must be at least 6 characters' };
    }
    if (!params.transactionPassword || params.transactionPassword.length < 4) {
      return { success: false, message: 'Transaction password must be at least 4 characters' };
    }

    const createdUserIds: string[] = [];
    const failed: string[] = [];
    const seed = Date.now();
    const directIncome = 5;
    const adminFee = 1;
    const deferredTransactions: Transaction[] = [];
    const deferredNotifications: Notification[] = [];
    const yieldEvery = quantity >= 500 ? 20 : 10;
    const progressStep = quantity >= 10 ? 10 : 1;
    const yieldToMainThread = async () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    let sponsorIncomeCredits = 0;
    params.onProgress?.({
      stage: 'creating',
      processed: 0,
      total: quantity,
      created: 0,
      failed: 0,
      message: `Starting bulk creation (0/${quantity})`
    });

    let remoteSyncResumed = false;
    Database.pauseRemoteSync();
    try {
      for (let i = 0; i < quantity; i += 1) {
        try {
          const placement = Database.findNextPosition(sponsor.userId);
          if (!placement) {
            failed.push(`Row ${i + 1}: matrix placement not available`);
            continue;
          }

          const parentId = placement.parentId;
          const position = placement.position;
          const matrixDepthLevel = parentId ? (Database.getMatrixNode(parentId)?.level || 0) + 1 : 0;
          const newUserId = Database.generateUniqueUserId();
          const phoneSeed = `${Date.now()}${i}${Math.floor(Math.random() * 1000)}`.replace(/\D/g, '');
          const phone = phoneSeed.slice(-10).padStart(10, '9');
          const fullName = `${params.namePrefix.trim()} ${String(i + 1).padStart(3, '0')}`;
          const email = `admin.bulk.${sponsor.userId}.${seed}.${i}@auto.local`;

          const newUser: User = {
            id: `user_${Date.now()}_${i}`,
            userId: newUserId,
            email,
            password: params.password,
            fullName,
            phone,
            country: params.country.trim(),
            isActive: true,
            isAdmin: false,
            accountStatus: 'active',
            blockedAt: null,
            blockedUntil: null,
            blockedReason: null,
            createdAt: new Date().toISOString(),
            activatedAt: new Date().toISOString(),
            gracePeriodEnd: null,
            sponsorId: sponsor.userId,
            parentId,
            position,
            level: 0,
            directCount: 0,
            totalEarnings: 0,
            isCapped: false,
            capLevel: 0,
            reEntryCount: 0,
            cycleCount: 0,
            requiredDirectForNextLevel: 2,
            completedDirectForCurrentLevel: 0,
            transactionPassword: params.transactionPassword,
            emailVerified: false,
            achievements: {
              nationalTour: false,
              internationalTour: false,
              familyTour: false
            }
          };

          Database.createUser(newUser);

          const matrixNode: MatrixNode = {
            userId: newUserId,
            username: fullName,
            level: matrixDepthLevel,
            position: position === 'left' ? 0 : 1,
            parentId: parentId || undefined,
            isActive: true
          };
          Database.addMatrixNode(matrixNode);

          deferredTransactions.push({
            id: `tx_${Date.now()}_admin_activation_${i}`,
            userId: newUser.id,
            type: 'activation',
            amount: 11,
            status: 'completed',
            description: 'Account activation by admin without PIN',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          });

          const latestSponsorAfterCount = Database.getUserByUserId(sponsor.userId);
          if (latestSponsorAfterCount) {
            sponsorIncomeCredits += directIncome;
            deferredTransactions.push({
              id: `tx_${Date.now()}_admin_bulk_sponsor_${i}`,
              userId: latestSponsorAfterCount.id,
              type: 'direct_income',
              amount: directIncome,
              fromUserId: newUser.id,
              status: 'completed',
              description: `Direct sponsor income from ${newUser.fullName} (${newUser.userId})`,
              createdAt: new Date().toISOString(),
              completedAt: new Date().toISOString()
            });
          } else {
            Database.addToSafetyPool(directIncome, newUser.id, 'No sponsor - direct income');
          }

          Database.addToSafetyPool(adminFee, newUser.id, 'Admin fee');
          Database.processMatrixHelpForNewMember(newUserId, newUser.id);

          deferredNotifications.push({
            id: `notif_${Date.now()}_bulk_admin_${i}`,
            userId: newUser.id,
            title: 'Welcome To ReferNex',
            message: `Your account has been created by admin. Your User ID is ${newUserId}. Transaction Password: ${params.transactionPassword}`,
            type: 'success',
            isRead: false,
            createdAt: new Date().toISOString()
          });

          createdUserIds.push(newUserId);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'unknown error';
          failed.push(`Row ${i + 1}: ${message}`);
        }

        if ((i + 1) % yieldEvery === 0) {
          await yieldToMainThread();
        }

        if ((i + 1) % progressStep === 0 || i + 1 === quantity) {
          params.onProgress?.({
            stage: 'creating',
            processed: i + 1,
            total: quantity,
            created: createdUserIds.length,
            failed: failed.length,
            message: `Creating IDs... (${i + 1}/${quantity})`
          });
        }
      }

      params.onProgress?.({
        stage: 'finalizing',
        processed: quantity,
        total: quantity,
        created: createdUserIds.length,
        failed: failed.length,
        message: 'Finalizing batch data...'
      });

      if (deferredTransactions.length > 0) {
        const tx = Database.getTransactions();
        tx.push(...deferredTransactions);
        Database.saveTransactions(tx);
      }

      if (deferredNotifications.length > 0) {
        const notifications = Database.getNotifications();
        notifications.push(...deferredNotifications);
        Database.saveNotifications(notifications);
      }

      const latestSponsor = Database.getUserByUserId(sponsor.userId);
      if (latestSponsor && createdUserIds.length > 0) {
        Database.updateUser(latestSponsor.id, {
          directCount: (latestSponsor.directCount || 0) + createdUserIds.length
        });
        if (sponsorIncomeCredits > 0) {
          const sponsorWallet = Database.getWallet(latestSponsor.id);
          if (sponsorWallet) {
            Database.updateWallet(latestSponsor.id, {
              incomeWallet: sponsorWallet.incomeWallet + sponsorIncomeCredits,
              totalReceived: sponsorWallet.totalReceived + sponsorIncomeCredits
            });
          }
        }
        Database.releaseLockedGiveHelp(latestSponsor.id);
        Database.releaseLockedReceiveHelp(latestSponsor.id);
      }

      if (createdUserIds.length === 0) {
        get().loadAllUsers();
        if (get().allTransactions.length > 0) {
          get().loadAllTransactions();
        }
        get().loadStats();
        params.onProgress?.({
          stage: 'failed',
          processed: quantity,
          total: quantity,
          created: 0,
          failed: failed.length,
          message: 'No IDs were created'
        });
        return { success: false, message: 'No IDs created', createdUserIds, failed };
      }

      // Bulk create must be persisted remotely before reporting success.
      Database.resumeRemoteSync(false);
      remoteSyncResumed = true;
      params.onProgress?.({
        stage: 'syncing',
        processed: quantity,
        total: quantity,
        created: createdUserIds.length,
        failed: failed.length,
        message: 'Saving batch to backend...'
      });
      const synced = await Database.forceRemoteSyncNowWithOptions({
        full: false,
        force: true,
        timeoutMs: 180_000,
        maxAttempts: 4,
        retryDelayMs: 2000
      });
      if (!synced) {
        try {
          await Database.hydrateFromServer({ strict: true, maxAttempts: 3, timeoutMs: 15000, retryDelayMs: 1200 });
          const missingAfterHydrate = createdUserIds.filter((uid) => !Database.getUserByUserId(uid));
          if (missingAfterHydrate.length === 0) {
            get().loadAllUsers();
            if (get().allTransactions.length > 0) {
              get().loadAllTransactions();
            }
            get().loadStats();
            const recoveredMessage = failed.length > 0
              ? `Created ${createdUserIds.length} ID(s), failed ${failed.length}`
              : `Created ${createdUserIds.length} ID(s) without PIN`;
            params.onProgress?.({
              stage: 'completed',
              processed: quantity,
              total: quantity,
              created: createdUserIds.length,
              failed: failed.length,
              message: `${recoveredMessage} (saved after retry)`
            });
            return {
              success: true,
              message: `${recoveredMessage} (saved after retry)`,
              createdUserIds,
              failed
            };
          }
        } catch {
          // Ignore hydrate failures here; caller still gets a hard failure.
        }
        get().loadAllUsers();
        if (get().allTransactions.length > 0) {
          get().loadAllTransactions();
        }
        get().loadStats();
        params.onProgress?.({
          stage: 'failed',
          processed: quantity,
          total: quantity,
          created: createdUserIds.length,
          failed: failed.length + 1,
          message: 'Backend sync failed for this batch'
        });
        return {
          success: false,
          message: 'Bulk create could not be saved to backend. No permanent changes were applied.',
          createdUserIds,
          failed: [...failed, 'Backend sync failed']
        };
      }

      get().loadAllUsers();
      if (get().allTransactions.length > 0) {
        get().loadAllTransactions();
      }
      get().loadStats();

      const message = failed.length > 0
        ? `Created ${createdUserIds.length} ID(s), failed ${failed.length}`
        : `Created ${createdUserIds.length} ID(s) without PIN`;
      params.onProgress?.({
        stage: 'completed',
        processed: quantity,
        total: quantity,
        created: createdUserIds.length,
        failed: failed.length,
        message
      });

      return { success: true, message, createdUserIds, failed };
    } finally {
      if (!remoteSyncResumed) {
        Database.resumeRemoteSync(true);
      }
    }
  },

  getLevelWiseReport: (level?: number, startDate?: string, endDate?: string) => {
    return Database.getLevelWiseReport(level, startDate, endDate);
  },

  reconcileHelpTrackers: async () => {
    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can run reconciliation' };
    }

    const report = Database.reconcileHelpTrackers();
    get().loadAllUsers();
    if (get().allTransactions.length > 0) {
      get().loadAllTransactions();
    }
    get().loadStats();

    const message = `Reconciliation complete: scanned ${report.scannedTrackers}, repaired levels ${report.repairedLevels}, repaired queue items ${report.repairedQueueItems}, wallet syncs ${report.walletSyncs}`;
    return { success: true, message, report };
  },

  activateUsersAndRebuildMatrix: async () => {
    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can run matrix rebuild' };
    }

    try {
      const report = await Database.activateUsersAndRebuildMatrixLogic();
      get().loadAllUsers();
      if (get().allTransactions.length > 0) {
        get().loadAllTransactions();
      }
      get().loadStats();

      const message = `Rebuild complete: activated users ${report.activatedUsers}, matrix nodes synced ${report.activatedMatrixNodes}, matrix tx rebuilt ${report.removedMatrixTransactions}, replayed members ${report.replayedMembers}, legacy activation backfilled ${report.backfilledActivationUsers}`;
      return { success: true, message, report };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Matrix rebuild failed'
      };
    }
  },

  repairMisroutedSafetyPool: async () => {
    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can run safety-pool repair' };
    }

    try {
      const report = await Database.activateUsersAndRebuildMatrixLogic(undefined, {
        preserveMatrixTransactions: true,
        activateLegacyInactiveUsers: false
      });
      get().loadAllUsers();
      if (get().allTransactions.length > 0) {
        get().loadAllTransactions();
      }
      get().loadStats();

      const message = `Repair complete: matrix tx rebuilt ${report.removedMatrixTransactions}, safety entries cleaned ${report.removedMatrixSafetyPoolEntries}, replayed members ${report.replayedMembers}`;
      return { success: true, message, report };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Safety-pool repair failed'
      };
    }
  },

  deleteAllIdsFromSystem: async () => {
    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can delete all IDs' };
    }

    const report = Database.deleteAllNonAdminIds();
    const synced = await Database.forceRemoteSyncNowWithOptions({ destructive: true });
    if (!synced) {
      try {
        await Database.hydrateFromServer({ strict: true, maxAttempts: 1, timeoutMs: 8000, retryDelayMs: 500 });
      } catch {
        // Keep returning a hard failure if backend state can't be refreshed.
      }
      get().loadAllUsers();
      if (get().allTransactions.length > 0) {
        get().loadAllTransactions();
      }
      get().loadAllPins();
      get().loadAllPinRequests();
      get().loadPendingPinRequests();
      get().loadStats();
      return {
        success: false,
        message: 'Delete All IDs could not be saved to backend. No permanent changes were applied.',
        report
      };
    }

    get().loadAllUsers();
    if (get().allTransactions.length > 0) {
      get().loadAllTransactions();
    }
    get().loadAllPins();
    get().loadAllPinRequests();
    get().loadPendingPinRequests();
    get().loadStats();

    const message = `Deleted ${report.deletedUsers} IDs. Cleared ${report.deletedTransactions} transactions, ${report.deletedPins} PINs, ${report.deletedMatrixNodes} matrix nodes.`;
    return { success: true, message, report };
  }
}));

// Notification Store
interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  loadNotifications: (userId: string) => void;
  markAsRead: (notificationId: string) => void;
  addNotification: (notification: Notification) => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,

  loadNotifications: (userId: string) => {
    const notifications = Database.getUserNotifications(userId);
    const unreadCount = notifications.filter(n => !n.isRead).length;
    set({ notifications, unreadCount });
  },

  markAsRead: (notificationId: string) => {
    Database.markNotificationRead(notificationId);
    const { notifications } = get();
    const updatedNotifications = notifications.map(n =>
      n.id === notificationId ? { ...n, isRead: true } : n
    );
    const unreadCount = updatedNotifications.filter(n => !n.isRead).length;
    set({ notifications: updatedNotifications, unreadCount });
  },

  addNotification: (notification: Notification) => {
    Database.createNotification(notification);
    const { notifications } = get();
    set({
      notifications: [notification, ...notifications],
      unreadCount: get().unreadCount + 1
    });
  }
}));

// UI Store
interface UIState {
  sidebarOpen: boolean;
  theme: 'dark' | 'light';
  toggleSidebar: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  theme: 'dark',
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setTheme: (theme) => set({ theme })
}));

// OTP Store - For email verification
interface OtpState {
  isOtpSent: boolean;
  otpExpiry: Date | null;
  sendOtp: (userId: string, email: string, purpose: 'registration' | 'transaction' | 'withdrawal' | 'profile_update') => Promise<{ success: boolean; otp?: string; message: string }>;
  verifyOtp: (userId: string, otp: string, purpose: 'registration' | 'transaction' | 'withdrawal' | 'profile_update') => Promise<boolean>;
}

export const useOtpStore = create<OtpState>((set) => ({
  isOtpSent: false,
  otpExpiry: null,

  sendOtp: async (userId: string, email: string, purpose) => {
    const otpRecord = Database.generateOtp(userId, email, purpose);
    const purposeLabel = purpose === 'withdrawal'
      ? 'withdrawal'
      : purpose === 'transaction'
        ? 'transaction'
        : purpose === 'profile_update'
          ? 'profile update'
          : 'registration';
    const emailResult = await dispatchSystemEmail({
      to: email,
      subject: 'Your RefeNex OTP Code',
      body: `Your OTP for ${purposeLabel} is ${otpRecord.otp}. This OTP will expire in 10 minutes.`,
      purpose: 'otp',
      timeoutMs: 7000,
      metadata: {
        userId,
        action: purpose
      }
    });
    if (!emailResult.success) {
      return {
        success: false,
        message: emailResult.error
          ? `Failed to send OTP email: ${emailResult.error}`
          : 'Failed to send OTP email. Please try again later'
      };
    }

    set({
      isOtpSent: true,
      otpExpiry: new Date(otpRecord.expiresAt)
    });

    return {
      success: true,
      message: 'OTP sent to your email'
    };
  },

  verifyOtp: async (userId: string, otp: string, purpose) => {
    const isValid = Database.verifyOtp(userId, otp, purpose);
    if (isValid) {
      set({ isOtpSent: false, otpExpiry: null });
    }
    return isValid;
  }
}));
