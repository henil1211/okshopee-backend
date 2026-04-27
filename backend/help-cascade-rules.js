const V2_HELP_MAX_LEVEL = 10;

export const V2_HELP_DIRECT_REQUIREMENTS_INCREMENTAL_DEFAULT = Object.freeze([0, 2, 3, 4, 5, 10, 20, 40, 80, 100]);

function normalizePositiveInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

function normalizeLegacyUserCode(userCode) {
  return String(userCode || '').trim();
}

export function normalizeIncrementalDirectRequirements(input, maxLevel = V2_HELP_MAX_LEVEL) {
  const limit = Math.max(1, normalizePositiveInt(maxLevel, V2_HELP_MAX_LEVEL));
  const fallback = Array.from({ length: limit }, (_, index) =>
    normalizePositiveInt(V2_HELP_DIRECT_REQUIREMENTS_INCREMENTAL_DEFAULT[index] ?? 0)
  );

  if (!Array.isArray(input) || input.length === 0) {
    return fallback;
  }

  const normalized = [];
  for (let index = 0; index < limit; index += 1) {
    const candidate = input[index];
    normalized.push(normalizePositiveInt(candidate, fallback[index] ?? 0));
  }
  return normalized;
}

export function extractIncrementalDirectRequirementsFromLegacySettings(settings, maxLevel = V2_HELP_MAX_LEVEL) {
  const table = Array.isArray(settings?.helpDistributionTable)
    ? settings.helpDistributionTable
    : null;
  if (!table || table.length === 0) {
    return normalizeIncrementalDirectRequirements(null, maxLevel);
  }

  const maxRows = Math.max(1, normalizePositiveInt(maxLevel, V2_HELP_MAX_LEVEL));
  const incremental = Array.from({ length: maxRows }, (_, index) => {
    const row = table[index];
    return normalizePositiveInt(row?.directRequired, 0);
  });

  return normalizeIncrementalDirectRequirements(incremental, maxRows);
}

export function getV2CumulativeDirectRequired(levelNo, incrementalRequirements = V2_HELP_DIRECT_REQUIREMENTS_INCREMENTAL_DEFAULT) {
  const level = normalizePositiveInt(levelNo, 0);
  if (level <= 1) return 0;

  const normalized = normalizeIncrementalDirectRequirements(incrementalRequirements, Math.max(level, V2_HELP_MAX_LEVEL));
  let total = 0;
  for (let index = 0; index < level; index += 1) {
    total += normalizePositiveInt(normalized[index], 0);
  }
  return total;
}

export function isLegacyNetworkActiveUser(user) {
  if (!user || typeof user !== 'object') return false;

  const accountStatus = String(user.accountStatus || '').trim().toLowerCase();
  if (accountStatus === 'temp_blocked' || accountStatus === 'permanent_blocked') {
    return true;
  }
  if (accountStatus && accountStatus !== 'active') {
    return false;
  }

  return Boolean(user.isActive) || String(user.deactivationReason || '') === 'direct_referral_deadline';
}

export function buildLegacyDirectCountMap(legacyUsers) {
  const users = Array.isArray(legacyUsers) ? legacyUsers : [];
  const map = new Map();

  for (const user of users) {
    const userCode = normalizeLegacyUserCode(user?.userId);
    if (!userCode) continue;

    const rawDirect = normalizePositiveInt(user?.directCount, 0);
    if (!map.has(userCode) || rawDirect > map.get(userCode)) {
      map.set(userCode, rawDirect);
    }
  }

  const activeDirectBySponsorCode = new Map();
  for (const user of users) {
    if (!isLegacyNetworkActiveUser(user)) continue;

    const sponsorCode = normalizeLegacyUserCode(user?.sponsorId);
    if (!sponsorCode) continue;

    const current = activeDirectBySponsorCode.get(sponsorCode) || 0;
    activeDirectBySponsorCode.set(sponsorCode, current + 1);
  }

  for (const [userCode, activeDirectCount] of activeDirectBySponsorCode.entries()) {
    const current = map.get(userCode) || 0;
    if (activeDirectCount > current) {
      map.set(userCode, activeDirectCount);
    }
  }

  return map;
}

export function isV2UserQualifiedForLevel({
  userCode,
  levelNo,
  directCountByUserCode,
  incrementalRequirements = V2_HELP_DIRECT_REQUIREMENTS_INCREMENTAL_DEFAULT
}) {
  const normalizedUserCode = normalizeLegacyUserCode(userCode);
  if (!normalizedUserCode) return false;

  const requiredDirect = getV2CumulativeDirectRequired(levelNo, incrementalRequirements);
  if (requiredDirect <= 0) return true;

  const directCount = Number(directCountByUserCode?.get(normalizedUserCode) || 0);
  return directCount >= requiredDirect;
}

export function computeV2HelpSettlementDecision({
  receiveCountBefore,
  safetyDeductedCents,
  isQualifiedForLevel,
  amountCents,
  lockedQualificationCents
}) {
  const amount = normalizePositiveInt(amountCents, 0);
  const receiveBefore = normalizePositiveInt(receiveCountBefore, 0);
  const safetyDeducted = normalizePositiveInt(safetyDeductedCents, 0);
  const lockedQualification = normalizePositiveInt(lockedQualificationCents, 0);
  const nextReceiveCount = receiveBefore + 1;

  if (nextReceiveCount <= 2) {
    return {
      mode: 'locked_for_give',
      nextReceiveCount,
      incomeCreditCents: 0,
      lockFirstTwoCents: amount,
      lockQualificationCents: 0,
      qualificationReleaseCents: 0,
      divertedSafetyCents: 0
    };
  }

  if (nextReceiveCount === 5 && safetyDeducted <= 0) {
    return {
      mode: 'safety_pool_diversion',
      nextReceiveCount,
      incomeCreditCents: 0,
      lockFirstTwoCents: 0,
      lockQualificationCents: 0,
      qualificationReleaseCents: 0,
      divertedSafetyCents: amount
    };
  }

  if (!isQualifiedForLevel) {
    return {
      mode: 'locked_for_qualification',
      nextReceiveCount,
      incomeCreditCents: 0,
      lockFirstTwoCents: 0,
      lockQualificationCents: amount,
      qualificationReleaseCents: 0,
      divertedSafetyCents: 0
    };
  }

  const qualificationReleaseCents = lockedQualification;
  return {
    mode: qualificationReleaseCents > 0 ? 'income_credit_with_release' : 'income_credit',
    nextReceiveCount,
    incomeCreditCents: amount + qualificationReleaseCents,
    lockFirstTwoCents: 0,
    lockQualificationCents: 0,
    qualificationReleaseCents,
    divertedSafetyCents: 0
  };
}

export async function claimPendingContributionForProcessing(connection, {
  pendingContributionId,
  claimToken
}) {
  const normalizedId = normalizePositiveInt(pendingContributionId, 0);
  if (!normalizedId) return false;

  const claimReason = `processing:${String(claimToken || 'unknown').slice(0, 170)}`;
  const [claimResult] = await connection.execute(
    `UPDATE v2_help_pending_contributions
     SET reason = ?
     WHERE id = ?
       AND status = 'pending'
       AND processed_txn_id IS NULL
       AND (reason IS NULL OR reason LIKE 'processing:%')`,
    [claimReason, normalizedId]
  );

  return Number(claimResult?.affectedRows || 0) === 1;
}
