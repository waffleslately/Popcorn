import { useState, useEffect, useMemo, useRef } from 'react';
import Fuse from 'fuse.js';
import { type Source } from '@popcorn/shared';
import { useRoomStore } from '../stores/room-store';
import './Lobby.css';

export interface MovieItem {
  id: number;
  title: string;
  overview: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average: number;
  release_date?: string;
  trailerKey?: string;
}

interface Genre {
  id: number;
  name: string;
}

interface LobbyProps {
  onSelectMovie: (source: Source) => void;
  onAddToPlaylist: (source: Source) => void;
  onClose: () => void;
}

// Fallback curated open-domain cinema trailers/films if TMDB key is missing or offline
const CURATED_CINEMA: MovieItem[] = [
  {
    id: 101,
    title: 'Metropolis',
    overview: 'In a futuristic city sharply divided between the working class and the city planners, the son of the city\'s mastermind falls in love with a working-class prophet.',
    poster_path: null,
    vote_average: 8.2,
    release_date: '1927-01-10',
    trailerKey: 'on24qgkL3Qw',
  },
  {
    id: 102,
    title: 'Night of the Living Dead',
    overview: 'A ragtag group of Pennsylvanians barricade themselves in an old farmhouse to remain safe from a horde of flesh-eating ghouls.',
    poster_path: null,
    vote_average: 7.6,
    release_date: '1968-10-01',
    trailerKey: '5gUKZpgVfSe',
  },
  {
    id: 103,
    title: 'Charade',
    overview: 'Romance and suspense in Paris as a woman is pursued by several men who want a fortune her murdered husband had stolen.',
    poster_path: null,
    vote_average: 7.9,
    release_date: '1963-12-05',
    trailerKey: 'Gg42W7c43XQ',
  },
  {
    id: 104,
    title: 'His Girl Friday',
    overview: 'A newspaper editor uses every trick in the book to keep his ace reporter ex-wife from remarrying and quitting the journalism business.',
    poster_path: null,
    vote_average: 7.8,
    release_date: '1940-01-18',
    trailerKey: '8sUqG4U1W5Q',
  },
  {
    id: 105,
    title: 'Nosferatu',
    overview: 'Vampire Count Orlok expresses interest in a new residence and real estate agent Hutter\'s wife.',
    poster_path: null,
    vote_average: 7.9,
    release_date: '1922-03-04',
    trailerKey: 'ZxlJxDr26mM',
  },
];

const DEFAULT_GENRES: Genre[] = [
  { id: 28, name: 'Action' },
  { id: 18, name: 'Drama' },
  { id: 35, name: 'Comedy' },
  { id: 27, name: 'Horror' },
  { id: 878, name: 'Sci-Fi' },
  { id: 53, name: 'Thriller' },
  { id: 16, name: 'Animation' },
  { id: 99, name: 'Documentary' },
];

function parseVideoSource(raw: string, customTitle?: string): Source | null {
  const input = raw.trim();
  if (!input) return null;

  // YouTube URL or raw 11-char ID
  const ytMatch = input.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/i
  );
  if (ytMatch) {
    return {
      kind: 'youtube',
      ref: ytMatch[1],
      title: customTitle?.trim() || 'YouTube Screening',
    };
  }
  if (/^[\w-]{11}$/.test(input)) {
    return {
      kind: 'youtube',
      ref: input,
      title: customTitle?.trim() || 'YouTube Screening',
    };
  }

  // HLS stream (.m3u8)
  if (input.includes('.m3u8')) {
    return {
      kind: 'stream',
      ref: input,
      title: customTitle?.trim() || 'Live HLS Stream',
    };
  }

  // MP4 / WebM / direct web file
  if (input.startsWith('http://') || input.startsWith('https://')) {
    return {
      kind: 'file',
      ref: input,
      title: customTitle?.trim() || 'Web Video Film',
    };
  }

  return null;
}

