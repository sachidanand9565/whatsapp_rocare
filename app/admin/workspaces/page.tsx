'use client';
import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/hooks/useAdminApi';
import toast from 'react-hot-toast';
import {
  Search, Loader2, Ban, CheckCircle, Trash2, ExternalLink, ChevronRight,
  Building2, Users, UserPlus, Megaphone, MessageSquare, ArrowDownLeft,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const PLANS = ['free', 'pro', 'enterprise'];

interface Account { id: number; name: string; email: string; is_active: number; projects: number; active_projects: number; messages_sent: number; }
interface Project  { id: number; name: string; plan: string; is_active: number; connected?: number; phone_number_id: string | null; created_at: string; members: number; agents: number; contacts: number; campaigns: number; messages_sent: number; }
interface Detail {
  project: Project & { owner_name: string; owner_email: string; waba_id: string | null; connected?: number };
  counts: { members?: number; agents?: number; contacts?: number; campaigns?: number; messages_sent?: number; messages_received?: number };
  agents: { id: number; name: string; email: string; role: string; is_active: number }[];
  messages14d: { date: string; count: number }[];
}

export default function AdminWorkspaces() {
  // Pane 1: accounts
  const [accounts, setAccounts]   = useState<Account[]>([]);
  const [loadingAcc, setLoadingAcc] = useState(true);
  const [search, setSearch]       = useState('');
  const [selAcc, setSelAcc]       = useState<number | null>(null);

  // Pane 2: projects of selected account
  const [projects, setProjects]   = useState<Project[]>([]);
  const [loadingProj, setLoadingProj] = useState(false);
  const [selProj, setSelProj]     = useState<number | null>(null);
  // Live Meta status per project (id -> status) for the projects list
  const [metaMap, setMetaMap]     = useState<Record<number, { status: string; message?: string; code?: number }>>({});

  // Pane 3: project detail
  const [detail, setDetail]       = useState<Detail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy]           = useState(false);
  // Live Meta status (real connection check)
  const [metaStatus, setMetaStatus] = useState<{ status: string; quality_rating?: string; message?: string; code?: number; verified_name?: string } | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);

  const loadAccounts = useCallback(() => {
    setLoadingAcc(true);
    const p = new URLSearchParams();
    if (search.trim()) p.set('search', search.trim());
    adminFetch(`/api/admin/accounts?${p.toString()}`)
      .then((r) => setAccounts(r.data || []))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoadingAcc(false));
  }, [search]);

  useEffect(() => { const t = setTimeout(loadAccounts, 300); return () => clearTimeout(t); }, [loadAccounts]);

  function openAccount(id: number) {
    setSelAcc(id); setSelProj(null); setDetail(null); setProjects([]); setMetaMap({}); setLoadingProj(true);
    adminFetch(`/api/admin/accounts/${id}`)
      .then((r) => {
        const projs: Project[] = r.data?.projects || [];
        setProjects(projs);
        // Live Meta status for configured projects (per-account, so only a few calls)
        projs.filter((p) => p.connected).forEach((p) => {
          adminFetch(`/api/admin/workspaces/${p.id}/meta-status`)
            .then((res) => setMetaMap((m) => ({ ...m, [p.id]: res.data })))
            .catch(() => setMetaMap((m) => ({ ...m, [p.id]: { status: 'unreachable' } })));
        });
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoadingProj(false));
  }

  const loadDetail = useCallback((id: number) => {
    setSelProj(id); setLoadingDetail(true);
    adminFetch(`/api/admin/workspaces/${id}`)
      .then((r) => setDetail(r.data))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoadingDetail(false));
    // Live Meta status (separate — slower)
    setMetaStatus(null); setLoadingMeta(true);
    adminFetch(`/api/admin/workspaces/${id}/meta-status`)
      .then((r) => setMetaStatus(r.data))
      .catch(() => setMetaStatus({ status: 'unreachable' }))
      .finally(() => setLoadingMeta(false));
  }, []);

  async function patch(id: number, body: Record<string, unknown>) {
    setBusy(true);
    try {
      await adminFetch(`/api/admin/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast.success('Updated');
      loadDetail(id);
      if (selAcc) adminFetch(`/api/admin/accounts/${selAcc}`).then((r) => setProjects(r.data?.projects || []));
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  async function openPanel(id: number) {
    setBusy(true);
    try {
      const r = await adminFetch(`/api/admin/workspaces/${id}/impersonate`, { method: 'POST' });
      const code = r.data?.handoffCode;
      if (!code) throw new Error('Failed to open panel');
      window.open(`/auth/sso?code=${encodeURIComponent(code)}`, '_blank');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  async function removeProject(id: number, name: string) {
    if (!confirm(`Delete project "${name}"? All its contacts, campaigns and messages will also be deleted. This cannot be undone.`)) return;
    setBusy(true);
    try {
      await adminFetch(`/api/admin/workspaces/${id}`, { method: 'DELETE' });
      toast.success('Project deleted');
      setDetail(null); setSelProj(null);
      if (selAcc) openAccount(selAcc);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">Accounts &amp; Projects</h1>
        <p className="text-sm text-gray-500">Select an account → view its projects → project details + Open Panel.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ── Pane 1: Accounts ───────────────────────── */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col max-h-[78vh]">
          <div className="p-3 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search account…" className="input pl-8 text-xs py-2 w-full" />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {loadingAcc ? (
              <div className="py-10 text-center text-gray-400"><Loader2 className="animate-spin inline" /></div>
            ) : accounts.length === 0 ? (
              <p className="py-10 text-center text-gray-400 text-xs">No accounts</p>
            ) : accounts.map((a) => (
              <button key={a.id} onClick={() => openAccount(a.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 flex items-center gap-2 ${selAcc === a.id ? 'bg-red-50' : ''}`}>
                <div className="w-8 h-8 rounded-full bg-gray-800 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {(a.name || a.email).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{a.name || a.email}</p>
                  <p className="text-[11px] text-gray-400 truncate">{a.projects} project{a.projects > 1 ? 's' : ''} · {Number(a.messages_sent).toLocaleString('en-IN')} msgs</p>
                </div>
                <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {/* ── Pane 2: Projects of account ────────────── */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col max-h-[78vh]">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5"><Building2 size={13} /> Projects</p>
          </div>
          <div className="overflow-y-auto flex-1">
            {!selAcc ? (
              <p className="py-10 text-center text-gray-400 text-xs px-4">Select an account on the left</p>
            ) : loadingProj ? (
              <div className="py-10 text-center text-gray-400"><Loader2 className="animate-spin inline" /></div>
            ) : projects.length === 0 ? (
              <p className="py-10 text-center text-gray-400 text-xs">No projects</p>
            ) : projects.map((p) => (
              <button key={p.id} onClick={() => loadDetail(p.id)}
                className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 ${selProj === p.id ? 'bg-red-50 border-l-2 border-l-red-400' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                  {(() => {
                    // Meta connection status (independent of platform suspend)
                    if (!p.connected) return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-amber-100 text-amber-700">Not set up</span>;
                    const ms = metaMap[p.id];
                    if (!ms) return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-gray-100 text-gray-400 flex items-center gap-1"><Loader2 size={8} className="animate-spin" /> Checking</span>;
                    if (ms.status === 'active')       return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-green-100 text-green-700">● Connected</span>;
                    if (ms.status === 'disconnected') return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-red-100 text-red-600" title={ms.message || ''}>⚠ Banned</span>;
                    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-gray-100 text-gray-500">Unknown</span>;
                  })()}
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5 capitalize">
                  {p.plan} · {p.agents} agents · {Number(p.contacts).toLocaleString('en-IN')} contacts
                  {!p.is_active && <span className="text-red-500 font-semibold"> · Suspended</span>}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* ── Pane 3: Project detail ─────────────────── */}
        <div className="lg:col-span-6 bg-white rounded-xl border border-gray-100 shadow-sm max-h-[78vh] overflow-y-auto">
          {!selProj ? (
            <div className="py-20 text-center text-gray-400 text-sm px-6">Select a project — details, agents and chart will appear here.</div>
          ) : loadingDetail || !detail ? (
            <div className="py-20 text-center text-gray-400"><Loader2 className="animate-spin inline" /></div>
          ) : (
            <div className="p-5 space-y-5">
              {/* Header + actions */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-gray-900 truncate">{detail.project.name}</h2>
                    {/* Platform status (admin suspend) — separate from Meta connection */}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${detail.project.is_active ? 'bg-gray-100 text-gray-600' : 'bg-red-100 text-red-600'}`}>
                      {detail.project.is_active ? 'Active' : 'Suspended'}
                    </span>
                    {loadingMeta ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0 flex items-center gap-1"><Loader2 size={9} className="animate-spin" /> Checking Meta…</span>
                    ) : metaStatus?.status === 'active' ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex-shrink-0">● Meta Connected</span>
                    ) : metaStatus?.status === 'disconnected' ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600 flex-shrink-0">⚠ Disconnected / Banned</span>
                    ) : metaStatus?.status === 'not_configured' ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex-shrink-0">Not Connected</span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">Status unknown</span>
                    )}
                  </div>
                  {metaStatus?.status === 'active' && metaStatus.quality_rating && (
                    <p className="text-[11px] text-gray-400 mt-0.5">Quality: <span className="font-medium">{metaStatus.quality_rating}</span>{metaStatus.verified_name ? ` · ${metaStatus.verified_name}` : ''}</p>
                  )}
                  {metaStatus?.status === 'disconnected' && metaStatus.message && (
                    <p className="text-[11px] text-red-500 mt-0.5">Meta: {metaStatus.message}{metaStatus.code ? ` (#${metaStatus.code})` : ''}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-0.5">Owner: {detail.project.owner_name} · {detail.project.owner_email}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Phone ID: {detail.project.phone_number_id || '—'}</p>
                </div>
                <button onClick={() => openPanel(detail.project.id)} disabled={busy}
                  className="flex-shrink-0 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 disabled:opacity-50">
                  <ExternalLink size={14} /> Open Panel
                </button>
              </div>

              {/* Stat cards */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Agents',    value: detail.counts.agents,    icon: Users,         color: 'text-purple-600 bg-purple-50' },
                  { label: 'Members',   value: detail.counts.members,   icon: UserPlus,      color: 'text-blue-600 bg-blue-50' },
                  { label: 'Contacts',  value: detail.counts.contacts,  icon: UserPlus,      color: 'text-green-600 bg-green-50' },
                  { label: 'Campaigns', value: detail.counts.campaigns, icon: Megaphone,     color: 'text-orange-600 bg-orange-50' },
                  { label: 'Sent',      value: detail.counts.messages_sent,     icon: MessageSquare, color: 'text-teal-600 bg-teal-50' },
                  { label: 'Received',  value: detail.counts.messages_received, icon: ArrowDownLeft, color: 'text-pink-600 bg-pink-50' },
                ].map((c) => (
                  <div key={c.label} className="border border-gray-100 rounded-lg p-3">
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center mb-1.5 ${c.color}`}><c.icon size={14} /></div>
                    <p className="text-lg font-bold text-gray-900">{Number(c.value ?? 0).toLocaleString('en-IN')}</p>
                    <p className="text-[10px] text-gray-400">{c.label}</p>
                  </div>
                ))}
              </div>

              {/* Chart */}
              <div className="border border-gray-100 rounded-lg p-3">
                <p className="text-xs font-semibold text-gray-600 mb-2">Messages sent (14 days)</p>
                <ResponsiveContainer width="100%" height={170}>
                  <AreaChart data={detail.messages14d}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="count" stroke="#ef4444" fill="#ef444422" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Controls: plan + suspend + delete */}
              <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                <span className="text-xs text-gray-500">Plan:</span>
                <select value={detail.project.plan} disabled={busy}
                  onChange={(e) => patch(detail.project.id, { plan: e.target.value })}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-xs capitalize bg-white">
                  {PLANS.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
                </select>
                {detail.project.is_active ? (
                  <button onClick={() => patch(detail.project.id, { is_active: 0 })} disabled={busy}
                    className="text-xs px-2.5 py-1 rounded-lg text-orange-600 bg-orange-50 hover:bg-orange-100 flex items-center gap-1"><Ban size={13} /> Suspend</button>
                ) : (
                  <button onClick={() => patch(detail.project.id, { is_active: 1 })} disabled={busy}
                    className="text-xs px-2.5 py-1 rounded-lg text-green-700 bg-green-50 hover:bg-green-100 flex items-center gap-1"><CheckCircle size={13} /> Activate</button>
                )}
                <button onClick={() => removeProject(detail.project.id, detail.project.name)} disabled={busy}
                  className="text-xs px-2.5 py-1 rounded-lg text-red-600 bg-red-50 hover:bg-red-100 flex items-center gap-1 ml-auto"><Trash2 size={13} /> Delete</button>
              </div>

              {/* Agents / members list */}
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">Team ({detail.agents.length})</p>
                <div className="border border-gray-100 rounded-lg divide-y divide-gray-50">
                  {detail.agents.length === 0 ? (
                    <p className="text-xs text-gray-400 px-3 py-3">No members</p>
                  ) : detail.agents.map((a) => (
                    <div key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-800 truncate">{a.name}</p>
                        <p className="text-[11px] text-gray-400 truncate">{a.email}</p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize flex-shrink-0">{a.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
