import React, { useState } from 'react';
import { X, Send, MessageSquare, Search, UserPlus } from 'lucide-react';
import { ConversationSummary, MessageItem, PublicUser, searchUsers } from '../api/messages';
import { resolveAvatar } from '../utils/avatar';

interface MessagesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: ConversationSummary[];
  activePartnerId: string | null;
  pendingPartner: PublicUser | null;
  activeMessages: MessageItem[];
  currentUserId: string;
  onSelectConversation: (partnerId: string) => void;
  onSendMessage: (partnerId: string, text: string) => void;
  onStartNewConversation: (user: PublicUser) => void;
}

export const MessagesPanel: React.FC<MessagesPanelProps> = ({
  isOpen,
  onClose,
  conversations,
  activePartnerId,
  pendingPartner,
  activeMessages,
  currentUserId,
  onSelectConversation,
  onSendMessage,
  onStartNewConversation,
}) => {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);

  if (!isOpen) return null;

  const activeConversation = conversations.find((c) => c.partnerId === activePartnerId) || null;
  const activePartner = activeConversation?.partner || pendingPartner;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || !activePartnerId) return;
    onSendMessage(activePartnerId, draft.trim());
    setDraft('');
  };

  const handleSearchChange = (value: string) => {
    setQuery(value);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    searchUsers(value)
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl h-[600px] max-h-[85vh] flex overflow-hidden">
        {/* Conversation list */}
        <div className="w-72 shrink-0 border-r border-slate-100 flex flex-col">
          <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-extrabold text-slate-900">Messages</h2>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer sm:hidden">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 border-b border-slate-100 relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-6 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Find people to message..."
              className="w-full pl-8 pr-3 py-2 rounded-full border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:border-blue-500 focus:bg-white transition-colors"
            />
            {query.trim() && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-slate-100 bg-white shadow-xs">
                {searching ? (
                  <p className="text-[11px] text-slate-400 p-3">Searching…</p>
                ) : results.length === 0 ? (
                  <p className="text-[11px] text-slate-400 p-3">No registered members match "{query}".</p>
                ) : (
                  results.map((user) => (
                    <button
                      key={user.id}
                      onClick={() => {
                        onStartNewConversation(user);
                        setQuery('');
                        setResults([]);
                      }}
                      className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <img
                        src={resolveAvatar(user.avatar, user.name)}
                        alt={user.name}
                        className="w-7 h-7 rounded-full object-cover shrink-0 bg-slate-200"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-bold text-slate-900 truncate">{user.name}</div>
                        <div className="text-[10px] text-slate-500 truncate">{user.title || user.organization || ''}</div>
                      </div>
                      <UserPlus className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="text-xs text-slate-400 p-4">
                No conversations yet. Search for a registered member above, or click "Message" on someone's profile.
              </p>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.partnerId}
                  onClick={() => onSelectConversation(conv.partnerId)}
                  className={`w-full text-left px-4 py-3 flex items-center gap-2.5 border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition-colors ${
                    conv.partnerId === activePartnerId ? 'bg-blue-50' : ''
                  }`}
                >
                  <img
                    src={resolveAvatar(conv.partner.avatar, conv.partner.name)}
                    alt={conv.partner.name}
                    className="w-9 h-9 rounded-full object-cover shrink-0 bg-slate-200"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-slate-900 truncate">{conv.partner.name}</div>
                    <div className="text-[11px] text-slate-500 truncate">{conv.lastMessage || 'No messages yet'}</div>
                  </div>
                  {conv.unreadCount > 0 && (
                    <span className="min-w-[16px] h-4 px-1 rounded-full bg-blue-600 text-white text-[9px] font-bold flex items-center justify-center shrink-0">
                      {conv.unreadCount}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Active conversation */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between">
            {activePartner ? (
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src={resolveAvatar(activePartner.avatar, activePartner.name)}
                  alt={activePartner.name}
                  className="w-8 h-8 rounded-full object-cover shrink-0 bg-slate-200"
                />
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">{activePartner.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {[activePartner.title, activePartner.organization].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
            ) : (
              <span className="text-sm font-bold text-slate-400">Select a conversation</span>
            )}
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {activePartner ? (
              activeMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-2">
                  <MessageSquare className="w-8 h-8 text-slate-300" />
                  <p className="text-xs text-slate-400 max-w-xs">
                    Say hello to {activePartner.name} — your message will show up here, for both of you, in real time.
                  </p>
                </div>
              ) : (
                activeMessages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.senderId === currentUserId ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-xs ${
                        msg.senderId === currentUserId
                          ? 'bg-blue-900 text-white rounded-br-sm'
                          : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                      }`}
                    >
                      {msg.text}
                      <div className={`text-[10px] mt-1 ${msg.senderId === currentUserId ? 'text-blue-200' : 'text-slate-400'}`}>
                        {new Date(msg.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))
              )
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                Choose a conversation from the left to view messages.
              </div>
            )}
          </div>

          {activePartner && activePartnerId && (
            <form onSubmit={handleSend} className="p-3 border-t border-slate-100 flex items-center gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Message ${activePartner.name}...`}
                className="flex-1 rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-xs focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-shadow"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="p-2.5 bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white rounded-full transition-colors cursor-pointer shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessagesPanel;
