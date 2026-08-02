import React, { useState } from 'react';
import {
  ShieldCheck,
  FileText,
  Award,
  Users,
  Briefcase,
  Layers,
  Building2,
  Clock,
  MapPin,
  Calendar,
  ThumbsUp,
  MessageSquare,
  Send,
  Star,
} from 'lucide-react';
import { Conference, UserProfile, Post } from '../types';

interface HomeLandingProps {
  conferences: Conference[];
  onSelectConference: (conf: Conference) => void;
  onNavigateTab: (tab: string) => void;
  onOpenSubmitAbstract: (confId?: string) => void;
  onSearchQuery: (query: string) => void;
  userProfile: UserProfile;
  posts: Post[];
  onAddPost: (content: string) => void;
}

const PostCard: React.FC<{ post: Post }> = ({ post }) => (
  <div className="bg-white rounded-lg border border-slate-200 shadow-xs p-4 space-y-3">
    <div className="flex items-center gap-3">
      <img src={post.authorAvatar} alt={post.authorName} className="w-10 h-10 rounded-full object-cover shrink-0" />
      <div className="min-w-0 text-xs">
        <div className="font-bold text-slate-900 flex items-center gap-1">
          <span className="truncate">{post.authorName}</span>
          <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        </div>
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
    </div>
  </div>
);

const PromotedConferenceCard: React.FC<{
  conf: Conference;
  onSelect: (conf: Conference) => void;
  onSubmitAbstract: (confId?: string) => void;
}> = ({ conf, onSelect, onSubmitAbstract }) => (
  <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
    <div className="px-4 pt-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-600">
      <Star className="w-3 h-3 fill-blue-600" />
      <span>Promoted Conference · {conf.recommendationScore}% Match</span>
    </div>
    <div className="relative h-36 mt-2">
      <img src={conf.banner} alt={conf.title} className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent" />
      <div className="absolute bottom-2 left-4 right-4 text-white">
        <h3 className="font-bold text-sm leading-snug line-clamp-2 drop-shadow-xs">{conf.title}</h3>
      </div>
    </div>
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-blue-600" />
          {conf.dates.start} — {conf.dates.end}
        </span>
        <span className="flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-rose-500" />
          {conf.location.city}, {conf.location.country}
        </span>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onSubmitAbstract(conf.id)}
          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-full transition-colors cursor-pointer"
        >
          Submit Abstract
        </button>
        <button
          onClick={() => onSelect(conf)}
          className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-full transition-colors cursor-pointer"
        >
          See Details
        </button>
      </div>
    </div>
  </div>
);

