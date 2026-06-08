'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { X, Upload, Trash2, Search, Music, FileText, Video, Image as ImageIcon, Check } from 'lucide-react';
import { apiFetch } from '@/hooks/useApi';
import toast from 'react-hot-toast';

export interface MediaItem {
  id: number;
  media_id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  created_at: string;
}

interface Counts { images: number; audio: number; video: number; files: number; total_size: number }

const TABS = [
  { key: 'image', label: 'Image',  countKey: 'images' },
  { key: 'audio', label: 'Audio',  countKey: 'audio'  },
  { key: 'video', label: 'Video',  countKey: 'video'  },
  { key: 'file',  label: 'File',   countKey: 'files'  },
] as const;
type TabKey = typeof TABS[number]['key'];

function fmtSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(2) + ' GB';
  if (bytes >= 1_048_576)     return (bytes / 1_048_576).toFixed(2) + ' MB';
  if (bytes >= 1024)          return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

export function getWorkspaceId(): number {
  try {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) return 0;
    return JSON.parse(atob(token.split('.')[1])).workspaceId ?? 0;
  } catch { return 0; }
}

interface Props {
  onSelect: (item: MediaItem) => void;
  onClose:  () => void;
}

export default function MediaLibrary({ onSelect, onClose }: Props) {
  const [tab, setTab]               = useState<TabKey>('image');
  const [search, setSearch]         = useState('');
  const [items, setItems]           = useState<MediaItem[]>([]);
  const [counts, setCounts]         = useState<Counts>({ images: 0, audio: 0, video: 0, files: 0, total_size: 0 });
  const [loading, setLoading]       = useState(true);
  const [uploading, setUploading]   = useState(false);
  const [selectedId, setSelectedId]   = useState<number | null>(null);
  const [customName, setCustomName]   = useState('');
  const [deleteMode, setDeleteMode]   = useState(false);
  const [toDelete, setToDelete]       = useState<Set<number>>(new Set());
  const fileRef                     = useRef<HTMLInputElement>(null);
  const wsId                        = getWorkspaceId();

  const load = useCallback(async (q = search, t = tab) => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/media?tab=${t}&search=${encodeURIComponent(q)}`);
      if (r.data) {
        setItems(r.data.items || []);
        setCounts(r.data.counts  || { images: 0, audio: 0, video: 0, files: 0, total_size: 0 });
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [search, tab]);

  useEffect(() => { load(); }, [load]);

  function switchTab(t: TabKey) { setTab(t); setSelectedId(null); setToDelete(new Set()); load(search, t); }

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const tid = toast.loading(`Uploading ${file.name}…`);
      try {
        const fd  = new FormData();
        fd.append('file', file);
        const token = localStorage.getItem('token');
        const res   = await fetch('/api/media', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
        const data  = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        toast.success(`${file.name} uploaded!`, { id: tid });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Upload failed', { id: tid });
      }
    }
    setUploading(false);
    load();
  }

  async function handleDelete() {
    if (!toDelete.size) return;
    try {
      await apiFetch('/api/media', { method: 'DELETE', body: JSON.stringify({ ids: Array.from(toDelete) }) });
      toast.success(`${toDelete.size} item(s) deleted`);
      setToDelete(new Set());
      setDeleteMode(false);
      if (selectedId && toDelete.has(selectedId)) setSelectedId(null);
      load();
    } catch { toast.error('Delete failed'); }
  }

  function handleDone() {
    const item = items.find(i => i.id === selectedId);
    if (item) {
      onSelect({ ...item, filename: customName.trim() || item.filename });
      onClose();
    }
  }

  function toggleDelete(id: number) {
    setToDelete(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // Thumbnail tile
  function Tile({ item }: { item: MediaItem }) {
    const isImg  = item.mime_type.startsWith('image/');
    const isAud  = item.mime_type.startsWith('audio/');
    const isVid  = item.mime_type.startsWith('video/');
    const isSel  = selectedId === item.id;
    const isDel  = toDelete.has(item.id);

    return (
      <button
        onClick={() => {
          if (deleteMode) { toggleDelete(item.id); return; }
          if (selectedId === item.id) { setSelectedId(null); setCustomName(''); }
          else { setSelectedId(item.id); setCustomName(item.filename); }
        }}
        className={`relative rounded-xl overflow-hidden border-2 transition-all aspect-square group
          ${isSel && !deleteMode ? 'border-blue-500 ring-2 ring-blue-200' : isDel ? 'border-red-400' : 'border-gray-100 hover:border-gray-300'}`}
      >
        {isImg ? (
          <img src={`/api/media/${item.media_id}?workspaceId=${wsId}`} alt={item.filename}
            className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className={`w-full h-full flex flex-col items-center justify-center gap-1
            ${isAud ? 'bg-purple-100 text-purple-500' : isVid ? 'bg-blue-100 text-blue-500' : 'bg-gray-100 text-gray-500'}`}>
            {isAud ? <Music size={26} /> : isVid ? <Video size={26} /> : <FileText size={26} />}
            <span className="text-[9px] text-center px-1 leading-tight line-clamp-2 font-medium">
              {item.filename}
            </span>
          </div>
        )}

        {/* Overlay: selection tick or delete checkbox */}
        {(isSel || deleteMode) && (
          <div className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center border-2
            ${isSel && !deleteMode ? 'bg-blue-500 border-blue-500' : isDel ? 'bg-red-500 border-red-500' : 'bg-white border-gray-400'}`}>
            {(isSel || isDel) && <Check size={12} className="text-white" strokeWidth={3} />}
          </div>
        )}

        {/* Filename tooltip on hover */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent
          px-1.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <p className="text-white text-[9px] truncate leading-tight">{item.filename}</p>
          <p className="text-white/60 text-[9px]">{fmtSize(item.file_size)}</p>
        </div>
      </button>
    );
  }

  const usedSize  = Number(counts.total_size) || 0;
  const limitSize = 10 * 1024 * 1024 * 1024;
  const usedPct   = Math.min(100, (usedSize / limitSize) * 100);
  const recentItems = items.slice(0, 10);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col" style={{ maxHeight: '88vh' }}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h2 className="font-bold text-lg text-gray-900">Media Library</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="w-28 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-whatsapp-green rounded-full transition-all" style={{ width: `${usedPct}%` }} />
              </div>
              <p className="text-xs text-gray-400">{fmtSize(usedSize)} used of 10 GB</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {deleteMode ? (
              <>
                <button onClick={() => { setDeleteMode(false); setToDelete(new Set()); }}
                  className="btn-secondary text-sm px-3 py-1.5">Cancel</button>
                <button onClick={handleDelete} disabled={!toDelete.size}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg disabled:opacity-40 transition-colors">
                  <Trash2 size={14} /> Delete ({toDelete.size})
                </button>
              </>
            ) : (
              <>
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-50">
                  <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload'}
                </button>
                <input ref={fileRef} type="file" multiple className="hidden"
                  accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.zip"
                  onChange={(e) => { handleUpload(e.target.files); e.target.value = ''; }} />
                <button onClick={() => { setDeleteMode(true); setSelectedId(null); }}
                  className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
                  <Trash2 size={14} /> Delete
                </button>
              </>
            )}
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors ml-1">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ── Search ── */}
        <div className="px-6 py-3 border-b shrink-0">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search media…" className="input pl-9 text-sm py-2 w-full" />
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex border-b px-6 shrink-0">
          {TABS.map(t => (
            <button key={t.key} onClick={() => switchTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
                ${tab === t.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t.label} ({Number((counts as unknown as Record<string, number>)[t.countKey]) || 0})
            </button>
          ))}
        </div>

        {/* ── Grid ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="grid grid-cols-5 gap-3 animate-pulse">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-xl bg-gray-200" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <ImageIcon size={40} className="mb-3 opacity-30" />
              <p className="text-sm font-medium">No {tab} files yet</p>
              <button onClick={() => fileRef.current?.click()}
                className="mt-4 btn-primary text-sm px-4 py-2 flex items-center gap-2">
                <Upload size={14} /> Upload {tab}
              </button>
            </div>
          ) : (
            <>
              {/* Recently used */}
              {!search && (
                <div className="mb-6">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    Recently used ({recentItems.length})
                  </p>
                  <div className="grid grid-cols-5 gap-3">
                    {recentItems.map(item => <Tile key={item.id} item={item} />)}
                  </div>
                </div>
              )}

              {/* All items */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  {search ? `Results (${items.length})` : `All ${tab}s (${items.length})`}
                </p>
                <div className="grid grid-cols-5 gap-3">
                  {items.map(item => <Tile key={item.id} item={item} />)}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="border-t shrink-0">
          {/* Filename editor — visible only when a file is selected */}
          {selectedId !== null && !deleteMode && (
            <div className="flex items-center gap-3 px-6 py-3 border-b bg-gray-50">
              <span className="text-xs text-gray-400 shrink-0">File name:</span>
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="input text-sm py-1.5 flex-1 font-mono"
                placeholder="Enter file name…"
              />
            </div>
          )}
          <div className="flex items-center justify-end gap-3 px-6 py-4">
            <button onClick={onClose} className="btn-secondary text-sm px-4 py-2">Cancel</button>
            <button onClick={handleDone} disabled={selectedId === null || deleteMode}
              className="btn-primary text-sm px-6 py-2 disabled:opacity-40">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
