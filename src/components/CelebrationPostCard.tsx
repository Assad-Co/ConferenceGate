import React from 'react';
import { ThumbsUp, MessageSquare, Share2, PartyPopper, Award, ShieldCheck, Briefcase, Trophy, FileCheck2 } from 'lucide-react';
import { CelebrationKind, Post } from '../types';

const THEME: Record<
  CelebrationKind,
  { icon: React.ElementType; badge: string; glow: string; label: string }
> = {
  'abstract-accepted': {
    icon: FileCheck2,
    badge: 'bg-blue-600',
    glow: 'from-blue-100 via-sky-50 to-indigo-100',
    label: 'Abstract Accepted',
  },
  'reviewer-milestone': {
    icon: Award,
    badge: 'bg-indigo-600',
    glow: 'from-indigo-100 via-blue-50 to-sky-100',
    label: 'Review Milestone',
  },
  'committee-appointment': {
    icon: ShieldCheck,
    badge: 'bg-sky-600',
    glow: 'from-sky-100 via-blue-50 to-indigo-100',
    label: 'Committee Appointment',
  },
  'sponsorship-accepted': {
    icon: Briefcase,
    badge: 'bg-blue-700',
    glow: 'from-blue-100 via-indigo-50 to-sky-100',
    label: 'Sponsorship Confirmed',
  },
  'best-organizer': {
    icon: Trophy,
    badge: 'bg-indigo-700',
    glow: 'from-indigo-100 via-sky-50 to-blue-100',
    label: 'Best Organizer',
  },
};

const CONFETTI = [
  { top: '12%', left: '8%', size: 10, color: 'bg-blue-400', rotate: 12 },
  { top: '22%', left: '85%', size: 8, color: 'bg-indigo-400', rotate: -18 },
  { top: '65%', left: '10%', size: 7, color: 'bg-sky-400', rotate: 30 },
  { top: '75%', left: '90%', size: 9, color: 'bg-emerald-400', rotate: -10 },
  { top: '15%', left: '45%', size: 6, color: 'bg-sky-300', rotate: 0 },
  { top: '80%', left: '55%', size: 8, color: 'bg-blue-300', rotate: 20 },
  { top: '40%', left: '5%', size: 5, color: 'bg-indigo-300', rotate: -25 },
  { top: '35%', left: '92%', size: 6, color: 'bg-emerald-300', rotate: 15 },
];

export const CelebrationPostCard: React.FC<{ post: Post }> = ({ post }) => {
  const kind = post.celebrationKind || 'abstract-accepted';
  const theme = THEME[kind];
  const Icon = theme.icon;

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
      <div className={`relative h-52 bg-gradient-to-br ${theme.glow} overflow-hidden`}>
        {CONFETTI.map((c, i) => (
          <span
            key={i}
            className={`absolute rounded-sm ${c.color} opacity-70`}
            style={{
              top: c.top,
              left: c.left,
              width: c.size,
              height: c.size * 2.2,
              transform: `rotate(${c.rotate}deg)`,
            }}
          />
        ))}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div
            className={`w-20 h-20 rounded-full ${theme.badge} text-white flex items-center justify-center shadow-lg ring-8 ring-white/60`}
          >
            <Icon className="w-10 h-10" />
          </div>
          <div className="flex items-center gap-1.5 text-slate-700 font-bold text-sm">
            <PartyPopper className="w-4 h-4 text-blue-600" />
            <span>{post.celebrationHeadline || theme.label}</span>
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
