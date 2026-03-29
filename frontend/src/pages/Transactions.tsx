/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable react-hooks/preserve-manual-memoization */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthStore, useSyncRefreshKey } from '@/store';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, ArrowDownLeft, ArrowUpRight, LogOut, RefreshCw
} from 'lucide-react';
import { formatCurrency, getTransactionTypeLabel, getVisibleTransactionDescription } from '@/utils/helpers';
import Database from '@/db';
import type { Transaction } from '@/types';
import MobileBottomNav from '@/components/MobileBottomNav';
import { toast } from 'sonner';

export default function Transactions() {
  const navigate = useNavigate();
  const { user, impersonatedUser, isAuthenticated, logout } = useAuthStore();
  const syncKey = useSyncRefreshKey();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'help' | 'direct_income' | 'royalty_income' | 'fund_transfer' | 'deposit' | 'withdrawal'>('all');
  const [levelFilter, setLevelFilter] = useState<'all' | number>('all');
  const displayUser = useMemo(() => {
    const activeUser = impersonatedUser || user;
    if (!activeUser) return null;
    return Database.getUserByUserId(activeUser.userId) || Database.getUserById(activeUser.id) || activeUser;
  }, [impersonatedUser, user]);

  const loadTransactions = useCallback(() => {
    if (!displayUser) return;
    const userTransactions = Database.getUserTransactions(displayUser.id);
    setTransactions(userTransactions);
  }, [displayUser]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    loadTransactions();
  }, [isAuthenticated, navigate, loadTransactions, syncKey]);

  const handleLogout = () => {
    logout();
    navigate('/login');
    toast.success('Logged out successfully');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Completed</Badge>;
      case 'pending':
        return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Pending</Badge>;
      case 'failed':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Failed</Badge>;
      default:
        return <Badge className="bg-gray-500/20 text-gray-400">{status}</Badge>;
    }
  };

  const isWithdrawalRefundEntry = (tx: Transaction) => {
    const desc = (tx.description || '').toLowerCase();
    return tx.type === 'income_transfer'
      && desc.startsWith('withdrawal request rejected. amount refunded to income wallet');
  };

  // Pre-build lookup maps for faster transaction processing
  const { nodeMap, userMap } = useMemo(() => {
    const matrix = Database.getMatrix();
    const users = Database.getUsers();
    return {
      nodeMap: new Map(matrix.map((m) => [m.userId, m])),
      userMap: new Map(users.map((u) => [u.id, u]))
    };
  }, [transactions]); // Re-calculate when transactions are reloaded (implies potential DB changes)

  const getTransactionLevel = (tx: Transaction): number | null => {
    // 1. Check explicit level property first
    const numericLevel = typeof tx.level === 'number' ? tx.level : Number(tx.level);
    if (Number.isFinite(numericLevel) && numericLevel >= 1 && numericLevel <= 10) {
      return numericLevel;
    }

    // 2. Dynamic Matrix Depth for Referral Income
    if (tx.type === 'direct_income' && tx.fromUserId) {
      const fromUser = userMap.get(tx.fromUserId);
      if (!fromUser) return 1;

      let depth = 0;
      let current7DigitId = fromUser.userId;
      const sponsor7DigitId = displayUser?.userId;

      while (current7DigitId) {
        const node = nodeMap.get(current7DigitId);
        if (!node || !node.parentId) break;

        depth++;
        if (node.parentId === sponsor7DigitId) {
          return depth;
        }
        current7DigitId = node.parentId;
      }
      return depth || 1;
    }

    // 3. Fallback: Check description for "level X" pattern
    const match = tx.description?.match(/level\s+(\d+)/i);
    return match ? Number(match[1]) : null;
  };

  const getTransactionTimestamp = (tx: Transaction): number => {
    const parse = (value: unknown): number | null => {
      const t = new Date(String(value ?? '')).getTime();
      return Number.isFinite(t) ? t : null;
    };

    const createdAt = parse(tx.createdAt);
    if (createdAt !== null) return createdAt;

    const completedAt = parse(tx.completedAt);
    if (completedAt !== null) return completedAt;

    // Fallback for older data where date fields may be missing after sync.
    const idMatch = (tx.id || '').match(/_(\d{10,13})(?:_|$)/);
    if (idMatch) {
      const n = Number(idMatch[1]);
      if (Number.isFinite(n)) {
        return idMatch[1].length === 10 ? n * 1000 : n;
      }
    }

    return 0;
  };

  const getTransactionDateLabel = (tx: Transaction): string => {
    const ts = getTransactionTimestamp(tx);
    if (ts <= 0) return '-';
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(ts));
  };

  const isOutflowTransaction = (tx: Transaction) => {
    if (tx.amount < 0) return true;
    return tx.type === 'withdrawal'
      || tx.type === 'give_help'
      || tx.type === 'safety_pool'
      || tx.type === 'system_fee'
      || tx.type === 'activation'
      || tx.type === 'pin_used'
      || tx.type === 'admin_debit';
  };

  const getDisplayAmount = (tx: Transaction) => {
    const rawAmount = Number.isFinite(tx.displayAmount) ? (tx.displayAmount as number) : tx.amount;
    const absAmount = Math.abs(rawAmount || 0);
    const sign = isOutflowTransaction(tx) ? '-' : '+';
    return `${sign}${formatCurrency(absAmount)}`;
  };

  const renderWithdrawalMeta = (tx: Transaction) => {
    if (tx.type !== 'withdrawal') return null;
    const gross = Math.abs(tx.amount || 0);
    const fee = Number(tx.fee || 0);
    const net = Number(tx.netAmount || Math.max(0, gross - fee));

    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs text-white/50">
          Gross: {formatCurrency(gross)} | Fee: {formatCurrency(fee)} | Net: {formatCurrency(net)}
        </p>
        {tx.walletAddress && (
          <p className="text-xs text-white/45 break-all">Wallet: {tx.walletAddress}</p>
        )}
        {tx.adminReason && (
          <p className={`text-xs ${tx.status === 'failed' ? 'text-red-300/90' : 'text-white/65'}`}>
            Reason: {tx.adminReason}
          </p>
        )}
        {tx.adminReceipt && (
          <div className="pt-1">
            {tx.adminReceipt.startsWith('data:image') ? (
              <img
                src={tx.adminReceipt}
                alt="Withdrawal proof"
                className="inline-block max-h-44 max-w-full w-auto h-auto rounded border border-white/10 bg-white/5"
              />
            ) : tx.adminReceipt.startsWith('data:application/pdf') ? (
              <a
                href={tx.adminReceipt}
                download={`withdrawal-proof-${tx.id}.pdf`}
                className="text-xs text-[#8fcfff] underline"
              >
                Download admin receipt (PDF)
              </a>
            ) : (
              <a
                href={tx.adminReceipt}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#8fcfff] underline break-all"
              >
                Open admin receipt
              </a>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderDepositMeta = (tx: Transaction) => {
    if (tx.type !== 'deposit') return null;
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs text-emerald-300/85">
          Deposit Amount: {formatCurrency(Math.abs(Number(tx.amount || 0)))}
        </p>
      </div>
    );
  };

  const renderTransactionMeta = (tx: Transaction) => {
    if (tx.type === 'withdrawal') return renderWithdrawalMeta(tx);
    if (tx.type === 'deposit') return renderDepositMeta(tx);
    return null;
  };

  const lockedIncomeStateByTxId = useMemo(() => {
    const state = new Map<string, 'locked' | 'unlocked'>();
    const firstTwoByLevel = new Map<number, Array<{ txId: string; remaining: number }>>();
    const qualificationByLevel = new Map<number, Array<{ txId: string; remaining: number }>>();
    const originalIndexById = new Map<string, number>();
    transactions.forEach((tx, index) => {
      originalIndexById.set(tx.id, index);
    });

    const consumeQueueAtLevel = (
      queueMap: Map<number, Array<{ txId: string; remaining: number }>>,
      level: number,
      amount: number
    ): number => {
      if (amount <= 0) return 0;
      const queue = queueMap.get(level);
      if (!queue || queue.length === 0) return amount;

      let remaining = amount;
      for (const item of queue) {
        if (remaining <= 0) break;
        if (item.remaining <= 0) continue;
        const used = Math.min(item.remaining, remaining);
        item.remaining -= used;
        remaining -= used;
        if (item.remaining <= 0) {
          state.set(item.txId, 'unlocked');
        }
      }

      queueMap.set(
        level,
        queue.filter((item) => item.remaining > 0)
      );
      return remaining;
    };

    const consumeQueueAcrossLevels = (
      queueMap: Map<number, Array<{ txId: string; remaining: number }>>,
      preferredLevel: number,
      amount: number
    ): number => {
      if (amount <= 0) return 0;
      const levels = Array.from(queueMap.keys())
        .filter((lvl) => Number.isFinite(lvl))
        .sort((a, b) => a - b);
      const ordered = levels.includes(preferredLevel)
        ? [preferredLevel, ...levels.filter((lvl) => lvl !== preferredLevel)]
        : levels;

      let remaining = amount;
      for (const level of ordered) {
        if (remaining <= 0) break;
        remaining = consumeQueueAtLevel(queueMap, level, remaining);
      }
      return remaining;
    };

    const sortedAsc = [...transactions].sort((a, b) => {
      const timeDiff = getTransactionTimestamp(a) - getTransactionTimestamp(b);
      if (timeDiff !== 0) return timeDiff;

      const getLockedFlowPriority = (tx: Transaction): number => {
        const txDesc = (tx.description || '').toLowerCase();
        if (
          tx.type === 'receive_help'
          && tx.amount > 0
          && (
            txDesc.startsWith('locked first-two help at level')
            || txDesc.startsWith('locked receive help at level')
          )
        ) {
          return 0;
        }
        if (
          (tx.type === 'give_help' && txDesc.includes('from locked income'))
          || (
            tx.type === 'receive_help'
            && tx.amount > 0
            && txDesc.startsWith('released locked receive help at level')
          )
        ) {
          return 1;
        }
        return 2;
      };

      const priorityDiff = getLockedFlowPriority(a) - getLockedFlowPriority(b);
      if (priorityDiff !== 0) return priorityDiff;

      const indexDiff = (originalIndexById.get(a.id) ?? 0) - (originalIndexById.get(b.id) ?? 0);
      if (indexDiff !== 0) return indexDiff;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    for (const tx of sortedAsc) {
      const desc = (tx.description || '').toLowerCase();
      const level = getTransactionLevel(tx);

      if (tx.type === 'receive_help' && tx.amount > 0 && desc.startsWith('locked first-two help at level')) {
        if (!level) continue;
        const list = firstTwoByLevel.get(level) || [];
        list.push({ txId: tx.id, remaining: tx.amount });
        firstTwoByLevel.set(level, list);
        state.set(tx.id, 'locked');
        continue;
      }

      if (tx.type === 'receive_help' && tx.amount > 0 && desc.startsWith('locked receive help at level')) {
        if (!level) continue;
        const list = qualificationByLevel.get(level) || [];
        list.push({ txId: tx.id, remaining: tx.amount });
        qualificationByLevel.set(level, list);
        state.set(tx.id, 'locked');
        continue;
      }

      if (tx.type === 'give_help' && desc.includes('from locked income')) {
        const preferredLevel = Math.max(1, (level || 1) - 1);
        let remaining = Math.abs(tx.amount);
        // Mirror backend consumption order: qualification-lock first, then first-two lock.
        remaining = consumeQueueAcrossLevels(qualificationByLevel, preferredLevel, remaining);
        consumeQueueAcrossLevels(firstTwoByLevel, preferredLevel, remaining);
        continue;
      }

      if (tx.type === 'receive_help' && tx.amount > 0 && desc.startsWith('released locked receive help at level')) {
        if (!level) continue;
        consumeQueueAtLevel(qualificationByLevel, level, tx.amount);
      }
    }

    return state;
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    let rows = transactions;

    if (filterType === 'help') {
      rows = rows.filter((tx) => tx.type === 'give_help' || tx.type === 'receive_help');
    } else if (filterType === 'direct_income') {
      rows = rows.filter((tx) => tx.type === 'direct_income');
    } else if (filterType === 'royalty_income') {
      rows = rows.filter((tx) => tx.type === 'royalty_income');
    } else if (filterType === 'fund_transfer') {
      rows = rows.filter((tx) =>
        tx.type === 'p2p_transfer'
        || tx.type === 'royalty_transfer'
        || (tx.type === 'income_transfer' && !isWithdrawalRefundEntry(tx))
      );
    } else if (filterType === 'deposit') {
      rows = rows.filter((tx) => tx.type === 'deposit');
    } else if (filterType === 'withdrawal') {
      rows = rows.filter((tx) => tx.type === 'withdrawal' || isWithdrawalRefundEntry(tx));
    }

    if (levelFilter !== 'all') {
      rows = rows.filter((tx) => {
        const txLevel = getTransactionLevel(tx);
        return txLevel === levelFilter;
      });
    }

    return rows;
  }, [transactions, filterType, levelFilter]);

  if (!displayUser) return null;

  return (
    <div className="transactions-page min-h-screen bg-[#0a0e17] pb-24 md:pb-0">
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
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#118bdd] to-[#004e9a] flex items-center justify-center">
                  <RefreshCw className="w-5 h-5 text-white" />
                </div>
                <div>
                  <span className="text-base sm:text-xl font-bold text-white">My Transactions</span>
                  {impersonatedUser && (
                    <p className="text-[11px] text-amber-300/90 mt-0.5">
                      Viewing as {impersonatedUser.fullName} ({impersonatedUser.userId})
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={loadTransactions}
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
        <Card className="glass border-white/10">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-white">Transaction History</CardTitle>
            <div className="flex w-full sm:w-auto flex-col sm:flex-row sm:items-center gap-3">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as 'all' | 'help' | 'direct_income' | 'royalty_income' | 'fund_transfer' | 'deposit' | 'withdrawal')}
                className="h-9 px-3 rounded-md bg-[#1f2937] border border-white/10 text-white text-sm w-full sm:w-auto"
              >
                <option value="all">All</option>
                <option value="help">Help (Receive + Give)</option>
                <option value="direct_income">Referral Income</option>
                <option value="deposit">Deposit</option>
                <option value="withdrawal">Withdrawal</option>
                <option value="fund_transfer">Fund Transfer</option>
                <option value="royalty_income">Royalty Income</option>
              </select>
              <select
                value={levelFilter}
                onChange={(e) => {
                  const value = e.target.value;
                  setLevelFilter(value === 'all' ? 'all' : Number(value));
                }}
                className="h-9 px-3 rounded-md bg-[#1f2937] border border-white/10 text-white text-sm w-full sm:w-auto"
              >
                <option value="all">Level: All</option>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((level) => (
                  <option key={level} value={level}>
                    Level {level}
                  </option>
                ))}
              </select>
              <p className="text-white/50 text-sm">Total: {filteredTransactions.length} transactions</p>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 sm:hidden">
              {filteredTransactions.map((tx) => {
                const isOutflow = isOutflowTransaction(tx);
                return (
                  <div key={tx.id} className="rounded-xl border border-white/10 bg-[#1f2937]/55 p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs text-white/50">{getTransactionDateLabel(tx)}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant="outline" className="border-white/20 text-white/80">
                            {getTransactionTypeLabel(tx.type, tx.description)}
                          </Badge>
                          {lockedIncomeStateByTxId.get(tx.id) === 'locked' && (
                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                              Locked
                            </Badge>
                          )}
                          {lockedIncomeStateByTxId.get(tx.id) === 'unlocked' && (
                            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                              Unlocked
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${isOutflow ? 'text-red-400' : 'text-emerald-400'}`}>
                          {getDisplayAmount(tx)}
                        </p>
                        {getStatusBadge(tx.status)}
                      </div>
                    </div>
                    <p className="text-sm text-white/65 break-words">{getVisibleTransactionDescription(tx.description) || '-'}</p>
                    {renderTransactionMeta(tx)}
                  </div>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-4 text-white/60 font-medium">Date</th>
                    <th className="text-left py-3 px-4 text-white/60 font-medium">Type</th>
                    <th className="text-left py-3 px-4 text-white/60 font-medium">Amount</th>
                    <th className="text-left py-3 px-4 text-white/60 font-medium">Description</th>
                    <th className="text-left py-3 px-4 text-white/60 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((tx) => {
                    const isOutflow = isOutflowTransaction(tx);
                    return (
                      <tr key={tx.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="py-3 px-4 text-white/60">
                          {getTransactionDateLabel(tx)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isOutflow ? 'bg-red-500/20' : 'bg-emerald-500/20'
                              }`}>
                              {!isOutflow ? (
                                <ArrowDownLeft className="w-4 h-4 text-emerald-500" />
                              ) : (
                                <ArrowUpRight className="w-4 h-4 text-red-500" />
                              )}
                            </div>
                            <Badge variant="outline" className="border-white/20 text-white/80">
                              {getTransactionTypeLabel(tx.type, tx.description)}
                            </Badge>
                            {lockedIncomeStateByTxId.get(tx.id) === 'locked' && (
                              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                                Locked
                              </Badge>
                            )}
                            {lockedIncomeStateByTxId.get(tx.id) === 'unlocked' && (
                              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                                Unlocked
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`font-bold ${isOutflow ? 'text-red-400' : 'text-emerald-400'}`}>
                            {getDisplayAmount(tx)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-white/60 text-sm max-w-sm">
                          <p className="break-words">{getVisibleTransactionDescription(tx.description) || '-'}</p>
                          {renderTransactionMeta(tx)}
                        </td>
                        <td className="py-3 px-4">
                          {getStatusBadge(tx.status)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredTransactions.length === 0 && (
              <div className="text-center py-12">
                <RefreshCw className="w-12 h-12 text-white/20 mx-auto mb-4" />
                <p className="text-white/50">No transactions for selected filter</p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
      <MobileBottomNav />
    </div>
  );
}
