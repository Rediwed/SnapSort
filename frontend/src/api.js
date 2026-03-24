/**
 * Lightweight fetch wrapper for the SnapSort API.
 * All functions return parsed JSON or throw on HTTP errors.
 */

const BASE = '/api';

async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/* ---- Dashboard ---- */
export const fetchDashboard = () => request('/dashboard');

/* ---- Jobs ---- */
export const fetchJobs = (params = {}) => {
  const q = new URLSearchParams(params).toString();
  return request(`/jobs${q ? '?' + q : ''}`);
};
export const fetchJob      = (id) => request(`/jobs/${id}`);
export const fetchActiveJobs = () => request('/jobs/active');
export const createJob     = (body) => request('/jobs', { method: 'POST', body: JSON.stringify(body) });
export const startJob      = (id) => request(`/jobs/${id}/start`, { method: 'POST' });
export const cancelJob     = (id) => request(`/jobs/${id}/cancel`, { method: 'POST' });
export const deleteJob     = (id) => request(`/jobs/${id}`, { method: 'DELETE' });
export const deleteJobWithPhotos = (id) => request(`/jobs/${id}/photos`, { method: 'DELETE' });
export const fetchTestPresets = () => request('/jobs/test-presets');

/* ---- Photos ---- */
export const fetchPhotos = (params = {}) => {
  const q = new URLSearchParams(params).toString();
  return request(`/photos${q ? '?' + q : ''}`);
};
export const fetchPhoto = (id) => request(`/photos/${id}`);
export const fetchPhotoJobs = () => request('/photos/jobs');
export const photoPreviewUrl = (id) => `${BASE}/photos/${id}/preview`;

/* ---- Photo Overrides ---- */
export const overridePhotos = (jobId, photoIds) =>
  request(`/jobs/${jobId}/override`, { method: 'POST', body: JSON.stringify({ photoIds }) });

/* ---- Duplicates (resolution only — listing is via /api/photos?isDuplicate=true) ---- */
export const resolveDuplicate = (id, resolution) =>
  request(`/duplicates/${id}`, { method: 'PATCH', body: JSON.stringify({ resolution }) });

/* ---- Settings ---- */
export const fetchSettings = () => request('/settings');
export const updateSettings = (pairs) => request('/settings', { method: 'PATCH', body: JSON.stringify(pairs) });

/* ---- Filesystem browse ---- */
export const browseDirectory = (dir, files = false) => {
  const q = new URLSearchParams();
  if (dir) q.set('dir', dir);
  if (files) q.set('files', 'true');
  return request(`/filesystem/browse?${q}`);
};
export const fetchFilesystemRoots = () => request('/filesystem/roots');

/* ---- Drives ---- */
export const fetchDrives = () => request('/drives');
export const prescanDrive = (path) => request('/drives/prescan', { method: 'POST', body: JSON.stringify({ path }) });
export const fetchActivePrescan = () => request('/drives/prescan/active');
export const fetchPrescanResult = (path) => {
  const q = new URLSearchParams({ path }).toString();
  return request(`/drives/prescan/result?${q}`);
};

/* ---- Performance Profiles ---- */
export const fetchProfiles = () => request('/profiles');
export const fetchProfile = (id) => request(`/profiles/${id}`);
export const createProfile = (body) => request('/profiles', { method: 'POST', body: JSON.stringify(body) });
export const updateProfile = (id, body) => request(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const deleteProfile = (id) => request(`/profiles/${id}`, { method: 'DELETE' });

/* ---- Benchmarks ---- */
export const fetchBenchmarks = () => request('/benchmarks');
export const fetchBenchmark = (id) => request(`/benchmarks/${id}`);
export const startBenchmark = (body = {}) => request('/benchmarks', { method: 'POST', body: JSON.stringify(body) });

/* ---- Health ---- */
export const fetchHealth = () => request('/health');
