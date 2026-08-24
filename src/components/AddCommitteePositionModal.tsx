import React, { useState } from 'react';
import { X, Loader2, AlertCircle, Upload } from 'lucide-react';
import { resizeImageFile } from '../utils/image';
import { AddCommitteePositionPayload } from '../api/activity';

interface AddCommitteePositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (payload: AddCommitteePositionPayload) => Promise<void>;
}

const POSITION_OPTIONS = [
  'Technical Program Committee',
  'Organizing Committee',
  'Session Chair',
  'Reviewer Committee',
  'Advisory Board',
  'Other',
];

const inputClass =
  'w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600';
const labelClass = 'block text-xs font-bold text-slate-600 mb-1.5';

export const AddCommitteePositionModal: React.FC<AddCommitteePositionModalProps> = ({ isOpen, onClose, onAdd }) => {
  const [conferenceName, setConferenceName] = useState('');
  const [position, setPosition] = useState(POSITION_OPTIONS[0]);
  const [year, setYear] = useState('');
  const [proofImage, setProofImage] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const resetFields = () => {
    setConferenceName('');
    setPosition(POSITION_OPTIONS[0]);
    setYear('');
    setProofImage(null);
    setProofError(null);
    setError(null);
  };

  const handleClose = () => {
    resetFields();
    onClose();
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
    setError(null);
    setSaving(true);
    try {
      await onAdd({
        conferenceName: conferenceName.trim(),
        position,
        year: year.trim() || undefined,
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
          <h2 className="text-lg font-extrabold text-slate-900">Add a Committee Position</h2>
          <button onClick={handleClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            This is self-reported and not verified by Conference Gate — it shows on your profile labeled that way.
          </p>

          <div>
            <label className={labelClass}>Conference Name *</label>
            <input
              type="text"
              value={conferenceName}
              onChange={(e) => setConferenceName(e.target.value)}
              placeholder="e.g. SPE Annual Technical Conference"
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Position</label>
              <select value={position} onChange={(e) => setPosition(e.target.value)} className={inputClass}>
                {POSITION_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
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
            <label className={labelClass}>Proof (optional)</label>
            <label className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 cursor-pointer hover:border-slate-400">
              <Upload className="w-4 h-4 shrink-0" />
              <span>{proofImage ? 'Photo attached — click to replace' : 'Upload a photo of your appointment letter or certificate'}</span>
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

export default AddCommitteePositionModal;
