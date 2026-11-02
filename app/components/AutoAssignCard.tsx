'use client';
/**
 * Agents page (admin): turn auto-assign on for this project, set the per-agent
 * chat limit, and see who is Active / on Break / Offline right now.
 */
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Shuffle } from 'lucide-react';
import { apiFetch } from '@/hooks/useApi';

interface Member { id: number; name: string; role: string; status: string; open_chats: number; }

const DOT: Record<string, string> = {
  active: 'bg-green-500', break: 'bg-yellow-400', offline: 'bg-gray-300',
};

export default function AutoAssignCard() {
  const [enabled, setEnabled]   = useState(false);
  const [maxChats, setMaxChats] = useState(0);
  const [members, setMembers]   = useState<Member[]>([]);
  const [loaded, setLoaded]     = useState(false);
  const [saving, setSaving]     = useState(false);

  const load = useCallback(() => {
    apiFetch('/api/auto-assign')
      .then((r) => {
        setEnabled(!!r.data?.enabled);
        setMaxChats(Number(r.data?.maxChats) || 0);
        setMembers(r.data?.members || []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);   // live-ish statuses
    return () => clearInterval(t);
  }, [load]);

  async function save(nextEnabled: boolean, nextMax: number) {
    setSaving(true);
    try {
      await apiFetch('/api/auto-assign', {
        method: 'PUT', body: JSON.stringify({ enabled: nextEnabled, max_chats: nextMax }),
      });
      setEnabled(nextEnabled);
      setMaxChats(nextMax);
      toast.success(nextEnabled ? 'Auto-assign is on' : 'Auto-assign is off');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-green-50 text-whatsapp-green flex items-center justify-center flex-shrink-0">
          <Shuffle size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900">Auto-assign chats</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Each new chat goes to the Active agent or manager with the fewest open chats.
            They see only their own chats; admins see all. Chats waiting for a reply move
            to others when someone goes on Break.
          </p>
        </div>
        <button onClick={() => save(!enabled, maxChats)} disabled={saving}
          className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-60
            ${enabled ? 'bg-whatsapp-green' : 'bg-gray-300'}`}
          aria-label="Toggle auto-assign">
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      {enabled && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">Max open chats per person</span>
            <input type="number" min={0} max={1000} value={maxChats}
              onChange={(e) => setMaxChats(Math.max(0, Number(e.target.value) || 0))}
              onBlur={() => save(true, maxChats)}
              className="input w-20 py-1 text-sm" />
            <span className="text-xs text-gray-400">0 = no limit</span>
          </div>

          {members.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <span key={m.id} title={`${m.role} · ${m.status}`}
                  className="flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-700">
                  <span className={`w-2 h-2 rounded-full ${DOT[m.status] || DOT.offline}`} />
                  {m.name}
                  <span className="text-gray-400">{m.open_chats}</span>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
