'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/hooks/useApi';
import toast from 'react-hot-toast';
import { Search, Loader2, Ban, CheckCircle, Trash2 } from 'lucide-react';

interface Ws {
  id: number; name: string; plan: string; is_active: number;
  owner_name: string; owner_email: string; created_at: string;
  members: number; contacts: number; campaigns: number; messages_sent: number;
}
const PLANS = ['free', 'pro', 'enterprise'];

export default function AdminWorkspaces() {
  const [rows, setRows]       = useState<Ws[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [plan, setPlan]       = useState('');
  const [status, setStatus]   = useState('');
  const [busy, setBusy]       = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (search.trim()) p.set('search', search.trim());
    if (plan) p.set('plan', plan);
    if (status) p.set('status', status);
    apiFetch(`/api/admin/workspaces?${p.toString()}`)
      .then((r) => setRows(r.data || []))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [search, plan, status]);

  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  async function patch(id: number, body: Record<string, unknown>) {
    setBusy(id);
    try {
      const r = await apiFetch(`/api/admin/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setRows((prev) => prev.map((w) => w.id === id ? { ...w, ...r.data } : w));
      toast.success('Updated');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  async function remove(w: Ws) {
    if (!confirm(`Delete workspace "${w.name}"? Iske saare contacts, campaigns, messages bhi delete ho jayenge. Ye undo nahi hoga.`)) return;
    setBusy(w.id);
    try {
      await apiFetch(`/api/admin/workspaces/${w.id}`, { method: 'DELETE' });
      setRows((prev) => prev.filter((x) => x.id !== w.id));
      toast.success('Workspace deleted');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Workspaces / Accounts</h1>
        <p className="text-sm text-gray-500">{rows.length} accounts</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / owner / email…" className="input pl-9 text-sm py-2 w-full" />
        </div>
        <select value={plan} onChange={(e) => setPlan(e.target.value)} className="input text-sm py-2 w-36">
          <option value="">All plans</option>
          {PLANS.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input text-sm py-2 w-36">
          <option value="">All status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Workspace</th>
              <th className="text-left px-4 py-3">Owner</th>
              <th className="text-center px-3 py-3">Members</th>
              <th className="text-center px-3 py-3">Contacts</th>
              <th className="text-center px-3 py-3">Campaigns</th>
              <th className="text-center px-3 py-3">Msgs</th>
              <th className="text-left px-3 py-3">Plan</th>
              <th className="text-center px-3 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={9} className="py-10 text-center text-gray-400"><Loader2 className="animate-spin inline" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="py-10 text-center text-gray-400">No workspaces</td></tr>
            ) : rows.map((w) => (
              <tr key={w.id} className={busy === w.id ? 'opacity-50' : ''}>
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-800">{w.name}</p>
                  <p className="text-[11px] text-gray-400">#{w.id}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="text-gray-700">{w.owner_name}</p>
                  <p className="text-[11px] text-gray-400">{w.owner_email}</p>
                </td>
                <td className="text-center px-3 py-3 text-gray-600">{w.members}</td>
                <td className="text-center px-3 py-3 text-gray-600">{Number(w.contacts).toLocaleString('en-IN')}</td>
                <td className="text-center px-3 py-3 text-gray-600">{w.campaigns}</td>
                <td className="text-center px-3 py-3 text-gray-600">{Number(w.messages_sent).toLocaleString('en-IN')}</td>
                <td className="px-3 py-3">
                  <select value={w.plan} disabled={busy === w.id}
                    onChange={(e) => patch(w.id, { plan: e.target.value })}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-xs capitalize bg-white">
                    {PLANS.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
                  </select>
                </td>
                <td className="text-center px-3 py-3">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${w.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {w.is_active ? 'Active' : 'Suspended'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {w.is_active ? (
                      <button onClick={() => patch(w.id, { is_active: 0 })} disabled={busy === w.id}
                        title="Suspend" className="p-1.5 rounded text-orange-500 hover:bg-orange-50"><Ban size={15} /></button>
                    ) : (
                      <button onClick={() => patch(w.id, { is_active: 1 })} disabled={busy === w.id}
                        title="Activate" className="p-1.5 rounded text-green-600 hover:bg-green-50"><CheckCircle size={15} /></button>
                    )}
                    <button onClick={() => remove(w)} disabled={busy === w.id}
                      title="Delete" className="p-1.5 rounded text-red-500 hover:bg-red-50"><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
