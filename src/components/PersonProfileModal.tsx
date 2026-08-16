import React from 'react';
import { X, MessageSquare, ShieldCheck, Building2 } from 'lucide-react';
import { Post, PostAuthor } from '../types';

interface PersonProfileModalProps {
  author: PostAuthor | null;
  posts: Post[];
  onClose: () => void;
  onMessage: (author: PostAuthor) => void;
}

export const PersonProfileModal: React.FC<PersonProfileModalProps> = ({ author, posts, onClose, onMessage }) => {
  if (!author) return null;

  const theirPosts = posts.filter((p) => p.authorName === author.name);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-end px-4 pt-4">
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-6 text-center space-y-3">
          <img
            src={author.avatar}
            alt={author.name}
            className="w-20 h-20 rounded-full object-cover mx-auto ring-4 ring-white shadow-md bg-slate-900"
          />
          <div>
            <div className="flex items-center justify-center gap-1.5">
              <h2 className="text-lg font-extrabold text-slate-900">{author.name}</h2>
              <ShieldCheck className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-xs font-semibold text-slate-600 mt-0.5">{author.title}</p>
            {author.org && (
              <p className="text-xs text-slate-500 mt-0.5 flex items-center justify-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                {author.org}
              </p>
            )}
          </div>

          <button
            onClick={() => onMessage(author)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-full shadow-xs transition-colors cursor-pointer"
          >
            <MessageSquare className="w-4 h-4" />
            Message
          </button>
        </div>

        <div className="border-t border-slate-100 px-6 py-5 space-y-3">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            {theirPosts.length > 0 ? `Recent Activity (${theirPosts.length})` : 'Recent Activity'}
          </h3>
          {theirPosts.length > 0 ? (
            <div className="space-y-2">
              {theirPosts.slice(0, 3).map((post) => (
                <div key={post.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <p className="text-xs text-slate-700 line-clamp-3">{post.content}</p>
                  <p className="text-[10px] text-slate-400 mt-1.5">{post.timestamp}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">No recent activity to show.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default PersonProfileModal;