export const HomeLanding: React.FC<HomeLandingProps> = ({
  conferences,
  onSelectConference,
  onNavigateTab,
  onOpenSubmitAbstract,
  userProfile,
  posts,
  onAddPost,
}) => {
  const [postText, setPostText] = useState('');

  const handlePostSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!postText.trim()) return;
    onAddPost(postText);
    setPostText('');
  };

  const safeConferences = conferences || [];
  const upcomingDeadlines = [...safeConferences]
    .filter((c) => c.cfpStatus === 'Open')
    .sort((a, b) => new Date(a.abstractDeadline).getTime() - new Date(b.abstractDeadline).getTime())
    .slice(0, 4);
  const recommended = [...safeConferences]
    .sort((a, b) => b.recommendationScore - a.recommendationScore)
    .slice(0, 4);
  const promotedPool = [...safeConferences].sort((a, b) => b.recommendationScore - a.recommendationScore);

  const quickLinks = [
    { label: 'Discover Conferences', icon: Layers, tab: 'discover' },
    { label: 'My Abstracts', icon: FileText, tab: 'abstracts' },
    { label: 'Reviewer Portal', icon: Award, tab: 'reviewer' },
    { label: 'Organizer Dashboard', icon: Building2, tab: 'organizer' },
    { label: 'Sponsor Portal', icon: Briefcase, tab: 'sponsor' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] xl:grid-cols-[260px_1fr_300px] gap-4 items-start">
      {/* Left Sidebar: Profile + Quick Links */}
      <aside className="hidden lg:flex flex-col gap-4 sticky top-[72px]">
        <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
          <div className="h-14 bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-600" />
          <div className="px-4 pb-4 -mt-8">
            <button onClick={() => onNavigateTab('profile')} className="cursor-pointer block">
              <img
                src={userProfile.avatar}
                alt={userProfile.name}
                className="w-16 h-16 rounded-full ring-4 ring-white object-cover"
              />
            </button>
            <button onClick={() => onNavigateTab('profile')} className="block mt-2 text-left cursor-pointer w-full">
              <div className="font-bold text-sm text-slate-900 flex items-center gap-1">
                <span className="line-clamp-1">{userProfile.name}</span>
                <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              </div>
              <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{userProfile.title}</div>
            </button>
            <div className="text-[11px] text-slate-500 mt-2 flex items-center gap-1">
              <Building2 className="w-3 h-3 text-slate-400" />
              <span className="line-clamp-1">{userProfile.organization}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 shadow-xs px-4 py-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Reviewer Kudos</span>
            <span className="font-bold text-blue-700">+{userProfile.contributions.reviewerKudos}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Abstracts Submitted</span>
            <span className="font-bold text-slate-900">{userProfile.contributions.abstractsSubmitted}</span>
          </div>
          <button
            onClick={() => onNavigateTab('profile')}
            className="text-[11px] font-bold text-slate-500 hover:text-blue-600 cursor-pointer pt-1"
          >
            View full profile
          </button>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 shadow-xs py-2">
          {quickLinks.map((item) => (
            <button
              key={item.tab}
              onClick={() => onNavigateTab(item.tab)}
              className="w-full flex items-center gap-3 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <item.icon className="w-4 h-4 text-slate-400" />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Center Feed */}
      <main className="flex flex-col gap-4 min-w-0">
        {/* Post Composer */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-xs p-4">
          <form onSubmit={handlePostSubmit} className="flex items-start gap-3">
            <img
              src={userProfile.avatar}
              alt={userProfile.name}
              className="w-10 h-10 rounded-full object-cover shrink-0"
            />
            <input
              type="text"
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
              placeholder="Share a conference update, CFP, or paper insight..."
              className="flex-1 rounded-full border border-slate-300 px-4 py-2.5 text-sm focus:outline-hidden focus:border-blue-500 hover:bg-slate-50"
            />
          </form>
          <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100">
            <div className="flex items-center gap-4 text-xs font-semibold text-slate-500">
              <span className="flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-blue-600" />
                CFP Update
              </span>
              <span className="flex items-center gap-1.5">
                <Award className="w-4 h-4 text-indigo-600" />
                Achievement
              </span>
            </div>
            <button
              onClick={handlePostSubmit}
              disabled={!postText.trim()}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-full transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Post</span>
            </button>
          </div>
        </div>

        {/* Feed: posts interleaved with promoted conferences */}
        {posts.map((post, i) => (
          <React.Fragment key={post.id}>
            <PostCard post={post} />
            {i % 3 === 2 && promotedPool.length > 0 && (
              <PromotedConferenceCard
                conf={promotedPool[Math.floor(i / 3) % promotedPool.length]}
                onSelect={onSelectConference}
                onSubmitAbstract={onOpenSubmitAbstract}
              />
            )}
          </React.Fragment>
        ))}
      </main>

      {/* Right Sidebar: Deadlines + Recommendations */}
      <aside className="hidden xl:flex flex-col gap-4 sticky top-[72px]">
        <div className="bg-white rounded-lg border border-slate-200 shadow-xs">
          <div className="px-4 py-3 border-b border-slate-100 font-bold text-sm text-slate-900">
            Upcoming Abstract Deadlines
          </div>
          <div className="divide-y divide-slate-100">
            {upcomingDeadlines.map((conf) => (
              <button
                key={conf.id}
                onClick={() => onSelectConference(conf)}
                className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center gap-3 cursor-pointer"
              >
                <div className="w-9 h-9 rounded-md bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 line-clamp-1">{conf.title}</div>
                  <div className="text-[11px] text-slate-500">Deadline {conf.abstractDeadline}</div>
                </div>
              </button>
            ))}
          </div>
          <button
            onClick={() => onNavigateTab('discover')}
            className="w-full text-center text-xs font-bold text-slate-500 hover:text-blue-600 py-2.5 border-t border-slate-100 cursor-pointer"
          >
            Show more
          </button>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 shadow-xs">
          <div className="px-4 py-3 border-b border-slate-100 font-bold text-sm text-slate-900">
            Recommended Conferences
          </div>
          <div className="divide-y divide-slate-100">
            {recommended.map((conf) => (
              <div key={conf.id} className="px-4 py-3 flex items-center gap-3">
                <img src={conf.logo} alt={conf.title} className="w-9 h-9 rounded-md object-cover shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-slate-900 line-clamp-1">{conf.title}</div>
                  <div className="text-[11px] text-slate-500">
                    {conf.location.city}, {conf.location.country}
                  </div>
                </div>
                <button
                  onClick={() => onSelectConference(conf)}
                  className="text-[11px] font-bold text-blue-600 border border-blue-200 rounded-full px-2.5 py-1 hover:bg-blue-50 cursor-pointer shrink-0"
                >
                  View
                </button>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
};
