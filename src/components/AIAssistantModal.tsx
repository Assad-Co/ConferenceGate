import React, { useState } from 'react';
import {
  Sparkles,
  X,
  Send,
  Bot,
  User,
  ArrowRight,
  RefreshCw,
  Calendar,
  MapPin,
  ExternalLink,
  Compass,
} from 'lucide-react';
import { UserRole } from '../types';
import { LiveSearchResult } from '../api/search';
import { parseDateFromSnippet, parseLocationFromSnippet } from '../utils/parseSnippetMeta';

export type AssistantConferenceTab =
  | 'overview'
  | 'cfp'
  | 'fees'
  | 'agenda'
  | 'speakers'
  | 'committee'
  | 'sponsors'
  | 'venue'
  | 'community';

interface AssistantRecommendation extends LiveSearchResult {
  defaultTab?: AssistantConferenceTab;
}

interface AssistantNavigationAction {
  label: string;
  destination: string;
}

interface AssistantMessage {
  sender: 'ai' | 'user';
  text: string;
  time: string;
  isFallback?: boolean;
  recommendations?: AssistantRecommendation[];
  actions?: AssistantNavigationAction[];
}

interface AIAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  userRole: UserRole;
  onOpenConference: (result: LiveSearchResult, tab: AssistantConferenceTab) => void;
  onNavigate: (destination: string) => void;
}

const CONFERENCE_TABS: Array<{ id: AssistantConferenceTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'cfp', label: 'Call for Papers' },
  { id: 'fees', label: 'Fees' },
  { id: 'agenda', label: 'Program' },
  { id: 'speakers', label: 'Speakers' },
  { id: 'committee', label: 'Committee' },
  { id: 'sponsors', label: 'Sponsors' },
  { id: 'venue', label: 'Venue' },
];

function recommendationDate(result: AssistantRecommendation): string {
  const exact = parseDateFromSnippet(result.snippet);
  if (exact) return exact;
  const european = result.snippet.match(
    /\b\d{1,2}(?:\s*[-–—]\s*\d{1,2})?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}\b/i
  );
  if (european) return european[0];
  const monthYear = result.snippet.match(
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}\b/i
  );
  return monthYear?.[0] || 'Upcoming — open Overview to verify the exact date';
}

