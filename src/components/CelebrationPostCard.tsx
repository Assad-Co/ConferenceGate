import React from 'react';
import { MessageSquare, Share2, Repeat2, Bookmark, Award, Send } from 'lucide-react';
import { CelebrationKind, Post, PostAuthor, Conference } from '../types';
import { KudosRibbon, SponsorshipAcceptedIllustration, BestOrganizerIllustration } from './celebrationIllustrations';
import { Logo } from './Logo';
import { ReactionType, REACTION_META } from './reactionMeta';
import { ConferenceLink } from './ConferenceLink';
import { PostComment } from '../api/posts';
import { resolveAvatar } from '../utils/avatar';
import { useToast } from './Toast';

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

interface CelebrationPostCardProps {
  post: Post;
  onOpenProfile?: (author: PostAuthor) => void;
  conferences?: Conference[];
  onSelectConference?: (conf: Conference) => void;
  onReact: (postId: string, reaction: ReactionType) => void;
  onToggleRepost: (postId: string) => void;
  onToggleSave: (postId: string) => void;
  onFetchComments?: (postId: string) => Promise<PostComment[]>;
  onAddComment?: (postId: string, text: string) => Promise<void>;
  composerAvatar?: string;
}

export const CelebrationPostCard: React.FC<CelebrationPostCardProps> = ({
  post,
  onOpenProfile,
  conferences = [],
  onSelectConference = () => {},
  onReact,
  onToggleRepost,
  onToggleSave,
  onFetchComments,
  onAddComment,
  composerAvatar,
}) => {
  const kind = post.celebrationKind || 'abstract-accepted';
  const theme = THEME[kind];
  const { Illustration } = theme;

  const [reactionPickerOpen, setReactionPickerOpen] = React.useState(false);
  const [commentBoxOpen, setCommentBoxOpen] = React.useState(false);
  const [comments, setComments] = React.useState<PostComment[]>([]);
  const [commentsLoading, setCommentsLoading] = React.useState(false);
  const [commentDraft, setCommentDraft] = React.useState('');
  const { showToast } = useToast();

  const toggleComments = async () => {
    const opening = !commentBoxOpen;
    setCommentBoxOpen(opening);
    if (opening && onFetchComments) {
      setCommentsLoading(true);
      try {
        setComments(await onFetchComments(post.id));
      } catch {
        showToast({ type: 'info', title: "Couldn't load comments", message: 'Please try again.' });
      } finally {
        setCommentsLoading(false);
      }
    }
  };

  const handleAddComment = async () => {
    const text = commentDraft.trim();
    if (!text || !onAddComment || !onFetchComments) return;
    try {
      await onAddComment(post.id, text);
      setCommentDraft('');
      setComments(await onFetchComments(post.id));
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

  const handleShare = async () => {
    const shareText = `${post.celebrationHeadline || ''}\n${post.content}\n\n— ${post.authorName} on Conference Gate`;
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
  };

  const activeReaction = post.userReaction || null;
  const reactionCounts = post.reactions;
  const totalReactions =
    (reactionCounts.likes || 0) + (reactionCounts.celebrates || 0) + (reactionCounts.insightful || 0) + (reactionCounts.kudos || 0);
  const presentReactions = (Object.keys(REACTION_META) as ReactionType[]).filter(
    (t) => (reactionCounts as any)[t === 'like' ? 'likes' : t === 'celebrate' ? 'celebrates' : t] > 0
  );
  const activeMeta = activeReaction ? REACTION_META[activeReaction] : null;

  const isSaved = !!post.isSaved;
  const isReposted = !!post.isReposted;
  const repostsCount = post.repostsCount || 0;

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
            <img src={resolveAvatar(post.authorAvatar, post.authorName)} alt={post.authorName} className="w-10 h-10 rounded-full object-cover shrink-0" />
            <div className="min-w-0 text-xs">
              <div className="font-bold text-slate-900 truncate group-hover/author:text-blue-700 transition-colors">{post.authorName}</div>
              <div className="text-slate-500 truncate">{post.authorTitle} · {post.authorOrg}</div>
              <div className="text-slate-400">{post.timestamp}</div>
            </div>
          </button>
          <button
            onClick={() => onToggleSave(post.id)}
            className={`p-1.5 rounded-lg cursor-pointer transition-colors shrink-0 ${
              isSaved ? 'text-blue-600' : 'text-slate-300 hover:text-slate-500'
            }`}
            title={isSaved ? 'Saved' : 'Save post'}
          >
            <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
          </button>
        </div>

        {post.conferenceBadge && (
          <ConferenceLink
            conferences={conferences}
            conferenceId={post.conferenceId || ''}
            conferenceTitle={post.conferenceBadge}
            onSelectConference={onSelectConference}
            className="inline-block px-2.5 py-1 bg-slate-100 text-slate-700 rounded-md text-[11px] font-bold"
          />
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
                      onClick={() => {
                        onReact(post.id, t);
                        setReactionPickerOpen(false);
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
              className={`w-full py-1 flex items-center justify-center gap-1.5 cursor-pointer rounded-lg transition-colors ${
                activeReaction ? activeMeta?.color : 'hover:text-blue-600'
              }`}
            >
              {activeMeta ? <activeMeta.icon className="w-4 h-4 fill-current" /> : <Award className="w-4 h-4" />}
              <span>{activeMeta ? activeMeta.label : 'Like'}</span>
            </button>
          </div>
          <button
            onClick={toggleComments}
            className="flex-1 py-1 flex items-center justify-center gap-1.5 hover:text-blue-600 cursor-pointer rounded-lg transition-colors"
          >
            <MessageSquare className="w-4 h-4" />
            <span>Comment</span>
          </button>
          <button
            onClick={() => onToggleRepost(post.id)}
            className={`flex-1 py-1 flex items-center justify-center gap-1.5 cursor-pointer rounded-lg transition-colors ${
              isReposted ? 'text-emerald-600' : 'hover:text-emerald-600'
            }`}
          >
            <Repeat2 className="w-4 h-4" />
            <span>{isReposted ? 'Reposted' : 'Repost'}</span>
          </button>
          <button
            onClick={handleShare}
            className="flex-1 py-1 flex items-center justify-center gap-1.5 hover:text-blue-600 cursor-pointer rounded-lg transition-colors"
          >
            <Share2 className="w-4 h-4" />
            <span>Share</span>
          </button>
        </div>

        {commentBoxOpen && (
          <div className="pt-1 space-y-3">
            {commentsLoading ? (
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
            {onAddComment && (
              <div className="flex items-center gap-2">
                <img src={composerAvatar} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                <input
                  type="text"
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddComment();
                    }
                  }}
                  placeholder="Comment about the conference, CFP, or abstract..."
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-full text-[11px] focus:outline-hidden"
                />
                <button
                  onClick={handleAddComment}
                  disabled={!commentDraft.trim()}
                  className="p-2 text-blue-600 hover:text-blue-800 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
