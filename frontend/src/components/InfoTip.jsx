import { useState, useRef, useEffect } from 'react';
import { Info } from 'lucide-react';

export default function InfoTip({ text }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <span className={`info-tip${open ? ' is-open' : ''}`} ref={ref}>
      <button
        type="button"
        className="info-tip-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label="More info"
        aria-expanded={open}
      >
        <Info size={14} />
      </button>
      <span className="info-tip-bubble">{text}</span>
    </span>
  );
}
