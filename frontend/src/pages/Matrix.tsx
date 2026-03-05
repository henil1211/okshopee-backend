import { useEffect, useMemo, useState, useRef } from 'react';
import { useAuthStore, useMatrixStore } from '@/store';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Users, ArrowLeft, ZoomIn, ZoomOut, Maximize2, Minimize2,
  Circle, LogOut
} from 'lucide-react';
import { formatCurrency, getInitials, generateAvatarColor } from '@/utils/helpers';
import Database from '@/db';
import type { MatrixNode } from '@/types';
import MobileBottomNav from '@/components/MobileBottomNav';

interface TreeNodeProps {
  node: MatrixNode | null;
  onNodeClick: (node: MatrixNode) => void;
}

const TreeNode = ({ node, onNodeClick }: TreeNodeProps) => {
  if (!node) {
    return (
      <div className="flex flex-col items-center">
        <div className="w-12 h-12 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center">
          <Circle className="w-5 h-5 text-white/20" />
        </div>
        <span className="text-xs text-white/30 mt-1">Empty</span>
      </div>
    );
  }

  const user = Database.getUserByUserId(node.userId);

  return (
    <div className="flex flex-col items-center">
      <button
        onClick={() => onNodeClick(node)}
        className={`relative w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 ${node.isActive
            ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/30'
            : 'bg-gradient-to-br from-amber-500 to-amber-600 shadow-lg shadow-amber-500/30'
          } hover:scale-110`}
      >
        <span className="text-white font-bold text-sm">
          {getInitials(user?.fullName || node.username)}
        </span>
        {node.isActive && (
          <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-400 rounded-full border-2 border-[#0a0e17]" />
        )}
      </button>
      <span className="text-xs text-white/70 mt-2 max-w-[80px] truncate">{node.username}</span>
      <span className="text-xs text-white/40">ID: {node.userId}</span>
    </div>
  );
};

export default function Matrix() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuthStore();
  const { matrix, loadMatrix } = useMatrixStore();
  const [selectedNode, setSelectedNode] = useState<MatrixNode | null>(null);
  const [zoom, setZoom] = useState(1);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const matrixCardRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    loadMatrix();
  }, [isAuthenticated, navigate, loadMatrix]);

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 0.2, 2));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 0.2, 0.5));
  };

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

  const getUserDownline = (userId: string) => {
    return Database.getUserDownline(userId, matrixViewMaxLevels);
  };

  const getTeamCounts = (userId: string) => {
    return Database.getTeamCounts(userId);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const userNode = user ? matrix.find(m => m.userId === user.userId) : null;
  const downline = useMemo(() => {
    if (!user) return [] as MatrixNode[];
    return getUserDownline(user.userId);
  }, [user, matrix, matrixViewMaxLevels]);
  const teamStats = user ? getTeamCounts(user.userId) : { left: 0, right: 0, leftActive: 0, rightActive: 0 };
  const levelGroups = useMemo(() => {
    if (!userNode) return [] as Array<{ level: number; slots: Array<MatrixNode | null>; filled: number; capacity: number }>;

    const nodeMap = new Map(matrix.map((m) => [m.userId, m]));
    const slotViewMaxLevels = matrixViewMaxLevels;
    const groups: Array<{ level: number; slots: Array<MatrixNode | null>; filled: number; capacity: number }> = [];

    let currentSlots: Array<MatrixNode | null> = [
      userNode.leftChild ? (nodeMap.get(userNode.leftChild) || null) : null,
      userNode.rightChild ? (nodeMap.get(userNode.rightChild) || null) : null
    ];

    for (let level = 1; level <= slotViewMaxLevels; level++) {
      const capacity = 2 ** level;
      const slots = currentSlots.slice(0, capacity);
      while (slots.length < capacity) slots.push(null);

      const filled = slots.filter(Boolean).length;
      groups.push({ level, slots, filled, capacity });

      if (level === slotViewMaxLevels) break;
      const hasChildrenAhead = slots.some((slot) => !!(slot?.leftChild || slot?.rightChild));
      if (!hasChildrenAhead) break;

      const nextSlots: Array<MatrixNode | null> = [];
      for (const slot of slots) {
        if (!slot) {
          nextSlots.push(null, null);
          continue;
        }
        nextSlots.push(slot.leftChild ? (nodeMap.get(slot.leftChild) || null) : null);
        nextSlots.push(slot.rightChild ? (nodeMap.get(slot.rightChild) || null) : null);
      }
      currentSlots = nextSlots;
    }

    return groups;
  }, [userNode, matrix, matrixViewMaxLevels]);

  if (!user) return null;

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
                <span className="text-base sm:text-xl font-bold text-white">My Matrix</span>
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
              <p className="text-2xl font-bold text-white">{Database.getCurrentMatrixLevel(user.id)}</p>
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
        <Card ref={matrixCardRef} className="glass border-white/10 min-h-[480px] sm:min-h-[600px]">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
          <CardContent className="overflow-auto">
            <div
              ref={treeContainerRef}
              className="flex flex-col items-center py-8 transition-transform duration-300"
              style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
            >
              {userNode ? (
                <>
                  <div className="mb-8">
                    <p className="text-center text-white/60 mb-3">Your ID</p>
                    <TreeNode node={userNode} onNodeClick={setSelectedNode} />
                  </div>

                  <div className="w-full space-y-8">
                    {levelGroups.map((group) => (
                      <div key={group.level} className="space-y-3">
                        <div className="flex items-center justify-between border-b border-white/10 pb-2">
                          <p className="text-white/70 font-medium">Level {group.level}</p>
                          <Badge variant="outline" className="border-[#118bdd] text-[#118bdd]">
                            {group.filled}/{group.capacity} filled
                          </Badge>
                        </div>
                        <div className="overflow-x-auto">
                          <div className="flex items-start justify-center gap-5 min-w-max px-2">
                            {group.slots.map((node, idx) => (
                              <TreeNode
                                key={node ? `${node.userId}_${group.level}_${idx}` : `empty_${group.level}_${idx}`}
                                node={node}
                                onNodeClick={setSelectedNode}
                              />
                            ))}
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
          </CardContent>
        </Card>

        {/* Downline List */}
        <Card className="glass border-white/10 mt-8">
          <CardHeader>
            <CardTitle className="text-white">Downline Members (Up to {matrixViewMaxLevels} Levels)</CardTitle>
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
                  {downline.map((member) => {
                    const memberUser = Database.getUserByUserId(member.userId);
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
                          {member.isActive ? (
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
              {downline.length === 0 && (
                <div className="text-center py-8 text-white/50">
                  No downline members yet
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
                const memberUser = Database.getUserByUserId(selectedNode.userId);
                const memberWallet = Database.getWallet(memberUser?.id || '');
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
                        <Badge className={selectedNode.isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}>
                          {selectedNode.isActive ? 'Active' : 'Inactive'}
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
                        <p className="text-sm text-white/50">Direct Referrals</p>
                        <p className="text-lg font-bold text-white">{memberUser?.directCount || 0}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-[#1f2937]">
                        <p className="text-sm text-white/50">Total Earnings</p>
                        <p className="text-lg font-bold text-emerald-400">{formatCurrency(memberWallet?.totalReceived || 0)}</p>
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
