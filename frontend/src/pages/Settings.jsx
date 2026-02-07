import { useState, useEffect } from 'react';
import { fetchSettings, updateSettings } from '../api';

const settingsMeta = [
  { key: 'min_width',              label: 'Min Width (px)',           type: 'number' },
  { key: 'min_height',             label: 'Min Height (px)',          type: 'number' },
  { key: 'min_filesize',           label: 'Min File Size (bytes)',    type: 'number' },
  { key: 'dedup_strict_threshold', label: 'Dedup Strict Threshold (%)', type: 'number' },
  { key: 'dedup_log_threshold',    label: 'Dedup Log Threshold (%)',    type: 'number' },
  { key: 'fast_hash_bytes',        label: 'Fast Hash Sample (bytes)',   type: 'number' },
  { key: 'enable_fast_hash',       label: 'Enable Fast Hashing',       type: 'toggle' },
  { key: 'enable_csv_log',         label: 'Enable CSV Logging',        type: 'toggle' },
];

export default function Settings() {
  const [values, setValues] = useState({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchSettings().then(setValues).catch(console.error);
  }, []);

  const handleChange = (key, val) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  };

  const handleSave = async () => {
    await updateSettings(values);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <div className="page-header flex justify-between items-center">
        <div>
          <h2>Settings</h2>
          <p>Configure the SnapSort engine defaults</p>
        </div>
        <button className="btn primary" onClick={handleSave}>
          {saved ? '✓ Saved' : 'Save Settings'}
        </button>
      </div>

      <div className="page-body">
        <div className="card" style={{ maxWidth: 600 }}>
          {settingsMeta.map((s) => (
            <div className="form-group" key={s.key}>
              {s.type === 'toggle' ? (
                <label className="form-toggle">
                  <input
                    type="checkbox"
                    checked={values[s.key] === 'true'}
                    onChange={(e) => handleChange(s.key, e.target.checked ? 'true' : 'false')}
                  />
                  <span>{s.label}</span>
                </label>
              ) : (
                <>
                  <label>{s.label}</label>
                  <input
                    className="form-input mono"
                    type="number"
                    value={values[s.key] || ''}
                    onChange={(e) => handleChange(s.key, e.target.value)}
                  />
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
