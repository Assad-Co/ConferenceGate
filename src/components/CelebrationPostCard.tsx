import React from 'react';
import { ThumbsUp, MessageSquare, Share2 } from 'lucide-react';
import { CelebrationKind, Post } from '../types';
import { KudosRibbon, SponsorshipAcceptedIllustration, BestOrganizerIllustration } from './celebrationIllustrations';
import { Logo } from './Logo';

interface CelebrationTheme {
  image?: string;
  Illustration?: React.ElementType;
  label: string;
  wash: string;
  ribbon: string;
  ribbonDark: string;
  pill: string;
}

const THEME: Record<CelebrationKind, CelebrationTheme> = {
  'abstract-accepted': {
    image: '/kudos/abstract-accepted.jpg',
    label: 'Abstract Accepted',
    wash: 'from-blue-50 via-white to-slate-50',
    ribbon: '#2563eb',
    ribbonDark: '#1d4ed8',
    pill: 'bg-blue-50 text-blue-700',
  },
  'reviewer-milestone': {
    image: '/kudos/reviewer-milestone.jpg',
    label: 'Review Milestone',
    wash: 'from-violet-50 via-white to-slate-50',
    ribbon: '#7c3aed',
    ribbonDark: '#6d28d9',
    pill: 'bg-violet-50 text-violet-700',
  },
  'committee-appointment': {
    image: '/kudos/committee-appointment.jpg',
    label: 'Committee Appointment',
    wash: 'from-teal-50 via-white to-slate-50',
    ribbon: '#0d9488',
    ribbonDark: '#0f766e',
    pill: 'bg-teal-50 text-teal-700',
  },
  'sponsorship-accepted': {
    Illustration: SponsorshipAcceptedIllustration,
    label: 'Sponsorship Confirmed',
    wash: 'from-emerald-50 via-white to-slate-50',
    ribbon: '#059669',
    ribbonDark: '#047857',
    pill: 'bg-emerald-50 text-emerald-700',
  },
  'best-organizer': {
    Illustration: BestOrganizerIllustration,
    label: 'Conference Gate Recognition',
    wash: 'from-amber-50 via-white to-slate-50',
    ribbon: '#d97706',
    ribbonDark: '#b45309',
    pill: 'bg-amber-50 text-amber-700',
  },
  achievement: {
    image: '/kudos/achievement.jpg',
    label: 'Professional Achievement',
    wash: 'from-sky-50 via-white to-slate-50',
    ribbon: '#0284c7',
    ribbonDark: '#0369a1',
    pill: 'bg-sky-50 text-sky-700',
  },
};

export const CelebrationPostCard: React.FC<{ post: Post }> = ({ post }) => {
  const kind = post.celebrationKind || 'abstract-accepted';
  const theme = THEME[kind];
  const { Illustration } = theme;

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
      <div className={`relative bg-gradient-to-br ${theme.wash} overflow-hidden flex flex-col items-center pt-4 pb-5 gap-2`}>
        {!theme.image && (
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)',
              backgroundSize: '18px 18px',
              color: '#0f172a',
            }}
          />
        )}

        <div className="relative">
          <KudosRibbon color={theme.ribbon} dark={theme.ribbonDark} />
        </div>

        <div className="relative">
          {theme.image ? (
            <img
              src={theme.image}
              alt={theme.label}
              className="h-28 sm:h-32 w-auto rounded-lg shadow-sm object-cover"
            />
          ) : Illustration ? (
            <Illustration />
          ) : null}
          {theme.image && (
            <div
              className="absolute bottom-1 right-1 opacity-60"
              style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))' }}
            >
              <Logo className="h-3.5 w-auto" />
            </div>
          )}
        </div>

        {!theme.image && (
          <div className="absolute bottom-2.5 right-2.5 opacity-50">
            <Logo className="h-3.5 w-auto" />
          </div>
        )}

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
