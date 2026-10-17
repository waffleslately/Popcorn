import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/auth-store';
import './RateScreeningModal.css';

interface Props {
  roomCode: string;
  tmdbId: number;
  movieTitle: string;
  onClose: () => void;
}

export function RateScreeningModal({ roomCode, tmdbId, movieTitle, onClose }: Props) {
  const { user } = useAuthStore();
  const [rating, setRating] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) return;
    setSaving(true);
    await supabase.from('diary').upsert({
      user_id: user.id,
      tmdb_id: tmdbId,
      watched_on: new Date().toISOString().split('T')[0],
      rating: rating,
      room_code: roomCode,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => {
      onClose();
    }, 1500);
  };

  return (
    <div className="rate-backdrop" role="dialog" aria-modal="true" aria-label="Rate screening">
      <div className="rate-modal">
        <button className="rate-close" onClick={onClose} aria-label="Close">✕</button>

        <h2 className="rate-title">How was the film?</h2>
        <p className="rate-movie">{movieTitle}</p>
        <p className="rate-room-badge">Watched together in room {roomCode}</p>

        {saved ? (
          <p className="rate-success">✓ Saved to your Popcorn Diary!</p>
        ) : (
          <form onSubmit={handleSubmit} className="rate-form">
            <div className="rate-stars-row">
              {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`rate-star-btn ${rating >= r ? 'rate-star-btn--active' : ''}`}
                  onClick={() => setRating(r)}
                >
                  {r % 1 === 0 ? '★' : '½'}
                </button>
              ))}
            </div>
            {rating > 0 && <span className="rate-selected-text">{rating} Stars</span>}

            <div className="rate-actions">
              <button
                type="submit"
                className="rate-btn-submit"
                disabled={saving || rating === 0}
              >
                {saving ? 'Saving…' : 'Log to Diary'}
              </button>
              <button type="button" className="rate-btn-skip" onClick={onClose}>
                Skip
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
