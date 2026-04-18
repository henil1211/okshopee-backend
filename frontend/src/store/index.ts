import { create } from 'zustand';
import { useEffect, useRef, useState } from 'react';
import type {
  User, Wallet, Transaction, TransactionStatus, TransactionType, MatrixNode, Notification,
  AdminSettings, DashboardStats, Pin, PinTransfer, PinPurchaseRequest, RegisterData, PaymentMethodType,
  MarketplaceCategory, MarketplaceRetailer, MarketplaceBanner, MarketplaceDeal,
  MarketplaceInvoice, RewardRedemption
} from '@/types';
import Database, { DB_KEYS } from '@/db';
import { AUTH_MAINTENANCE_ENABLED, AUTH_MAINTENANCE_MESSAGE } from '@/lib/maintenance';
import { resolveBackendBaseUrl } from '@/utils/backendBaseUrl';
import { isValidPhoneNumberForCountry, normalizePhoneNumber } from '@/utils/helpers';

type SystemEmailPurpose = 'otp' | 'welcome' | 'system';

function getBackendApiBase(): string {
  const env = (import.meta as { env?: Record<string, string | boolean | undefined> }).env || {};
  const configured = typeof env.VITE_BACKEND_URL === 'string' ? env.VITE_BACKEND_URL.trim() : '';
  return resolveBackendBaseUrl(configured);
}

function normalizeRemoteRebuildError(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload?.error === 'string'
    ? payload.error
    : typeof payload?.message === 'string'
      ? payload.message
      : fallback;
}

function generateClientIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function generateClientRequestId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeV2ApiErrorMessage(status: number, payload: Record<string, unknown>, fallback: string): string {
  const code = typeof payload?.code === 'string' ? payload.code : '';
  const backendMessage = typeof payload?.error === 'string'
    ? payload.error
    : typeof payload?.message === 'string'
      ? payload.message
      : '';

  if (status === 409) {
    if (code === 'IDEMPOTENCY_IN_PROGRESS') {
      return 'This request is already being processed. Please wait a moment and refresh.';
    }
    if (code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') {
      return 'Request conflict detected. Please retry the action from the form.';
    }
    if (code === 'INSUFFICIENT_FUNDS') {
      return backendMessage || 'Insufficient wallet balance for this action.';
    }
    return backendMessage || 'Request conflict. Please retry once.';
  }

  if (status === 400) {
    return backendMessage || 'Invalid request payload. Please review the form values.';
  }

  if (status === 401 || status === 403) {
    return backendMessage || 'Authentication session expired. Please login again.';
  }

  return backendMessage || `${fallback} (HTTP ${status})`;
}

const V2_TRANSFER_SYNC_REQUIRED_MESSAGE = 'Live V2 sync is unavailable. Transfer data may be stale. Please refresh and try again.';

function resolveV2BearerTokenOrError(subjectUser: User): { token: string } | { message: string } {
  const savedAuthSession = Database.getV2AuthSession();
  const signedAccessToken = String(savedAuthSession?.accessToken || '').trim();
  if (signedAccessToken) {
    return { token: signedAccessToken };
  }

  const legacyNote = String(savedAuthSession?.note || '').toLowerCase();
  const legacyFallbackAllowed = legacyNote.includes('legacy bearer usercode compatibility remains enabled');
  if (legacyFallbackAllowed) {
    const legacyToken = String(subjectUser.userId || '').trim();
    if (legacyToken) {
      return { token: legacyToken };
    }
  }

  return { message: 'V2 session is missing or expired. Please logout and login again.' };
}

function resolveV2RequestHeaders(params: {
  idempotencyKey: string;
  requestId: string;
  impersonationReason: string;
}): { headers: Record<string, string> } | { message: string } {
  const authState = useAuthStore.getState();
  const subjectUser = authState.user;
  const impersonatedUser = authState.impersonatedUser;

  if (!subjectUser) {
    return { message: 'Authentication session expired. Please login again.' };
  }

  const bearerTokenResult = resolveV2BearerTokenOrError(subjectUser);
  if (!('token' in bearerTokenResult)) {
    return { message: bearerTokenResult.message };
  }
  const bearerToken = bearerTokenResult.token;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${bearerToken}`,
    'Idempotency-Key': params.idempotencyKey,
    'X-System-Version': 'v2',
    'X-Request-Id': params.requestId
  };

  if (impersonatedUser && subjectUser.isAdmin) {
    headers['X-Impersonate-User-Code'] = impersonatedUser.userId;
    headers['X-Impersonation-Reason'] = params.impersonationReason;
  }

  return { headers };
}

function resolveV2ReadRequestHeaders(params: {
  requestId: string;
  impersonationReason: string;
}): { headers: Record<string, string> } | { message: string } {
  const authState = useAuthStore.getState();
  const subjectUser = authState.user;
  const impersonatedUser = authState.impersonatedUser;

  if (!subjectUser) {
    return { message: 'Authentication session expired. Please login again.' };
  }

  const bearerTokenResult = resolveV2BearerTokenOrError(subjectUser);
  if (!('token' in bearerTokenResult)) {
    return { message: bearerTokenResult.message };
  }
  const bearerToken = bearerTokenResult.token;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${bearerToken}`,
    'X-System-Version': 'v2',
    'X-Request-Id': params.requestId
  };

  if (impersonatedUser && subjectUser.isAdmin) {
    headers['X-Impersonate-User-Code'] = impersonatedUser.userId;
    headers['X-Impersonation-Reason'] = params.impersonationReason;
  }

  return { headers };
}

let walletLoadRequestSequence = 0;
let walletTransactionsRequestSequence = 0;

function resolveActiveWalletContextUser(): User | null {
  const authState = useAuthStore.getState();
  const activeUser = authState.impersonatedUser || authState.user;
  if (!activeUser) return null;
  return resolveCanonicalUserForWalletActions(activeUser.id)
    || Database.getUserByUserId(activeUser.userId)
    || Database.getUserById(activeUser.id)
    || activeUser;
}

function isAdminImpersonationActive(): boolean {
  const authState = useAuthStore.getState();
  return !!(authState.user?.isAdmin && authState.impersonatedUser);
}

function normalizePurchasedPinCodes(rawPinCodes: unknown): string[] {
  if (!Array.isArray(rawPinCodes)) return [];

  const normalized = rawPinCodes
    .map((value) => String(value || '').trim().toUpperCase())
    .filter((value) => value.length >= 6 && value.length <= 40);

  return Array.from(new Set(normalized));
}

function upsertPurchasedPinsIntoLocalCache(params: {
  ownerInternalUserId: string;
  pinPriceCents: number;
  pinCodes: string[];
  createdByRef: string;
}): boolean {
  const ownerInternalUserId = String(params.ownerInternalUserId || '').trim();
  if (!ownerInternalUserId || params.pinCodes.length === 0) {
    return false;
  }

  const existingPins = Database.getPins();
  const existingCodes = new Set(existingPins.map((pin) => String(pin.pinCode || '').trim().toUpperCase()));
  const now = new Date().toISOString();
  const amount = Math.max(0, Number(params.pinPriceCents || 0) / 100);
  const createdByRef = String(params.createdByRef || '').trim() || ownerInternalUserId;
  const pinsToAdd: Pin[] = [];

  params.pinCodes.forEach((pinCode, index) => {
    const normalizedCode = String(pinCode || '').trim().toUpperCase();
    if (!normalizedCode || existingCodes.has(normalizedCode)) {
      return;
    }

    pinsToAdd.push({
      id: `pin_v2_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
      pinCode: normalizedCode,
      amount,
      status: 'unused',
      ownerId: ownerInternalUserId,
      createdBy: createdByRef,
      createdAt: now
    });
    existingCodes.add(normalizedCode);
  });

  if (pinsToAdd.length === 0) {
    return false;
  }

  Database.savePins([...existingPins, ...pinsToAdd]);
  return true;
}

function mapV2PinStatusToLocalPinStatus(status: unknown): Pin['status'] {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'generated') return 'unused';
  if (normalized === 'used') return 'used';
  if (normalized === 'expired' || normalized === 'cancelled') return 'suspended';
  return 'unused';
}

function mapV2TransactionStatusToPaymentStatus(status: unknown): PinPurchaseRequest['status'] {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed') return 'completed';
  if (normalized === 'reversed') return 'reversed';
  if (normalized === 'cancelled') return 'cancelled';
  return 'pending';
}

function inferPinQuantityFromV2Purchase(params: {
  referenceId: unknown;
  description: unknown;
  signedAmountCents: unknown;
  pinAmountDollars: number;
}): number {
  const referenceId = String(params.referenceId || '').trim();
  const refMatch = referenceId.match(/:(\d+)$/);
  if (refMatch) {
    const qty = Number(refMatch[1]);
    if (Number.isInteger(qty) && qty > 0) return qty;
  }

  const description = String(params.description || '').trim();
  const descMatch = description.match(/(\d+)\s*pin/i);
  if (descMatch) {
    const qty = Number(descMatch[1]);
    if (Number.isInteger(qty) && qty > 0) return qty;
  }

  const amountCents = Math.abs(Number(params.signedAmountCents || 0));
  const pinAmountCents = Math.max(1, Math.round(Number(params.pinAmountDollars || 11) * 100));
  if (amountCents > 0) {
    const inferredQty = Math.max(1, Math.round(amountCents / pinAmountCents));
    if (Number.isInteger(inferredQty) && inferredQty > 0) return inferredQty;
  }

  return 1;
}

function mergePinRequestRecordsById(existing: PinPurchaseRequest[], incoming: PinPurchaseRequest[]): PinPurchaseRequest[] {
  const byId = new Map<string, PinPurchaseRequest>();

  for (const request of existing) {
    const id = String(request?.id || '').trim();
    if (!id) continue;
    byId.set(id, request);
  }

  for (const request of incoming) {
    const id = String(request?.id || '').trim();
    if (!id) continue;
    const current = byId.get(id);
    if (!current) {
      byId.set(id, request);
      continue;
    }

    const existingPins = Array.isArray(current.pinsGenerated) ? current.pinsGenerated : [];
    const incomingPins = Array.isArray(request.pinsGenerated) ? request.pinsGenerated : [];
    const mergedPins = Array.from(new Set([...existingPins, ...incomingPins]));

    byId.set(id, {
      ...current,
      ...request,
      pinsGenerated: mergedPins.length > 0 ? mergedPins : undefined
    });
  }

  return Array.from(byId.values()).sort((left, right) => {
    const rightTs = new Date(String(right.createdAt || '')).getTime() || 0;
    const leftTs = new Date(String(left.createdAt || '')).getTime() || 0;
    return rightTs - leftTs;
  });
}

function upsertDirectPinPurchaseRequestIntoLocalCache(params: {
  ownerInternalUserId: string;
  quantity: number;
  amount: number;
  pinCodes: string[];
  txUuid?: unknown;
  ledgerTransactionId?: unknown;
  createdAt?: unknown;
}): void {
  const ownerInternalUserId = String(params.ownerInternalUserId || '').trim();
  if (!ownerInternalUserId) return;

  const ledgerTxId = Number(params.ledgerTransactionId || 0);
  const txUuid = String(params.txUuid || '').trim();
  const requestId = Number.isInteger(ledgerTxId) && ledgerTxId > 0
    ? `v2_direct_${ledgerTxId}`
    : txUuid
      ? `v2_direct_${txUuid}`
      : `v2_direct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const createdAt = typeof params.createdAt === 'string' && params.createdAt.trim()
    ? params.createdAt
    : new Date().toISOString();
  const quantity = Math.max(1, Number.isFinite(Number(params.quantity)) ? Math.trunc(Number(params.quantity)) : 1);
  const amount = Math.max(0, Number(params.amount || 0));
  const normalizedPinCodes = normalizePurchasedPinCodes(params.pinCodes);

  const incoming: PinPurchaseRequest = {
    id: requestId,
    userId: ownerInternalUserId,
    quantity,
    amount,
    status: 'completed',
    purchaseType: 'direct',
    paidFromWallet: true,
    createdAt,
    processedAt: createdAt,
    processedBy: 'v2_system',
    pinsGenerated: normalizedPinCodes.length > 0 ? normalizedPinCodes : undefined
  };

  const allRequests = Database.getPinPurchaseRequests();
  const otherUsers = allRequests.filter((request) => String(request.userId || '').trim() !== ownerInternalUserId);
  const ownerRequests = allRequests.filter((request) => String(request.userId || '').trim() === ownerInternalUserId);
  const mergedOwner = mergePinRequestRecordsById(ownerRequests, [incoming]);
  Database.savePinPurchaseRequests([...otherUsers, ...mergedOwner]);
}

function mergeV2PinsWithLegacyTransitionPins(v2Pins: Pin[], legacyPins: Pin[]): Pin[] {
  const mergedByCode = new Map<string, Pin>();

  for (const pin of v2Pins) {
    const pinCode = String(pin.pinCode || '').trim().toUpperCase();
    if (!pinCode) continue;
    mergedByCode.set(pinCode, pin);
  }

  for (const pin of legacyPins) {
    const pinCode = String(pin.pinCode || '').trim().toUpperCase();
    if (!pinCode || mergedByCode.has(pinCode)) continue;

    const shouldCarryForward = pin.status === 'transferred' || !!pin.transferredFrom;
    if (!shouldCarryForward) continue;

    mergedByCode.set(pinCode, pin);
  }

  return Array.from(mergedByCode.values()).sort((left, right) => {
    const rightTs = new Date(String(right.createdAt || '')).getTime() || 0;
    const leftTs = new Date(String(left.createdAt || '')).getTime() || 0;
    return rightTs - leftTs;
  });
}

async function fetchV2PinsSnapshotForUserWithStatus(user: User): Promise<{ pins: Pin[] | null; errorMessage: string | null }> {
  const canonicalUser = resolveCanonicalUserForWalletActions(user.id)
    || Database.getUserByUserId(user.userId)
    || Database.getUserById(user.id)
    || user;

  const userCode = String(canonicalUser?.userId || '').trim();
  const internalUserId = String(canonicalUser?.id || '').trim();
  if (!userCode || !internalUserId) {
    return { pins: null, errorMessage: 'V2 pin read skipped: user identity is incomplete.' };
  }

  const requestId = generateClientRequestId('v2_pins_read');
  const resolvedHeaders = resolveV2ReadRequestHeaders({
    requestId,
    impersonationReason: 'pins_read_refresh'
  });
  if (!('headers' in resolvedHeaders)) {
    return {
      pins: null,
      errorMessage: resolvedHeaders.message || 'Live V2 pin read failed: auth headers could not be prepared.'
    };
  }

  const requestUrl = `${getBackendApiBase()}/api/v2/pins?userCode=${encodeURIComponent(userCode)}&limit=1000`;
  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method: 'GET',
      headers: resolvedHeaders.headers
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Network request error';
    const normalizedMessage = /failed to fetch|networkerror|load failed|fetch failed/i.test(rawMessage)
      ? `Cannot reach. Wait few Minutes ${getBackendApiBase()}. Check internet, DNS, SSL, or CORS/proxy settings.`
      : rawMessage;
    return {
      pins: null,
      errorMessage: `Live V2 pin read failed: ${normalizedMessage}`
    };
  }

  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || payload?.ok === false) {
    const status = response.status || 0;
    const code = typeof payload?.code === 'string' ? payload.code : '';
    const backendMessage = typeof payload?.error === 'string'
      ? payload.error
      : typeof payload?.message === 'string'
        ? payload.message
        : `HTTP ${status}`;

    if (status === 401) {
      Database.setV2AuthSession(null);
      return {
        pins: null,
        errorMessage: `V2 session rejected (HTTP 401). Please logout and login again.${code ? ` (${code})` : ''}`
      };
    }

    return {
      pins: null,
      errorMessage: `Live V2 pin read failed: ${backendMessage}${code ? ` (${code})` : ''}`
    };
  }

  const rows = Array.isArray((payload as { pins?: unknown[] })?.pins)
    ? ((payload as { pins?: unknown[] }).pins as Array<Record<string, unknown>>)
    : [];

  const v2Pins: Pin[] = rows
    .map((row, index) => {
      const pinCode = String(row.pinCode || '').trim().toUpperCase();
      if (!pinCode) return null;

      const localStatus = mapV2PinStatusToLocalPinStatus(row.status);
      const createdAt = typeof row.createdAt === 'string' && row.createdAt.trim()
        ? row.createdAt
        : new Date().toISOString();
      const usedByUserCode = String(row.usedByUserCode || '').trim();
      const usedByInternalUser = usedByUserCode
        ? (resolveCanonicalUserForWalletActions(usedByUserCode)
          || Database.getUserByUserId(usedByUserCode)
          || Database.getUserById(usedByUserCode))
        : null;
      const usedById = String(usedByInternalUser?.id || usedByUserCode || '').trim();
      const usedAt = typeof row.usedAt === 'string' && row.usedAt.trim() ? row.usedAt : undefined;

      return {
        id: `pin_v2_${String(row.id || `${pinCode}_${index}`)}`,
        pinCode,
        amount: Math.max(0, Number(row.priceCents || 0)) / 100,
        status: localStatus,
        ownerId: internalUserId,
        createdBy: internalUserId,
        createdAt,
        ...(localStatus === 'used' && usedAt ? { usedAt } : {}),
        ...(localStatus === 'used' && usedById ? { usedById, registrationUserId: usedById } : {}),
        ...(localStatus === 'suspended'
          ? {
            suspendedAt: usedAt || createdAt,
            suspensionReason: `Projected from v2 pin status: ${String(row.status || '').trim() || 'unknown'}`
          }
          : {})
      } as Pin;
    })
    .filter((pin): pin is Pin => !!pin);

  const legacyPins = Database.getUserPins(internalUserId);
  const mergedPins = mergeV2PinsWithLegacyTransitionPins(v2Pins, legacyPins);

  return {
    pins: mergedPins,
    errorMessage: null
  };
}

async function fetchV2DirectPinPurchaseRequestsForUserWithStatus(user: User): Promise<{
  requests: PinPurchaseRequest[] | null;
  errorMessage: string | null;
}> {
  const canonicalUser = resolveCanonicalUserForWalletActions(user.id)
    || Database.getUserByUserId(user.userId)
    || Database.getUserById(user.id)
    || user;

  const userCode = String(canonicalUser?.userId || '').trim();
  const internalUserId = String(canonicalUser?.id || '').trim();
  if (!userCode || !internalUserId) {
    return { requests: null, errorMessage: 'V2 direct pin history read skipped: user identity is incomplete.' };
  }

  const requestId = generateClientRequestId('v2_pin_requests_read');
  const resolvedHeaders = resolveV2ReadRequestHeaders({
    requestId,
    impersonationReason: 'pin_requests_read_refresh'
  });
  if (!('headers' in resolvedHeaders)) {
    return {
      requests: null,
      errorMessage: resolvedHeaders.message || 'Live V2 direct pin history read failed: auth headers could not be prepared.'
    };
  }

  const requestUrl = `${getBackendApiBase()}/api/v2/transactions?userCode=${encodeURIComponent(userCode)}&limit=400`;
  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method: 'GET',
      headers: resolvedHeaders.headers
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Network request error';
    return {
      requests: null,
      errorMessage: `Live V2 direct pin history read failed: ${rawMessage}`
    };
  }

  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || payload?.ok === false) {
    const status = response.status || 0;
    const code = typeof payload?.code === 'string' ? payload.code : '';
    const backendMessage = typeof payload?.error === 'string'
      ? payload.error
      : typeof payload?.message === 'string'
        ? payload.message
        : `HTTP ${status}`;

    if (status === 401) {
      Database.setV2AuthSession(null);
      return {
        requests: null,
        errorMessage: `V2 session rejected (HTTP 401). Please logout and login again.${code ? ` (${code})` : ''}`
      };
    }

    return {
      requests: null,
      errorMessage: `Live V2 direct pin history read failed: ${backendMessage}${code ? ` (${code})` : ''}`
    };
  }

  const txRows = Array.isArray((payload as { transactions?: unknown[] })?.transactions)
    ? ((payload as { transactions?: unknown[] }).transactions as Array<Record<string, unknown>>)
    : [];

  const pinAmountDollars = Math.max(1, Number(Database.getSettings()?.pinAmount || 11));

  const requests = txRows
    .filter((row) => String(row.txType || '').toLowerCase() === 'pin_purchase' && Number(row.signedAmountCents || 0) < 0)
    .map((row, index) => {
      const ledgerTransactionId = Number(row.ledgerTransactionId || 0);
      const txUuid = String(row.txUuid || '').trim();
      const id = Number.isInteger(ledgerTransactionId) && ledgerTransactionId > 0
        ? `v2_direct_${ledgerTransactionId}`
        : txUuid
          ? `v2_direct_${txUuid}`
          : `v2_direct_fallback_${Date.now()}_${index}`;
      const createdAt = typeof row.postedAt === 'string' && row.postedAt.trim()
        ? row.postedAt
        : typeof row.createdAt === 'string' && row.createdAt.trim()
          ? row.createdAt
          : new Date().toISOString();
      const amount = Math.abs(Number(row.signedAmountCents || 0)) / 100;
      const quantity = inferPinQuantityFromV2Purchase({
        referenceId: row.referenceId,
        description: row.description,
        signedAmountCents: row.signedAmountCents,
        pinAmountDollars
      });
      const status = mapV2TransactionStatusToPaymentStatus(row.status);

      return {
        id,
        userId: internalUserId,
        quantity,
        amount,
        status,
        purchaseType: 'direct',
        paidFromWallet: true,
        createdAt,
        ...(status === 'completed' ? { processedAt: createdAt, processedBy: 'v2_system' } : {})
      } as PinPurchaseRequest;
    });

  return {
    requests,
    errorMessage: null
  };
}

