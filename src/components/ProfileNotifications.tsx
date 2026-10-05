import React, { useMemo, useState } from 'react';
import {
  Award,
  BellRing,
  Briefcase,
  Calendar,
  CheckCheck,
  FileText,
  MessageCircle,
  Search,
  UserPlus,
  ChevronRight,
} from 'lucide-react';
import { NotificationItem } from '../types';

const TYPE_META: Record<
  NotificationItem['type'],
  { icon: React.ElementType; bg: string; text: string; label: string }
> = {
  abstract: { icon: FileText, bg: 'bg-blue-100', text: 'text-blue-700', label: 'Abstracts' },
  invitation: { icon: UserPlus, bg: 'bg-violet-100', text: 'text-violet-700', label: 'Invitations' },
  review: { icon: Award, bg: 'bg-amber-100', text: 'text-amber-700', label: 'Reviews' },
  sponsorship: { icon: Briefcase, bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Sponsorship' },
  agenda: { icon: Calendar, bg: 'bg-sky-100', text: 'text-sky-700', label: 'Agenda' },
  followup: { icon: MessageCircle, bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'Follow-up' },
  achievement: { icon: Award, bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Achievements' },
};

type NotificationFilter = 'all' | 'unread' | NotificationItem['type'];

interface ProfileNotificationsProps {
  notifications: NotificationItem[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onOpenNotification: (notification: NotificationItem) => void;
}

export const ProfileNotifications: React.FC<ProfileNotificationsProps> = ({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onOpenNotification,
}) => {
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [query, setQuery] = useState('');
  const [unreadFirst, setUnreadFirst] = useState(true);

  const unreadCount = notifications.filter((notification) => !notification.read).length;

  const typeCounts = useMemo(() => {
    const counts = {} as Partial<Record<NotificationItem['type'], number>>;
    for (const notification of notifications) {
      counts[notification.type] = (counts[notification.type] || 0) + 1;
    }
    return counts;
  }, [notifications]);

  const visibleNotifications = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = notifications.filter((notification) => {
      if (filter === 'unread' && notification.read) return false;
      if (filter !== 'all' && filter !== 'unread' && notification.type !== filter) return false;
      if (!term) return true;
      return [notification.title, notification.message, notification.timestamp, TYPE_META[notification.type].label]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term);
    });

    if (!unreadFirst) return filtered;
    return [...filtered].sort((left, right) => Number(left.read) - Number(right.read));
  }, [filter, notifications, query, unreadFirst]);

  const filterOptions: Array<{ value: NotificationFilter; label: string; count: number }> = [
    { value: 'all', label: 'All', count: notifications.length },
    { value: 'unread', label: 'Unread', count: unreadCount },
    ...(
      Object.keys(TYPE_META) as NotificationItem['type'][]
    ).map((type) => ({ value: type, label: TYPE_META[type].label, count: typeCounts[type] || 0 })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <BellRing className="w-4 h-4 text-blue-600" />
            Notifications
          </h3>
          <p className="text-[11px] text-slate-500">
            {unreadCount > 0
              ? `${unreadCount} unread of ${notifications.length} total`
              : notifications.length > 0
                ? 'You’re all caught up'
                : 'No notifications yet'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-[11px] rounded-full cursor-pointer transition-colors"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark all as read
          </button>
        )}
      </div>

      {notifications.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <label className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search notifications..."
                className="w-full bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden"
              />
            </label>
            <button
              type="button"
              onClick={() => setUnreadFirst((value) => !value)}
              className={
                unreadFirst
                  ? 'px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-200 text-[11px] font-bold text-blue-700'
                  : 'px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-[11px] font-bold text-slate-600 hover:text-blue-700'
              }
            >
              Unread first {unreadFirst ? '✓' : ''}
            </button>
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {filterOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                className={
                  filter === option.value
                    ? 'px-3 py-1.5 rounded-full bg-blue-900 text-white text-[10px] font-bold whitespace-nowrap'
                    : 'px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-slate-600 hover:border-blue-200 hover:text-blue-700 text-[10px] font-bold whitespace-nowrap'
                }
              >
                {option.label} ({option.count})
              </button>
            ))}
          </div>
        </div>
      )}

      {visibleNotifications.length === 0 ? (
        <div className="py-12 px-5 border border-dashed border-slate-200 rounded-2xl text-center space-y-2">
          <BellRing className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-sm font-bold text-slate-600">
            {notifications.length === 0 ? 'Nothing needs your attention yet' : 'No notifications match this view'}
          </p>
          <p className="text-[11px] text-slate-400 max-w-md mx-auto">
            {notifications.length === 0
              ? 'Conference submissions, invitations, review activity, sponsorship updates and follow-ups will appear here when they happen.'
              : 'Try another notification category or clear your search.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleNotifications.map((notification) => {
            const meta = TYPE_META[notification.type];
            const Icon = meta.icon;
            return (
              <button
                key={notification.id}
                type="button"
                onClick={() => {
                  if (!notification.read) onMarkRead(notification.id);
                  onOpenNotification(notification);
                }}
                className={`w-full text-left p-4 rounded-2xl border flex items-start gap-3 transition-colors cursor-pointer ${
                  notification.read
                    ? 'bg-white border-slate-200 hover:bg-slate-50'
                    : 'bg-blue-50/40 border-blue-200 hover:bg-blue-50'
                }`}
                title="Open related ConferenceGate workspace"
              >
                <span className={`w-9 h-9 rounded-xl ${meta.bg} ${meta.text} flex items-center justify-center shrink-0`}>
                  <Icon className="w-4.5 h-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-xs text-slate-900">{notification.title}</span>
                    {!notification.read && <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />}
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${meta.bg} ${meta.text}`}>
                      {meta.label}
                    </span>
                    <span className={`text-[9px] font-bold ${notification.read ? 'text-slate-400' : 'text-blue-600'}`}>
                      {notification.read ? 'Read' : 'Unread'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed mt-1">{notification.message}</p>
                  <span className="text-[10px] text-slate-400 font-medium mt-1.5 block">{notification.timestamp}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-2" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
