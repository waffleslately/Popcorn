import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/auth-store';
import './DiaryPage.css';

interface Props {
  onFilm: (tmdbId: number) => void;
}

interface DiaryEntry {
  tmdb_id: number;
  watched_on: string;
  rating: number | null;
  room_code: string | null;
}

export function DiaryPage({ onFilm }: Props) {
  const { user } = useAuthStore();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    supabase
      .from('diary')
      .select('tmdb_id, watched_on, rating, room_code')
      .eq('user_id', user.id)
      .order('watched_on', { ascending: false })
      .then(({ data }) => {
        setEntries((data ?? []) as DiaryEntry[]);
        setLoading(false);
      });
  }, [user]);

  if (!user) return (
    <div className="diary-root">
      <h1 className="diary-title">Diary</h1>
      <p className="diary-empty">Sign in to keep a diary of films you've watched.</p>
    </div>
  );

  return (
    <div className="diary-root">
      <h1 className="diary-title">Diary</h1>
      {loading && <p className="diary-empty">Loading…</p>}
      {!loading && entries.length === 0 && (
        <p className="diary-empty">Your diary is empty. Start watching some films!</p>
      )}
      {entries.map((e) => (
        <button
          key={`${e.tmdb_id}-${e.watched_on}`}
          className="diary-row"
          onClick={() => onFilm(e.tmdb_id)}
        >
          <span className="diary-date">{e.watched_on}</span>
          <span className="diary-film">Film #{e.tmdb_id}</span>
          {e.rating != null && <span className="diary-rating">{e.rating}★</span>}
          {e.room_code && <span className="diary-room" title="Watched in a Popcorn room">🎬 Together</span>}
        </button>
      ))}

      <footer className="diary-tmdb-footer">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </footer>
    </div>
  );
}
