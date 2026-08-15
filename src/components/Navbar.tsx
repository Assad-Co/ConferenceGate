import React, { useEffect, useRef, useState } from 'react';
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
  Camera,
  LogOut,
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
  organizerIdentity?: { name: string; logo: string };
  sponsorIdentity?: { name: string; logo: string };
  onOrganizerLogoChange?: (dataUrl: string) => void;
  onSponsorLogoChange?: (dataUrl: string) => void;
  notifications?: NotificationItem[];
  sponsorAlerts?: Array<{ id: string; read: boolean }>;
  unreadMessageCount?: number;
  onOpenAIAssistant?: () => void;
  onOpenAIModal?: () => void;
  onOpenMessages?: () => void;
  onOpenDigitalBadge?: () => void;
  onSearch?: (query: string) => void;
  onOpenNotifications?: () => void;
  onOpenSponsorAlerts?: () => void;
  accountEmail?: string;
  onLogout?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentRole,
  activeRole,
  onRoleChange = (_role: UserRole) => {},
  activeTab = 'home',
  onTabChange,
  setActiveTab,
  userProfile,
  organizerIdentity,
  sponsorIdentity,
  onOrganizerLogoChange,
  onSponsorLogoChange,
  notifications = [],
  sponsorAlerts = [],
  unreadMessageCount = 0,
  onOpenAIAssistant,
  onOpenAIModal,
  onOpenMessages = () => {},
  onOpenDigitalBadge = () => {},
  onSearch = (_query: string) => {},
  onOpenNotifications,
  onOpenSponsorAlerts,
  accountEmail,
  onLogout,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [roleMenuPos, setRoleMenuPos] = useState<{ top: number; right: number } | null>(null);
  const roleTriggerRef = useRef<HTMLButtonElement>(null);
  const roleMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!roleMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (roleTriggerRef.current?.contains(target) || roleMenuRef.current?.contains(target)) return;
      setRoleMenuOpen(false);
    };
    const closeOnScroll = () => setRoleMenuOpen(false);
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', closeOnScroll);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('resize', closeOnScroll);
    };
  }, [roleMenuOpen]);

  const toggleRoleMenu = () => {
    if (!roleMenuOpen && roleTriggerRef.current) {
      const rect = roleTriggerRef.current.getBoundingClientRect();
      setRoleMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    setRoleMenuOpen((open) => !open);
  };

  const role = (activeRole || currentRole || 'Professional').toLowerCase();
  const handleTabChange = onTabChange || setActiveTab || (() => {});
  const handleOpenNotifications = onOpenNotifications || (() => handleTabChange('profile'));
  const isSponsorRole = role === 'sponsor';
  const handleOpenSponsorAlerts = onOpenSponsorAlerts || (() => handleTabChange('sponsor'));
  const handleOpenAI = onOpenAIAssistant || onOpenAIModal || (() => {});
  const isOrganizerRole = role === 'organizer';
  const defaultProfile = userProfile || {
    name: 'Dr. Elena Rostova',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=200&q=80',
    title: 'Senior Geoscience Researcher',
  };

  const identity = isOrganizerRole && organizerIdentity
    ? { name: organizerIdentity.name, avatar: organizerIdentity.logo }
    : isSponsorRole && sponsorIdentity
    ? { name: sponsorIdentity.name, avatar: sponsorIdentity.logo }
    : defaultProfile;
  const identityLabel = isOrganizerRole ? 'Verified Organizer' : isSponsorRole ? 'Verified Sponsor' : 'Verified Identity';
  const identityTab = isOrganizerRole ? 'organizer' : isSponsorRole ? 'sponsor' : 'profile';
  const canCustomizeLogo = (isOrganizerRole && !!onOrganizerLogoChange) || (isSponsorRole && !!onSponsorLogoChange);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleLogoFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (isOrganizerRole) onOrganizerLogoChange?.(dataUrl);
      else if (isSponsorRole) onSponsorLogoChange?.(dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const safeNotifications = notifications || [];
  const unreadNotifCount = safeNotifications.filter((n) => !n.read).length;
  const unreadSponsorAlertCount = sponsorAlerts.filter((a) => !a.read).length;
  const bellUnreadCount = isSponsorRole ? unreadSponsorAlertCount : unreadNotifCount;
  const bellClickHandler = isSponsorRole ? handleOpenSponsorAlerts : handleOpenNotifications;
  const bellTitle = isSponsorRole ? 'Sponsorship Alerts' : 'Notifications';

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
              <Logo className="h-11 w-auto" />
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
            <div className="relative">
              <button
                ref={roleTriggerRef}
                onClick={toggleRoleMenu}
                className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 rounded-lg text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-200/80 cursor-pointer"
              >
                <span className="text-[10px] uppercase tracking-wider text-slate-400 mr-1">Role:</span>
                <span className="capitalize text-blue-700 font-bold">{role}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>
              {roleMenuOpen && roleMenuPos && (
                <div
                  ref={roleMenuRef}
                  style={{ position: 'fixed', top: roleMenuPos.top, right: roleMenuPos.right }}
                  className="w-48 bg-white rounded-xl shadow-xl border border-slate-100 py-1.5 z-50"
                >
                  <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Switch Active Context
                  </div>
                  <button
                    onClick={() => {
                      onRoleChange('Professional' as UserRole);
                      handleTabChange('home');
                      setRoleMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-blue-50 flex items-center justify-between cursor-pointer ${
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
                      setRoleMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-blue-50 flex items-center justify-between cursor-pointer ${
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
                      setRoleMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-blue-50 flex items-center justify-between cursor-pointer ${
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
                      setRoleMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-blue-50 flex items-center justify-between cursor-pointer ${
                      role === 'sponsor' ? 'text-blue-600 font-bold bg-blue-50/50' : 'text-slate-700'
                    }`}
                  >
                    <span>Corporate Sponsor</span>
                    <Briefcase className="w-3.5 h-3.5" />
                  </button>
                  {onLogout && (
                    <>
                      <div className="my-1 border-t border-slate-100" />
                      {accountEmail && (
                        <div className="px-3 pb-1 text-[10px] text-slate-400 truncate">{accountEmail}</div>
                      )}
                      <button
                        onClick={() => {
                          setRoleMenuOpen(false);
                          onLogout();
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 flex items-center justify-between cursor-pointer"
                      >
                        <span>Log Out</span>
                        <LogOut className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              )}
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

            {/* Notifications — Sponsorship Alerts while in Sponsor role, Notifications tab otherwise */}
            <button
              onClick={bellClickHandler}
              className="p-2 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors relative cursor-pointer"
              title={bellTitle}
            >
              <Bell className="w-4 h-4" />
              {bellUnreadCount > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full ring-2 ring-white"></span>
              )}
            </button>

            {/* Identity Avatar & Menu — reflects the active role (professional, organizer, or sponsor) */}
            <div className="flex items-center gap-2 p-1 rounded-xl hover:bg-slate-100 transition-colors border border-slate-200">
              <button
                onClick={() => handleTabChange(identityTab)}
                className="flex items-center gap-2 cursor-pointer"
              >
                <span className="relative shrink-0">
                  <img
                    src={identity.avatar}
                    alt={identity.name}
                    className="w-8 h-8 rounded-lg object-cover ring-1 ring-blue-500/30"
                  />
                  {canCustomizeLogo && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        logoInputRef.current?.click();
                      }}
                      title="Change logo"
                      className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center ring-2 ring-white cursor-pointer hover:bg-blue-700"
                    >
                      <Camera className="w-2.5 h-2.5" />
                    </span>
                  )}
                </span>
                <div className="hidden xl:block text-left pr-1">
                  <div className="text-xs font-bold text-slate-900 line-clamp-1">{identity.name}</div>
                  <div className="text-[10px] font-medium text-emerald-600 flex items-center gap-0.5">
                    <ShieldCheck className="w-3 h-3" />
                    <span>{identityLabel}</span>
                  </div>
                </div>
              </button>
              {canCustomizeLogo && (
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoFileSelected}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