function buildWalletDefaultsForV2Read(userId: string, existingWallet?: Wallet | null): Wallet {
  return {
    userId,
    depositWallet: Number(existingWallet?.depositWallet || 0),
    fundRecoveryDue: Number(existingWallet?.fundRecoveryDue || 0),
    fundRecoveryRecoveredTotal: Number(existingWallet?.fundRecoveryRecoveredTotal || 0),
    fundRecoveryReason: existingWallet?.fundRecoveryReason || null,
    pinWallet: Number(existingWallet?.pinWallet || 0),
    incomeWallet: Number(existingWallet?.incomeWallet || 0),
    royaltyWallet: Number(existingWallet?.royaltyWallet || 0),
    matrixWallet: Number(existingWallet?.matrixWallet || 0),
    lockedIncomeWallet: Number(existingWallet?.lockedIncomeWallet || 0),
    giveHelpLocked: Number(existingWallet?.giveHelpLocked || 0),
    totalReceived: Number(existingWallet?.totalReceived || 0),
    totalGiven: Number(existingWallet?.totalGiven || 0),
    pendingSystemFee: Number(existingWallet?.pendingSystemFee || 0),
    lastSystemFeeDate: existingWallet?.lastSystemFeeDate || null,
    rewardPoints: Number(existingWallet?.rewardPoints || 0),
    totalRewardPointsEarned: Number(existingWallet?.totalRewardPointsEarned || 0),
    totalRewardPointsRedeemed: Number(existingWallet?.totalRewardPointsRedeemed || 0)
  };
}

function mapV2ReadStatusToTransactionStatus(status: unknown): TransactionStatus {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed') return 'completed';
  if (normalized === 'reversed') return 'reversed';
  if (normalized === 'cancelled') return 'cancelled';
  return 'pending';
}

function mapV2ReadTypeToTransactionType(txType: unknown, walletType: unknown, signedAmountCents: number): TransactionType {
  const normalizedTxType = String(txType || '').toLowerCase();
  const normalizedWalletType = String(walletType || '').toLowerCase();

  if (normalizedTxType === 'fund_transfer') {
    if (normalizedWalletType === 'income' && signedAmountCents < 0) return 'income_transfer';
    return 'p2p_transfer';
  }
  if (normalizedTxType === 'withdrawal_debit') return 'withdrawal';
  if (normalizedTxType === 'pin_purchase') return 'pin_purchase';
  if (normalizedTxType === 'referral_credit') {
    return signedAmountCents >= 0 ? 'direct_income' : 'income_transfer';
  }
  if (normalizedTxType === 'admin_adjustment') {
    if (signedAmountCents >= 0 && normalizedWalletType === 'royalty') return 'royalty_income';
    return signedAmountCents >= 0 ? 'admin_credit' : 'admin_debit';
  }

  return signedAmountCents >= 0 ? 'admin_credit' : 'admin_debit';
}

function getTransactionTimestampForDisplayMerge(tx: Transaction): number {
  const createdAtTs = new Date(String(tx.createdAt || '')).getTime();
  if (Number.isFinite(createdAtTs) && createdAtTs > 0) return createdAtTs;
  const completedAtTs = new Date(String(tx.completedAt || '')).getTime();
  if (Number.isFinite(completedAtTs) && completedAtTs > 0) return completedAtTs;
  return 0;
}

function resolveUserLabelFromCode(userCode: string): string {
  const normalized = String(userCode || '').trim();
  if (!normalized) return '';
  const resolved = resolveCanonicalUserForWalletActions(normalized) || Database.getUserByUserId(normalized);
  if (resolved?.fullName) {
    return `${resolved.fullName} (${resolved.userId})`;
  }
  return normalized;
}

function rewriteDescriptionUserCodes(description: string): string {
  return String(description || '').replace(/(?<!\()\b\d{7}\b(?!\))/g, (code) => {
    const label = resolveUserLabelFromCode(code);
    return label || code;
  });
}

function buildV2DisplayDescription(params: {
  txType: unknown;
  walletType: unknown;
  signedAmountCents: number;
  rawDescription: string;
  counterpartyUserCode: string;
}): string {
  const txType = String(params.txType || '').toLowerCase();
  const walletType = String(params.walletType || '').toLowerCase();
  const counterpartyUserCode = String(params.counterpartyUserCode || '').trim();
  const counterpartyLabel = resolveUserLabelFromCode(counterpartyUserCode);
  const normalizedRawDescription = String(params.rawDescription || '').trim();

  if (txType === 'fund_transfer' && counterpartyLabel) {
    const direction = params.signedAmountCents < 0 ? 'to' : 'from';
    const walletLabel = walletType === 'income'
      ? 'Income wallet'
      : walletType === 'royalty'
        ? 'Royalty wallet'
        : 'Fund wallet';
    return `${walletLabel} transfer ${direction} ${counterpartyLabel}`;
  }

  if (txType === 'referral_credit' && params.signedAmountCents >= 0 && counterpartyLabel) {
    if (!normalizedRawDescription || /referral\s+income\s+from/i.test(normalizedRawDescription)) {
      return `Referral income from ${counterpartyLabel}`;
    }
  }

  if (normalizedRawDescription) {
    return rewriteDescriptionUserCodes(normalizedRawDescription);
  }

  return String(params.txType || 'transaction').replace(/_/g, ' ');
}

function buildTransactionSemanticMergeKey(tx: Transaction): string {
  const ts = getTransactionTimestampForDisplayMerge(tx);
  const tsSecondBucket = ts > 0 ? Math.floor(ts / 1000) : 0;
  const counterparty = String(tx.fromUserId || tx.toUserId || '').trim();
  const amountCents = Math.round(Number(tx.amount || 0) * 100);
  const normalizedDescription = String(tx.description || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\b\d{7}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  return [
    String(tx.userId || '').trim(),
    String(tx.type || '').trim(),
    String(amountCents),
    String(counterparty),
    String(tsSecondBucket),
    normalizedDescription
  ].join('|');
}

function mergeTransactionsForDisplay(params: {
  legacyTransactions: Transaction[];
  v2Transactions: Transaction[];
}): Transaction[] {
  const merged: Transaction[] = [];
  const seenIds = new Set<string>();
  const seenSemanticKeys = new Set<string>();

  const pushIfUnique = (tx: Transaction) => {
    if (!tx || typeof tx !== 'object') return;
    const id = String(tx.id || '').trim();
    if (!id || seenIds.has(id)) return;

    const semanticKey = buildTransactionSemanticMergeKey(tx);
    if (semanticKey && seenSemanticKeys.has(semanticKey)) return;

    seenIds.add(id);
    if (semanticKey) {
      seenSemanticKeys.add(semanticKey);
    }
    merged.push(tx);
  };

  for (const tx of params.v2Transactions) pushIfUnique(tx);
  for (const tx of params.legacyTransactions) pushIfUnique(tx);

  return merged.sort((left, right) => getTransactionTimestampForDisplayMerge(right) - getTransactionTimestampForDisplayMerge(left));
}

type V2WalletReadOptions = {
  includeLegacyTransactions?: boolean;
};

type V2WalletReadResult = {
  snapshot: { wallet: Wallet; transactions: Transaction[] } | null;
  errorMessage: string | null;
};

async function fetchV2WalletAndTransactionsSnapshotForUserWithStatus(
  user: User,
  options?: V2WalletReadOptions
): Promise<V2WalletReadResult> {
  const userCode = String(user?.userId || '').trim();
  const internalUserId = String(user?.id || '').trim();
  if (!userCode || !internalUserId) {
    return { snapshot: null, errorMessage: 'V2 read skipped: user identity is incomplete.' };
  }

  const requestId = generateClientRequestId('v2_wallet_read');
  const resolvedHeaders = resolveV2ReadRequestHeaders({
    requestId,
    impersonationReason: 'wallet_read_refresh'
  });
  if (!('headers' in resolvedHeaders)) {
    return {
      snapshot: null,
      errorMessage: resolvedHeaders.message || 'Live read failed: auth headers could not be prepared.'
    };
  }

  const headers = resolvedHeaders.headers;
  const walletUrl = `${getBackendApiBase()}/api/v2/wallet?userCode=${encodeURIComponent(userCode)}`;
  const transactionsUrl = `${getBackendApiBase()}/api/v2/transactions?userCode=${encodeURIComponent(userCode)}&limit=200`;

  let walletResponse: Response;
  let transactionsResponse: Response;
  try {
    [walletResponse, transactionsResponse] = await Promise.all([
      fetch(walletUrl, { method: 'GET', headers }),
      fetch(transactionsUrl, { method: 'GET', headers })
    ]);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Network request error';
    const normalizedMessage = /failed to fetch|networkerror|load failed|fetch failed/i.test(rawMessage)
      ? `Cannot reach. Wait few Minutes ${getBackendApiBase()}. Check internet, DNS, SSL, or CORS/proxy settings.`
      : rawMessage;
    return {
      snapshot: null,
      errorMessage: `Live read failed: ${normalizedMessage}`
    };
  }

  if (!walletResponse.ok || !transactionsResponse.ok) {
    const walletPayload = await walletResponse.clone().json().catch(() => ({} as Record<string, unknown>));
    const txPayload = await transactionsResponse.clone().json().catch(() => ({} as Record<string, unknown>));
    const walletStatus = walletResponse?.status || 0;
    const txStatus = transactionsResponse?.status || 0;
    const walletCode = typeof walletPayload?.code === 'string' ? walletPayload.code : '';
    const txCode = typeof txPayload?.code === 'string' ? txPayload.code : '';
    const walletError = typeof walletPayload?.error === 'string' ? walletPayload.error : '';
    const txError = typeof txPayload?.error === 'string' ? txPayload.error : '';
    const authRejected = walletStatus === 401 || txStatus === 401;
    if (authRejected) {
      Database.setV2AuthSession(null);
    }

    const detailParts = [
      walletError ? `wallet ${walletError}` : `wallet HTTP ${walletStatus}`,
      txError ? `transactions ${txError}` : `transactions HTTP ${txStatus}`
    ];

    const codeParts = [walletCode, txCode].filter(Boolean).join(',');
    if (authRejected) {
      const suffix = codeParts ? ` (${codeParts})` : '';
      return {
        snapshot: null,
        errorMessage: `V2 session rejected (HTTP 401). Please logout and login again.${suffix}`
      };
    }

    return {
      snapshot: null,
      errorMessage: `Live read failed: ${detailParts.join(', ')}${codeParts ? ` (${codeParts})` : ''}.`
    };
  }

  const walletPayload = await walletResponse.json().catch(() => ({} as Record<string, unknown>));
  const transactionsPayload = await transactionsResponse.json().catch(() => ({} as Record<string, unknown>));

  const walletData = walletPayload && typeof walletPayload === 'object'
    ? (walletPayload as { wallet?: Record<string, unknown>; ok?: boolean }).wallet
    : undefined;
  const txRows = Array.isArray((transactionsPayload as { transactions?: unknown[] })?.transactions)
    ? ((transactionsPayload as { transactions?: unknown[] }).transactions as Array<Record<string, unknown>>)
    : [];

  if (!(walletPayload as { ok?: boolean })?.ok || !walletData || typeof walletData !== 'object') {
    return {
      snapshot: null,
      errorMessage: 'Live read failed: wallet payload is invalid.'
    };
  }
  if (!(transactionsPayload as { ok?: boolean })?.ok) {
    return {
      snapshot: null,
      errorMessage: 'Live read failed: transactions payload is invalid.'
    };
  }

  const existingWallet = Database.getWallet(internalUserId);
  const wallet = buildWalletDefaultsForV2Read(internalUserId, existingWallet);
  wallet.depositWallet = Number(walletData.fundCents || 0) / 100;
  wallet.incomeWallet = Number(walletData.incomeCents || 0) / 100;
  wallet.royaltyWallet = Number(walletData.royaltyCents || 0) / 100;

  const v2Transactions = txRows.map((row, index) => {
    const signedAmountCents = Number(row.signedAmountCents || 0);
    const counterpartyCode = String(row.counterpartyUserCode || '').trim();
    const counterpartyUser = counterpartyCode
      ? (resolveCanonicalUserForWalletActions(counterpartyCode) || Database.getUserByUserId(counterpartyCode))
      : undefined;
    const counterpartyRef = counterpartyUser?.id || counterpartyCode || undefined;

    const createdAt = typeof row.postedAt === 'string' && row.postedAt
      ? row.postedAt
      : typeof row.createdAt === 'string' && row.createdAt
        ? row.createdAt
        : new Date().toISOString();

    const txType = mapV2ReadTypeToTransactionType(row.txType, row.walletType, signedAmountCents);
    const description = buildV2DisplayDescription({
      txType: row.txType,
      walletType: row.walletType,
      signedAmountCents,
      rawDescription: typeof row.description === 'string' ? row.description : '',
      counterpartyUserCode: counterpartyUser?.userId || counterpartyCode
    });

    return {
      id: `v2_${String(row.txUuid || 'txn')}_${String(row.id || index)}`,
      userId: internalUserId,
      type: txType,
      amount: signedAmountCents / 100,
      ...(signedAmountCents >= 0 ? { fromUserId: counterpartyRef } : {}),
      ...(signedAmountCents < 0 ? { toUserId: counterpartyRef } : {}),
      status: mapV2ReadStatusToTransactionStatus(row.status),
      description,
      createdAt,
      completedAt: mapV2ReadStatusToTransactionStatus(row.status) === 'completed' ? createdAt : undefined
    } satisfies Transaction;
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const transactions = options?.includeLegacyTransactions === false
    ? v2Transactions
    : mergeTransactionsForDisplay({
      legacyTransactions: Database.getUserTransactions(internalUserId),
      v2Transactions
    });

  return {
    snapshot: { wallet, transactions },
    errorMessage: null
  };
}

async function fetchV2WalletAndTransactionsSnapshotForUser(
  user: User,
  options?: V2WalletReadOptions
): Promise<{ wallet: Wallet; transactions: Transaction[] } | null> {
  const result = await fetchV2WalletAndTransactionsSnapshotForUserWithStatus(user, options);
  return result.snapshot;
}

async function submitV2ReferralCreditBySourceRef(params: {
  sourceUserCode: string;
  beneficiaryUserCode: string;
  amount: number;
  sourceRef: string;
  eventType?: 'direct_referral' | 'level_referral';
  levelNo?: number;
  description?: string;
}): Promise<{ success: boolean; message: string; idempotentReplay?: boolean }> {
  const sourceUserCode = String(params.sourceUserCode || '').trim();
  const beneficiaryUserCode = String(params.beneficiaryUserCode || '').trim();
  const sourceRef = String(params.sourceRef || '').trim();
  const eventType = params.eventType || 'direct_referral';
  const levelNo = Number.isInteger(params.levelNo) && Number(params.levelNo) > 0 ? Number(params.levelNo) : 1;
  const amountCents = Math.round(Number(params.amount || 0) * 100);

  if (!sourceUserCode || !beneficiaryUserCode || !sourceRef) {
    return { success: false, message: 'Missing referral credit parameters' };
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { success: false, message: 'Invalid referral credit amount' };
  }

  const sourceRefToken = sourceRef
    .replace(/[^a-zA-Z0-9:_-]+/g, '_')
    .slice(0, 64);
  const idempotencyKey = `refsrc_${sourceUserCode}_${beneficiaryUserCode}_${sourceRefToken}`.slice(0, 120);
  const requestId = generateClientRequestId('referral_credit');

  const response = await fetch(`${getBackendApiBase()}/api/v2/referrals/credit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sourceUserCode}`,
      'Idempotency-Key': idempotencyKey,
      'X-System-Version': 'v2',
      'X-Request-Id': requestId
    },
    body: JSON.stringify({
      sourceUserCode,
      beneficiaryUserCode,
      sourceRef,
      eventType,
      levelNo,
      amountCents,
      description: String(params.description || '').trim() || undefined
    })
  });

  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || payload?.ok === false) {
    return {
      success: false,
      message: normalizeV2ApiErrorMessage(response.status, payload, 'Referral credit failed')
    };
  }

  const idempotentReplay = typeof payload?.idempotentReplay === 'boolean' ? payload.idempotentReplay : false;
  return {
    success: true,
    message: idempotentReplay ? 'Referral credit already processed (idempotent replay).' : 'Referral credit posted.',
    idempotentReplay
  };
}

