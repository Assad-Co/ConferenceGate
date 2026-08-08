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
  QrCode,
  ShieldCheck,
  Home,
} from 'lucide-react';
import { UserRole, UserProfile, NotificationItem } from '../types';
import { Logo } from './Logo';

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

  const navItems: Array<{ id: string; label: string; icon: React.ElementType; match: string[] }> = [
    { id: 'home', label: 'Home', icon: Home, match: ['home'] },
    { id: 'discover', label: 'Discover', icon: Layers, match: ['discover'] },
    { id: 'abstracts', label: 'My Abstracts', icon: FileText, match: ['abstracts'] },
    { id: 'community', label: 'Feed', icon: Users, match: ['community', 'feed'] },
    ...(role === 'reviewer' ? [{ id: 'reviewer', label: 'Reviewer', icon: Award, match: ['reviewer', 'reviews'] }] : []),
    ...(role === 'organizer' ? [{ id: 'organizer', label: 'Organizer', icon: Building2, match: ['organizer'] }] : []),
    ...(role === 'sponsor' ? [{ id: 'sponsor', label: 'Sponsor', icon: Briefcase, match: ['sponsor'] }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 bg-blue-50 border-b border-blue-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 overflow-x-auto">
          {/* Brand Logo + Search, LinkedIn-style */}
          <div className="flex items-center gap-2 min-w-[132px] md:min-w-[250px] shrink-0 md:shrink">
            <button
              onClick={() => handleTabChange('home')}
              className="flex items-center group text-left cursor-pointer shrink-0"
            >
              <Logo className="h-11 w-auto group-hover:scale-105 transition-transform" />
            </button>

            <div className="hidden md:flex w-36 sm:w-44 lg:w-56 xl:w-64 min-w-[110px] shrink">
              <form onSubmit={handleSearchSubmit} className="relative w-full">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search conferences, abstracts, topics..."
                  className="w-full pl-9 pr-3 py-1.5 bg-slate-100 hover:bg-slate-200/70 focus:bg-white text-xs text-slate-800 rounded-md border border-transparent focus:border-blue-500 focus:outline-hidden transition-all placeholder:text-slate-500"
                />
                <Search className="w-4 h-4 text-slate-600 absolute left-2.5 top-1.5" />
              </form>
            </div>
          </div>

          {/* Center Icon Nav, LinkedIn-style — always visible, never tucked behind a menu */}
          <nav className="flex items-center h-14 shrink-0">
            {navItems.map((item) => {
              const isActive = item.match.includes(activeTab);
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => handleTabChange(item.id)}
                  title={item.label}
                  className={`flex flex-col items-center justify-center gap-0.5 px-2.5 sm:px-4 h-14 min-w-[44px] sm:min-w-[64px] border-b-2 transition-colors cursor-pointer shrink-0 ${
                    isActive
                      ? 'border-slate-900 text-slate-900'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${isActive ? 'fill-slate-900/10' : ''}`} strokeWidth={isActive ? 2.25 : 1.75} />
                  <span className="hidden sm:block text-[11px] font-medium">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Action Icons & Role Switcher */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* AI Assistant Button */}
            <button
              onClick={handleOpenAI}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-full text-xs font-semibold shadow-xs hover:shadow-md transition-all hover:opacity-95 cursor-pointer"
              title="Conference Gate AI Assistant"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-300 animate-pulse" />
              <span className="hidden xl:inline">AI Assistant</span>
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
                  <Award className="w-3.5 h-3.5 text-blue-500" />
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
          </div>
        </div>
      </div>
    </header>
  );
};
