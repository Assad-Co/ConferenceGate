import React, { useState } from 'react';
import {
  MessageSquare,
  Share2,
  Send,
  Award,
  PartyPopper,
  Megaphone,
  FileText,
  Mic,
  Briefcase,
  Image as ImageIcon,
  MapPin,
  MoreHorizontal,
  Repeat2,
  Bookmark,
  CheckCircle2,
} from 'lucide-react';
import { Post, UserProfile, PostAuthor, Conference } from '../types';
import { PostComment } from '../api/posts';
import { CelebrationPostCard } from './CelebrationPostCard';
import { ReactionType, REACTION_META } from './reactionMeta';
import { ConferenceLink } from './ConferenceLink';
import { resolveAvatar } from '../utils/avatar';
import { useToast } from './Toast';

interface CommunityFeedProps {
  posts?: Post[];
  onAddPost: (postText: string) => Promise<void> | void;
  onReact: (postId: string, reaction: ReactionType) => void;
  onToggleRepost: (postId: string) => void;
  onToggleSave: (postId: string) => void;
  onFetchComments: (postId: string) => Promise<PostComment[]>;
  onAddComment: (postId: string, text: string) => Promise<void>;
  conferences?: Conference[];
  onSelectConference?: (conf: Conference) => void;
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
  onReact,
  onToggleRepost,
  onToggleSave,
  onFetchComments,
  onAddComment,
  conferences = [],
  onSelectConference = () => {},
  userProfile,
  onOpenProfile,
}) => {
  const [newPostText, setNewPostText] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [reactionPickerOpenId, setReactionPickerOpenId] = useState<string | null>(null);
  const [expandedPostIds, setExpandedPostIds] = useState<Record<string, boolean>>({});
  const [commentBoxOpenIds, setCommentBoxOpenIds] = useState<Record<string, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [loadedComments, setLoadedComments] = useState<Record<string, PostComment[]>>({});
  const [commentsLoading, setCommentsLoading] = useState<Record<string, boolean>>({});
  const [hiddenPostIds, setHiddenPostIds] = useState<Record<string, boolean>>({});
  const [moreMenuOpenId, setMoreMenuOpenId] = useState<string | null>(null);
  const { showToast } = useToast();

  const composerAvatar = userProfile?.avatar || 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=100&q=80';
  const composerName = userProfile?.name || 'You';

  const handleSubmitPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPostText.trim() || isPosting) return;
    setIsPosting(true);
    try {
      await onAddPost(newPostText);
      setNewPostText('');
      setComposerOpen(false);
    } catch (error) {
      showToast({
        type: 'info',
        title: "Couldn't post update",
        message:
          error instanceof Error
            ? error.message
            : 'Only conference-related posts, calls for papers, and abstract discussions are allowed.',
      });
    } finally {
      setIsPosting(false);
    }
  };

  const toggleComments = async (postId: string) => {
    const opening = !commentBoxOpenIds[postId];
    setCommentBoxOpenIds((prev) => ({ ...prev, [postId]: opening }));
    if (opening && !loadedComments[postId]) {
      setCommentsLoading((prev) => ({ ...prev, [postId]: true }));
      try {
        const comments = await onFetchComments(postId);
        setLoadedComments((prev) => ({ ...prev, [postId]: comments }));
      } catch {
        showToast({ type: 'info', title: "Couldn't load comments", message: 'Please try again.' });
      } finally {
        setCommentsLoading((prev) => ({ ...prev, [postId]: false }));
      }
    }
  };

  const handleSharePost = async (post: Post) => {
    const shareText = `${post.content}\n\n— ${post.authorName} on Conference Gate`;
    try {
      if (navigator.share) {
        await navigator.share({ text: shareText });
        return;
      }
      await navigator.clipboard.writeText(shareText);
      showToast({ type: 'success', title: 'Copied to clipboard', message: 'Post text copied — paste it anywhere to share.' });
    } catch {
      // User cancelled the native share sheet, or clipboard access was denied — no error needed.
    }
    setMoreMenuOpenId(null);
  };

  const handleHidePost = (postId: string) => {
    setHiddenPostIds((prev) => ({ ...prev, [postId]: true }));
    setMoreMenuOpenId(null);
    showToast({ type: 'success', title: 'Post hidden', message: "You won't see this post in your feed again." });
  };

  const handleAddComment = async (postId: string) => {
    const text = (commentDrafts[postId] || '').trim();
    if (!text) return;
    try {
      await onAddComment(postId, text);
      setCommentDrafts((prev) => ({ ...prev, [postId]: '' }));
      const comments = await onFetchComments(postId);
      setLoadedComments((prev) => ({ ...prev, [postId]: comments }));
    } catch (error) {
      showToast({
        type: 'info',
        title: "Couldn't post comment",
        message:
          error instanceof Error
            ? error.message
            : 'Comments must be about conferences, calls for papers, or abstracts.',
      });
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="bg-blue-50 rounded-2xl border border-blue-100 p-6 shadow-xs space-y-3">
        <div className="space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
            Community Activity Feed
          </span>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            Conference Community & Discussions
          </h1>
          <p className="text-xs text-slate-500">
            Only conference-related discussions are shown here: conferences, calls for papers, abstracts, submissions,
            programs, speakers, committees, venues, and related professional activity.
          </p>
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
                <div className="text-[10px] text-slate-400">Post to Conference Gate</div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setComposerOpen(true)}
                className="flex-1 text-left px-4 py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-full text-xs text-slate-500 font-medium transition-colors cursor-pointer"
              >
                Start a conference post — share a call for papers, abstract update, deadline, or program news...
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
                placeholder="Share conference news, a call for papers, abstract update, deadline, speaker, or program..."
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
                    disabled={!newPostText.trim() || isPosting}
                    className="px-5 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-full shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isPosting ? 'Checking…' : 'Post'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </form>
      </div>

      {/* Posts List */}
      {(posts || []).filter((post) => !hiddenPostIds[post.id]).length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 py-14 text-center space-y-2">
          <Megaphone className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-sm font-bold text-slate-500">No posts yet</p>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Be the first to share an update — a paper acceptance, a call for papers, or a technical question.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {(posts || []).filter((post) => !hiddenPostIds[post.id]).map((post) => {
            if (post.postType === 'celebration') {
              return (
                <CelebrationPostCard
                  key={post.id}
                  post={post}
                  onOpenProfile={onOpenProfile}
                  conferences={conferences}
                  onSelectConference={onSelectConference}
                  onReact={onReact}
                  onToggleRepost={onToggleRepost}
                  onToggleSave={onToggleSave}
                  onFetchComments={onFetchComments}
                  onAddComment={onAddComment}
                  composerAvatar={composerAvatar}
                />
              );
            }

            const typeMeta = POST_TYPE_META[post.postType as Exclude<Post['postType'], 'celebration'>];
            const TypeIcon = typeMeta?.icon || Megaphone;

            const activeReaction = post.userReaction || null;
            const reactionCounts = post.reactions;
            const totalReactions =
              (reactionCounts.likes || 0) + (reactionCounts.celebrates || 0) + (reactionCounts.insightful || 0) + (reactionCounts.kudos || 0);
            const presentReactions = (Object.keys(REACTION_META) as ReactionType[]).filter(
              (t) => (reactionCounts as any)[t === 'like' ? 'likes' : t === 'celebrate' ? 'celebrates' : t] > 0
            );

            const isLong = post.content.length > 220;
            const isExpanded = !!expandedPostIds[post.id];
            const displayedContent = isLong && !isExpanded ? `${post.content.slice(0, 220)}…` : post.content;

            const activeMeta = activeReaction ? REACTION_META[activeReaction] : null;

            const isSaved = !!post.isSaved;
            const isReposted = !!post.isReposted;
            const repostsCount = post.repostsCount || 0;
            const comments = loadedComments[post.id] || [];

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
                      <img src={resolveAvatar(post.authorAvatar, post.authorName)} alt={post.authorName} className="w-11 h-11 rounded-full object-cover ring-2 ring-blue-500/15 shrink-0" />
                      <div className="text-xs">
                        <div className="font-bold text-slate-900 flex items-center gap-1 group-hover/author:text-blue-700 transition-colors">
                          <span>{post.authorName}</span>
                        </div>
                        <div className="text-slate-500">{post.authorTitle} • {post.authorOrg}</div>
                        <div className="text-slate-400 text-[10px] font-medium">{post.timestamp}</div>
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => onToggleSave(post.id)}
                        className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                          isSaved ? 'text-blue-600' : 'text-slate-300 hover:text-slate-500'
                        }`}
                        title={isSaved ? 'Saved' : 'Save post'}
                      >
                        <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
                      </button>
                      <div className="relative">
                        <button
                          onClick={() => setMoreMenuOpenId((prev) => (prev === post.id ? null : post.id))}
                          className="p-1.5 text-slate-300 hover:text-slate-500 rounded-lg cursor-pointer"
                          title="More"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        {moreMenuOpenId === post.id && (
                          <div className="absolute right-0 top-full mt-1 z-10 w-40 bg-white rounded-xl border border-slate-200 shadow-md py-1">
                            <button
                              onClick={() => handleSharePost(post)}
                              className="w-full text-left px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              Copy post text
                            </button>
                            <button
                              onClick={() => handleHidePost(post.id)}
                              className="w-full text-left px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              Hide this post
                            </button>
                          </div>
                        )}
                      </div>
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
                      <ConferenceLink
                        conferences={conferences}
                        conferenceId={post.conferenceId || ''}
                        conferenceTitle={post.conferenceBadge}
                        onSelectConference={onSelectConference}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full text-[10px] font-bold"
                      />
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
                          {post.commentsCount} comments
                        </button>
                      )}
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
                              onClick={() => {
                                onReact(post.id, t);
                                setReactionPickerOpenId(null);
                              }}
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
                      onClick={() => onReact(post.id, activeReaction || 'like')}
                      className={`w-full py-3 flex items-center justify-center gap-1 cursor-pointer rounded-lg transition-colors ${
                        activeReaction ? activeMeta?.color : 'hover:text-blue-600'
                      }`}
                    >
                      {activeMeta ? <activeMeta.icon className="w-4 h-4 fill-current" /> : <Award className="w-4 h-4" />}
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
                    onClick={() => onToggleRepost(post.id)}
                    className={`flex-1 py-3 flex items-center justify-center gap-1 cursor-pointer rounded-lg transition-colors ${
                      isReposted ? 'text-emerald-600' : 'hover:text-emerald-600'
                    }`}
                  >
                    <Repeat2 className="w-4 h-4" />
                    <span>{isReposted ? 'Reposted' : 'Repost'}</span>
                  </button>
                  <button
                    onClick={() => handleSharePost(post)}
                    className="flex-1 py-3 flex items-center justify-center gap-1 hover:text-blue-600 cursor-pointer rounded-lg transition-colors"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>Share</span>
                  </button>
                </div>

                {/* Comment Box */}
                {commentBoxOpenIds[post.id] && (
                  <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-3">
                    {commentsLoading[post.id] ? (
                      <p className="text-[11px] text-slate-400">Loading comments...</p>
                    ) : (
                      comments.map((c) => (
                        <div key={c.id} className="flex items-start gap-2">
                          <img
                            src={c.authorAvatar || composerAvatar}
                            alt=""
                            className="w-7 h-7 rounded-full object-cover shrink-0"
                          />
                          <div className="bg-slate-50 rounded-2xl px-3 py-2 text-[11px] text-slate-700 flex-1">
                            <span className="font-bold text-slate-900">{c.authorName} </span>
                            {c.text}
                          </div>
                        </div>
                      ))
                    )}
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
                        placeholder="Comment about the conference, CFP, or abstract..."
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
      )}
    </div>
  );
};
