import React, { useState } from 'react';
import {
  Search,
  Building2,
  Calendar,
  Award,
  FileText,
  Users,
  Bell,
  MessageSquare,
  Sparkles,
  ChevronDown,
  UserCheck,
  Briefcase,
  Layers,
  Menu,
  X,
  QrCode,
  ShieldCheck,
} from 'lucide-react';
import { UserRole, UserProfile, NotificationItem } from '../types';
import { LogoMark, GateGlyph } from './Logo';

interface NavbarProps {
  currentRole?: UserRole;
  activeRole?: UserRole;
  onRoleChange?: (role: UserRole) => void;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  setActiveTab?: (tab: string) => void;
  userProfile?: UserProfile;
  notifications?: NotificationItem[];
  unreadMessageCount?: number;
  onOpenAIAssistant?: () => void;
  onOpenAIModal?: () => void;
  onOpenMessages?: () => void;
  onOpenDigitalBadge?: () => void;
  onSearch?: (query: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentRole,
  activeRole,
  onRoleChange = (_role: UserRole) => {},
  activeTab = 'home',
  onTabChange,
  setActiveTab,
  userProfile,
  notifications = [],
  unreadMessageCount = 0,
  onOpenAIAssistant,
  onOpenAIModal,
  onOpenMessages = () => {},
  onOpenDigitalBadge = () => {},
  onSearch = (_query: string) => {},
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const role = (activeRole || currentRole || 'Professional').toLowerCase();
  const handleTabChange = onTabChange || setActiveTab || (() => {});
  const handleOpenAI = onOpenAIAssistant || onOpenAIModal || (() => {});
  const profile = userProfile || {
    name: 'Dr. Elena Rostova',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=200&q=80',
    title: 'Senior Geoscience Researcher',
  };

  const safeNotifications = notifications || [];
  const unreadNotifCount = safeNotifications.filter((n) => !n.read).length;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      onSearch(searchQuery);
      handleTabChange('discover');
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand Logo & Tagline */}
          <div className="flex items-center gap-6">
            <button
              onClick={() => handleTabChange('home')}
              className="flex items-center gap-2.5 group text-left cursor-pointer"
            >
              <LogoMark size={38} className="shrink-0 group-hover:scale-105 transition-transform" />
              <div className="hidden sm:block leading-none">
                <span className="text-[15px] font-extrabold text-slate-900 tracking-tight block">
                  CONFERENCE
                </span>
                <span className="flex items-center text-xl font-extrabold text-blue-500 tracking-tight">
                  G
                  <GateGlyph className="inline-block w-[0.72em] h-[0.72em] mx-[0.02em] -translate-y-[0.02em]" />
                  TE
                </span>
                <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider block mt-0.5">
                  The Global Gateway to Conferences
                </span>
              </div>
            </button>

