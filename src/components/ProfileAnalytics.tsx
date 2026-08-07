import React, { useState } from 'react';
import {
  Eye,
  Users,
  ThumbsUp,
  MessageSquare,
  Share2,
  Bookmark,
  TrendingUp,
  TrendingDown,
  PartyPopper,
  Lightbulb,
  Award,
  BarChart3,
} from 'lucide-react';
import { sampleEngagementAnalytics } from '../data/mockData';
import { DemographicBreakdownItem } from '../types';

const compact = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString();
};

const REACTION_META = {
  like: { icon: ThumbsUp, label: 'Like', bar: 'bg-blue-600', text: 'text-blue-700' },
  kudos: { icon: Award, label: 'Kudos', bar: 'bg-violet-600', text: 'text-violet-700' },
  celebrate: { icon: PartyPopper, label: 'Celebrate', bar: 'bg-amber-500', text: 'text-amber-700' },
  insightful: { icon: Lightbulb, label: 'Insightful', bar: 'bg-yellow-400', text: 'text-yellow-700' },
} as const;

const DEMOGRAPHIC_TABS: Array<{ id: keyof typeof sampleEngagementAnalytics.demographics; label: string }> = [
  { id: 'industry', label: 'Industry' },
  { id: 'company', label: 'Company' },
  { id: 'companySize', label: 'Company Size' },
  { id: 'location', label: 'Location' },
  { id: 'jobTitle', label: 'Seniority' },
];

const DeltaBadge: React.FC<{ deltaPct: number }> = ({ deltaPct }) => {
  const isUp = deltaPct >= 0;
  const Icon = isUp ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${
        isUp ? 'text-emerald-600' : 'text-rose-600'
      }`}
    >
      <Icon className="w-3 h-3" />
      {isUp ? '+' : ''}
      {deltaPct.toFixed(1)}%
    </span>
  );
};

const StatTile: React.FC<{
  icon: React.ElementType;
  label: string;
  value: number;
  deltaPct: number;
}> = ({ icon: Icon, label, value, deltaPct }) => (
  <div className="p-4 bg-white rounded-2xl border border-slate-200 space-y-2">
    <div className="flex items-center justify-between">
      <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
        <Icon className="w-4 h-4" />
      </span>
      <DeltaBadge deltaPct={deltaPct} />
    </div>
    <div className="text-xl font-extrabold text-slate-900">{compact(value)}</div>
    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</div>
  </div>
);

const ImpressionsTrendChart: React.FC<{ data: { date: string; impressions: number }[] }> = ({ data }) => {
  const width = 640;
  const height = 160;
  const padTop = 16;
  const padBottom = 24;
  const padX = 8;
  const plotH = height - padTop - padBottom;
  const max = Math.ceil(Math.max(...data.map((d) => d.impressions)) / 200) * 200;

  const points = data.map((d, i) => {
    const x = padX + (i * (width - padX * 2)) / (data.length - 1);
    const y = padTop + (1 - d.impressions / max) * plotH;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${(height - padBottom).toFixed(1)} L${points[0].x.toFixed(1)},${(height - padBottom).toFixed(1)} Z`;

  const gridYs = [padTop, padTop + plotH / 2, padTop + plotH];
  const last = points[points.length - 1];
  const labelIdxs = [0, Math.floor((data.length - 1) / 2), data.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Impressions trend over the last 14 days">
      {gridYs.map((y, i) => (
        <line key={i} x1={padX} x2={width - padX} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
      ))}
      <path d={areaPath} fill="#2563eb" opacity={0.1} stroke="none" />
      <path d={linePath} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r={4} fill="#2563eb" stroke="#ffffff" strokeWidth={2} />
      <text x={Math.min(last.x, width - 40)} y={last.y - 10} textAnchor="end" className="fill-slate-900 text-[11px] font-bold">
        {compact(last.impressions)}
      </text>
      {labelIdxs.map((idx) => (
        <text
          key={idx}
          x={points[idx].x}
          y={height - 6}
          textAnchor={idx === 0 ? 'start' : idx === data.length - 1 ? 'end' : 'middle'}
          className="fill-slate-400 text-[10px] font-medium"
        >
          {points[idx].date}
        </text>
      ))}
    </svg>
  );
};

const DemographicBars: React.FC<{ items: DemographicBreakdownItem[] }> = ({ items }) => {
  const maxPct = Math.max(...items.map((i) => i.pct));
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <span className="w-32 sm:w-40 shrink-0 text-[11px] font-semibold text-slate-700 truncate" title={item.label}>
            {item.label}
          </span>
          <span className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <span
              className="block h-full bg-blue-600 rounded-r-md"
              style={{ width: `${Math.max((item.pct / maxPct) * 100, 4)}%` }}
            />
          </span>
          <span className="w-10 shrink-0 text-right text-[11px] font-bold text-slate-900 tabular-nums">{item.pct}%</span>
        </div>
      ))}
    </div>
  );
};

