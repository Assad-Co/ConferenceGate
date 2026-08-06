import React, { useState } from 'react';
import {
  MessageSquare,
  ThumbsUp,
  Share2,
  Send,
  Sparkles,
  Filter,
  CheckCircle2,
  Award,
} from 'lucide-react';
import { Post } from '../types';
import { CelebrationPostCard } from './CelebrationPostCard';

interface CommunityFeedProps {
  posts?: Post[];
  onAddPost: (postText: string) => void;
}

export const CommunityFeed: React.FC<CommunityFeedProps> = ({
  posts = [],
  onAddPost,
}) => {
  const [newPostText, setNewPostText] = useState('');

  const handleSubmitPost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPostText.trim()) return;
    onAddPost(newPostText);
    setNewPostText('');
  };

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      {/* Title */}
      <div className="bg-blue-50 rounded-2xl border border-blue-100 p-6 shadow-xs space-y-1">
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

      {/* Post Composer */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
          Share Conference Update or Paper Insight
        </h3>
        <form onSubmit={handleSubmitPost} className="space-y-3">
          <textarea
            rows={3}
            value={newPostText}
            onChange={(e) => setNewPostText(e.target.value)}
            placeholder="Announce paper acceptance, share session slides, or ask technical questions..."
            className="w-full p-3 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-xs focus:outline-hidden leading-relaxed"
          ></textarea>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!newPostText.trim()}
              className="px-5 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Post Update</span>
            </button>
          </div>
        </form>
      </div>

      {/* Posts List */}
      <div className="space-y-6">
        {(posts || []).map((post) =>
          post.postType === 'celebration' ? (
            <CelebrationPostCard key={post.id} post={post} />
          ) : (
            <div key={post.id} className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
              {/* Author Bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img src={post.authorAvatar} alt={post.authorName} className="w-10 h-10 rounded-xl object-cover ring-2 ring-blue-500/20" />
                  <div className="text-xs">
                    <div className="font-bold text-slate-900 flex items-center gap-1">
                      <span>{post.authorName}</span>
                      <Award className="w-3.5 h-3.5 text-blue-600" />
                    </div>
                    <div className="text-slate-500">{post.authorTitle} • {post.authorOrg}</div>
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 font-semibold">{post.timestamp}</span>
              </div>

              {/* Conference Badge Tag */}
              {post.conferenceBadge && (
                <div className="inline-block px-2.5 py-1 bg-slate-100 text-slate-800 rounded-md text-[11px] font-bold">
                  📍 {post.conferenceBadge}
                </div>
              )}

              {/* Content */}
              <p className="text-xs text-slate-700 leading-relaxed">{post.content}</p>

              {/* Actions */}
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
          )
        )}
      </div>
    </div>
  );
};
