import React from 'react';
import { ThumbsUp, PartyPopper, Lightbulb, Award } from 'lucide-react';

export type ReactionType = 'like' | 'celebrate' | 'insightful' | 'kudos';

export const REACTION_META: Record<ReactionType, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  like: { icon: ThumbsUp, color: 'text-blue-600', bg: 'bg-blue-600', label: 'Like' },
  celebrate: { icon: PartyPopper, color: 'text-amber-600', bg: 'bg-amber-500', label: 'Celebrate' },
  insightful: { icon: Lightbulb, color: 'text-yellow-500', bg: 'bg-yellow-400', label: 'Insightful' },
  kudos: { icon: Award, color: 'text-violet-600', bg: 'bg-violet-600', label: 'Kudos' },
};

export const reactionCountKey = (t: ReactionType): 'likes' | 'celebrates' | 'insightful' | 'kudos' =>
  t === 'like' ? 'likes' : t === 'celebrate' ? 'celebrates' : t;
