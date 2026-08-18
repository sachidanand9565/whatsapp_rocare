'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/hooks/useApi';
import {
  PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed, Clock, Search,
  RefreshCw, Loader2, Settings, ChevronLeft, ChevronRight, XCircle,
} from 'lucide-react';

interface CallRow {
  id: number; call_id: string;
  direction: 'inbound' | 'outbound';
  status: 'ringing' | 'completed' | 'missed' | 'rejected' | 'failed';
  duration_sec: number;
  started_at: string | null; answered_at: string | null; ended_at: string | null; created_at: string;
  contact_id: number | null; contact_name: string | null; contact_phone: string | null;
  agent_id: number | null; agent_name: string | null;
}
interface Stats { incoming: number; outgoing: number; completed: number; missed: number; talk_seconds: number }

function toLocalDate(ts: string): Date {
  if (ts.includes('Z') || ts.includes('+')) return new Date(ts);
  return new Date(ts.replace(' ', 'T') + 'Z');
}
function fmtWhen(ts: string | null): string {
  if (!ts) return '—';
  const d = toLocalDate(ts);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}
function fmtDur(sec: number): string {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

const STATUS_UI: Record<CallRow['status'], { label: string; cls: string; icon: React.ReactNode }> = {
  completed: { label: 'Completed', cls: 'bg-gray-100 text-gray-700 border-gray-200',   icon: <PhoneCall size={11} /> },
  missed:    { label: 'Missed',    cls: 'bg-red-50 text-red-600 border-red-200',       icon: <PhoneMissed size={11} /> },
  rejected:  { label: 'Declined',  cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: <XCircle size={11} /> },
  ringing:   { label: 'Ringing',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <Loader2 size={11} className="animate-spin" /> },
  failed:    { label: 'Failed',    cls: 'bg-red-50 text-red-600 border-red-200',       icon: <XCircle size={11} /> },
};

export default function CallsPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats>({ incoming: 0, outgoing: 0, completed: 0, missed: 0, talk_seconds: 0 });
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [callingEnabled, setCallingEnabled] = useState<boolean | null>(null);
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    const sp = new URLSearchParams({ page: String(page), limit: '50' });
    if (q) sp.set('q', q);
    if (direction) sp.set('direction', direction);
    if (status) sp.set('status', status);
    apiFetch(`/api/calling/logs?${sp}`)
      .then((r) => {
        setStats(r.data?.stats || stats);
        setCalls(r.data?.calls || []);
        setPages(r.data?.pagination?.pages || 1);
        setTotal(r.data?.pagination?.total || 0);
        setMigrationNeeded(!!r.data?.migration_needed);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, direction, status, page]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { setPage(1); }, [q, direction, status]);
  useEffect(() => {
    apiFetch('/api/calling/settings')
      .then((r) => setCallingEnabled(r.data?.calling?.status === 'ENABLED'))
      .catch(() => setCallingEnabled(null));
  }, []);

  const tiles = [
    { label: 'Incoming',  value: String(stats.incoming),  icon: <PhoneIncoming size={16} className="text-emerald-600" />, ring: 'bg-emerald-50' },
    { label: 'Outgoing',  value: String(stats.outgoing),  icon: <PhoneOutgoing size={16} className="text-blue-600" />,   ring: 'bg-blue-50' },
    { label: 'Completed', value: String(stats.completed), icon: <PhoneCall size={16} className="text-gray-700" />,       ring: 'bg-gray-100' },
    { label: 'Missed',    value: String(stats.missed),    icon: <PhoneMissed size={16} className="text-red-500" />,      ring: 'bg-red-50' },
    { label: 'Talk time', value: fmtDur(stats.talk_seconds), icon: <Clock size={16} className="text-purple-600" />,     ring: 'bg-purple-50' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <PhoneCall size={22} className="text-whatsapp-teal" /> Calls
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">WhatsApp voice calls on your business number — incoming, outgoing, missed</p>
        </div>
        <div className="flex items-center gap-2">
          {callingEnabled === false && (
            <button onClick={() => router.push('/settings')}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100">
              <Settings size={13} /> Calling is off — enable in Settings
            </button>
          )}
          <button onClick={load} title="Refresh"
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {migrationNeeded && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3">
          Call history table isn&apos;t set up yet — run <code className="bg-amber-100 px-1 rounded">migration-calling.sql</code> once, then calls will be recorded here.
        </div>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="card flex items-center gap-3 py-4">
            <div className={`w-10 h-10 rounded-full ${t.ring} flex items-center justify-center flex-shrink-0`}>{t.icon}</div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t.label}</p>
              <p className="text-xl font-bold text-gray-900 leading-tight">{t.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card flex items-center gap-2 flex-wrap py-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or number…"
            className="input pl-9" />
        </div>
        <select value={direction} onChange={(e) => setDirection(e.target.value)} className="input w-40">
          <option value="">All directions</option>
          <option value="inbound">Incoming</option>
          <option value="outbound">Outgoing</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input w-40">
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="missed">Missed</option>
          <option value="rejected">Declined</option>
        </select>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                <th className="text-left font-semibold px-4 py-3">Contact</th>
                <th className="text-left font-semibold px-4 py-3">Direction</th>
                <th className="text-left font-semibold px-4 py-3">Status</th>
                <th className="text-left font-semibold px-4 py-3">Agent</th>
                <th className="text-left font-semibold px-4 py-3">Duration</th>
                <th className="text-left font-semibold px-4 py-3">When</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading && calls.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400"><Loader2 size={18} className="animate-spin inline" /></td></tr>
              )}
              {!loading && calls.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">
                  No calls yet. Once calling is enabled, every WhatsApp call on your number shows up here.
                </td></tr>
              )}
              {calls.map((c) => {
                const st = STATUS_UI[c.status] || STATUS_UI.failed;
                const inbound = c.direction === 'inbound';
                return (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-800">{c.contact_name || c.contact_phone || '—'}</p>
                      {c.contact_phone && <p className="text-xs text-blue-500">+{c.contact_phone}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-gray-700">
                        {inbound ? <PhoneIncoming size={14} className="text-emerald-600" /> : <PhoneOutgoing size={14} className="text-blue-600" />}
                        {inbound ? 'Incoming' : 'Outgoing'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${st.cls}`}>
                        {st.icon} {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{c.agent_name || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{c.status === 'completed' ? fmtDur(c.duration_sec) : '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{fmtWhen(c.started_at || c.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {c.contact_id && (
                        <button onClick={() => router.push(`/inbox?contact=${c.contact_id}`)}
                          className="text-xs font-semibold text-gray-600 hover:text-whatsapp-teal">Chat</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
            <span>{total} calls · page {page} of {pages}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                className="p-1.5 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"><ChevronLeft size={14} /></button>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}
                className="p-1.5 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
