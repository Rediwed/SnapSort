import { useState, useEffect, useRef } from 'react';
import { fetchSettings, updateSettings, fetchProfiles, updateProfile, createProfile, deleteProfile, sendNtfyTest, sendBrowserNotifyTest } from '../api';
import { Check, Bell, Monitor, Send, Save, Undo2, Plus, Trash2, Copy, Settings as SettingsIcon } from 'lucide-react';
import PillTabs from '../components/PillTabs';
import Modal from '../components/Modal';
import InfoTip from '../components/InfoTip';
import { fmtDate, fmtDateTime } from '../dateFormat';
import { useSettings } from '../SettingsContext';

const SETTINGS_TABS = [
  { value: 'general',       label: 'General' },
  { value: 'filters',       label: 'Filters & Formats' },
  { value: 'performance',   label: 'Performance' },
  { value: 'notifications', label: 'Notifications' },
];

const DEFAULT_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.cr2', '.nef', '.arw',
  '.tif', '.tiff', '.rw2', '.orf', '.dng', '.heic', '.heif',
];

const settingsMeta = [
  { key: 'min_width',              label: 'Min Width (px)',           type: 'number' },
  { key: 'min_height',             label: 'Min Height (px)',          type: 'number' },
  { key: 'min_filesize',           label: 'Min File Size (bytes)',    type: 'number' },
  { key: 'dedup_strict_threshold', label: 'Dedup Strict Threshold (%)', type: 'number' },
  { key: 'dedup_log_threshold',    label: 'Dedup Log Threshold (%)',    type: 'number' },
];

