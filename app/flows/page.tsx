'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { apiFetch } from '@/hooks/useApi';
import { Plus, Trash2, ToggleLeft, ToggleRight, GitBranch, Pencil, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { encryptId } from '@/lib/idCrypt';

interface Flow {
  id:            number;
  name:          string;
  trigger_type:  string;
  trigger_value: string | null;
  is_active:     number;
  created_at:    string;
}

const TRIGGER_LABELS: Record<string, string> = {
  keyword:     'Contains keyword',
  starts_with: 'Starts with',
  any:         'Any message',
};

export default function FlowsPage() {
  const router = useRouter();
  const [flows, setFlows]       = useState<Flow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [form, setForm]         = useState({ name: '', trigger_type: 'keyword', trigger_value: '' });
  const [keywords, setKeywords] = useState<string[]>([]);
  const [kwInput, setKwInput]   = useState('');
  const kwInputRef              = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/flows').then((r) => setFlows(r.data || [])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function addKeyword(val: string) {
    const kw = val.trim().toLowerCase();
    if (kw && !keywords.includes(kw)) setKeywords((prev) => [...prev, kw]);
    setKwInput('');
  }

  async function createFlow(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Combine tag-input keywords OR single input
      const triggerVal = form.trigger_type === 'any'
        ? null
        : keywords.length > 0
          ? keywords.join(', ')
          : form.trigger_value || null;

      const r = await apiFetch('/api/flows', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          trigger_type: form.trigger_type,
          trigger_value: triggerVal,
          nodes: [],
          edges: [],
        }),
      });
      toast.success('Flow created!');
      setShowModal(false);
      setForm({ name: '', trigger_type: 'keyword', trigger_value: '' });
      setKeywords([]);
      router.push(`/flows/${encryptId(r.data.id)}`);
    } catch { toast.error('Failed to create flow'); }
    finally { setSaving(false); }
  }

  async function toggleFlow(flow: Flow) {
    await apiFetch(`/api/flows/${flow.id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: flow.is_active ? 0 : 1 }),
    });
    load();
  }

  async function deleteFlow(flow: Flow) {
    if (!confirm(`Delete "${flow.name}"?`)) return;
    await apiFetch(`/api/flows/${flow.id}`, { method: 'DELETE' });
    toast.success('Flow deleted');
    load();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <GitBranch size={22} className="text-whatsapp-teal" /> Flow Builder
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Build multi-step WhatsApp conversation flows</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> New Flow
        </button>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">Loading…</div>
        ) : flows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
            <GitBranch size={40} className="opacity-30" />
            <p className="text-sm">No flows yet. Create your first flow.</p>
            <button onClick={() => setShowModal(true)} className="btn-primary text-sm flex items-center gap-2">
              <Plus size={14} /> Create Flow
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Trigger</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {flows.map((flow) => (
                <tr key={flow.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
                        <GitBranch size={15} className="text-whatsapp-teal" />
                      </div>
                      <span className="font-medium text-gray-900">{flow.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                        {TRIGGER_LABELS[flow.trigger_type] || flow.trigger_type}
                      </span>
                      {flow.trigger_value && flow.trigger_value.split(',').map((k) => k.trim()).filter(Boolean).map((kw) => (
                        <span key={kw} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-mono">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleFlow(flow)}>
                      {flow.is_active
                        ? <ToggleRight size={22} className="text-green-500" />
                        : <ToggleLeft size={22} className="text-gray-400" />}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => router.push(`/flows/${encryptId(flow.id)}`)}
                        title="Edit flow"
                        className="p-1.5 text-gray-400 hover:text-whatsapp-teal hover:bg-teal-50 rounded transition-colors">
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => deleteFlow(flow)}
                        title="Delete flow"
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-5">New Flow</h2>
            <form onSubmit={createFlow} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Flow Name</label>
                <input
                  required autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Welcome Flow, Order Status"
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Trigger Type</label>
                <select
                  value={form.trigger_type}
                  onChange={(e) => setForm({ ...form, trigger_type: e.target.value })}
                  className="input">
                  <option value="keyword">Contains keyword</option>
                  <option value="starts_with">Starts with</option>
                  <option value="any">Any message</option>
                </select>
              </div>
              {form.trigger_type !== 'any' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Keywords
                    <span className="text-gray-400 font-normal ml-1">(Enter ya comma dabao)</span>
                  </label>
                  {/* Tag input */}
                  <div
                    onClick={() => kwInputRef.current?.focus()}
                    className="min-h-[42px] flex flex-wrap gap-1.5 p-2 border border-gray-200 rounded-lg cursor-text focus-within:ring-1 focus-within:ring-whatsapp-green">
                    {keywords.map((kw) => (
                      <span key={kw} className="inline-flex items-center gap-1 bg-teal-100 text-teal-800 text-xs font-medium px-2 py-1 rounded-full">
                        {kw}
                        <button type="button" onClick={() => setKeywords((prev) => prev.filter((k) => k !== kw))}
                          className="hover:text-red-600"><X size={10}/></button>
                      </span>
                    ))}
                    <input
                      ref={kwInputRef}
                      value={kwInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val.endsWith(',')) { addKeyword(val.slice(0,-1)); }
                        else { setKwInput(val); }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); addKeyword(kwInput); }
                        if (e.key === 'Backspace' && !kwInput && keywords.length) {
                          setKeywords((prev) => prev.slice(0,-1));
                        }
                      }}
                      onBlur={() => { if (kwInput.trim()) addKeyword(kwInput); }}
                      placeholder={keywords.length ? '' : form.trigger_type === 'keyword' ? 'hi, hello, order…' : '/start, /help…'}
                      className="flex-1 min-w-[120px] outline-none text-sm bg-transparent"
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Multiple keywords = flow in se kisi bhi message pe trigger hoga</p>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="flex-1 btn-primary">
                  {saving ? 'Creating…' : 'Create & Open Builder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
