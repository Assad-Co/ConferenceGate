import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Gauge, Sparkles } from 'lucide-react';
import {
  fetchMarketplaceActions,
  type MarketplaceAction,
  type MarketplaceActionQueue as MarketplaceActionQueueData,
} from '../api/marketplaceIntelligence';

interface MarketplaceActionQueueProps {
  role: 'organizer' | 'sponsor';
  onNavigate: (target: string, action: MarketplaceAction) => void;
}

const priorityClass: Record<MarketplaceAction['priority'], string> = {
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
  high: 'bg-amber-50 text-amber-700 border-amber-200',
  medium: 'bg-blue-50 text-blue-700 border-blue-200',
  low: 'bg-slate-50 text-slate-600 border-slate-200',
};

export const MarketplaceActionQueue: React.FC<MarketplaceActionQueueProps> = ({
  role,
  onNavigate,
}) => {
  const [queue, setQueue] = useState<MarketplaceActionQueueData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMarketplaceActions(role)
      .then((result) => {
        if (!cancelled) setQueue(result);
      })
      .catch(() => {
        if (!cancelled) setQueue(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-500">
        Loading marketplace action queue…
      </div>
    );
  }

  if (!queue) return null;

  const actions = queue.actions || [];
  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-xs overflow-hidden">
      <div className="px-5 sm:px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-extrabold text-blue-600 flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5" />
            Marketplace Intelligence
          </div>
          <h2 className="text-lg font-extrabold text-slate-900 mt-1">Priority Action Queue</h2>
          <p className="text-xs text-slate-500 mt-1">
            Deterministic actions from your real marketplace activity, not a black-box recommendation.
          </p>
        </div>
        <div className="text-[10px] font-bold text-slate-400">
          {actions.length} action{actions.length === 1 ? '' : 's'}
        </div>
      </div>

      {actions.length === 0 ? (
        <div className="p-6 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-slate-900">No marketplace bottleneck needs attention</div>
            <p className="text-xs text-slate-500 mt-1">
              ConferenceGate will surface a new action when a measurable gap appears.
            </p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {actions.slice(0, 4).map((item, index) => (
            <div key={item.key + ':' + (item.entityId || index)} className="p-5 sm:px-6 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full border text-[9px] uppercase font-extrabold ${priorityClass[item.priority]}`}>
                    {item.priority}
                  </span>
                  {item.metric && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-[9px] font-bold text-slate-500">
                      {item.metric.label}: {item.metric.value}
                    </span>
                  )}
                </div>
                <div className="flex items-start gap-2 mt-2">
                  {item.priority === 'critical' || item.priority === 'high' ? (
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  ) : (
                    <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="text-sm font-extrabold text-slate-900">{item.title}</div>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{item.reason}</p>
                    {item.entityTitle && (
                      <div className="text-[10px] text-slate-400 mt-1">{item.entityTitle}</div>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate(item.target, item)}
                className="px-4 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shrink-0"
              >
                Take Action
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
