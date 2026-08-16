import React from 'react';
import { Eye, ThumbsUp, MessageSquare, Share2, Award, PartyPopper, Lightbulb, BarChart3, Sparkles } from 'lucide-react';
import { Post, UserProfile } from '../types';

const compact = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString();
};

const REACTION_META = {
  likes: { icon: ThumbsUp, label: 'Like', bar: 'bg-blue-600', text: 'text-blue-700' },
  kudos: { icon: Award, label: 'Kudos', bar: 'bg-violet-600', text: 'text-violet-700' },
  celebrates: { icon: PartyPopper, label: 'Celebrate', bar: 'bg-amber-500', text: 'text-amber-700' },
  insightful: { icon: Lightbulb, label: 'Insightful', bar: 'bg-yellow-400', text: 'text-yellow-700' },
} as const;

const StatTile: React.FC<{ icon: React.ElementType; label: string; value: number }> = ({ icon: Icon, label, value }) => (
  <div className="p-4 bg-white rounded-2xl border border-slate-200 space-y-2">
    <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
      <Icon className="w-4 h-4" />
    </span>
    <div className="text-xl font-extrabold text-slate-900">{compact(value)}</div>
    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</div>
  </div>
);

interface ProfileAnalyticsProps {
  userProfile: UserProfile;
  posts: Post[];
}

export const ProfileAnalytics: React.FC<ProfileAnalyticsProps> = ({ userProfile, posts }) => {
  const myPosts = posts.filter((p) => p.authorName === userProfile.name);

  if (myPosts.length === 0) {
    return (
      <div className="py-12 text-center space-y-2">
        <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 mx-auto flex items-center justify-center">
          <BarChart3 className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-bold text-slate-900">No engagement yet</h3>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">
          Share a paper acceptance, CFP alert, or milestone from your feed to start tracking impressions, reactions,
          and comments here.
        </p>
      </div>
    );
  }

  const summary = myPosts.reduce(
    (acc, p) => {
      acc.impressions += p.impressions || 0;
      acc.reactions += p.reactions.likes + p.reactions.celebrates + p.reactions.insightful + p.reactions.kudos;
      acc.comments += p.commentsCount;
      acc.reposts += p.repostsCount || 0;
      return acc;
    },
    { impressions: 0, reactions: 0, comments: 0, reposts: 0 }
  );

  const reactionBreakdown = (Object.keys(REACTION_META) as Array<keyof typeof REACTION_META>)
    .map((type) => ({ type, count: myPosts.reduce((sum, p) => sum + p.reactions[type], 0) }))
    .filter((r) => r.count > 0);
  const totalReactions = reactionBreakdown.reduce((sum, r) => sum + r.count, 0);

  const topPosts = [...myPosts].sort((a, b) => (b.impressions || 0) - (a.impressions || 0)).slice(0, 3);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-600" />
          Engagement Analytics
        </h3>
        <p className="text-[11px] text-slate-500">
          How your {myPosts.length} post{myPosts.length === 1 ? '' : 's'} on Conference Gate {myPosts.length === 1 ? 'is' : 'are'} performing
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile icon={Eye} label="Impressions" value={summary.impressions} />
        <StatTile icon={ThumbsUp} label="Reactions" value={summary.reactions} />
        <StatTile icon={MessageSquare} label="Comments" value={summary.comments} />
        <StatTile icon={Share2} label="Reposts" value={summary.reposts} />
      </div>

      {totalReactions > 0 && (
        <div className="p-5 bg-white rounded-2xl border border-slate-200 space-y-4">
          <h4 className="text-xs font-bold text-slate-900">Reaction Breakdown</h4>
          <span className="flex w-full h-3 rounded-full overflow-hidden gap-0.5">
            {reactionBreakdown.map((r) => (
              <span
                key={r.type}
                className={REACTION_META[r.type].bar}
                style={{ width: `${(r.count / totalReactions) * 100}%` }}
              />
            ))}
          </span>
          <div className="space-y-2">
            {reactionBreakdown.map((r) => {
              const meta = REACTION_META[r.type];
              const Icon = meta.icon;
              return (
                <div key={r.type} className="flex items-center justify-between text-[11px]">
                  <span className={`flex items-center gap-1.5 font-semibold ${meta.text}`}>
                    <Icon className="w-3.5 h-3.5" />
                    {meta.label}
                  </span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {r.count} <span className="text-slate-400 font-medium">({Math.round((r.count / totalReactions) * 100)}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="p-5 bg-white rounded-2xl border border-slate-200 space-y-4">
        <h4 className="text-xs font-bold text-slate-900">Top Performing Posts</h4>
        <div className="space-y-3">
          {topPosts.map((post, idx) => (
            <div key={post.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex gap-3">
              <span className="w-6 h-6 shrink-0 rounded-full bg-blue-100 text-blue-700 text-[11px] font-extrabold flex items-center justify-center">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {post.conferenceBadge && (
                    <span className="px-2 py-0.5 bg-white border border-slate-200 rounded-full text-[10px] font-bold text-slate-600">
                      {post.conferenceBadge}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-400 font-medium">{post.timestamp}</span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed line-clamp-2">{post.content}</p>
                <div className="flex items-center gap-4 pt-1 text-[11px] text-slate-500 font-semibold flex-wrap">
                  <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{compact(post.impressions || 0)}</span>
                  <span className="flex items-center gap-1">
                    <ThumbsUp className="w-3.5 h-3.5" />
                    {compact(post.reactions.likes + post.reactions.celebrates + post.reactions.insightful + post.reactions.kudos)}
                  </span>
                  <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" />{compact(post.commentsCount)}</span>
                  <span className="flex items-center gap-1"><Share2 className="w-3.5 h-3.5" />{compact(post.repostsCount || 0)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-start gap-2.5">
        <Sparkles className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-slate-500">
          Audience demographics (who's viewing your posts) require aggregated platform-wide tracking and aren't
          available yet for individual accounts.
        </p>
      </div>
    </div>
  );
};
