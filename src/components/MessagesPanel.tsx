import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  Inbox,
  MessageSquare,
  Search,
  Send,
  UserPlus,
  X,
  Loader2,
} from 'lucide-react';
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
  onSendMessage: (partnerId: string, text: string) => Promise<boolean>;
  onStartNewConversation: (user: PublicUser) => void;
}

type ConversationFilter = 'all' | 'unread';

function formatConversationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
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
  const [conversationQuery, setConversationQuery] = useState('');
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('all');
  const [mobileThreadOpen, setMobileThreadOpen] = useState(Boolean(activePartnerId || pendingPartner));
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [memberSearchError, setMemberSearchError] = useState<string | null>(null);
  const searchSequence = useRef(0);

  useEffect(() => {
    if (activePartnerId || pendingPartner) setMobileThreadOpen(true);
  }, [activePartnerId, pendingPartner]);

  const activeConversation = conversations.find((conversation) => conversation.partnerId === activePartnerId) || null;
  const activePartner = activeConversation?.partner || pendingPartner;

  const unreadTotal = useMemo(
    () => conversations.reduce((sum, conversation) => sum + Math.max(0, conversation.unreadCount || 0), 0),
    [conversations]
  );

  const visibleConversations = useMemo(() => {
    const term = conversationQuery.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (conversationFilter === 'unread' && conversation.unreadCount <= 0) return false;
      if (!term) return true;
      return [
        conversation.partner.name,
        conversation.partner.title,
        conversation.partner.organization,
        conversation.lastMessage,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [conversations, conversationFilter, conversationQuery]);

  if (!isOpen) return null;

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !activePartnerId || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const sent = await onSendMessage(activePartnerId, text);
      if (sent) {
        setDraft('');
      } else {
        setSendError('Message was not sent. Your draft has been kept so you can try again.');
      }
    } catch (error: any) {
      setSendError(error?.message || 'Message was not sent. Your draft has been kept so you can try again.');
    } finally {
      setSending(false);
    }
  };

  const handleSearchChange = (value: string) => {
    setQuery(value);
    const sequence = ++searchSequence.current;

    setMemberSearchError(null);
    if (!value.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchUsers(value)
      .then((users) => {
        if (sequence === searchSequence.current) setResults(users);
      })
      .catch((error: any) => {
        if (sequence === searchSequence.current) {
          setResults([]);
          setMemberSearchError(error?.message || 'Member search is temporarily unavailable.');
        }
      })
      .finally(() => {
        if (sequence === searchSequence.current) setSearching(false);
      });
  };

  const selectConversation = (partnerId: string) => {
    onSelectConversation(partnerId);
    setMobileThreadOpen(true);
  };

  const startConversation = (user: PublicUser) => {
    onStartNewConversation(user);
    setQuery('');
    setResults([]);
    setMobileThreadOpen(true);
  };

  const starterMessages = [
    'Hello — I’d like to connect about an upcoming conference collaboration.',
    'Hello — are you attending any upcoming conferences where we could meet?',
    'Hello — I’d like to discuss a technical topic related to an upcoming conference.',
  ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl h-[min(720px,92vh)] flex overflow-hidden">
        {/* Conversation list */}
        <div
          className={`${mobileThreadOpen ? 'hidden sm:flex' : 'flex'} w-full sm:w-80 shrink-0 border-r border-slate-100 flex-col`}
        >
          <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-extrabold text-slate-900">Messages</h2>
                {unreadTotal > 0 && (
                  <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadTotal}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">Professional conference conversations</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg cursor-pointer"
              aria-label="Close messages"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 border-b border-slate-100 space-y-2.5">
            <label className="relative block">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={conversationQuery}
                onChange={(event) => setConversationQuery(event.target.value)}
                placeholder="Search your inbox..."
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:border-blue-500 focus:bg-white transition-colors"
              />
            </label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setConversationFilter('all')}
                className={
                  conversationFilter === 'all'
                    ? 'px-3 py-1.5 rounded-full bg-blue-900 text-white text-[10px] font-bold'
                    : 'px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-slate-600 text-[10px] font-bold hover:text-blue-700'
                }
              >
                All {conversations.length > 0 ? `(${conversations.length})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setConversationFilter('unread')}
                className={
                  conversationFilter === 'unread'
                    ? 'px-3 py-1.5 rounded-full bg-blue-900 text-white text-[10px] font-bold'
                    : 'px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-slate-600 text-[10px] font-bold hover:text-blue-700'
                }
              >
                Unread {unreadTotal > 0 ? `(${unreadTotal})` : ''}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {visibleConversations.length === 0 ? (
              <div className="p-5 text-center space-y-2">
                <Inbox className="w-7 h-7 text-slate-300 mx-auto" />
                <p className="text-xs font-bold text-slate-500">
                  {conversations.length === 0 ? 'No conversations yet' : 'No conversations match'}
                </p>
                <p className="text-[10px] text-slate-400">
                  {conversations.length === 0
                    ? 'Find a registered member below or use Message on a professional profile.'
                    : 'Change the inbox filter or search term.'}
                </p>
              </div>
            ) : (
              visibleConversations.map((conversation) => (
                <button
                  key={conversation.partnerId}
                  type="button"
                  onClick={() => selectConversation(conversation.partnerId)}
                  className={`w-full text-left px-4 py-3 flex items-center gap-2.5 border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition-colors ${
                    conversation.partnerId === activePartnerId ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="relative shrink-0">
                    <img
                      src={resolveAvatar(conversation.partner.avatar, conversation.partner.name)}
                      alt={conversation.partner.name}
                      className="w-10 h-10 rounded-full object-cover bg-slate-200"
                    />
                    {conversation.unreadCount > 0 && (
                      <span className="absolute -right-1 -top-1 min-w-[17px] h-[17px] px-1 rounded-full bg-blue-600 ring-2 ring-white text-white text-[9px] font-bold flex items-center justify-center">
                        {conversation.unreadCount}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className={`text-xs truncate ${conversation.unreadCount > 0 ? 'font-extrabold text-slate-950' : 'font-bold text-slate-900'}`}>
                        {conversation.partner.name}
                      </div>
                      <span className="text-[9px] text-slate-400 shrink-0">
                        {formatConversationTime(conversation.lastMessageAt)}
                      </span>
                    </div>
                    <div className={`text-[11px] truncate ${conversation.unreadCount > 0 ? 'font-semibold text-slate-700' : 'text-slate-500'}`}>
                      {conversation.lastMessage || 'No messages yet'}
                    </div>
                    {(conversation.partner.title || conversation.partner.organization) && (
                      <div className="text-[9px] text-slate-400 truncate mt-0.5">
                        {[conversation.partner.title, conversation.partner.organization].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="p-3 border-t border-slate-100 bg-slate-50/60 relative">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Start new conversation</div>
            <label className="relative block">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(event) => handleSearchChange(event.target.value)}
                placeholder="Find registered members..."
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:border-blue-500 transition-colors"
              />
            </label>
            {query.trim() && (
              <div className="absolute z-10 left-3 right-3 bottom-[58px] max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                {searching ? (
                  <p className="text-[11px] text-slate-400 p-3">Searching…</p>
                ) : memberSearchError ? (
                  <p className="text-[11px] text-rose-600 p-3">{memberSearchError}</p>
                ) : results.length === 0 ? (
                  <p className="text-[11px] text-slate-400 p-3">No registered members match “{query}”.</p>
                ) : (
                  results.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => startConversation(user)}
                      className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer transition-colors border-b border-slate-50 last:border-b-0"
                    >
                      <img
                        src={resolveAvatar(user.avatar, user.name)}
                        alt={user.name}
                        className="w-8 h-8 rounded-full object-cover shrink-0 bg-slate-200"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-bold text-slate-900 truncate">{user.name}</div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {[user.title, user.organization].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <UserPlus className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Active conversation */}
        <div className={`${mobileThreadOpen ? 'flex' : 'hidden sm:flex'} flex-1 flex-col min-w-0`}>
          <div className="px-3 sm:px-4 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setMobileThreadOpen(false)}
                className="sm:hidden p-1.5 text-slate-500 hover:bg-slate-50 rounded-lg shrink-0"
                aria-label="Back to conversations"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
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
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg cursor-pointer shrink-0"
              aria-label="Close messages"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {activePartner ? (
              activeMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 max-w-md mx-auto">
                  <MessageSquare className="w-9 h-9 text-slate-300" />
                  <div>
                    <p className="text-sm font-bold text-slate-700">Start a professional conversation</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Message {activePartner.name} about a conference, collaboration or technical discussion.
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2 pt-2">
                    {starterMessages.map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        onClick={() => setDraft(starter)}
                        className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50 text-[10px] font-semibold text-slate-600 hover:text-blue-700 text-left"
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                activeMessages.map((message) => (
                  <div key={message.id} className={`flex ${message.senderId === currentUserId ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[82%] sm:max-w-[75%] px-3.5 py-2 rounded-2xl text-xs ${
                        message.senderId === currentUserId
                          ? 'bg-blue-900 text-white rounded-br-sm'
                          : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">{message.text}</div>
                      <div className={`text-[10px] mt-1 ${message.senderId === currentUserId ? 'text-blue-200' : 'text-slate-400'}`}>
                        {new Date(message.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))
              )
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-xs text-slate-400">
                <Inbox className="w-9 h-9 text-slate-300" />
                <span>Choose a conversation from the inbox or find a registered member to start one.</span>
              </div>
            )}
          </div>

          {activePartner && activePartnerId && (
            <form onSubmit={handleSend} className="p-3 border-t border-slate-100 bg-white">
              {sendError && (
                <div className="mb-2 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-[10px] text-rose-700">
                  {sendError}
                </div>
              )}
              <div className="flex items-center gap-2">
              <input
                type="text"
                value={draft}
                onChange={(event) => { setDraft(event.target.value); if (sendError) setSendError(null); }}
                disabled={sending}
                placeholder={`Message ${activePartner.name}...`}
                className="flex-1 rounded-full border border-slate-300 bg-slate-50 px-4 py-2.5 text-xs focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-shadow"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending}
                className="p-2.5 bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white rounded-full transition-colors cursor-pointer shrink-0"
                aria-label={sending ? 'Sending message' : 'Send message'}
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessagesPanel;
