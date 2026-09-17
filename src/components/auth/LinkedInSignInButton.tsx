import React from 'react';
import { Linkedin } from 'lucide-react';

interface LinkedInSignInButtonProps {
  text?: 'signin_with' | 'signup_with';
}

// LinkedIn OAuth is handled entirely by the ConferenceGate backend. The browser only needs
// to navigate to /api/auth/linkedin/start, so no VITE_LINKEDIN_CLIENT_ID is required here.
// The server decides whether LinkedIn is configured and returns a clear error if it is not.
export const LinkedInSignInButton: React.FC<LinkedInSignInButtonProps> = ({ text = 'signin_with' }) => {
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
