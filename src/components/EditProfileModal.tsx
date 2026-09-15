import React, { useState } from 'react';
import { X, Loader2, AlertCircle, Linkedin, CheckCircle2 } from 'lucide-react';
import { refreshLinkedInProfileEnrichment } from '../api/linkedinProfile';

export interface EditProfileValues {
  name: string;
  title: string;
  organization: string;
  department: string;
  city: string;
  country: string;
  bio: string;
  linkedinUrl: string;
}

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialValues: EditProfileValues;
  variant?: 'professional' | 'organizer' | 'sponsor';
  onSave: (payload: EditProfileValues) => Promise<void>;
}

const inputClass =
  'w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600';
const labelClass = 'block text-xs font-bold text-slate-600 mb-1.5';

const VARIANT_COPY = {
  professional: {
    title: 'Edit Profile',
    organizationLabel: 'Organization',
    organizationPlaceholder: 'e.g. University of Oxford',
    departmentLabel: 'Department',
    departmentPlaceholder: 'e.g. Earth Sciences',
    bioLabel: 'Bio',
    bioPlaceholder: 'Tell the community a bit about your work and interests...',
  },
  organizer: {
    title: 'Edit Organizer Profile',
    organizationLabel: 'Organizing Company / Association Name',
    organizationPlaceholder: 'e.g. Global Energy Summit Board',
    departmentLabel: 'Division / Team',
    departmentPlaceholder: 'e.g. Program Committee',
    bioLabel: 'About the Organization',
    bioPlaceholder: 'Describe your organization, its mission, and the events it runs...',
  },
  sponsor: {
    title: 'Edit Sponsor Profile',
    organizationLabel: 'Company Name',
    organizationPlaceholder: 'e.g. TotalEnergies Digital & Geosciences Labs',
    departmentLabel: 'Division / Team',
    departmentPlaceholder: 'e.g. Sponsorships & Partnerships',
    bioLabel: 'About the Company',
    bioPlaceholder: 'Describe your company and what you look for in a sponsorship...',
  },
} as const;

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  isOpen,
  onClose,
  initialValues,
  variant = 'professional',
  onSave,
}) => {
  const [name, setName] = useState(initialValues.name);
  const [title, setTitle] = useState(initialValues.title);
  const [organization, setOrganization] = useState(initialValues.organization);
  const [department, setDepartment] = useState(initialValues.department);
  const [city, setCity] = useState(initialValues.city);
  const [country, setCountry] = useState(initialValues.country);
  const [bio, setBio] = useState(initialValues.bio);
  const [linkedinUrl, setLinkedinUrl] = useState(initialValues.linkedinUrl);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [linkedinImporting, setLinkedinImporting] = useState(false);
  const [linkedinImportError, setLinkedinImportError] = useState<string | null>(null);
  const [linkedinImportSummary, setLinkedinImportSummary] = useState<string | null>(null);

  if (!isOpen) return null;

  const copy = VARIANT_COPY[variant];

  const handleLinkedInImport = async () => {
    if (!linkedinUrl.trim()) {
      setLinkedinImportError('Enter your LinkedIn profile URL or username first.');
      return;
    }

    setLinkedinImportError(null);
    setLinkedinImportSummary(null);
    setLinkedinImporting(true);

    try {
      const result = await refreshLinkedInProfileEnrichment(linkedinUrl.trim());
      const profile = result.profile;

      setLinkedinUrl(profile.linkedinUrl || linkedinUrl);

      // Never silently replace fields the member has already written. Import only fills blanks;
      // the full professional history is stored separately with LinkedIn provenance.
      if (!title.trim() && profile.currentTitle) setTitle(profile.currentTitle);
      if (!organization.trim() && profile.currentOrganization) setOrganization(profile.currentOrganization);
      if (!city.trim() && profile.city) setCity(profile.city);
      if (!country.trim() && profile.country) setCountry(profile.country);
      if (!bio.trim() && profile.about) setBio(profile.about.slice(0, 600));

      const parts = [
        `${result.counts.experience} experience`,
        `${result.counts.education} education`,
        `${result.counts.publications} publication${result.counts.publications === 1 ? '' : 's'}`,
        `${result.counts.patents} patent${result.counts.patents === 1 ? '' : 's'}`,
      ];
      setLinkedinImportSummary(`Imported ${parts.join(' · ')}`);
    } catch (err: any) {
      setLinkedinImportError(err?.message || 'Could not import your LinkedIn profile. Please try again.');
    } finally {
      setLinkedinImporting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Full name cannot be empty.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        title: title.trim(),
        organization: organization.trim(),
        department: department.trim(),
        city: city.trim(),
        country: country.trim(),
        bio: bio.trim(),
        linkedinUrl: linkedinUrl.trim(),
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Could not save your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-extrabold text-slate-900">{copy.title}</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className={labelClass}>{variant === 'professional' ? 'Full Name' : 'Your Name'}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={variant === 'professional' ? 'e.g. Jane Ann Doe' : undefined}
              className={inputClass}
            />
            {variant === 'professional' && (
              <p className="mt-1 text-[11px] text-slate-400">
                Include your middle name if you have one — conference papers are matched to your
                full name, and a middle name (or initial) helps tell you apart from others who
                share your first and last name.
              </p>
            )}
          </div>
          <div>
            <label className={labelClass}>{variant === 'professional' ? 'Title / Position' : 'Your Role'}</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={variant === 'professional' ? 'e.g. Senior Research Fellow' : 'e.g. Program Director'}
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>{copy.organizationLabel}</label>
              <input
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder={copy.organizationPlaceholder}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{copy.departmentLabel}</label>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder={copy.departmentPlaceholder}
                className={inputClass}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>City</label>
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Country</label>
              <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>LinkedIn Username or URL</label>
            <input
              type="text"
              value={linkedinUrl}
              onChange={(e) => {
                setLinkedinUrl(e.target.value);
                setLinkedinImportError(null);
                setLinkedinImportSummary(null);
              }}
              placeholder="e.g. jane-smith or linkedin.com/in/jane-smith"
              className={inputClass}
            />

            {variant === 'professional' && (
              <div className="mt-2.5">
                <button
                  type="button"
                  onClick={handleLinkedInImport}
                  disabled={linkedinImporting || saving || !linkedinUrl.trim()}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#0A66C2] hover:bg-[#0959a8] disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  {linkedinImporting
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Linkedin className="w-4 h-4" />}
                  {linkedinImporting ? 'Importing LinkedIn profile…' : 'Import professional profile'}
                </button>
                <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
                  With your click, ConferenceGate imports public professional data from this profile:
                  experience, education, publications, patents and certifications. Existing fields are not overwritten.
                </p>
              </div>
            )}

            {linkedinImportSummary && (
              <div className="mt-2 flex items-start gap-2 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{linkedinImportSummary}</span>
              </div>
            )}

            {linkedinImportError && (
              <div className="mt-2 flex items-start gap-2 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{linkedinImportError}</span>
              </div>
            )}
          </div>
          <div>
            <label className={labelClass}>{copy.bioLabel}</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              maxLength={600}
              placeholder={copy.bioPlaceholder}
              className={`${inputClass} resize-none`}
            />
            <div className="text-[10px] text-slate-400 text-right mt-1">{bio.length}/600</div>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-full transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || linkedinImporting}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-900 hover:bg-blue-950 disabled:opacity-60 text-white font-bold text-sm rounded-full transition-colors cursor-pointer"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditProfileModal;
