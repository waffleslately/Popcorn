import { useState } from 'react';
import { useAuthStore } from '../stores/auth-store';
import './SettingsPage.css';

interface Props {
  onBack: () => void;
}

export function SettingsPage({ onBack }: Props) {
  const { user, profile, updateProfile, signOut, deleteAccount } = useAuthStore();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [isPrivate, setIsPrivate] = useState(profile?.is_private ?? false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!user || !profile) return (
    <div className="settings-root">
      <button className="settings-back" onClick={onBack}>← Back</button>
      <p>Sign in to manage your settings.</p>
    </div>
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await updateProfile({ display_name: displayName, bio, is_private: isPrivate });
    setMsg(error ? `Error: ${error}` : 'Saved!');
    setSaving(false);
    setTimeout(() => setMsg(''), 3000);
  };

  const handleDelete = async () => {
    setDeleting(true);
    const { error } = await deleteAccount();
    if (error) { setMsg(`Error: ${error}`); setDeleting(false); }
    // on success the auth listener will clear state and redirect to box-office
  };

  return (
    <div className="settings-root">
      <button className="settings-back" onClick={onBack}>← Back</button>

      <h1 className="settings-title">Settings</h1>

      <form onSubmit={handleSave} className="settings-form">
        <div className="settings-group">
          <label className="settings-label">Display name</label>
          <input
            className="settings-input"
            type="text"
            maxLength={60}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How you appear to others"
          />
        </div>

        <div className="settings-group">
          <label className="settings-label">Bio</label>
          <textarea
            className="settings-textarea"
            rows={3}
            maxLength={300}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A few words about yourself"
          />
        </div>

        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
          />
          Private profile — hide diary and reviews from non-followers
        </label>

        <button type="submit" className="settings-btn-save" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {msg && <p className={`settings-msg ${msg.startsWith('Error') ? 'settings-msg--error' : ''}`}>{msg}</p>}
      </form>

      <section className="settings-danger-zone">
        <h2 className="settings-danger-title">Danger zone</h2>
        {!deleteConfirm ? (
          <button className="settings-btn-delete" onClick={() => setDeleteConfirm(true)}>
            Delete my account and all data
          </button>
        ) : (
          <div className="settings-delete-confirm">
            <p>This will permanently delete your account, diary, reviews, watchlist, and lists. This cannot be undone.</p>
            <div className="settings-delete-actions">
              <button className="settings-btn-delete-confirm" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Yes, delete everything'}
              </button>
              <button className="settings-btn-cancel" onClick={() => setDeleteConfirm(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <button className="settings-btn-signout" onClick={signOut}>Sign out</button>

      <footer className="settings-tmdb-footer">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </footer>
    </div>
  );
}
