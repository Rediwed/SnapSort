export const JOB_STATUS_VARIANTS = {
  pending: 'orange',
  running: 'accent',
  overriding: 'cyan',
  done: 'green',
  error: 'red',
  cancelled: 'orange',
};

export const PHOTO_STATUS_VARIANTS = {
  copied: 'green',
  skipped: 'orange',
  error: 'red',
  pending: 'accent',
  duplicate: 'red',
  scanned: 'cyan',
};

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let value = bytes;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(unitIndex ? 1 : 0)} ${units[unitIndex]}`;
}