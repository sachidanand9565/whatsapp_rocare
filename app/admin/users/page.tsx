'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/hooks/useApi';
import toast from 'react-hot-toast';
import { Search, Loader2, Ban, CheckCircle, ShieldAlert } from 'lucide-react';

interface U {
  id: number; name: string; email: string; role: string;
  is_active: number; is_super_admin: number; created_at: string;
  workspaces: number; workspace_names: string | null;
}

export default function AdminUsers() {
  const [rows, setRows]       = useState<U[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [status, setStatus]   = useState('');
  const [busy, setBusy]       = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (search.trim()) p.set('search', search.trim());
    if (status) p.set('status', status);
    apiFetch(`/api/admin/users?${p.toString()}`)
      .then((r) => setRows(r.data || []))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [search, status]);

  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  async function patch(id: number, body: Record<string, unknown>) {
    setBusy(id);
    try {
      const r = await apiFetch(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setRows((prev) => prev.map((u) => u.id === id ? { ...u, ...r.data } : u));
      toast.success('Updated');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Users</h1>
        <p className="text-sm text-gray-500">{rows.length} users across the platform</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / email…" className="input pl-9 text-sm py-2 w-full" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input text-sm py-2 w-36">
          <option value="">All status</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">User</th>
              <th className="text-left px-4 py-3">Workspaces</th>
              <th className="text-center px-3 py-3">Role</th>
              <th className="text-center px-3 py-3">Super</th>
              <th className="text-center px-3 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={6} className="py-10 text-center text-gray-400"><Loader2 className="animate-spin inline" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="py-10 text-center text-gray-400">No users</td></tr>
            ) : rows.map((u) => (
              <tr key={u.id} className={busy === u.id ? 'opacity-50' : ''}>
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-800">{u.name}</p>
                  <p className="text-[11px] text-gray-400">{u.email}</p>
                </td>
                <td className="px-4 py-3 max-w-xs">
                  <p className="text-gray-700">{u.workspaces}</p>
                  {u.workspace_names && <p className="text-[11px] text-gray-400 truncate">{u.workspace_names}</p>}
                </td>
                <td className="text-center px-3 py-3">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{u.role}</span>
                </td>
                <td className="text-center px-3 py-3">
                  <button onClick={() => patch(u.id, { is_super_admin: u.is_super_admin ? 0 : 1 })} disabled={busy === u.id}
                    title={u.is_super_admin ? 'Revoke super-admin' : 'Make super-admin'}
                    className={`p-1.5 rounded ${u.is_super_admin ? 'text-red-500 bg-red-50' : 'text-gray-300 hover:text-gray-500'}`}>
                    <ShieldAlert size={15} />
                  </button>
                </td>
                <td className="text-center px-3 py-3">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {u.is_active ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {u.is_active ? (
                      <button onClick={() => patch(u.id, { is_active: 0 })} disabled={busy === u.id}
                        title="Disable" className="p-1.5 rounded text-orange-500 hover:bg-orange-50"><Ban size={15} /></button>
                    ) : (
                      <button onClick={() => patch(u.id, { is_active: 1 })} disabled={busy === u.id}
                        title="Enable" className="p-1.5 rounded text-green-600 hover:bg-green-50"><CheckCircle size={15} /></button>
                    )}
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
