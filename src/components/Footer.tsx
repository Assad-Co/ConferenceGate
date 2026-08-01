import React from 'react';
import { ShieldCheck, Globe, Award, Sparkles, Building2, Layers } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-slate-900 text-slate-400 py-12 border-t border-slate-800 mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
          {/* Brand Info */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-md">
                CG
              </div>
              <span className="text-lg font-bold text-white tracking-tight">
                CONFERENCE <span className="text-blue-400">GATE</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              LinkedIn builds your general professional identity. Conference Gate builds and verifies your conference professional identity.
            </p>
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
              <span>Verified Conference Identity Standard</span>
            </div>
          </div>

          {/* For Professionals & Reviewers */}
          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4">
              For Researchers & Reviewers
            </h4>
            <ul className="space-y-2 text-xs">
              <li><a href="#discover" className="hover:text-white transition-colors">Discover Conferences</a></li>
              <li><a href="#abstracts" className="hover:text-white transition-colors">Submit Abstracts & Track Status</a></li>
              <li><a href="#reviews" className="hover:text-white transition-colors">Reviewer Opportunity Marketplace</a></li>
              <li><a href="#kudos" className="hover:text-white transition-colors">Conference Gate Kudos & Badges</a></li>
              <li><a href="#certificates" className="hover:text-white transition-colors">Verified Digital Certificates</a></li>
            </ul>
          </div>

          {/* For Organizers & Committees */}
          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4">
              For Organizers & Committees
            </h4>
            <ul className="space-y-2 text-xs">
              <li><a href="#organizer" className="hover:text-white transition-colors">Conference Lifecycle Management</a></li>
              <li><a href="#wizard" className="hover:text-white transition-colors">Create Conference Wizard</a></li>
              <li><a href="#ai-matcher" className="hover:text-white transition-colors">AI Reviewer & Committee Matcher</a></li>
              <li><a href="#agenda" className="hover:text-white transition-colors">Drag-and-Drop Agenda Scheduler</a></li>
              <li><a href="#checkin" className="hover:text-white transition-colors">Digital Badges & QR Check-In</a></li>
            </ul>
          </div>

          {/* For Corporate Sponsors */}
          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4">
              Sponsorship & Platform
            </h4>
            <ul className="space-y-2 text-xs">
              <li><a href="#sponsor" className="hover:text-white transition-colors">Sponsorship Marketplace</a></li>
              <li><a href="#roi" className="hover:text-white transition-colors">Sponsor Marketing ROI Analytics</a></li>
              <li><a href="#ai-assistant" className="hover:text-white transition-colors">Conference Gate AI Assistant</a></li>
              <li><a href="#privacy" className="hover:text-white transition-colors">Privacy & Role-Based Access</a></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-800/80 flex flex-col md:flex-row items-center justify-between text-xs text-slate-500 gap-4">
          <p>© {new Date().getFullYear()} Conference Gate. The Global Gateway to Conferences. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <span>Discover. Connect. Submit. Review. Organize. Sponsor.</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