export function Lobby({ onSelectMovie, onAddToPlaylist, onClose }: LobbyProps) {
  const SERVER_URL =
    (import.meta.env.VITE_SERVER_URL as string | undefined) || window.location.origin;
  const { snapshot } = useRoomStore();
  const isHost = snapshot?.hostId === snapshot?.you;

  const [movies, setMovies] = useState<MovieItem[]>(CURATED_CINEMA);
  const [genres, setGenres] = useState<Genre[]>(DEFAULT_GENRES);
  const [selectedGenre, setSelectedGenre] = useState<number | null>(null);
  const [year, setYear] = useState<string>('');
  const [minRating, setMinRating] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [featuredMovie, setFeaturedMovie] = useState<MovieItem>(CURATED_CINEMA[0]);
  const [isLoading, setIsLoading] = useState(false);
  const [apiNotice, setApiNotice] = useState<string | null>(null);

  // Custom Direct URL State
  const [directUrl, setDirectUrl] = useState('');
  const [directTitle, setDirectTitle] = useState('');
  const [directError, setDirectError] = useState<string | null>(null);

  const searchTimer = useRef<number | null>(null);

  // Fetch TMDB genres on mount
  useEffect(() => {
    fetch(`${SERVER_URL}/api/tmdb/genres`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data.genres && data.genres.length > 0) {
          setGenres(data.genres.slice(0, 10));
        }
      })
      .catch(() => {
        // Fall back to default genre list
      });
  }, [SERVER_URL]);

  // Fetch movies: either via active search query or discover filters
  useEffect(() => {
    if (searchTimer.current) {
      window.clearTimeout(searchTimer.current);
    }

    const trimmedQuery = searchQuery.trim();

    if (trimmedQuery.length >= 2) {
      // Live TMDB Search with 350ms debounce
      searchTimer.current = window.setTimeout(() => {
        setIsLoading(true);
        fetch(`${SERVER_URL}/api/tmdb/search?q=${encodeURIComponent(trimmedQuery)}`)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then((data) => {
            if (data.results && data.results.length > 0) {
              setMovies(data.results);
              setFeaturedMovie(data.results[0]);
              setApiNotice(null);
            } else {
              setMovies([]);
              setApiNotice(`No results found on TMDB for "${trimmedQuery}".`);
            }
            setIsLoading(false);
          })
          .catch(() => {
            setApiNotice('Search unavailable. Filtering current catalog.');
            setIsLoading(false);
          });
      }, 350);
      return;
    }

    // Discover movies when not searching
    setIsLoading(true);
    const params = new URLSearchParams();
    if (selectedGenre) params.set('genre', String(selectedGenre));
    if (year) params.set('year', year);
    if (minRating > 0) params.set('minRating', String(minRating));

    fetch(`${SERVER_URL}/api/tmdb/discover?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data.results && data.results.length > 0) {
          setMovies(data.results);
          setFeaturedMovie(data.results[0]);
          setApiNotice(null);
        } else {
          setMovies(CURATED_CINEMA);
        }
        setIsLoading(false);
      })
      .catch(() => {
        setApiNotice('TMDB proxy unavailable. Presenting curated cinema archive.');
        setMovies(CURATED_CINEMA);
        setFeaturedMovie(CURATED_CINEMA[0]);
        setIsLoading(false);
      });
  }, [selectedGenre, year, minRating, searchQuery, SERVER_URL]);

  // Fuse.js client-side fuzzy search fallback
  const fuse = useMemo(() => {
    return new Fuse(movies, {
      keys: ['title', 'overview'],
      threshold: 0.35,
    });
  }, [movies]);

  const displayedMovies = useMemo(() => {
    // If TMDB search was used, movies is already the search result
    if (searchQuery.trim().length >= 2) return movies;
    if (!searchQuery.trim()) return movies;
    return fuse.search(searchQuery.trim()).map((result) => result.item);
  }, [searchQuery, movies, fuse]);

  const handleScreenNow = async (movie: MovieItem) => {
    let trailerKey = movie.trailerKey;
    if (!trailerKey) {
      try {
        const res = await fetch(`${SERVER_URL}/api/tmdb/movie/${movie.id}`);
        if (res.ok) {
          const data = await res.json();
          trailerKey = data.trailerKey;
        }
      } catch {
        // fallback
      }
    }

    const source: Source = {
      kind: 'youtube',
      ref: trailerKey || 'on24qgkL3Qw',
      title: movie.title,
      tmdbId: movie.id,
    };
    onSelectMovie(source);
    onClose();
  };

  const handleQueueMovie = async (movie: MovieItem) => {
    let trailerKey = movie.trailerKey;
    if (!trailerKey) {
      try {
        const res = await fetch(`${SERVER_URL}/api/tmdb/movie/${movie.id}`);
        if (res.ok) {
          const data = await res.json();
          trailerKey = data.trailerKey;
        }
      } catch {
        // fallback
      }
    }

    const source: Source = {
      kind: 'youtube',
      ref: trailerKey || 'on24qgkL3Qw',
      title: movie.title,
      tmdbId: movie.id,
    };
    onAddToPlaylist(source);
  };

  // Direct custom link handlers
  const handleDirectScreen = () => {
    setDirectError(null);
    const parsed = parseVideoSource(directUrl, directTitle);
    if (!parsed) {
      setDirectError('Please enter a valid YouTube URL (or ID) or .mp4 / .m3u8 link.');
      return;
    }
    onSelectMovie(parsed);
    onClose();
  };

  const handleDirectQueue = () => {
    setDirectError(null);
    const parsed = parseVideoSource(directUrl, directTitle);
    if (!parsed) {
      setDirectError('Please enter a valid YouTube URL (or ID) or .mp4 / .m3u8 link.');
      return;
    }
    onAddToPlaylist(parsed);
    setDirectUrl('');
    setDirectTitle('');
  };

  const posterBase = 'https://image.tmdb.org/t/p/w500';

  return (
    <div className="lobby-overlay">
      <div className="lobby-container">
        {/* Header Marquee */}
        <header className="lobby-header">
          <div className="lobby-title-wrap">
            <h2 className="lobby-title">Cinema Lobby</h2>
            <p className="lobby-subtitle">TMDB movie discovery & custom video screening</p>
          </div>
          <button
            type="button"
            className="lobby-close-btn"
            onClick={onClose}
            aria-label="Close lobby"
          >
            ✕
          </button>
        </header>

        {apiNotice && <div className="lobby-notice">{apiNotice}</div>}

        {/* Direct Link Section: Screen or queue ANY YouTube or video link */}
        <section className="lobby-direct-box" aria-label="Screen custom video">
          <h3 className="lobby-section-title">📺 Screen Any Video or YouTube Link</h3>
          <p className="lobby-section-desc">
            Paste any YouTube URL, video ID, or direct stream link (.mp4 / .m3u8) to watch together:
          </p>
          <div className="lobby-direct-form">
            <input
              type="text"
              placeholder="e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ or video ID"
              value={directUrl}
              onChange={(e) => {
                setDirectUrl(e.target.value);
                setDirectError(null);
              }}
              className="lobby-direct-input"
            />
            <input
              type="text"
              placeholder="Title (optional)"
              value={directTitle}
              onChange={(e) => setDirectTitle(e.target.value)}
              className="lobby-direct-title"
            />
            <div className="lobby-direct-actions">
              {isHost && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleDirectScreen}
                  disabled={!directUrl.trim()}
                >
                  Screen now
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleDirectQueue}
                disabled={!directUrl.trim()}
              >
                Add to queue
              </button>
            </div>
          </div>
          {directError && <p className="lobby-direct-error">{directError}</p>}
        </section>

        {/* Filter Bar: TMDB Live Search & Genres */}
        <section className="lobby-filters">
          <h3 className="lobby-section-title">🎬 TMDB Movie Catalog</h3>
          <div className="lobby-search-bar">
            <input
              type="text"
              placeholder="Search any movie in the world (e.g. Inception, Dune, Interstellar)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="lobby-search-input"
            />
            {isLoading && <span className="lobby-loading-tag">Searching TMDB...</span>}
          </div>

          <div className="lobby-genres-typographic">
            <button
              type="button"
              className={`genre-line-btn ${selectedGenre === null ? 'genre-line-btn--active' : ''}`}
              onClick={() => {
                setSelectedGenre(null);
                setSearchQuery('');
              }}
            >
              All films
            </button>
            {genres.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`genre-line-btn ${selectedGenre === g.id ? 'genre-line-btn--active' : ''}`}
                onClick={() => {
                  setSelectedGenre(selectedGenre === g.id ? null : g.id);
                  setSearchQuery('');
                }}
              >
                {g.name}
              </button>
            ))}
          </div>

          <div className="lobby-controls-row">
            <label className="lobby-filter-label">
              Year:
              <input
                type="number"
                placeholder="Any"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="lobby-mini-input"
                min="1900"
                max="2030"
              />
            </label>

            <label className="lobby-filter-label">
              Min rating:
              <select
                value={minRating}
                onChange={(e) => setMinRating(Number(e.target.value))}
                className="lobby-select"
              >
                <option value={0}>Any</option>
                <option value={6}>6.0+</option>
                <option value={7}>7.0+</option>
                <option value={8}>8.0+</option>
              </select>
            </label>
          </div>
        </section>

        {/* Featured "Now Showing" Spotlight */}
        {featuredMovie && (
          <section className="lobby-featured-section">
            <div className="featured-card">
              <div className="featured-poster-wrap">
                {featuredMovie.poster_path ? (
                  <img
                    src={`${posterBase}${featuredMovie.poster_path}`}
                    alt={featuredMovie.title}
                    className="featured-poster-img"
                  />
                ) : (
                  <div className="poster-placeholder">
                    <span>{featuredMovie.title}</span>
                  </div>
                )}
              </div>
              <div className="featured-info">
                <span className="featured-tag">Spotlight</span>
                <h3 className="featured-title">{featuredMovie.title}</h3>
                <p className="featured-overview">{featuredMovie.overview}</p>
                <div className="featured-meta">
                  <span className="featured-rating">
                    ★ {featuredMovie.vote_average ? featuredMovie.vote_average.toFixed(1) : 'NR'}
                  </span>
                  {featuredMovie.release_date && (
                    <span className="featured-year">
                      {featuredMovie.release_date.slice(0, 4)}
                    </span>
                  )}
                </div>
                <div className="featured-actions">
                  {isHost && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleScreenNow(featuredMovie)}
                    >
                      Screen now
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleQueueMovie(featuredMovie)}
                  >
                    Add to queue
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Horizontal Reel at true 2:3 poster ratio */}
        <section className="lobby-reel-section">
          <h4 className="reel-title">
            {searchQuery ? `Search Results (${displayedMovies.length})` : 'Popular Films'}
          </h4>
          {displayedMovies.length === 0 ? (
            <p className="reel-empty">No titles match this filter. Try a different search.</p>
          ) : (
            <div className="lobby-reel">
              {displayedMovies.map((m) => (
                <div
                  key={m.id}
                  className="reel-item"
                  onClick={() => setFeaturedMovie(m)}
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setFeaturedMovie(m);
                  }}
                >
                  <div className="reel-poster-box">
                    {m.poster_path ? (
                      <img
                        src={`${posterBase}${m.poster_path}`}
                        alt={m.title}
                        className="reel-poster-img"
                        loading="lazy"
                      />
                    ) : (
                      <div className="reel-poster-fallback">
                        <span className="fallback-title">{m.title}</span>
                      </div>
                    )}
                  </div>
                  <div className="reel-item-info">
                    <span className="reel-item-title">{m.title}</span>
                    <span className="reel-item-rating">
                      ★ {m.vote_average ? m.vote_average.toFixed(1) : 'NR'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Legal Credit Line */}
        <footer className="lobby-credit-footer">
          <p className="credit-text">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </footer>
      </div>
    </div>
  );
}
