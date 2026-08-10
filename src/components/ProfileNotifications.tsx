import React from 'react';
import { FileText, UserPlus, Award, Briefcase, Calendar, BellRing, CheckCheck, MessageCircle } from 'lucide-react';
import { NotificationItem } from '../types';

const TYPE_META: Record<NotificationItem['type'], { icon: React.ElementType; bg: string; text: string }> = {
  abstract: { icon: FileText, bg: 'bg-blue-100', text: 'text-blue-700' },
  invitation: { icon: UserPlus, bg: 'bg-violet-100', text: 'text-violet-700' },
  review: { icon: Award, bg: 'bg-amber-100', text: 'text-amber-700' },
  sponsorship: { icon: Briefcase, bg: 'bg-emerald-100', text: 'text-emerald-700' },
  agenda: { icon: Calendar, bg: 'bg-sky-100', text: 'text-sky-700' },
  followup: { icon: MessageCircle, bg: 'bg-indigo-100', text: 'text-indigo-700' },
};

interface ProfileNotificationsProps {
  notifications: NotificationItem[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}

export const ProfileNotifications: React.FC<ProfileNotificationsProps> = ({
  notifications,
  onMarkRead,
  onMarkAllRead,
}) => {
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <BellRing className="w-4 h-4 text-blue-600" />
            Notifications
          </h3>
          <p className="text-[11px] text-slate-500">
            {unreadCount > 0 ? `${unreadCount} unread of ${notifications.length} total` : 'You\'re all caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={onMarkAllRead}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-[11px] rounded-full cursor-pointer transition-colors"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark all as read
          </button>
        )}
      </div>

      <div className="space-y-2.5">
        {notifications.map((notif) => {
          const meta = TYPE_META[notif.type];
          const Icon = meta.icon;
          return (
            <button
              key={notif.id}
              onClick={() => onMarkRead(notif.id)}
              className={`w-full text-left p-4 rounded-2xl border flex items-start gap-3 transition-colors cursor-pointer ${
                notif.read ? 'bg-white border-slate-200' : 'bg-blue-50/40 border-blue-200 hover:bg-blue-50'
              }`}
            >
              <span className={`w-9 h-9 rounded-xl ${meta.bg} ${meta.text} flex items-center justify-center shrink-0`}>
                <Icon className="w-4.5 h-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs text-slate-900">{notif.title}</span>
                  {!notif.read && <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />}
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed mt-0.5">{notif.message}</p>
                <span className="text-[10px] text-slate-400 font-medium mt-1 block">{notif.timestamp}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
