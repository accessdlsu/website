"use client";

import { useEffect, useState } from 'react';
import { Plus, Rocket } from 'lucide-react';

type LinkItem = {
  id: number;
  slug: string;
  target_url: string;
  clicks: number;
  created_at: string;
  created_by?: string | null;
  expires_at?: string | null;
  archived?: number | null;
};

export default function LinkShortenerClient() {
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [url, setUrl] = useState('');
  const [alias, setAlias] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  async function fetchLinks() {
    try {
      const res = await fetch('/api/link-shortener');
      if (!res.ok) throw new Error('Failed to fetch links');
      const data = (await res.json()) as { links?: LinkItem[] };
      setLinks(data.links || []);
    } catch (err) {
      const e = err as Error | { message?: string } | undefined;
      setError(e?.message || 'Unknown error');
    }
  }

  useEffect(() => {
    void (async () => {
      await fetchLinks();
    })();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!url) return setError('Please enter a URL');
    setLoading(true);
    try {
      const res = await fetch('/api/link-shortener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_url: url, slug: alias || undefined, expires_at: expiresAt || null })
      });

      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body?.error || 'Failed to create link');

      setUrl('');
      setAlias('');
      setExpiresAt(null);
      fetchLinks();
    } catch (err) {
      const e = err as Error | { message?: string } | undefined;
      setError(e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex justify-center mt-8">
        <button
          onClick={() => setIsModalOpen(true)}
          className="resource-button px-4 py-2 text-white font-medium flex items-center gap-2"
        >
          <Plus className="w-4 h-4" aria-hidden />
          <span>New Short Link</span>
        </button>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-backdrop" onClick={() => setIsModalOpen(false)} aria-hidden />
          <div className="modal-panel glass-card-3d">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-zinc-950 dark:text-white">New Short Link</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-500 hover:text-zinc-950 dark:text-gray-400 dark:hover:text-white" aria-label="Close">×</button>
            </div>
            <form onSubmit={async (e) => { await handleCreate(e); setIsModalOpen(false); }} className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-gray-300 text-left">Destination URL</label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  type="url"
                  placeholder="https://example.com/very-long-url"
                  className="input-3d w-full placeholder:text-zinc-400 dark:placeholder:text-gray-400"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-gray-300 text-left">Short Link</label>
                <input
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  type="text"
                  placeholder="my-link"
                  className="input-3d w-full placeholder:text-zinc-400 dark:placeholder:text-gray-400"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-gray-300 text-left">Expires at (optional)</label>
                <input
                  value={expiresAt ?? ''}
                  onChange={(e) => setExpiresAt(e.target.value || null)}
                  type="datetime-local"
                  className="input-3d w-full placeholder:text-zinc-400 dark:placeholder:text-gray-400"
                />
              </div>
              <div className="modal-actions justify-end">
                {error && <p className="text-red-400 text-sm mr-4">{error}</p>}
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-3 py-1.5 text-sm text-zinc-700 dark:text-gray-300 bg-transparent rounded-md hover:bg-zinc-950/5 dark:hover:bg-white/5">Cancel</button>
                <button disabled={loading} className="resource-button px-4 py-2 text-white font-medium flex items-center gap-2 text-sm">
                  <Rocket className="w-4 h-4" aria-hidden />
                  {loading ? 'Confirming…' : 'Confirm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="course-card p-12 rounded-2xl mt-6">
        <div className="text-left space-y-6">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-950 dark:text-white mb-4">Create Short Link</h2>
          </div>

          </div>

        <div className="border-t border-zinc-200 dark:border-gray-600 pt-6">
          <h2 className="text-2xl font-semibold text-zinc-950 dark:text-white mb-4">Recent Links</h2>
          <div className="space-y-3">
            {links.length === 0 && <p className="text-zinc-600 dark:text-gray-400">No links yet.</p>}
            {links.map((l) => (
              <div key={l.id} className="course-card p-4 rounded-lg">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-zinc-950 dark:text-white font-medium">{typeof window !== 'undefined' ? `${window.location.host}/${l.slug}` : l.slug}</p>
                    <p className="text-zinc-600 dark:text-gray-400 text-sm">→ {l.target_url}</p>
                    {l.expires_at && <p className="text-xs text-amber-700 dark:text-yellow-300">Expires: {new Date(l.expires_at).toLocaleString()}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-zinc-600 dark:text-gray-400 text-sm">Clicks: {l.clicks}</p>
                    <button onClick={async () => {
                      if (!confirm('Delete this link?')) return;
                      await fetch('/api/link-shortener', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: l.id }) });
                      fetchLinks();
                    }} className="text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 text-sm">Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