            {/* Quick Navigation Links */}
            <nav className="hidden lg:flex items-center gap-1 text-sm font-medium">
              <button
                onClick={() => handleTabChange('home')}
                className={`px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                  activeTab === 'home'
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                Home
              </button>
              <button
                onClick={() => handleTabChange('discover')}
                className={`px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                  activeTab === 'discover'
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                Discover Conferences
              </button>
              <button
                onClick={() => handleTabChange('abstracts')}
                className={`px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                  activeTab === 'abstracts'
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                My Abstracts
              </button>
              <button
                onClick={() => handleTabChange('community')}
                className={`px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                  activeTab === 'community' || activeTab === 'feed'
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                Conference Feed
              </button>
              {role === 'reviewer' && (
                <button
                  onClick={() => handleTabChange('reviewer')}
                  className={`px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                    activeTab === 'reviewer' || activeTab === 'reviews'
                      ? 'bg-blue-50 text-blue-700 font-semibold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Reviewer Workspace
                </button>
              )}
              {role === 'organizer' && (
                <button
                  onClick={() => handleTabChange('organizer')}
                  className={`px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                    activeTab === 'organizer'
                      ? 'bg-blue-50 text-blue-700 font-semibold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Organizer Command Center
                </button>
              )}
              {role === 'sponsor' && (
                <button
                  onClick={() => handleTabChange('sponsor')}
                  className={`px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                    activeTab === 'sponsor'
                      ? 'bg-blue-50 text-blue-700 font-semibold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Sponsor Portal
                </button>
              )}
            </nav>
          </div>

          {/* Global Search Bar */}
          <div className="hidden md:flex flex-1 max-w-xs mx-4">
            <form onSubmit={handleSearchSubmit} className="w-full relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conferences, abstracts, topics..."
                className="w-full pl-9 pr-4 py-1.5 bg-slate-100 hover:bg-slate-200/70 focus:bg-white text-xs text-slate-800 rounded-full border border-transparent focus:border-blue-500 focus:outline-hidden transition-all placeholder:text-slate-400"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2" />
            </form>
          </div>

          {/* Right Action Icons & Role Switcher */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* AI Assistant Button */}
            <button
              onClick={handleOpenAI}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-full text-xs font-semibold shadow-xs hover:shadow-md transition-all hover:opacity-95 cursor-pointer"
              title="Conference Gate AI Assistant"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
              <span className="hidden sm:inline">AI Assistant</span>
            </button>

            {/* Role Switcher Pill */}
            <div className="relative group">
              <div className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 rounded-lg text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-200/80 cursor-pointer">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 mr-1">Role:</span>
                <span className="capitalize text-blue-700 font-bold">{role}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-xl border border-slate-100 py-1.5 hidden group-hover:block z-50">
                <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Switch Active Context
                </div>
                <button
                  onClick={() => {
                    onRoleChange('Professional' as UserRole);
                    handleTabChange('home');
                  }}
                  className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-blue-50 flex items-center justify-between ${
                    role === 'professional' ? 'text-blue-600 font-bold bg-blue-50/50' : 'text-slate-700'
                  }`}
                >
                  <span>Professional / Author</span>
                  <UserCheck className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    onRoleChange('Reviewer' as UserRole);
                    handleTabChange('reviewer');
                  }}
                  className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-blue-50 flex items-center justify-between ${
                    role === 'reviewer' ? 'text-blue-600 font-bold bg-blue-50/50' : 'text-slate-700'
                  }`}
                >
                  <span>Abstract Reviewer</span>
                  <Award className="w-3.5 h-3.5 text-amber-500" />
                </button>
                <button
                  onClick={() => {
                    onRoleChange('Organizer' as UserRole);
                    handleTabChange('organizer');
                  }}
                  className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-blue-50 flex items-center justify-between ${
                    role === 'organizer' ? 'text-blue-600 font-bold bg-blue-50/50' : 'text-slate-700'
                  }`}
                >
                  <span>Conference Organizer</span>
                  <Building2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    onRoleChange('Sponsor' as UserRole);
                    handleTabChange('sponsor');
                  }}
                  className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-blue-50 flex items-center justify-between ${
                    role === 'sponsor' ? 'text-blue-600 font-bold bg-blue-50/50' : 'text-slate-700'
                  }`}
                >
                  <span>Corporate Sponsor</span>
                  <Briefcase className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Digital Event Badge Quick Access */}
            <button
              onClick={onOpenDigitalBadge}
              className="p-2 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors relative cursor-pointer"
              title="Digital Attendee Badge & QR Check-In"
            >
              <QrCode className="w-4 h-4" />
            </button>

            {/* Direct Messages Icon */}
            <button
              onClick={onOpenMessages}
              className="p-2 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors relative cursor-pointer"
              title="Direct Messages"
            >
              <MessageSquare className="w-4 h-4" />
              {unreadMessageCount > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-blue-600 rounded-full ring-2 ring-white"></span>
              )}
            </button>

            {/* Notifications Dropdown */}
            <div className="relative">
              <button
                onClick={() => setNotificationsOpen(!notificationsOpen)}
                className="p-2 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors relative cursor-pointer"
                title="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadNotifCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full ring-2 ring-white"></span>
                )}
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-xl border border-slate-200 py-3 z-50">
                  <div className="px-4 pb-2 border-b border-slate-100 flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Notifications
                    </h4>
                    <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      {unreadNotifCount} New
                    </span>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
                    {safeNotifications.map((notif) => (
                      <div
                        key={notif.id}
                        className={`p-3 text-xs hover:bg-slate-50 transition-colors ${
                          !notif.read ? 'bg-blue-50/30' : ''
                        }`}
                      >
                        <div className="font-semibold text-slate-900 mb-0.5">{notif.title}</div>
                        <div className="text-slate-600 leading-snug">{notif.message}</div>
                        <div className="text-[10px] text-slate-400 mt-1">{notif.timestamp}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Profile Avatar & Menu */}
            <button
              onClick={() => handleTabChange('profile')}
              className="flex items-center gap-2 p-1 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer border border-slate-200"
            >
              <img
                src={profile.avatar}
                alt={profile.name}
                className="w-8 h-8 rounded-lg object-cover ring-1 ring-blue-500/30"
              />
              <div className="hidden xl:block text-left pr-1">
                <div className="text-xs font-bold text-slate-900 line-clamp-1">{profile.name}</div>
                <div className="text-[10px] font-medium text-emerald-600 flex items-center gap-0.5">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Verified Identity</span>
                </div>
              </div>
            </button>

            {/* Mobile Hamburger Menu */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 text-slate-600 hover:text-slate-900 rounded-lg"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-white border-b border-slate-200 px-4 py-3 space-y-2">
          <button
            onClick={() => {
              handleTabChange('home');
              setMobileMenuOpen(false);
            }}
            className="w-full text-left py-2 text-sm font-medium text-slate-800 hover:text-blue-600"
          >
            Home
          </button>
          <button
            onClick={() => {
              handleTabChange('discover');
              setMobileMenuOpen(false);
            }}
            className="w-full text-left py-2 text-sm font-medium text-slate-800 hover:text-blue-600"
          >
            Discover Conferences
          </button>
          <button
            onClick={() => {
              handleTabChange('abstracts');
              setMobileMenuOpen(false);
            }}
            className="w-full text-left py-2 text-sm font-medium text-slate-800 hover:text-blue-600"
          >
            My Abstract Submissions
          </button>
          <button
            onClick={() => {
              handleTabChange('community');
              setMobileMenuOpen(false);
            }}
            className="w-full text-left py-2 text-sm font-medium text-slate-800 hover:text-blue-600"
          >
            Conference Feed
          </button>
          <button
            onClick={() => {
              handleTabChange('reviewer');
              setMobileMenuOpen(false);
            }}
            className="w-full text-left py-2 text-sm font-medium text-slate-800 hover:text-blue-600"
          >
            Reviewer Portal
          </button>
          <button
            onClick={() => {
              handleTabChange('organizer');
              setMobileMenuOpen(false);
            }}
            className="w-full text-left py-2 text-sm font-medium text-slate-800 hover:text-blue-600"
          >
            Organizer Command Center
          </button>
          <button
            onClick={() => {
              handleTabChange('sponsor');
              setMobileMenuOpen(false);
            }}
            className="w-full text-left py-2 text-sm font-medium text-slate-800 hover:text-blue-600"
          >
            Sponsor Portal
          </button>
          <button
            onClick={() => {
              handleTabChange('profile');
              setMobileMenuOpen(false);
            }}
            className="w-full text-left py-2 text-sm font-medium text-slate-800 hover:text-blue-600"
          >
            My Conference Profile & Verified Identity
          </button>
        </div>
      )}
    </header>
  );
};
