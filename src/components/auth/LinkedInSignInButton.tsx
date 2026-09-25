import React from 'react';
import { Linkedin } from 'lucide-react';

interface LinkedInSignInButtonProps {
  text?: 'signin_with' | 'signup_with';
  onUnavailable?: () => void;
}

// Start ConferenceGate's LinkedIn OpenID Connect flow. The server callback links the
// authenticated LinkedIn identity to an existing ConferenceGate account when the emails match,
// or asks a brand-new member to choose a ConferenceGate role before account creation.
export const LinkedInSignInButton: React.FC<LinkedInSignInButtonProps> = ({ text = 'signin_with', onUnavailable }) => {
  const handleClick = () => {
    try {
      window.location.assign('/api/auth/linkedin/start');
    } catch {
      onUnavailable?.();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full flex items-center justify-center gap-2 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-sm font-bold rounded-full transition-colors cursor-pointer"
    >
      <Linkedin className="w-4 h-4 text-[#0A66C2]" />
      {text === 'signup_with' ? 'Sign up with LinkedIn' : 'Sign in with LinkedIn'}
    </button>
  );
};

export default LinkedInSignInButton;
