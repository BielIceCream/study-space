import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X, ArrowRight, type LucideIcon } from 'lucide-react';

export function Modal({ title, description, onClose, busy = false, children, className = '' }: {
  title: string; description?: string; onClose: () => void; busy?: boolean; children: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const active = document.activeElement;
    ref.current?.showModal();
    return () => { if (active instanceof HTMLElement && active.isConnected) active.focus(); };
  }, []);
  return <dialog ref={ref} className={`modal ${className}`} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Fechar janela" onClick={onClose} disabled={busy}><X size={19} /></button></div>
    {description && <p className="modal-description" id={descriptionId}>{description}</p>}
    {children}
  </dialog>;
}

export function EmptyState({ icon: Icon, title, description, action, onAction }: {
  icon: LucideIcon; title: string; description: string; action?: string; onAction?: () => void;
}) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={29} strokeWidth={1.5} /></div><h3>{title}</h3><p>{description}</p>
    {action && <button className="button primary" onClick={onAction}>{action}<ArrowRight size={16} /></button>}
  </div>;
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return <p className="form-error" role="alert">{children}</p>;
}
