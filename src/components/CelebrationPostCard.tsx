import React from 'react';
import {
  ThumbsUp,
  MessageSquare,
  Share2,
  FileCheck2,
  Medal,
  Landmark,
  Handshake,
  Trophy,
  Star,
} from 'lucide-react';
import { CelebrationKind, Post } from '../types';

interface CelebrationTheme {
  icon: React.ElementType;
  label: string;
  wash: string;
  medal: string;
  ribbon: string;
  pill: string;
}

const THEME: Record<CelebrationKind, CelebrationTheme> = {
  'abstract-accepted': {
    icon: FileCheck2,
    label: 'Abstract Accepted',
    wash: 'from-blue-50 via-white to-slate-50',
    medal: 'from-blue-400 to-blue-600',
    ribbon: 'bg-blue-600',
    pill: 'bg-blue-50 text-blue-700',
  },
  'reviewer-milestone': {
    icon: Medal,
    label: 'Review Milestone',
    wash: 'from-violet-50 via-white to-slate-50',
    medal: 'from-violet-400 to-violet-600',
    ribbon: 'bg-violet-600',
    pill: 'bg-violet-50 text-violet-700',
  },
  'committee-appointment': {
    icon: Landmark,
    label: 'Committee Appointment',
    wash: 'from-teal-50 via-white to-slate-50',
    medal: 'from-teal-400 to-teal-600',
    ribbon: 'bg-teal-600',
    pill: 'bg-teal-50 text-teal-700',
  },
  'sponsorship-accepted': {
    icon: Handshake,
    label: 'Sponsorship Confirmed',
    wash: 'from-emerald-50 via-white to-slate-50',
    medal: 'from-emerald-400 to-emerald-600',
    ribbon: 'bg-emerald-600',
    pill: 'bg-emerald-50 text-emerald-700',
  },
  'best-organizer': {
    icon: Trophy,
    label: 'Conference Gate Recognition',
    wash: 'from-amber-50 via-white to-slate-50',
    medal: 'from-amber-400 to-amber-600',
    ribbon: 'bg-amber-600',
    pill: 'bg-amber-50 text-amber-700',
  },
  achievement: {
    icon: Star,
    label: 'Professional Achievement',
    wash: 'from-sky-50 via-white to-slate-50',
    medal: 'from-sky-400 to-sky-600',
    ribbon: 'bg-sky-600',
    pill: 'bg-sky-50 text-sky-700',
  },
};

export const CelebrationPostCard: React.FC<{ post: Post }> = ({ post }) => {
  const kind = post.celebrationKind || 'abstract-accepted';
  const theme = THEME[kind];
  const Icon = theme.icon;

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
      <div className={`relative h-44 bg-gradient-to-br ${theme.wash} overflow-hidden flex flex-col items-center justify-center gap-3`}>
        {/* Subtle dot-grid texture, never a competing color */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)',
            backgroundSize: '18px 18px',
            color: '#0f172a',
          }}
        />

        {/* Medal badge */}
        <div className="relative">
          {/* Ribbon tails */}
          <span
            className={`absolute top-9 left-1/2 w-3 h-8 ${theme.ribbon} opacity-80`}
            style={{
              transform: 'translateX(-14px) rotate(-16deg)',
              clipPath: 'polygon(0 0, 100% 0, 100% 78%, 50% 100%, 0 78%)',
            }}
          />
          <span
            className={`absolute top-9 left-1/2 w-3 h-8 ${theme.ribbon} opacity-80`}
            style={{
              transform: 'translateX(2px) rotate(16deg)',
              clipPath: 'polygon(0 0, 100% 0, 100% 78%, 50% 100%, 0 78%)',
            }}
          />
          {/* Soft glow */}
          <div className={`absolute inset-0 rounded-full bg-gradient-to-br ${theme.medal} blur-xl opacity-40 scale-110`} />
          {/* Medal face */}
          <div
            className={`relative w-16 h-16 rounded-full bg-gradient-to-br ${theme.medal} text-white flex items-center justify-center shadow-lg ring-4 ring-white`}
          >
            <Icon className="w-7 h-7" strokeWidth={2.25} />
          </div>
        </div>

        <div className="relative text-center space-y-1 px-6">
          <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${theme.pill}`}>
            {theme.label}
          </span>
          <div className="text-slate-900 font-bold text-sm leading-snug">
            {post.celebrationHeadline || theme.label}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <img src={post.authorAvatar} alt={post.authorName} className="w-10 h-10 rounded-full object-cover shrink-0" />
          <div className="min-w-0 text-xs">
            <div className="font-bold text-slate-900 truncate">{post.authorName}</div>
            <div className="text-slate-500 truncate">{post.authorTitle} · {post.authorOrg}</div>
            <div className="text-slate-400">{post.timestamp}</div>
          </div>
        </div>

        {post.conferenceBadge && (
          <div className="inline-block px-2.5 py-1 bg-slate-100 text-slate-700 rounded-md text-[11px] font-bold">
            {post.conferenceBadge}
          </div>
        )}

        <p className="text-sm text-slate-800 leading-relaxed">{post.content}</p>

        <div className="pt-3 border-t border-slate-100 flex items-center gap-6 text-xs text-slate-500 font-semibold">
          <button className="hover:text-blue-600 flex items-center gap-1.5 cursor-pointer">
            <ThumbsUp className="w-4 h-4" />
            <span>{post.reactions?.likes ?? 0} Likes</span>
          </button>
          <button className="hover:text-blue-600 flex items-center gap-1.5 cursor-pointer">
            <MessageSquare className="w-4 h-4" />
            <span>{post.commentsCount} Comments</span>
          </button>
          <button className="hover:text-blue-600 flex items-center gap-1.5 cursor-pointer">
            <Share2 className="w-4 h-4" />
            <span>Share</span>
          </button>
        </div>
      </div>
    </div>
  );
};
