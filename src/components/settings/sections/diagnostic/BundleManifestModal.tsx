import { X, FileText } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/i18n';

interface Props {
  open: boolean;
  fileList: string[];
  onClose: () => void;
}

export default function BundleManifestModal({ open, fileList, onClose }: Props) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 animate-in fade-in duration-150"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-[480px] max-h-[80vh] flex flex-col p-6 animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-semibold text-[var(--lingxi-text-primary)]">
            {t.diagnostic.manifestTitle}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-[var(--lingxi-bg-hover)] text-[var(--lingxi-text-tertiary)] transition-colors"
            aria-label={t.diagnostic.manifestClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto rounded-lg border border-[var(--lingxi-border)] bg-[var(--lingxi-bg-base)] divide-y divide-[var(--lingxi-border-subtle)]">
          {fileList.map((f) => (
            <li key={f} className="px-3 py-2 flex items-center gap-2 text-[12px] font-mono text-[var(--lingxi-text-primary)]">
              <FileText className="h-3.5 w-3.5 text-[var(--lingxi-text-tertiary)] shrink-0" />
              <span className="truncate">{f}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={onClose}
          className="mt-4 py-2.5 rounded-lg text-[13px] font-medium bg-[var(--lingxi-bg-muted)] text-[var(--lingxi-text-secondary)] hover:bg-[var(--lingxi-bg-hover)] transition-colors"
        >
          {t.diagnostic.manifestClose}
        </button>
      </div>
    </div>,
    document.body
  );
}
