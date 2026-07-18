import { useId, useRef } from 'react';
import useDialogFocus from '../hooks/useDialogFocus';

export default function Modal({ open, title, onClose, children, footer }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  useDialogFocus(open, dialogRef, onClose);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id={titleId}>{title}</h3>
          <button type="button" className="modal-close" aria-label="Close dialog" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
