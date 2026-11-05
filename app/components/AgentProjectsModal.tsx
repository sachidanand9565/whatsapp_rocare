'use client';
/**
 * Agents page: one agent's Auto Assign across every project they're in (that
 * the admin also runs) — set it here instead of switching project by project.
 */
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Loader2, ToggleLeft, ToggleRight, Layers } from 'lucide-react';
import { apiFetch } from '@/hooks/useApi';

interface Project {
  id: number; name: string; role: string;
  auto_assign: boolean; project_enabled: boolean; open_chats: number;
}

export default function AgentProjectsModal({ agent, onClose }: {
  agent: { id: number; name: string };
  onClose: (changed: boolean) => void;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState<string | null>(null);   // `${wsId}:${field}`
  const [changed, setChanged]   = useState(false);

  const load = useCallback(() => {
    apiFetch(`/api/auto-assign/agent/${agent.id}`)
      .then((r) => setProjects(r.data || []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load projects'));
  }, [agent.id]);
  useEffect(() => { load(); }, [load]);

  async function update(p: Project, field: 'auto_assign' | 'project_enabled', value: boolean) {
    setBusy(`${p.id}:${field}`);
    try {
      await apiFetch(`/api/auto-assign/agent/${agent.id}`, {
        method: 'PUT', body: JSON.stringify({ workspace_id: p.id, [field]: value }),
      });
      setProjects((prev) => prev && prev.map((x) => x.id === p.id ? { ...x, [field]: value } : x));
      setChanged(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update');
    } finally {
      setBusy(null);
    }
  }

  async function setAll(value: boolean) {
    for (const p of projects || []) if (p.auto_assign !== value) await update(p, 'auto_assign', value);
  }

  const onCount = projects?.filter((p) => p.auto_assign).length ?? 0;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => onClose(changed)}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100">
          <Layers size={18} className="text-whatsapp-green mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-gray-900 truncate">Auto Assign — {agent.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">Every project this person is in. Chats come to them only where Auto Assign is on and the project&apos;s auto-assign is on.</p>
          </div>
          <button onClick={() => onClose(changed)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && <p className="text-sm text-red-500 p-5">{error}</p>}
          {!error && !projects && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
              <Loader2 size={16} className="animate-spin" /> Loading projects…
            </div>
          )}
          {projects && projects.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-10">Not an agent or manager in any of your projects.</p>
          )}
          {projects && projects.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Project</th>
                  <th className="px-3 py-2 text-center font-medium" title="Their chats right now (last 24h, not resolved)">Open chats</th>
                  <th className="px-3 py-2 text-center font-medium">Auto Assign</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-800">{p.name}</p>
                      <p className="text-[11px] text-gray-400 capitalize">
                        {p.role}
                        {!p.project_enabled && (
                          <>
                            {' · '}<span className="text-amber-600">project auto-assign off</span>{' '}
                            <button onClick={() => update(p, 'project_enabled', true)} disabled={busy === `${p.id}:project_enabled`}
                              className="text-whatsapp-green font-semibold hover:underline disabled:opacity-50">Turn on</button>
                          </>
                        )}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-center font-semibold text-gray-700">{p.open_chats}</td>
                    <td className="px-3 py-2.5 text-center">
                      <button onClick={() => update(p, 'auto_assign', !p.auto_assign)} disabled={busy === `${p.id}:auto_assign`}
                        className="disabled:opacity-50" title={p.auto_assign ? 'Gets chats automatically' : 'Does not get chats automatically'}>
                        {p.auto_assign
                          ? <ToggleRight size={24} className="text-green-500" />
                          : <ToggleLeft size={24} className="text-gray-400" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {projects && projects.length > 1 && (
          <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-gray-100 text-sm">
            <span className="text-gray-500">On in {onCount} of {projects.length} projects</span>
            <div className="flex gap-2">
              <button onClick={() => setAll(false)} disabled={!!busy} className="btn-secondary text-xs px-3 py-1.5">All off</button>
              <button onClick={() => setAll(true)} disabled={!!busy} className="btn-primary text-xs px-3 py-1.5">All on</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
