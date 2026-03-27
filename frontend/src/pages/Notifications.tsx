import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, CheckCheck, CheckCircle2, CircleAlert, Info, ShieldAlert } from 'lucide-react';

import { useAuthStore, useNotificationStore, useSyncRefreshKey } from '@/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import MobileBottomNav from '@/components/MobileBottomNav';
import type { Notification } from '@/types';

const getTypeIcon = (type: Notification['type']) => {
  switch (type) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    case 'warning':
      return <CircleAlert className="h-4 w-4 text-amber-400" />;
    case 'error':
      return <ShieldAlert className="h-4 w-4 text-red-400" />;
    case 'info':
    default:
      return <Info className="h-4 w-4 text-sky-400" />;
  }
};

export default function Notifications() {
  const navigate = useNavigate();
  const { user, impersonatedUser, isAuthenticated } = useAuthStore();
  const { notifications, unreadCount, loadNotifications, markAsRead } = useNotificationStore();
  const syncKey = useSyncRefreshKey();
  const displayUser = impersonatedUser || user;

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (!displayUser) return;
    loadNotifications(displayUser.id);
  }, [isAuthenticated, displayUser, loadNotifications, navigate, syncKey]);

  const sortedNotifications = useMemo(
    () => [...notifications].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [notifications]
  );

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead) {
      markAsRead(notification.id);
    }

    const ticketMatch = notification.message.match(/TKT-\d{8}-\w+/);
    if (ticketMatch && (notification.id.includes('support_reply') || notification.id.includes('support_status'))) {
      navigate(`/support?ticket=${ticketMatch[0]}`);
    }
  };

  const handleMarkAllRead = () => {
    sortedNotifications.forEach((notification) => {
      if (!notification.isRead) {
        markAsRead(notification.id);
      }
    });
  };

  if (!displayUser) return null;

  return (
    <div className="notifications-page min-h-screen bg-slate-50 pb-24 dark:bg-[#0a0e17] md:pb-0">
      <header className="glass sticky top-0 z-50 border-b border-slate-200/80 dark:border-white/5">
        <div className="mx-auto flex min-h-16 max-w-5xl items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8 sm:py-0">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/dashboard')}
              className="text-slate-500 hover:text-slate-900 dark:text-white/60 dark:hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</p>
              <p className="text-xs text-slate-500 dark:text-white/50">ID: {displayUser.userId}</p>
            </div>
          </div>
          {unreadCount > 0 && (
            <Badge className="border-red-500/30 bg-red-500/20 text-red-400">
              {unreadCount > 99 ? '99+' : unreadCount} unread
            </Badge>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 sm:py-8">
        <Card className="glass border-slate-200/80 dark:border-white/10">
        <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-slate-200/80 dark:border-white/10">
          <CardTitle className="text-base text-slate-900 dark:text-white">All Notifications</CardTitle>
          {unreadCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleMarkAllRead}
              className="border-[#118bdd]/40 text-[#118bdd] hover:bg-[#118bdd]/10"
            >
              <CheckCheck className="mr-2 h-4 w-4" />
              Mark all read
            </Button>
          )}
        </CardHeader>
          <CardContent className="p-0">
            {sortedNotifications.length === 0 ? (
              <div className="py-12 text-center">
                <Bell className="mx-auto mb-3 h-9 w-9 text-slate-300 dark:text-white/15" />
                <p className="text-sm text-slate-500 dark:text-white/50">No notifications yet</p>
              </div>
            ) : (
              sortedNotifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => handleNotificationClick(notification)}
                  className={`block w-full border-b border-slate-100 px-4 py-3 text-left transition-colors dark:border-white/5 ${
                    notification.isRead
                      ? 'bg-transparent hover:bg-slate-50 dark:hover:bg-white/5'
                      : 'bg-blue-50/60 hover:bg-blue-50 dark:bg-[#118bdd]/10 dark:hover:bg-[#118bdd]/15'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">
                      {getTypeIcon(notification.type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{notification.title}</p>
                        {!notification.isRead && (
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#118bdd]" />
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-600 dark:text-white/60">{notification.message}</p>
                      {notification.imageUrl && (
                        <img
                          src={notification.imageUrl}
                          alt={notification.title || 'Notification image'}
                          className="mt-2 max-h-48 w-full max-w-sm rounded-lg border border-slate-200 object-cover dark:border-white/10"
                          loading="lazy"
                        />
                      )}
                      <p className="mt-1 text-[11px] text-slate-400 dark:text-white/35">
                        {new Date(notification.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </main>

      <MobileBottomNav />
    </div>
  );
}