async function submitV2HelpEventBySourceRef(params: {
  sourceUserCode: string;
  newMemberUserCode: string;
  sourceRef: string;
  eventType?: 'activation_join';
  description?: string;
}): Promise<{ success: boolean; message: string; idempotentReplay?: boolean }> {
  const sourceUserCode = String(params.sourceUserCode || '').trim();
  const newMemberUserCode = String(params.newMemberUserCode || '').trim();
  const sourceRef = String(params.sourceRef || '').trim();
  const eventType = params.eventType || 'activation_join';

  if (!sourceUserCode || !newMemberUserCode || !sourceRef) {
    return { success: false, message: 'Missing help-event parameters' };
  }

  const sourceRefToken = sourceRef
    .replace(/[^a-zA-Z0-9:_-]+/g, '_')
    .slice(0, 64);
  const idempotencyKey = `help_${sourceUserCode}_${newMemberUserCode}_${sourceRefToken}`.slice(0, 120);
  const requestId = generateClientRequestId('help_event');

  const response = await fetch(`${getBackendApiBase()}/api/v2/help-events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sourceUserCode}`,
      'Idempotency-Key': idempotencyKey,
      'X-System-Version': 'v2',
      'X-Request-Id': requestId
    },
    body: JSON.stringify({
      sourceUserCode,
      newMemberUserCode,
      sourceRef,
      eventType,
      description: String(params.description || '').trim() || undefined
    })
  });

  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || payload?.ok === false) {
    return {
      success: false,
      message: normalizeV2ApiErrorMessage(response.status, payload, 'Help event failed')
    };
  }

  const idempotentReplay = typeof payload?.idempotentReplay === 'boolean' ? payload.idempotentReplay : false;
  return {
    success: true,
    message: idempotentReplay ? 'Help event already queued (idempotent replay).' : 'Help event queued.',
    idempotentReplay
  };
}

async function submitV2AdminAdjustment(params: {
  targetUserCode: string;
  approverUserCode: string;
  walletType: 'fund' | 'income' | 'royalty';
  direction: 'credit' | 'debit';
  amountCents: number;
  reasonCode: string;
  ticketId: string;
  note: string;
  description?: string;
}): Promise<{ success: boolean; message: string; code?: string; idempotentReplay?: boolean }> {
  const authState = useAuthStore.getState();
  const subjectUser = authState.user;
  if (!subjectUser?.isAdmin) {
    return { success: false, message: 'Only admin can submit V2 admin adjustments' };
  }

  const bearerTokenResult = resolveV2BearerTokenOrError(subjectUser);
  if (!('token' in bearerTokenResult)) {
    return { success: false, message: bearerTokenResult.message };
  }

  const idempotencyKey = generateClientIdempotencyKey();
  const requestId = generateClientRequestId('admin_adjustment');

  let response: Response;
  try {
    response = await fetch(`${getBackendApiBase()}/api/v2/admin/adjustments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearerTokenResult.token}`,
        'Idempotency-Key': idempotencyKey,
        'X-System-Version': 'v2',
        'X-Request-Id': requestId
      },
      body: JSON.stringify({
        targetUserCode: params.targetUserCode,
        approverUserCode: params.approverUserCode,
        walletType: params.walletType,
        direction: params.direction,
        amountCents: params.amountCents,
        reasonCode: params.reasonCode,
        ticketId: params.ticketId,
        note: params.note,
        description: String(params.description || '').trim() || undefined
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request error';
    return { success: false, message: `V2 admin adjustment failed: ${message}` };
  }

  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || payload?.ok === false) {
    return {
      success: false,
      message: normalizeV2ApiErrorMessage(response.status, payload, 'V2 admin adjustment failed'),
      code: typeof payload?.code === 'string' ? payload.code : undefined
    };
  }

  return {
    success: true,
    message: 'V2 admin adjustment posted.',
    idempotentReplay: typeof payload?.idempotentReplay === 'boolean' ? payload.idempotentReplay : false
  };
}

const POST_REGISTRATION_RETRY_QUEUE_STORAGE_KEY = 'v2_post_registration_retry_queue';
const POST_REGISTRATION_RETRY_BASE_DELAY_MS = 30_000;
const POST_REGISTRATION_RETRY_MAX_DELAY_MS = 15 * 60 * 1000;
const POST_REGISTRATION_RETRY_TIMER_MS = 30_000;
const POST_REGISTRATION_RETRY_BATCH_SIZE = 6;

type PendingReferralRetryTask = {
  kind: 'referral_credit';
  key: string;
  createdAt: string;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  payload: {
    sourceUserCode: string;
    beneficiaryUserCode: string;
    amount: number;
    sourceRef: string;
    description?: string;
  };
};

type PendingHelpRetryTask = {
  kind: 'help_event';
  key: string;
  createdAt: string;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  payload: {
    sourceUserCode: string;
    newMemberUserCode: string;
    sourceRef: string;
    description?: string;
  };
};

type PendingPostRegistrationRetryTask = PendingReferralRetryTask | PendingHelpRetryTask;

export type PostRegistrationRetryQueueItem = {
  id: number;
  taskKey: string;
  taskType: 'referral_credit' | 'help_event';
  registrationUserCode: string;
  registrationUserName: string;
  targetUserCode: string;
  targetUserName: string;
  status: 'queued' | 'processing' | 'failed' | 'completed';
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string | null;
};

export type PostRegistrationRetryQueueStatus = {
  pendingCount: number;
  oldestPendingAgeMs: number | null;
  oldestCreatedAt: string | null;
  nextAttemptAt: string | null;
  nextAttemptInMs: number | null;
  source: 'backend' | 'local';
  backendReachable: boolean;
  items: PostRegistrationRetryQueueItem[];
};

let postRegistrationRetryQueueRunning = false;
let postRegistrationRetryQueueBound = false;
let postRegistrationRetryQueueTimer: ReturnType<typeof setInterval> | null = null;

function buildPendingReferralRetryKey(payload: {
  sourceUserCode: string;
  beneficiaryUserCode: string;
  sourceRef: string;
}): string {
  return `referral:${payload.sourceRef}:${payload.sourceUserCode}:${payload.beneficiaryUserCode}`;
}

function buildPendingHelpRetryKey(payload: {
  sourceUserCode: string;
  newMemberUserCode: string;
  sourceRef: string;
}): string {
  return `help:${payload.sourceRef}:${payload.sourceUserCode}:${payload.newMemberUserCode}`;
}

function resolveRetryTaskUserName(userCode: string): string {
  const normalized = String(userCode || '').trim();
  if (!normalized) return '';
  const user = Database.getUserByUserId(normalized);
  return String(user?.fullName || '').trim();
}

function mapPendingTaskToQueueItem(task: PendingPostRegistrationRetryTask): PostRegistrationRetryQueueItem {
  const taskType = task.kind;
  const registrationUserCode = String(task.payload.sourceUserCode || '').trim();
  const registrationUserName = resolveRetryTaskUserName(registrationUserCode);
  const targetUserCode = taskType === 'referral_credit'
    ? String(task.payload.beneficiaryUserCode || '').trim()
    : String(task.payload.newMemberUserCode || '').trim();
  const targetUserName = resolveRetryTaskUserName(targetUserCode);

  return {
    id: 0,
    taskKey: task.key,
    taskType,
    registrationUserCode,
    registrationUserName,
    targetUserCode,
    targetUserName,
    status: 'queued',
    attempts: task.attempts,
    maxAttempts: 0,
    nextAttemptAt: Number.isFinite(task.nextAttemptAt) && task.nextAttemptAt > 0
      ? new Date(task.nextAttemptAt).toISOString()
      : null,
    lastError: task.lastError,
    createdAt: task.createdAt || null
  };
}

async function enqueuePendingPostRegistrationRetryTaskToBackend(task: PendingPostRegistrationRetryTask): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    return false;
  }

  const sourceUserCode = String(task.payload.sourceUserCode || '').trim();
  if (!sourceUserCode) {
    return false;
  }

  const registrationUserName = resolveRetryTaskUserName(sourceUserCode);
  const targetUserCode = task.kind === 'referral_credit'
    ? String(task.payload.beneficiaryUserCode || '').trim()
    : String(task.payload.newMemberUserCode || '').trim();
  const targetUserName = resolveRetryTaskUserName(targetUserCode);
  const requestId = generateClientRequestId('registration_queue');

  const basePayload: Record<string, unknown> = {
    taskType: task.kind,
    taskKey: task.key,
    sourceUserCode,
    registrationUserName,
    targetUserCode,
    targetUserName,
    sourceRef: String(task.payload.sourceRef || '').trim(),
    description: typeof task.payload.description === 'string' ? task.payload.description : undefined,
    maxAttempts: 40
  };

  if (task.kind === 'referral_credit') {
    basePayload.beneficiaryUserCode = String(task.payload.beneficiaryUserCode || '').trim();
    basePayload.amountCents = Math.round(Number(task.payload.amount || 0) * 100);
    basePayload.eventType = 'direct_referral';
    basePayload.levelNo = 1;
  } else {
    basePayload.newMemberUserCode = String(task.payload.newMemberUserCode || '').trim();
    basePayload.eventType = 'activation_join';
  }

  try {
    const response = await fetch(`${getBackendApiBase()}/api/v2/registration-queue/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sourceUserCode}`,
        'X-System-Version': 'v2',
        'X-Request-Id': requestId
      },
      body: JSON.stringify(basePayload)
    });

    if (!response.ok) {
      return false;
    }
    const payload = await response.json().catch(() => ({} as Record<string, unknown>));
    return payload?.ok === true;
  } catch {
    return false;
  }
}

