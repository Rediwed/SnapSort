/**
 * Shared date/time formatting utilities.
 *
 * date_format values: 'system' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
 * time_format values: 'system' | '12h' | '24h'
 */

const pad = (n) => String(n).padStart(2, '0');

function formatDateOnly(dt, dateFmt) {
  if (dateFmt === 'DD/MM/YYYY') return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
  if (dateFmt === 'MM/DD/YYYY') return `${pad(dt.getMonth() + 1)}/${pad(dt.getDate())}/${dt.getFullYear()}`;
  if (dateFmt === 'YYYY-MM-DD') return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  return dt.toLocaleDateString();
}

function formatTimeOnly(dt, timeFmt) {
  if (timeFmt === '24h') return `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  if (timeFmt === '12h') {
    let h = dt.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${pad(dt.getMinutes())} ${ampm}`;
  }
  return dt.toLocaleTimeString();
}

/** Format a date-only string (no time). */
export function fmtDate(d, settings = {}) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return formatDateOnly(dt, settings.date_format || 'system');
}

/** Format a full date + time string. */
export function fmtDateTime(d, settings = {}) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  const dateFmt = settings.date_format || 'system';
  const timeFmt = settings.time_format || 'system';
  if (dateFmt === 'system' && timeFmt === 'system') return dt.toLocaleString();
  return `${formatDateOnly(dt, dateFmt)}, ${formatTimeOnly(dt, timeFmt)}`;
}
