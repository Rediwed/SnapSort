import { useState, useEffect, useCallback } from 'react';
import Modal from './Modal';
import { photoPreviewUrl, fetchPhotoExif } from '../api';
import { ExternalLink, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import Badge from './Badge';
import { useSettings } from '../SettingsContext';
import { fmtDate, fmtDateTime } from '../dateFormat';

const statusVariant = { copied: 'green', skipped: 'orange', error: 'red', pending: 'accent', duplicate: 'red' };

/* EXIF fields to display, grouped and ordered */
const exifGroups = [
  { label: 'Camera', keys: ['Make', 'Model', 'LensModel', 'LensMake', 'Software'] },
  { label: 'Exposure', keys: ['ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'FocalLengthIn35mmFormat', 'ExposureProgram', 'MeteringMode', 'Flash', 'WhiteBalance'] },
  { label: 'Image', keys: ['ImageWidth', 'ImageHeight', 'ColorSpace', 'BitsPerSample', 'Orientation', 'XResolution', 'YResolution'] },
  { label: 'Date', keys: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] },
  { label: 'GPS', keys: ['latitude', 'longitude', 'GPSAltitude'] },
];

const knownKeys = new Set(exifGroups.flatMap((g) => g.keys));

const fmtExifValueBase = (v, settings) => {
  if (v == null) return '—';
  if (v instanceof Date || (typeof v === 'string' && /^\d{4}[:-]\d{2}[:-]\d{2}/.test(v))) {
    return fmtDateTime(v, settings);
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return String(v);
};

const fmtSize = (s) => {
  if (!s) return '—';
  if (s >= 1048576) return `${(s / 1048576).toFixed(1)} MB`;
  return `${(s / 1024).toFixed(0)} KB`;
};

const CopyIcon = ({ copied }) => (
  <span className={`copy-icon${copied ? ' copied' : ''}`}>
    {copied ? <Check size={11} /> : <Copy size={11} />}
  </span>
);

function copyToClipboard(text, setCopied) {
  if (!text || text === '—') return;
  navigator.clipboard.writeText(text).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  });
}

function MetaRow({ label, value, raw, className, children }) {
  const [copied, setCopied] = useState(false);
  const copyText = raw != null ? String(raw) : (typeof value === 'string' ? value : '');
  const hasCopy = copyText && copyText !== '—';
  return (
    <tr
      className={hasCopy ? 'copyable-row' : ''}
      onClick={hasCopy ? () => copyToClipboard(copyText, setCopied) : undefined}
      title={hasCopy ? 'Click to copy' : undefined}
    >
      <td className="meta-label">{label}</td>
      <td className={className}>
        {children || value}
        {hasCopy && <CopyIcon copied={copied} />}
      </td>
    </tr>
  );
}

function ExifRow({ label, value, raw }) {
  const [copied, setCopied] = useState(false);
  const copyText = raw != null ? String(raw) : String(value);
  return (
    <div
      className="exif-row copyable-row"
      onClick={() => copyToClipboard(copyText, setCopied)}
      title="Click to copy"
    >
      <span className="exif-key">{label}</span>
      <span className="exif-val mono">{value}<CopyIcon copied={copied} /></span>
    </div>
  );
}

export default function PhotoDetailModal({ photo, open, onClose }) {
  const settings = useSettings();
  const fmtExifValue = (v) => fmtExifValueBase(v, settings);
  const [exif, setExif] = useState(null);
  const [exifLoading, setExifLoading] = useState(false);
  const [exifOpen, setExifOpen] = useState(false);

  useEffect(() => {
    if (!photo || !open) { setExif(null); setExifOpen(false); return; }
    setExifLoading(true);
    fetchPhotoExif(photo.id)
      .then((d) => setExif(d.exif))
      .catch(() => setExif(null))
      .finally(() => setExifLoading(false));
  }, [photo?.id, open]);

  if (!photo) return null;

  const previewUrl = photoPreviewUrl(photo.id);

  /* Build grouped EXIF rows */
  const exifSections = exif ? exifGroups
    .map((g) => ({
      label: g.label,
      rows: g.keys.filter((k) => exif[k] != null).map((k) => ({ key: k, value: exif[k] })),
    }))
    .filter((s) => s.rows.length > 0) : [];

  /* Collect remaining keys not in any group */
  const otherKeys = exif ? Object.keys(exif).filter((k) => !knownKeys.has(k) && exif[k] != null) : [];

  return (
    <Modal open={open} title={photo.filename || 'Photo Detail'} onClose={onClose}>
      <div className="photo-detail">
        <div className="photo-detail-top">
          {/* Left: preview */}
          <div className="photo-detail-left">
            <div className="photo-detail-preview">
              <img
                src={previewUrl}
                alt={photo.filename}
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextElementSibling.style.display = 'flex';
                }}
              />
              <div className="photo-detail-no-preview" style={{ display: 'none' }}>
                Preview not available
              </div>
            </div>
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="photo-detail-fullsize"
            >
              <ExternalLink size={14} /> Open full-size preview
            </a>
          </div>

          {/* Right: metadata */}
          <div className="photo-detail-right">
            <table className="photo-detail-meta">
              <tbody>
                <MetaRow label="Status" value={photo.status}>
                  <Badge variant={statusVariant[photo.status] || 'accent'}>{photo.status}</Badge>
                </MetaRow>
                {photo.skip_reason && (
                  <MetaRow label="Skip Reason" value={photo.skip_reason} />
                )}
                <MetaRow label="Source" value={photo.src_path || '—'} raw={photo.src_path} className="mono path-cell" />
                <MetaRow label="Destination" value={photo.dest_path || '—'} raw={photo.dest_path} className="mono path-cell" />
                <MetaRow label="Extension" value={photo.extension || '—'} className="mono" />
                <MetaRow label="File Size" value={fmtSize(photo.file_size)} raw={photo.file_size} className="mono" />
                <MetaRow label="Dimensions" value={photo.width ? `${photo.width} × ${photo.height} px` : '—'} className="mono" />
                {photo.dpi && (
                  <MetaRow label="DPI" value={String(photo.dpi)} className="mono" />
                )}
                <MetaRow label="Date Taken" value={fmtDate(photo.date_taken, settings)} raw={photo.date_taken} />
                <MetaRow label="Processed" value={fmtDateTime(photo.processed_at, settings)} raw={photo.processed_at} />
                {photo.hash && (
                  <MetaRow label="Hash" value={photo.hash} className="mono hash-cell" />
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* EXIF data section */}
        <div className="photo-detail-exif">
          <button
            className="photo-detail-exif-toggle"
            onClick={() => setExifOpen((v) => !v)}
          >
            {exifOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            EXIF Data
            {exifLoading && <span className="exif-loading">Loading…</span>}
            {!exifLoading && exif && <span className="exif-count">{Object.keys(exif).length} fields</span>}
            {!exifLoading && !exif && <span className="exif-count">unavailable</span>}
          </button>

          {exifOpen && exif && (
            <div className="photo-detail-exif-body">
              {exifSections.map((section) => (
                <div key={section.label} className="exif-group">
                  <div className="exif-group-label">{section.label}</div>
                  {section.rows.map((row) => (
                    <ExifRow key={row.key} label={row.key} value={fmtExifValue(row.value)} raw={row.value} />
                  ))}
                </div>
              ))}
              {otherKeys.length > 0 && (
                <div className="exif-group">
                  <div className="exif-group-label">Other</div>
                  {otherKeys.map((k) => (
                    <ExifRow key={k} label={k} value={fmtExifValue(exif[k])} raw={exif[k]} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
