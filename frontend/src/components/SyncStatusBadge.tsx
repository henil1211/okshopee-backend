import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CloudOff, Loader2, RefreshCw } from 'lucide-react';
import Database, { type RemoteSyncStatus } from '@/db';
import { useAuthStore } from '@/store';

const HIDDEN_ROUTES = new Set([
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/about-us',
  '/contact-us',
  '/privacy-policy',
  '/terms-and-conditions',
  '/disclaimer',
  '/refund-policy'
]);

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return 'unknown';
  const diffMs = Math.max(0, Date.now() - time);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function SyncStatusBadge() {
  const location = useLocation();
  const { isAuthenticated } = useAuthStore();
  const [status, setStatus] = useState<RemoteSyncStatus>(() => Database.getRemoteSyncStatus());

  useEffect(() => Database.subscribeRemoteSyncStatus(setStatus), []);

  const stateUi = status.state === 'syncing'
    ? {
        label: 'Syncing',
        borderClass: 'border-sky-400/35',
        bgClass: 'bg-sky-500/10',
        icon: <Loader2 className="h-5 w-5 animate-spin text-sky-300" />
      }
    : status.state === 'pending'
      ? {
          label: 'Pending',
          borderClass: 'border-amber-400/35',
          bgClass: 'bg-amber-500/10',
          icon: <RefreshCw className="h-5 w-5 text-amber-300 animate-spin" />
        }
      : status.state === 'offline'
        ? {
            label: 'Offline',
            borderClass: 'border-rose-400/35',
            bgClass: 'bg-rose-500/10',
            icon: <CloudOff className="h-5 w-5 text-rose-300" />
          }
        : null;

  if (!isAuthenticated) return null;
  if (HIDDEN_ROUTES.has(location.pathname)) return null;
  if (status.dirtyKeys <= 0) return null;

  const detailText = status.message || (status.state === 'synced' ? `Last sync ${formatRelativeTime(status.lastSuccessAt)}` : 'Sync in progress');

  if (!stateUi) return null; // hide when synced/idle

  return (
    <div
      className={`fixed right-4 bottom-40 md:bottom-20 z-[70] h-12 w-12 rounded-full border flex items-center justify-center backdrop-blur-md shadow-lg ${stateUi.bgClass} ${stateUi.borderClass}`}
      title={`${stateUi.label} | ${detailText}${status.dirtyKeys > 0 ? ` (${status.dirtyKeys} pending)` : ''}`}
    >
      {stateUi.icon}
    </div>
  );
}
