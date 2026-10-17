import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/auth-store';
import './ProfilePage.css';

interface Props {
  username: string;
  onBack: () => void;
  onFilm: (tmdbId: number) => void;
}

interface PublicProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_private: boolean;
}

interface DiaryEntry {
  tmdb_id: number;
  watched_on: string;
  rating: number | null;
  room_code: string | null;
}

interface Review {
  id: string;
  tmdb_id: number;
  body: string;
  rating: number | null;
  contains_spoilers: boolean;
  created_at: string;
}

export function ProfilePage({ username, onBack, onFilm }: Props) {
  const { user, profile: myProfile } = useAuthStore();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [tab, setTab] = useState<'diary' | 'reviews' | 'lists'>('diary');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const isOwn = myProfile?.username === username;

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: prof, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, bio, is_private')
        .eq('username', username)
        .single();

      if (error || !prof) { setNotFound(true); setLoading(false); return; }
      setProfile(prof as PublicProfile);

      // Parallel fetch
      const [diaryRes, reviewRes, followRes, followerRes] = await Promise.all([
        supabase
          .from('diary')
          .select('tmdb_id, watched_on, rating, room_code')
          .eq('user_id', prof.id)
          .order('watched_on', { ascending: false })
          .limit(50),
        supabase
          .from('reviews')
          .select('id, tmdb_id, body, rating, contains_spoilers, created_at')
          .eq('user_id', prof.id)
          .order('created_at', { ascending: false }),
        user
          ? supabase
              .from('follows')
              .select('follower_id')
              .eq('follower_id', user.id)
              .eq('followee_id', prof.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from('follows')
          .select('follower_id', { count: 'exact', head: true })
          .eq('followee_id', prof.id),
      ]);

      setDiary((diaryRes.data ?? []) as DiaryEntry[]);
      setReviews((reviewRes.data ?? []) as Review[]);
      setIsFollowing(!!followRes.data);
      setFollowerCount(followerRes.count ?? 0);
      setLoading(false);
    })();
  }, [username, user]);

  const toggleFollow = async () => {
    if (!user || !profile) return;
    if (isFollowing) {
      await supabase.from('follows').delete()
        .eq('follower_id', user.id).eq('followee_id', profile.id);
      setIsFollowing(false);
      setFollowerCount((c) => c - 1);
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, followee_id: profile.id });
      setIsFollowing(true);
      setFollowerCount((c) => c + 1);
    }
  };

  if (loading) return <div className="pp-loading">Loading…</div>;
  if (notFound) return (
    <div className="pp-not-found">
      <button className="pp-back" onClick={onBack}>← Back</button>
      <p>User <strong>@{username}</strong> not found.</p>
    </div>
  );
  if (!profile) return null;

  return (
    <div className="pp-root">
      <button className="pp-back" onClick={onBack}>← Back</button>

      <header className="pp-header">
        {profile.avatar_url
          ? <img src={profile.avatar_url} alt={profile.username} className="pp-avatar" />
          : <div className="pp-avatar pp-avatar-placeholder">{profile.username[0].toUpperCase()}</div>
        }
        <div className="pp-header-info">
          <h1 className="pp-username">@{profile.username}</h1>
          {profile.display_name && <p className="pp-display-name">{profile.display_name}</p>}
          {profile.bio && <p className="pp-bio">{profile.bio}</p>}
          <p className="pp-follower-count">{followerCount} follower{followerCount !== 1 ? 's' : ''}</p>
        </div>
        {user && !isOwn && (
          <button
            className={`pp-follow-btn ${isFollowing ? 'pp-follow-btn--following' : ''}`}
            onClick={toggleFollow}
          >
            {isFollowing ? 'Following' : 'Follow'}
          </button>
        )}
      </header>

      <nav className="pp-tabs">
        {(['diary', 'reviews', 'lists'] as const).map((t) => (
          <button
            key={t}
            className={`pp-tab ${tab === t ? 'pp-tab--active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      {tab === 'diary' && (
        <section className="pp-diary">
          {diary.length === 0 && <p className="pp-empty">No diary entries yet.</p>}
          {diary.map((entry) => (
            <button
              key={`${entry.tmdb_id}-${entry.watched_on}`}
              className="pp-diary-row"
              onClick={() => onFilm(entry.tmdb_id)}
            >
              <span className="pp-diary-date">{entry.watched_on}</span>
              <span className="pp-diary-tmdb">Film #{entry.tmdb_id}</span>
              {entry.rating != null && <span className="pp-diary-rating">{'★'.repeat(entry.rating * 2 / 2)} {entry.rating}★</span>}
              {entry.room_code && <span className="pp-diary-room" title="Watched together">🎬 {entry.room_code}</span>}
            </button>
          ))}
        </section>
      )}

      {tab === 'reviews' && (
        <section className="pp-reviews">
          {reviews.length === 0 && <p className="pp-empty">No reviews yet.</p>}
          {reviews.map((r) => (
            <div key={r.id} className="pp-review-card">
              <div className="pp-review-meta">
                <button className="pp-review-film-link" onClick={() => onFilm(r.tmdb_id)}>
                  Film #{r.tmdb_id}
                </button>
                {r.rating != null && <span>{r.rating}★</span>}
                {r.contains_spoilers && <span className="pp-spoiler-tag">spoilers</span>}
              </div>
              <p className="pp-review-body">{r.body}</p>
            </div>
          ))}
        </section>
      )}

      {tab === 'lists' && (
        <section className="pp-lists">
          <p className="pp-empty">Lists coming soon.</p>
        </section>
      )}

      <footer className="pp-tmdb-footer">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </footer>
    </div>
  );
}
