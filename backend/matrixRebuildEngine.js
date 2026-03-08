const STATE_KEYS = {
  USERS: 'mlm_users',
  WALLETS: 'mlm_wallets',
  TRANSACTIONS: 'mlm_transactions',
  MATRIX: 'mlm_matrix',
  SAFETY_POOL: 'mlm_safety_pool',
  HELP_TRACKERS: 'mlm_help_trackers',
  PENDING: 'mlm_matrix_pending_contributions'
};

const helpDistributionTable = [
  { level: 1, users: 2, perUserHelp: 5, directRequired: 0 },
  { level: 2, users: 4, perUserHelp: 10, directRequired: 2 },
  { level: 3, users: 8, perUserHelp: 20, directRequired: 3 },
  { level: 4, users: 16, perUserHelp: 40, directRequired: 4 },
  { level: 5, users: 32, perUserHelp: 80, directRequired: 5 },
  { level: 6, users: 64, perUserHelp: 160, directRequired: 10 },
  { level: 7, users: 128, perUserHelp: 320, directRequired: 20 },
  { level: 8, users: 256, perUserHelp: 640, directRequired: 40 },
  { level: 9, users: 512, perUserHelp: 1280, directRequired: 80 },
  { level: 10, users: 1024, perUserHelp: 2560, directRequired: 100 }
];

function nowIso() {
  return new Date().toISOString();
}