export const ProfileAnalytics: React.FC = () => {
  const data = sampleEngagementAnalytics;
  const [activeDemo, setActiveDemo] = useState<keyof typeof data.demographics>('industry');

  const totalReactions = data.reactionBreakdown.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600" />
            Engagement Analytics
          </h3>
          <p className="text-[11px] text-slate-500">How your posts and profile are performing · {data.period}</p>
        </div>
      </div>

      {/* Summary Stat Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile icon={Eye} label="Impressions" value={data.summary.impressions.value} deltaPct={data.summary.impressions.deltaPct} />
        <StatTile icon={Users} label="Impression Views" value={data.summary.impressionViews.value} deltaPct={data.summary.impressionViews.deltaPct} />
        <StatTile icon={ThumbsUp} label="Reactions" value={data.summary.reactions.value} deltaPct={data.summary.reactions.deltaPct} />
        <StatTile icon={MessageSquare} label="Comments" value={data.summary.comments.value} deltaPct={data.summary.comments.deltaPct} />
        <StatTile icon={Share2} label="Reposts" value={data.summary.reposts.value} deltaPct={data.summary.reposts.deltaPct} />
        <StatTile icon={Bookmark} label="Saves" value={data.summary.saves.value} deltaPct={data.summary.saves.deltaPct} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Impressions Trend */}
        <div className="lg:col-span-2 p-5 bg-white rounded-2xl border border-slate-200 space-y-3">
          <h4 className="text-xs font-bold text-slate-900">Impressions Over Time</h4>
          <ImpressionsTrendChart data={data.impressionsTrend} />
        </div>

        {/* Reaction Breakdown */}
        <div className="p-5 bg-white rounded-2xl border border-slate-200 space-y-4">
          <h4 className="text-xs font-bold text-slate-900">Reaction Breakdown</h4>
          <span className="flex w-full h-3 rounded-full overflow-hidden gap-0.5">
            {data.reactionBreakdown.map((r) => (
              <span
                key={r.type}
                className={REACTION_META[r.type].bar}
                style={{ width: `${(r.count / totalReactions) * 100}%` }}
              />
            ))}
          </span>
          <div className="space-y-2">
            {data.reactionBreakdown.map((r) => {
              const meta = REACTION_META[r.type];
              const Icon = meta.icon;
              return (
                <div key={r.type} className="flex items-center justify-between text-[11px]">
                  <span className={`flex items-center gap-1.5 font-semibold ${meta.text}`}>
                    <Icon className="w-3.5 h-3.5" />
                    {meta.label}
                  </span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {r.count} <span className="text-slate-400 font-medium">({Math.round((r.count / totalReactions) * 100)}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top Performing Posts */}
      <div className="p-5 bg-white rounded-2xl border border-slate-200 space-y-4">
        <h4 className="text-xs font-bold text-slate-900">Top Performing Posts</h4>
        <div className="space-y-3">
          {data.topPosts.map((post, idx) => (
            <div key={post.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex gap-3">
              <span className="w-6 h-6 shrink-0 rounded-full bg-blue-100 text-blue-700 text-[11px] font-extrabold flex items-center justify-center">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {post.conferenceBadge && (
                    <span className="px-2 py-0.5 bg-white border border-slate-200 rounded-full text-[10px] font-bold text-slate-600">
                      {post.conferenceBadge}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-400 font-medium">{post.timestamp}</span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed line-clamp-2">{post.excerpt}</p>
                <div className="flex items-center gap-4 pt-1 text-[11px] text-slate-500 font-semibold flex-wrap">
                  <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{compact(post.impressions)}</span>
                  <span className="flex items-center gap-1"><ThumbsUp className="w-3.5 h-3.5" />{compact(post.reactions)}</span>
                  <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" />{compact(post.comments)}</span>
                  <span className="flex items-center gap-1"><Share2 className="w-3.5 h-3.5" />{compact(post.reposts)}</span>
                  <span className="flex items-center gap-1"><Bookmark className="w-3.5 h-3.5" />{compact(post.saves)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Audience Demographics */}
      <div className="p-5 bg-white rounded-2xl border border-slate-200 space-y-4">
        <h4 className="text-xs font-bold text-slate-900">Audience Demographics</h4>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {DEMOGRAPHIC_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveDemo(tab.id)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
                activeDemo === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <DemographicBars items={data.demographics[activeDemo]} />
      </div>
    </div>
  );
};
