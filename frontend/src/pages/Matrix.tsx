import { memo, useEffect, useMemo, useState, useRef } from 'react';
import { useAuthStore, useMatrixStore, useSyncRefreshKey } from '@/store';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Users, ArrowLeft, ZoomIn, ZoomOut, Maximize2, Minimize2, RotateCcw,
  Circle, LogOut, Search, Filter, ChevronUp, ChevronDown, X
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { formatCurrency, getInitials, generateAvatarColor } from '@/utils/helpers';
import Database from '@/db';
import type { MatrixNode } from '@/types';
import MobileBottomNav from '@/components/MobileBottomNav';

interface TreeNodeProps {
  node: MatrixNode | null;
  displayName?: string;
  realIsActive?: boolean;
  slotNumber?: number;
  onNodeClick: (node: MatrixNode) => void;
}

const TreeNode = memo(({ node, displayName, realIsActive, slotNumber, onNodeClick }: TreeNodeProps) => {
  const shellSizeClass = 'w-14 h-14';
  const placeholderSizeClass = 'w-16 h-16 rounded-2xl';
  const nameWidthClass = 'max-w-[80px]';
  const nameTextClass = 'text-xs';
  const idTextClass = 'text-xs';

  if (!node) {
    return (
      <div className="flex flex-col items-center">
        {typeof slotNumber === 'number' && (
          <span className="mb-2 inline-flex items-center rounded-full border border-[#118bdd]/40 bg-[#118bdd]/10 px-2 py-0.5 text-[10px] font-semibold text-[#8fcfff] shadow-sm shadow-[#118bdd]/10">
            Slot #{slotNumber}
          </span>
        )}
        <div className={`${placeholderSizeClass} border border-dashed border-white/15 bg-white/[0.03] flex items-center justify-center`}>
          <Circle className="w-5 h-5 text-white/15" />
        </div>
        <span className="text-xs text-white/30 mt-2">Empty</span>
        <span className="text-xs text-white/15">Slot</span>
      </div>
    );
  }

  const active = realIsActive ?? node.isActive;

  return (
    <div className="flex flex-col items-center">
      {typeof slotNumber === 'number' && (
        <span className="mb-2 inline-flex items-center rounded-full border border-[#118bdd]/40 bg-[#118bdd]/10 px-2 py-0.5 text-[10px] font-semibold text-[#8fcfff] shadow-sm shadow-[#118bdd]/10">
          Slot #{slotNumber}
        </span>
      )}
      <button
        onClick={() => onNodeClick(node)}
        className={`relative ${shellSizeClass} rounded-full flex items-center justify-center transition-all duration-300 ${active
            ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/30'
            : 'bg-gradient-to-br from-amber-500 to-amber-600 shadow-lg shadow-amber-500/30'
          } hover:scale-110`}
      >
        <span className="text-white font-bold text-sm">
          {getInitials(displayName || node.username)}
        </span>
        {active && (
          <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-400 rounded-full border-2 border-[#0a0e17]" />
        )}
      </button>
      <span className={`${nameTextClass} text-white/70 mt-2 ${nameWidthClass} truncate text-center`}>{displayName || node.username}</span>
      <span className={`${idTextClass} text-white/40`}>ID: {node.userId}</span>
    </div>
  );
});

export default function Matrix() {
  const DOWNLINE_CHUNK_SIZE = 20;
  const FULL_SLOT_RENDER_LIMIT = 2048;
  const navigate = useNavigate();
  const { user, impersonatedUser, isAuthenticated, logout } = useAuthStore();
  const { matrix, loadMatrix } = useMatrixStore();
  const syncKey = useSyncRefreshKey();
  const displayUser = impersonatedUser || user;
  const [selectedNode, setSelectedNode] = useState<MatrixNode | null>(null);
  const [zoom, setZoom] = useState(1);
  const [downlineVisibleCount, setDownlineVisibleCount] = useState(DOWNLINE_CHUNK_SIZE);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const matrixCardRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [treeWrapHeight, setTreeWrapHeight] = useState<number | undefined>(undefined);

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLevel, setFilterLevel] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPosition, setFilterPosition] = useState('all');
  const [filterDateJoined, setFilterDateJoined] = useState('all');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showFilters, setShowFilters] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 640;
  });
  const levelScrollRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    loadMatrix();
  }, [isAuthenticated, navigate, loadMatrix, syncKey]);

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 0.2, 2));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 0.2, 0.5));
  };

  // Adjust wrapper height to match visually scaled tree content
  useEffect(() => {
    const el = treeContainerRef.current;
    if (!el) return;
    const updateHeight = () => {
      const natural = el.scrollHeight;
      setTreeWrapHeight(natural * zoom);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, [zoom]);

  useEffect(() => {
    const updateViewport = () => setIsMobileViewport(window.innerWidth < 640);
    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
        msFullscreenElement?: Element | null;
      };
      setIsFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange as EventListener);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange as EventListener);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange as EventListener);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange as EventListener);
    };
  }, []);

  const handleToggleFullscreen = async () => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      msFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
      msExitFullscreen?: () => Promise<void> | void;
    };

    const fullscreenElement = doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement;
    if (fullscreenElement) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
        return;
      }
      if (doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
        return;
      }
      if (doc.msExitFullscreen) {
        await doc.msExitFullscreen();
      }
      return;
    }

    if (!matrixCardRef.current) return;
    const el = matrixCardRef.current as HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
      msRequestFullscreen?: () => Promise<void> | void;
    };
    if (el.requestFullscreen) {
      await el.requestFullscreen();
      return;
    }
    if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen();
      return;
    }
    if (el.msRequestFullscreen) {
      await el.msRequestFullscreen();
    }
  };

  const matrixViewMaxLevels = Math.max(1, Math.min(Database.getSettings().matrixViewMaxLevels || 20, 20));

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const userNode = displayUser ? matrix.find(m => m.userId === displayUser.userId) : null;
  const usersByUserId = useMemo(() => {
    const users = Database.getUsers();
    const canonicalUsers = new Map<string, (typeof users)[number]>();
    for (const user of users) {
      if (!user?.userId || canonicalUsers.has(user.userId)) continue;
      canonicalUsers.set(user.userId, Database.getUserByUserId(user.userId) || user);
    }
    return canonicalUsers;
  }, [matrix, syncKey]);
  const getDisplayName = (userId: string, fallback: string) => usersByUserId.get(userId)?.fullName || fallback;

  const downline = useMemo(() => {
    if (!displayUser) return [] as MatrixNode[];
    return Database.getUserDownline(displayUser.userId, matrixViewMaxLevels);
  }, [displayUser, matrix, matrixViewMaxLevels]);

  const teamStats = useMemo(
    () => (displayUser ? Database.getTeamCounts(displayUser.userId) : { left: 0, right: 0, leftActive: 0, rightActive: 0 }),
    [displayUser, matrix]
  );

  const levelGroups = useMemo(() => {
    if (!userNode) {
      return [] as Array<{
        level: number;
        slots: Array<MatrixNode | null>;
        filled: number;
        capacity: number;
        renderFullSlots: boolean;
      }>;
    }

    const nodeMap = new Map(matrix.map((m) => [m.userId, m]));
    const slotViewMaxLevels = matrixViewMaxLevels;
    const groups: Array<{
      level: number;
      slots: Array<MatrixNode | null>;
      filled: number;
      capacity: number;
      renderFullSlots: boolean;
    }> = [];
    let currentLevelSlots: Array<MatrixNode | null> = [userNode];

    for (let level = 1; level <= slotViewMaxLevels; level++) {
      const nextSlots = currentLevelSlots.flatMap((parent) => {
        if (!parent) return [null, null] as Array<MatrixNode | null>;

        const left = parent.leftChild ? nodeMap.get(parent.leftChild) || null : null;
        const right = parent.rightChild ? nodeMap.get(parent.rightChild) || null : null;
        return [left, right];
      });

      const filled = nextSlots.filter((node): node is MatrixNode => !!node).length;
      if (filled === 0) break;

      const capacity = nextSlots.length;
      const renderFullSlots = capacity <= FULL_SLOT_RENDER_LIMIT;
      groups.push({
        level,
        slots: renderFullSlots ? nextSlots : nextSlots.filter((node): node is MatrixNode => !!node),
        filled,
        capacity,
        renderFullSlots
      });

      currentLevelSlots = nextSlots;
    }

    return groups;
  }, [userNode, matrix, matrixViewMaxLevels]);

  useEffect(() => {
    for (const container of Object.values(levelScrollRefs.current)) {
      if (container) {
        container.scrollLeft = 0;
      }
    }
  }, [levelGroups.length, zoom, displayUser?.userId]);

  // Compute distinct relative levels for the filter dropdown
  const availableLevels = useMemo(() => {
    if (!userNode) return [] as number[];
    const levels = new Set<number>();
    for (const m of downline) {
      levels.add(Math.max(1, m.level - (userNode.level || 0)));
    }
    return Array.from(levels).sort((a, b) => a - b);
  }, [downline, userNode]);

  // Apply search, filters, and sort
  const filteredDownline = useMemo(() => {
    let result = downline;
    const baseLevel = userNode?.level || 0;

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((m) => {
        const memberUser = usersByUserId.get(m.userId);
        const name = (memberUser?.fullName || m.username || '').toLowerCase();
        const id = m.userId.toLowerCase();
        const relLevel = String(Math.max(1, m.level - baseLevel));
        return id.includes(q) || name.includes(q) || relLevel === q;
      });
    }

    // Filter by level
    if (filterLevel !== 'all') {
      const lvl = Number(filterLevel);
      result = result.filter((m) => Math.max(1, m.level - baseLevel) === lvl);
    }

    // Filter by status
    if (filterStatus !== 'all') {
      const active = filterStatus === 'active';
      result = result.filter((m) => {
        const realActive = usersByUserId.get(m.userId)?.isActive ?? m.isActive;
        return realActive === active;
      });
    }

    // Filter by position
    if (filterPosition !== 'all') {
      const pos = filterPosition === 'left' ? 0 : 1;
      result = result.filter((m) => m.position === pos);
    }

    // Filter by date joined
    if (filterDateJoined !== 'all') {
      const now = new Date();
      result = result.filter((m) => {
        const memberUser = usersByUserId.get(m.userId);
        if (!memberUser?.createdAt) return false;
        const joined = new Date(memberUser.createdAt);
        const diffDays = (now.getTime() - joined.getTime()) / (1000 * 60 * 60 * 24);
        switch (filterDateJoined) {
          case 'today': return diffDays < 1;
          case '7days': return diffDays <= 7;
          case '30days': return diffDays <= 30;
          case '90days': return diffDays <= 90;
          case 'custom': {
            if (customDateFrom) {
              const from = new Date(customDateFrom);
              from.setHours(0, 0, 0, 0);
              if (joined < from) return false;
            }
            if (customDateTo) {
              const to = new Date(customDateTo);
              to.setHours(23, 59, 59, 999);
              if (joined > to) return false;
            }
            return true;
          }
          default: return true;
        }
      });
    }

    // Sort
    result = [...result].sort((a, b) => {
      const relA = Math.max(1, a.level - baseLevel);
      const relB = Math.max(1, b.level - baseLevel);
      return sortOrder === 'asc' ? relA - relB : relB - relA;
    });

    return result;
  }, [downline, userNode, usersByUserId, searchQuery, filterLevel, filterStatus, filterPosition, filterDateJoined, customDateFrom, customDateTo, sortOrder]);

  const visibleDownline = useMemo(
    () => filteredDownline.slice(0, downlineVisibleCount),
    [filteredDownline, downlineVisibleCount]
  );

  const hasActiveFilters = filterLevel !== 'all' || filterStatus !== 'all' || filterPosition !== 'all' || filterDateJoined !== 'all';

  const clearAllFilters = () => {
    setSearchQuery('');
    setFilterLevel('all');
    setFilterStatus('all');
    setFilterPosition('all');
    setFilterDateJoined('all');
    setCustomDateFrom('');
    setCustomDateTo('');
    setSortOrder('asc');
    setDownlineVisibleCount(DOWNLINE_CHUNK_SIZE);
  };
  if (!displayUser) return null;

  return (
    <div className="matrix-page min-h-screen bg-[#0a0e17] pb-24 md:pb-0">
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
                  <Users className="w-5 h-5 text-white" />
                </div>
                <div>
                  <span className="text-base sm:text-xl font-bold text-white">My Matrix</span>
                  {impersonatedUser && (
                    <p className="text-[11px] text-amber-300/90 mt-0.5">
                      Viewing as {impersonatedUser.fullName} ({impersonatedUser.userId})
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center flex-wrap justify-end gap-1 sm:gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleZoomOut}
                className="border-white/20 text-white hover:bg-white/10"
              >
                <ZoomOut className="w-4 h-4" />
              </Button>
              <span className="hidden sm:block text-white/60 text-sm min-w-[44px] text-center">{Math.round(zoom * 100)}%</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setZoom(1)}
                className="border-white/20 text-white hover:bg-white/10"
                title="Reset zoom"
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleZoomIn}
                className="border-white/20 text-white hover:bg-white/10"
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleFullscreen}
                className="border-white/20 text-white hover:bg-white/10"
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                className="text-white/60 hover:text-red-400 ml-2"
              >
                <LogOut className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <p className="text-sm text-white/60 mb-1">Total Downline</p>
              <p className="text-2xl font-bold text-white">{downline.length}</p>
            </CardContent>
          </Card>
          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <p className="text-sm text-white/60 mb-1">Current Level</p>
              <p className="text-2xl font-bold text-white">{Database.getCurrentMatrixLevel(displayUser.id)}</p>
            </CardContent>
          </Card>
          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <p className="text-sm text-white/60 mb-1">Left Team</p>
              <p className="text-2xl font-bold text-white">{teamStats.left}</p>
              <p className="text-xs text-emerald-400">{teamStats.leftActive} Active</p>
            </CardContent>
          </Card>
          <Card className="glass border-white/10">
            <CardContent className="p-4">
              <p className="text-sm text-white/60 mb-1">Right Team</p>
              <p className="text-2xl font-bold text-white">{teamStats.right}</p>
              <p className="text-xs text-emerald-400">{teamStats.rightActive} Active</p>
            </CardContent>
          </Card>
        </div>

        {/* Tree Visualization */}
        <Card ref={matrixCardRef} className="glass border-white/10">
          <CardHeader className="px-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-white">Matrix Team View (Up to {matrixViewMaxLevels} Levels)</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-emerald-500 text-emerald-400">
                <div className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
                Active
              </Badge>
              <Badge variant="outline" className="border-amber-500 text-amber-400">
                <div className="w-2 h-2 rounded-full bg-amber-500 mr-2" />
                Inactive
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="overflow-hidden px-0 sm:px-6">
            <div style={{ height: treeWrapHeight ? `${treeWrapHeight}px` : 'auto', overflow: 'hidden' }}>
            <div
              ref={treeContainerRef}
              className="flex flex-col items-center py-8 transition-transform duration-300"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: isMobileViewport ? 'top left' : 'top center',
                width: `${100 / zoom}%`,
                marginLeft: isMobileViewport ? '0%' : `${-(100 / zoom - 100) / 2}%`
              }}
            >
              {userNode ? (
                <>
                  <div className="mb-8 px-4 sm:px-0">
                    <p className="text-center text-white/60 mb-3">Your ID</p>
                    <TreeNode node={userNode} displayName={getDisplayName(userNode.userId, userNode.username)} realIsActive={usersByUserId.get(userNode.userId)?.isActive ?? userNode.isActive} onNodeClick={setSelectedNode} />
                  </div>

                    <div className="w-full space-y-8">
                      {levelGroups.map((group) => (
                        <div key={group.level} className="space-y-3">
                          <div className="border-b border-white/10 mb-2 mx-4 sm:mx-0" />
                          <div className="flex items-center justify-between pb-2 px-4 sm:px-0">
                            <p className="text-white/70 font-medium">Level {group.level}</p>
                            <Badge variant="outline" className="border-[#118bdd] text-[#118bdd]">
                              {group.filled}/{group.capacity} filled
                            </Badge>
                          </div>
                          <div className="w-full">
                            <div
                              className="w-full overflow-x-auto snap-x snap-mandatory px-3 sm:px-0 scroll-px-3 sm:scroll-px-0"
                              ref={(el) => {
                                levelScrollRefs.current[group.level] = el;
                              }}
                            >
                              <div className={`flex items-start gap-5 w-max min-w-full ${group.capacity <= 2 ? 'justify-center' : 'justify-start'} sm:justify-center px-0 sm:px-2`}>
                                {group.slots.map((node, idx) => (
                                  <div
                                    key={`${group.level}_${idx}_${node?.userId || 'empty'}`}
                                    className="w-24 shrink-0 flex justify-center snap-start"
                                  >
                                    <TreeNode
                                      node={node}
                                      slotNumber={idx + 1}
                                      displayName={node ? getDisplayName(node.userId, node.username) : undefined}
                                      realIsActive={node ? (usersByUserId.get(node.userId)?.isActive ?? node.isActive) : undefined}
                                      onNodeClick={setSelectedNode}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    {downline.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-4">
                        <p className="text-white/50">No downline yet</p>
                        <p className="text-white/30 text-sm">Level 1 has 2 empty slots ready.</p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-20">
                  <Users className="w-16 h-16 text-white/20 mb-4" />
                  <p className="text-white/50">No downline yet</p>
                  <p className="text-white/30 text-sm">Share your referral link to build your network</p>
                </div>
              )}
            </div>
            </div>
          </CardContent>
        </Card>

        {/* Downline List */}
        <Card className="glass border-white/10 mt-8">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <CardTitle className="text-white">
                Downline Members
                {(searchQuery || hasActiveFilters) && (
                  <span className="text-sm font-normal text-white/50 ml-2">
                    ({filteredDownline.length} of {downline.length})
                  </span>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                  className="border-white/20 text-white/70 hover:bg-white/10 gap-1"
                >
                  {sortOrder === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {sortOrder === 'asc' ? 'Asc' : 'Desc'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFilters(prev => !prev)}
                  className={`border-white/20 hover:bg-white/10 gap-1.5 ${showFilters || hasActiveFilters ? 'text-[#118bdd] border-[#118bdd]/40' : 'text-white/70'}`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  Filters
                  {hasActiveFilters && (
                    <span className="w-2 h-2 rounded-full bg-[#118bdd]" />
                  )}
                </Button>
              </div>
            </div>

            {/* Search Bar */}
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <Input
                placeholder="Search by ID, Name, or Level..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setDownlineVisibleCount(DOWNLINE_CHUNK_SIZE); }}
                className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:border-[#118bdd] focus-visible:ring-[#118bdd]/20"
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); setDownlineVisibleCount(DOWNLINE_CHUNK_SIZE); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Filter Options */}
            {showFilters && (
              <div className="mt-3 p-3 rounded-lg bg-white/5 border border-white/10 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {/* Level Filter */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-white/50 font-medium">Level</label>
                    <Select value={filterLevel} onValueChange={(v) => { setFilterLevel(v); setDownlineVisibleCount(DOWNLINE_CHUNK_SIZE); }}>
                      <SelectTrigger className="w-full bg-white/5 border-white/10 text-white text-sm h-9">
                        <SelectValue placeholder="All Levels" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a1f2e] border-white/10">
                        <SelectItem value="all" className="text-white/70">All Levels</SelectItem>
                        {availableLevels.map((lvl) => (
                          <SelectItem key={lvl} value={String(lvl)} className="text-white/70">
                            Level {lvl}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Status Filter */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-white/50 font-medium">Status</label>
                    <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setDownlineVisibleCount(DOWNLINE_CHUNK_SIZE); }}>
                      <SelectTrigger className="w-full bg-white/5 border-white/10 text-white text-sm h-9">
                        <SelectValue placeholder="All Status" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a1f2e] border-white/10">
                        <SelectItem value="all" className="text-white/70">All Status</SelectItem>
                        <SelectItem value="active" className="text-emerald-400">Active</SelectItem>
                        <SelectItem value="inactive" className="text-amber-400">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Position Filter */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-white/50 font-medium">Position</label>
                    <Select value={filterPosition} onValueChange={(v) => { setFilterPosition(v); setDownlineVisibleCount(DOWNLINE_CHUNK_SIZE); }}>
                      <SelectTrigger className="w-full bg-white/5 border-white/10 text-white text-sm h-9">
                        <SelectValue placeholder="All Positions" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a1f2e] border-white/10">
                        <SelectItem value="all" className="text-white/70">All Positions</SelectItem>
                        <SelectItem value="left" className="text-white/70">Left</SelectItem>
                        <SelectItem value="right" className="text-white/70">Right</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Date Joined Filter */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-white/50 font-medium">Date Joined</label>
                    <Select value={filterDateJoined} onValueChange={(v) => { setFilterDateJoined(v); if (v !== 'custom') { setCustomDateFrom(''); setCustomDateTo(''); } setDownlineVisibleCount(DOWNLINE_CHUNK_SIZE); }}>
                      <SelectTrigger className="w-full bg-white/5 border-white/10 text-white text-sm h-9">
                        <SelectValue placeholder="All Time" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a1f2e] border-white/10">
                        <SelectItem value="all" className="text-white/70">All Time</SelectItem>
                        <SelectItem value="today" className="text-white/70">Today</SelectItem>
                        <SelectItem value="7days" className="text-white/70">Last 7 Days</SelectItem>
                        <SelectItem value="30days" className="text-white/70">Last 30 Days</SelectItem>
                        <SelectItem value="90days" className="text-white/70">Last 90 Days</SelectItem>
                        <SelectItem value="custom" className="text-white/70">Custom Date</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Custom Date Range Inputs */}
                {filterDateJoined === 'custom' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs text-white/50 font-medium">From</label>
                      <Input
                        type="date"
                        value={customDateFrom}
                        onChange={(e) => { setCustomDateFrom(e.target.value); setDownlineVisibleCount(DOWNLINE_CHUNK_SIZE); }}
                        className="bg-white/5 border-white/10 text-white text-sm h-9 [color-scheme:dark]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-white/50 font-medium">To</label>
                      <Input
                        type="date"
                        value={customDateTo}
                        onChange={(e) => { setCustomDateTo(e.target.value); setDownlineVisibleCount(DOWNLINE_CHUNK_SIZE); }}
                        className="bg-white/5 border-white/10 text-white text-sm h-9 [color-scheme:dark]"
                      />
                    </div>
                  </div>
                )}

                {hasActiveFilters && (
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearAllFilters}
                      className="text-white/50 hover:text-white text-xs gap-1"
                    >
                      <X className="w-3 h-3" />
                      Clear All Filters
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-4 text-white/60 font-medium">User ID</th>
                    <th className="text-left py-3 px-4 text-white/60 font-medium">Name</th>
                    <th className="text-left py-3 px-4 text-white/60 font-medium">Level</th>
                    <th className="text-left py-3 px-4 text-white/60 font-medium">Status</th>
                    <th className="text-left py-3 px-4 text-white/60 font-medium">Position</th>
                    <th className="text-left py-3 px-4 text-white/60 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDownline.map((member) => {
                    const memberUser = usersByUserId.get(member.userId);
                    const relativeLevel = Math.max(1, member.level - (userNode?.level || 0));
                    return (
                      <tr key={member.userId} className="border-b border-white/5 hover:bg-white/5">
                        <td className="py-3 px-4">
                          <span className="text-[#118bdd] font-mono">{member.userId}</span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${generateAvatarColor(member.username)}`}>
                              {getInitials(memberUser?.fullName || member.username)}
                            </div>
                            <span className="text-white">{memberUser?.fullName || member.username}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="border-[#118bdd] text-[#118bdd]">
                            Level {relativeLevel}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          {(memberUser?.isActive ?? member.isActive) ? (
                            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                              Active
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                              Inactive
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4 text-white/60">
                          {member.position === 0 ? 'Left' : 'Right'}
                        </td>
                        <td className="py-3 px-4 text-white/60">
                          {memberUser ? new Date(memberUser.createdAt).toLocaleDateString() : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredDownline.length === 0 && (
                <div className="text-center py-8 text-white/50">
                  {downline.length === 0 ? 'No downline members yet' : 'No members match your search or filters'}
                </div>
              )}
              {filteredDownline.length > visibleDownline.length && (
                <div className="py-4 text-center">
                  {(() => {
                    const remaining = Math.max(0, filteredDownline.length - visibleDownline.length);
                    const loadCount = Math.min(DOWNLINE_CHUNK_SIZE, remaining);
                    return (
                  <Button
                    variant="outline"
                    className="border-[#118bdd]/40 text-[#8fcfff] hover:bg-[#118bdd]/10"
                    onClick={() => setDownlineVisibleCount((prev) => Math.min(prev + DOWNLINE_CHUNK_SIZE, filteredDownline.length))}
                  >
                    Show more {loadCount} user{loadCount === 1 ? '' : 's'}
                  </Button>
                    );
                  })()}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Node Details Modal */}
      {selectedNode && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedNode(null)}
        >
          <Card
            className="glass border-white/10 bg-[#111827] max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader>
              <CardTitle className="text-white">Member Details</CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const memberUser = usersByUserId.get(selectedNode.userId);
                const memberTotalEarnings = Database.getMaxTotalReceivedByPublicUserId(selectedNode.userId);
                const memberStats = Database.getTeamCounts(selectedNode.userId);
                return (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className={`w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold ${generateAvatarColor(selectedNode.userId)}`}>
                        {getInitials(memberUser?.fullName || selectedNode.username)}
                      </div>
                      <div>
                        <p className="text-xl font-bold text-white">{memberUser?.fullName || selectedNode.username}</p>
                        <p className="text-[#118bdd] font-mono">ID: {selectedNode.userId}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Status</p>
                        <Badge className={(memberUser?.isActive ?? selectedNode.isActive) ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}>
                          {(memberUser?.isActive ?? selectedNode.isActive) ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <div className="p-3 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Level</p>
                        <p className="text-lg font-bold text-white">
                          {memberUser ? Database.getCurrentMatrixLevel(memberUser.id) : selectedNode.level}
                        </p>
                      </div>
                      <div className="p-3 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Left Team</p>
                        <p className="text-lg font-bold text-white">{memberStats.left}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Right Team</p>
                        <p className="text-lg font-bold text-white">{memberStats.right}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">My Referrals</p>
                        <p className="text-lg font-bold text-white">{memberUser ? Database.getEffectiveDirectCount(memberUser) : 0}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Total Earnings</p>
                        <p className="text-lg font-bold text-emerald-400">{formatCurrency(memberTotalEarnings)}</p>
                      </div>
                    </div>

                    <Button
                      onClick={() => setSelectedNode(null)}
                      className="w-full btn-primary"
                    >
                      Close
                    </Button>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      )}
      <MobileBottomNav />
    </div>
  );
}