async function fetchPostRegistrationRetryQueueStatusFromBackend(limit = 25): Promise<PostRegistrationRetryQueueStatus | null> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    return null;
  }

  const authState = useAuthStore.getState();
  const adminUser = authState.user;
  if (!adminUser?.isAdmin) {
    return null;
  }

  const bearerTokenResult = resolveV2BearerTokenOrError(adminUser);
  if (!('token' in bearerTokenResult)) {
    return null;
  }

  const requestId = generateClientRequestId('registration_queue_admin');
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(200, Math.trunc(limit)))
    : 25;

  try {
    const response = await fetch(`${getBackendApiBase()}/api/v2/admin/registration-queue?limit=${safeLimit}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${bearerTokenResult.token}`,
        'X-System-Version': 'v2',
        'X-Request-Id': requestId
      }
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json().catch(() => ({} as Record<string, unknown>));
    if (payload?.ok !== true) {
      return null;
    }

    const now = Date.now();
    const oldestCreatedAt = typeof payload?.oldestPendingCreatedAt === 'string' && payload.oldestPendingCreatedAt
      ? payload.oldestPendingCreatedAt
      : null;
    const oldestCreatedAtMs = oldestCreatedAt ? new Date(oldestCreatedAt).getTime() : NaN;
    const oldestPendingAgeMs = Number.isFinite(oldestCreatedAtMs)
      ? Math.max(0, now - oldestCreatedAtMs)
      : null;
    const nextAttemptAt = typeof payload?.nextAttemptAt === 'string' && payload.nextAttemptAt
      ? payload.nextAttemptAt
      : null;
    const nextAttemptAtMs = nextAttemptAt ? new Date(nextAttemptAt).getTime() : NaN;
    const nextAttemptInMs = Number.isFinite(nextAttemptAtMs)
      ? Math.max(0, nextAttemptAtMs - now)
      : null;

    const rawItems: unknown[] = Array.isArray(payload?.items) ? payload.items : [];
    const items: PostRegistrationRetryQueueItem[] = rawItems.map((item: unknown) => {
      const queueItem = item && typeof item === 'object'
        ? (item as Record<string, unknown>)
        : {};
      const taskType = String(queueItem.taskType || '').trim().toLowerCase() === 'help_event'
        ? 'help_event'
        : 'referral_credit';
      const statusRaw = String(queueItem.status || '').trim().toLowerCase();
      const status: PostRegistrationRetryQueueItem['status'] = statusRaw === 'processing'
        ? 'processing'
        : statusRaw === 'failed'
          ? 'failed'
          : statusRaw === 'completed'
            ? 'completed'
            : 'queued';

      return {
        id: Number(queueItem.id || 0),
        taskKey: String(queueItem.taskKey || ''),
        taskType,
        registrationUserCode: String(queueItem.registrationUserCode || ''),
        registrationUserName: String(queueItem.registrationUserName || ''),
        targetUserCode: String(queueItem.targetUserCode || ''),
        targetUserName: String(queueItem.targetUserName || ''),
        status,
        attempts: Number(queueItem.attempts || 0),
        maxAttempts: Number(queueItem.maxAttempts || 0),
        nextAttemptAt: typeof queueItem.nextAttemptAt === 'string' ? queueItem.nextAttemptAt : null,
        lastError: typeof queueItem.lastError === 'string' && queueItem.lastError.trim() ? queueItem.lastError.trim() : null,
        createdAt: typeof queueItem.createdAt === 'string' ? queueItem.createdAt : null
      };
    });

    return {
      pendingCount: Number(payload?.pendingCount || 0),
      oldestPendingAgeMs,
      oldestCreatedAt,
      nextAttemptAt,
      nextAttemptInMs,
      source: 'backend',
      backendReachable: true,
      items
    };
  } catch {
    return null;
  }
}

function normalizePendingRetryTask(rawTask: unknown): PendingPostRegistrationRetryTask | null {
  if (!rawTask || typeof rawTask !== 'object') return null;

  const task = rawTask as Record<string, unknown>;
  const kind = task.kind;
  const payload = task.payload && typeof task.payload === 'object'
    ? task.payload as Record<string, unknown>
    : null;
  if (!payload) return null;

  const createdAt = typeof task.createdAt === 'string' && task.createdAt.trim()
    ? task.createdAt.trim()
    : new Date().toISOString();
  const attemptsRaw = Number(task.attempts);
  const attempts = Number.isFinite(attemptsRaw) && attemptsRaw >= 0 ? Math.trunc(attemptsRaw) : 0;
  const nextAttemptAtRaw = Number(task.nextAttemptAt);
  const nextAttemptAt = Number.isFinite(nextAttemptAtRaw) && nextAttemptAtRaw > 0
    ? Math.trunc(nextAttemptAtRaw)
    : Date.now();
  const lastError = typeof task.lastError === 'string' && task.lastError.trim()
    ? task.lastError.trim().slice(0, 280)
    : null;

  if (kind === 'referral_credit') {
    const sourceUserCode = String(payload.sourceUserCode || '').trim();
    const beneficiaryUserCode = String(payload.beneficiaryUserCode || '').trim();
    const sourceRef = String(payload.sourceRef || '').trim();
    const amount = Number(payload.amount || 0);
    if (!sourceUserCode || !beneficiaryUserCode || !sourceRef || !(amount > 0)) {
      return null;
    }
    const description = typeof payload.description === 'string' && payload.description.trim()
      ? payload.description.trim()
      : undefined;
    const key = typeof task.key === 'string' && task.key.trim()
      ? task.key.trim()
      : buildPendingReferralRetryKey({ sourceUserCode, beneficiaryUserCode, sourceRef });
    return {
      kind,
      key,
      createdAt,
      attempts,
      nextAttemptAt,
      lastError,
      payload: {
        sourceUserCode,
        beneficiaryUserCode,
        sourceRef,
        amount,
        description
      }
    };
  }

  if (kind === 'help_event') {
    const sourceUserCode = String(payload.sourceUserCode || '').trim();
    const newMemberUserCode = String(payload.newMemberUserCode || '').trim();
    const sourceRef = String(payload.sourceRef || '').trim();
    if (!sourceUserCode || !newMemberUserCode || !sourceRef) {
      return null;
    }
    const description = typeof payload.description === 'string' && payload.description.trim()
      ? payload.description.trim()
      : undefined;
    const key = typeof task.key === 'string' && task.key.trim()
      ? task.key.trim()
      : buildPendingHelpRetryKey({ sourceUserCode, newMemberUserCode, sourceRef });
    return {
      kind,
      key,
      createdAt,
      attempts,
      nextAttemptAt,
      lastError,
      payload: {
        sourceUserCode,
        newMemberUserCode,
        sourceRef,
        description
      }
    };
  }

  return null;
}

function readPendingPostRegistrationRetryTasks(): PendingPostRegistrationRetryTask[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(POST_REGISTRATION_RETRY_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => normalizePendingRetryTask(item))
      .filter((item): item is PendingPostRegistrationRetryTask => !!item)
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt);
  } catch {
    return [];
  }
}

function writePendingPostRegistrationRetryTasks(tasks: PendingPostRegistrationRetryTask[]): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }

  try {
    if (tasks.length === 0) {
      localStorage.removeItem(POST_REGISTRATION_RETRY_QUEUE_STORAGE_KEY);
      return;
    }
    localStorage.setItem(POST_REGISTRATION_RETRY_QUEUE_STORAGE_KEY, JSON.stringify(tasks.slice(0, 500)));
  } catch {
    // Best-effort persistence only.
  }
}

function upsertPendingPostRegistrationRetryTask(task: PendingPostRegistrationRetryTask): void {
  const tasks = readPendingPostRegistrationRetryTasks();
  const existingIndex = tasks.findIndex((entry) => entry.key === task.key);
  let queuedTask = task;
  if (existingIndex >= 0) {
    const existingTask = tasks[existingIndex];
    tasks[existingIndex] = {
      ...task,
      createdAt: existingTask.createdAt,
      attempts: existingTask.attempts,
      nextAttemptAt: Math.min(existingTask.nextAttemptAt, task.nextAttemptAt)
    };
    queuedTask = tasks[existingIndex];
  } else {
    tasks.push(task);
  }
  writePendingPostRegistrationRetryTasks(tasks);
  void enqueuePendingPostRegistrationRetryTaskToBackend(queuedTask).catch(() => {
    // Local queue remains the fallback if backend enqueue fails.
  });
}

function enqueuePendingReferralCreditRetry(payload: {
  sourceUserCode: string;
  beneficiaryUserCode: string;
  amount: number;
  sourceRef: string;
  description?: string;
}): void {
  const sourceUserCode = String(payload.sourceUserCode || '').trim();
  const beneficiaryUserCode = String(payload.beneficiaryUserCode || '').trim();
  const sourceRef = String(payload.sourceRef || '').trim();
  const amount = Number(payload.amount || 0);
  if (!sourceUserCode || !beneficiaryUserCode || !sourceRef || !(amount > 0)) {
    return;
  }

  upsertPendingPostRegistrationRetryTask({
    kind: 'referral_credit',
    key: buildPendingReferralRetryKey({ sourceUserCode, beneficiaryUserCode, sourceRef }),
    createdAt: new Date().toISOString(),
    attempts: 0,
    nextAttemptAt: Date.now(),
    lastError: null,
    payload: {
      sourceUserCode,
      beneficiaryUserCode,
      amount,
      sourceRef,
      description: payload.description
    }
  });
}

function enqueuePendingHelpEventRetry(payload: {
  sourceUserCode: string;
  newMemberUserCode: string;
  sourceRef: string;
  description?: string;
}): void {
  const sourceUserCode = String(payload.sourceUserCode || '').trim();
  const newMemberUserCode = String(payload.newMemberUserCode || '').trim();
  const sourceRef = String(payload.sourceRef || '').trim();
  if (!sourceUserCode || !newMemberUserCode || !sourceRef) {
    return;
  }

  upsertPendingPostRegistrationRetryTask({
    kind: 'help_event',
    key: buildPendingHelpRetryKey({ sourceUserCode, newMemberUserCode, sourceRef }),
    createdAt: new Date().toISOString(),
    attempts: 0,
    nextAttemptAt: Date.now(),
    lastError: null,
    payload: {
      sourceUserCode,
      newMemberUserCode,
      sourceRef,
      description: payload.description
    }
  });
}

function computePostRegistrationRetryDelayMs(nextAttemptNo: number): number {
  const exponent = Math.max(0, Math.min(8, nextAttemptNo - 1));
  const backoff = POST_REGISTRATION_RETRY_BASE_DELAY_MS * (2 ** exponent);
  return Math.min(POST_REGISTRATION_RETRY_MAX_DELAY_MS, backoff);
}

async function processPendingPostRegistrationRetryQueue(options?: {
  force?: boolean;
  maxItems?: number;
}): Promise<void> {
  if (postRegistrationRetryQueueRunning) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const tasks = readPendingPostRegistrationRetryTasks();
  if (tasks.length === 0) return;

  const now = Date.now();
  const maxItemsRaw = Number(options?.maxItems || POST_REGISTRATION_RETRY_BATCH_SIZE);
  const maxItems = Number.isFinite(maxItemsRaw)
    ? Math.max(1, Math.min(50, Math.trunc(maxItemsRaw)))
    : POST_REGISTRATION_RETRY_BATCH_SIZE;

  const dueTasks = tasks
    .filter((task) => options?.force || task.nextAttemptAt <= now)
    .slice(0, maxItems);
  if (dueTasks.length === 0) return;

  postRegistrationRetryQueueRunning = true;
  try {
    const nextTasks = new Map(tasks.map((task) => [task.key, task]));

    for (const dueTask of dueTasks) {
      const current = nextTasks.get(dueTask.key);
      if (!current) continue;

      let result: { success: boolean; message: string };
      try {
        if (current.kind === 'referral_credit') {
          result = await submitV2ReferralCreditBySourceRef({
            sourceUserCode: current.payload.sourceUserCode,
            beneficiaryUserCode: current.payload.beneficiaryUserCode,
            amount: current.payload.amount,
            sourceRef: current.payload.sourceRef,
            eventType: 'direct_referral',
            levelNo: 1,
            description: current.payload.description
          });
        } else {
          result = await submitV2HelpEventBySourceRef({
            sourceUserCode: current.payload.sourceUserCode,
            newMemberUserCode: current.payload.newMemberUserCode,
            sourceRef: current.payload.sourceRef,
            eventType: 'activation_join',
            description: current.payload.description
          });
        }
      } catch (error) {
        result = {
          success: false,
          message: error instanceof Error ? error.message : 'Retry request failed'
        };
      }

      if (result.success) {
        nextTasks.delete(current.key);
        continue;
      }

      const nextAttemptNo = current.attempts + 1;
      nextTasks.set(current.key, {
        ...current,
        attempts: nextAttemptNo,
        lastError: String(result.message || 'Unknown retry failure').slice(0, 280),
        nextAttemptAt: Date.now() + computePostRegistrationRetryDelayMs(nextAttemptNo)
      });
    }

    writePendingPostRegistrationRetryTasks(
      Array.from(nextTasks.values()).sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
    );
  } finally {
    postRegistrationRetryQueueRunning = false;
  }
}

function bindPostRegistrationRetryQueue(): void {
  if (postRegistrationRetryQueueBound) return;
  postRegistrationRetryQueueBound = true;

  if (postRegistrationRetryQueueTimer) {
    clearInterval(postRegistrationRetryQueueTimer);
    postRegistrationRetryQueueTimer = null;
  }

  postRegistrationRetryQueueTimer = setInterval(() => {
    void processPendingPostRegistrationRetryQueue().catch(() => {
      // Best-effort background retry only.
    });
  }, POST_REGISTRATION_RETRY_TIMER_MS);

  if (readPendingPostRegistrationRetryTasks().length > 0) {
    void processPendingPostRegistrationRetryQueue({ force: true, maxItems: 2 }).catch(() => {
      // Best-effort background retry only.
    });
  }
}

function getPostRegistrationRetryQueueStatusSnapshot(): PostRegistrationRetryQueueStatus {
  const tasks = readPendingPostRegistrationRetryTasks();
  if (tasks.length === 0) {
    return {
      pendingCount: 0,
      oldestPendingAgeMs: null,
      oldestCreatedAt: null,
      nextAttemptAt: null,
      nextAttemptInMs: null,
      source: 'local',
      backendReachable: false,
      items: []
    };
  }

  const now = Date.now();
  const oldestTask = [...tasks].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
  const nextAttemptTask = [...tasks].sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)[0];
  const oldestCreatedAtMs = new Date(oldestTask.createdAt).getTime();
  const oldestPendingAgeMs = Number.isFinite(oldestCreatedAtMs)
    ? Math.max(0, now - oldestCreatedAtMs)
    : null;
  const nextAttemptInMs = Number.isFinite(nextAttemptTask.nextAttemptAt)
    ? Math.max(0, nextAttemptTask.nextAttemptAt - now)
    : null;

  return {
    pendingCount: tasks.length,
    oldestPendingAgeMs,
    oldestCreatedAt: oldestTask.createdAt,
    nextAttemptAt: new Date(nextAttemptTask.nextAttemptAt).toISOString(),
    nextAttemptInMs,
    source: 'local',
    backendReachable: false,
    items: tasks
      .slice()
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
      .slice(0, 25)
      .map((task) => mapPendingTaskToQueueItem(task))
  };
}

export function usePostRegistrationRetryQueueStatus(pollIntervalMs = 15000): PostRegistrationRetryQueueStatus {
  const [status, setStatus] = useState<PostRegistrationRetryQueueStatus>(() => getPostRegistrationRetryQueueStatusSnapshot());

  useEffect(() => {
    let isDisposed = false;

    const updateStatus = async () => {
      const localSnapshot = getPostRegistrationRetryQueueStatusSnapshot();
      if (isDisposed) return;

      const backendStatus = await fetchPostRegistrationRetryQueueStatusFromBackend(50);
      if (isDisposed) return;

      if (backendStatus) {
        setStatus(backendStatus);
      } else {
        setStatus(localSnapshot);
      }
    };

    void updateStatus();
    const intervalMs = Number.isFinite(pollIntervalMs)
      ? Math.max(5000, Math.min(60000, Math.trunc(pollIntervalMs)))
      : 15000;
    const intervalId = setInterval(() => {
      void updateStatus();
    }, intervalMs);

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void updateStatus();
      }
    };

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      isDisposed = true;
      clearInterval(intervalId);
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [pollIntervalMs]);

  return status;
}

function resolveCanonicalUserForWalletActions(userRef: string): User | undefined {
  const resolved = Database.getUserById(userRef) || Database.getUserByUserId(userRef);
  if (!resolved) return undefined;
  return Database.getUserByUserId(resolved.userId) || resolved;
}

const WALLET_MAINTENANCE_INTERVAL_MS = 30_000;
const AUTO_WALLET_MAINTENANCE_ENABLED = (() => {
  const env = (import.meta as { env?: Record<string, string | boolean | undefined> }).env || {};
  const configured = typeof env.VITE_ENABLE_AUTO_WALLET_MAINTENANCE === 'string'
    ? env.VITE_ENABLE_AUTO_WALLET_MAINTENANCE.trim().toLowerCase()
    : '';
  if (configured) {
    return configured === '1' || configured === 'true' || configured === 'yes';
  }
  return !!env.DEV;
})();

const walletMaintenanceState = new Map<string, {
  at: number;
  txCount: number;
  userCount: number;
  walletCount: number;
}>();

