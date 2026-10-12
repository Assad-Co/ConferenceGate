import React, { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ImageUploadDropzone } from './ImageUploadDropzone';

type Enhanced = {
  host: HTMLDivElement;
  root: Root;
  lastValue: string;
};

const IMAGE_WORDS = /\b(image|photo|picture|logo|banner|avatar|headshot|cover)\b/i;

function descriptiveText(input: HTMLInputElement): string {
  const explicitLabel = input.id
    ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent || ''
    : '';
  const nearbyLabel = input.closest('label')?.textContent || input.parentElement?.querySelector(':scope > label')?.textContent || '';
  return [
    input.placeholder,
    input.getAttribute('aria-label'),
    input.name,
    explicitLabel,
    nearbyLabel,
  ].filter(Boolean).join(' ');
}

function eligible(input: HTMLInputElement): boolean {
  if (input.dataset.cgImageEnhanced === 'true') return true;
  if (input.type !== 'url' && input.type !== 'text') return false;
  const text = descriptiveText(input);
  return IMAGE_WORDS.test(text) && /url|image|photo|picture|logo|banner|avatar|headshot|cover/i.test(text);
}

function setter(input: HTMLInputElement, next: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  nativeSetter?.call(input, next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function variantFor(input: HTMLInputElement): 'banner' | 'square' | 'portrait' {
  const text = descriptiveText(input);
  if (/banner|cover/i.test(text)) return 'banner';
  if (/logo/i.test(text)) return 'square';
  return 'portrait';
}

function labelFor(input: HTMLInputElement): string {
  const text = descriptiveText(input);
  if (/banner|cover/i.test(text)) return 'Conference cover image';
  if (/logo/i.test(text)) return 'Logo';
  if (/speaker/i.test(text)) return 'Speaker photo';
  if (/committee/i.test(text)) return 'Committee member photo';
  if (/avatar|headshot|photo|picture/i.test(text)) return 'Photo';
  return 'Image';
}

/**
 * Compatibility layer for legacy forms that still bind an image to a text/URL input.
 *
 * The controlled input stays mounted and remains the source of truth, so existing API contracts and
 * imported URL-backed images continue to work. The user sees only a file picker/dropzone. Uploads
 * are resized locally and written back through the input's normal React onChange path.
 */
export const ImageUrlUploadEnhancer: React.FC = () => {
  useEffect(() => {
    const enhanced = new Map<HTMLInputElement, Enhanced>();

    const render = (input: HTMLInputElement, item: Enhanced) => {
      const value = input.value || '';
      if (item.lastValue === value) return;
      item.lastValue = value;
      item.root.render(
        <ImageUploadDropzone
          value={value}
          onChange={(next) => setter(input, next)}
          label={labelFor(input)}
          helperText="Choose an image or drag & drop it here. No image URL is required."
          variant={variantFor(input)}
        />
      );
    };

    const scan = () => {
      document.querySelectorAll<HTMLInputElement>('input[type="url"], input[type="text"]').forEach((input) => {
        if (!eligible(input)) return;
        let item = enhanced.get(input);
        if (!item) {
          const host = document.createElement('div');
          host.dataset.cgImageDropHost = 'true';
          input.insertAdjacentElement('afterend', host);
          input.dataset.cgImageEnhanced = 'true';
          input.style.display = 'none';
          // A data URL is an image value, not a website URL. Keep browser form validation from
          // rejecting an uploaded image merely because the legacy field was type=url.
          input.type = 'text';
          item = { host, root: createRoot(host), lastValue: '__initial__' };
          enhanced.set(input, item);
        } else {
          input.style.display = 'none';
        }
        render(input, item);
      });

      for (const [input, item] of enhanced) {
        if (!document.contains(input)) {
          item.root.unmount();
          item.host.remove();
          enhanced.delete(input);
        } else {
          render(input, item);
        }
      }
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    // React property updates do not always mutate the DOM attribute. This lightweight sync keeps
    // imported/existing URL-backed images reflected in the preview when state changes programmatically.
    const timer = window.setInterval(scan, 500);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      for (const [, item] of enhanced) item.root.unmount();
      enhanced.clear();
    };
  }, []);

  return null;
};

export default ImageUrlUploadEnhancer;
