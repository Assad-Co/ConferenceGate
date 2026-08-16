import React, { useState } from 'react';
import {
  MessageSquare,
  ThumbsUp,
  Share2,
  Send,
  CheckCircle2,
  Award,
  PartyPopper,
  Megaphone,
  FileText,
  Mic,
  Briefcase,
  Image as ImageIcon,
  MapPin,
  MoreHorizontal,
  ShieldCheck,
  Flame,
  Eye,
  Repeat2,
  Bookmark,
  X,
} from 'lucide-react';
import { Post, UserProfile, PostAuthor } from '../types';
import { CelebrationPostCard } from './CelebrationPostCard';
import { ReactionType, REACTION_META, reactionCountKey } from './reactionMeta';
import { formatCompactCount } from '../utils/format';

interface CommunityFeedProps {
  posts?: Post[];
  onAddPost: (postText: string) => void;
  userProfile?: UserProfile;
  onOpenProfile?: (author: PostAuthor) => void;
}

const POST_TYPE_META: Record<
  Exclude<Post['postType'], 'celebration'>,
  { icon: React.ElementType; label: string; badge: string }
> = {
  announcement: { icon: Megaphone, label: 'Announcement', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  achievement: { icon: Award, label: 'Achievement', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  cfp: { icon: FileText, label: 'Call for Papers', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  speaker: { icon: Mic, label: 'Speaker Announcement', badge: 'bg-violet-50 text-violet-700 border-violet-200' },
  sponsorship: { icon: Briefcase, label: 'Sponsorship', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  review: { icon: CheckCircle2, label: 'Peer Review', badge: 'bg-teal-50 text-teal-700 border-teal-200' },
};

export const CommunityFeed: React.FC<CommunityFeedProps> = ({
  posts = [],
  onAddPost,
  userProfile,
  onOpenProfile,
}) => {
  const [newPostText, setNewPostText] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [userReactions, setUserReactions] = useState<Record<string, ReactionType | null>>({});
  const [reactionPickerOpenId, setReactionPickerOpenId] = useState<string | null>(null);
  const [expandedPostIds, setExpandedPostIds] = useState<Record<string, boolean>>({});
  const [commentBoxOpenIds, setCommentBoxOpenIds] = useState<Record<string, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [localComments, setLocalComments] = useState<Record<string, string[]>>({});
  const [savedPostIds, setSavedPostIds] = useState<Record<string, boolean>>({});
  const [repostedPostIds, setRepostedPostIds] = useState<Record<string, boolean>>({});
  const [analyticsOpenId, setAnalyticsOpenId] = useState<string | null>(null);

  const composerAvatar = userProfile?.avatar || 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=100&q=80';
  const composerName = userProfile?.name || 'You';

  const handleSubmitPost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPostText.trim()) return;
    onAddPost(newPostText);
    setNewPostText('');
    setComposerOpen(false);
  };

  const toggleReaction = (postId: string, type: ReactionType) => {
    setUserReactions((prev) => ({ ...prev, [postId]: prev[postId] === type ? null : type }));
    setReactionPickerOpenId(null);
  };

  const toggleComments = (postId: string) => {
    setCommentBoxOpenIds((prev) => ({ ...prev, [postId]: !prev[postId] }));
  };

  const toggleSave = (postId: string) => {
    setSavedPostIds((prev) => ({ ...prev, [postId]: !prev[postId] }));
  };

  const toggleRepost = (postId: string) => {
    setRepostedPostIds((prev) => ({ ...prev, [postId]: !prev[postId] }));
  };

  const handleAddComment = (postId: string) => {
    const text = (commentDrafts[postId] || '').trim();
    if (!text) return;
    setLocalComments((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), text] }));
    setCommentDrafts((prev) => ({ ...prev, [postId]: '' }));
  };

  const regularPosts = (posts || []).filter((p) => p.postType !== 'celebration');
  const totalReactionsThisWeek = regularPosts.reduce(
    (sum, p) => sum + (p.reactions?.likes || 0) + (p.reactions?.celebrates || 0) + (p.reactions?.insightful || 0) + (p.reactions?.kudos || 0),
    0
  );

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="bg-blue-50 rounded-2xl border border-blue-100 p-6 shadow-xs space-y-3">
        <div className="space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
            Verified Activity Feed
          </span>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            Conference Community & Discussions
          </h1>
          <p className="text-xs text-slate-500">
            Unlike general social feeds, every post on Conference Gate is backed by verified conference presentations, accepted abstracts, keynote talks, or committee updates.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-blue-200 rounded-full text-[10px] font-bold text-blue-700">
            <Flame className="w-3 h-3 text-orange-500" />
            {totalReactionsThisWeek}+ reactions this week
          </span>
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-blue-200 rounded-full text-[10px] font-bold text-blue-700">
            <ShieldCheck className="w-3 h-3 text-emerald-600" />
            100% Verified Professional Posts
          </span>
        </div>
      </div>

      {/* Post Composer */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <form onSubmit={handleSubmitPost}>
          <div className="p-4 flex items-center gap-3">
            <img src={composerAvatar} alt={composerName} className="w-11 h-11 rounded-full object-cover shrink-0 ring-2 ring-blue-500/15" />
            {composerOpen ? (
              <div className="flex-1 text-xs">
                <div className="font-bold text-slate-900">{composerName}</div>
                <div className="text-[10px] text-slate-400">Post to Conference Gate · Verified Network</div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setComposerOpen(true)}
                className="flex-1 text-left px-4 py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-full text-xs text-slate-500 font-medium transition-colors cursor-pointer"
              >
                Start a post — announce paper acceptance, share slides, or ask a technical question...
              </button>
            )}
          </div>

          {composerOpen && (
            <div className="px-4 pb-4 space-y-3">
              <textarea
                autoFocus
                rows={4}
                value={newPostText}
                onChange={(e) => setNewPostText(e.target.value)}
                placeholder="Announce paper acceptance, share session slides, or ask technical questions..."
                className="w-full p-3 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-xs focus:outline-hidden leading-relaxed"
              ></textarea>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1">
                  <span className="p-2 rounded-lg text-slate-400" title="Add photo (coming soon)">
                    <ImageIcon className="w-4 h-4" />
                  </span>
                  <span className="p-2 rounded-lg text-slate-400" title="Attach document (coming soon)">
                    <FileText className="w-4 h-4" />
                  </span>
                  <span className="p-2 rounded-lg text-slate-400" title="Tag a conference (coming soon)">
                    <MapPin className="w-4 h-4" />
                  </span>
                  <span className="p-2 rounded-lg text-slate-400" title="Celebrate a milestone (coming soon)">
                    <PartyPopper className="w-4 h-4" />
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setComposerOpen(false);
                      setNewPostText('');
                    }}
                    className="px-3 py-2 text-slate-500 hover:text-slate-800 font-bold text-xs rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!newPostText.trim()}
                    className="px-5 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-full shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Post</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </form>
      </div>

      {/* Posts List */}
      <div className="space-y-4">
        {(posts || []).map((post) => {
          if (post.postType === 'celebration') {
            return <CelebrationPostCard key={post.id} post={post} onOpenProfile={onOpenProfile} />;
          }

          const typeMeta = POST_TYPE_META[post.postType as Exclude<Post['postType'], 'celebration'>];
          const TypeIcon = typeMeta?.icon || Megaphone;

          const userReaction = userReactions[post.id];
          const baseReaction = post.userReaction || null;
          const netDelta = userReaction === undefined ? 0 : (userReaction ? 1 : 0) - (baseReaction ? 1 : 0);
          const activeReaction = userReaction === undefined ? baseReaction : userReaction;

          const reactionCounts = { ...post.reactions };
          if (netDelta !== 0 && activeReaction) {
            reactionCounts[
              activeReaction === 'like' ? 'likes' : activeReaction === 'celebrate' ? 'celebrates' : activeReaction
            ] += netDelta;
          }
          const totalReactions =
            (reactionCounts.likes || 0) + (reactionCounts.celebrates || 0) + (reactionCounts.insightful || 0) + (reactionCounts.kudos || 0);
          const presentReactions = (Object.keys(REACTION_META) as ReactionType[]).filter(
            (t) => (reactionCounts as any)[t === 'like' ? 'likes' : t === 'celebrate' ? 'celebrates' : t] > 0
          );

          const isLong = post.content.length > 220;
          const isExpanded = !!expandedPostIds[post.id];
          const displayedContent = isLong && !isExpanded ? `${post.content.slice(0, 220)}…` : post.content;

          const activeMeta = activeReaction ? REACTION_META[activeReaction] : null;

          const isSaved = !!savedPostIds[post.id];
          const isReposted = !!repostedPostIds[post.id];
          const repostsCount = (post.repostsCount || 0) + (isReposted ? 1 : 0);
          const impressions = post.impressions ?? (totalReactions + post.commentsCount) * 9 + 200;

          return (
            <div key={post.id} className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-4 space-y-3">
                {/* Author Bar */}
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
                    <img src={post.authorAvatar} alt={post.authorName} className="w-11 h-11 rounded-full object-cover ring-2 ring-blue-500/15 shrink-0" />
                    <div className="text-xs">
                      <div className="font-bold text-slate-900 flex items-center gap-1 group-hover/author:text-blue-700 transition-colors">
                        <span>{post.authorName}</span>
                        <Award className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                      <div className="text-slate-500">{post.authorTitle} • {post.authorOrg}</div>
                      <div className="text-slate-400 text-[10px] font-medium">{post.timestamp}</div>
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggleSave(post.id)}
                      className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                        isSaved ? 'text-blue-600' : 'text-slate-300 hover:text-slate-500'
                      }`}
                      title={isSaved ? 'Saved' : 'Save post'}
                    >
                      <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
                    </button>
                    <button className="p-1.5 text-slate-300 hover:text-slate-500 rounded-lg cursor-pointer" title="More">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Post Type + Conference Badges */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {typeMeta && (
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${typeMeta.badge}`}
                    >
                      <TypeIcon className="w-3 h-3" />
                      {typeMeta.label}
                    </span>
                  )}
                  {post.conferenceBadge && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full text-[10px] font-bold">
                      <MapPin className="w-3 h-3" />
                      {post.conferenceBadge}
                    </span>
                  )}
                </div>

                {/* Content */}
                <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
                  {displayedContent}
                  {isLong && (
                    <button
                      onClick={() => setExpandedPostIds((prev) => ({ ...prev, [post.id]: !isExpanded }))}
                      className="ml-1 text-blue-600 font-bold hover:underline cursor-pointer"
                    >
                      {isExpanded ? 'See less' : 'See more'}
                    </button>
                  )}
                </p>
              </div>

              {/* Reaction Summary */}
              {(totalReactions > 0 || post.commentsCount > 0 || repostsCount > 0) && (
                <div className="px-4 pb-2 flex items-center justify-between text-[11px] text-slate-500">
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
                    {post.commentsCount > 0 && (
                      <button
                        onClick={() => toggleComments(post.id)}
                        className="font-semibold hover:underline cursor-pointer"
                      >
                        {post.commentsCount + (localComments[post.id]?.length || 0)} comments
                      </button>
                    )}
                    <span className="text-slate-300">•</span>
                    <button
                      onClick={() => setAnalyticsOpenId(post.id)}
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
              {analyticsOpenId === post.id && (
                <div className="mx-4 mb-3 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-900 flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5 text-blue-600" />
                      Post Impressions
                    </span>
                    <button
                      onClick={() => setAnalyticsOpenId(null)}
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
                      <div className="text-sm font-extrabold text-slate-900">
                        {post.commentsCount + (localComments[post.id]?.length || 0)}
                      </div>
                      <div className="text-[9px] text-slate-500 font-semibold uppercase">Comments</div>
                    </div>
                    <div className="bg-white rounded-lg border border-slate-200 py-2">
                      <div className="text-sm font-extrabold text-slate-900">{repostsCount}</div>
                      <div className="text-[9px] text-slate-500 font-semibold uppercase">Reposts</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="px-1 border-t border-slate-100 flex items-center text-xs text-slate-500 font-semibold">
                <div
                  className="relative flex-1"
                  onMouseEnter={() => setReactionPickerOpenId(post.id)}
                  onMouseLeave={() => setReactionPickerOpenId(null)}
                >
                  {reactionPickerOpenId === post.id && (
                    <div className="absolute bottom-full left-0 mb-1 bg-white border border-slate-200 rounded-full shadow-lg p-1.5 flex items-center gap-1 z-10">
                      {(Object.keys(REACTION_META) as ReactionType[]).map((t) => {
                        const meta = REACTION_META[t];
                        const Icon = meta.icon;
                        return (
                          <button
                            key={t}
                            onClick={() => toggleReaction(post.id, t)}
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
                    onClick={() => toggleReaction(post.id, activeReaction || 'like')}
                    className={`w-full py-3 flex items-center justify-center gap-1 cursor-pointer rounded-lg transition-colors ${
                      activeReaction ? activeMeta?.color : 'hover:text-blue-600'
                    }`}
                  >
                    {activeMeta ? <activeMeta.icon className="w-4 h-4 fill-current" /> : <ThumbsUp className="w-4 h-4" />}
                    <span>{activeMeta ? activeMeta.label : 'Like'}</span>
                  </button>
                </div>
                <button
                  onClick={() => toggleComments(post.id)}
                  className="flex-1 py-3 flex items-center justify-center gap-1 hover:text-blue-600 cursor-pointer rounded-lg transition-colors"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Comment</span>
                </button>
                <button
                  onClick={() => toggleRepost(post.id)}
                  className={`flex-1 py-3 flex items-center justify-center gap-1 cursor-pointer rounded-lg transition-colors ${
                    isReposted ? 'text-emerald-600' : 'hover:text-emerald-600'
                  }`}
                >
                  <Repeat2 className="w-4 h-4" />
                  <span>{isReposted ? 'Reposted' : 'Repost'}</span>
                </button>
                <button className="flex-1 py-3 flex items-center justify-center gap-1 hover:text-blue-600 cursor-pointer rounded-lg transition-colors">
                  <Share2 className="w-4 h-4" />
                  <span>Share</span>
                </button>
              </div>

              {/* Comment Box */}
              {commentBoxOpenIds[post.id] && (
                <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-3">
                  {(localComments[post.id] || []).map((c, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <img src={composerAvatar} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                      <div className="bg-slate-50 rounded-2xl px-3 py-2 text-[11px] text-slate-700 flex-1">
                        <span className="font-bold text-slate-900">{composerName} </span>
                        {c}
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <img src={composerAvatar} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                    <input
                      type="text"
                      value={commentDrafts[post.id] || ''}
                      onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddComment(post.id);
                        }
                      }}
                      placeholder="Add a comment..."
                      className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-full text-[11px] focus:outline-hidden"
                    />
                    <button
                      onClick={() => handleAddComment(post.id)}
                      disabled={!(commentDrafts[post.id] || '').trim()}
                      className="p-2 text-blue-600 hover:text-blue-800 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
