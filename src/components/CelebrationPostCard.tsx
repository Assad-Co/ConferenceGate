import React, { useState } from 'react';
import { ThumbsUp, MessageSquare, Share2, Eye, Repeat2, Bookmark, X } from 'lucide-react';
import { CelebrationKind, Post, PostAuthor } from '../types';
import { KudosRibbon, SponsorshipAcceptedIllustration, BestOrganizerIllustration } from './celebrationIllustrations';
import { Logo } from './Logo';
import { ReactionType, REACTION_META, reactionCountKey } from './reactionMeta';
import { formatCompactCount } from '../utils/format';

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

export const CelebrationPostCard: React.FC<{ post: Post; onOpenProfile?: (author: PostAuthor) => void }> = ({
  post,
  onOpenProfile,
}) => {
  const kind = post.celebrationKind || 'abstract-accepted';
  const theme = THEME[kind];
  const { Illustration } = theme;

  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [userReaction, setUserReaction] = useState<ReactionType | null | undefined>(undefined);
  const [isSaved, setIsSaved] = useState(false);
  const [isReposted, setIsReposted] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  const baseReaction = (post.userReaction as ReactionType | undefined) || null;
  const netDelta = userReaction === undefined ? 0 : (userReaction ? 1 : 0) - (baseReaction ? 1 : 0);
  const activeReaction = userReaction === undefined ? baseReaction : userReaction;

  const reactionCounts = { ...post.reactions };
  if (netDelta !== 0 && activeReaction) {
    reactionCounts[reactionCountKey(activeReaction)] += netDelta;
  }
  const totalReactions =
    (reactionCounts.likes || 0) + (reactionCounts.celebrates || 0) + (reactionCounts.insightful || 0) + (reactionCounts.kudos || 0);
  const presentReactions = (Object.keys(REACTION_META) as ReactionType[]).filter(
    (t) => (reactionCounts as any)[reactionCountKey(t)] > 0
  );
  const activeMeta = activeReaction ? REACTION_META[activeReaction] : null;

  const toggleReaction = (type: ReactionType) => {
    setUserReaction((prev) => {
      const current = prev === undefined ? baseReaction : prev;
      return current === type ? null : type;
    });
    setReactionPickerOpen(false);
  };

  const repostsCount = (post.repostsCount || 0) + (isReposted ? 1 : 0);
  const impressions = post.impressions ?? (totalReactions + post.commentsCount) * 9 + 200;

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
              className="w-72 sm:w-80 h-auto rounded-lg shadow-sm object-cover"
            />
          ) : Illustration ? (
            <Illustration />
          ) : null}
          <div className="absolute bottom-1 right-1 bg-white/95 rounded px-1 py-0.5 shadow-sm">
            <Logo className="h-2 sm:h-2.5 w-auto" />
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
        <div className="flex items-start justify-between">
          <button
            onClick={() =>
              onOpenProfile?.({
                name: post.authorName,
                avatar: post.authorAvatar,
                title: post.authorTitle,
                org: post.authorOrg,
                userId: post.authorUserId,
              })
            }
            className="flex items-center gap-3 text-left cursor-pointer group/author"
          >
            <img src={post.authorAvatar} alt={post.authorName} className="w-10 h-10 rounded-full object-cover shrink-0" />
            <div className="min-w-0 text-xs">
              <div className="font-bold text-slate-900 truncate group-hover/author:text-blue-700 transition-colors">{post.authorName}</div>
              <div className="text-slate-500 truncate">{post.authorTitle} · {post.authorOrg}</div>
              <div className="text-slate-400">{post.timestamp}</div>
            </div>
          </button>
          <button
            onClick={() => setIsSaved((v) => !v)}
            className={`p-1.5 rounded-lg cursor-pointer transition-colors shrink-0 ${
              isSaved ? 'text-blue-600' : 'text-slate-300 hover:text-slate-500'
            }`}
            title={isSaved ? 'Saved' : 'Save post'}
          >
            <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
          </button>
        </div>

        {post.conferenceBadge && (
          <div className="inline-block px-2.5 py-1 bg-slate-100 text-slate-700 rounded-md text-[11px] font-bold">
            {post.conferenceBadge}
          </div>
        )}

        <p className="text-sm text-slate-800 leading-relaxed">{post.content}</p>

        {/* Reaction Summary */}
        {(totalReactions > 0 || post.commentsCount > 0 || repostsCount > 0) && (
          <div className="pt-2 flex items-center justify-between text-[11px] text-slate-500">
            <div className="flex items-center gap-1">
              {presentReactions.length > 0 && (
                <div className="flex items-center -space-x-1">
                  {presentReactions.slice(0, 3).map((t) => {
                    const meta = REACTION_META[t];
                    const Icon = meta.icon;
                    return (
                      <span
                        key={t}
                        className={`w-4 h-4 rounded-full ${meta.bg} ring-2 ring-white flex items-center justify-center`}
                      >
                        <Icon className="w-2.5 h-2.5 text-white" />
                      </span>
                    );
                  })}
                </div>
              )}
              {totalReactions > 0 && <span className="font-semibold">{totalReactions}</span>}
            </div>
            <div className="flex items-center gap-2.5">
              {repostsCount > 0 && <span className="font-semibold">{repostsCount} reposts</span>}
              {post.commentsCount > 0 && <span className="font-semibold">{post.commentsCount} comments</span>}
              <span className="text-slate-300">•</span>
              <button
                onClick={() => setAnalyticsOpen(true)}
                className="flex items-center gap-1 font-semibold hover:underline cursor-pointer"
                title="View impression analytics"
              >
                <Eye className="w-3 h-3" />
                {formatCompactCount(impressions)} impressions
              </button>
            </div>
          </div>
        )}

        {/* Impression Analytics Popover */}
        {analyticsOpen && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-900 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-blue-600" />
                Post Impressions
              </span>
              <button
                onClick={() => setAnalyticsOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="bg-white rounded-lg border border-slate-200 py-2">
                <div className="text-sm font-extrabold text-slate-900">{formatCompactCount(impressions)}</div>
                <div className="text-[9px] text-slate-500 font-semibold uppercase">Impressions</div>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 py-2">
                <div className="text-sm font-extrabold text-slate-900">{totalReactions}</div>
                <div className="text-[9px] text-slate-500 font-semibold uppercase">Reactions</div>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 py-2">
                <div className="text-sm font-extrabold text-slate-900">{post.commentsCount}</div>
                <div className="text-[9px] text-slate-500 font-semibold uppercase">Comments</div>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 py-2">
                <div className="text-sm font-extrabold text-slate-900">{repostsCount}</div>
                <div className="text-[9px] text-slate-500 font-semibold uppercase">Reposts</div>
              </div>
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-slate-100 flex items-center text-xs text-slate-500 font-semibold">
          <div
            className="relative flex-1"
            onMouseEnter={() => setReactionPickerOpen(true)}
            onMouseLeave={() => setReactionPickerOpen(false)}
          >
            {reactionPickerOpen && (
              <div className="absolute bottom-full left-0 mb-1 bg-white border border-slate-200 rounded-full shadow-lg p-1.5 flex items-center gap-1 z-10">
                {(Object.keys(REACTION_META) as ReactionType[]).map((t) => {
                  const meta = REACTION_META[t];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={t}
                      onClick={() => toggleReaction(t)}
                      title={meta.label}
                      className={`w-8 h-8 rounded-full ${meta.bg} flex items-center justify-center cursor-pointer hover:scale-110 transition-transform`}
                    >
                      <Icon className="w-4 h-4 text-white" />
                    </button>
                  );
                })}
              </div>
            )}
            <button
              onClick={() => toggleReaction(activeReaction || 'like')}
              className={`w-full py-1 flex items-center justify-center gap-1.5 cursor-pointer rounded-lg transition-colors ${
                activeReaction ? activeMeta?.color : 'hover:text-blue-600'
              }`}
            >
              {activeMeta ? <activeMeta.icon className="w-4 h-4 fill-current" /> : <ThumbsUp className="w-4 h-4" />}
              <span>{activeMeta ? activeMeta.label : 'Like'}</span>
            </button>
          </div>
          <button className="flex-1 py-1 flex items-center justify-center gap-1.5 hover:text-blue-600 cursor-pointer rounded-lg transition-colors">
            <MessageSquare className="w-4 h-4" />
            <span>Comment</span>
          </button>
          <button
            onClick={() => setIsReposted((v) => !v)}
            className={`flex-1 py-1 flex items-center justify-center gap-1.5 cursor-pointer rounded-lg transition-colors ${
              isReposted ? 'text-emerald-600' : 'hover:text-emerald-600'
            }`}
          >
            <Repeat2 className="w-4 h-4" />
            <span>{isReposted ? 'Reposted' : 'Repost'}</span>
          </button>
          <button className="flex-1 py-1 flex items-center justify-center gap-1.5 hover:text-blue-600 cursor-pointer rounded-lg transition-colors">
            <Share2 className="w-4 h-4" />
            <span>Share</span>
          </button>
        </div>
      </div>
    </div>
  );
};