export default function Settings() {
  const { _refresh: refreshGlobalSettings } = useSettings();
  const [activeTab, setActiveTab] = useState('general');
  const [values, setValues] = useState({});
  const [savedValues, setSavedValues] = useState({});
  const [profiles, setProfiles] = useState([]);
  const [saved, setSaved] = useState(false);
  const [newExt, setNewExt] = useState('');
  const [ntfyTesting, setNtfyTesting] = useState(false);
  const [ntfyTestResult, setNtfyTestResult] = useState(null);
  const [browserNotifyTesting, setBrowserNotifyTesting] = useState(false);
  const [browserNotifyTestResult, setBrowserNotifyTestResult] = useState(null);
  const [ntfyConfigOpen, setNtfyConfigOpen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState(null);
  const [profileEdits, setProfileEdits] = useState({});
  const [savedProfileEdits, setSavedProfileEdits] = useState({});
  const [showNewProfile, setShowNewProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileBase, setNewProfileBase] = useState('default');
  const initialProfileLoad = useRef(false);

  useEffect(() => {
    fetchSettings().then((s) => { setValues(s); setSavedValues(s); }).catch(console.error);
    fetchProfiles().then(setProfiles).catch(console.error);
  }, []);

  /* Initialize editing profile when data first loads */
  useEffect(() => {
    if (!initialProfileLoad.current && profiles.length > 0 && Object.keys(values).length > 0) {
      initialProfileLoad.current = true;
      const defaultId = values.default_performance_profile || 'default';
      const p = profiles.find((pr) => pr.id === defaultId) || profiles[0];
      if (p) {
        setEditingProfileId(p.id);
        const edits = {
          enable_multithreading: p.enable_multithreading ? 1 : 0,
          sequential_processing: p.sequential_processing ? 1 : 0,
          max_workers: p.max_workers,
          batch_size: p.batch_size,
          hash_bytes: p.hash_bytes,
          concurrent_copies: p.concurrent_copies,
          description: p.description || '',
        };
        setProfileEdits(edits);
        setSavedProfileEdits(edits);
      }
    }
  }, [profiles, values]);

  /* Track whether current values differ from last-saved values */
  const hasProfileChanges = Object.keys(profileEdits).some(
    (k) => profileEdits[k] !== savedProfileEdits[k]
  );
  const hasChanges = hasProfileChanges
    || Object.keys(values).some((k) => values[k] !== savedValues[k])
    || Object.keys(savedValues).some((k) => values[k] !== savedValues[k]);

  /* Derived: current extension list */
  const extensions = values.supported_extensions
    ? values.supported_extensions.split(',').map((e) => e.trim()).filter(Boolean)
    : DEFAULT_EXTENSIONS;

  const handleChange = (key, val) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  };

  const handleSave = async () => {
    await updateSettings(values);
    setSavedValues({ ...values });

    // Save profile edits if editing a custom profile with changes
    const ep = profiles.find((p) => p.id === editingProfileId);
    if (ep && !ep.is_builtin && hasProfileChanges) {
      await updateProfile(editingProfileId, profileEdits);
      setSavedProfileEdits({ ...profileEdits });
      // If editing the default profile, sync values to settings for backend compat
      if (editingProfileId === (values.default_performance_profile || 'default')) {
        const syncValues = {
          ...values,
          enable_multithreading: profileEdits.enable_multithreading ? 'true' : 'false',
          sequential_processing: profileEdits.sequential_processing ? 'true' : 'false',
          max_worker_threads: String(profileEdits.max_workers),
          batch_size: String(profileEdits.batch_size),
          fast_hash_bytes: String(profileEdits.hash_bytes),
          concurrent_copies: String(profileEdits.concurrent_copies),
        };
        await updateSettings(syncValues);
        setValues(syncValues);
        setSavedValues(syncValues);
      }
      const updatedProfiles = await fetchProfiles();
      setProfiles(updatedProfiles);
    }

    setSaved(true);
    refreshGlobalSettings();
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDiscard = () => {
    setValues({ ...savedValues });
    setProfileEdits({ ...savedProfileEdits });
    /* Revert theme preview */
    const theme = savedValues.theme || 'dark';
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  };

  /* Extension helpers */
  const removeExt = (ext) => {
    const next = extensions.filter((e) => e !== ext);
    handleChange('supported_extensions', next.join(','));
  };

  const addExt = () => {
    let e = newExt.trim().toLowerCase();
    if (!e) return;
    if (!e.startsWith('.')) e = '.' + e;
    if (extensions.includes(e)) { setNewExt(''); return; }
    handleChange('supported_extensions', [...extensions, e].join(','));
    setNewExt('');
  };

  const resetExts = () => {
    handleChange('supported_extensions', DEFAULT_EXTENSIONS.join(','));
  };

  const handleNtfyTest = async () => {
    setNtfyTesting(true);
    setNtfyTestResult(null);
    try {
      /* Save current settings first so the test uses the latest values */
      await updateSettings(values);
      setSavedValues({ ...values });
      await sendNtfyTest();
      setNtfyTestResult('sent');
    } catch (err) {
      setNtfyTestResult(err.message || 'Failed');
    }
    setNtfyTesting(false);
    setTimeout(() => setNtfyTestResult(null), 6000);
  };

  const handleBrowserNotifyTest = async () => {
    setBrowserNotifyTesting(true);
    setBrowserNotifyTestResult(null);
    try {
      // Request permission if not yet granted
      if ('Notification' in window && Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          setBrowserNotifyTestResult('Permission denied');
          setBrowserNotifyTesting(false);
          setTimeout(() => setBrowserNotifyTestResult(null), 6000);
          return;
        }
      }
      if ('Notification' in window && Notification.permission === 'denied') {
        setBrowserNotifyTestResult('Notifications blocked — check browser settings');
        setBrowserNotifyTesting(false);
        setTimeout(() => setBrowserNotifyTestResult(null), 6000);
        return;
      }
      await updateSettings(values);
      setSavedValues({ ...values });
      await sendBrowserNotifyTest();
      setBrowserNotifyTestResult('sent');
    } catch (err) {
      setBrowserNotifyTestResult(err.message || 'Failed');
    }
    setBrowserNotifyTesting(false);
    setTimeout(() => setBrowserNotifyTestResult(null), 6000);
  };

  /* Performance values – profile fields come from profileEdits, globals from settings */
  const selectedProfileId = values.default_performance_profile || 'default';
  const editingProfile = profiles.find((p) => p.id === editingProfileId);
  const isEditingBuiltIn = editingProfile ? Boolean(editingProfile.is_builtin) : true;
  const enableMT = profileEdits.enable_multithreading === 1;
  const seqProcessing = profileEdits.sequential_processing === 1;
  const maxWorkers = profileEdits.max_workers || 4;
  const batchSize = profileEdits.batch_size || 25;
  const hashSampleBytes = profileEdits.hash_bytes || 8192;
  const concurrentCopies = profileEdits.concurrent_copies || 2;
  const hashWorkers = Number(values.parallel_hash_workers) || 4;
  const cpuCount = navigator.hardwareConcurrency || 4;
  const enableFastHash = values.enable_fast_hash === 'true';

  /* Set the default profile for new jobs (first dropdown) */
  const setDefaultProfile = (profileId) => {
    const p = profiles.find((pr) => pr.id === profileId);
    if (!p) return;
    setValues((prev) => ({
      ...prev,
      default_performance_profile: profileId,
      enable_multithreading: p.enable_multithreading ? 'true' : 'false',
      sequential_processing: p.sequential_processing ? 'true' : 'false',
      max_worker_threads: String(p.max_workers),
      batch_size: String(p.batch_size),
      fast_hash_bytes: String(p.hash_bytes),
      concurrent_copies: String(p.concurrent_copies),
    }));
    setSaved(false);
  };

  /* Load a profile for editing in the tuning section (second dropdown) */
  const loadProfileForEditing = (id) => {
    const p = profiles.find((pr) => pr.id === id);
    if (!p) return;
    setEditingProfileId(id);
    const edits = {
      enable_multithreading: p.enable_multithreading ? 1 : 0,
      sequential_processing: p.sequential_processing ? 1 : 0,
      max_workers: p.max_workers,
      batch_size: p.batch_size,
      hash_bytes: p.hash_bytes,
      concurrent_copies: p.concurrent_copies,
      description: p.description || '',
    };
    setProfileEdits(edits);
    setSavedProfileEdits(edits);
  };

  /* Update a profile tuning value */
  const handleProfileEdit = (key, val) => {
    setProfileEdits((prev) => ({ ...prev, [key]: val }));
  };

  /* Create a new custom profile */
  const handleCreateProfile = async () => {
    const name = newProfileName.trim();
    if (!name) return;
    const base = profiles.find((p) => p.id === newProfileBase);
    const body = {
      name,
      description: `Custom profile based on ${base?.name || 'Default'}`,
      max_workers: base?.max_workers ?? 4,
      batch_size: base?.batch_size ?? 25,
      hash_bytes: base?.hash_bytes ?? 4096,
      concurrent_copies: base?.concurrent_copies ?? 2,
      enable_multithreading: base?.enable_multithreading ?? true,
      sequential_processing: base?.sequential_processing ?? false,
    };
    try {
      const created = await createProfile(body);
      const updatedProfiles = await fetchProfiles();
      setProfiles(updatedProfiles);
      loadProfileForEditing(created.id);
      setShowNewProfile(false);
      setNewProfileName('');
    } catch (err) {
      console.error('Failed to create profile', err);
    }
  };

  /* Delete a custom profile */
  const handleDeleteProfile = async (id) => {
    const p = profiles.find((pr) => pr.id === id);
    if (!p || p.is_builtin) return;
    try {
      await deleteProfile(id);
      const updatedProfiles = await fetchProfiles();
      setProfiles(updatedProfiles);
      // If we deleted the editing profile, switch to default
      if (editingProfileId === id) {
        loadProfileForEditing(updatedProfiles[0]?.id || 'default');
      }
      // If we deleted the default profile, reset to 'default'
      if (values.default_performance_profile === id) {
        setDefaultProfile('default');
      }
    } catch (err) {
      console.error('Failed to delete profile', err);
    }
  };

  return (
    <>
      <div className="page-header flex justify-between items-center">
        <div>
          <h2>Settings</h2>
          <p>Configure the SnapSort engine defaults</p>
        </div>
      </div>

      <div className="page-body">
        <PillTabs tabs={SETTINGS_TABS} active={activeTab} onChange={setActiveTab} />

        {activeTab === 'filters' && <>
        <div className="settings-cards-grid">
        {/* ── Filter & Quality ─────────────────────────────── */}
        <div className="card">
          <div className="card-header"><h3>Filter &amp; Quality</h3></div>
          <div className="form-row-2">
            <div className="form-group">
              <label>Min Width (px)<InfoTip text="Photos narrower than this will be skipped during import. Helps filter out thumbnails and icons." /></label>
              <input className="form-input mono" type="number" value={values.min_width || ''} onChange={(e) => handleChange('min_width', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Min Height (px)<InfoTip text="Photos shorter than this will be skipped during import. Helps filter out thumbnails and icons." /></label>
              <input className="form-input mono" type="number" value={values.min_height || ''} onChange={(e) => handleChange('min_height', e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Min File Size (bytes)<InfoTip text="Files smaller than this byte threshold are excluded. Useful for filtering out corrupted or placeholder files." /></label>
            <input className="form-input mono" type="number" value={values.min_filesize || ''} onChange={(e) => handleChange('min_filesize', e.target.value)} />
          </div>
          <div className="form-row-2">
            <div className="form-group">
              <label>Dedup Strict Threshold (%)<InfoTip text="Similarity percentage above which files are treated as exact duplicates and automatically skipped. Higher values require closer matches." /></label>
              <input className="form-input mono" type="number" value={values.dedup_strict_threshold || ''} onChange={(e) => handleChange('dedup_strict_threshold', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Dedup Log Threshold (%)<InfoTip text="Similarity percentage above which potential duplicates are logged for manual review, but not automatically removed." /></label>
              <input className="form-input mono" type="number" value={values.dedup_log_threshold || ''} onChange={(e) => handleChange('dedup_log_threshold', e.target.value)} />
            </div>
          </div>
        </div>

        {/* ── File Formats ─────────────────────────────────── */}
        <div className="card">
          <div className="card-header flex justify-between items-center">
            <h3>File Formats</h3>
            <button className="btn sm" onClick={resetExts}>Reset Defaults</button>
          </div>
          <p className="form-hint" style={{ marginBottom: 12 }}>
            Only files matching these extensions will be considered during a scan.
          </p>

          <div className="ext-tags">
            {extensions.map((ext) => (
              <span className="ext-tag" key={ext}>
                {ext}
                <button className="ext-tag-remove" onClick={() => removeExt(ext)} title="Remove">×</button>
              </span>
            ))}
          </div>

          <div className="ext-add" style={{ marginTop: 12 }}>
            <input
              className="form-input mono"
              placeholder=".webp"
              value={newExt}
              onChange={(e) => setNewExt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addExt()}
              style={{ width: 120, display: 'inline-block', marginRight: 8 }}
            />
            <button className="btn sm" onClick={addExt}>Add</button>
          </div>
        </div>
        </div>{/* end settings-cards-grid */}
        </>}

        {activeTab === 'performance' && <>
        {/* ── Performance ──────────────────────────────────── */}
        <div className="card">
          <div className="card-header"><h3>Performance</h3></div>

          {/* Default profile for new jobs */}
          <div className="form-group">
            <label>Default Profile for New Jobs</label>
            <select
              className="form-select"
              value={selectedProfileId}
              onChange={(e) => setDefaultProfile(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.is_builtin ? '' : ' (custom)'}
                </option>
              ))}
            </select>
            <p className="form-hint">
              New jobs will use this profile's settings by default.
            </p>
          </div>

          {/* Profile to tune */}
          <div className="form-group">
            <label>Tune Profile</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                className="form-select"
                style={{ flex: 1 }}
                value={editingProfileId || ''}
                onChange={(e) => loadProfileForEditing(e.target.value)}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.is_builtin ? '' : ' (custom)'}
                  </option>
                ))}
              </select>
              <button
                className="btn sm"
                title="New custom profile"
                onClick={() => { setShowNewProfile(true); setNewProfileBase(editingProfileId || 'default'); }}
              >
                <Plus size={14} />
              </button>
              {editingProfile && !isEditingBuiltIn && (
                <button
                  className="btn sm"
                  title="Delete this custom profile"
                  style={{ color: 'var(--red)' }}
                  onClick={() => handleDeleteProfile(editingProfileId)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            {isEditingBuiltIn ? (
              <>
                {editingProfile?.description && (
                  <p className="form-hint">{editingProfile.description}</p>
                )}
                <p className="form-hint" style={{ color: 'var(--orange)' }}>
                  Built-in profiles are read-only. Create a custom profile to customise values.
                </p>
              </>
            ) : (
              <div className="form-group" style={{ marginTop: 8, marginBottom: 0 }}>
                <label>Description</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Describe this profile…"
                  value={profileEdits.description ?? editingProfile?.description ?? ''}
                  onChange={(e) => handleProfileEdit('description', e.target.value)}
                />
              </div>
            )}
          </div>

          {/* New profile inline form */}
          {showNewProfile && (
            <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 12, background: 'var(--bg-elevated)' }}>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label>Profile Name</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="My Custom Profile"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateProfile()}
                  autoFocus
                />
              </div>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label>Copy Settings From</label>
                <select
                  className="form-select"
                  value={newProfileBase}
                  onChange={(e) => setNewProfileBase(e.target.value)}
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.is_builtin ? '' : ' (custom)'}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn sm primary" onClick={handleCreateProfile} disabled={!newProfileName.trim()}>
                  <Copy size={14} /> Create
                </button>
                <button className="btn sm" onClick={() => { setShowNewProfile(false); setNewProfileName(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />

          <div className="form-row-2">
          {/* Enable Multi-threading */}
          <div className="form-group">
            <label className="form-toggle">
              <input
                type="checkbox"
                checked={enableMT}
                disabled={isEditingBuiltIn}
                onChange={(e) => handleProfileEdit('enable_multithreading', e.target.checked ? 1 : 0)}
              />
              <span>Enable Multi-threading<InfoTip text="Distributes photo processing across multiple CPU cores. Significantly faster on multi-core systems, especially with SSDs." /></span>
            </label>
            <p className="form-hint">
              Use parallel workers to process photos concurrently.
            </p>
          </div>

          {/* Sequential Processing */}
          <div className="form-group">
            <label className="form-toggle">
              <input
                type="checkbox"
                checked={seqProcessing}
                disabled={isEditingBuiltIn}
                onChange={(e) => handleProfileEdit('sequential_processing', e.target.checked ? 1 : 0)}
              />
              <span>Sequential Processing<InfoTip text="Processes files in order rather than in parallel. Recommended for traditional hard drives (HDDs) where random access is slow." /></span>
            </label>
            <p className="form-hint">
              Process files one-by-one in order. Best for HDDs to avoid random seeks.
            </p>
          </div>
          </div>

          <div className="form-row-2">
          {/* Max Workers */}
          <div className="form-group">
            <label>Worker Threads <span className="mono badge">{maxWorkers}</span><InfoTip text="Number of parallel threads for processing photos. More threads speed things up on SSDs and multi-core CPUs, but may cause slowdowns on HDDs." /></label>
            <input
              type="range"
              className="form-range"
              min={1}
              max={Math.max(32, cpuCount * 2)}
              value={maxWorkers}
              disabled={isEditingBuiltIn}
              onChange={(e) => handleProfileEdit('max_workers', Number(e.target.value))}
            />
            <div className="range-labels">
              <span>1</span>
              <span>{cpuCount} cores detected</span>
              <span>{Math.max(32, cpuCount * 2)}</span>
            </div>
          </div>

          {/* Hash Workers */}
          <div className="form-group">
            <label>Hash Workers <span className="mono badge">{hashWorkers}</span><InfoTip text="Number of parallel threads used for computing file hashes during deduplication. More workers speed up the dedup phase." /></label>
            <input
              type="range"
              className="form-range"
              min={1}
              max={16}
              value={hashWorkers}
              onChange={(e) => handleChange('parallel_hash_workers', e.target.value)}
            />
            <div className="range-labels">
              <span>1</span>
              <span>Parallel dedup hashing threads</span>
              <span>16</span>
            </div>
          </div>
          </div>

          <div className="form-row-2">
          {/* Batch Size */}
          <div className="form-group">
            <label>Batch Size <span className="mono badge">{batchSize}</span><InfoTip text="Number of files each worker thread processes before reporting progress. Larger batches reduce overhead but delay progress updates." /></label>
            <input
              type="range"
              className="form-range"
              min={1}
              max={200}
              value={batchSize}
              disabled={isEditingBuiltIn}
              onChange={(e) => handleProfileEdit('batch_size', Number(e.target.value))}
            />
            <div className="range-labels">
              <span>1</span>
              <span>Files per thread batch</span>
              <span>200</span>
            </div>
          </div>

          {/* Concurrent Copies */}
          <div className="form-group">
            <label>Concurrent Copies <span className="mono badge">{concurrentCopies}</span><InfoTip text="Maximum number of files being copied to the destination at the same time. Higher values improve throughput on fast drives." /></label>
            <input
              type="range"
              className="form-range"
              min={1}
              max={16}
              value={concurrentCopies}
              disabled={isEditingBuiltIn}
              onChange={(e) => handleProfileEdit('concurrent_copies', Number(e.target.value))}
            />
            <div className="range-labels">
              <span>1</span>
              <span>Parallel file copy operations</span>
              <span>16</span>
            </div>
          </div>
          </div>

          <div className="form-row-2">
          {/* Enable Fast Hashing */}
          <div className="form-group">
            <label className="form-toggle">
              <input
                type="checkbox"
                checked={enableFastHash}
                onChange={(e) => handleChange('enable_fast_hash', e.target.checked ? 'true' : 'false')}
              />
              <span>Enable Fast Hashing<InfoTip text="Reads only portions of each file (beginning, middle, end) instead of the entire content. Dramatically faster for large files with a very small chance of false matches." /></span>
            </label>
            <p className="form-hint">
              Sample beginning, middle and end of files instead of reading the full content. Much faster on large files, especially on SSDs.
            </p>
          </div>

          {/* Hash Sample Bytes */}
          <div className="form-group">
            <label>Hash Sample Size <span className="mono badge">{hashSampleBytes.toLocaleString()}</span><InfoTip text="Bytes read from each file section (start, middle, end) for quick dedup comparison. Larger samples are more accurate but slower." /></label>
            <input
              type="range"
              className="form-range"
              min={512}
              max={32768}
              step={512}
              value={hashSampleBytes}
              disabled={isEditingBuiltIn}
              onChange={(e) => handleProfileEdit('hash_bytes', Number(e.target.value))}
            />
            <div className="range-labels">
              <span>512</span>
              <span>Bytes sampled per file for deduplication</span>
              <span>32,768</span>
            </div>
          </div>
          </div>
        </div>
        </>}

        {activeTab === 'notifications' && <>
        <div className="settings-cards-grid">
        {/* ── Card 1: Notification Channels ────────────────── */}
        <div className="card">
          <div className="card-header">
            <h3><Bell size={16} style={{ marginRight: 6, verticalAlign: -2 }} />Notification Channels</h3>
          </div>
          <p className="form-hint" style={{ marginBottom: 16 }}>
            Enable one or both channels to receive notifications for the events below.
          </p>

          {/* Browser notifications */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <label className="form-toggle" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={values.browser_notify_enabled === 'true'}
                onChange={(e) => handleChange('browser_notify_enabled', e.target.checked ? 'true' : 'false')}
              />
              <span><Monitor size={14} style={{ marginRight: 6, verticalAlign: -2, opacity: 0.6 }} />Browser</span>
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {browserNotifyTestResult === 'sent' && <span style={{ color: 'var(--green)', fontSize: 12 }}>Sent!</span>}
              {browserNotifyTestResult && browserNotifyTestResult !== 'sent' && <span style={{ color: 'var(--red)', fontSize: 12 }}>{browserNotifyTestResult}</span>}
              <button
                className="btn sm"
                disabled={browserNotifyTesting || values.browser_notify_enabled !== 'true'}
                onClick={handleBrowserNotifyTest}
              >
                <Send size={14} /> {browserNotifyTesting ? 'Sending…' : 'Test'}
              </button>
            </div>
          </div>
          {'Notification' in window && Notification.permission === 'denied' && values.browser_notify_enabled === 'true' && (
            <p className="form-hint" style={{ color: 'var(--red)', marginBottom: 4 }}>
              Notifications are blocked. Allow them in your browser's site settings.
            </p>
          )}
          <p className="form-hint">
            Native desktop &amp; Android notifications. On iOS, add SnapSort to your home screen (requires iOS 16.4+).
          </p>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />

          {/* ntfy.sh */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <label className="form-toggle" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={values.ntfy_enabled === 'true'}
                onChange={(e) => handleChange('ntfy_enabled', e.target.checked ? 'true' : 'false')}
              />
              <span><Bell size={14} style={{ marginRight: 6, verticalAlign: -2, opacity: 0.6 }} />ntfy.sh</span>
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {ntfyTestResult === 'sent' && <span style={{ color: 'var(--green)', fontSize: 12 }}>Sent!</span>}
              {ntfyTestResult && ntfyTestResult !== 'sent' && <span style={{ color: 'var(--red)', fontSize: 12 }}>{ntfyTestResult}</span>}
              <button
                className="btn sm"
                disabled={ntfyTesting || values.ntfy_enabled !== 'true'}
                onClick={handleNtfyTest}
              >
                <Send size={14} /> {ntfyTesting ? 'Sending…' : 'Test'}
              </button>
              <button
                className="btn sm"
                disabled={values.ntfy_enabled !== 'true'}
                onClick={() => setNtfyConfigOpen(true)}
              >
                <SettingsIcon size={14} /> Configure
              </button>
            </div>
          </div>
          <p className="form-hint" style={{ margin: 0 }}>
            Push notifications via <a href="https://ntfy.sh" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>ntfy.sh</a> or a self-hosted server.
            {values.ntfy_enabled === 'true' && values.ntfy_topic && (
              <> Topic: <span className="mono" style={{ opacity: 0.8 }}>{values.ntfy_topic}</span></>
            )}
          </p>
        </div>

        {/* ── Card 2: Events & Interval ────────────────────── */}
        <div className="card">
          <div className="card-header">
            <h3>Events</h3>
          </div>
          <p className="form-hint" style={{ marginBottom: 16 }}>
            Choose which events trigger notifications on your enabled channels.
          </p>

          <div className="toggle-group-compact">
            <div className="form-group">
              <label className="form-toggle">
                <input
                  type="checkbox"
                  checked={values.ntfy_on_job_start === 'true'}
                  onChange={(e) => handleChange('ntfy_on_job_start', e.target.checked ? 'true' : 'false')}
                  disabled={values.ntfy_enabled !== 'true' && values.browser_notify_enabled !== 'true'}
                />
                <span>Job Started</span>
              </label>
            </div>

            <div className="form-group">
              <label className="form-toggle">
                <input
                  type="checkbox"
                  checked={values.ntfy_on_job_complete === 'true'}
                  onChange={(e) => handleChange('ntfy_on_job_complete', e.target.checked ? 'true' : 'false')}
                  disabled={values.ntfy_enabled !== 'true' && values.browser_notify_enabled !== 'true'}
                />
                <span>Job Completed / Cancelled</span>
              </label>
            </div>

            <div className="form-group">
              <label className="form-toggle">
                <input
                  type="checkbox"
                  checked={values.ntfy_on_job_error === 'true'}
                  onChange={(e) => handleChange('ntfy_on_job_error', e.target.checked ? 'true' : 'false')}
                  disabled={values.ntfy_enabled !== 'true' && values.browser_notify_enabled !== 'true'}
                />
                <span>Job Failed</span>
              </label>
            </div>

            <div className="form-group">
              <label className="form-toggle">
                <input
                  type="checkbox"
                  checked={values.ntfy_on_drive_scan === 'true'}
                  onChange={(e) => handleChange('ntfy_on_drive_scan', e.target.checked ? 'true' : 'false')}
                  disabled={values.ntfy_enabled !== 'true' && values.browser_notify_enabled !== 'true'}
                />
                <span>Drive Scan Start / Complete</span>
              </label>
            </div>

            <div className="form-group">
              <label className="form-toggle">
                <input
                  type="checkbox"
                  checked={values.ntfy_on_drive_attach === 'true'}
                  onChange={(e) => handleChange('ntfy_on_drive_attach', e.target.checked ? 'true' : 'false')}
                  disabled={values.ntfy_enabled !== 'true' && values.browser_notify_enabled !== 'true'}
                />
                <span>Drive Connected / Ejected</span>
              </label>
            </div>

            <div className="form-group">
              <label className="form-toggle">
                <input
                  type="checkbox"
                  checked={values.ntfy_on_drive_lost === 'true'}
                  onChange={(e) => handleChange('ntfy_on_drive_lost', e.target.checked ? 'true' : 'false')}
                  disabled={values.ntfy_enabled !== 'true' && values.browser_notify_enabled !== 'true'}
                />
                <span>Drive Unexpectedly Lost</span>
              </label>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

            <div className="form-group">
              <label className="form-toggle">
                <input
                  type="checkbox"
                  checked={values.ntfy_on_progress === 'true'}
                  onChange={(e) => handleChange('ntfy_on_progress', e.target.checked ? 'true' : 'false')}
                  disabled={values.ntfy_enabled !== 'true' && values.browser_notify_enabled !== 'true'}
                />
                <span>Recurring Progress Updates<InfoTip text="Sends periodic notification updates with current job stats (files processed, percentage complete) at the configured interval." /></span>
              </label>
              <p className="form-hint">Periodically send in-progress stats while a job is running.</p>
            </div>

            {values.ntfy_on_progress === 'true' && (() => {
              const ticks = [
                ...Array.from({ length: 10 }, (_, i) => (i + 1) * 60),
                ...Array.from({ length: 10 }, (_, i) => 900 + i * 300),
                ...Array.from({ length: 8 }, (_, i) => 4500 + i * 900),
              ];
              const secs = Number(values.ntfy_progress_interval) || 60;
              const idx = ticks.indexOf(secs) !== -1 ? ticks.indexOf(secs) : 0;
              const fmt = (s) => { const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60); if (h && m) return `${h}h ${m}m`; if (h) return `${h}h`; return `${m}m`; };
              return (
                <div className="form-group">
                  <label>Progress Interval <span className="mono badge">{fmt(secs)}</span></label>
                  <input
                    type="range"
                    className="form-range"
                    min={0}
                    max={ticks.length - 1}
                    step={1}
                    value={idx}
                    onChange={(e) => handleChange('ntfy_progress_interval', String(ticks[Number(e.target.value)]))}
                    disabled={values.ntfy_enabled !== 'true' && values.browser_notify_enabled !== 'true'}
                  />
                  <div className="range-labels">
                    <span>1m</span>
                    <span>Interval between progress notifications</span>
                    <span>3h</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* ── ntfy.sh Configuration Modal ──────────────────── */}
        <Modal open={ntfyConfigOpen} title="ntfy.sh Configuration" onClose={() => setNtfyConfigOpen(false)}>
          <div className="form-group">
            <label>Server URL</label>
            <input
              className="form-input mono"
              type="text"
              placeholder="https://ntfy.sh"
              value={values.ntfy_server || ''}
              onChange={(e) => handleChange('ntfy_server', e.target.value)}
            />
            <p className="form-hint">Default: https://ntfy.sh — or your self-hosted server URL.</p>
          </div>

          <div className="form-group">
            <label>Topic</label>
            <input
              className="form-input mono"
              type="text"
              placeholder="snapsort"
              value={values.ntfy_topic || ''}
              onChange={(e) => handleChange('ntfy_topic', e.target.value)}
            />
            <p className="form-hint">The ntfy topic your device subscribes to. Keep it unique and hard to guess.</p>
          </div>

          <div className="form-group">
            <label>Authentication</label>
            <select
              className="form-select"
              value={values.ntfy_auth_type || 'none'}
              onChange={(e) => handleChange('ntfy_auth_type', e.target.value)}
            >
              <option value="none">None</option>
              <option value="token">Access Token</option>
              <option value="basic">Username &amp; Password</option>
            </select>
          </div>

          {values.ntfy_auth_type === 'token' && (
            <div className="form-group">
              <label>Access Token</label>
              <input
                className="form-input mono"
                type="password"
                value={values.ntfy_auth_token || ''}
                onChange={(e) => handleChange('ntfy_auth_token', e.target.value)}
              />
            </div>
          )}

          {values.ntfy_auth_type === 'basic' && (
            <>
              <div className="form-group">
                <label>Username</label>
                <input
                  className="form-input mono"
                  type="text"
                  value={values.ntfy_username || ''}
                  onChange={(e) => handleChange('ntfy_username', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input
                  className="form-input mono"
                  type="password"
                  value={values.ntfy_password || ''}
                  onChange={(e) => handleChange('ntfy_password', e.target.value)}
                />
              </div>
            </>
          )}
        </Modal>
        </div>{/* end settings-cards-grid */}
        </>}

        {activeTab === 'general' && <>
        <div className="settings-cards-grid">
        <div className="settings-cards-stack">
        {/* ── Appearance ──────────────────── */}
        <div className="card">
          <div className="card-header"><h3>Appearance</h3></div>
          <div className="form-group">
            <label>Theme<InfoTip text="Controls the UI colour scheme. 'System' follows your OS dark/light mode automatically." /></label>
            <select
              className="form-select"
              value={values.theme || 'dark'}
              onChange={(e) => {
                handleChange('theme', e.target.value);
                /* Apply immediately for live preview */
                const theme = e.target.value;
                if (theme === 'system') {
                  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
                } else {
                  document.documentElement.setAttribute('data-theme', theme);
                }
              }}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
            <p className="form-hint">Choose between dark, light, or follow your operating system preference.</p>
          </div>
        </div>

        {/* ── Diagnostics Page Toggle ──────────────────── */}
        <div className="card">
          <div className="card-header"><h3>Diagnostics</h3></div>
          <div className="form-group">
            <label className="form-toggle">
              <input
                type="checkbox"
                checked={values.diagnostics_enabled === 'true'}
                onChange={(e) => handleChange('diagnostics_enabled', e.target.checked ? 'true' : 'false')}
              />
              <span>Enable Diagnostics Page<InfoTip text="Adds a Diagnostics page to the sidebar showing system information, mounted volumes, and recent log output for troubleshooting." /></span>
            </label>
            <p className="form-hint">
              Show a dedicated Diagnostics page in the sidebar with system info, volume mounts, and recent logs.
            </p>
          </div>
        </div>
        </div>{/* end settings-cards-stack */}

        {/* ── Date & Time Display ──────────────────── */}
        <div className="card">
          <div className="card-header"><h3>Date &amp; Time Display</h3></div>

          <div className="form-group">
            <label>Date Format</label>
            <select
              className="form-select"
              value={values.date_format || 'system'}
              onChange={(e) => handleChange('date_format', e.target.value)}
            >
              <option value="system">System Default</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
            </select>
          </div>

          <div className="form-group">
            <label>Time Format</label>
            <select
              className="form-select"
              value={values.time_format || 'system'}
              onChange={(e) => handleChange('time_format', e.target.value)}
            >
              <option value="system">System Default</option>
              <option value="12h">12-hour (AM/PM)</option>
              <option value="24h">24-hour</option>
            </select>
          </div>

          <p className="form-hint">
            Preview: {fmtDateTime(new Date().toISOString(), { date_format: values.date_format || 'system', time_format: values.time_format || 'system' })}
          </p>
        </div>
        </div>{/* end settings-cards-grid */}
        </>}
      </div>

      {/* ── Floating unsaved-changes bar ──────────────────── */}
      <div
        style={{
          position: 'fixed',
          bottom: hasChanges ? 24 : -120,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 24px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          transition: 'bottom 0.3s ease',
        }}
      >
        <span style={{ color: 'var(--orange)', fontSize: 13, fontWeight: 500 }}>
          You have unsaved changes
        </span>
        <button className="btn sm" onClick={handleDiscard}>
          <Undo2 size={14} /> Discard
        </button>
        <button className="btn sm primary" onClick={handleSave}>
          {saved ? <><Check size={14} /> Saved</> : <><Save size={14} /> Save</>}
        </button>
      </div>
    </>
  );
}
