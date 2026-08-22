import React, { useState } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';

export interface EditProfileValues {
  name: string;
  title: string;
  organization: string;
  department: string;
  city: string;
  country: string;
  bio: string;
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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const copy = VARIANT_COPY[variant];

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
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <h2 className="text-lg font-extrabold text-slate-900">{copy.title}</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className={labelClass}>{variant === 'professional' ? 'Full Name' : 'Your Name'}</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
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
              disabled={saving}
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
