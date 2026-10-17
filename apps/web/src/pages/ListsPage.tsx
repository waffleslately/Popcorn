import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/auth-store';
import './ListsPage.css';

interface Props {
  onFilm: (tmdbId: number) => void;
}

interface CustomList {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  is_public: boolean;
  created_at: string;
  items_count?: number;
}

interface ListItem {
  list_id: string;
  tmdb_id: number;
  position: number;
}

export function ListsPage({ onFilm }: Props) {
  const { user } = useAuthStore();
  const [lists, setLists] = useState<CustomList[]>([]);
  const [selectedList, setSelectedList] = useState<CustomList | null>(null);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadLists();
  }, [user]);

  const loadLists = async () => {
    setLoading(true);
    let query = supabase.from('lists').select('id, user_id, title, description, is_public, created_at');
    if (!user) {
      query = query.eq('is_public', true);
    }
    const { data } = await query.order('created_at', { ascending: false });
    setLists((data ?? []) as CustomList[]);
    setLoading(false);
  };

  const openList = async (l: CustomList) => {
    setSelectedList(l);
    const { data } = await supabase
      .from('list_items')
      .select('list_id, tmdb_id, position')
      .eq('list_id', l.id)
      .order('position', { ascending: true });
    setListItems((data ?? []) as ListItem[]);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !title.trim()) return;
    setSaving(true);
    const { data, error } = await supabase
      .from('lists')
      .insert({
        user_id: user.id,
        title: title.trim(),
        description: description.trim() || null,
        is_public: isPublic,
      })
      .select()
      .single();

    setSaving(false);
    if (!error && data) {
      setTitle('');
      setDescription('');
      setShowCreate(false);
      loadLists();
    }
  };

  return (
    <div className="lists-root">
      <div className="lists-header-row">
        <h1 className="lists-title">Lists</h1>
        {user && !selectedList && (
          <button className="lists-btn-create" onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? 'Cancel' : '+ New list'}
          </button>
        )}
      </div>

      {showCreate && user && (
        <form onSubmit={handleCreate} className="lists-create-form">
          <input
            type="text"
            className="lists-input"
            placeholder="List Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <textarea
            className="lists-textarea"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
          <label className="lists-checkbox-label">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            Public list
          </label>
          <button type="submit" className="lists-btn-submit" disabled={saving || !title.trim()}>
            {saving ? 'Creating…' : 'Create List'}
          </button>
        </form>
      )}

      {selectedList ? (
        <div className="lists-detail">
          <button className="lists-back-btn" onClick={() => setSelectedList(null)}>
            ← Back to all lists
          </button>
          <h2 className="lists-detail-title">{selectedList.title}</h2>
          {selectedList.description && <p className="lists-detail-desc">{selectedList.description}</p>}
          <div className="lists-items-grid">
            {listItems.length === 0 && <p className="lists-empty">No films in this list yet.</p>}
            {listItems.map((item) => (
              <button
                key={`${item.list_id}-${item.tmdb_id}`}
                className="lists-film-card"
                onClick={() => onFilm(item.tmdb_id)}
              >
                <span className="lists-film-id">Film #{item.tmdb_id}</span>
                <span className="lists-film-pos">#{item.position + 1}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="lists-list">
          {loading && <p className="lists-empty">Loading lists…</p>}
          {!loading && lists.length === 0 && (
            <p className="lists-empty">No lists found. Be the first to create one!</p>
          )}
          {lists.map((l) => (
            <button key={l.id} className="lists-row" onClick={() => openList(l)}>
              <div className="lists-row-info">
                <span className="lists-row-title">{l.title}</span>
                {l.description && <span className="lists-row-desc">{l.description}</span>}
              </div>
              <span className="lists-row-tag">{l.is_public ? 'Public' : 'Private'}</span>
            </button>
          ))}
        </div>
      )}

      <footer className="lists-tmdb-footer">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </footer>
    </div>
  );
}
