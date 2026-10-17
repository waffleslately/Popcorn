import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/auth-store';
import './FeedPage.css';

interface Props {
  onFilm: (tmdbId: number) => void;
  onProfile: (username: string) => void;
}

interface FeedItem {
  id: string;
  user_id: string;
  tmdb_id: number;
  body: string;
  rating: number | null;
  created_at: string;
  profiles: any;
}

export function FeedPage({ onFilm, onProfile }: Props) {
  const { user } = useAuthStore();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    (async () => {
      // Get IDs of people I follow
      const { data: follows } = await supabase
        .from('follows')
        .select('followee_id')
        .eq('follower_id', user.id);

      const followeeIds = (follows ?? []).map((f) => f.followee_id);

      if (followeeIds.length === 0) { setLoading(false); return; }

      const { data } = await supabase
        .from('reviews')
        .select('id, user_id, tmdb_id, body, rating, created_at, profiles(username, display_name)')
        .in('user_id', followeeIds)
        .order('created_at', { ascending: false })
        .limit(60);

      setItems((data ?? []) as unknown as FeedItem[]);
      setLoading(false);
    })();
  }, [user]);

  if (!user) return (
    <div className="feed-root">
      <h1 className="feed-title">Feed</h1>
      <p className="feed-empty">Sign in to see activity from people you follow.</p>
    </div>
  );

  return (
    <div className="feed-root">
      <h1 className="feed-title">Feed</h1>
      {loading && <p className="feed-empty">Loading…</p>}
      {!loading && items.length === 0 && (
        <p className="feed-empty">Follow some people to see their reviews here.</p>
      )}
      {items.map((item) => {
        const prof = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
        return (
          <div key={item.id} className="feed-item">
            <div className="feed-item-header">
              <button
                className="feed-username"
                onClick={() => prof?.username && onProfile(prof.username)}
              >
                {prof?.display_name || prof?.username || 'Unknown'}
              </button>
              <span className="feed-meta">reviewed</span>
              <button className="feed-film-link" onClick={() => onFilm(item.tmdb_id)}>
                Film #{item.tmdb_id}
              </button>
            {item.rating != null && <span className="feed-rating">{item.rating}★</span>}
            <span className="feed-date">
              {new Date(item.created_at).toLocaleDateString()}
            </span>
          </div>
          <p className="feed-body">{item.body}</p>
        </div>
        );
      })}

      <footer className="feed-tmdb-footer">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </footer>
    </div>
  );
}
