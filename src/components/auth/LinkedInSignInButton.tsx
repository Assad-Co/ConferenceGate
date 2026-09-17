import React from 'react';
import { Linkedin } from 'lucide-react';

interface LinkedInSignInButtonProps {
  text?: 'signin_with' | 'signup_with';
  onUnavailable?: () => void;
}

// ConferenceGate uses the member's public LinkedIn profile URL only.
// This control never starts LinkedIn OAuth; it moves the user into the public-profile signup flow.
export const LinkedInSignInButton: React.FC<LinkedInSignInButtonProps> = ({ text = 'signin_with', onUnavailable }) => {
  return (
    <button
      type="button"
      onClick={onUnavailable}
      className="w-full flex items-center justify-center gap-2 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-sm font-bold rounded-full transition-colors cursor-pointer"
    >
      <Linkedin className="w-4 h-4 text-[#0A66C2]" />
      {text === 'signup_with' ? 'Build profile from LinkedIn' : 'Use public LinkedIn profile'}
    </button>
  );
};

export default LinkedInSignInButton;
