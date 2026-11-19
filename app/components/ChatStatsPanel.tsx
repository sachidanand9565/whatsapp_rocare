'use client';
/**
 * Dashboard (admin/manager): chat numbers across the projects you run —
 * totals, chats by hour/day, and tables per project and per person.
 * Data: GET /api/dashboard/chat-stats
 */
import { useCallback, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { MessagesSquare, RefreshCw, Loader2, ArrowDown, ArrowUp } from 'lucide-react';
import { apiFetch } from '@/hooks/useApi';

type Period = 'today' | 'yesterday' | '7d' | '30d';
interface Nums {
  chats: number; new_chats: number; replied: number; resolved: number; intervened_period: number;
  msgs_in: number; msgs_out: number; templates: number;
  open24: number; waiting: number; unassigned_waiting: number; intervened_now: number;
}
interface ProjectRow extends Nums { id: number; name: string }
interface AgentRow {
  id: number | null; name: string; role: string; status: string; projects: string[];
  open24: number; waiting: number; intervened_now: number; period_chats: number; period_resolved: number;
  assigned: number | null; intervened: number | null; resolved: number | null;
}
interface Stats {
  period: Period; byHour: boolean;
  allProjects: { id: number; name: string }[];
  totals: Nums; projects: ProjectRow[]; agents: AgentRow[];
  series: { label: string; chats: number }[];
  eventsAvailable: boolean; generatedAt: string;
}

const PERIODS: { key: Period; label: string; word: string }[] = [
  { key: 'today', label: 'Today', word: 'today' },
  { key: 'yesterday', label: 'Yesterday', word: 'yesterday' },
  { key: '7d', label: '7 days', word: 'in 7 days' },
  { key: '30d', label: '30 days', word: 'in 30 days' },
];
const STATUS: Record<string, { dot: string; label: string }> = {
  active: { dot: 'bg-green-500', label: 'Active' },
  break: { dot: 'bg-yellow-400', label: 'Break' },
  offline: { dot: 'bg-gray-300', label: 'Offline' },
};
const fmt = (v: number) => v.toLocaleString('en-IN');
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

function Tile({ label, value, sub, tone, hint }: { label: string; value: number; sub?: string; tone?: 'warn' | 'now'; hint: string }) {
  return (
    <div title={hint} className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5 min-w-0">
      <p className="text-[11px] text-gray-500 truncate flex items-center gap-1">
        {tone === 'now' && <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />}
        {label}
      </p>
      <p className={`text-xl font-bold leading-tight ${tone === 'warn' && value > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{fmt(value)}</p>
      {sub && <p className="text-[11px] text-gray-400 truncate">{sub}</p>}
    </div>
  );
}

/** Sortable table: columns are [key, header, hint]; first column is the name. */
function useSort<T>(rows: T[], initial: keyof T) {
  const [by, setBy] = useState<keyof T>(initial);
  const [asc, setAsc] = useState(false);
  const sorted = [...rows].sort((a, b) => {
    const x = a[by] as unknown, y = b[by] as unknown;
    const d = typeof x === 'number' || typeof y === 'number'
      ? (Number(x ?? -1) - Number(y ?? -1))
      : String(x ?? '').localeCompare(String(y ?? ''));
    return asc ? d : -d;
  });
  const head = (key: keyof T, label: string, hint?: string, left = false) => (
    <th key={String(key)} title={hint}
      onClick={() => { if (by === key) setAsc(!asc); else { setBy(key); setAsc(left); } }}
      className={`px-3 py-2 font-medium cursor-pointer select-none whitespace-nowrap hover:text-gray-800 ${left ? 'text-left' : 'text-right'}`}>
      <span className={`inline-flex items-center gap-0.5 ${left ? '' : 'justify-end'}`}>
        {label}
        {by === key && (asc ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </span>
    </th>
  );
  return { sorted, head };
}

function ProjectTable({ rows, word, onPick }: { rows: ProjectRow[]; word: string; onPick: (id: number) => void }) {
  const { sorted, head } = useSort(rows, 'chats');
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 text-xs text-gray-500">
        <tr>
          {head('name', 'Project', undefined, true)}
          {head('chats', 'Chats', `Contacts who messaged ${word}`)}
          {head('new_chats', 'New', `First message ever was ${word}`)}
          {head('replied', 'Replied', `Got a reply ${word} (bot replies count too)`)}
          {head('resolved', 'Resolved', `Of ${word}'s chats, now resolved`)}
          {head('open24', 'Open now', 'Messaged in the last 24h, not resolved')}
          {head('waiting', 'Waiting', 'Open now and the last message is from the customer')}
          {head('unassigned_waiting', 'Unassigned', 'Waiting and nobody assigned')}
          {head('intervened_now', 'Intervened', 'In the Intervened state right now')}
          {head('msgs_in', 'Msgs in', `Messages received ${word}`)}
          {head('msgs_out', 'Msgs out', `Messages sent ${word}`)}
          {head('templates', 'Templates', `Template messages sent ${word}`)}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sorted.map((p) => (
          <tr key={p.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => onPick(p.id)} title="Show only this project">
            <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{p.name}</td>
            <td className="px-3 py-2 text-right font-semibold text-gray-900">{fmt(p.chats)}</td>
            <td className="px-3 py-2 text-right text-gray-700">{fmt(p.new_chats)}</td>
            <td className="px-3 py-2 text-right text-gray-700">{fmt(p.replied)} <span className="text-[11px] text-gray-400">{pct(p.replied, p.chats)}</span></td>
            <td className="px-3 py-2 text-right text-gray-700">{fmt(p.resolved)}</td>
            <td className="px-3 py-2 text-right text-gray-700">{fmt(p.open24)}</td>
            <td className={`px-3 py-2 text-right ${p.waiting > 0 ? 'text-amber-600 font-semibold' : 'text-gray-700'}`}>{fmt(p.waiting)}</td>
            <td className={`px-3 py-2 text-right ${p.unassigned_waiting > 0 ? 'text-amber-600 font-semibold' : 'text-gray-700'}`}>{fmt(p.unassigned_waiting)}</td>
            <td className="px-3 py-2 text-right text-gray-700">{fmt(p.intervened_now)}</td>
            <td className="px-3 py-2 text-right text-gray-500">{fmt(p.msgs_in)}</td>
            <td className="px-3 py-2 text-right text-gray-500">{fmt(p.msgs_out)}</td>
            <td className="px-3 py-2 text-right text-gray-500">{fmt(p.templates)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AgentTable({ rows, word, events }: { rows: AgentRow[]; word: string; events: boolean }) {
  const { sorted, head } = useSort(rows, 'open24');
  const cell = (v: number | null) => (v == null ? <span className="text-gray-300">—</span> : fmt(v));
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 text-xs text-gray-500">
        <tr>
          {head('name', 'Person', undefined, true)}
          {head('status', 'Status', 'Active / Break / Offline (only people in auto-assign have one)', true)}
          {head('open24', 'Open now', 'Chats assigned to them: messaged in the last 24h, not resolved')}
          {head('waiting', 'Waiting', 'Their open chats where the customer sent the last message')}
          {head('intervened_now', 'Intervened', 'Intervened by them (or transferred to them) right now')}
          {head('period_chats', 'Chats', `Chats that messaged ${word} and are assigned to them now`)}
          {head('assigned', 'Assigned', `Chats given to them ${word} (auto-assign or transfer)`)}
          {head('intervened', 'Took over', `Chats they intervened ${word}`)}
          {head('resolved', 'Resolved', `Chats they resolved ${word}`)}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sorted.map((a) => {
          const st = STATUS[a.status];
          return (
            <tr key={a.id ?? `n:${a.name}`} className="hover:bg-gray-50">
              <td className="px-3 py-2 whitespace-nowrap">
                <p className="font-medium text-gray-800">{a.name}</p>
                <p className="text-[11px] text-gray-400 truncate max-w-[220px]" title={a.projects.join(', ')}>
                  <span className="capitalize">{a.role || 'not a member now'}</span>
                  {a.projects.length > 0 && ` · ${a.projects.length === 1 ? a.projects[0] : `${a.projects.length} projects`}`}
                </p>
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">
                {st ? <span className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${st.dot}`} />{st.label}</span> : <span className="text-gray-300">—</span>}
              </td>
              <td className="px-3 py-2 text-right font-semibold text-gray-900">{fmt(a.open24)}</td>
              <td className={`px-3 py-2 text-right ${a.waiting > 0 ? 'text-amber-600 font-semibold' : 'text-gray-700'}`}>{fmt(a.waiting)}</td>
              <td className="px-3 py-2 text-right text-gray-700">{fmt(a.intervened_now)}</td>
              <td className="px-3 py-2 text-right text-gray-700">{fmt(a.period_chats)}</td>
              <td className="px-3 py-2 text-right text-gray-700">{events ? cell(a.assigned) : <span className="text-gray-300">—</span>}</td>
              <td className="px-3 py-2 text-right text-gray-700">{events ? cell(a.intervened) : <span className="text-gray-300">—</span>}</td>
              <td className="px-3 py-2 text-right text-gray-700">{events ? cell(a.resolved) : <span className="text-gray-300">—</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function ChatStatsPanel() {
  const [period, setPeriod]   = useState<Period>('today');
  const [project, setProject] = useState<string>('all');
  const [view, setView]       = useState<'projects' | 'agents'>('projects');
  const [stats, setStats]     = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [hidden, setHidden]   = useState(false);   // not admin/manager anywhere

  const load = useCallback((fresh = false) => {
    setLoading(true);
    apiFetch(`/api/dashboard/chat-stats?period=${period}&workspace=${project}${fresh ? '&fresh=1' : ''}`)
      .then((r) => { setStats(r.data); setError(''); })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Could not load';
        if (/admin or manager/i.test(msg)) setHidden(true); else setError(msg);
      })
      .finally(() => setLoading(false));
  }, [period, project]);

  useEffect(() => {
    load();
    const t = setInterval(() => load(), 120_000);
    return () => clearInterval(t);
  }, [load]);

  if (hidden) return null;
  const word = PERIODS.find((p) => p.key === period)!.word;
  const t = stats?.totals;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      {/* Controls — one row */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2 mr-auto">
          <MessagesSquare size={17} className="text-whatsapp-green" /> Chats
        </h2>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`px-2.5 py-1.5 font-medium transition-colors ${period === p.key ? 'bg-whatsapp-green text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <select value={project} onChange={(e) => setProject(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 max-w-[200px]">
          <option value="all">All projects{stats ? ` (${stats.allProjects.length})` : ''}</option>
          {stats?.allProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={() => load(true)} disabled={loading} title="Refresh"
          className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {!stats && loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" /> Loading chat numbers…
        </div>
      )}

      {stats && t && (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <Tile label="Chats" value={t.chats} hint={`Contacts who messaged ${word}`} sub={`${fmt(t.msgs_in)} messages in`} />
            <Tile label="New chats" value={t.new_chats} hint={`First message ever was ${word}`} sub={pct(t.new_chats, t.chats) + ' of chats'} />
            <Tile label="Replied" value={t.replied} hint={`Got a reply ${word} (bot replies count too)`} sub={pct(t.replied, t.chats) + ' of chats'} />
            <Tile label="Resolved" value={t.resolved} hint={`Of ${word}'s chats, now resolved`} sub={pct(t.resolved, t.chats) + ' of chats'} />
            <Tile label="Open now" value={t.open24} tone="now" hint="Messaged in the last 24h, not resolved" />
            <Tile label="Waiting for reply" value={t.waiting} tone="warn" hint="Open now and the customer sent the last message" />
            <Tile label="Unassigned waiting" value={t.unassigned_waiting} tone="warn" hint="Waiting for a reply and nobody is assigned" />
            <Tile label="Intervened now" value={t.intervened_now} tone="now" hint="In the Intervened state right now" />
          </div>
          <p className="text-[11px] text-gray-400 -mt-2">
            {fmt(t.msgs_out)} messages sent {word} ({fmt(t.templates)} templates).
            Green dot = right now; the rest is {word}. Updated {new Date(stats.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}.
          </p>

          {/* Chats by hour / day */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">Chats by {stats.byHour ? 'hour' : 'day'} <span className="text-gray-400 font-normal">(India time)</span></p>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.series} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} formatter={(v) => [fmt(Number(v)), 'Chats']}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <Bar dataKey="chats" fill="#25D366" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Breakdown */}
          <div>
            <div className="flex items-center gap-1 border-b border-gray-100 mb-2">
              {([['projects', `By project (${stats.projects.length})`], ['agents', `By person (${stats.agents.length})`]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setView(k)}
                  className={`px-3 py-1.5 text-xs font-semibold border-b-2 -mb-px transition-colors ${view === k ? 'border-whatsapp-green text-whatsapp-green' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
              {project !== 'all' && (
                <button onClick={() => setProject('all')} className="ml-auto text-xs text-whatsapp-green hover:underline">Show all projects</button>
              )}
            </div>
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              {view === 'projects'
                ? <ProjectTable rows={stats.projects} word={word} onPick={(id) => setProject(String(id))} />
                : <AgentTable rows={stats.agents} word={word} events={stats.eventsAvailable} />}
            </div>
            {view === 'agents' && !stats.eventsAvailable && (
              <p className="text-[11px] text-amber-600 mt-2">
                Assigned / Took over / Resolved per person start counting once migration-agent-chat-events.sql is run on the database.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
