import React from 'react';
import { Linkedin } from 'lucide-react';

const CLIENT_ID = import.meta.env.VITE_LINKEDIN_CLIENT_ID as string | undefined;

interface LinkedInSignInButtonProps {
  text?: 'signin_with' | 'signup_with';
}

// Unlike Google Identity Services, LinkedIn has no embeddable JS button — signing in is a plain
// full-page redirect to LinkedIn's own consent screen, so this is just a styled link rather than
// a script-rendered widget.
export const LinkedInSignInButton: React.FC<LinkedInSignInButtonProps> = ({ text = 'signin_with' }) => {
  if (!CLIENT_ID) return null;

  return (
    <a
      href="/api/auth/linkedin/start"
      className="w-full flex items-center justify-center gap-2 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-sm font-bold rounded-full transition-colors cursor-pointer"
    >
      <Linkedin className="w-4 h-4 text-[#0A66C2]" />
      {text === 'signup_with' ? 'Sign up with LinkedIn' : 'Sign in with LinkedIn'}
    </a>
  );
};

export default LinkedInSignInButton;
