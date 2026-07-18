import Modal from './Modal';

export default function NtfyConfigModal({
  open,
  onClose,
  values,
  onChange,
  onSecretChange,
  onSecretClear,
}) {
  return (
    <Modal open={open} title="ntfy.sh Configuration" onClose={onClose}>
      <div className="form-group">
        <label htmlFor="ntfy-server">Server URL</label>
        <input
          id="ntfy-server"
          className="form-input mono"
          type="url"
          placeholder="https://ntfy.sh"
          value={values.ntfy_server || ''}
          onChange={(event) => onChange('ntfy_server', event.target.value)}
        />
        <p className="form-hint">Default: https://ntfy.sh — or your self-hosted server URL.</p>
      </div>

      <div className="form-group">
        <label htmlFor="ntfy-topic">Topic</label>
        <input
          id="ntfy-topic"
          className="form-input mono"
          type="text"
          placeholder="snapsort"
          value={values.ntfy_topic || ''}
          onChange={(event) => onChange('ntfy_topic', event.target.value)}
        />
        <p className="form-hint">Keep the subscribed topic unique and hard to guess.</p>
      </div>

      <div className="form-group">
        <label htmlFor="ntfy-auth-type">Authentication</label>
        <select
          id="ntfy-auth-type"
          className="form-select"
          value={values.ntfy_auth_type || 'none'}
          onChange={(event) => onChange('ntfy_auth_type', event.target.value)}
        >
          <option value="none">None</option>
          <option value="token">Access Token</option>
          <option value="basic">Username &amp; Password</option>
        </select>
      </div>

      {values.ntfy_auth_type === 'token' && (
        <div className="form-group">
          <label htmlFor="ntfy-auth-token">Access Token</label>
          <div className="flex gap-8">
            <input
              id="ntfy-auth-token"
              className="form-input mono"
              type="password"
              autoComplete="off"
              placeholder={values.ntfy_auth_token_configured ? 'Configured — enter a replacement' : ''}
              value={values.ntfy_auth_token || ''}
              onChange={(event) => onSecretChange('ntfy_auth_token', event.target.value)}
            />
            {values.ntfy_auth_token_configured && (
              <button type="button" className="btn" onClick={() => onSecretClear('ntfy_auth_token')}>
                Clear
              </button>
            )}
          </div>
          <p className="form-hint">Saved tokens are never returned to the browser.</p>
        </div>
      )}

      {values.ntfy_auth_type === 'basic' && (
        <>
          <div className="form-group">
            <label htmlFor="ntfy-username">Username</label>
            <input
              id="ntfy-username"
              className="form-input mono"
              type="text"
              autoComplete="username"
              value={values.ntfy_username || ''}
              onChange={(event) => onChange('ntfy_username', event.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="ntfy-password">Password</label>
            <div className="flex gap-8">
              <input
                id="ntfy-password"
                className="form-input mono"
                type="password"
                autoComplete="new-password"
                placeholder={values.ntfy_password_configured ? 'Configured — enter a replacement' : ''}
                value={values.ntfy_password || ''}
                onChange={(event) => onSecretChange('ntfy_password', event.target.value)}
              />
              {values.ntfy_password_configured && (
                <button type="button" className="btn" onClick={() => onSecretClear('ntfy_password')}>
                  Clear
                </button>
              )}
            </div>
            <p className="form-hint">Saved passwords are never returned to the browser.</p>
          </div>
        </>
      )}
    </Modal>
  );
}