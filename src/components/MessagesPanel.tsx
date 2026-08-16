import React, { useState } from 'react';
import { X, Send, MessageSquare } from 'lucide-react';
import { DirectMessage } from '../types';

interface MessagesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: DirectMessage[];
  activePartnerId: string | null;
  onSelectConversation: (partnerId: string) => void;
  onSendMessage: (partnerId: string, text: string) => void;
}

export const MessagesPanel: React.FC<MessagesPanelProps> = ({
  isOpen,
  onClose,
  conversations,
  activePartnerId,
  onSelectConversation,
  onSendMessage,
}) => {
  const [draft, setDraft] = useState('');

  if (!isOpen) return null;

  const activeConversation = conversations.find((c) => c.partnerId === activePartnerId) || null;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || !activePartnerId) return;
    onSendMessage(activePartnerId, draft.trim());
    setDraft('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl h-[600px] max-h-[85vh] flex overflow-hidden">
        {/* Conversation list */}
        <div className="w-64 shrink-0 border-r border-slate-100 flex flex-col">
          <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-extrabold text-slate-900">Messages</h2>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer sm:hidden">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="text-xs text-slate-400 p-4">
                No conversations yet. Click "Message" on someone's profile to start chatting.
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
                  <img src={conv.partnerAvatar} alt={conv.partnerName} className="w-9 h-9 rounded-full object-cover shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate">{conv.partnerName}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {conv.messages.length > 0 ? conv.messages[conv.messages.length - 1].text : 'No messages yet'}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Active conversation */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between">
            {activeConversation ? (
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src={activeConversation.partnerAvatar}
                  alt={activeConversation.partnerName}
                  className="w-8 h-8 rounded-full object-cover shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">{activeConversation.partnerName}</div>
                  <div className="text-[11px] text-slate-500 truncate">{activeConversation.partnerRole}</div>
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
            {activeConversation ? (
              activeConversation.messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-2">
                  <MessageSquare className="w-8 h-8 text-slate-300" />
                  <p className="text-xs text-slate-400 max-w-xs">
                    Say hello to {activeConversation.partnerName} — your message will show up here.
                  </p>
                </div>
              ) : (
                activeConversation.messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.senderId === 'me' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-xs ${
                        msg.senderId === 'me'
                          ? 'bg-blue-900 text-white rounded-br-sm'
                          : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                      }`}
                    >
                      {msg.text}
                      <div className={`text-[10px] mt-1 ${msg.senderId === 'me' ? 'text-blue-200' : 'text-slate-400'}`}>
                        {msg.timestamp}
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

          {activeConversation && (
            <form onSubmit={handleSend} className="p-3 border-t border-slate-100 flex items-center gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Message ${activeConversation.partnerName}...`}
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