function shouldRunWalletMaintenance(userId: string): boolean {
  const now = Date.now();
  const snapshot = {
    txCount: Database.getTransactions().length,
    userCount: Database.getUsers().length,
    walletCount: Database.getWallets().length
  };
  const previous = walletMaintenanceState.get(userId);
  const hasStructureChange =
    !previous
    || previous.txCount !== snapshot.txCount
    || previous.userCount !== snapshot.userCount
    || previous.walletCount !== snapshot.walletCount;

  if (hasStructureChange || !previous || (now - previous.at) >= WALLET_MAINTENANCE_INTERVAL_MS) {
    walletMaintenanceState.set(userId, { at: now, ...snapshot });
    return true;
  }

  return false;
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

interface MissingMatrixUserAuditItem {
  userId: string;
  username: string;
  parentId: string | null;
  parentExistsInUsers: boolean;
  position: 'left' | 'right' | null;
  isActive: boolean;
}

interface MissingMatrixUsersAuditReport {
  generatedAt: string;
  missingCount: number;
  limit: number;
  items: MissingMatrixUserAuditItem[];
}

async function dispatchSystemEmail(params: {
  to: string;
  subject: string;
  body: string;
  purpose: SystemEmailPurpose;
  metadata?: Record<string, string>;
  timeoutMs?: number;
}): Promise<{ success: boolean; mode: 'api' | 'local'; error?: string; deliveryState: 'sent' | 'pending' | 'failed' }> {
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
  const backendBase = resolveBackendBaseUrl(typeof env.VITE_BACKEND_URL === 'string' ? env.VITE_BACKEND_URL : '');
  const backendMailApi = backendBase ? `${backendBase}/api/send-mail` : '';
  // Only use the same-origin URL if no backend URL is configured at all
  const hasExplicitBackend = !!(configuredMailApi || backendMailApi);
  const sameOriginApi = !hasExplicitBackend ? `${resolveBackendBaseUrl()}/api/send-mail` : '';
  const requestTimeoutMs = Number.isFinite(Number(params.timeoutMs)) ? Math.max(1500, Number(params.timeoutMs)) : 8000;
  const candidates = [configuredMailApi, backendMailApi, sameOriginApi].filter(Boolean);
  const seen = new Set<string>();
  const apiUrls = candidates.filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });

  if (apiUrls.length === 0) {
    const message = 'Mail API URL is not configured';
    Database.updateEmailLog(logId, { status: 'failed', provider: 'local', error: message });
    return { success: false, mode: 'local', error: message, deliveryState: 'failed' };
  }

  let firstError = '';
  let hadTimeout = false;
  let hadNonTimeoutError = false;
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
      return { success: true, mode: 'api', deliveryState: 'sent' };
    } catch (error: unknown) {
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      const msg =
        error instanceof Error
          ? (isTimeout ? `Email API timeout after ${requestTimeoutMs}ms` : error.message)
          : 'Unknown email error';
      if (isTimeout) {
        hadTimeout = true;
      } else {
        hadNonTimeoutError = true;
      }
      if (!firstError) firstError = msg;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (hadTimeout && !hadNonTimeoutError) {
    const pendingMessage = `Email request timed out after ${requestTimeoutMs}ms, but the OTP may still arrive. Please check inbox/spam before retrying.`;
    Database.updateEmailLog(logId, { status: 'queued', provider: 'api', error: pendingMessage });
    return { success: true, mode: 'api', error: pendingMessage, deliveryState: 'pending' };
  }

  const resolvedError = firstError || 'Email API request failed';
  Database.updateEmailLog(logId, { status: 'failed', provider: 'api', error: resolvedError });
  return { success: false, mode: 'api', error: resolvedError, deliveryState: 'failed' };
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
  enforceSessionAccess: (options?: { forceServerCheck?: boolean }) => Promise<{ active: boolean; message?: string }>;
  updateUser: (updates: Partial<User>) => void;
  verifyTransactionPassword: (userId: string, transactionPassword: string) => boolean;
}

function evaluateUserAccess(user: User): { allowed: boolean; user: User; message?: string } {
  let resolvedUser = Database.getUserByUserId(user.userId) || Database.getUserById(user.id) || user;

  if (AUTH_MAINTENANCE_ENABLED && !resolvedUser.isAdmin) {
    return {
      allowed: false,
      user: resolvedUser,
      message: AUTH_MAINTENANCE_MESSAGE
    };
  }

  if (resolvedUser.accountStatus === 'permanent_blocked') {
    return {
      allowed: false,
      user: resolvedUser,
      message: `Account permanently blocked${resolvedUser.blockedReason ? `: ${resolvedUser.blockedReason}` : ''}`
    };
  }

  if (resolvedUser.accountStatus === 'temp_blocked') {
    const blockedUntil = resolvedUser.blockedUntil ? new Date(resolvedUser.blockedUntil) : null;
    if (blockedUntil && blockedUntil > new Date()) {
      return {
        allowed: false,
        user: resolvedUser,
        message: `Account temporarily blocked until ${blockedUntil.toLocaleString()}${resolvedUser.blockedReason ? `: ${resolvedUser.blockedReason}` : ''}`
      };
    }

    const unblocked = Database.unblockUser(resolvedUser.id);
    if (unblocked) {
      resolvedUser = unblocked;
    }
  }

  if (resolvedUser.isActive && resolvedUser.activatedAt && !resolvedUser.isAdmin) {
    Database.checkDirectReferralDeadline(resolvedUser.id);
    resolvedUser = Database.getUserById(resolvedUser.id) || resolvedUser;
  }

  if (!resolvedUser.isActive) {
    if (resolvedUser.deactivationReason === 'direct_referral_deadline') {
      return {
        allowed: false,
        user: resolvedUser,
        message: 'Your ID is inactive as per direct refer terms & conditions.'
      };
    }

    return {
      allowed: false,
      user: resolvedUser,
      message: 'Account is inactive. Contact admin.'
    };
  }

  return { allowed: true, user: resolvedUser };
}

function resolveActiveImpersonatedUser(adminUser: User | null): User | null {
  if (!adminUser?.isAdmin) return null;

  const sessions = Database.getImpersonationSessions();
  const activeSession = sessions
    .filter((session) => {
      if (!session?.isActive) return false;
      return session.adminId === adminUser.id || session.adminUserId === adminUser.userId;
    })
    .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0];

  if (!activeSession) return null;

  return Database.getUserById(activeSession.targetUserId)
    || Database.getUserByUserId(activeSession.targetUserId)
    || null;
}

const initialAuthUser = (() => {
  const sessionUser = Database.getCurrentUser();
  if (!sessionUser) return null;

  const access = evaluateUserAccess(sessionUser);
  if (!access.allowed) {
    Database.setCurrentUser(null);
    return null;
  }

  Database.setCurrentUser(access.user);
  return access.user;
})();

const initialImpersonatedUser = resolveActiveImpersonatedUser(initialAuthUser);

