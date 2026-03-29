import { create } from 'zustand';
import { useEffect, useRef, useState } from 'react';
import type {
  User, Wallet, Transaction, MatrixNode, Notification,
  AdminSettings, DashboardStats, Pin, PinTransfer, PinPurchaseRequest, RegisterData, PaymentMethodType,
  MarketplaceCategory, MarketplaceRetailer, MarketplaceBanner, MarketplaceDeal,
  MarketplaceInvoice, RewardRedemption
} from '@/types';
import Database from '@/db';
import { isValidPhoneNumberForCountry, normalizePhoneNumber } from '@/utils/helpers';

type SystemEmailPurpose = 'otp' | 'welcome' | 'system';

function getBackendApiBase(): string {
  const env = (import.meta as { env?: Record<string, string | boolean | undefined> }).env || {};
  const configured = typeof env.VITE_BACKEND_URL === 'string' ? env.VITE_BACKEND_URL.trim() : '';
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined') {
    return window.location.origin.replace(/\/+$/, '');
  }
  return 'http://127.0.0.1:4000';
}

function normalizeRemoteRebuildError(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload?.error === 'string'
    ? payload.error
    : typeof payload?.message === 'string'
      ? payload.message
      : fallback;
}

async function createServerStateBackup(params?: {
  prefix?: string;
  source?: string;
  reason?: string;
}): Promise<{ fileName: string; filePath: string; createdAt: string; updatedAt: string | null; keys: string[] }> {
  const apiBase = getBackendApiBase();
  const response = await fetch(`${apiBase}/api/backups/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prefix: params?.prefix || 'manual-backup',
      source: params?.source || 'admin',
      reason: params?.reason || 'manual_backup'
    })
  });
  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || payload?.ok === false) {
    throw new Error(normalizeRemoteRebuildError(payload, `Failed to create backup (HTTP ${response.status})`));
  }

  const deadline = Date.now() + (30 * 60 * 1000);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const statusResponse = await fetch(`${apiBase}/api/backups/status?t=${Date.now()}`, {
      method: 'GET'
    });
    const statusPayload = await statusResponse.json().catch(() => ({} as Record<string, unknown>));
    if (!statusResponse.ok || statusPayload?.ok === false) {
      throw new Error(normalizeRemoteRebuildError(statusPayload, `Failed to read backup status (HTTP ${statusResponse.status})`));
    }

    const job = statusPayload?.job as Record<string, unknown> | undefined;
    if (!job || typeof job !== 'object') continue;
    if (job.status === 'failed') {
      throw new Error(typeof job.error === 'string' && job.error ? job.error : 'Backup failed');
    }
    if (job.status !== 'completed') {
      continue;
    }

    const backup = job.backup as Record<string, unknown> | undefined;
    if (!backup || typeof backup.fileName !== 'string' || typeof backup.filePath !== 'string' || typeof backup.createdAt !== 'string') {
      throw new Error('Backend returned invalid backup metadata');
    }

    return {
      fileName: backup.fileName,
      filePath: backup.filePath,
      createdAt: backup.createdAt,
      updatedAt: typeof backup.updatedAt === 'string' ? backup.updatedAt : null,
      keys: Array.isArray(backup.keys) ? backup.keys.filter((key): key is string => typeof key === 'string') : []
    };
  }

  throw new Error('Backup is still running after 30 minutes. Check backend status and backup folder.');
}

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
      set({ user: Database.getCurrentUser() || backendAuth.user, isAuthenticated: true });
      void Database.hydrateFromServerBatches(Database.getStartupRemoteSyncBatches(), {
        strict: true,
        maxAttempts: 3,
        timeoutMs: 60000,
        retryDelayMs: 2000,
        continueOnError: true,
        requireAnySuccess: true
      }).then(() => {
        // Load deferred data (transactions, marketplace) in background after critical data is ready
        void Database.hydrateFromServerBatches(Database.getStartupDeferredRemoteSyncBatches(), {
          strict: false,
          maxAttempts: 3,
          timeoutMs: 60000,
          retryDelayMs: 2000,
          continueOnError: true,
          requireAnySuccess: false
        }).catch(() => { /* deferred data is non-critical */ });
      }).catch((error) => {
        console.warn('Post-login hydration failed:', error);
      });
      return { success: true, message: backendAuth.message };
    }

    const syncStatusBeforeLogin = Database.getRemoteSyncStatus();
    let user = Database.getUserByUserId(userId);
    if (!user || syncStatusBeforeLogin.state !== 'synced') {
      try {
        await Database.hydrateFromServerBatches(Database.getStartupRemoteSyncBatches(), {
          strict: true,
          maxAttempts: 3,
          timeoutMs: 60000,
          retryDelayMs: 2000,
          continueOnError: true,
          requireAnySuccess: true
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
    // Auto-deactivate if direct referral deadline passed
    if (user.isActive && user.activatedAt && !user.isAdmin) {
      Database.checkDirectReferralDeadline(user.id);
      user = Database.getUserById(user.id) || user;
    }
    if (!user.isActive) {
      if (user.deactivationReason === 'direct_referral_deadline') {
        return { success: false, message: 'Your ID is inactive as per direct refer terms & conditions.' };
      }
      return { success: false, message: 'Account is inactive. Contact admin.' };
    }
    if (user.password !== password) {
      return { success: false, message: 'Invalid password' };
    }
    Database.setCurrentUser(user);
    set({ user: Database.getCurrentUser() || user, isAuthenticated: true });
    // Load deferred data in background
    void Database.hydrateFromServerBatches(Database.getStartupDeferredRemoteSyncBatches(), {
      strict: false, maxAttempts: 3, timeoutMs: 60000, retryDelayMs: 2000,
      continueOnError: true, requireAnySuccess: false
    }).catch(() => { /* deferred data is non-critical */ });
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
    const canonicalTargetUser = Database.getUserByUserId(targetUser.userId) || Database.getUserById(targetUser.id) || targetUser;

    // Start impersonation session
    Database.startImpersonation({
      adminId: adminUser.id,
      adminUserId: adminUser.userId,
      targetUserId: canonicalTargetUser.id,
      targetUserName: canonicalTargetUser.fullName,
      startedAt: new Date().toISOString(),
      isActive: true
    });

    set({ impersonatedUser: canonicalTargetUser });
    return { success: true, message: `Now logged in as ${canonicalTargetUser.fullName}` };
  },

  endImpersonation: () => {
    const adminUser = get().user;
    if (adminUser) {
      Database.endImpersonation(adminUser.id);
    }
    set({ impersonatedUser: null });
  },

  register: async (userData: RegisterData) => {
    await Database.ensureFreshData();

    const registrationGate = Database.getSensitiveActionSyncGate();
    // Allow registration if sync is just pending/slow; only block when truly offline
    if (!registrationGate.allowed && registrationGate.status.state === 'offline') {
      return { success: false, message: registrationGate.message };
    }

    const { fullName, email, password, transactionPassword, phone, country, sponsorId, pinCode } = userData;
    const normalizedPhone = normalizePhoneNumber(phone);

    // Check if email exists
    if (Database.getUserByEmail(email)) {
      return { success: false, message: 'Email already exists' };
    }

    if (!isValidPhoneNumberForCountry(phone, country)) {
      return { success: false, message: 'Enter a valid mobile number for the selected country' };
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

    let newUser: User;
    let newUserId = '';
    try {
      const result = await Database.runWithLocalStateTransaction(() => {
        // Generate unique 7-digit ID
        const generatedUserId = Database.generateUniqueUserId();

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
        const createdUser: User = {
          id: `user_${Date.now()}`,
          userId: generatedUserId,
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
          deactivationReason: null,
          reactivatedAt: null,
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

        Database.createUser(createdUser);
        Database.applyAnnouncementsForNewUser(createdUser.id);

        // Strict PIN guard: re-check right before consuming to prevent stale/duplicate use
        const latestPin = Database.getPinByCode(pinCode);
        if (!latestPin || latestPin.status !== 'unused') {
          throw new Error('PIN has already been used');
        }
        const consumedPin = Database.consumePin(pinCode, createdUser.id);
        if (!consumedPin) {
          throw new Error('PIN has already been used');
        }

        // Add to matrix
        const matrixNode: MatrixNode = {
          userId: generatedUserId,
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
              parentNode.leftChild = generatedUserId;
            } else {
              parentNode.rightChild = generatedUserId;
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
          userId: createdUser.id,
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

        // Referral income
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
              fromUserId: createdUser.id,
              status: 'completed',
              description: `Referral income from ${createdUser.fullName} (${createdUser.userId})`,
              createdAt: new Date().toISOString(),
              completedAt: new Date().toISOString()
            });
            // Try to collect any pending system fee from sponsor now that income arrived
            Database.deductPendingSystemFee(sponsor.id);
          }
        } else {
          Database.addToSafetyPool(directIncome, createdUser.id, 'No sponsor - referral income');
        }

        // Admin fee to safety pool
        Database.addToSafetyPool(adminFee, createdUser.id, 'Admin fee');

        // Process matrix-level help payouts (binary tree event tracking, give-help/receive-help)
        Database.processMatrixHelpForNewMember(generatedUserId, createdUser.id);

        // Send welcome notification
        Database.createNotification({
          id: `notif_${Date.now()}`,
          userId: createdUser.id,
          title: 'Welcome To ReferNex',
          message: `Welcome to ReferNex.\n\nAccount created successfully. Your User ID is ${generatedUserId}. Please check your email for your login and transaction passwords.`,
          type: 'success',
          isRead: false,
          createdAt: new Date().toISOString()
        });

        return { newUser: createdUser, newUserId: generatedUserId };
      }, {
        syncOnCommit: true,
        syncOptions: {
          full: false,
          force: true,
          timeoutMs: 120000,
          maxAttempts: 3,
          retryDelayMs: 2000
        }
      });
      newUser = result.newUser;
      newUserId = result.newUserId;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message && /pin/i.test(message)) {
        return { success: false, message };
      }
      return { success: false, message: 'ID creation failed. Please try again after some time.' };
    }

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
      const updatedUser = await Database.commitCriticalAction(() => Database.updateUser(targetUser.id, updates));
      if (updatedUser) {
        if (impersonatedUser) {
          set({ impersonatedUser: updatedUser });
        } else {
          Database.setCurrentUser(updatedUser);
          set({ user: updatedUser });
        }
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
    sourceWallet?: 'fund' | 'income' | 'royalty',
    destinationWallet?: 'fund' | 'income',
    security?: {
      transactionPassword?: string;
      otp?: string;
    }
  ) => Promise<{ success: boolean; message: string }>;
  withdraw: (
    userId: string,
    amount: number,
    walletAddress: string,
    payoutQrCode?: string
  ) => Promise<{ success: boolean; message: string }>;
  refreshTransactions: (userId: string) => void;
}

export const useWalletStore = create<WalletState>((set, get) => ({
  wallet: null,
  transactions: [],

  loadWallet: (userId: string) => {
    Database.repairLockedIncomeTrackerFromTransactions(userId);
    Database.repairIncomeWalletConsistency(userId);
    Database.repairFundWalletConsistency(userId);
    Database.repairRoyaltyWalletConsistency(userId);
    Database.syncLockedIncomeWallet(userId);
    // Process monthly system fee if due
    Database.processMonthlySystemFee(userId);
    // Check direct referral deadline auto-deactivation
    Database.checkDirectReferralDeadline(userId);
    const wallet = Database.getWallet(userId);
    const transactions = Database.getUserTransactions(userId);
    set({ wallet, transactions });
  },

  transferFunds: async (
    fromUserId: string,
    toUserId: string,
    amount: number,
    sourceWallet: 'fund' | 'income' | 'royalty' = 'fund',
    destinationWallet: 'fund' | 'income' = 'fund',
    security?: {
      transactionPassword?: string;
      otp?: string;
    }
  ) => {
    await Database.ensureFreshData();

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

    if (sourceWallet === 'royalty') {
      const royaltyBalance = fromWallet.royaltyWallet || 0;
      if (royaltyBalance < amount) {
        return { success: false, message: 'Insufficient royalty wallet balance' };
      }

      await Database.runWithLocalStateTransaction(async () => {
        Database.updateWallet(fromUserId, {
          royaltyWallet: royaltyBalance - amount,
          incomeWallet: destinationWallet === 'income' ? fromWallet.incomeWallet + amount : fromWallet.incomeWallet,
          depositWallet: destinationWallet === 'fund' ? fromWallet.depositWallet + amount : fromWallet.depositWallet
        });

        const now = new Date().toISOString();
        const baseNow = Date.now();
        const royaltySendTxId = `tx_${baseNow}_royalty_send`;

        Database.createTransaction({
          id: royaltySendTxId,
          userId: fromUserId,
          type: 'royalty_transfer',
          amount: -amount,
          toUserId: fromUserId,
          status: 'completed',
          description: `Transferred from royalty wallet to your ${destinationWallet} wallet`,
          createdAt: now,
          completedAt: now
        });

        Database.createTransaction({
          id: `tx_${baseNow}_royalty_recv_${destinationWallet}`,
          userId: fromUserId,
          type: destinationWallet === 'income' ? 'royalty_transfer' : 'p2p_transfer',
          amount,
          fromUserId,
          sourceTransferTxId: royaltySendTxId,
          status: 'completed',
          description: destinationWallet === 'income'
            ? 'Income wallet credited from your royalty wallet transfer'
            : 'Fund wallet credited from your royalty wallet transfer',
          createdAt: now,
          completedAt: now
        });
      }, {
        syncOnCommit: true,
        syncOptions: {
          full: false,
          force: true,
          timeoutMs: 60000,
          maxAttempts: 3,
          retryDelayMs: 1500
        }
      });

      get().loadWallet(fromUserId);
      return {
        success: true,
        message: destinationWallet === 'income'
          ? 'Royalty transferred to your income wallet successfully'
          : 'Royalty transferred to your fund wallet successfully'
      };
    }

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

      await Database.runWithLocalStateTransaction(async () => {
        Database.updateWallet(fromUserId, {
          incomeWallet: fromWallet.incomeWallet - amount
        });

        Database.updateWallet(toUser.id, {
          depositWallet: toWallet.depositWallet + amount
        });

        const now = new Date().toISOString();
        const baseNow = Date.now();
        const incomeSendTxId = `tx_${baseNow}_income_send`;
        Database.createTransaction({
          id: incomeSendTxId,
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

        if (isSelfTransfer) {
          Database.createTransaction({
            id: `tx_${baseNow}_fund_recv_self`,
            userId: fromUserId,
            type: 'p2p_transfer',
            amount,
            fromUserId,
            sourceTransferTxId: incomeSendTxId,
            status: 'completed',
            description: 'Fund wallet credited from your income wallet transfer',
            createdAt: now,
            completedAt: now
          });
        } else {
          Database.createTransaction({
            id: `tx_${baseNow}_income_recv`,
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
      }, {
        syncOnCommit: true,
        syncOptions: {
          full: false,
          force: true,
          timeoutMs: 60000,
          maxAttempts: 3,
          retryDelayMs: 1500
        }
      });

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
    await Database.runWithLocalStateTransaction(async () => {
      Database.updateWallet(fromUserId, {
        depositWallet: fromWallet.depositWallet - amount
      });

      Database.updateWallet(toUser.id, {
        depositWallet: toWallet.depositWallet + amount
      });

      const now = new Date().toISOString();
      const baseNow = Date.now();
      Database.createTransaction({
        id: `tx_${baseNow}_send`,
        userId: fromUserId,
        type: 'p2p_transfer',
        amount: -amount,
        toUserId: toUser.id,
        status: 'completed',
        description: `Fund wallet transfer to ${toUser.fullName} (${toUser.userId})`,
        createdAt: now,
        completedAt: now
      });

      Database.createTransaction({
        id: `tx_${baseNow}_recv`,
        userId: toUser.id,
        type: 'p2p_transfer',
        amount,
        fromUserId,
        status: 'completed',
        description: `Fund wallet transfer from ${fromUser.fullName} (${fromUser.userId})`,
        createdAt: now,
        completedAt: now
      });
    }, {
      syncOnCommit: true,
      syncOptions: {
        full: false,
        force: true,
        timeoutMs: 60000,
        maxAttempts: 3,
        retryDelayMs: 1500
      }
    });

    get().loadWallet(fromUserId);

    return { success: true, message: 'Transfer successful' };
  },

  withdraw: async (userId: string, amount: number, walletAddress: string, payoutQrCode?: string) => {
    try {
      await Database.ensureFreshData();

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
      const amountInCents = Math.round(amount * 100);
      if (amountInCents < 1000) {
        return { success: false, message: 'Minimum withdrawal amount is $10' };
      }
      if (amountInCents % 1000 !== 0) {
        return { success: false, message: 'Withdrawal amount must be in multiples of $10 (10, 20, 30...)' };
      }

      const resolvedWalletAddress = String(walletAddress || '').trim();
      if (!resolvedWalletAddress) {
        return { success: false, message: 'USDT (BEP20) address is required.' };
      }

      const resolvedPayoutQrCode = String(payoutQrCode || '').trim();

      // Use income wallet for withdrawals
      const availableWithdrawableBalance = Math.max(0, wallet.incomeWallet - (wallet.giveHelpLocked || 0));
      if (availableWithdrawableBalance < amount) {
        return { success: false, message: 'Insufficient withdrawable balance (some amount is locked for give-help)' };
      }

      const fee = amount * (settings.withdrawalFeePercent / 100);
      const netAmount = amount - fee;

      await Database.runWithLocalStateTransaction(async () => {
        const now = new Date().toISOString();
        const baseNow = Date.now();

        // Deduct from wallet immediately and keep request pending until admin verifies.
        // If rejected, amount will be refunded by admin action.
        Database.updateWallet(userId, {
          incomeWallet: wallet.incomeWallet - amount
        });

        Database.createTransaction({
          id: `tx_${baseNow}_withdraw`,
          userId,
          type: 'withdrawal',
          amount: -amount,
          status: 'pending',
          description: 'Withdrawal request submitted. It will be processed within 72 hours.',
          walletAddress: resolvedWalletAddress,
          ...(resolvedPayoutQrCode ? { payoutQrCode: resolvedPayoutQrCode } : {}),
          requesterUserId: user.userId,
          requesterName: user.fullName,
          fee,
          netAmount,
          createdAt: now
        });
      }, {
        syncOnCommit: true,
        syncOptions: {
          full: false,
          force: true,
          timeoutMs: 60000,
          maxAttempts: 3,
          retryDelayMs: 1500
        }
      });

      get().loadWallet(userId);
      get().refreshTransactions(userId);

      return { success: true, message: `Withdrawal request submitted for $${netAmount.toFixed(2)} after fee. Processing time: up to 72 hours.` };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error
          ? `Withdrawal could not be safely submitted: ${error.message}`
          : 'Withdrawal could not be safely submitted. Please try again.'
      };
    }
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
  transferPinsBulk: (pinIds: string[], fromUserId: string, toUserId: string) => Promise<{ success: boolean; message: string }>;
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
      await Database.ensureFreshData();

      const normalizedTarget = (toUserId || '').replace(/\D/g, '').slice(0, 7);
      const toUser = Database.getUserByUserId(normalizedTarget) || Database.getUserById(toUserId);
      if (!toUser) {
        return { success: false, message: 'Recipient not found' };
      }

      // Check if in same chain
      if (!Database.isInSameChain(fromUserId, toUser.id)) {
        return { success: false, message: 'PIN can only be transferred to upline or downline members' };
      }

      const result = Database.transferPin(pinId, toUser.id, fromUserId);
      if (!result) {
        return { success: false, message: 'Failed to transfer PIN' };
      }

      // Reload pins
      get().loadPins(fromUserId);

      try {
        await Database.forceRemoteSyncNowWithOptions({ full: false, force: true, timeoutMs: 15000, maxAttempts: 2, retryDelayMs: 1200 });
        await Database.hydrateFromServer({ strict: true, maxAttempts: 2, timeoutMs: 12000, retryDelayMs: 800 });
        get().loadPins(fromUserId);
      } catch {
        // best-effort sync
      }

      return { success: true, message: `PIN transferred to ${toUser.fullName}` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Transfer failed';
      return { success: false, message };
    }
  },

  transferPinsBulk: async (pinIds: string[], fromUserId: string, toUserId: string) => {
    if (pinIds.length === 0) {
      return { success: false, message: 'No PINs selected' };
    }
    try {
      await Database.ensureFreshData();

      const normalizedTarget = (toUserId || '').replace(/\D/g, '').slice(0, 7);
      const toUser = Database.getUserByUserId(normalizedTarget) || Database.getUserById(toUserId);
      if (!toUser) {
        return { success: false, message: 'Recipient not found' };
      }
      if (!Database.isInSameChain(fromUserId, toUser.id)) {
        return { success: false, message: 'PIN can only be transferred to upline or downline members' };
      }

      let transferred = 0;
      for (const pinId of pinIds) {
        try {
          const result = Database.transferPin(pinId, toUser.id, fromUserId);
          if (result) {
            transferred += 1;
          }
        } catch {
          // ignore individual failures
        }
      }

      if (transferred === 0) {
        return { success: false, message: 'Failed to transfer selected PINs' };
      }

      get().loadPins(fromUserId);

      try {
        await Database.forceRemoteSyncNowWithOptions({ full: false, force: true, timeoutMs: 15000, maxAttempts: 2, retryDelayMs: 1200 });
        await Database.hydrateFromServer({ strict: true, maxAttempts: 2, timeoutMs: 12000, retryDelayMs: 800 });
        get().loadPins(fromUserId);
      } catch {
        // best-effort sync
      }

      const suffix = transferred === pinIds.length ? '' : ` (${transferred}/${pinIds.length})`;
      return { success: true, message: `PINs transferred to ${toUser.fullName}${suffix}` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Bulk transfer failed';
      return { success: false, message };
    }
  },

  requestPinPurchase: async (userId: string, quantity: number, options) => {
    await Database.ensureFreshData();

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
    useWalletStore.getState().loadWallet(userId);

    try {
      await Database.forceRemoteSyncNowWithOptions({ full: false, force: true, timeoutMs: 15000, maxAttempts: 2, retryDelayMs: 1200 });
      await Database.hydrateFromServer({ strict: true, maxAttempts: 2, timeoutMs: 12000, retryDelayMs: 800 });
      get().loadPins(userId);
      get().loadPurchaseRequests(userId);
      useWalletStore.getState().loadWallet(userId);
    } catch {
      // best-effort sync; UI will show pending sync if offline
    }

    return {
      success: true,
      message: paidFromWallet
        ? `PIN purchase request for ${quantity} PIN(s) submitted from fund wallet`
        : `PIN purchase request for ${quantity} PIN(s) submitted for admin verification`
    };
  },

  buyPinsDirect: async (userId: string, quantity: number) => {
    await Database.ensureFreshData();

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
    useWalletStore.getState().loadWallet(userId);

    try {
      await Database.forceRemoteSyncNowWithOptions({ full: false, force: true, timeoutMs: 15000, maxAttempts: 2, retryDelayMs: 1200 });
      await Database.hydrateFromServer({ strict: true, maxAttempts: 2, timeoutMs: 12000, retryDelayMs: 800 });
      get().loadPins(userId);
      get().loadPurchaseRequests(userId);
      useWalletStore.getState().loadWallet(userId);
    } catch {
      // best-effort sync; UI will show pending sync if offline
    }

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
  reactivateAutoDeactivatedUser: (targetUserId: string) => Promise<{ success: boolean; message: string }>;
  addFundsToUser: (
    userId: string,
    amount: number,
    walletType: 'deposit' | 'income' | 'royalty',
    note?: string
  ) => Promise<{ success: boolean; message: string }>;
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
  createServerBackup: () => Promise<{ success: boolean; message: string; backup?: any }>;
  deleteAllIdsFromSystem: () => Promise<{ success: boolean; message: string; report?: any }>;
  // Marketplace
  marketplaceCategories: MarketplaceCategory[];
  marketplaceRetailers: MarketplaceRetailer[];
  marketplaceBanners: MarketplaceBanner[];
  marketplaceDeals: MarketplaceDeal[];
  marketplaceInvoices: MarketplaceInvoice[];
  marketplaceRedemptions: RewardRedemption[];
  loadMarketplaceData: () => void;
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
  // Marketplace
  marketplaceCategories: [],
  marketplaceRetailers: [],
  marketplaceBanners: [],
  marketplaceDeals: [],
  marketplaceInvoices: [],
  marketplaceRedemptions: [],

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
    await Database.ensureFreshData();

    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can generate PINs' };
    }

    const pins = Database.generatePins(quantity, ownerId, adminUser.id);
    get().loadAllPins();

    try {
      await Database.forceRemoteSyncNowWithOptions({ full: false, force: true, timeoutMs: 15000, maxAttempts: 2, retryDelayMs: 1200 });
      await Database.hydrateFromServer({ strict: true, maxAttempts: 2, timeoutMs: 12000, retryDelayMs: 800 });
      get().loadAllPins();
    } catch {
      // best-effort sync
    }

    return { success: true, message: `Generated ${quantity} PIN(s)`, pins };
  },

  approvePinPurchase: async (requestId: string) => {
    await Database.ensureFreshData();

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

    try {
      await Database.forceRemoteSyncNowWithOptions({ full: false, force: true, timeoutMs: 15000, maxAttempts: 2, retryDelayMs: 1200 });
      await Database.hydrateFromServer({ strict: true, maxAttempts: 2, timeoutMs: 12000, retryDelayMs: 800 });
      get().loadPendingPinRequests();
      get().loadAllPinRequests();
      get().loadAllPins();
    } catch {
      // best-effort sync
    }

    return { success: true, message: 'PIN purchase approved and PINs generated' };
  },

  rejectPinPurchase: async (requestId: string, reason: string) => {
    await Database.ensureFreshData();

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
    await Database.ensureFreshData();

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
    await Database.ensureFreshData();

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
    await Database.ensureFreshData();

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

  reactivateAutoDeactivatedUser: async (targetUserId: string) => {
    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can reactivate users' };
    }

    const targetUser = Database.getUserByUserId(targetUserId);
    if (!targetUser) {
      return { success: false, message: 'User not found' };
    }

    if (targetUser.deactivationReason !== 'direct_referral_deadline') {
      return { success: false, message: 'User was not auto-deactivated for direct referral deadline' };
    }

    const result = Database.reactivateUser(targetUser.id);
    if (!result) {
      return { success: false, message: 'Failed to reactivate user' };
    }

    get().loadAllUsers();
    return { success: true, message: `User ${targetUserId} reactivated. 30-day deadline restarted.` };
  },

  addFundsToUser: async (userId: string, amount: number, walletType: 'deposit' | 'income' | 'royalty' = 'deposit', note?: string) => {
    await Database.ensureFreshData();

    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can add funds' };
    }

    const user = Database.getUserByUserId(userId);
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    const wallet = Database.getWallet(user.id);
    if (!wallet) {
      return { success: false, message: 'User wallet not found' };
    }

    if (walletType === 'royalty') {
      const pool = Database.getSafetyPool();
      if ((pool.totalAmount || 0) < amount) {
        return { success: false, message: 'Insufficient safety pool balance for royalty payout' };
      }

      const txMessage = String(note || '').trim() || 'Royalty credited by admin';
      const poolReason = `Royalty Payout: ${user.fullName} (${user.userId})${txMessage ? ` - ${txMessage}` : ''}`;

      await Database.runWithLocalStateTransaction(async () => {
        Database.deductFromSafetyPool(amount, adminUser.id, poolReason);
        Database.updateWallet(user.id, {
          royaltyWallet: (wallet.royaltyWallet || 0) + amount,
          totalReceived: (wallet.totalReceived || 0) + amount
        });

        Database.createTransaction({
          id: `tx_${Date.now()}_admin`,
          userId: user.id,
          type: 'royalty_income',
          amount,
          status: 'completed',
          description: txMessage,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        });
      }, {
        syncOnCommit: true,
        syncOptions: {
          full: false,
          force: true,
          timeoutMs: 30000,
          maxAttempts: 3,
          retryDelayMs: 1500
        }
      });

      get().loadStats();
      return { success: true, message: `Sent $${amount} royalty to user from safety pool` };
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

    Database.deductPendingSystemFee(user.id);
    get().loadStats();

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
          const baseName = params.namePrefix.trim();
          const fullName = quantity > 1
            ? `${baseName} ${String(i + 1).padStart(3, '0')}`
            : baseName;
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
          Database.applyAnnouncementsForNewUser(newUser.id);

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
              description: `Referral income from ${newUser.fullName} (${newUser.userId})`,
              createdAt: new Date().toISOString(),
              completedAt: new Date().toISOString()
            });
          } else {
            Database.addToSafetyPool(directIncome, newUser.id, 'No sponsor - referral income');
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
          // Try to collect any pending system fee now that income arrived
          Database.deductPendingSystemFee(latestSponsor.id);
        }
        Database.releaseLockedGiveHelp(latestSponsor.id);
        Database.releaseLockedReceiveHelp(latestSponsor.id);
      }

      // Run the pending-contributions sweep ONCE after the entire batch,
      // instead of per-user (which was skipped during bulk via remoteSyncSuspendDepth).
      if (createdUserIds.length > 0) {
        Database.sweepPendingContributions();
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

  createServerBackup: async () => {
    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can create backups' };
    }

    try {
      const backup = await createServerStateBackup({
        prefix: 'manual-backup',
        source: 'admin',
        reason: 'manual_backup'
      });
      return {
        success: true,
        message: `Backup created: ${backup.fileName}`,
        backup
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Backup creation failed'
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
  },

  loadMarketplaceData: () => {
    set({
      marketplaceCategories: Database.getMarketplaceCategories(),
      marketplaceRetailers: Database.getMarketplaceRetailers(),
      marketplaceBanners: Database.getMarketplaceBanners(),
      marketplaceDeals: Database.getMarketplaceDeals(),
      marketplaceInvoices: Database.getMarketplaceInvoices(),
      marketplaceRedemptions: Database.getMarketplaceRedemptions(),
    });
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

/**
 * Hook that returns a counter that increments every time backend sync completes.
 * Use as a useEffect dependency to re-load data after hydration finishes.
 */
export function useSyncRefreshKey(): number {
  const [key, setKey] = useState(0);
  const prevState = useRef(Database.getRemoteSyncStatus().state);

  useEffect(() => {
    return Database.subscribeRemoteSyncStatus((status) => {
      if (status.state === 'synced' && prevState.current !== 'synced') {
        setKey((k) => k + 1);
      }
      prevState.current = status.state;
    });
  }, []);

  return key;
}

let lockedIncomeAutoReleaseBound = false;
let lockedIncomeAutoReleaseTimer: ReturnType<typeof setInterval> | null = null;
function bindLockedIncomeAutoRelease(): void {
  if (lockedIncomeAutoReleaseBound) return;
  lockedIncomeAutoReleaseBound = true;
  if (lockedIncomeAutoReleaseTimer) {
    clearInterval(lockedIncomeAutoReleaseTimer);
    lockedIncomeAutoReleaseTimer = null;
  }
}

bindLockedIncomeAutoRelease();