function safeParseJSON(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeTransactionType(type) {
  return type === 'get_help' ? 'receive_help' : type;
}

function generateEventId(prefix, tag) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const safeTag = String(tag || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return safeTag ? `${prefix}_${ts}_${rand}_${safeTag}` : `${prefix}_${ts}_${rand}`;
}

function createEmptyReconciliationReport() {
  return {
    scannedTrackers: 0,
    createdTrackers: 0,
    removedTrackers: 0,
    repairedLevels: 0,
    repairedQueueItems: 0,
    walletSyncs: 0,
    issues: []
  };
}

function createEmptyMatrixRebuildReport() {
  return {
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
    reconciliation: createEmptyReconciliationReport()
  };
}

function normalizeMatrixRebuildReport(value) {
  const empty = createEmptyMatrixRebuildReport();
  if (!value || typeof value !== 'object') {
    return empty;
  }

  return {
    ...empty,
    ...value,
    reconciliation: {
      ...empty.reconciliation,
      ...(value.reconciliation || {})
    }
  };
}

class MatrixRebuildRuntime {
  constructor(rawState) {
    this.state = {
      users: Array.isArray(safeParseJSON(rawState?.[STATE_KEYS.USERS] || '[]', [])) ? safeParseJSON(rawState?.[STATE_KEYS.USERS] || '[]', []) : [],
      wallets: Array.isArray(safeParseJSON(rawState?.[STATE_KEYS.WALLETS] || '[]', [])) ? safeParseJSON(rawState?.[STATE_KEYS.WALLETS] || '[]', []) : [],
      transactions: Array.isArray(safeParseJSON(rawState?.[STATE_KEYS.TRANSACTIONS] || '[]', [])) ? safeParseJSON(rawState?.[STATE_KEYS.TRANSACTIONS] || '[]', []) : [],
      matrix: Array.isArray(safeParseJSON(rawState?.[STATE_KEYS.MATRIX] || '[]', [])) ? safeParseJSON(rawState?.[STATE_KEYS.MATRIX] || '[]', []) : [],
      safetyPool: safeParseJSON(rawState?.[STATE_KEYS.SAFETY_POOL] || '{"totalAmount":0,"transactions":[]}', { totalAmount: 0, transactions: [] }),
      helpTrackers: Array.isArray(safeParseJSON(rawState?.[STATE_KEYS.HELP_TRACKERS] || '[]', [])) ? safeParseJSON(rawState?.[STATE_KEYS.HELP_TRACKERS] || '[]', []) : [],
      pending: Array.isArray(safeParseJSON(rawState?.[STATE_KEYS.PENDING] || '[]', [])) ? safeParseJSON(rawState?.[STATE_KEYS.PENDING] || '[]', []) : []
    };
    this.bulkRebuildMode = false;
    this.bulkSafetyPoolTotal = 0;
  }

  serialize(keys) {
    const requested = Array.isArray(keys) && keys.length > 0 ? keys : Object.values(STATE_KEYS);
    const out = {};
    for (const key of requested) {
      switch (key) {
        case STATE_KEYS.USERS:
          out[key] = JSON.stringify(this.state.users);
          break;
        case STATE_KEYS.WALLETS:
          out[key] = JSON.stringify(this.state.wallets);
          break;
        case STATE_KEYS.TRANSACTIONS:
          out[key] = JSON.stringify(this.state.transactions);
          break;
        case STATE_KEYS.MATRIX:
          out[key] = JSON.stringify(this.state.matrix);
          break;
        case STATE_KEYS.SAFETY_POOL:
          out[key] = JSON.stringify(this.state.safetyPool);
          break;
        case STATE_KEYS.HELP_TRACKERS:
          out[key] = JSON.stringify(this.state.helpTrackers);
          break;
        case STATE_KEYS.PENDING:
          out[key] = JSON.stringify(this.state.pending);
          break;
        default:
          break;
      }
    }
    return out;
  }

  getUsers() {
    return this.state.users.map((user) => ({
      ...user,
      accountStatus: user.accountStatus || 'active',
      blockedAt: user.blockedAt ?? null,
      blockedUntil: user.blockedUntil ?? null,
      blockedReason: user.blockedReason ?? null
    }));
  }

  saveUsers(users) {
    this.state.users = users;
  }

  getWallets() {
    return this.state.wallets.map((wallet) => ({
      userId: String(wallet.userId || ''),
      depositWallet: toFiniteNumber(wallet.depositWallet),
      pinWallet: toFiniteNumber(wallet.pinWallet),
      incomeWallet: toFiniteNumber(wallet.incomeWallet),
      matrixWallet: toFiniteNumber(wallet.matrixWallet),
      lockedIncomeWallet: toFiniteNumber(wallet.lockedIncomeWallet),
      giveHelpLocked: toFiniteNumber(wallet.giveHelpLocked),
      totalReceived: toFiniteNumber(wallet.totalReceived),
      totalGiven: toFiniteNumber(wallet.totalGiven)
    }));
  }

  saveWallets(wallets) {
    this.state.wallets = wallets;
  }

  getTransactions() {
    const transactions = this.state.transactions;
    let changed = false;
    for (const tx of transactions) {
      const normalizedType = normalizeTransactionType(tx.type);
      if (normalizedType !== tx.type) {
        tx.type = normalizedType;
        changed = true;
      }
    }
    if (changed) {
      this.state.transactions = transactions;
    }
    return transactions;
  }

  saveTransactions(transactions) {
    this.state.transactions = transactions.map((tx) => ({
      ...tx,
      type: normalizeTransactionType(tx.type)
    }));
  }

  createTransaction(transaction) {
    if (this.bulkRebuildMode) return transaction;
    const transactions = this.getTransactions();
    transactions.push({
      ...transaction,
      type: normalizeTransactionType(transaction.type)
    });
    this.saveTransactions(transactions);
    return transaction;
  }

  getMatrix() {
    return this.state.matrix;
  }

  saveMatrix(matrix) {
    this.state.matrix = matrix;
  }

  getSafetyPool() {
    const pool = this.state.safetyPool || { totalAmount: 0, transactions: [] };
    if (!Array.isArray(pool.transactions)) {
      pool.transactions = [];
    }
    pool.totalAmount = toFiniteNumber(pool.totalAmount);
    this.state.safetyPool = pool;
    return pool;
  }

  saveSafetyPool(pool) {
    this.state.safetyPool = {
      totalAmount: toFiniteNumber(pool?.totalAmount),
      transactions: Array.isArray(pool?.transactions) ? pool.transactions : []
    };
  }

  addToSafetyPool(amount, fromUserId, reason) {
    if (this.bulkRebuildMode) {
      this.bulkSafetyPoolTotal += amount;
      return;
    }
    const pool = this.getSafetyPool();
    pool.totalAmount += amount;
    pool.transactions.push({
      id: generateEventId('sp', reason),
      amount,
      fromUserId,
      reason,
      createdAt: nowIso()
    });
    this.saveSafetyPool(pool);
  }

  getHelpTrackers() {
    return this.state.helpTrackers;
  }

  saveHelpTrackers(trackers) {
    this.state.helpTrackers = trackers;
  }

  getUserHelpTracker(userId) {
    const trackers = this.getHelpTrackers();
    const existing = trackers.find((tracker) => tracker.userId === userId);
    if (existing) return existing;
    const created = { userId, levels: {}, lockedQueue: [] };
    trackers.push(created);
    this.saveHelpTrackers(trackers);
    return created;
  }

  saveUserHelpTracker(tracker) {
    const trackers = this.getHelpTrackers();
    const index = trackers.findIndex((item) => item.userId === tracker.userId);
    if (index === -1) {
      trackers.push(tracker);
    } else {
      trackers[index] = tracker;
    }
    this.saveHelpTrackers(trackers);
  }

  getPendingMatrixContributions() {
    return this.state.pending;
  }

  savePendingMatrixContributions(items) {
    this.state.pending = items;
  }

  getWallet(userId) {
    return this.getWallets().find((wallet) => wallet.userId === userId);
  }

  updateWallet(userId, updates) {
    const wallets = this.getWallets();
    const index = wallets.findIndex((wallet) => wallet.userId === userId);
    if (index === -1) return null;
    wallets[index] = { ...wallets[index], ...updates };
    this.saveWallets(wallets);
    return wallets[index];
  }

  getUserById(id) {
    return this.getUsers().find((user) => user.id === id);
  }

  getDuplicateResolutionScore(user, txCountByUserId, walletByUserId, matrixUserIds) {
    const txCount = txCountByUserId?.get(user.id) || 0;
    const wallet = walletByUserId?.get(user.id);
    const walletMagnitude = wallet
      ? Math.abs(wallet.depositWallet || 0)
        + Math.abs(wallet.incomeWallet || 0)
        + Math.abs(wallet.matrixWallet || 0)
        + Math.abs(wallet.lockedIncomeWallet || 0)
        + Math.abs(wallet.totalReceived || 0)
      : 0;
    let score = 0;
    if ((user.userId || '').trim() === '1000001') score += 1000000000;
    if (user.isAdmin) score += 100000000;
    if (user.isActive && user.accountStatus === 'active') score += 10000000;
    score += Math.max(0, user.directCount || 0) * 10000;
    score += txCount * 100;
    score += Math.floor(walletMagnitude);
    if (matrixUserIds?.has(user.userId)) score += 50000;
    return score;
  }

  getUserByUserId(userId) {
    const matches = this.getUsers().filter((user) => user.userId === userId);
    if (matches.length <= 1) return matches[0];
    const txCountByUserId = new Map();
    for (const tx of this.getTransactions()) {
      txCountByUserId.set(tx.userId, (txCountByUserId.get(tx.userId) || 0) + 1);
    }
    const walletByUserId = new Map(this.getWallets().map((wallet) => [wallet.userId, wallet]));
    const matrixUserIds = new Set(this.getMatrix().map((node) => node.userId));
    return [...matches].sort((a, b) => {
      const scoreDiff = this.getDuplicateResolutionScore(b, txCountByUserId, walletByUserId, matrixUserIds)
        - this.getDuplicateResolutionScore(a, txCountByUserId, walletByUserId, matrixUserIds);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    })[0];
  }

  updateUser(id, updates) {
    const users = this.getUsers();
    const index = users.findIndex((user) => user.id === id);
    if (index === -1) return null;
    users[index] = { ...users[index], ...updates };
    this.saveUsers(users);
    return users[index];
  }

  parseWithdrawalFee(description) {
    const match = String(description || '').match(/Fee:\s*\$([0-9]+(?:\.[0-9]+)?)/i);
    if (!match) return 0;
    return toFiniteNumber(match[1]);
  }

  computeIncomeLedgerFromTransactions(userId) {
    const txs = this.getTransactions()
      .filter((tx) => tx.userId === userId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    let incomeWallet = 0;
    let matrixWallet = 0;
    let totalReceived = 0;
    let totalGiven = 0;

    for (const tx of txs) {
      const desc = String(tx.description || '').toLowerCase();
      const isNonEarningCreditType =
        tx.type === 'activation'
        || tx.type === 'income_transfer'
        || tx.type === 'pin_used'
        || tx.type === 'pin_purchase'
        || tx.type === 'pin_transfer'
        || tx.type === 'deposit'
        || tx.type === 'p2p_transfer'
        || tx.type === 'reentry';
      const isIncomeWalletAdminCredit = tx.type !== 'admin_credit' || desc.includes('income wallet');

      if (tx.amount > 0 && !isNonEarningCreditType && isIncomeWalletAdminCredit) {
        totalReceived += tx.amount;
      }

      switch (tx.type) {
        case 'direct_income':
        case 'level_income':
          incomeWallet += tx.amount;
          matrixWallet += tx.amount;
          break;
        case 'receive_help': {
          const isLockedReceive = desc.startsWith('locked receive help at level')
            || desc.startsWith('locked first-two help at level');
          if (!isLockedReceive) {
            incomeWallet += tx.amount;
            matrixWallet += tx.amount;
          }
          break;
        }
        case 'give_help':
          if (!desc.includes('from locked income') && !desc.includes('from matrix contribution')) {
            if (tx.amount >= 0) {
              incomeWallet += tx.amount;
              matrixWallet += tx.amount;
            } else {
              incomeWallet -= Math.min(Math.abs(tx.amount), Math.max(0, incomeWallet));
              matrixWallet -= Math.min(Math.abs(tx.amount), Math.max(0, matrixWallet));
            }
          }
          totalGiven += Math.abs(tx.amount);
          break;
        case 'safety_pool':
          if (tx.amount >= 0) {
            incomeWallet += tx.amount;
          } else {
            incomeWallet -= Math.min(Math.abs(tx.amount), Math.max(0, incomeWallet));
          }
          break;
        case 'withdrawal': {
          const fee = this.parseWithdrawalFee(tx.description || '');
          const outflow = tx.amount < 0 ? Math.abs(tx.amount) : Math.abs(tx.amount) + fee;
          incomeWallet -= Math.min(outflow, Math.max(0, incomeWallet));
          break;
        }
        case 'income_transfer':
          if (tx.amount >= 0) {
            incomeWallet += tx.amount;
          } else {
            incomeWallet -= Math.min(Math.abs(tx.amount), Math.max(0, incomeWallet));
            totalGiven += Math.abs(tx.amount);
          }
          break;
        case 'admin_credit':
          if (desc.includes('income wallet')) {
            incomeWallet += tx.amount;
          }
          break;
        case 'admin_debit':
          if (desc.includes('income wallet')) {
            incomeWallet -= Math.min(Math.abs(tx.amount), Math.max(0, incomeWallet));
            totalGiven += Math.abs(tx.amount);
          }
          break;
        default:
          break;
      }
    }

    return {
      incomeWallet: Math.max(0, round2(incomeWallet)),
      matrixWallet: Math.max(0, round2(matrixWallet)),
      totalReceived: Math.max(0, round2(totalReceived)),
      totalGiven: Math.max(0, round2(totalGiven))
    };
  }

  getCumulativeDirectRequired(level) {
    if (level <= 1) return 0;
    let total = 0;
    for (let i = 1; i <= level; i += 1) {
      const levelData = helpDistributionTable[i - 1];
      if (!levelData) break;
      total += levelData.directRequired;
    }
    return total;
  }

  getEffectiveDirectCount(user) {
    const computed = this.getUsers().filter((member) =>
      !member.isAdmin
      && member.sponsorId === user.userId
      && member.isActive
      && member.accountStatus === 'active'
    ).length;
    return Math.max(user.directCount || 0, computed);
  }

  isQualifiedForLevel(user, level) {
    if (level < 1 || level > helpDistributionTable.length) return false;
    return this.getEffectiveDirectCount(user) >= this.getCumulativeDirectRequired(level);
  }

  buildMatrixChildrenMap(matrix) {
    const nodeMap = new Map(matrix.map((node) => [node.userId, node]));
    const childMap = new Map();
    const pushChild = (parentUserId, childUserId) => {
      if (!parentUserId || !childUserId) return;
      if (!nodeMap.has(parentUserId) || !nodeMap.has(childUserId)) return;
      let bucket = childMap.get(parentUserId);
      if (!bucket) {
        bucket = new Set();
        childMap.set(parentUserId, bucket);
      }
      bucket.add(childUserId);
    };

    for (const node of matrix) {
      pushChild(node.parentId, node.userId);
    }
    for (const node of matrix) {
      pushChild(node.userId, node.leftChild);
      pushChild(node.userId, node.rightChild);
    }

    const normalized = new Map();
    for (const [parent, children] of childMap.entries()) {
      normalized.set(parent, Array.from(children));
    }
    return normalized;
  }

  getMatrixNodesCountAtLevel(userId, targetDepth) {
    if (targetDepth < 1 || targetDepth > helpDistributionTable.length) return 0;
    const user = this.getUserById(userId);
    if (!user) return 0;
    const matrix = this.getMatrix();
    const childrenMap = this.buildMatrixChildrenMap(matrix);
    const rootExists = matrix.some((node) => node.userId === user.userId);
    if (!rootExists) return 0;

    let count = 0;
    const queue = [{ nodeUserId: user.userId, depth: 0 }];
    const visited = new Set([user.userId]);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current.depth === targetDepth) {
        count += 1;
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
    return count;
  }

  isTourQualifiedForLevel(user, tracker, level) {
    const levelData = helpDistributionTable[level - 1];
    if (!levelData) return false;
    const state = tracker.levels[String(level)];
    const trackerReceiveEvents = state?.receiveEvents || 0;
    const hasFullLevelHelp = trackerReceiveEvents >= levelData.users;
    const hasFullMatrixLevel = this.getMatrixNodesCountAtLevel(user.id, level) >= levelData.users;
    return hasFullLevelHelp && hasFullMatrixLevel && this.isQualifiedForLevel(user, level);
  }

  syncUserAchievements(userId) {
    const user = this.getUserById(userId);
    if (!user) return null;
    const tracker = this.getUserHelpTracker(userId);
    const current = user.achievements || {
      nationalTour: false,
      internationalTour: false,
      familyTour: false
    };
    const next = { ...current };
    const now = nowIso();
    let changed = false;
    const national = this.isTourQualifiedForLevel(user, tracker, 3);
    const international = this.isTourQualifiedForLevel(user, tracker, 4);
    const family = this.isTourQualifiedForLevel(user, tracker, 5);

    if (!!next.nationalTour !== national) {
      next.nationalTour = national;
      next.nationalTourDate = national ? (next.nationalTourDate || now) : undefined;
      changed = true;
    }
    if (!!next.internationalTour !== international) {
      next.internationalTour = international;
      next.internationalTourDate = international ? (next.internationalTourDate || now) : undefined;
      changed = true;
    }
    if (!!next.familyTour !== family) {
      next.familyTour = family;
      next.familyTourDate = family ? (next.familyTourDate || now) : undefined;
      changed = true;
    }
    if (!changed) return user;
    return this.updateUser(userId, { achievements: next });
  }

  getRelativeSide(ancestorUserId, descendantUserId) {
    const matrix = this.getMatrix();
    const nodeMap = new Map(matrix.map((node) => [node.userId, node]));
    const ancestorNode = nodeMap.get(ancestorUserId);
    if (!ancestorNode) return null;
    let currentUserId = descendantUserId;
    while (true) {
      const currentNode = nodeMap.get(currentUserId);
      if (!currentNode || !currentNode.parentId) return null;
      if (currentNode.parentId === ancestorUserId) {
        if (ancestorNode.leftChild === currentUserId) return 'left';
        if (ancestorNode.rightChild === currentUserId) return 'right';
        if (currentNode.position === 0) return 'left';
        if (currentNode.position === 1) return 'right';
        return null;
      }
      currentUserId = currentNode.parentId;
    }
  }

  getLockedFirstTwoReceiveCount(userId, level) {
    if (this.bulkRebuildMode) {
      const tracker = this.getUserHelpTracker(userId);
      const state = tracker.levels[String(level)];
      return Math.min(2, Math.max(0, Math.floor(Number(state?.receiveEvents || 0))));
    }
    return this.getTransactions().filter((tx) =>
      tx.userId === userId
      && tx.type === 'receive_help'
      && tx.amount > 0
      && String(tx.description || '').toLowerCase().startsWith(`locked first-two help at level ${level}`)
    ).length;
  }

  canReceiveAtLevel(userId, level) {
    const levelData = helpDistributionTable[level - 1];
    if (!levelData) return false;
    const tracker = this.getUserHelpTracker(userId);
    const state = this.ensureLevelTrackerState(tracker, level);
    return (state.receiveEvents || 0) < levelData.users;
  }

  findEligibleUplineForGiveHelp(user, level) {
    let currentUplineUserId = user.parentId || user.sponsorId;
    let depth = 1;
    while (currentUplineUserId) {
      const upline = this.getUserByUserId(currentUplineUserId);
      if (!upline) break;
      if (depth === level) {
        if (upline.isActive && upline.accountStatus === 'active' && this.canReceiveAtLevel(upline.id, level)) {
          return upline;
        }
        return null;
      }
      currentUplineUserId = upline.parentId || upline.sponsorId;
      depth += 1;
    }
    return null;
  }

  ensureLevelTrackerState(tracker, level) {
    const key = String(level);
    const existing = tracker.levels[key];
    if (existing) {
      const normalized = {
        level,
        perUserHelp: helpDistributionTable[level - 1].perUserHelp,
        directRequired: this.getCumulativeDirectRequired(level),
        leftEvents: Math.max(0, Math.floor(toFiniteNumber(existing.leftEvents))),
        rightEvents: Math.max(0, Math.floor(toFiniteNumber(existing.rightEvents))),
        matchedEvents: Math.max(0, Math.floor(toFiniteNumber(existing.matchedEvents))),
        receiveEvents: Math.max(0, Math.floor(toFiniteNumber(existing.receiveEvents))),
        receivedAmount: Math.max(0, toFiniteNumber(existing.receivedAmount)),
        giveEvents: Math.max(0, Math.floor(toFiniteNumber(existing.giveEvents))),
        givenAmount: Math.max(0, toFiniteNumber(existing.givenAmount)),
        lockedAmount: Math.max(0, toFiniteNumber(existing.lockedAmount)),
        lockedReceiveAmount: Math.max(0, toFiniteNumber(existing.lockedReceiveAmount)),
        safetyDeducted: Math.max(0, toFiniteNumber(existing.safetyDeducted))
      };
      tracker.levels[key] = normalized;
      return normalized;
    }
    const levelData = helpDistributionTable[level - 1];
    const created = {
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

  consumeLockedIncomeAtLevel(tracker, level, amount) {
    let remaining = Math.max(0, amount);
    let consumedFromLockedAmount = 0;
    let consumedFromLockedReceiveAmount = 0;
    const key = String(level);
    const state = tracker.levels[key];
    if (!state) {
      return { success: false, consumedFromLockedAmount, consumedFromLockedReceiveAmount };
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

  executeGiveHelp(userId, amount, level, description, options = {}) {
    const user = this.getUserById(userId);
    if (!user) return 0;
    const useLockedIncome = !!options.useLockedIncome;
    let remaining = Math.max(0, amount);
    let totalTransferred = 0;
    const giveTxByTarget = new Map();
    const recipientLevel = Math.min(helpDistributionTable.length, Math.max(1, Math.floor(level || 1)));

    const queueGiveTx = (key, payload) => {
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
      const senderLevelState = senderTracker ? this.ensureLevelTrackerState(senderTracker, recipientLevel) : null;
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
          createdAt: nowIso(),
          completedAt: nowIso()
        });

        if (lockedFirstTwoCount + 1 === 2 && recipientState.lockedAmount > 0) {
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
              recipientState.giveEvents = Math.min(2, recipientState.giveEvents + Math.floor(consumedByPending / levelPerUserHelp));
            }
            recipientState.lockedAmount = Math.max(0, recipientState.lockedAmount - consumedByPending);
            if (walletAfterPending) {
              this.updateWallet(recipient.id, {
                giveHelpLocked: Math.max(0, (walletAfterPending.giveHelpLocked || 0) - consumedByPending)
              });
            }
          } else {
            const transferred = this.executeGiveHelp(
              recipient.id,
              recipientState.lockedAmount,
              recipientLevel,
              `Auto give help at level ${recipientLevel} from locked income`,
              { useLockedIncome: true }
            );
            if (transferred > 0) {
              recipientState.givenAmount += transferred;
              const levelPerUserHelp = helpDistributionTable[recipientLevel - 1]?.perUserHelp || 0;
              if (levelPerUserHelp > 0) {
                recipientState.giveEvents = Math.min(2, recipientState.giveEvents + Math.floor(transferred / levelPerUserHelp));
              }
              recipientState.lockedAmount = Math.max(0, recipientState.lockedAmount - transferred);
              const latestWallet = this.getWallet(recipient.id);
              if (latestWallet) {
                this.updateWallet(recipient.id, {
                  giveHelpLocked: Math.max(0, (latestWallet.giveHelpLocked || 0) - transferred)
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
          createdAt: nowIso(),
          completedAt: nowIso()
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
          createdAt: nowIso(),
          completedAt: nowIso()
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
          createdAt: nowIso(),
          completedAt: nowIso()
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
      const createdAt = nowIso();
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
          createdAt,
          completedAt: createdAt
        });
      }
    }

    return totalTransferred;
  }

  processMatchedHelpEvent(userId, level, fromUserId, options = {}) {
    const user = this.getUserById(userId);
    if (!user || !user.isActive || user.accountStatus !== 'active') return false;
    const fromUser = fromUserId ? this.getUserById(fromUserId) : undefined;
    const fromSuffix = fromUser ? ` from ${fromUser.fullName} (${fromUser.userId})` : '';
    const levelData = helpDistributionTable[level - 1];
    if (!levelData) return false;
    const amount = levelData.perUserHelp;
    const wallet = this.getWallet(user.id);
    if (!wallet) return false;
    const tracker = this.getUserHelpTracker(user.id);
    const key = String(level);
    const levelState = this.ensureLevelTrackerState(tracker, level);
    if ((levelState.receiveEvents || 0) >= levelData.users) {
      tracker.levels[key] = levelState;
      this.saveUserHelpTracker(tracker);
      return true;
    }

    if (fromUser && !options.skipFromWalletDebit) {
      const fromWallet = this.getWallet(fromUser.id);
      if (!fromWallet || !fromUser.isActive || fromUser.accountStatus !== 'active') return false;
      const fromTracker = this.getUserHelpTracker(fromUser.id);
      const fromState = this.ensureLevelTrackerState(fromTracker, level);
      const walletLockedAvailable = fromWallet.lockedIncomeWallet || 0;
      if (walletLockedAvailable < amount) return false;
      const debitLockedLevel = Math.max(1, level - 1);
      const consumed = this.consumeLockedIncomeAtLevel(fromTracker, debitLockedLevel, amount);
      if (!consumed.success) return false;
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
        createdAt: nowIso(),
        completedAt: nowIso()
      });
    }

    levelState.receiveEvents += 1;
    const receiveIndex = levelState.receiveEvents;
    const lockedFirstTwoCount = this.getLockedFirstTwoReceiveCount(user.id, level);

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
        fromUserId,
        level,
        status: 'completed',
        description: `Locked first-two help at level ${level}${fromSuffix}`,
        createdAt: nowIso(),
        completedAt: nowIso()
      });

      if (lockedFirstTwoCount + 1 === 2 && levelState.lockedAmount > 0) {
        tracker.levels[key] = levelState;
        this.saveUserHelpTracker(tracker);
        this.processPendingMatrixContributionsForUser(user.id, 1);
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
          const transferred = this.executeGiveHelp(
            user.id,
            levelState.lockedAmount,
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
      this.createTransaction({
        id: generateEventId('tx', `receive_help_5th_l${level}`),
        userId: user.id,
        type: 'receive_help',
        amount,
        fromUserId,
        level,
        status: 'completed',
        description: `Received help at level ${level}${fromSuffix} (5th help - transferred to safety pool)`,
        createdAt: nowIso(),
        completedAt: nowIso()
      });
      this.addToSafetyPool(amount, user.id, `Every 5th help deduction at level ${level}`);
      this.createTransaction({
        id: generateEventId('tx', `level_safety_l${level}`),
        userId: user.id,
        type: 'safety_pool',
        amount: -amount,
        level,
        status: 'completed',
        description: `Every 5th help deduction at level ${level} - transferred to safety pool`,
        createdAt: nowIso(),
        completedAt: nowIso()
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
        fromUserId,
        level,
        status: 'completed',
        description: `Received help at level ${level}${fromSuffix}`,
        createdAt: nowIso(),
        completedAt: nowIso()
      });
    } else {
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
        fromUserId,
        level,
        status: 'completed',
        description: `Locked receive help at level ${level}${fromSuffix} (requires ${requiredDirect} direct, current ${currentDirect})`,
        createdAt: nowIso(),
        completedAt: nowIso()
      });
    }

    tracker.levels[key] = levelState;
    this.saveUserHelpTracker(tracker);
    this.syncUserAchievements(user.id);
    this.processPendingMatrixContributionsForUser(user.id);
    return true;
  }

  registerMatrixContribution(userId, level, side, fromUserId, options = {}) {
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

  enqueuePendingMatrixContribution(fromUserId, toUserId, level, side) {
    const items = this.getPendingMatrixContributions();
    const exists = items.some((item) =>
      item.fromUserId === fromUserId && item.toUserId === toUserId && item.level === level
    );
    if (exists) return;
    items.push({
      id: `pmc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fromUserId,
      toUserId,
      level,
      side,
      status: 'pending',
      createdAt: nowIso()
    });
    this.savePendingMatrixContributions(items);
  }

  processPendingMatrixContributionsForUser(fromUserId, limit) {
    if (!fromUserId) return;
    const pendingIds = this.getPendingMatrixContributions()
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.fromUserId === fromUserId && item.status === 'pending')
      .sort((a, b) => a.item.level - b.item.level || a.index - b.index)
      .map(({ item }) => item.id);
    if (pendingIds.length === 0) return;

    for (const itemId of pendingIds) {
      const freshItems = this.getPendingMatrixContributions();
      const freshItem = freshItems.find((item) => item.id === itemId);
      if (!freshItem || freshItem.status !== 'pending') continue;
      freshItem.status = 'completed';
      freshItem.completedAt = nowIso();
      this.savePendingMatrixContributions(freshItems);
      const ok = this.registerMatrixContribution(
        freshItem.toUserId,
        freshItem.level,
        freshItem.side,
        freshItem.fromUserId,
        { skipFromWalletDebit: false }
      );
      if (!ok) {
        const rollbackItems = this.getPendingMatrixContributions();
        const rollbackItem = rollbackItems.find((item) => item.id === itemId);
        if (rollbackItem) {
          rollbackItem.status = 'pending';
          rollbackItem.completedAt = undefined;
          this.savePendingMatrixContributions(rollbackItems);
        }
        break;
      }
      if (limit !== undefined) {
        limit -= 1;
        if (limit <= 0) break;
      }
    }
  }

  releaseLockedGiveHelp(userId) {
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
        item.releasedAt = nowIso();
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
      break;
    }

    if (!changed) {
      const sortedLevels = Object.entries(tracker.levels)
        .map(([key, state]) => ({ level: Number(key), state }))
        .filter(({ level }) => Number.isInteger(level) && level >= 1 && level <= helpDistributionTable.length)
        .sort((a, b) => a.level - b.level);

      for (const { level, state } of sortedLevels) {
        const pendingFirstTwoLocked = state.lockedAmount || 0;
        if (pendingFirstTwoLocked <= 0) continue;
        if ((state.receiveEvents || 0) < 2) continue;

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
          break;
        }

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
        break;
      }
    }

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

  releaseLockedReceiveHelp(userId) {
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
        createdAt: nowIso(),
        completedAt: nowIso()
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

  processMatrixHelpForNewMember(newMemberUserId, fromUserId) {
    const matrix = this.getMatrix();
    const nodeMap = new Map(matrix.map((node) => [node.userId, node]));
    const newNode = nodeMap.get(newMemberUserId);
    if (!newNode) return;

    let currentParentUserId = newNode.parentId;
    let depth = 1;
    const immediateUplineFallbackReason = 'No active immediate upline for activation help';

    while (currentParentUserId && depth <= helpDistributionTable.length) {
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

  isMatrixTransactionForRebuild(tx) {
    if (tx.type === 'receive_help' || tx.type === 'give_help') {
      return true;
    }
    if (tx.type === 'level_income' && String(tx.description || '').startsWith('Helping amount from ')) {
      return true;
    }
    if (
      tx.type === 'safety_pool'
      && (
        String(tx.description || '').startsWith('Every 5th help deduction at level')
        || String(tx.description || '').includes('to safety pool')
        || String(tx.description || '').startsWith('No qualified upline for level')
      )
    ) {
      return true;
    }
    return false;
  }

  isMatrixSafetyPoolReasonForRebuild(reason) {
    if (!reason) return false;
    return reason.startsWith('Every 5th help deduction at level')
      || reason.startsWith('No qualified upline for level')
      || reason.startsWith('No active immediate upline for activation help')
      || reason === 'No qualified upline';
  }

  hasActivationTransaction(userId) {
    return this.getTransactions().some((tx) =>
      tx.userId === userId
      && tx.status === 'completed'
      && (tx.type === 'pin_used' || tx.type === 'activation')
    );
  }

  hasDirectIncomeFromDownline(sponsorUserId, fromUserId) {
    return this.getTransactions().some((tx) =>
      tx.userId === sponsorUserId
      && tx.fromUserId === fromUserId
      && tx.type === 'direct_income'
      && tx.status === 'completed'
    );
  }

  hasAdminFeeSafetyEntry(fromUserId) {
    const pool = this.getSafetyPool();
    return pool.transactions.some((tx) => tx.fromUserId === fromUserId && tx.reason === 'Admin fee');
  }

  backfillMissingActivationEffects(users) {
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
        createdAt: member.activatedAt || member.createdAt || nowIso(),
        completedAt: nowIso()
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
            createdAt: nowIso(),
            completedAt: nowIso()
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

  compareUsersByJoinOrder(a, b) {
    const aTimeRaw = new Date(a.createdAt).getTime();
    const bTimeRaw = new Date(b.createdAt).getTime();
    const aTime = Number.isFinite(aTimeRaw) ? aTimeRaw : 0;
    const bTime = Number.isFinite(bTimeRaw) ? bTimeRaw : 0;
    if (aTime !== bTime) return aTime - bTime;
    return String(a.userId || '').localeCompare(String(b.userId || ''));
  }

  findNextPositionInMap(nodeMap, sponsorUserId) {
    const queue = [sponsorUserId];
    while (queue.length > 0) {
      const currentId = queue.shift();
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

      queue.push(currentNode.leftChild, currentNode.rightChild);
    }

    return null;
  }

  rebuildMatrixTopology(users) {
    const rootUser = users.find((user) => user.userId === '1000001') || users.find((user) => user.isAdmin) || null;
    const rootUserId = rootUser?.userId || '1000001';
    const rootUserName = rootUser?.fullName || 'System Admin';

    const nodeMap = new Map();
    nodeMap.set(rootUserId, {
      userId: rootUserId,
      username: rootUserName,
      level: 0,
      position: 0,
      isActive: true
    });

    const placementByUserId = new Map();
    placementByUserId.set(rootUserId, { parentId: null, position: null });

    const placeMember = (member, preferredSponsorId) => {
      const sponsorRoot = preferredSponsorId && nodeMap.has(preferredSponsorId) ? preferredSponsorId : rootUserId;
      const placement =
        this.findNextPositionInMap(nodeMap, sponsorRoot)
        || this.findNextPositionInMap(nodeMap, rootUserId);
      if (!placement) return false;

      const parentNode = nodeMap.get(placement.parentId);
      if (!parentNode) return false;

      const matrixNode = {
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
      .filter((user) => user.userId !== rootUserId && !user.isAdmin)
      .sort((a, b) => this.compareUsersByJoinOrder(a, b));

    let pending = orderedMembers;
    let guard = 0;
    while (pending.length > 0 && guard < orderedMembers.length + 5) {
      const nextPending = [];
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
      (a.level - b.level) || String(a.userId || '').localeCompare(String(b.userId || ''))
    );

    return {
      matrix: rebuiltMatrix,
      users: rebuiltUsers,
      repositionedMatrixNodes
    };
  }

  getReplayUsersForMatrixRebuild() {
    const nodeMap = new Map(this.getMatrix().map((node) => [node.userId, node]));
    return [...this.getUsers()]
      .filter((user) => !user.isAdmin && !!nodeMap.get(user.userId)?.parentId)
      .sort((a, b) => this.compareUsersByJoinOrder(a, b));
  }

  prepareMatrixRebuildState(options = {}) {
    const activateLegacyInactiveUsers = options.activateLegacyInactiveUsers !== false;
    const users = this.getUsers();
    const matrix = this.getMatrix();

    if (users.length === 0) {
      throw new Error('Matrix rebuild aborted: no users were loaded from the backend.');
    }

    const report = createEmptyMatrixRebuildReport();
    const directCountsBySponsor = new Map();
    for (const member of users) {
      if (!member.sponsorId) continue;
      directCountsBySponsor.set(member.sponsorId, (directCountsBySponsor.get(member.sponsorId) || 0) + 1);
    }

    const normalizedUsers = users.map((user) => {
      const next = { ...user };
      const computedDirect = directCountsBySponsor.get(user.userId) || 0;
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
          next.activatedAt = nowIso();
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

    const userByUserId = new Map(normalizedUsersWithTopology.map((user) => [user.userId, user]));
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
    const keptTransactions = [];
    for (const tx of transactions) {
      if (!this.isMatrixTransactionForRebuild(tx)) {
        keptTransactions.push(tx);
        continue;
      }
      report.removedMatrixTransactions += 1;
    }
    this.saveTransactions(keptTransactions);

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

    const resetTrackers = normalizedUsersWithTopology.map((user) => ({
      userId: user.id,
      levels: {},
      lockedQueue: []
    }));
    this.saveHelpTrackers(resetTrackers);
    this.savePendingMatrixContributions([]);
    report.trackersReset = resetTrackers.length;

    return report;
  }

  replayMatrixRebuildBatch(replayUserIds, report, options = {}) {
    const preserveMatrixTransactions = !!options.preserveMatrixTransactions;
    const nextReport = normalizeMatrixRebuildReport(report);
    const useBulkRebuildMode = !preserveMatrixTransactions;
    if (useBulkRebuildMode) {
      this.bulkRebuildMode = true;
    }
    this.bulkSafetyPoolTotal = 0;

    try {
      const userByUserId = new Map(this.getUsers().map((user) => [user.userId, user]));
      const nodeMap = new Map(this.getMatrix().map((node) => [node.userId, node]));

      for (const replayUserId of replayUserIds) {
        const replayUser = userByUserId.get(replayUserId);
        const replayNode = nodeMap.get(replayUserId);
        if (!replayUser || !replayNode?.parentId) continue;
        this.processMatrixHelpForNewMember(replayUser.userId, replayUser.id);
        nextReport.replayedMembers += 1;
      }

      if (useBulkRebuildMode && this.bulkSafetyPoolTotal > 0) {
        const currentPool = this.getSafetyPool();
        currentPool.totalAmount += this.bulkSafetyPoolTotal;
        this.saveSafetyPool(currentPool);
      }

      return nextReport;
    } finally {
      this.bulkSafetyPoolTotal = 0;
      this.bulkRebuildMode = false;
    }
  }

  reconcileHelpTrackers() {
    const report = createEmptyReconciliationReport();

    const users = this.getUsers();
    const userIdSet = new Set(users.map((user) => user.id));
    const rawTrackers = this.getHelpTrackers();
    report.scannedTrackers = rawTrackers.length;

    const now = nowIso();
    const cleanedTrackers = [];
    const isValidDate = (value) => !!value && !Number.isNaN(new Date(value).getTime());
    const toSafeNumber = (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : 0;
    };

    for (const tracker of rawTrackers) {
      if (!userIdSet.has(tracker.userId)) {
        report.removedTrackers += 1;
        report.issues.push(`Removed tracker for missing userId: ${tracker.userId}`);
        continue;
      }

      const normalizedLevels = {};
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
          lockedReceiveAmount: Math.max(0, toSafeNumber(state.lockedReceiveAmount)),
          safetyDeducted: Math.max(0, toSafeNumber(state.safetyDeducted))
        };
      }

      const rawQueue = Array.isArray(tracker.lockedQueue) ? tracker.lockedQueue : [];
      const normalizedQueue = [];
      for (const item of rawQueue) {
        const level = Number(item.level);
        const amount = toSafeNumber(item.amount);
        if (!Number.isInteger(level) || level < 1 || level > helpDistributionTable.length || amount <= 0) {
          report.repairedQueueItems += 1;
          continue;
        }

        const status = item.status === 'released' ? 'released' : 'locked';
        const normalizedItem = {
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

      const queueLockedByLevel = new Map();
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

    const trackerUserSet = new Set(cleanedTrackers.map((tracker) => tracker.userId));
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

    const trackerMap = new Map(cleanedTrackers.map((tracker) => [tracker.userId, tracker]));
    const wallets = this.getWallets();
    let walletChanged = false;
    for (const wallet of wallets) {
      const tracker = trackerMap.get(wallet.userId);
      if (!tracker) continue;
      const queueLockedGiveTotal = tracker.lockedQueue
        .filter((item) => item.status === 'locked')
        .reduce((sum, item) => sum + item.amount, 0);
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

  finalizeMatrixRebuildState(report, options = {}) {
    const preserveMatrixTransactions = !!options.preserveMatrixTransactions;
    const nextReport = normalizeMatrixRebuildReport(report);
    nextReport.reconciliation = this.reconcileHelpTrackers();
    if (preserveMatrixTransactions) {
      const finalPool = this.getSafetyPool();
      const finalPoolTotal = finalPool.transactions.reduce((sum, tx) => sum + tx.amount, 0);
      this.saveSafetyPool({
        totalAmount: finalPoolTotal,
        transactions: finalPool.transactions
      });
    }
    return nextReport;
  }
}

function createDefaultJobState() {
  return {
    status: 'idle',
    phase: 'idle',
    processed: 0,
    total: 0,
    batchSize: 0,
    options: null,
    report: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: null
  };
}

function normalizeJobState(job) {
  return {
    ...createDefaultJobState(),
    ...(job && typeof job === 'object' ? job : {}),
    report: normalizeMatrixRebuildReport(job?.report)
  };
}

function sameJobOptions(a, b) {
  return !!a
    && !!b
    && !!a.preserveMatrixTransactions === !!b.preserveMatrixTransactions
    && (a.activateLegacyInactiveUsers !== false) === (b.activateLegacyInactiveUsers !== false);
}

export async function runMatrixRebuildJob(config = {}) {
  const {
    readSnapshot,
    persistState,
    readJob,
    writeJob,
    options = {},
    batchSize = 25,
    onProgress
  } = config;

  if (typeof readSnapshot !== 'function') {
    throw new Error('runMatrixRebuildJob requires readSnapshot()');
  }
  if (typeof persistState !== 'function') {
    throw new Error('runMatrixRebuildJob requires persistState(runtime, keys)');
  }
  if (typeof readJob !== 'function') {
    throw new Error('runMatrixRebuildJob requires readJob()');
  }
  if (typeof writeJob !== 'function') {
    throw new Error('runMatrixRebuildJob requires writeJob(jobPatch, options)');
  }

  const normalizedOptions = {
    preserveMatrixTransactions: !!options.preserveMatrixTransactions,
    activateLegacyInactiveUsers: options.activateLegacyInactiveUsers !== false
  };
  const normalizedBatchSize = Math.max(1, Math.floor(Number(batchSize) || 25));
  let report = createEmptyMatrixRebuildReport();
  let processed = 0;
  let total = 0;

  try {
    const existingJob = normalizeJobState(await readJob());
    const canResume = existingJob.status === 'running'
      && existingJob.phase === 'replaying'
      && sameJobOptions(existingJob.options, normalizedOptions);

    if (!canResume) {
      await writeJob({
        status: 'running',
        phase: 'preparing_snapshot',
        processed: 0,
        total: 4,
        batchSize: normalizedBatchSize,
        options: normalizedOptions,
        report,
        error: null,
        finishedAt: null
      });
    }

    const snapshot = await readSnapshot();
    const runtime = new MatrixRebuildRuntime(snapshot?.state || snapshot || {});

    if (canResume) {
      report = normalizeMatrixRebuildReport(existingJob.report);
    } else {
      await writeJob({
        status: 'running',
        phase: 'preparing_rebuild',
        processed: 1,
        total: 4,
        batchSize: normalizedBatchSize,
        options: normalizedOptions,
        report,
        error: null,
        finishedAt: null
      });

      report = runtime.prepareMatrixRebuildState(normalizedOptions);

      await writeJob({
        status: 'running',
        phase: 'preparing_persist',
        processed: 2,
        total: 4,
        batchSize: normalizedBatchSize,
        options: normalizedOptions,
        report,
        error: null,
        finishedAt: null
      });

      await persistState(runtime, [
        STATE_KEYS.USERS,
        STATE_KEYS.WALLETS,
        STATE_KEYS.TRANSACTIONS,
        STATE_KEYS.MATRIX,
        STATE_KEYS.SAFETY_POOL,
        STATE_KEYS.HELP_TRACKERS,
        STATE_KEYS.PENDING
      ]);
      total = runtime.getReplayUsersForMatrixRebuild().length;
      processed = 0;
      await writeJob({
        status: 'running',
        phase: 'replaying',
        processed,
        total,
        batchSize: normalizedBatchSize,
        options: normalizedOptions,
        report,
        error: null,
        finishedAt: null
      }, { reset: true });
    }

    const replayUsers = runtime.getReplayUsersForMatrixRebuild();
    total = replayUsers.length;
    processed = canResume ? Math.min(Math.max(0, existingJob.processed || 0), total) : 0;

    await writeJob({
      status: 'running',
      phase: 'replaying',
      processed,
      total,
      batchSize: normalizedBatchSize,
      options: normalizedOptions,
      report,
      error: null
    });

    if (typeof onProgress === 'function') {
      await onProgress(processed, total, { phase: 'replaying', report });
    }

    for (let start = processed; start < total; start += normalizedBatchSize) {
      const end = Math.min(start + normalizedBatchSize, total);
      const replayBatch = replayUsers.slice(start, end).map((user) => user.userId);
      report = runtime.replayMatrixRebuildBatch(replayBatch, report, normalizedOptions);
      processed = end;

      await persistState(runtime, [
        STATE_KEYS.WALLETS,
        STATE_KEYS.TRANSACTIONS,
        STATE_KEYS.SAFETY_POOL,
        STATE_KEYS.HELP_TRACKERS,
        STATE_KEYS.PENDING
      ]);

      await writeJob({
        status: 'running',
        phase: 'replaying',
        processed,
        total,
        batchSize: normalizedBatchSize,
        options: normalizedOptions,
        report,
        error: null
      });

      if (typeof onProgress === 'function') {
        await onProgress(processed, total, { phase: 'replaying', report });
      }
    }

    await writeJob({
      status: 'running',
      phase: 'finalizing',
      processed: total,
      total,
      batchSize: normalizedBatchSize,
      options: normalizedOptions,
      report,
      error: null
    });

    report = runtime.finalizeMatrixRebuildState(report, normalizedOptions);

    await writeJob({
      status: 'running',
      phase: 'finalizing_persist',
      processed: total,
      total,
      batchSize: normalizedBatchSize,
      options: normalizedOptions,
      report,
      error: null
    });

    await persistState(runtime, [
      STATE_KEYS.USERS,
      STATE_KEYS.WALLETS,
      STATE_KEYS.TRANSACTIONS,
      STATE_KEYS.SAFETY_POOL,
      STATE_KEYS.HELP_TRACKERS,
      STATE_KEYS.PENDING
    ]);

    const job = await writeJob({
      status: 'completed',
      phase: 'completed',
      processed: total,
      total,
      batchSize: normalizedBatchSize,
      options: normalizedOptions,
      report,
      error: null
    });

    if (typeof onProgress === 'function') {
      await onProgress(total, total, { phase: 'completed', report });
    }

    return { job, report };
  } catch (error) {
    await writeJob({
      status: 'failed',
      phase: 'failed',
      processed,
      total,
      batchSize: normalizedBatchSize,
      options: normalizedOptions,
      report,
      error: error instanceof Error ? error.message : 'Matrix rebuild failed'
    }).catch(() => {});
    throw error;
  }
}
