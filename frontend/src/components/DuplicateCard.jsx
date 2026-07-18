import { Download, Folder } from 'lucide-react';
import Badge from './Badge';

const resolutionVariant = {
  keep_overwrite: 'green', keep_rename: 'cyan', ignore: 'red', undecided: 'orange',
};
export const resolutionLabel = {
  keep_overwrite: 'overwrite', keep_rename: 'keep both', ignore: 'skip', undecided: 'undecided',
};

const formatPath = (filePath) => {
  if (!filePath) return '—';
  const parts = filePath.split('/');
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : filePath;
};

export default function DuplicateCard({
  photo,
  index,
  selected,
  pendingResolve,
  onToggle,
  onResolve,
  onDetail,
  onPreviewEnter,
  onPreviewMove,
  onPreviewLeave,
  formatSize,
  formatDate,
}) {
  const resolution = photo.dup_resolution || 'undecided';
  const similarity = (photo.similarity || 0).toFixed(1);
  const similarityVariant = (photo.similarity || 0) >= 90
    ? 'red'
    : (photo.similarity || 0) >= 70 ? 'orange' : 'accent';
  const compareFields = [
    { key: 'file_size', matchKey: 'match_file_size', label: 'Size', format: formatSize },
    { key: 'width', matchKey: 'match_width', label: 'Width', format: (value) => value ?? '—', unit: 'px' },
    { key: 'height', matchKey: 'match_height', label: 'Height', format: (value) => value ?? '—', unit: 'px' },
    { key: 'dpi', matchKey: 'match_dpi', label: 'DPI', format: (value) => value ?? '—' },
    { key: 'date_taken', matchKey: 'match_date_taken', label: 'Date Taken', format: formatDate },
    { key: 'hash', matchKey: 'match_hash', label: 'Hash', format: (value) => value ? `${value.slice(0, 12)}…` : '—' },
  ];
  const isConfirming = (action) => pendingResolve?.dupId === photo.dup_id
    && pendingResolve?.resolution === action;

  return (
    <div className={`dup-card${selected ? ' selected' : ''}`}>
      <div className="dup-card-header">
        <input
          className="dup-card-check"
          type="checkbox"
          checked={selected}
          aria-label={`Select duplicate ${photo.filename}`}
          onClick={(event) => { event.stopPropagation(); onToggle(photo.id, index, event); }}
          onChange={() => {}}
        />
        <Badge variant={similarityVariant}>{similarity}% similar</Badge>
        <Badge variant={resolutionVariant[resolution]}>{resolutionLabel[resolution] || resolution}</Badge>
        <div className="dup-card-actions">
          {resolution !== 'ignore' && (
            <button className={`btn sm${isConfirming('ignore') ? ' confirming danger' : ' danger'}`} onClick={() => onResolve(photo.dup_id, 'ignore')} title="Do not copy this file">
              {isConfirming('ignore') ? 'Confirm?' : 'Skip'}
            </button>
          )}
          {resolution !== 'keep_overwrite' && (
            <button className={`btn sm${isConfirming('keep_overwrite') ? ' confirming' : ''}`} onClick={() => onResolve(photo.dup_id, 'keep_overwrite')} title="Copy and replace the existing file">
              {isConfirming('keep_overwrite') ? 'Confirm?' : 'Overwrite'}
            </button>
          )}
          {resolution !== 'keep_rename' && (
            <button className={`btn sm${isConfirming('keep_rename') ? ' confirming' : ''}`} onClick={() => onResolve(photo.dup_id, 'keep_rename')} title="Copy alongside with a renamed filename">
              {isConfirming('keep_rename') ? 'Confirm?' : 'Keep Both'}
            </button>
          )}
          {resolution !== 'undecided' && photo.dup_operation_status !== 'succeeded' && (
            <button className={`btn sm${isConfirming('undecided') ? ' confirming' : ''}`} onClick={() => onResolve(photo.dup_id, 'undecided')}>
              {isConfirming('undecided') ? 'Confirm?' : 'Reset'}
            </button>
          )}
        </div>
      </div>

      <div className="dup-compare">
        <div className="dup-side source">
          <div className="dup-side-label"><Download size={14} /> Source (incoming)</div>
          <div className="dup-side-file">
            <button type="button" className="filename-preview clickable" title={photo.filename} onClick={() => onDetail(photo)} onMouseEnter={(event) => onPreviewEnter(event, photo.id)} onMouseMove={onPreviewMove} onMouseLeave={onPreviewLeave}>
              {photo.filename}
            </button>
          </div>
          <div className="dup-side-path mono" title={photo.src_path}>{formatPath(photo.src_path)}</div>
        </div>

        <div className="dup-side match">
          <div className="dup-side-label"><Folder size={14} /> Already in library</div>
          <div className="dup-side-file">
            {photo.matched_photo_id ? (
              <button type="button" className="filename-preview clickable" title={photo.match_filename || ''} onClick={() => onDetail({ id: photo.matched_photo_id, filename: photo.match_filename || 'matched photo', dest_path: photo.match_dest_path, file_size: photo.match_file_size, width: photo.match_width, height: photo.match_height, date_taken: photo.match_date_taken, hash: photo.match_hash })} onMouseEnter={(event) => onPreviewEnter(event, photo.matched_photo_id)} onMouseMove={onPreviewMove} onMouseLeave={onPreviewLeave}>
                {photo.match_filename || 'matched photo'}
              </button>
            ) : <span className="mono">{formatPath(photo.dup_matched_path)}</span>}
          </div>
          <div className="dup-side-path mono" title={photo.match_dest_path || photo.dup_matched_path}>
            {formatPath(photo.match_dest_path || photo.dup_matched_path)}
          </div>
        </div>
      </div>

      <div className="dup-meta-grid">
        <div className="dup-meta-header"><span>Property</span><span>Source</span><span>Library</span><span /></div>
        {compareFields.map((field) => {
          const sourceValue = photo[field.key];
          const matchValue = photo[field.matchKey];
          const sourceFormatted = field.format(sourceValue);
          const matchFormatted = field.format(matchValue);
          const bothExist = sourceValue != null && matchValue != null;
          const matches = bothExist && String(sourceFormatted) === String(matchFormatted);
          const missing = sourceValue == null && matchValue == null;
          return (
            <div key={field.key} className={`dup-meta-row${matches ? ' match' : missing ? '' : ' differ'}`}>
              <span className="dup-meta-label">{field.label}</span>
              <span className="dup-meta-val mono">{sourceFormatted}{field.unit && sourceValue != null ? ` ${field.unit}` : ''}</span>
              <span className="dup-meta-val mono">{matchFormatted}{field.unit && matchValue != null ? ` ${field.unit}` : ''}</span>
              <span className="dup-meta-icon">{missing ? '—' : matches ? '✓' : '✗'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}