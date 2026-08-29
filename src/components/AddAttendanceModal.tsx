import React, { useMemo, useState } from 'react';
import { X, Loader2, AlertCircle, Upload, Search, CheckCircle2 } from 'lucide-react';
import { resizeImageFile } from '../utils/image';
import { AddSelfReportedAttendancePayload } from '../api/activity';
import { Conference } from '../types';

interface AddAttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (payload: AddSelfReportedAttendancePayload) => Promise<void>;
  /** The real Conference Gate catalog, searched so a person can pick their conference instead of
   * typing it blindly. Only past events are offered here — this modal is specifically for
   * attendance already behind them, and an upcoming one isn't attendance yet. */
  conferences?: Conference[];
  /** Conference IDs this account already has a real, verified registration for. Selecting one of
   * these needs no self-report at all — it's already shown, verified, elsewhere on the profile. */
  registeredConferenceIds?: string[];
}

const ROLE_OPTIONS = ['Attendee', 'Speaker', 'Panelist', 'Poster Presenter', 'Committee Member', 'Volunteer', 'Other'];
const MAX_SEARCH_RESULTS = 6;

const inputClass =
  'w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600';
const labelClass = 'block text-xs font-bold text-slate-600 mb-1.5';

export const AddAttendanceModal: React.FC<AddAttendanceModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  conferences = [],
  registeredConferenceIds = [],
}) => {
  const [conferenceName, setConferenceName] = useState('');
  const [location, setLocation] = useState('');
  const [year, setYear] = useState('');
  const [role, setRole] = useState('Attendee');
  const [proofImage, setProofImage] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Tracks a real catalog conference once picked from the search results, so submission can
  // check it against verified registrations. Cleared the moment the typed text no longer matches
  // what was picked — editing after a selection means going back to reporting it freely.
  const [selectedConferenceId, setSelectedConferenceId] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);

  const registeredIdSet = useMemo(() => new Set(registeredConferenceIds), [registeredConferenceIds]);

  const searchResults = useMemo(() => {
    const term = conferenceName.trim().toLowerCase();
    if (term.length < 2) return [];
    const today = new Date().toISOString().slice(0, 10);
    return conferences
      .filter((conf) => conf.dates.end < today && conf.title.toLowerCase().includes(term))
      .slice(0, MAX_SEARCH_RESULTS);
  }, [conferenceName, conferences]);

  if (!isOpen) return null;

  const resetFields = () => {
    setConferenceName('');
    setLocation('');
    setYear('');
    setRole('Attendee');
    setProofImage(null);
    setProofError(null);
    setError(null);
    setSelectedConferenceId(null);
    setShowResults(false);
  };

  const handleClose = () => {
    resetFields();
    onClose();
  };

  const handleNameChange = (value: string) => {
    setConferenceName(value);
    setShowResults(true);
    // Any edit away from the exact selected title means this is no longer that specific pick —
    // back to a plain, unlinked self-report unless they pick a result again.
    if (selectedConferenceId) setSelectedConferenceId(null);
  };

  const handleSelectConference = (conf: Conference) => {
    setConferenceName(conf.title);
    setLocation(`${conf.location.city}, ${conf.location.country}`);
    setYear(conf.dates.start.slice(0, 4));
    setSelectedConferenceId(conf.id);
    setShowResults(false);
    setError(null);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProofError(null);
    setUploadingProof(true);
    try {
      const dataUrl = await resizeImageFile(file, 1000, 0.85);
      setProofImage(dataUrl);
    } catch {
      setProofError('Could not read that image. Please try another file.');
    } finally {
      setUploadingProof(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!conferenceName.trim()) {
      setError('Conference name is required.');
      return;
    }
    // A verified registration already says this, and better than a self-report can — no need for
    // a second, unverified entry to exist alongside it.
    if (selectedConferenceId && registeredIdSet.has(selectedConferenceId)) {
      setError('You already have a verified registration for this conference — it\'s shown that way on your profile, so there\'s no need to add it again here.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onAdd({
        conferenceName: conferenceName.trim(),
        location: location.trim() || undefined,
        year: year.trim() || undefined,
        role,
        proofImage,
      });
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Could not save this entry. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <h2 className="text-lg font-extrabold text-slate-900">Add a Past Conference</h2>
          <button onClick={handleClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            This is self-reported and not verified by Conference Gate — it shows on your profile labeled that way.
          </p>

          <div className="relative">
            <label className={labelClass}>Conference Name *</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={conferenceName}
                onChange={(e) => handleNameChange(e.target.value)}
                onFocus={() => setShowResults(true)}
                placeholder="Search for the conference, or type its name"
                className={`${inputClass} pl-9`}
                autoComplete="off"
              />
              {selectedConferenceId && (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 absolute right-3 top-1/2 -translate-y-1/2" />
              )}
            </div>
            {showResults && searchResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                {searchResults.map((conf) => (
                  <button
                    key={conf.id}
                    type="button"
                    onClick={() => handleSelectConference(conf)}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 cursor-pointer"
                  >
                    <p className="text-xs font-bold text-slate-900">{conf.title}</p>
                    <p className="text-[11px] text-slate-500">
                      {conf.location.city}, {conf.location.country} • {conf.dates.start.slice(0, 4)}
                      {registeredIdSet.has(conf.id) && (
                        <span className="ml-1.5 text-emerald-600 font-semibold">• Verified registration on file</span>
                      )}
                    </p>
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-1">
              Not finding it? It's probably not one Conference Gate has on file — just type the name and fill in the
              details yourself below.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Location</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Houston, USA"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Year</label>
              <input
                type="text"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="e.g. 2023"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Your Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Proof (optional)</label>
            <label className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 cursor-pointer hover:border-slate-400">
              <Upload className="w-4 h-4 shrink-0" />
              <span>{proofImage ? 'Photo attached — click to replace' : 'Upload a photo of your badge, certificate, or ticket'}</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleFileSelected} />
            </label>
            {uploadingProof && (
              <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Processing image...
              </p>
            )}
            {proofImage && (
              <img src={proofImage} alt="Proof preview" className="mt-2 max-h-32 rounded-lg border border-slate-200" />
            )}
            {proofError && <p className="text-[11px] text-rose-600 mt-1">{proofError}</p>}
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
              onClick={handleClose}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-full transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || uploadingProof}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-900 hover:bg-blue-950 disabled:opacity-60 text-white font-bold text-sm rounded-full transition-colors cursor-pointer"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Add
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddAttendanceModal;
