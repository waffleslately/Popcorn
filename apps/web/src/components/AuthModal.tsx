import React, { useState } from 'react';
import { useAuthStore } from '../stores/auth-store';
import './AuthModal.css';

interface Props {
  onClose: () => void;
}

export function AuthModal({ onClose }: Props) {
  const { signInWithMagicLink, signInWithGoogle, error } = useAuthStore();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [working, setWorking] = useState(false);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setWorking(true);
    const { error: err } = await signInWithMagicLink(email.trim());
    setWorking(false);
    if (!err) setSent(true);
  };

  const handleGoogle = async () => {
    setWorking(true);
    await signInWithGoogle();
    // Page will redirect; no need to setWorking(false)
  };

  return (
    <div className="auth-backdrop" role="dialog" aria-modal="true" aria-label="Sign in">
      <div className="auth-modal">
        <button className="auth-close" onClick={onClose} aria-label="Close">✕</button>

        <h2 className="auth-title">Sign in to Popcorn</h2>
        <p className="auth-sub">
          Save your diary, reviews, and watchlist. Guests can still join rooms without an account.
        </p>

        {sent ? (
          <div className="auth-sent">
            <p>✉️ Magic link sent to <strong>{email}</strong>.</p>
            <p className="auth-sent-note">Check your inbox (and spam folder).</p>
          </div>
        ) : (
          <>
            <button
              className="auth-btn-google"
              onClick={handleGoogle}
              disabled={working}
              type="button"
            >
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Continue with Google
            </button>

            <div className="auth-divider"><span>or</span></div>

            <form onSubmit={handleMagicLink} className="auth-form">
              <label htmlFor="auth-email" className="auth-label">Email address</label>
              <input
                id="auth-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="auth-input"
              />
              <button type="submit" className="auth-btn-primary" disabled={working}>
                {working ? 'Sending…' : 'Send magic link'}
              </button>
            </form>

            {error && <p className="auth-error" role="alert">{error}</p>}
          </>
        )}

        <p className="auth-footer-note">
          By signing in you agree to our (very short) privacy policy:
          we only store your email for auth, never sell it.
        </p>
      </div>
    </div>
  );
}
