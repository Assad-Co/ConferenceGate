import React, { useEffect, useState } from 'react';
import { X, Loader2, Briefcase, Users, Presentation, Mic2, MapPin } from 'lucide-react';
import type { ProfessionalPreferencesPayload } from '../api/auth';

interface ProfessionalPreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  initial: ProfessionalPreferencesPayload;
  onSave: (payload: ProfessionalPreferencesPayload) => Promise<void>;
}

const inputClass =
  'w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600';
const labelClass = 'block text-xs font-bold text-slate-600 mb-1.5';

function splitList(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

export const ProfessionalPreferencesModal: React.FC<ProfessionalPreferencesModalProps> = ({
  isOpen,
  onClose,
  initial,
  onSave,
}) => {
  const [expertise, setExpertise] = useState(initial.professionalExpertise.join(', '));
  const [specialization, setSpecialization] = useState(initial.technicalSpecialization.join(', '));
  const [interests, setInterests] = useState(initial.researchInterests.join(', '));
  const [regions, setRegions] = useState(initial.preferredRegions.join(', '));
  const [committeeAvailable, setCommitteeAvailable] = useState(initial.committeeAvailable);
  const [sessionChairAvailable, setSessionChairAvailable] = useState(initial.sessionChairAvailable);
  const [speakerAvailable, setSpeakerAvailable] = useState(initial.speakerAvailable);
  const [reviewerMaxLoad, setReviewerMaxLoad] = useState(initial.reviewerMaxLoad || 5);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setExpertise(initial.professionalExpertise.join(', '));
    setSpecialization(initial.technicalSpecialization.join(', '));
    setInterests(initial.researchInterests.join(', '));
    setRegions(initial.preferredRegions.join(', '));
    setCommitteeAvailable(initial.committeeAvailable);
    setSessionChairAvailable(initial.sessionChairAvailable);
    setSpeakerAvailable(initial.speakerAvailable);
    setReviewerMaxLoad(initial.reviewerMaxLoad || 5);
    setError(null);
  }, [isOpen, initial]);

  if (!isOpen) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave({
        professionalExpertise: splitList(expertise),
        technicalSpecialization: splitList(specialization),
        researchInterests: splitList(interests),
        preferredRegions: splitList(regions),
        committeeAvailable,
        sessionChairAvailable,
        speakerAvailable,
        reviewerMaxLoad,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not save professional preferences.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">Professional Matching Profile</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              These free preferences help ConferenceGate match you with reviewer, committee, chair, and speaker opportunities.
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-5">
          <div>
            <label className={labelClass}>Core Expertise</label>
            <input
              className={inputClass}
              value={expertise}
              onChange={(e) => setExpertise(e.target.value)}
              placeholder="Petroleum geochemistry, AI, oncology, cybersecurity"
            />
            <p className="mt-1 text-[10px] text-slate-400">Separate specialties with commas.</p>
          </div>

          <div>
            <label className={labelClass}>Technical Specializations</label>
            <input
              className={inputClass}
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
              placeholder="GC-MS, reservoir engineering, machine learning, clinical trials"
            />
          </div>

          <div>
            <label className={labelClass}>Research Interests</label>
            <input
              className={inputClass}
              value={interests}
              onChange={(e) => setInterests(e.target.value)}
              placeholder="Energy transition, biomarkers, digital health"
            />
          </div>

          <div>
            <label className={labelClass}>Preferred Regions</label>
            <div className="relative">
              <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                className={`${inputClass} pl-9`}
                value={regions}
                onChange={(e) => setRegions(e.target.value)}
                placeholder="Middle East, Europe, North America, Asia-Pacific"
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Maximum Active Review Load</label>
            <input
              type="number"
              min={1}
              max={50}
              value={reviewerMaxLoad}
              onChange={(e) => setReviewerMaxLoad(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                label: 'Technical Committee',
                note: 'Open to committee invitations',
                value: committeeAvailable,
                set: setCommitteeAvailable,
                icon: Users,
              },
              {
                label: 'Session Chair',
                note: 'Open to chair invitations',
                value: sessionChairAvailable,
                set: setSessionChairAvailable,
                icon: Presentation,
              },
              {
                label: 'Speaker / Keynote',
                note: 'Open to speaking invitations',
                value: speakerAvailable,
                set: setSpeakerAvailable,
                icon: Mic2,
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => item.set(!item.value)}
                  className={`p-4 rounded-2xl border text-left transition-colors cursor-pointer ${
                    item.value ? 'bg-blue-50 border-blue-300' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <Icon className={`w-5 h-5 mb-2 ${item.value ? 'text-blue-700' : 'text-slate-400'}`} />
                  <div className="font-bold text-xs text-slate-900">{item.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{item.note}</div>
                  <div className={`mt-2 text-[10px] font-extrabold uppercase ${item.value ? 'text-emerald-700' : 'text-slate-400'}`}>
                    {item.value ? 'Available' : 'Not available'}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 flex gap-3">
            <BriefcaseBusiness className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
            <p className="text-[11px] text-blue-900">
              In Phase 2, paid organizers will search and match against these preferences. Professionals remain free and control whether they are available for each role.
            </p>
          </div>

          {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}

          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs cursor-pointer">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs cursor-pointer disabled:opacity-60 flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Professional Profile
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