export const useAuthStore = create<AuthState>((set, get) => ({
  user: initialAuthUser,
  isAuthenticated: !!initialAuthUser,
  isLoading: false,
  impersonatedUser: initialImpersonatedUser,

  login: async (userId: string, password: string) => {
    const normalizedUserId = String(userId || '').replace(/\D/g, '').slice(0, 7);
    if (normalizedUserId.length !== 7) {
      return { success: false, message: 'Enter a valid 7-digit User ID' };
    }

    if (import.meta.env.PROD) {
      const backendAuth = await Database.authenticateUserViaBackend(normalizedUserId, password);
      if (!backendAuth.success || !backendAuth.user) {
        return { success: false, message: backendAuth.message };
      }

      Database.setV2AuthSession(backendAuth.v2Auth || null);

      const access = evaluateUserAccess(backendAuth.user);
      if (!access.allowed) {
        Database.setCurrentUser(null);
        Database.setV2AuthSession(null);
        set({ user: null, isAuthenticated: false, impersonatedUser: null });
        return { success: false, message: access.message || 'Account is inactive. Contact admin.' };
      }

      Database.setCurrentUser(access.user);
      set({ user: Database.getCurrentUser() || access.user, isAuthenticated: true, impersonatedUser: null });
      void processPendingPostRegistrationRetryQueue({ force: true }).catch(() => {
        // Best-effort background retry only.
      });
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
    let user = Database.getUserByUserId(normalizedUserId);
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
      user = Database.getUserByUserId(normalizedUserId);
    }
    if (!user) {
      const syncStatus = Database.getRemoteSyncStatus();
      if (syncStatus.state !== 'synced') {
        return { success: false, message: 'Server data is still syncing. Please wait a moment and try again.' };
      }
      return { success: false, message: 'User ID not found' };
    }
    const access = evaluateUserAccess(user);
    if (!access.allowed) {
      return { success: false, message: access.message || 'Account is inactive. Contact admin.' };
    }
    user = access.user;

    if (user.password !== password) {
      return { success: false, message: 'Invalid password' };
    }
    Database.setV2AuthSession(null);
    Database.setCurrentUser(user);
    set({ user: Database.getCurrentUser() || user, isAuthenticated: true });
    void processPendingPostRegistrationRetryQueue({ force: true }).catch(() => {
      // Best-effort background retry only.
    });
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
    const normalizedTargetUserId = String(targetUserId || '').replace(/\D/g, '').slice(0, 7);

    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can impersonate users' };
    }

    if (masterPassword !== settings.masterPassword) {
      return { success: false, message: 'Invalid master password' };
    }

    if (normalizedTargetUserId.length !== 7) {
      return { success: false, message: 'Enter a valid 7-digit User ID' };
    }

    await Database.ensureFreshData({
      keys: Database.getStartupRemoteSyncBatches().flat(),
      timeoutMs: 10000,
      maxAttempts: 2,
      retryDelayMs: 700
    });

    const findTargetUser = () => {
      const direct = Database.getUserByUserId(normalizedTargetUserId);
      if (direct) return direct;
      return Database.getUsers().find((candidate) => String(candidate.userId || '').trim() === normalizedTargetUserId);
    };

    let targetUser = findTargetUser();
    if (!targetUser) {
      try {
        await Database.hydrateFromServerBatches(Database.getStartupRemoteSyncBatches(), {
          strict: true,
          maxAttempts: 2,
          timeoutMs: 20000,
          retryDelayMs: 1000,
          continueOnError: true,
          requireAnySuccess: true
        });
      } catch {
        // Retry local lookup below.
      }
      targetUser = findTargetUser();
    }
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

    // Push impersonation session quickly so backend-authenticated v2 requests can honor it immediately.
    try {
      await Database.forceRemoteSyncKeysNow([DB_KEYS.IMPERSONATION], {
        force: true,
        timeoutMs: 15000,
        maxAttempts: 2,
        retryDelayMs: 600
      });
    } catch {
      // Best-effort only. Local impersonation state remains active.
    }

    set({ impersonatedUser: canonicalTargetUser });
    return { success: true, message: `Now logged in as ${canonicalTargetUser.fullName}` };
  },

  endImpersonation: () => {
    const adminUser = get().user;
    if (adminUser) {
      Database.endImpersonation(adminUser.id);
      // Persist end-session quickly so background hydration does not re-introduce stale active sessions.
      void Database.forceRemoteSyncKeysNow([DB_KEYS.IMPERSONATION], {
        force: true,
        timeoutMs: 15000,
        maxAttempts: 2,
        retryDelayMs: 600
      }).catch(() => {
        // Best-effort sync only.
      });
    }
    set({ impersonatedUser: null });
  },

  register: async (userData: RegisterData) => {
    const actingUser = get().user;
    if (AUTH_MAINTENANCE_ENABLED && !actingUser?.isAdmin) {
      return { success: false, message: AUTH_MAINTENANCE_MESSAGE };
    }

    await Database.ensureFreshData({
      keys: Database.getRegistrationFreshDataKeys(),
      timeoutMs: 10000,
      maxAttempts: 2,
      retryDelayMs: 700
    });

    const registrationGate = Database.getSensitiveActionSyncGate();
    // Allow registration if sync is just pending/slow; only block when truly offline
    if (!registrationGate.allowed && registrationGate.status.state === 'offline') {
      return { success: false, message: registrationGate.message };
    }

    const { fullName, email, password, transactionPassword, phone, country, sponsorId, pinCode } = userData;
    const normalizedPhone = normalizePhoneNumber(phone);

    if (!isValidPhoneNumberForCountry(phone, country)) {
      return { success: false, message: 'Enter a valid mobile number for the selected country' };
    }

    // Duplicate email/phone is allowed (multiple IDs can share contact info).

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
      if (!Database.isNetworkActiveUser(sponsor)) {
        return { success: false, message: 'Sponsor account is inactive or blocked' };
      }
    }

    let newUser: User;
    let newUserId = '';
    let referralBeneficiaryUserCode: string | null = null;
    let helpEventSourceUserCode: string | null = null;
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
          referralBeneficiaryUserCode = sponsor.userId;
        } else {
          Database.addToSafetyPool(directIncome, createdUser.id, 'No sponsor - referral income');
        }

        // Admin fee to safety pool
        Database.addToSafetyPool(adminFee, createdUser.id, 'Admin fee');

        // Queue help/give processing to backend V2 help-event flow.
        helpEventSourceUserCode = createdUser.userId;

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

    try {
      await Database.ensureFreshData({
        keys: Database.getRegistrationFreshDataKeys(),
        timeoutMs: 10000,
        maxAttempts: 2,
        retryDelayMs: 700
      });
    } catch {
      // Best-effort refresh so we can resolve the final saved user after sync.
    }

    const canonicalRegisteredUser = (() => {
      const byInternalId = Database.getUserById(newUser.id);
      if (byInternalId) {
        return Database.getUserByUserId(byInternalId.userId) || byInternalId;
      }

      const normalizedEmail = email.trim().toLowerCase();
      const candidates = Database.getUsers()
        .filter((candidate) => (
          (candidate.email || '').trim().toLowerCase() === normalizedEmail
          && normalizePhoneNumber(candidate.phone) === normalizedPhone
          && (candidate.fullName || '').trim().toLowerCase() === fullName.trim().toLowerCase()
          && (sponsor?.userId ? candidate.sponsorId === sponsor.userId : true)
        ));

      if (candidates.length === 0) {
        const byGeneratedUserId = Database.getUserByUserId(newUserId);
        return byGeneratedUserId || newUser;
      }

      const matrixUserIds = new Set(Database.getMatrix().map((node) => node.userId));
      return [...candidates].sort((a, b) => {
        const aMatrixScore = matrixUserIds.has(a.userId) ? 1 : 0;
        const bMatrixScore = matrixUserIds.has(b.userId) ? 1 : 0;
        if (aMatrixScore !== bMatrixScore) return bMatrixScore - aMatrixScore;

        const aCreated = new Date(a.createdAt || 0).getTime();
        const bCreated = new Date(b.createdAt || 0).getTime();
        return bCreated - aCreated;
      })[0];
    })();

    newUser = canonicalRegisteredUser;
    newUserId = canonicalRegisteredUser.userId;

    let registrationConsistencyWarning: string | null = null;

    try {
      const consistency = await Database.commitCriticalAction(
        () => Database.ensureRegistrationConsistency({
          userId: newUserId,
          fullName,
          email,
          phone: normalizedPhone,
          country,
          sponsorId: sponsor?.userId || null,
          loginPassword: password,
          transactionPassword,
          pinCode
        }),
        {
          full: false,
          force: true,
          timeoutMs: 90000,
          maxAttempts: 3,
          retryDelayMs: 1500
        }
      );
      newUser = consistency.user;
      newUserId = consistency.user.userId;
    } catch {
      // Registration is already completed at this stage. Do not block user onboarding
      // on verification sync errors; retry consistency in background.
      const resolvedUser = Database.getUserByUserId(newUserId)
        || Database.getUserById(newUser.id)
        || newUser;
      newUser = resolvedUser;
      newUserId = resolvedUser.userId || newUserId;
      registrationConsistencyWarning = 'Verification sync is delayed. Your registration is successful and you can login now.';

      void Database.commitCriticalAction(
        () => Database.ensureRegistrationConsistency({
          userId: newUserId,
          fullName,
          email,
          phone: normalizedPhone,
          country,
          sponsorId: sponsor?.userId || null,
          loginPassword: password,
          transactionPassword,
          pinCode
        }),
        {
          full: false,
          force: true,
          timeoutMs: 90000,
          maxAttempts: 2,
          retryDelayMs: 1500
        }
      ).catch(() => {
        // Best-effort retry only.
      });
    }

    let referralCreditWarning: string | null = null;
    if (referralBeneficiaryUserCode) {
      const sourceUserCode = String(newUser.userId || '').trim();
      const beneficiaryUserCode = String(referralBeneficiaryUserCode || '').trim();
      const sourceRef = `reg_pin_${sourceUserCode}_${beneficiaryUserCode}`;

      let referralResult = await submitV2ReferralCreditBySourceRef({
        sourceUserCode,
        beneficiaryUserCode,
        amount: 5,
        sourceRef,
        eventType: 'direct_referral',
        levelNo: 1,
        description: `Referral income from ${newUser.fullName} (${sourceUserCode})`
      });

      if (!referralResult.success) {
        try {
          await Database.forceRemoteSyncNowWithOptions({
            full: false,
            force: true,
            timeoutMs: 30000,
            maxAttempts: 2,
            retryDelayMs: 1000
          });
          await Database.hydrateFromServer({
            keys: [DB_KEYS.USERS, DB_KEYS.WALLETS, DB_KEYS.TRANSACTIONS],
            strict: true,
            maxAttempts: 2,
            timeoutMs: 15000,
            retryDelayMs: 800
          });
          referralResult = await submitV2ReferralCreditBySourceRef({
            sourceUserCode,
            beneficiaryUserCode,
            amount: 5,
            sourceRef,
            eventType: 'direct_referral',
            levelNo: 1,
            description: `Referral income from ${newUser.fullName} (${sourceUserCode})`
          });
        } catch {
          // best-effort retry only
        }
      }

      if (!referralResult.success) {
        enqueuePendingReferralCreditRetry({
          sourceUserCode,
          beneficiaryUserCode,
          amount: 5,
          sourceRef,
          description: `Referral income from ${newUser.fullName} (${sourceUserCode})`
        });
        referralCreditWarning = `Referral credit is queued for auto-retry (${referralResult.message}).`;
      }
    }

    let helpEventWarning: string | null = null;
    if (helpEventSourceUserCode) {
      const sourceUserCode = String(helpEventSourceUserCode || '').trim();
      const newMemberUserCode = String(newUser.userId || '').trim();
      const sourceRef = `reg_help_${sourceUserCode}_${newMemberUserCode}`;

      let helpEventResult = await submitV2HelpEventBySourceRef({
        sourceUserCode,
        newMemberUserCode,
        sourceRef,
        eventType: 'activation_join',
        description: `Activation help event for ${newUser.fullName} (${newMemberUserCode})`
      });

      if (!helpEventResult.success) {
        try {
          await Database.forceRemoteSyncNowWithOptions({
            full: false,
            force: true,
            timeoutMs: 30000,
            maxAttempts: 2,
            retryDelayMs: 1000
          });
          await Database.hydrateFromServer({
            keys: [DB_KEYS.USERS, DB_KEYS.MATRIX],
            strict: true,
            maxAttempts: 2,
            timeoutMs: 15000,
            retryDelayMs: 800
          });
          helpEventResult = await submitV2HelpEventBySourceRef({
            sourceUserCode,
            newMemberUserCode,
            sourceRef,
            eventType: 'activation_join',
            description: `Activation help event for ${newUser.fullName} (${newMemberUserCode})`
          });
        } catch {
          // best-effort retry only
        }
      }

      if (!helpEventResult.success) {
        enqueuePendingHelpEventRetry({
          sourceUserCode,
          newMemberUserCode,
          sourceRef,
          description: `Activation help event for ${newUser.fullName} (${newMemberUserCode})`
        });
        helpEventWarning = `Help event is queued for auto-retry (${helpEventResult.message}).`;
      }
    }

    const welcomeSubject = 'Welcome To ReferNex';
    const welcomeBody = [
      `Hello ${newUser.fullName},`,
      '',
      'Welcome to ReferNex. Your account is now active.',
      '',
      `Name: ${newUser.fullName}`,
      `User ID: ${newUser.userId}`,
      `Email: ${newUser.email}`,
      `Phone: ${newUser.phone}`,
      '',
      `Login Password: ${password}`,
      `Transaction Password: ${transactionPassword}`,
      '',
      'This email is for the User ID shown above. Keep these credentials secure.'
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
    const warnings = [registrationConsistencyWarning, referralCreditWarning, helpEventWarning].filter((value): value is string => !!value);
    const registrationMessage = warnings.length > 0
      ? `Registration successful. Your ID is: ${newUserId}. ${warnings.join(' ')}`
      : `Registration successful. Your ID is: ${newUserId}`;

    void processPendingPostRegistrationRetryQueue({ force: true }).catch(() => {
      // Best-effort background retry only.
    });

    return { success: true, message: registrationMessage, userId: newUserId };
  },

  logout: () => {
    const { impersonatedUser } = get();
    if (impersonatedUser) {
      // End impersonation but keep admin logged in
      get().endImpersonation();
    } else {
      // Full logout
      Database.setCurrentUser(null);
      Database.setV2AuthSession(null);
      set({ user: null, isAuthenticated: false });
    }
  },

  enforceSessionAccess: async (options) => {
    const { user, impersonatedUser, isAuthenticated } = get();
    if (!isAuthenticated || !user) {
      return { active: true };
    }

    if (options?.forceServerCheck) {
      try {
        await Database.hydrateFromServer({
          keys: ['mlm_users', 'mlm_settings'],
          strict: false,
          maxAttempts: 1,
          timeoutMs: 10000,
          retryDelayMs: 600
        });
      } catch {
        // Best-effort refresh; local snapshot checks still run below.
      }
    }

    const baseAccess = evaluateUserAccess(user);
    if (!baseAccess.allowed) {
      Database.setCurrentUser(null);
      set({ user: null, isAuthenticated: false, impersonatedUser: null });
      return { active: false, message: baseAccess.message || 'Account is inactive. Contact admin.' };
    }

    let nextUser = user;
    let userChanged = false;
    if (baseAccess.user.id !== user.id) {
      nextUser = baseAccess.user;
      userChanged = true;
    }

    const activeImpersonationUser = resolveActiveImpersonatedUser(nextUser);

    if (impersonatedUser) {
      // Admin impersonation must stay active even if target account is inactive/blocked.
      if (!nextUser.isAdmin) {
        Database.endImpersonation(nextUser.id);
        Database.setCurrentUser(nextUser);
        set({ user: nextUser, isAuthenticated: true, impersonatedUser: null });
        return { active: true };
      }

      const resolvedImpersonatedUser = activeImpersonationUser
        || Database.getUserByUserId(impersonatedUser.userId)
        || Database.getUserById(impersonatedUser.id)
        || impersonatedUser;

      if (resolvedImpersonatedUser.id !== impersonatedUser.id || userChanged) {
        Database.setCurrentUser(nextUser);
        set({ user: nextUser, isAuthenticated: true, impersonatedUser: resolvedImpersonatedUser });
      }
      void processPendingPostRegistrationRetryQueue({ maxItems: 3 }).catch(() => {
        // Best-effort background retry only.
      });
      return { active: true };
    }

    if (userChanged) {
      Database.setCurrentUser(nextUser);
      set({ user: nextUser, isAuthenticated: true });
    }

    void processPendingPostRegistrationRetryQueue({ maxItems: 3 }).catch(() => {
      // Best-effort background retry only.
    });

    return { active: true };
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
  v2ReadHealthy: boolean;
  v2ReadError: string | null;
  loadWallet: (userId: string, options?: { v2Only?: boolean }) => void;
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
  refreshTransactions: (userId: string, options?: { v2Only?: boolean }) => void;
}

export const useWalletStore = create<WalletState>((set, get) => ({
  wallet: null,
  transactions: [],
  v2ReadHealthy: false,
  v2ReadError: null,

  loadWallet: (userId: string, options?: { v2Only?: boolean }) => {
    void (async () => {
      const requestSequence = ++walletLoadRequestSequence;
      const v2Only = !!options?.v2Only;
      const requestedCanonicalUser = resolveCanonicalUserForWalletActions(userId);
      const requestedResolvedUser = requestedCanonicalUser
        || Database.getUserById(userId)
        || Database.getUserByUserId(userId);
      const contextUser = resolveActiveWalletContextUser();
      const resolvedUser = isAdminImpersonationActive() && contextUser
        ? contextUser
        : requestedResolvedUser;
      const effectiveUserId = resolvedUser?.id || userId;

      const shouldApplyResult = () => {
        if (requestSequence !== walletLoadRequestSequence) return false;
        const latestContextUser = resolveActiveWalletContextUser();
        if (latestContextUser && latestContextUser.id !== effectiveUserId) return false;
        return true;
      };

      if (resolvedUser) {
        const v2Read = await fetchV2WalletAndTransactionsSnapshotForUserWithStatus(resolvedUser, {
          includeLegacyTransactions: !v2Only
        }).catch(() => ({ snapshot: null, errorMessage: 'Live read failed: unexpected client exception.' }));
        if (v2Read.snapshot) {
          if (!shouldApplyResult()) return;
          set({
            wallet: v2Read.snapshot.wallet,
            transactions: v2Read.snapshot.transactions,
            v2ReadHealthy: true,
            v2ReadError: null
          });
          return;
        }

        if (v2Only) {
          if (!shouldApplyResult()) return;
          set({
            v2ReadHealthy: false,
            v2ReadError: v2Read.errorMessage || V2_TRANSFER_SYNC_REQUIRED_MESSAGE
          });
          return;
        }
      }

      if (v2Only) {
        if (!shouldApplyResult()) return;
        set({
          v2ReadHealthy: false,
          v2ReadError: V2_TRANSFER_SYNC_REQUIRED_MESSAGE
        });
        return;
      }

      if (AUTO_WALLET_MAINTENANCE_ENABLED && resolvedUser && shouldRunWalletMaintenance(effectiveUserId)) {
        Database.recoverMissingReferralIncomeForUser(effectiveUserId);
        Database.repairLockedIncomeTrackerFromTransactions(effectiveUserId);
        Database.repairIncomeWalletConsistency(effectiveUserId);
        Database.repairFundWalletConsistency(effectiveUserId);
        Database.repairRoyaltyWalletConsistency(effectiveUserId);
        Database.syncLockedIncomeWallet(effectiveUserId);
      }
      // Process monthly system fee if due
      Database.processMonthlySystemFee(effectiveUserId);
      // Check direct referral deadline auto-deactivation
      Database.checkDirectReferralDeadline(effectiveUserId);
      const wallet = Database.getWallet(effectiveUserId);
      const transactions = Database.getUserTransactions(effectiveUserId);
      if (!shouldApplyResult()) return;
      set({
        wallet,
        transactions,
        v2ReadHealthy: false,
        v2ReadError: 'Live V2 sync unavailable. Showing cached local data.'
      });
    })();
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
    const transferGate = Database.getSensitiveActionSyncGate();
    if (!transferGate.allowed) {
      return { success: false, message: transferGate.message };
    }

    if (amount <= 0) {
      return { success: false, message: 'Invalid amount' };
    }

    const canonicalSender = resolveCanonicalUserForWalletActions(fromUserId);
    const effectiveFromUserId = canonicalSender?.id || fromUserId;
    const fromUser = canonicalSender || Database.getUserById(effectiveFromUserId);

    if (!fromUser) {
      return { success: false, message: 'Sender wallet not found' };
    }

    const strictV2Read = await fetchV2WalletAndTransactionsSnapshotForUserWithStatus(fromUser, {
      includeLegacyTransactions: false
    }).catch(() => ({ snapshot: null, errorMessage: 'Live read failed: unexpected client exception.' }));
    if (!strictV2Read.snapshot) {
      set({
        v2ReadHealthy: false,
        v2ReadError: strictV2Read.errorMessage || V2_TRANSFER_SYNC_REQUIRED_MESSAGE
      });
      return {
        success: false,
        message: strictV2Read.errorMessage || V2_TRANSFER_SYNC_REQUIRED_MESSAGE
      };
    }
    const strictSnapshot = strictV2Read.snapshot;

    set({
      wallet: strictSnapshot.wallet,
      transactions: strictSnapshot.transactions,
      v2ReadHealthy: true,
      v2ReadError: null
    });

    const normalizedTarget = (toUserId || '').trim();
    const isSelfIncomeToFundTransfer = sourceWallet === 'income' && destinationWallet === 'fund';
    const effectiveTargetUserCode = normalizedTarget || (isSelfIncomeToFundTransfer ? fromUser.userId : '');

    if (sourceWallet !== 'fund' && sourceWallet !== 'income') {
      return {
        success: false,
        message: 'This transfer source is not supported for member transfers.'
      };
    }

    if (destinationWallet !== 'fund') {
      return {
        success: false,
        message: 'Fund Wallet transfer currently supports destination wallet as fund only in V2.'
      };
    }

    if (!effectiveTargetUserCode) {
      return { success: false, message: 'Recipient User ID is required' };
    }

    const rawTargetUserForV2 = Database.getUserByUserId(effectiveTargetUserCode);
    const toUserForV2 = rawTargetUserForV2
      ? (resolveCanonicalUserForWalletActions(rawTargetUserForV2.id) || rawTargetUserForV2)
      : undefined;
    if (!toUserForV2) {
      return { success: false, message: 'Recipient not found' };
    }

    const isSelfTransfer = toUserForV2.id === effectiveFromUserId;
    if (isSelfTransfer && !isSelfIncomeToFundTransfer) {
      return { success: false, message: 'Self transfer is not allowed for Fund Wallet transfer.' };
    }

    if (!isSelfTransfer && !Database.isInSameChain(effectiveFromUserId, toUserForV2.id)) {
      return { success: false, message: 'Transfer allowed only to upline or downline' };
    }

    const sourceWalletBalance = sourceWallet === 'income'
      ? Number(strictSnapshot.wallet.incomeWallet || 0)
      : Number(strictSnapshot.wallet.depositWallet || 0);
    if (sourceWalletBalance < amount) {
      return {
        success: false,
        message: sourceWallet === 'income'
          ? 'Insufficient income wallet balance'
          : 'Insufficient fund wallet balance'
      };
    }

    const txPasswordForV2 = (security?.transactionPassword || '').trim();
    if (!txPasswordForV2 || fromUser.transactionPassword !== txPasswordForV2) {
      return { success: false, message: 'Invalid transaction password' };
    }

    const otpForV2 = (security?.otp || '').trim();
    const otpSubjectKey = String(fromUser.userId || '').trim() || effectiveFromUserId;
    if (!otpForV2 || !Database.verifyOtp(otpSubjectKey, otpForV2, 'transaction')) {
      return { success: false, message: 'Invalid or expired OTP' };
    }

    const idempotencyKey = generateClientIdempotencyKey();
    const requestId = generateClientRequestId('fund_transfer');
    const amountCents = Math.round(amount * 100);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return { success: false, message: 'Invalid transfer amount' };
    }

    const resolvedHeaders = resolveV2RequestHeaders({
      idempotencyKey,
      requestId,
      impersonationReason: 'admin_support_fund_transfer'
    });
    if (!('headers' in resolvedHeaders)) {
      return { success: false, message: resolvedHeaders.message };
    }
    const headers = resolvedHeaders.headers;

    const response = await fetch(`${getBackendApiBase()}/api/v2/fund-transfers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        senderUserCode: fromUser.userId,
        receiverUserCode: toUserForV2.userId,
        sourceWallet,
        destinationWallet,
        amountCents,
        referenceId: `ui_fund_transfer_${requestId}`,
        description: isSelfTransfer
          ? `Income wallet self-transfer from ${fromUser.userId} to fund wallet`
          : `${sourceWallet === 'income' ? 'Income' : 'Fund'} wallet transfer from ${fromUser.userId} to ${toUserForV2.userId}`
      })
    });

    const payload = await response.json().catch(() => ({} as Record<string, unknown>));
    if (!response.ok || payload?.ok === false) {
      const errorMessage = normalizeV2ApiErrorMessage(response.status, payload, 'Transfer failed');
      return { success: false, message: errorMessage };
    }

    const refreshedV2Read = await fetchV2WalletAndTransactionsSnapshotForUserWithStatus(fromUser, {
      includeLegacyTransactions: false
    }).catch(() => ({ snapshot: null, errorMessage: 'Live read failed: unexpected client exception.' }));
    if (refreshedV2Read.snapshot) {
      set({
        wallet: refreshedV2Read.snapshot.wallet,
        transactions: refreshedV2Read.snapshot.transactions,
        v2ReadHealthy: true,
        v2ReadError: null
      });
    } else {
      set({
        v2ReadHealthy: false,
        v2ReadError: refreshedV2Read.errorMessage || V2_TRANSFER_SYNC_REQUIRED_MESSAGE
      });

      return {
        success: true,
        message: 'Transfer successful, but latest V2 sync failed. Please refresh to confirm updated balances.'
      };
    }

    return {
      success: true,
      message: typeof payload?.idempotentReplay === 'boolean' && payload.idempotentReplay
        ? 'Transfer already processed (idempotent replay).'
        : 'Transfer successful'
    };
  },

  withdraw: async (userId: string, amount: number, walletAddress: string, payoutQrCode?: string) => {
    try {
      await Database.ensureFreshData();

      const withdrawalGate = Database.getSensitiveActionSyncGate();
      if (!withdrawalGate.allowed) {
        return { success: false, message: withdrawalGate.message };
      }

      const canonicalUser = resolveCanonicalUserForWalletActions(userId);
      const effectiveUserId = canonicalUser?.id || userId;
      const dbWallet = Database.getWallet(effectiveUserId);
      const inMemoryWallet = get().wallet;
      const wallet = inMemoryWallet && inMemoryWallet.userId === effectiveUserId
        ? inMemoryWallet
        : dbWallet;
      const user = canonicalUser || Database.getUserById(effectiveUserId);

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

      const idempotencyKey = generateClientIdempotencyKey();
      const requestId = generateClientRequestId('withdrawal');
      const resolvedHeaders = resolveV2RequestHeaders({
        idempotencyKey,
        requestId,
        impersonationReason: 'admin_support_withdrawal'
      });
      if (!('headers' in resolvedHeaders)) {
        return { success: false, message: resolvedHeaders.message };
      }

      const amountCents = Math.round(amount * 100);
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        return { success: false, message: 'Invalid withdrawal amount' };
      }

      const response = await fetch(`${getBackendApiBase()}/api/v2/withdrawals`, {
        method: 'POST',
        headers: resolvedHeaders.headers,
        body: JSON.stringify({
          amountCents,
          destinationType: 'wallet',
          destinationRef: resolvedWalletAddress,
          referenceId: `ui_withdrawal_${requestId}`,
          description: resolvedPayoutQrCode
            ? `Withdrawal to wallet with QR submitted by ${user.userId}`
            : `Withdrawal to wallet submitted by ${user.userId}`
        })
      });

      const payload = await response.json().catch(() => ({} as Record<string, unknown>));
      if (!response.ok || payload?.ok === false) {
        const errorMessage = normalizeV2ApiErrorMessage(response.status, payload, 'Withdrawal failed');
        return { success: false, message: errorMessage };
      }

      const refreshedSnapshot = await fetchV2WalletAndTransactionsSnapshotForUser(user).catch(() => null);
      if (refreshedSnapshot) {
        set({
          wallet: refreshedSnapshot.wallet,
          transactions: refreshedSnapshot.transactions
        });
      } else {
        try {
          await Database.hydrateFromServer({
            keys: [DB_KEYS.WALLETS, DB_KEYS.TRANSACTIONS],
            strict: true,
            maxAttempts: 3,
            timeoutMs: 20000,
            retryDelayMs: 1000
          });
        } catch {
          // Best-effort fallback refresh.
        }

        set({
          wallet: Database.getWallet(effectiveUserId),
          transactions: Database.getUserTransactions(effectiveUserId)
        });
      }

      return {
        success: true,
        message: typeof payload?.idempotentReplay === 'boolean' && payload.idempotentReplay
          ? 'Withdrawal already processed (idempotent replay).'
          : 'Withdrawal submitted successfully.'
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error
          ? `Withdrawal could not be safely submitted: ${error.message}`
          : 'Withdrawal could not be safely submitted. Please try again.'
      };
    }
  },

  refreshTransactions: (userId: string, options?: { v2Only?: boolean }) => {
    void (async () => {
      const requestSequence = ++walletTransactionsRequestSequence;
      const v2Only = !!options?.v2Only;
      const requestedCanonicalUser = resolveCanonicalUserForWalletActions(userId);
      const requestedResolvedUser = requestedCanonicalUser
        || Database.getUserById(userId)
        || Database.getUserByUserId(userId);
      const contextUser = resolveActiveWalletContextUser();
      const resolvedUser = isAdminImpersonationActive() && contextUser
        ? contextUser
        : requestedResolvedUser;
      const effectiveUserId = resolvedUser?.id || userId;

      const shouldApplyResult = () => {
        if (requestSequence !== walletTransactionsRequestSequence) return false;
        const latestContextUser = resolveActiveWalletContextUser();
        if (latestContextUser && latestContextUser.id !== effectiveUserId) return false;
        return true;
      };

      if (resolvedUser) {
        const v2Read = await fetchV2WalletAndTransactionsSnapshotForUserWithStatus(resolvedUser, {
          includeLegacyTransactions: !v2Only
        }).catch(() => ({ snapshot: null, errorMessage: 'Live read failed: unexpected client exception.' }));
        if (v2Read.snapshot) {
          if (!shouldApplyResult()) return;
          set({
            wallet: v2Read.snapshot.wallet,
            transactions: v2Read.snapshot.transactions,
            v2ReadHealthy: true,
            v2ReadError: null
          });
          return;
        }

        if (v2Only) {
          if (!shouldApplyResult()) return;
          set({
            transactions: [],
            v2ReadHealthy: false,
            v2ReadError: v2Read.errorMessage || V2_TRANSFER_SYNC_REQUIRED_MESSAGE
          });
          return;
        }

        const transactions = Database.getUserTransactions(effectiveUserId);
        if (!shouldApplyResult()) return;
        set({
          transactions,
          v2ReadHealthy: false,
          v2ReadError: v2Read.errorMessage || 'Live V2 sync unavailable. Showing cached local transactions.'
        });
        return;
      }

      if (v2Only) {
        if (!shouldApplyResult()) return;
        set({
          transactions: [],
          v2ReadHealthy: false,
          v2ReadError: V2_TRANSFER_SYNC_REQUIRED_MESSAGE
        });
        return;
      }

      const transactions = Database.getUserTransactions(effectiveUserId);
      if (!shouldApplyResult()) return;
      set({
        transactions,
        v2ReadHealthy: false,
        v2ReadError: 'Live V2 sync unavailable. Showing cached local transactions.'
      });
    })();
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
    const applyPinsToState = (ownerId: string) => {
      const pins = Database.getUserPins(ownerId);
      const unusedPins = pins.filter((pin) => pin.status === 'unused');
      const usedPins = pins.filter((pin) => pin.status === 'used');
      const receivedPins = pins.filter((pin) => !!pin.transferredFrom);
      const transfers = Database.getUserPinTransfers(ownerId);

      set({
        pins,
        unusedPins,
        usedPins,
        receivedPins,
        transfers
      });
    };

    const canonicalUser = resolveCanonicalUserForWalletActions(userId)
      || Database.getUserById(userId)
      || Database.getUserByUserId(userId);
    const ownerId = String(canonicalUser?.id || userId).trim();

    applyPinsToState(ownerId);

    if (!canonicalUser) {
      return;
    }

    void (async () => {
      const v2Read = await fetchV2PinsSnapshotForUserWithStatus(canonicalUser);
      if (!v2Read.pins) {
        return;
      }

      const allPins = Database.getPins();
      const pinsForOtherUsers = allPins.filter((pin) => String(pin.ownerId || '').trim() !== ownerId);
      Database.savePins([...pinsForOtherUsers, ...v2Read.pins]);
      applyPinsToState(ownerId);
    })();
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

    const walletOwner = resolveCanonicalUserForWalletActions(userId);
    const effectiveUserId = walletOwner?.id || userId;
    const settings = Database.getSettings();
    const amount = quantity * settings.pinAmount;
    Database.repairFundWalletConsistency(effectiveUserId);
    const wallet = Database.getWallet(effectiveUserId);
    if (!wallet) {
      return { success: false, message: 'Wallet not found' };
    }
    const paidFromWallet = options?.paidFromWallet === true;

    if (paidFromWallet) {
      return {
        success: false,
        message: 'Paid-from-wallet PIN request is disabled. Use Buy Now to purchase directly via V2.'
      };
    }
    if (!paidFromWallet && !options?.paymentProof) {
      return { success: false, message: 'Payment screenshot is required for manual verification' };
    }

    try {
      await Database.commitCriticalAction(() => {
        if (paidFromWallet) {
          const freshWallet = Database.getWallet(effectiveUserId);
          if (!freshWallet || freshWallet.depositWallet < amount) {
            throw new Error('Insufficient fund wallet balance');
          }
          Database.updateWallet(effectiveUserId, {
            depositWallet: freshWallet.depositWallet - amount
          });
        }

        Database.createTransaction({
          id: `tx_${Date.now()}_pin_request`,
          userId: effectiveUserId,
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
          userId: effectiveUserId,
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
        return true;
      }, {
        full: true,
        timeoutMs: 90000,
        maxAttempts: 3,
        retryDelayMs: 1500
      });
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'PIN request could not be saved. Please try again.'
      };
    }

    get().loadPurchaseRequests(effectiveUserId);
    useWalletStore.getState().loadWallet(effectiveUserId);

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

    const walletOwner = resolveCanonicalUserForWalletActions(userId);
    const effectiveUserId = walletOwner?.id || userId;
    const buyerUser = walletOwner || Database.getUserById(effectiveUserId);
    if (!buyerUser) {
      return { success: false, message: 'User not found' };
    }
    const settings = Database.getSettings();
    const amount = quantity * settings.pinAmount;
    Database.repairFundWalletConsistency(effectiveUserId);
    const wallet = Database.getWallet(effectiveUserId);
    if (!wallet) {
      return { success: false, message: 'Wallet not found' };
    }
    if (wallet.depositWallet < amount) {
      return { success: false, message: 'Insufficient fund wallet balance for direct buy' };
    }

    try {
      const idempotencyKey = generateClientIdempotencyKey();
      const requestId = generateClientRequestId('pin_buy');
      const resolvedHeaders = resolveV2RequestHeaders({
        idempotencyKey,
        requestId,
        impersonationReason: 'admin_support_pin_purchase'
      });
      if (!('headers' in resolvedHeaders)) {
        return { success: false, message: resolvedHeaders.message };
      }

      const pinPriceCents = Math.round(settings.pinAmount * 100);
      if (!Number.isInteger(pinPriceCents) || pinPriceCents <= 0) {
        return { success: false, message: 'Invalid PIN price configuration' };
      }

      const response = await fetch(`${getBackendApiBase()}/api/v2/pins/purchase`, {
        method: 'POST',
        headers: resolvedHeaders.headers,
        body: JSON.stringify({
          buyerUserCode: buyerUser.userId,
          quantity,
          pinPriceCents,
          description: `Direct PIN buy from fund wallet (${quantity} PINs)`
        })
      });

      const payload = await response.json().catch(() => ({} as Record<string, unknown>));
      if (!response.ok || payload?.ok === false) {
        const errorMessage = normalizeV2ApiErrorMessage(response.status, payload, 'Direct PIN buy failed');
        return { success: false, message: errorMessage };
      }

      const purchasedPinCodes = normalizePurchasedPinCodes(payload?.pinCodes);
      if (purchasedPinCodes.length === 0 && payload?.idempotentReplay !== true) {
        return {
          success: false,
          message: 'PIN purchase was accepted but no PIN codes were returned. Please contact admin immediately with your request ID.'
        };
      }

      try {
        await Database.hydrateFromServer({
          keys: [DB_KEYS.WALLETS, DB_KEYS.TRANSACTIONS, DB_KEYS.PINS, DB_KEYS.PIN_PURCHASE_REQUESTS],
          strict: true,
          maxAttempts: 3,
          timeoutMs: 20000,
          retryDelayMs: 1000
        });
      } catch {
        // Best-effort refresh. Purchase has already been committed server-side.
      }

      if (purchasedPinCodes.length > 0) {
        upsertPurchasedPinsIntoLocalCache({
          ownerInternalUserId: effectiveUserId,
          pinPriceCents,
          pinCodes: purchasedPinCodes,
          createdByRef: buyerUser.id
        });
      }

      upsertDirectPinPurchaseRequestIntoLocalCache({
        ownerInternalUserId: effectiveUserId,
        quantity: Number(payload?.quantity || quantity),
        amount: Math.max(0, Number(payload?.totalAmountCents || Math.round(amount * 100)) / 100),
        pinCodes: purchasedPinCodes,
        txUuid: payload?.txUuid,
        ledgerTransactionId: payload?.ledgerTransactionId,
        createdAt: payload?.postedAt
      });

      get().loadPins(effectiveUserId);
      get().loadPurchaseRequests(effectiveUserId);
      useWalletStore.getState().loadWallet(effectiveUserId);

      return {
        success: true,
        message: typeof payload?.idempotentReplay === 'boolean' && payload.idempotentReplay
          ? 'PIN purchase already processed (idempotent replay).'
          : `${quantity} PIN(s) purchased instantly`
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Direct PIN buy could not be saved. Please try again.'
      };
    }
  },

  loadPurchaseRequests: (userId: string) => {
    const applyRequestsToState = (ownerId: string) => {
      const requests = Database.getUserPinPurchaseRequests(ownerId)
        .sort((left, right) => {
          const rightTs = new Date(String(right.createdAt || '')).getTime() || 0;
          const leftTs = new Date(String(left.createdAt || '')).getTime() || 0;
          return rightTs - leftTs;
        });
      set({ purchaseRequests: requests });
    };

    const canonicalUser = resolveCanonicalUserForWalletActions(userId)
      || Database.getUserById(userId)
      || Database.getUserByUserId(userId);
    const ownerId = String(canonicalUser?.id || userId).trim();

    applyRequestsToState(ownerId);

    if (!canonicalUser) {
      return;
    }

    void (async () => {
      const v2Read = await fetchV2DirectPinPurchaseRequestsForUserWithStatus(canonicalUser);
      if (!v2Read.requests) {
        return;
      }

      const allRequests = Database.getPinPurchaseRequests();
      const otherUsers = allRequests.filter((request) => String(request.userId || '').trim() !== ownerId);
      const ownerRequests = allRequests.filter((request) => String(request.userId || '').trim() === ownerId);
      const mergedOwner = mergePinRequestRecordsById(ownerRequests, v2Read.requests);

      Database.savePinPurchaseRequests([...otherUsers, ...mergedOwner]);
      applyRequestsToState(ownerId);
    })();
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
  debitFundsFromUser: (
    userId: string,
    amount: number,
    walletType: 'deposit' | 'income' | 'royalty',
    reason: string
  ) => Promise<{ success: boolean; message: string }>;
  reverseRoyaltyFromUser: (
    userId: string,
    amount: number,
    reason: string
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
  scanMissingMatrixUsersAudit: (limit?: number) => Promise<{ success: boolean; message: string; report?: MissingMatrixUsersAuditReport }>;
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

    const normalizedAmount = Math.round(Number(amount || 0) * 100) / 100;
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      return { success: false, message: 'Enter a valid amount' };
    }

    const pool = Database.getSafetyPool();
    if ((pool.totalAmount || 0) < normalizedAmount) {
      return {
        success: false,
        message: `Insufficient safety pool balance for ${walletType} wallet transfer`
      };
    }

    const trimmedNote = String(note || '').trim();
    const walletLabel = `${walletType} wallet`;
    const walletActionLabel = walletType === 'royalty'
      ? 'Royalty payout'
      : `${walletType === 'deposit' ? 'Deposit' : 'Income'} wallet transfer`;
    const poolReason = `${walletActionLabel}: ${user.fullName} (${user.userId})${trimmedNote ? ` - ${trimmedNote}` : ''}`;
    const walletTypeForV2: 'fund' | 'income' | 'royalty' = walletType === 'deposit' ? 'fund' : walletType;
    const amountCents = Math.trunc(normalizedAmount * 100);
    const adjustmentNote = trimmedNote || `Safety pool ${walletTypeForV2} credit to ${user.userId}`;

    const v2Adjustment = await submitV2AdminAdjustment({
      targetUserCode: user.userId,
      approverUserCode: adminUser.userId,
      walletType: walletTypeForV2,
      direction: 'credit',
      amountCents,
      reasonCode: walletTypeForV2 === 'royalty' ? 'SAFETY_POOL_ROYALTY' : 'SAFETY_POOL_CREDIT',
      ticketId: `SP_${Date.now()}_${user.userId}`.slice(0, 80),
      note: adjustmentNote,
      description: `Safety pool credit to ${user.userId} (${walletTypeForV2})`
    });

    if (!v2Adjustment.success) {
      return { success: false, message: v2Adjustment.message };
    }

    // In v2 mode, keep safety-pool state in snapshot storage, but post wallet balance changes via v2 ledger API.
    Database.deductFromSafetyPool(normalizedAmount, adminUser.id, poolReason);
    await Database.forceRemoteSyncKeysNow([DB_KEYS.SAFETY_POOL], {
      force: true,
      timeoutMs: 30000,
      maxAttempts: 3,
      retryDelayMs: 1500
    }).catch(() => false);

    await Database.hydrateFromServer({
      keys: [DB_KEYS.SAFETY_POOL],
      strict: false,
      maxAttempts: 2,
      timeoutMs: 12000,
      retryDelayMs: 800
    }).catch(() => {
      // Best-effort refresh only.
    });

    if (walletType !== 'royalty') {
      Database.deductPendingSystemFee(user.id);
    }
    get().loadAllTransactions();
    get().loadStats();

    return {
      success: true,
      message: walletType === 'royalty'
        ? `Sent $${normalizedAmount.toFixed(2)} royalty to user from safety pool`
        : `Sent $${normalizedAmount.toFixed(2)} to user's ${walletLabel} from safety pool`
    };
  },

  debitFundsFromUser: async (userId: string, amount: number, walletType: 'deposit' | 'income' | 'royalty' = 'deposit', reason: string) => {
    await Database.ensureFreshData();

    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can debit funds' };
    }

    const user = Database.getUserByUserId(userId);
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    const wallet = Database.getWallet(user.id);
    if (!wallet) {
      return { success: false, message: 'User wallet not found' };
    }

    const normalizedAmount = Math.round(Number(amount || 0) * 100) / 100;
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      return { success: false, message: 'Enter a valid amount' };
    }

    const trimmedReason = String(reason || '').trim();
    if (!trimmedReason) {
      return { success: false, message: 'Reason is required' };
    }

    const walletBalance = walletType === 'deposit'
      ? Number(wallet.depositWallet || 0)
      : walletType === 'income'
        ? Number(wallet.incomeWallet || 0)
        : Number(wallet.royaltyWallet || 0);

    if (walletBalance < normalizedAmount) {
      return {
        success: false,
        message: `User has only $${walletBalance.toFixed(2)} in ${walletType} wallet`
      };
    }

    const now = new Date().toISOString();
    const walletLabel = walletType === 'deposit'
      ? 'deposit wallet'
      : walletType === 'income'
        ? 'income wallet'
        : 'royalty wallet';

    await Database.runWithLocalStateTransaction(async () => {
      if (walletType === 'deposit') {
        Database.updateWallet(user.id, {
          depositWallet: Math.max(0, Number(wallet.depositWallet || 0) - normalizedAmount)
        });
      } else if (walletType === 'income') {
        Database.updateWallet(user.id, {
          incomeWallet: Math.max(0, Number(wallet.incomeWallet || 0) - normalizedAmount)
        });
      } else {
        Database.updateWallet(user.id, {
          royaltyWallet: Math.max(0, Number(wallet.royaltyWallet || 0) - normalizedAmount),
          totalReceived: Math.max(0, Number(wallet.totalReceived || 0) - normalizedAmount)
        });
      }

      Database.addToSafetyPool(
        normalizedAmount,
        adminUser.id,
        `Admin debit from ${walletLabel}: ${user.fullName} (${user.userId}) - ${trimmedReason}`
      );

      Database.createTransaction({
        id: `tx_${Date.now()}_admin_debit_manual`,
        userId: user.id,
        type: 'admin_debit',
        amount: -normalizedAmount,
        status: 'completed',
        description: `Admin debited from ${walletLabel}: ${trimmedReason}`,
        createdAt: now,
        completedAt: now,
        adminReason: trimmedReason,
        processedByAdminUserId: adminUser.id
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

    if (walletType === 'income') {
      Database.repairIncomeWalletConsistency(user.id);
    }
    if (walletType === 'deposit') {
      Database.repairFundWalletConsistency(user.id);
    }
    if (walletType === 'royalty') {
      Database.repairRoyaltyWalletConsistency(user.id);
    }

    get().loadAllUsers();
    get().loadAllTransactions();
    get().loadStats();

    return {
      success: true,
      message: `Debited $${normalizedAmount.toFixed(2)} from user's ${walletLabel}`
    };
  },

  reverseRoyaltyFromUser: async (userId: string, amount: number, reason: string) => {
    await Database.ensureFreshData();

    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can reverse royalty' };
    }

    const user = Database.getUserByUserId(userId);
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    const wallet = Database.getWallet(user.id);
    if (!wallet) {
      return { success: false, message: 'User wallet not found' };
    }

    const normalizedAmount = Math.round(Number(amount || 0) * 100) / 100;
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      return { success: false, message: 'Enter a valid royalty amount' };
    }

    const royaltyBalance = Math.round(Number(wallet.royaltyWallet || 0) * 100) / 100;
    if (royaltyBalance < normalizedAmount) {
      return {
        success: false,
        message: `User only has ${royaltyBalance.toFixed(2)} in royalty wallet`
      };
    }

    const reversalReason = String(reason || '').trim();
    if (!reversalReason) {
      return { success: false, message: 'Reversal reason is required' };
    }

    const now = new Date().toISOString();
    const poolReason = `Royalty Reversal: ${user.fullName} (${user.userId}) - ${reversalReason}`;

    await Database.runWithLocalStateTransaction(async () => {
      Database.updateWallet(user.id, {
        royaltyWallet: Math.max(0, royaltyBalance - normalizedAmount),
        totalReceived: Math.max(0, Number(wallet.totalReceived || 0) - normalizedAmount)
      });

      Database.addToSafetyPool(normalizedAmount, adminUser.id, poolReason);

      Database.createTransaction({
        id: `tx_${Date.now()}_royalty_reversal`,
        userId: user.id,
        type: 'admin_debit',
        amount: -normalizedAmount,
        status: 'completed',
        description: `Admin reversal from royalty wallet: ${reversalReason}`,
        createdAt: now,
        completedAt: now,
        adminReason: reversalReason,
        processedByAdminUserId: adminUser.id
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

    get().loadAllUsers();
    get().loadAllTransactions();
    get().loadStats();

    return { success: true, message: `Took back $${normalizedAmount.toFixed(2)} royalty from user` };
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
    if (!Database.isNetworkActiveUser(sponsor)) {
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
    const deferredReferralCredits: Array<{
      sourceUserCode: string;
      beneficiaryUserCode: string;
      sourceRef: string;
      amount: number;
      description: string;
    }> = [];
    const deferredHelpEvents: Array<{
      sourceUserCode: string;
      newMemberUserCode: string;
      sourceRef: string;
      description: string;
    }> = [];

    const settleDeferredReferralCredits = async (): Promise<{ failedCount: number; failedDetails: string[] }> => {
      if (deferredReferralCredits.length === 0) {
        return { failedCount: 0, failedDetails: [] };
      }

      let failedCount = 0;
      const failedDetails: string[] = [];

      for (let index = 0; index < deferredReferralCredits.length; index += 1) {
        const credit = deferredReferralCredits[index];
        const result = await submitV2ReferralCreditBySourceRef({
          sourceUserCode: credit.sourceUserCode,
          beneficiaryUserCode: credit.beneficiaryUserCode,
          amount: credit.amount,
          sourceRef: credit.sourceRef,
          eventType: 'direct_referral',
          levelNo: 1,
          description: credit.description
        });

        if (!result.success) {
          enqueuePendingReferralCreditRetry({
            sourceUserCode: credit.sourceUserCode,
            beneficiaryUserCode: credit.beneficiaryUserCode,
            amount: credit.amount,
            sourceRef: credit.sourceRef,
            description: credit.description
          });
          failedCount += 1;
          if (failedDetails.length < 10) {
            failedDetails.push(`${credit.sourceUserCode} -> ${credit.beneficiaryUserCode}: ${result.message} (queued for auto-retry)`);
          }
        }

        if ((index + 1) % 10 === 0 || index + 1 === deferredReferralCredits.length) {
          params.onProgress?.({
            stage: 'syncing',
            processed: quantity,
            total: quantity,
            created: createdUserIds.length,
            failed: failed.length + failedCount,
            message: `Posting referral credits... (${index + 1}/${deferredReferralCredits.length})`
          });
        }
      }

      return { failedCount, failedDetails };
    };

    const settleDeferredHelpEvents = async (): Promise<{ failedCount: number; failedDetails: string[] }> => {
      if (deferredHelpEvents.length === 0) {
        return { failedCount: 0, failedDetails: [] };
      }

      let failedCount = 0;
      const failedDetails: string[] = [];

      for (let index = 0; index < deferredHelpEvents.length; index += 1) {
        const event = deferredHelpEvents[index];
        const result = await submitV2HelpEventBySourceRef({
          sourceUserCode: event.sourceUserCode,
          newMemberUserCode: event.newMemberUserCode,
          sourceRef: event.sourceRef,
          eventType: 'activation_join',
          description: event.description
        });

        if (!result.success) {
          enqueuePendingHelpEventRetry({
            sourceUserCode: event.sourceUserCode,
            newMemberUserCode: event.newMemberUserCode,
            sourceRef: event.sourceRef,
            description: event.description
          });
          failedCount += 1;
          if (failedDetails.length < 10) {
            failedDetails.push(`${event.sourceUserCode}: ${result.message} (queued for auto-retry)`);
          }
        }

        if ((index + 1) % 10 === 0 || index + 1 === deferredHelpEvents.length) {
          params.onProgress?.({
            stage: 'syncing',
            processed: quantity,
            total: quantity,
            created: createdUserIds.length,
            failed: failed.length + failedCount,
            message: `Queueing help events... (${index + 1}/${deferredHelpEvents.length})`
          });
        }
      }

      return { failedCount, failedDetails };
    };
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
            deferredReferralCredits.push({
              sourceUserCode: newUser.userId,
              beneficiaryUserCode: latestSponsorAfterCount.userId,
              sourceRef: `bulk_admin_${newUser.userId}_${latestSponsorAfterCount.userId}`,
              amount: directIncome,
              description: `Referral income from ${newUser.fullName} (${newUser.userId})`
            });
          } else {
            Database.addToSafetyPool(directIncome, newUser.id, 'No sponsor - referral income');
          }

          Database.addToSafetyPool(adminFee, newUser.id, 'Admin fee');
          deferredHelpEvents.push({
            sourceUserCode: newUser.userId,
            newMemberUserCode: newUser.userId,
            sourceRef: `bulk_help_${newUser.userId}`,
            description: `Activation help event for ${newUser.fullName} (${newUser.userId})`
          });

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
            const baseFailedCount = failed.length;
            const referralSettlement = await settleDeferredReferralCredits();
            if (referralSettlement.failedDetails.length > 0) {
              failed.push(...referralSettlement.failedDetails);
            }
            const helpSettlement = await settleDeferredHelpEvents();
            if (helpSettlement.failedDetails.length > 0) {
              failed.push(...helpSettlement.failedDetails);
            }
            const totalFailedCount = baseFailedCount + referralSettlement.failedCount + helpSettlement.failedCount;
            get().loadAllUsers();
            if (get().allTransactions.length > 0) {
              get().loadAllTransactions();
            }
            get().loadStats();
            const recoveredMessage = totalFailedCount > 0
              ? `Created ${createdUserIds.length} ID(s), failed ${totalFailedCount}`
              : `Created ${createdUserIds.length} ID(s) without PIN`;
            params.onProgress?.({
              stage: 'completed',
              processed: quantity,
              total: quantity,
              created: createdUserIds.length,
              failed: totalFailedCount,
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

      const baseFailedCount = failed.length;
      const referralSettlement = await settleDeferredReferralCredits();
      if (referralSettlement.failedDetails.length > 0) {
        failed.push(...referralSettlement.failedDetails);
      }
      const helpSettlement = await settleDeferredHelpEvents();
      if (helpSettlement.failedDetails.length > 0) {
        failed.push(...helpSettlement.failedDetails);
      }
      const totalFailedCount = baseFailedCount + referralSettlement.failedCount + helpSettlement.failedCount;

      const message = totalFailedCount > 0
        ? `Created ${createdUserIds.length} ID(s), failed ${totalFailedCount}`
        : `Created ${createdUserIds.length} ID(s) without PIN`;
      params.onProgress?.({
        stage: 'completed',
        processed: quantity,
        total: quantity,
        created: createdUserIds.length,
        failed: totalFailedCount,
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

  scanMissingMatrixUsersAudit: async (limit = 200) => {
    const adminUser = Database.getCurrentUser();
    if (!adminUser?.isAdmin) {
      return { success: false, message: 'Only admin can run this scan' };
    }

    const clampedLimit = Math.max(1, Math.min(500, Number(limit) || 200));
    const apiBase = getBackendApiBase();

    try {
      const response = await fetch(`${apiBase}/api/audit/missing-matrix-users?limit=${clampedLimit}`, {
        method: 'GET'
      });
      const payload = await response.json().catch(() => ({} as Record<string, unknown>));
      if (!response.ok || payload?.ok === false) {
        return {
          success: false,
          message: normalizeRemoteRebuildError(payload, `Audit scan failed (HTTP ${response.status})`)
        };
      }

      const report = (payload?.report && typeof payload.report === 'object')
        ? payload.report as MissingMatrixUsersAuditReport
        : undefined;

      const found = Number(report?.missingCount || 0);
      return {
        success: true,
        message: found > 0
          ? `Found ${found} matrix ID(s) missing in users table.`
          : 'No missing matrix users found.',
        report
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to scan missing matrix users'
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
  sendOtp: (
    userId: string,
    email: string,
    purpose: 'registration' | 'transaction' | 'withdrawal' | 'profile_update',
    context?: { userId?: string; userName?: string }
  ) => Promise<{ success: boolean; otp?: string; message: string; status: 'sent' | 'pending' | 'failed' }>;
  verifyOtp: (userId: string, otp: string, purpose: 'registration' | 'transaction' | 'withdrawal' | 'profile_update') => Promise<boolean>;
}

export const useOtpStore = create<OtpState>((set) => ({
  isOtpSent: false,
  otpExpiry: null,

  sendOtp: async (userId: string, email: string, purpose, context) => {
    const otpRecordsBeforeGenerate = Database.getOtpRecords();
    const otpRecord = Database.generateOtp(userId, email, purpose);
    const purposeLabel = purpose === 'withdrawal'
      ? 'withdrawal'
      : purpose === 'transaction'
        ? 'transaction'
        : purpose === 'profile_update'
          ? 'profile update'
          : 'registration';
    const resolvedUser =
      Database.getUserById(userId) ||
      Database.getUserByUserId(userId) ||
      Database.getUserByEmail(email);
    const resolvedUserId = context?.userId?.trim() || resolvedUser?.userId || '';
    const resolvedName = context?.userName?.trim() || resolvedUser?.fullName || '';
    const userIdLine = resolvedUserId
      ? `User ID: ${resolvedUserId}`
      : purpose === 'registration'
        ? 'User ID: Pending (assigned after registration)'
        : 'User ID: N/A';
    const nameLine = resolvedName ? `Name: ${resolvedName}` : 'Name: N/A';
    const otpLines = [
      `Your OTP for ${purposeLabel} is ${otpRecord.otp}.`,
      'This OTP will expire in 10 minutes.',
      '',
      'This OTP is for your ReferNex account:',
      userIdLine,
      nameLine,
      `Email: ${email}`
    ];
    const emailResult = await dispatchSystemEmail({
      to: email,
      subject: 'Your RefeNex OTP Code',
      body: otpLines.join('\n'),
      purpose: 'otp',
      timeoutMs: 12000,
      metadata: {
        userId: resolvedUserId || userId,
        action: purpose,
        userName: resolvedName || 'unknown'
      }
    });
    if (!emailResult.success) {
      // If dispatch failed, restore previous OTP state so a still-valid code is not accidentally invalidated.
      Database.saveOtpRecords(otpRecordsBeforeGenerate);
      return {
        success: false,
        status: 'failed',
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
      status: emailResult.deliveryState,
      message: emailResult.deliveryState === 'pending'
        ? (emailResult.error || 'OTP request timed out, but the email may still arrive. Please check inbox/spam before retrying.')
        : 'OTP sent to your email'
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
bindPostRegistrationRetryQueue();
