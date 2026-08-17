import React, { useState } from 'react';
import { Globe, Search, Loader2, ExternalLink, AlertCircle } from 'lucide-react';
import { searchConferencesOnTheWeb, LiveSearchResult } from '../api/search';

export const LiveConferenceSearch: React.FC = () => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<LiveSearchResult[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const data = await searchConferencesOnTheWeb(query.trim());
      setResults(data);
    } catch (err: any) {
      setResults(null);
      setError(err.message || 'Live search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between gap-4 p-5 text-left cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
            <Globe className="w-4.5 h-4.5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Search the Web</h3>
            <p className="text-[11px] text-slate-500">
              Look beyond our curated catalog — search the open web for conferences we haven't added yet.
            </p>
          </div>
        </div>
        <span className="text-[10px] font-bold uppercase text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full shrink-0">
          {expanded ? 'Hide' : 'Open'}
        </span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-slate-100 pt-4">
          <p className="text-[11px] text-slate-400">
            Results come from a live web search, not our verified conference database — always confirm details on the
            organizer's official site before registering or submitting.
          </p>

          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. offshore wind engineering conference 2026"
                className="w-full pl-8 pr-3 py-2.5 bg-slate-50 focus:bg-white text-xs text-slate-800 rounded-xl border border-slate-200 focus:border-indigo-500 focus:outline-hidden transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={!query.trim() || loading}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center gap-2 shrink-0"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              <span>Search</span>
            </button>
          </form>

          {error && (
            <div className="p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs font-semibold flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!error && results && results.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-4">No web results for that search. Try different keywords.</p>
          )}

          {!error && results && results.length > 0 && (
            <div className="space-y-3">
              {results.map((result, idx) => (
                <a
                  key={idx}
                  href={result.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 p-3 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors group"
                >
                  {result.thumbnail && (
                    <img
                      src={result.thumbnail}
                      alt=""
                      className="w-14 h-14 rounded-lg object-cover shrink-0 bg-slate-200"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 group-hover:text-indigo-700 transition-colors">
                      <span className="truncate">{result.title}</span>
                      <ExternalLink className="w-3 h-3 shrink-0 text-slate-400" />
                    </div>
                    <div className="text-[10px] text-emerald-700 font-semibold truncate mt-0.5">{result.displayLink}</div>
                    <p className="text-[11px] text-slate-500 line-clamp-2 mt-1">{result.snippet}</p>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LiveConferenceSearch;
