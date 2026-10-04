import fs from 'node:fs';

const path = 'src/components/CommunityFeed.tsx';
let text = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  text = text.replace(from, to);
}

replaceOnce(
  "import React, { useState } from 'react';",
  "import React, { useMemo, useState } from 'react';",
  'React import'
);

replaceOnce(
  "  Image as ImageIcon,\n  MapPin,\n",
  "  MapPin,\n  Search,\n  Clock,\n",
  'community icons'
);

replaceOnce(
  "  const [moreMenuOpenId, setMoreMenuOpenId] = useState<string | null>(null);\n  const { showToast } = useToast();",
  "  const [moreMenuOpenId, setMoreMenuOpenId] = useState<string | null>(null);\n" +
  "  const [feedSearch, setFeedSearch] = useState('');\n" +
  "  const [feedFilter, setFeedFilter] = useState<'all' | 'cfp' | 'announcement' | 'speaker' | 'sponsorship' | 'review' | 'celebration' | 'saved'>('all');\n" +
  "  const [composerConferenceId, setComposerConferenceId] = useState('');\n" +
  "  const { showToast } = useToast();",
  'community state'
);

const insertion = `  const composerName = userProfile?.name || 'You';\n`;
const helperBlock = `  const composerName = userProfile?.name || 'You';

  const visiblePosts = useMemo(() => {
    const term = feedSearch.trim().toLowerCase();
    return (posts || []).filter((post) => {
      if (hiddenPostIds[post.id]) return false;
      if (feedFilter === 'saved' && !post.isSaved) return false;
      if (feedFilter !== 'all' && feedFilter !== 'saved' && post.postType !== feedFilter) return false;
      if (!term) return true;
      return [post.content, post.authorName, post.authorTitle, post.authorOrg, post.postType]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [posts, hiddenPostIds, feedFilter, feedSearch]);

  const startComposerWith = (starter: string) => {
    setComposerOpen(true);
    setNewPostText((current) => current.trim() ? current : starter);
  };

  const tagConference = (conferenceId: string) => {
    setComposerConferenceId(conferenceId);
    const conference = conferences.find((item) => item.id === conferenceId);
    if (!conference) return;
    setComposerOpen(true);
    setNewPostText((current) => {
      const tag = 'Conference: ' + conference.title;
      if (current.includes(tag)) return current;
      return current.trim() ? tag + '\n\n' + current : tag + '\n\n';
    });
  };
`;
replaceOnce(insertion, helperBlock, 'community helpers');

const deadTools = `                <div className="flex items-center gap-1">
                  <span className="p-2 rounded-lg text-slate-400" title="Add photo (coming soon)">
                    <ImageIcon className="w-4 h-4" />
                  </span>
                  <span className="p-2 rounded-lg text-slate-400" title="Attach document (coming soon)">
                    <FileText className="w-4 h-4" />
                  </span>
                  <span className="p-2 rounded-lg text-slate-400" title="Tag a conference (coming soon)">
                    <MapPin className="w-4 h-4" />
                  </span>
                  <span className="p-2 rounded-lg text-slate-400" title="Celebrate a milestone (coming soon)">
                    <PartyPopper className="w-4 h-4" />
                  </span>
                </div>`;

const usefulTools = `                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => startComposerWith('Call for Papers: ')}
                    className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 inline-flex items-center gap-1.5"
                    title="Start a call-for-papers update"
                  >
                    <FileText className="w-3.5 h-3.5" /> CFP
                  </button>
                  <button
                    type="button"
                    onClick={() => startComposerWith('Deadline reminder: ')}
                    className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 inline-flex items-center gap-1.5"
                    title="Start a deadline reminder"
                  >
                    <Clock className="w-3.5 h-3.5" /> Deadline
                  </button>
                  <button
                    type="button"
                    onClick={() => startComposerWith('Technical question: ')}
                    className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 inline-flex items-center gap-1.5"
                    title="Start a technical discussion"
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> Question
                  </button>
                  <button
                    type="button"
                    onClick={() => startComposerWith('Conference milestone: ')}
                    className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 inline-flex items-center gap-1.5"
                    title="Share a conference milestone"
                  >
                    <PartyPopper className="w-3.5 h-3.5" /> Milestone
                  </button>
                </div>`;
replaceOnce(deadTools, usefulTools, 'replace dead composer tools');

const textareaEnd = `              ></textarea>\n\n              <div className="flex items-center justify-between pt-1">`;
const conferencePicker = `              ></textarea>

              {conferences.length > 0 && (
                <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-[10px] font-bold text-slate-500 shrink-0">Tag conference</span>
                  <select
                    value={composerConferenceId}
                    onChange={(event) => tagConference(event.target.value)}
                    className="flex-1 min-w-0 bg-transparent text-[11px] font-semibold text-slate-700 focus:outline-hidden"
                  >
                    <option value="">Choose a conference…</option>
                    {conferences.map((conference) => (
                      <option key={conference.id} value={conference.id}>{conference.title}</option>
                    ))}
                  </select>
                </label>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">`;
replaceOnce(textareaEnd, conferencePicker, 'conference picker');

replaceOnce(
  "      {/* Posts List */}\n      {(posts || []).filter((post) => !hiddenPostIds[post.id]).length === 0 ? (",
  `      {/* Feed controls */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <label className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              value={feedSearch}
              onChange={(event) => setFeedSearch(event.target.value)}
              placeholder="Search posts, people, organizations or topics…"
              className="w-full bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden"
            />
          </label>
          <div className="px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-[11px] font-bold text-blue-700 flex items-center justify-center min-w-[96px]">
            {visiblePosts.length} shown
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {([
            ['all', 'All'],
            ['cfp', 'CFPs'],
            ['announcement', 'Announcements'],
            ['speaker', 'Speakers'],
            ['sponsorship', 'Sponsorship'],
            ['review', 'Peer Review'],
            ['celebration', 'Milestones'],
            ['saved', 'Saved'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFeedFilter(value)}
              className={feedFilter === value
                ? 'px-3 py-1.5 rounded-full bg-blue-900 text-white text-[10px] font-bold whitespace-nowrap'
                : 'px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-slate-600 hover:text-blue-700 hover:border-blue-200 text-[10px] font-bold whitespace-nowrap'}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Posts List */}
      {visiblePosts.length === 0 ? (`,
  'feed controls'
);

text = text.replace(
  "          <p className=\"text-sm font-bold text-slate-500\">No posts yet</p>\n          <p className=\"text-xs text-slate-400 max-w-sm mx-auto\">\n            Be the first to share an update — a paper acceptance, a call for papers, or a technical question.\n          </p>",
  "          <p className=\"text-sm font-bold text-slate-500\">{posts.length === 0 ? 'No posts yet' : 'No posts match this view'}</p>\n          <p className=\"text-xs text-slate-400 max-w-sm mx-auto\">\n            {posts.length === 0\n              ? 'Be the first to share an update — a paper acceptance, a call for papers, or a technical question.'\n              : 'Try another feed filter or clear the search to see more conference activity.'}\n          </p>"
);

text = text.replace(
  "          {(posts || []).filter((post) => !hiddenPostIds[post.id]).map((post) => {",
  "          {visiblePosts.map((post) => {"
);

fs.writeFileSync(path, text);
console.log('Phase 15 Community utility applied');
