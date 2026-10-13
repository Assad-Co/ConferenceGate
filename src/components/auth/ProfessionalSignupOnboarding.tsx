import React from 'react';
import {
  ArrowRight,
  BadgeCheck,
  CalendarSearch,
  FileText,
  Sparkles,
  UserRoundCheck,
} from 'lucide-react';
import { Logo } from '../Logo';
import type { AuthUser } from '../../api/auth';

interface ProfessionalSignupOnboardingProps {
  user: AuthUser;
  onContinue: () => void;
}

const STEPS = [
  {
    number: 1,
    title: 'Complete your profile',
    description: 'Add your expertise, organization, research interests, and LinkedIn profile.',
    icon: UserRoundCheck,
  },
  {
    number: 2,
    title: 'Find conferences',
    description: 'Search worldwide conferences by field, country, dates, organizer, and topic.',
    icon: CalendarSearch,
  },
  {
    number: 3,
    title: 'Submit an abstract or register',
    description: 'Submit or register directly when the conference supports those actions.',
    icon: FileText,
  },
  {
    number: 4,
    title: 'Get invited',
    description: 'Enable Reviewer, Technical Committee, Session Chair, and Speaker availability.',
    icon: BadgeCheck,
  },
];

export const ProfessionalSignupOnboarding: React.FC<ProfessionalSignupOnboardingProps> = ({ user, onContinue }) => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 via-white to-slate-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-3xl">
        <div className="flex justify-center mb-6">
          <Logo className="h-10 w-auto" />
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
          <div className="px-6 sm:px-10 pt-8 sm:pt-10 pb-6 text-center border-b border-slate-100 bg-gradient-to-b from-blue-50/70 to-white">
            <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-6 h-6" />
            </div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-blue-700 mb-2">Your professional account is ready</p>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-950">Welcome to Conference Gate{user.name ? `, ${user.name.split(' ')[0]}` : ''}</h1>
            <p className="text-sm text-slate-500 mt-3 max-w-xl mx-auto leading-relaxed">
              Start with these four simple steps to get the most from Conference Gate.
            </p>
          </div>

          <div className="p-5 sm:p-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {STEPS.map((step) => {
                const Icon = step.icon;
                return (
                  <div key={step.number} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5 flex gap-4">
                    <div className="shrink-0 w-10 h-10 rounded-xl bg-blue-900 text-white flex items-center justify-center font-extrabold text-sm">
                      {step.number}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4 text-blue-700 shrink-0" />
                        <h2 className="text-sm font-extrabold text-slate-900">{step.title}</h2>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed mt-1.5">{step.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-7 flex flex-col items-center">
              <button
                type="button"
                onClick={onContinue}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white px-6 py-3 text-sm font-extrabold transition-colors cursor-pointer shadow-sm"
              >
                Go to Conference Gate
                <ArrowRight className="w-4 h-4" />
              </button>
              <p className="text-[11px] text-slate-400 mt-3 text-center">
                You can update your professional profile and availability at any time from your Profile and Opportunities areas.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
