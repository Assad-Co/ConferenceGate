import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { Logo } from './Logo';

interface FooterProps {
  onNavigateTab: (tab: string) => void;
  onOpenAIAssistant?: () => void;
  onOpenBadge?: () => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigateTab, onOpenAIAssistant, onOpenBadge }) => {
  return (
    <footer className="bg-blue-50 text-slate-500 py-12 border-t border-blue-100 mt-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
          {/* Brand Info */}
          <div className="space-y-4">
            <Logo className="h-10 w-auto" />
            <p className="text-xs text-slate-500 leading-relaxed">
              LinkedIn builds your general professional identity. Conference Gate builds and verifies your conference professional identity.
            </p>
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600">
              <ShieldCheck className="w-4 h-4" />
              <span>Verified Conference Identity Standard</span>
            </div>
          </div>

          {/* For Professionals & Reviewers */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-4">
              For Researchers & Reviewers
            </h4>
            <ul className="space-y-2 text-xs">
              <li><button onClick={() => onNavigateTab('discover')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Discover Conferences</button></li>
              <li><button onClick={() => onNavigateTab('abstracts')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Submit Abstracts & Track Status</button></li>
              <li><button onClick={() => onNavigateTab('reviewer')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Reviewer Opportunity Marketplace</button></li>
              <li><button onClick={() => onNavigateTab('profile')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Conference Gate Kudos & Badges</button></li>
              <li><button onClick={() => onNavigateTab('certificates')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Verified Digital Certificates</button></li>
            </ul>
          </div>

          {/* For Organizers & Committees */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-4">
              For Organizers & Committees
            </h4>
            <ul className="space-y-2 text-xs">
              <li><button onClick={() => onNavigateTab('organizer')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Conference Lifecycle Management</button></li>
              <li><button onClick={() => onNavigateTab('organizer')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Create Conference Wizard</button></li>
              <li><button onClick={() => onNavigateTab('organizer')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">AI Reviewer & Committee Matcher</button></li>
              <li><button onClick={() => onNavigateTab('organizer')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Drag-and-Drop Agenda Scheduler</button></li>
              <li><button onClick={onOpenBadge} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Digital Badges & QR Check-In</button></li>
            </ul>
          </div>

          {/* For Corporate Sponsors */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-4">
              Sponsorship & Platform
            </h4>
            <ul className="space-y-2 text-xs">
              <li><button onClick={() => onNavigateTab('sponsor')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Sponsorship Marketplace</button></li>
              <li><button onClick={() => onNavigateTab('sponsor')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Sponsor Marketing ROI Analytics</button></li>
              <li><button onClick={onOpenAIAssistant} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Conference Gate AI Assistant</button></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-200 flex flex-col md:flex-row items-center justify-between text-xs text-slate-400 gap-4">
          <p>© {new Date().getFullYear()} Conference Gate. The Global Gateway to Conferences. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <span>Discover. Connect. Submit. Review. Organize. Sponsor.</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
