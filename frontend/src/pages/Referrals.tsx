import { useEffect, useMemo, useState } from 'react';
import { useAuthStore, useSyncRefreshKey } from '@/store';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, LogOut, UserPlus, Search, X,
  Copy, CheckCircle, MessageCircle, Share2
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { formatCurrency, getInitials, generateAvatarColor } from '@/utils/helpers';
import Database from '@/db';
import MobileBottomNav from '@/components/MobileBottomNav';
import { toast } from 'sonner';

export default function Referrals() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout, impersonatedUser, endImpersonation } = useAuthStore();
  const syncKey = useSyncRefreshKey();

  const displayUser = impersonatedUser || user;

  const [directReferralSearch, setDirectReferralSearch] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
  }, [isAuthenticated, navigate, syncKey]);

  const handleLogout = () => {
    if (impersonatedUser) {
      endImpersonation();
      toast.success('Returned to admin account');
    } else {
      logout();
      navigate('/login');
      toast.success('Logged out successfully');
    }
  };

  const getReferralLink = () => {
    if (!displayUser) return '';
    return `${window.location.origin}/register?sponsor=${displayUser.userId}`;
  };

  const copyReferralLink = () => {
    if (!displayUser) return;
    const link = `${window.location.origin}/register?sponsor=${displayUser.userId}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Referral link copied!');
  };

  const getReferralShareMessage = () => {
    const link = getReferralLink();
    return [
      '*New Earning Opportunity !*',
      '',
      '*ReferNex* = Smart Shopping + Helping System + Referral Income.',
      '',
      'Simple process, Transparent system, Real growth.',
      '',
      '*Join here :*',
      link,
      '',
      '*Note :* A valid *Activation Pin* is required to complete registration.'
    ].join('\n');
  };

  const shareReferralOnWhatsApp = () => {
    const message = getReferralShareMessage();
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const shareReferral = async () => {
    const link = getReferralLink();
    const message = getReferralShareMessage();
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'ReferNex - New Earning Opportunity',
          text: message,
          url: link
        });
        return;
      }
    } catch {
      // User may cancel share dialog
    }
    try {
      await navigator.clipboard.writeText(message);
      toast.success('Referral message copied. You can paste and share it.');
    } catch {
      toast.error('Share not supported on this device/browser.');
    }
  };

  const directReferralUsers = useMemo(() => {
    if (!displayUser) return [];
    return Database.getUsers()
      .filter(u => u.sponsorId === displayUser.userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayUser, syncKey]);

  const filteredDirectReferrals = useMemo(() => {
    const q = directReferralSearch.trim().toLowerCase();
    if (!q) return directReferralUsers;
    return directReferralUsers.filter((u) =>
      u.userId.toLowerCase().includes(q) ||
      u.fullName.toLowerCase().includes(q)
    );
  }, [directReferralUsers, directReferralSearch]);

  if (!displayUser) return null;

  return (
    <div className="referrals-page min-h-screen bg-[#0a0e17] pb-24 md:pb-0">
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
                  <UserPlus className="w-5 h-5 text-white" />
                </div>
                <div>
                  <span className="text-base sm:text-xl font-bold text-white">My Referrals</span>
                  <p className="text-xs text-white/50">{directReferralUsers.length} Direct Referral{directReferralUsers.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
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
        {/* Referral Sharing Card */}
        <Card className="glass border-white/10 mb-6">
          <CardContent className="p-6">
            <div className="flex flex-col gap-4">
              <div>
                <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-[#118bdd]" />
                  Referral Program
                </h3>
                <p className="text-white/60 text-sm">Invite friends and earn $5 for each activation</p>
              </div>
              <div className="flex items-center gap-3 w-fit">
                <code className="px-3 py-2 bg-[#1f2937] rounded-lg text-xs sm:text-sm text-white/80 break-all">
                  {getReferralLink()}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyReferralLink}
                  className="border-white/20 hover:bg-white/10 shrink-0"
                >
                  {copied ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={shareReferralOnWhatsApp}
                className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                Share on WhatsApp
              </Button>
              <Button
                variant="outline"
                onClick={() => void shareReferral()}
                className="border-[#118bdd]/40 text-[#7dd3fc] hover:bg-[#118bdd]/10"
              >
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <Input
            value={directReferralSearch}
            onChange={(e) => setDirectReferralSearch(e.target.value)}
            placeholder="Search by ID or Name..."
            className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm"
          />
          {directReferralSearch && (
            <button
              onClick={() => setDirectReferralSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Result count */}
        {directReferralSearch && (
          <p className="text-xs text-white/40 mb-4">
            {filteredDirectReferrals.length} result{filteredDirectReferrals.length !== 1 ? 's' : ''} found
          </p>
        )}

        {/* Referral Cards List */}
        <div className="space-y-3">
          {filteredDirectReferrals.length === 0 ? (
            <div className="text-center py-16">
              <UserPlus className="w-12 h-12 text-white/15 mx-auto mb-3" />
              <p className="text-white/40 text-sm">
                {directReferralUsers.length === 0
                  ? 'No referrals yet. Share your link to get started!'
                  : 'No referrals match your search'}
              </p>
            </div>
          ) : (
            filteredDirectReferrals.map((refUser) => {
              const refWallet = Database.getWallet(refUser.id);
              const refStats = Database.getTeamCounts(refUser.userId);
              const refCurrentLevel = Database.getCurrentMatrixLevel(refUser.id);
              const refQualifiedLevel = Database.getQualifiedLevel(refUser.id);
              const refDirectCount = Database.getEffectiveDirectCount(refUser);
              return (
                <div
                  key={refUser.id}
                  className="rounded-xl border border-white/[0.06] bg-gradient-to-br from-white/[0.04] to-white/[0.01] overflow-hidden"
                >
                  {/* User row */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${generateAvatarColor(refUser.userId)}`}>
                      {getInitials(refUser.fullName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate">{refUser.fullName}</p>
                      <p className="text-xs text-[#5eb4f0] font-mono">{refUser.userId}</p>
                    </div>
                    <Badge
                      className={`text-[10px] px-2 py-0.5 shrink-0 ${
                        refUser.isActive
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                          : 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                      }`}
                    >
                      {refUser.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-white/[0.06]">
                    <div className="px-3 py-2.5 text-center">
                      <p className="text-[10px] text-white/35 uppercase tracking-wider mb-0.5">Qualified</p>
                      <p className="text-sm font-bold text-white">
                        {refQualifiedLevel > 0 ? (
                          <span>L{refQualifiedLevel}</span>
                        ) : (
                          <span className="text-white/25">-</span>
                        )}
                      </p>
                    </div>
                    <div className="px-3 py-2.5 text-center">
                      <p className="text-[10px] text-white/35 uppercase tracking-wider mb-0.5">Level</p>
                      <p className="text-sm font-bold text-[#5eb4f0]">L{refCurrentLevel || 1}</p>
                    </div>
                    <div className="px-3 py-2.5 text-center">
                      <p className="text-[10px] text-white/35 uppercase tracking-wider mb-0.5">Left</p>
                      <p className="text-sm font-bold text-white">{refStats.left}</p>
                    </div>
                    <div className="px-3 py-2.5 text-center">
                      <p className="text-[10px] text-white/35 uppercase tracking-wider mb-0.5">Right</p>
                      <p className="text-sm font-bold text-white">{refStats.right}</p>
                    </div>
                    <div className="px-3 py-2.5 text-center">
                      <p className="text-[10px] text-white/35 uppercase tracking-wider mb-0.5">Direct</p>
                      <p className="text-sm font-bold text-white">{refDirectCount}</p>
                    </div>
                    <div className="px-3 py-2.5 text-center">
                      <p className="text-[10px] text-white/35 uppercase tracking-wider mb-0.5">Earning</p>
                      <p className="text-sm font-bold text-emerald-400">{formatCurrency(refWallet?.totalReceived || 0)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      <MobileBottomNav />
    </div>
  );
}
