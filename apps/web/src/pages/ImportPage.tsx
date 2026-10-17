import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/auth-store';
import './ImportPage.css';

interface Props {
  onBack: () => void;
}

interface ParsedRow {
  id: string;
  type: 'watched' | 'ratings' | 'reviews' | 'watchlist';
  title: string;
  year?: string;
  rating?: number;
  review?: string;
  date?: string;
  tmdbId?: number;
  tmdbTitle?: string;
  status: 'pending' | 'matched' | 'unmatched';
}

const API_BASE = (import.meta.env.VITE_SERVER_URL as string | undefined) || window.location.origin;

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

export function ImportPage({ onBack }: Props) {
  const { user } = useAuthStore();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [matching, setMatching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [importDone, setImportDone] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    let detectedType: 'watched' | 'ratings' | 'reviews' | 'watchlist' = 'watched';
    if (fileName.includes('rating')) detectedType = 'ratings';
    else if (fileName.includes('review')) detectedType = 'reviews';
    else if (fileName.includes('watchlist')) detectedType = 'watchlist';

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target?.result as string;
      if (!text) return;
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) return;

      const header = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
      const nameIdx = header.findIndex((h) => h === 'name' || h === 'title');
      const yearIdx = header.findIndex((h) => h === 'year');
      const ratingIdx = header.findIndex((h) => h.includes('rating'));
      const reviewIdx = header.findIndex((h) => h.includes('review'));
      const dateIdx = header.findIndex((h) => h.includes('date'));

      const parsed: ParsedRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (!cols[nameIdx]) continue;
        const rawRating = ratingIdx >= 0 ? parseFloat(cols[ratingIdx]) : undefined;
        parsed.push({
          id: `row-${i}-${Date.now()}`,
          type: detectedType,
          title: cols[nameIdx],
          year: yearIdx >= 0 ? cols[yearIdx] : undefined,
          rating: !isNaN(rawRating as number) ? rawRating : undefined,
          review: reviewIdx >= 0 ? cols[reviewIdx] : undefined,
          date: dateIdx >= 0 ? cols[dateIdx] : undefined,
          status: 'pending',
        });
      }

      setRows(parsed);
      setImportDone(false);
      await matchRowsWithTMDB(parsed);
    };
    reader.readAsText(file);
  };

  const matchRowsWithTMDB = async (list: ParsedRow[]) => {
    setMatching(true);
    const updated = [...list];
    for (let i = 0; i < updated.length; i++) {
      const r = updated[i];
      try {
        const query = encodeURIComponent(r.title);
        const res = await fetch(`${API_BASE}/api/tmdb/search?q=${query}`);
        if (!res.ok) {
          r.status = 'unmatched';
          continue;
        }
        const data = await res.json();
        const results: any[] = data.results || [];
        if (results.length === 0) {
          r.status = 'unmatched';
        } else {
          // match year if available
          let best = results[0];
          if (r.year) {
            const matchYear = results.find((m) => m.release_date && m.release_date.startsWith(r.year!));
            if (matchYear) best = matchYear;
          }
          r.tmdbId = best.id;
          r.tmdbTitle = best.title;
          r.status = 'matched';
        }
      } catch (err) {
        r.status = 'unmatched';
      }
      setRows([...updated]);
    }
    setMatching(false);
  };

  const executeBatchImport = async () => {
    if (!user) return;
    setImporting(true);
    const matched = rows.filter((r) => r.status === 'matched' && r.tmdbId);
    setProgress({ current: 0, total: matched.length });

    const BATCH_SIZE = 15;
    for (let i = 0; i < matched.length; i += BATCH_SIZE) {
      const batch = matched.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (item) => {
          if (!item.tmdbId) return;

          if (item.type === 'watchlist') {
            await supabase.from('watchlist').upsert({
              user_id: user.id,
              tmdb_id: item.tmdbId,
              added_at: item.date ? new Date(item.date).toISOString() : new Date().toISOString(),
            });
          } else if (item.type === 'ratings' || item.type === 'watched') {
            await supabase.from('diary').upsert({
              user_id: user.id,
              tmdb_id: item.tmdbId,
              watched_on: item.date || new Date().toISOString().split('T')[0],
              rating: item.rating ? Math.min(5, Math.max(0.5, Math.round(item.rating * 2) / 2)) : null,
            });
          } else if (item.type === 'reviews') {
            await supabase.from('reviews').insert({
              user_id: user.id,
              tmdb_id: item.tmdbId,
              body: item.review || 'Imported review from Letterboxd',
              rating: item.rating ? Math.min(5, Math.max(0.5, Math.round(item.rating * 2) / 2)) : null,
            });
          }
        })
      );
      setProgress({ current: Math.min(i + BATCH_SIZE, matched.length), total: matched.length });
    }

    setImporting(false);
    setImportDone(true);
  };

  return (
    <div className="import-root">
      <button className="import-back" onClick={onBack}>← Back</button>
      <h1 className="import-title">Import Letterboxd Data</h1>
      <p className="import-sub">
        Upload your Letterboxd export CSV files (<code>watched.csv</code>, <code>ratings.csv</code>, <code>reviews.csv</code>, or <code>watchlist.csv</code>).
        Films are matched against TMDB client-side and imported into your profile.
      </p>

      {!user ? (
        <div className="import-warning">Please sign in to import your data.</div>
      ) : (
        <div className="import-upload-zone">
          <label className="import-file-label">
            Choose CSV file
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              disabled={matching || importing}
              className="import-file-input"
            />
          </label>
        </div>
      )}

      {matching && (
        <div className="import-matching-banner">
          Matching films with TMDB database… please wait.
        </div>
      )}

      {rows.length > 0 && (
        <div className="import-preview-section">
          <div className="import-preview-header">
            <h2>Preview ({rows.length} rows)</h2>
            <div className="import-counts">
              <span className="count-matched">✓ {rows.filter((r) => r.status === 'matched').length} matched</span>
              <span className="count-unmatched">✕ {rows.filter((r) => r.status === 'unmatched').length} unmatched</span>
            </div>
            {!importDone && (
              <button
                className="import-btn-start"
                onClick={executeBatchImport}
                disabled={matching || importing || rows.filter((r) => r.status === 'matched').length === 0}
              >
                {importing
                  ? `Importing (${progress?.current}/${progress?.total})…`
                  : `Import ${rows.filter((r) => r.status === 'matched').length} items`}
              </button>
            )}
          </div>

          {importDone && (
            <div className="import-success-box">
              ✓ Import complete! All matched items have been saved to your account.
            </div>
          )}

          <div className="import-table-wrapper">
            <table className="import-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Title</th>
                  <th>Year</th>
                  <th>Type</th>
                  <th>TMDB Match</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((r) => (
                  <tr key={r.id} className={`row-${r.status}`}>
                    <td>{r.status === 'matched' ? '✓' : r.status === 'unmatched' ? '✕' : '…'}</td>
                    <td>{r.title}</td>
                    <td>{r.year || '—'}</td>
                    <td>{r.type}</td>
                    <td>{r.tmdbTitle ? `${r.tmdbTitle} (#${r.tmdbId})` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 100 && (
              <p className="import-more-rows">Showing first 100 rows…</p>
            )}
          </div>
        </div>
      )}

      <footer className="import-tmdb-footer">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </footer>
    </div>
  );
}
