import React, { useState } from 'react';
import { Sparkles, X, Send, Bot, User, ArrowRight, RefreshCw } from 'lucide-react';
import { UserRole } from '../types';

interface AIAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  userRole: UserRole;
}

export const AIAssistantModal: React.FC<AIAssistantModalProps> = ({
  isOpen,
  onClose,
  userRole,
}) => {
  if (!isOpen) return null;

  const [messages, setMessages] = useState<
    Array<{ sender: 'ai' | 'user'; text: string; time: string; isFallback?: boolean }>
  >([
    {
      sender: 'ai',
      text: `Hello! I am the Conference Gate AI Assistant. How can I help you today? Ask me about finding matching Call for Papers, reviewing abstracts, committee recommendations, or sponsorship packages.`,
      time: 'Just now',
    },
  ]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const getPresets = () => {
    switch (userRole.toLowerCase()) {
      case 'organizer':
        return [
          'Find qualified reviewers for petroleum systems & AI track',
          'Recommend technical committee members for energy transition',
          'Help create a preliminary conference agenda layout',
        ];
      case 'reviewer':
        return [
          'Which review opportunities match my geochemistry expertise?',
          'How can I increase my Reviewer Kudos and earn badges?',
          'Summarize key review guidelines for technical quality',
        ];
      case 'sponsor':
        return [
          'Which upcoming conferences match our $20,000 budget?',
          'How can we maximize lead capture & booth ROI?',
          'Compare Diamond vs Gold packages for London Energy Congress',
        ];
      default:
        return [
          'What upcoming energy & geoscience conferences match my research?',
          'Which Calls for Papers are currently open in AI & geophysics?',
          'Who are the top keynote speakers attending Global Energy Congress?',
        ];
    }
  };

  const handleSend = async (promptToSend?: string) => {
    const text = promptToSend || inputPrompt;
    if (!text.trim() || loading) return;

    const userMsg = { sender: 'user' as const, text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    setMessages((prev) => [...prev, userMsg]);
    if (!promptToSend) setInputPrompt('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          userRole,
          context: { platform: 'Conference Gate', currentRole: userRole },
        }),
      });
      if (!res.ok) throw new Error('AI assistant request failed');
      const data = await res.json();
      if (data.isFallback || !data.reply) throw new Error('AI assistant unavailable');
      setMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: data.reply,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: 'The AI Assistant is currently offline, so this is a static tip rather than a live answer: check our Conference Discovery Engine for active Call for Papers matching your interests.',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isFallback: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl flex flex-col h-[600px] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-sky-50 border-b border-sky-100 p-4 text-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white border border-sky-200 flex items-center justify-center text-sky-700">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">Conference Gate AI Assistant</h3>
              <p className="text-[11px] text-sky-700">
                Powered by Gemini • Specialized in Academic & Technical Conferences
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-white rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message Log */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-50">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex gap-3 max-w-[85%] ${
                msg.sender === 'user' ? 'ml-auto flex-row-reverse' : ''
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  msg.sender === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gradient-to-br from-indigo-600 to-blue-700 text-white shadow-xs'
                }`}
              >
                {msg.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div>
                {msg.isFallback && (
                  <div className="text-[10px] font-bold text-amber-600 mb-1 px-1">Offline fallback — not live AI</div>
                )}
                <div
                  className={`p-3.5 rounded-2xl text-xs leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-blue-600 text-white rounded-tr-xs'
                      : msg.isFallback
                      ? 'bg-amber-50 text-slate-800 border border-amber-200 shadow-xs rounded-tl-xs whitespace-pre-wrap'
                      : 'bg-white text-slate-800 border border-slate-200 shadow-xs rounded-tl-xs whitespace-pre-wrap'
                  }`}
                >
                  {msg.text}
                </div>
                <div
                  className={`text-[10px] text-slate-400 mt-1 px-1 ${
                    msg.sender === 'user' ? 'text-right' : 'text-left'
                  }`}
                >
                  {msg.time}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 bg-white p-3 rounded-2xl border border-slate-200 w-fit">
              <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
              <span>Analyzing global conference repository...</span>
            </div>
          )}
        </div>

        {/* Presets */}
        <div className="px-4 py-2 bg-white border-t border-slate-100 flex gap-2 overflow-x-auto">
          {getPresets().map((preset, i) => (
            <button
              key={i}
              onClick={() => handleSend(preset)}
              className="text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 px-3 py-1.5 rounded-full shrink-0 transition-colors cursor-pointer flex items-center gap-1"
            >
              <span>{preset}</span>
              <ArrowRight className="w-3 h-3 text-slate-400" />
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="p-3 bg-white border-t border-slate-200 flex gap-2"
        >
          <input
            type="text"
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            placeholder={`Ask AI Assistant (${userRole} perspective)...`}
            className="flex-1 px-4 py-2 bg-slate-100 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-xl text-xs text-slate-900 focus:outline-hidden transition-all"
          />
          <button
            type="submit"
            disabled={loading || !inputPrompt.trim()}
            className="px-4 py-2 bg-blue-900 hover:bg-blue-950 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>Ask</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
