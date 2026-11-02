'use client';
/**
 * Header switch: Active / Break. Sends a heartbeat every minute while the panel
 * is open — no heartbeat for 5 minutes counts as Offline, so a closed laptop
 * stops getting chats. Only managers and agents get chats automatically.
 */
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { apiFetch } from '@/hooks/useApi';

type Status = 'active' | 'break' | 'offline';

const LOOK: Record<Status, { label: string; dot: string }> = {
  active:  { label: 'Active',  dot: 'bg-green-500' },
  break:   { label: 'Break',   dot: 'bg-yellow-400' },
  offline: { label: 'Offline', dot: 'bg-gray-400' },
};

export async function goOffline() {
  try {
    await apiFetch('/api/availability', { method: 'POST', body: JSON.stringify({ status: 'offline' }) });
  } catch { /* logging out anyway */ }
}

export default function AvailabilityToggle() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const beat = () => apiFetch('/api/availability', { method: 'POST', body: JSON.stringify({ heartbeat: true }) })
      .then((r) => setStatus(r.data?.status || null))
      .catch(() => {});
    beat();
    const t = setInterval(beat, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function change(next: Status) {
    setOpen(false);
    if (next === status) return;
    setSaving(true);
    try {
      const r = await apiFetch('/api/availability', { method: 'POST', body: JSON.stringify({ status: next }) });
      setStatus(r.data?.status || next);
      toast.success(next === 'active' ? 'You are Active — new chats will come to you' : 'On Break — new chats go to others');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change status');
    } finally {
      setSaving(false);
    }
  }

  if (!status) return null;
  const look = LOOK[status];

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} disabled={saving}
        title="Your status for new chats"
        className="flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">
        <span className={`w-2 h-2 rounded-full ${look.dot}`} />
        {look.label}
      </button>
      {open && (
        <div className="absolute right-0 top-9 w-48 bg-white border border-gray-200 rounded-xl shadow-lg z-40 overflow-hidden">
          {(['active', 'break'] as Status[]).map((s) => (
            <button key={s} onClick={() => change(s)}
              className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 hover:bg-gray-50
                ${status === s ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
              <span className={`w-2 h-2 rounded-full ${LOOK[s].dot}`} />
              <span className="flex-1">{LOOK[s].label}</span>
              <span className="text-[10px] text-gray-400">{s === 'active' ? 'gets chats' : 'no new chats'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
