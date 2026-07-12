/** Small token-driven UI primitives shared across features. */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="subsection-title" style={{ margin: 0 }}>
            {title}
          </h2>
          <div className="header-spacer" style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        {children}
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export function DataState({
  isLoading,
  error,
  isEmpty,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  isEmpty?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (isLoading) return <div className="loading-state">{t('common.loading')}</div>;
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    return <div className="banner banner-danger">{message}</div>;
  }
  if (isEmpty) return <div className="empty-state">{t('common.empty')}</div>;
  return <>{children}</>;
}

export function Chip({
  tone,
  children,
}: {
  tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral';
  children: ReactNode;
}) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