export const AIAssistantModal: React.FC<AIAssistantModalProps> = ({
  isOpen,
  onClose,
  userRole,
  onOpenConference,
  onNavigate,
}) => {
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      sender: 'ai',
      text:
        'Hello! I can recommend upcoming conferences from official websites using your attended conferences, confirmed papers, registrations, and abstract activity. I can also answer conference, paper, and abstract questions or guide you through Conference Gate.',
      time: 'Just now',
    },
  ]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const getPresets = () => {
    switch (userRole.toLowerCase()) {
      case 'organizer':
        return [
          'Recommend conferences related to the events I organize',
          'How do I manage abstracts and reviewer assignments?',
          'Take me to the organizer tools',
        ];
      case 'reviewer':
        return [
          'Recommend upcoming conferences based on papers I reviewed',
          'How do I find matching review opportunities?',
          'Explain how to review an abstract',
        ];
      case 'sponsor':
        return [
          'Recommend upcoming conferences related to our sponsorship history',
          'Which conference tabs show fees and sponsors?',
          'Take me to the Sponsor Marketplace',
        ];
      default:
        return [
          'Recommend upcoming conferences based on my papers and abstracts',
          'Which Calls for Papers are currently open for my research?',
          'How do I submit and track an abstract on Conference Gate?',
        ];
    }
  };

  const handleSend = async (promptToSend?: string) => {
    const text = promptToSend || inputPrompt;
    if (!text.trim() || loading) return;

    const userMsg: AssistantMessage = {
      sender: 'user',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, userMsg]);
    if (!promptToSend) setInputPrompt('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          prompt: text,
          userRole,
          context: { platform: 'Conference Gate', currentRole: userRole },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.reply) {
        throw new Error(data.error || 'AI assistant request failed');
      }
      setMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: data.reply,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isFallback: Boolean(data.isFallback),
          recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
          actions: Array.isArray(data.actions) ? data.actions : [],
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text:
            error instanceof Error
              ? `I couldn't complete that request: ${error.message}. Please try again, or open Conference Discovery to browse upcoming official conference websites.`
              : 'I could not complete that request. Please try again.',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isFallback: true,
          actions: [{ label: 'Open Conference Discovery', destination: 'discover' }],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const openConference = (recommendation: AssistantRecommendation, tab: AssistantConferenceTab) => {
    onClose();
    onOpenConference(recommendation, tab);
  };

  const navigate = (destination: string) => {
    onClose();
    onNavigate(destination);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl flex flex-col h-[680px] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="bg-sky-50 border-b border-sky-100 p-4 text-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white border border-sky-200 flex items-center justify-center text-sky-700">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">Conference Gate AI Assistant</h3>
              <p className="text-[11px] text-sky-700">
                Personalized conference, paper, abstract, and website guidance
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-white rounded-lg transition-colors cursor-pointer"
            aria-label="Close AI Assistant"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-50">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex gap-3 ${msg.sender === 'user' ? 'ml-auto flex-row-reverse max-w-[85%]' : 'max-w-full'}`}
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

              <div className={msg.sender === 'ai' ? 'min-w-0 flex-1' : ''}>
                {msg.isFallback && (
                  <div className="text-[10px] font-bold text-amber-600 mb-1 px-1">
                    Live AI explanation unavailable — verified links and navigation remain usable
                  </div>
                )}
                <div
                  className={`p-3.5 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.sender === 'user'
                      ? 'bg-blue-600 text-white rounded-tr-xs'
                      : msg.isFallback
                      ? 'bg-amber-50 text-slate-800 border border-amber-200 shadow-xs rounded-tl-xs'
                      : 'bg-white text-slate-800 border border-slate-200 shadow-xs rounded-tl-xs'
                  }`}
                >
                  {msg.text}
                </div>

                {!!msg.recommendations?.length && (
                  <div className="mt-3 space-y-2">
                    {msg.recommendations.map((recommendation, recommendationIndex) => {
                      const location = parseLocationFromSnippet(recommendation.snippet);
                      return (
                        <div
                          key={`${recommendation.link}-${recommendationIndex}`}
                          className="bg-white border border-slate-200 rounded-2xl p-3 shadow-xs"
                        >
                          <div className="flex items-start gap-3">
                            <img
                              src={recommendation.thumbnail || recommendation.favicon || '/vite.svg'}
                              alt=""
                              className="w-12 h-12 rounded-xl object-cover bg-slate-100 border border-slate-200 shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <button
                                type="button"
                                onClick={() => openConference(recommendation, recommendation.defaultTab || 'overview')}
                                className="text-left text-xs font-bold text-slate-900 hover:text-blue-700 cursor-pointer"
                              >
                                {recommendation.title}
                              </button>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                                <span className="inline-flex items-center gap-1">
                                  <Calendar className="w-3 h-3 text-blue-600" />
                                  {recommendationDate(recommendation)}
                                </span>
                                {location && (
                                  <span className="inline-flex items-center gap-1">
                                    <MapPin className="w-3 h-3 text-rose-500" />
                                    {location}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 text-[10px] text-slate-400 truncate">
                                Official source: {recommendation.displayLink}
                              </div>
                            </div>
                            <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          </div>

                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {CONFERENCE_TABS.map((tab) => (
                              <button
                                key={tab.id}
                                type="button"
                                onClick={() => openConference(recommendation, tab.id)}
                                className={`px-2.5 py-1 rounded-lg border text-[10px] font-semibold cursor-pointer transition-colors ${
                                  tab.id === (recommendation.defaultTab || 'overview')
                                    ? 'bg-blue-600 border-blue-600 text-white'
                                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-blue-50 hover:text-blue-700'
                                }`}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!!msg.actions?.length && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {msg.actions.map((action) => (
                      <button
                        key={action.destination}
                        type="button"
                        onClick={() => navigate(action.destination)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-[11px] font-bold cursor-pointer"
                      >
                        <Compass className="w-3.5 h-3.5" />
                        {action.label}
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    ))}
                  </div>
                )}

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
              <span>Checking your activity and upcoming official conference websites...</span>
            </div>
          )}
        </div>

        <div className="px-4 py-2 bg-white border-t border-slate-100 flex gap-2 overflow-x-auto">
          {getPresets().map((preset) => (
            <button
              key={preset}
              onClick={() => handleSend(preset)}
              disabled={loading}
              className="text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 px-3 py-1.5 rounded-full shrink-0 transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-50"
            >
              <span>{preset}</span>
              <ArrowRight className="w-3 h-3 text-slate-400" />
            </button>
          ))}
        </div>

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
            placeholder="Ask about conferences, papers, abstracts, or how to use Conference Gate..."
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
