import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/store';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  ArrowLeft, ArrowDownLeft, ArrowUpRight, LogOut, RefreshCw
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/utils/helpers';
import Database from '@/db';
import type { Transaction } from '@/types';
import { toast } from 'sonner';

export default function Transactions() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuthStore();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'help' | 'direct_income'>('all');
  const [receiveHelpLevelFilter, setReceiveHelpLevelFilter] = useState<'all' | number>('all');

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    
    if (user) {
      loadTransactions();
    }
  }, [isAuthenticated, user, navigate]);

  const loadTransactions = () => {
    if (!user) return;
    const userTransactions = Database.getUserTransactions(user.id);
    setTransactions(userTransactions);
  };

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

  const getTransactionLevel = (tx: Transaction): number | null => {
    const numericLevel = Number(tx.level);
    if (Number.isFinite(numericLevel) && numericLevel >= 1 && numericLevel <= 10) {
      return numericLevel;
    }

    const desc = tx.description || '';
    const match = desc.match(/\blevel\s+(\d+)\b/i);
    if (!match) return null;
    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) return null;
    return parsed;
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
    return formatDate(new Date(ts).toISOString());
  };

  const isOutflowTransaction = (tx: Transaction) => {
    if (tx.amount < 0) return true;
    return tx.type === 'withdrawal'
      || tx.type === 'give_help'
      || tx.type === 'safety_pool'
      || tx.type === 'activation'
      || tx.type === 'admin_debit';
  };

  const getDisplayAmount = (tx: Transaction) => {
    const absAmount = Math.abs(tx.amount);
    return `${isOutflowTransaction(tx) ? '-' : '+'}${formatCurrency(absAmount)}`;
  };

  const lockedIncomeStateByTxId = useMemo(() => {
    const state = new Map<string, 'locked' | 'unlocked'>();
    const firstTwoByLevel = new Map<number, Array<{ txId: string; remaining: number }>>();
    const qualificationByLevel = new Map<number, Array<{ txId: string; remaining: number }>>();
    const originalIndexById = new Map<string, number>();
    transactions.forEach((tx, index) => {
      originalIndexById.set(tx.id, index);
    });

    const consumeQueue = (
      queueMap: Map<number, Array<{ txId: string; remaining: number }>>,
      level: number,
      amount: number
    ) => {
      if (amount <= 0) return;
      const queue = queueMap.get(level);
      if (!queue || queue.length === 0) return;

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
    };

    const sortedAsc = [...transactions].sort((a, b) => {
      const timeDiff = getTransactionTimestamp(a) - getTransactionTimestamp(b);
      if (timeDiff !== 0) return timeDiff;
      const indexDiff = (originalIndexById.get(a.id) ?? 0) - (originalIndexById.get(b.id) ?? 0);
      if (indexDiff !== 0) return indexDiff;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    for (const tx of sortedAsc) {
      const desc = (tx.description || '').toLowerCase();
      const level = getTransactionLevel(tx);

      if (tx.type === 'get_help' && tx.amount > 0 && desc.startsWith('locked first-two help at level')) {
        if (!level) continue;
        const list = firstTwoByLevel.get(level) || [];
        list.push({ txId: tx.id, remaining: tx.amount });
        firstTwoByLevel.set(level, list);
        state.set(tx.id, 'locked');
        continue;
      }

      if (tx.type === 'get_help' && tx.amount > 0 && desc.startsWith('locked receive help at level')) {
        if (!level) continue;
        const list = qualificationByLevel.get(level) || [];
        list.push({ txId: tx.id, remaining: tx.amount });
        qualificationByLevel.set(level, list);
        state.set(tx.id, 'locked');
        continue;
      }

      if (tx.type === 'give_help' && desc.includes('from locked income')) {
        if (!level) continue;
        consumeQueue(firstTwoByLevel, level, Math.abs(tx.amount));
        continue;
      }

      if (tx.type === 'get_help' && tx.amount > 0 && desc.startsWith('released locked receive help at level')) {
        if (!level) continue;
        consumeQueue(qualificationByLevel, level, tx.amount);
      }
    }

    return state;
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    let rows = transactions;

    if (filterType === 'help') {
      rows = rows.filter((tx) => tx.type === 'give_help' || tx.type === 'get_help');
    } else if (filterType === 'direct_income') {
      rows = rows.filter((tx) => tx.type === 'direct_income');
    }

    if (receiveHelpLevelFilter !== 'all') {
      rows = rows.filter((tx) => {
        const txLevel = getTransactionLevel(tx);
        if (txLevel !== receiveHelpLevelFilter) return false;

        if (tx.type === 'get_help') return true;
        if (
          tx.type === 'safety_pool'
          && (tx.description || '').toLowerCase().startsWith('every 5th help deduction at level')
        ) {
          return true;
        }
        return false;
      });
    }

    return rows;
  }, [transactions, filterType, receiveHelpLevelFilter]);

  if (!user) return null;

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
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#118bdd] to-[#004e9a] flex items-center justify-center">
                  <RefreshCw className="w-5 h-5 text-white" />
                </div>
                <span className="text-base sm:text-xl font-bold text-white">My Transactions</span>
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
	                onChange={(e) => setFilterType(e.target.value as 'all' | 'help' | 'direct_income')}
	                className="h-9 px-3 rounded-md bg-[#1f2937] border border-white/10 text-white text-sm w-full sm:w-auto"
              >
                <option value="all">All</option>
	                <option value="help">Help (Give + Get)</option>
	                <option value="direct_income">Direct Sponsor Income</option>
	              </select>
                <select
                  value={receiveHelpLevelFilter}
                  onChange={(e) => {
                    const value = e.target.value;
                    setReceiveHelpLevelFilter(value === 'all' ? 'all' : Number(value));
                  }}
                  className="h-9 px-3 rounded-md bg-[#1f2937] border border-white/10 text-white text-sm w-full sm:w-auto"
                >
                  <option value="all">Receive Help: All Levels</option>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((level) => (
                    <option key={level} value={level}>
                      Receive Help: Level {level}
                    </option>
                  ))}
                </select>
	              <p className="text-white/50 text-sm">Total: {filteredTransactions.length} transactions</p>
	            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
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
	                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
	                            isOutflow ? 'bg-red-500/20' : 'bg-emerald-500/20'
	                          }`}>
	                            {!isOutflow ? (
	                              <ArrowDownLeft className="w-4 h-4 text-emerald-500" />
	                            ) : (
	                              <ArrowUpRight className="w-4 h-4 text-red-500" />
	                            )}
                          </div>
	                          <Badge variant="outline" className="border-white/20 text-white/80 capitalize">
	                            {tx.type.replace('_', ' ')}
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
                      <td className="py-3 px-4 text-white/60 text-sm max-w-xs truncate">
                        {tx.description}
                      </td>
	                      <td className="py-3 px-4">
	                        {getStatusBadge(tx.status)}
	                      </td>
	                    </tr>
	                  );
                    })}
	                </tbody>
              </table>
	              {filteredTransactions.length === 0 && (
	                <div className="text-center py-12">
	                  <RefreshCw className="w-12 h-12 text-white/20 mx-auto mb-4" />
	                  <p className="text-white/50">No transactions for selected filter</p>
	                </div>
	              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
