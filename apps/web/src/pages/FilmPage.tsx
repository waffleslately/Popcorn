import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/auth-store';
import './FilmPage.css';

interface Props {
  tmdbId: number;
  onBack: () => void;
}

interface TMDBMovie {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  release_date: string;
  vote_average: number;
  genres: { id: number; name: string }[];
  trailerKey?: string;
}

interface Review {
  id: string;
  user_id: string;
  body: string;
  rating: number | null;
  contains_spoilers: boolean;
  created_at: string;
  profiles: any;
}

const API_BASE = (import.meta.env.VITE_SERVER_URL as string | undefined) || window.location.origin;
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

export function FilmPage({ tmdbId, onBack }: Props) {
  const { user } = useAuthStore();
  const [movie, setMovie] = useState<TMDBMovie | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [myRating, setMyRating] = useState<number | null>(null);
  const [inWatchlist, setInWatchlist] = useState(false);
  const [reviewBody, setReviewBody] = useState('');
  const [reviewRating, setReviewRating] = useState<number>(0);
  const [spoiler, setSpoiler] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [movieRes, reviewRes] = await Promise.all([
        fetch(`${API_BASE}/api/tmdb/movie/${tmdbId}`).then((r) => r.json()),
        supabase
          .from('reviews')
          .select('id, user_id, body, rating, contains_spoilers, created_at, profiles(username, display_name)')
          .eq('tmdb_id', tmdbId)
          .order('created_at', { ascending: false }),
      ]);
      setMovie(movieRes);
      setReviews((reviewRes.data ?? []) as unknown as Review[]);

      if (user) {
        const [watchRes, diaryRes] = await Promise.all([
          supabase.from('watchlist').select('tmdb_id').eq('user_id', user.id).eq('tmdb_id', tmdbId).maybeSingle(),
          supabase.from('diary').select('rating').eq('user_id', user.id).eq('tmdb_id', tmdbId).order('watched_on', { ascending: false }).limit(1).maybeSingle(),
        ]);
        setInWatchlist(!!watchRes.data);
        setMyRating(diaryRes.data?.rating ?? null);
      }
      setLoading(false);
    })();
  }, [tmdbId, user]);

  const toggleWatchlist = async () => {
    if (!user) return;
    if (inWatchlist) {
      await supabase.from('watchlist').delete().eq('user_id', user.id).eq('tmdb_id', tmdbId);
      setInWatchlist(false);
    } else {
      await supabase.from('watchlist').insert({ user_id: user.id, tmdb_id: tmdbId });
      setInWatchlist(true);
    }
  };

  const submitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !reviewBody.trim()) return;
    setSubmitting(true);
    const { data, error } = await supabase.from('reviews').insert({
      user_id: user.id,
      tmdb_id: tmdbId,
      body: reviewBody.trim(),
      rating: reviewRating > 0 ? reviewRating : null,
      contains_spoilers: spoiler,
    }).select('id, user_id, body, rating, contains_spoilers, created_at, profiles(username, display_name)').single();

    if (!error && data) {
      setReviews((prev) => [data as unknown as Review, ...prev]);
      setReviewBody('');
      setReviewRating(0);
      setSpoiler(false);
    }
    setSubmitting(false);
  };

  const reportReview = async (reviewId: string) => {
    if (!user) return;
    await supabase.from('reports').insert({ reporter_id: user.id, review_id: reviewId, reason: 'flagged' });
    setReportedIds((prev) => new Set(prev).add(reviewId));
  };

  if (loading) return <div className="fp-loading">Loading…</div>;
  if (!movie) return <div className="fp-loading">Film not found.</div>;

  return (
    <div className="fp-root">
      <button className="fp-back" onClick={onBack}>← Back</button>

      <div className="fp-hero">
        {movie.poster_path && (
          <img
            src={`${TMDB_IMG}${movie.poster_path}`}
            alt={movie.title}
            className="fp-poster"
          />
        )}
        <div className="fp-info">
          <h1 className="fp-title">{movie.title}</h1>
          <p className="fp-year">{movie.release_date?.slice(0, 4)}</p>
          {movie.genres?.length > 0 && (
            <p className="fp-genres">{movie.genres.map((g) => g.name).join(' · ')}</p>
          )}
          <p className="fp-overview">{movie.overview}</p>
          <div className="fp-actions">
            {user && (
              <button className={`fp-watchlist-btn ${inWatchlist ? 'fp-watchlist-btn--active' : ''}`} onClick={toggleWatchlist}>
                {inWatchlist ? '✓ In watchlist' : '+ Watchlist'}
              </button>
            )}
            {myRating != null && <span className="fp-my-rating">Your rating: {myRating}★</span>}
          </div>
        </div>
      </div>

      {user && (
        <section className="fp-review-form-section">
          <h2 className="fp-section-title">Write a review</h2>
          <form onSubmit={submitReview} className="fp-review-form">
            <div className="fp-rating-row">
              {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`fp-star-btn ${reviewRating >= r ? 'fp-star-btn--active' : ''}`}
                  onClick={() => setReviewRating(r)}
                  aria-label={`${r} stars`}
                >
                  {r % 1 === 0 ? '★' : '½'}
                </button>
              ))}
              {reviewRating > 0 && (
                <button type="button" className="fp-clear-rating" onClick={() => setReviewRating(0)}>✕</button>
              )}
            </div>
            <textarea
              className="fp-review-textarea"
              value={reviewBody}
              onChange={(e) => setReviewBody(e.target.value)}
              placeholder="What did you think?"
              rows={4}
              required
            />
            <label className="fp-spoiler-label">
              <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} />
              Contains spoilers
            </label>
            <button type="submit" className="fp-submit-btn" disabled={submitting || !reviewBody.trim()}>
              {submitting ? 'Saving…' : 'Post review'}
            </button>
          </form>
        </section>
      )}

      <section className="fp-reviews-section">
        <h2 className="fp-section-title">Reviews</h2>
        {reviews.length === 0 && <p className="fp-empty">No reviews yet. Be the first!</p>}
        {reviews.map((r) => {
          const prof = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
          return (
            <div key={r.id} className="fp-review-card">
              <div className="fp-review-header">
                <span className="fp-reviewer">
                  {prof?.display_name || prof?.username || 'Anonymous'}
                </span>
                {r.rating != null && <span className="fp-review-stars">{r.rating}★</span>}
                {r.contains_spoilers && <span className="fp-spoiler-tag">spoilers</span>}
                {user && r.user_id !== user.id && !reportedIds.has(r.id) && (
                  <button className="fp-report-btn" onClick={() => reportReview(r.id)}>Report</button>
                )}
                {reportedIds.has(r.id) && <span className="fp-reported-note">Reported</span>}
              </div>
              <p className="fp-review-body">{r.body}</p>
            </div>
          );
        })}
      </section>

      <footer className="fp-tmdb-footer">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </footer>
    </div>
  );
}
