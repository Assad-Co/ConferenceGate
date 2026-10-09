import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { Logo } from './Logo';

interface FooterProps {
  onNavigateTab: (tab: string) => void;
  /** Only the column matching the account's actual role is shown — the others link to tabs
   * that are gated off for other roles and would otherwise land on a blank page. */
  role: 'professional' | 'organizer' | 'sponsor';
}

export const Footer: React.FC<FooterProps> = ({ onNavigateTab, role }) => {
  return (
    <footer className="bg-blue-50 text-slate-500 py-12 border-t border-blue-100 mt-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
          <div className="space-y-4">
            <Logo className="h-10 w-auto" />
            <p className="text-xs text-slate-500 leading-relaxed">
              ConferenceGate connects professionals, organizers, reviewers, and sponsors across the full conference journey—from discovery and submissions to committee roles, sponsorship, and verified professional records. Turn every conference interaction into lasting professional value.
            </p>
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600">
              <ShieldCheck className="w-4 h-4" />
              <span>Verified Conference Record · Source-labeled evidence</span>
            </div>
          </div>

          {role === 'professional' && (
            <div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-4">
                For Professionals & Reviewers
              </h4>
              <ul className="space-y-2 text-xs">
                <li><button onClick={() => onNavigateTab('discover')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Discover Conferences</button></li>
                <li><button onClick={() => onNavigateTab('abstracts')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Submit Abstracts & Track Status</button></li>
                <li><button onClick={() => onNavigateTab('reviewer')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Professional Opportunities</button></li>
                <li><button onClick={() => onNavigateTab('profile')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Professional History & Evidence</button></li>
                <li><button onClick={() => onNavigateTab('certificates')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Certificates & Credentials</button></li>
              </ul>
            </div>
          )}

          {role === 'organizer' && (
            <div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-4">
                Organizer Access
              </h4>
              <ul className="space-y-2 text-xs">
                <li><button onClick={() => onNavigateTab('organizer')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Open Organizer Workspace</button></li>
                <li><button onClick={() => onNavigateTab('profile')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Profile & Notifications</button></li>
              </ul>
            </div>
          )}

          {role === 'sponsor' && (
            <div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-4">
                Sponsor Access
              </h4>
              <ul className="space-y-2 text-xs">
                <li><button onClick={() => onNavigateTab('sponsor')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Open Sponsor Workspace</button></li>
                <li><button onClick={() => onNavigateTab('profile')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Profile & Notifications</button></li>
              </ul>
            </div>
          )}
        </div>

        <div className="pt-8 border-t border-slate-200 text-xs text-slate-400">
          <p>© {new Date().getFullYear()} Conference Gate — Your Gateway to Conferences, Connections & Opportunity. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};
