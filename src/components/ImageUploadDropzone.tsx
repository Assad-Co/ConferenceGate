import React, { useId, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, UploadCloud, X } from 'lucide-react';
import { resizeImageFile } from '../utils/image';

interface ImageUploadDropzoneProps {
  value?: string;
  onChange: (value: string) => void;
  label?: string;
  helperText?: string;
  variant?: 'banner' | 'square' | 'portrait';
  maxSize?: number;
  className?: string;
}

export const ImageUploadDropzone: React.FC<ImageUploadDropzoneProps> = ({
  value = '',
  onChange,
  label = 'Image',
  helperText = 'Choose an image or drag & drop it here.',
  variant = 'square',
  maxSize,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processFile = async (file?: File | null) => {
    if (!file) return;
    if (!/^image\/(?:jpeg|png|webp)$/i.test(file.type)) {
      setError('Use a JPG, PNG or WebP image.');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError('Image must be smaller than 12 MB.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const target = maxSize ?? (variant === 'banner' ? 1800 : 720);
      const image = await resizeImageFile(file, target, 0.88);
      onChange(image);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process this image.');
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const previewClass = variant === 'banner'
    ? 'w-full h-44 object-cover rounded-xl'
    : variant === 'portrait'
      ? 'w-24 h-24 object-cover rounded-2xl'
      : 'w-24 h-24 object-contain rounded-2xl bg-white';

  return (
    <div className={`space-y-2 ${className}`}>
      {label && <label htmlFor={inputId} className="block font-bold uppercase text-[10px] text-slate-500">{label}</label>}
      <div
        role="button"
        aria-label={`Upload ${label}`}
        tabIndex={0}
        onClick={() => !loading && inputRef.current?.click()}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !loading) inputRef.current?.click();
        }}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void processFile(event.dataTransfer.files?.[0]);
        }}
        className={`relative rounded-2xl border-2 border-dashed p-4 transition-colors cursor-pointer ${
          dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/40'
        }`}
      >
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => void processFile(event.target.files?.[0])}
        />
        <div className={`flex ${variant === 'banner' ? 'flex-col' : 'items-center'} gap-4`}>
          {value ? (
            <img src={value} alt={`${label} preview`} className={previewClass} />
          ) : (
            <div className={`${variant === 'banner' ? 'w-full h-28' : 'w-20 h-20'} rounded-2xl bg-white border border-slate-200 flex items-center justify-center shrink-0`}>
              <ImageIcon className="w-7 h-7 text-slate-300" />
            </div>
          )}
          <div className={variant === 'banner' ? 'text-center' : 'min-w-0 flex-1'}>
            <div className="inline-flex items-center gap-2 text-xs font-bold text-blue-700">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
              {loading ? 'Processing image…' : value ? 'Replace image' : 'Upload or drag & drop'}
            </div>
            <p className="mt-1 text-[10px] text-slate-500">{helperText}</p>
            <p className="mt-0.5 text-[9px] text-slate-400">JPG, PNG or WebP · max 12 MB</p>
          </div>
        </div>
        {value && !loading && (
          <button
            type="button"
            title="Remove image"
            aria-label="Remove image"
            onClick={(event) => {
              event.stopPropagation();
              onChange('');
              setError(null);
            }}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-white/95 border border-slate-200 text-slate-500 hover:text-rose-600 shadow-sm"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {error && <p className="text-[10px] font-semibold text-rose-600">{error}</p>}
    </div>
  );
};

export default ImageUploadDropzone;
