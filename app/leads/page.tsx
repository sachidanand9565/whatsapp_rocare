'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/hooks/useApi';
import {
  Plus, Search, Phone, IndianRupee,
  Trash2, ChevronRight, Target, X, RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Lead {
  id: number;
  name: string;
  phone: string;
  email: string;
  source: string;
  stage: string;
  assigned_to: number | null;
  assigned_name: string | null;
  deal_value: number | null;
  notes: string;
  created_at: string;
}

interface StageCount { stage: string; cnt: number; }

const STAGES = [
  { key: 'new',         label: 'New',         dot: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-700',     activeBg: 'bg-blue-500' },
  { key: 'contacted',   label: 'Contacted',   dot: 'bg-amber-500',   badge: 'bg-amber-50 text-amber-700',   activeBg: 'bg-amber-500' },
  { key: 'qualified',   label: 'Qualified',   dot: 'bg-violet-500',  badge: 'bg-violet-50 text-violet-700', activeBg: 'bg-violet-500' },
  { key: 'proposal',    label: 'Proposal',    dot: 'bg-orange-500',  badge: 'bg-orange-50 text-orange-700', activeBg: 'bg-orange-500' },
  { key: 'negotiation', label: 'Negotiation', dot: 'bg-pink-500',    badge: 'bg-pink-50 text-pink-700',     activeBg: 'bg-pink-500' },
  { key: 'won',         label: 'Won',         dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700', activeBg: 'bg-emerald-500' },
  { key: 'lost',        label: 'Lost',        dot: 'bg-red-400',     badge: 'bg-red-50 text-red-700',       activeBg: 'bg-red-400' },
];

const SOURCE_COLORS: Record<string, string> = {
  whatsapp: 'bg-green-100 text-green-700',
  scraper:  'bg-indigo-100 text-indigo-700',
  manual:   'bg-gray-100 text-gray-500',
  campaign: 'bg-orange-100 text-orange-700',
  flow:     'bg-purple-100 text-purple-700',
};

export default function LeadsPage() {
  const router = useRouter();
  const [leads, setLeads]             = useState<Lead[]>([]);
  const [total, setTotal]             = useState(0);
  const [stageCounts, setStageCounts] = useState<StageCount[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [showModal, setShowModal]     = useState(false);
  const [form, setForm] = useState({
    name: '', phone: '', email: '', source: 'manual', stage: 'new', deal_value: '', notes: '',
  });
  const [saving, setSaving]   = useState(false);
  const [syncing, setSyncing] = useState(false);

  const totalCount = stageCounts.reduce((s, c) => s + Number(c.cnt), 0);

  function stageCount(key: string) {
    return Number(stageCounts.find((s) => s.stage === key)?.cnt || 0);
  }

  const stageInfo = (key: string) => STAGES.find((s) => s.key === key) || STAGES[0];

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '500' });
    if (search)      params.set('search', search);
    if (stageFilter) params.set('stage', stageFilter);
    apiFetch(`/api/leads?${params}`)
      .then((r) => {
        setLeads(r.data?.data || []);
        setTotal(r.data?.total || 0);
        setStageCounts(r.data?.stageCounts || []);
      })
      .catch((e: Error) => toast.error(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [search, stageFilter]);

  useEffect(() => { load(); }, [load]);

  async function syncContacts() {
    setSyncing(true);
    try {
      const r = await apiFetch('/api/leads/sync', { method: 'POST' });
      toast.success(`${r.data?.imported} contacts imported!`);
      load();
    } catch (e: unknown) {
      toast.error((e as Error).message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function deleteLead(id: number) {
    if (!confirm('Delete this lead?')) return;
    await apiFetch(`/api/leads/${id}`, { method: 'DELETE' });
    toast.success('Deleted');
    load();
  }

  async function quickStage(leadId: number, stage: string) {
    await apiFetch(`/api/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify({ stage }) });
    setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, stage } : l));
    setStageCounts((prev) => {
      const old = leads.find((l) => l.id === leadId)?.stage;
      return prev.map((s) => {
        if (s.stage === old)   return { ...s, cnt: Number(s.cnt) - 1 };
        if (s.stage === stage) return { ...s, cnt: Number(s.cnt) + 1 };
        return s;
      });
    });
  }

  async function createLead() {
    if (!form.name && !form.phone) { toast.error('Name or phone required'); return; }
    setSaving(true);
    try {
      await apiFetch('/api/leads', {
        method: 'POST',
        body: JSON.stringify({ ...form, deal_value: form.deal_value ? Number(form.deal_value) : null }),
      });
      toast.success('Lead created');
      setShowModal(false);
      setForm({ name: '', phone: '', email: '', source: 'manual', stage: 'new', deal_value: '', notes: '' });
      load();
    } catch { toast.error('Failed'); }
    finally { setSaving(false); }
  }

  const totalValue = leads.reduce((s, l) => s + (l.deal_value ? Number(l.deal_value) : 0), 0);
  const wonCount   = stageCount('won');
  const lostCount  = stageCount('lost');

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-whatsapp-teal/10 flex items-center justify-center">
            <Target size={18} className="text-whatsapp-teal" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-none">Leads CRM</h1>
            <p className="text-xs text-gray-400 mt-0.5">{totalCount} leads</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone..."
              className="input pl-8 pr-3 py-1.5 text-sm w-48"
            />
          </div>
          <button onClick={syncContacts} disabled={syncing} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Importing...' : 'Sync Contacts'}
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5">
            <Plus size={14} /> Add Lead
          </button>
        </div>
      </div>

      {/* ── Stats cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total',    value: totalCount,                         sub: 'all leads' },
          { label: 'Pipeline', value: `₹${totalValue.toLocaleString()}`,  sub: 'deal value' },
          { label: 'Won',      value: wonCount,                           sub: 'closed' },
          { label: 'Active',   value: totalCount - wonCount - lostCount,  sub: 'in progress' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
            <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">{s.label}</p>
            <p className="text-2xl font-bold text-gray-800 mt-0.5 leading-none">{s.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Stage tabs with counts ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex overflow-x-auto border-b border-gray-100">
          {/* All tab */}
          <button
            onClick={() => setStageFilter('')}
            className={`flex-shrink-0 flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors
              ${stageFilter === ''
                ? 'border-whatsapp-teal text-whatsapp-teal bg-whatsapp-teal/5'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
          >
            All
            <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[22px] text-center
              ${stageFilter === '' ? 'bg-whatsapp-teal text-white' : 'bg-gray-100 text-gray-500'}`}>
              {totalCount}
            </span>
          </button>

          {STAGES.map((s) => {
            const cnt = stageCount(s.key);
            const active = stageFilter === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setStageFilter(active ? '' : s.key)}
                className={`flex-shrink-0 flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors
                  ${active
                    ? 'border-gray-800 text-gray-900 bg-gray-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
              >
                <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                {s.label}
                <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[22px] text-center
                  ${active ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  {cnt}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── List table ── */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-7 h-7 border-2 border-whatsapp-teal border-t-transparent rounded-full animate-spin" />
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-300">
            <Target size={36} className="mb-2" />
            <p className="text-sm text-gray-400">No leads{stageFilter ? ` in ${stageInfo(stageFilter).label}` : ''}</p>
            {!stageFilter && (
              <button onClick={syncContacts} disabled={syncing} className="mt-3 btn-secondary text-xs flex items-center gap-1.5">
                <RefreshCw size={12} /> Sync from Contacts
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Phone</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Stage</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Move to</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Source</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Value</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {leads.map((lead, idx) => {
                  const si = stageInfo(lead.stage);
                  const nextStage = STAGES[STAGES.findIndex((s) => s.key === lead.stage) + 1];
                  return (
                    <tr
                      key={lead.id}
                      className="hover:bg-blue-50/30 cursor-pointer transition-colors group"
                      onClick={() => router.push(`/leads/${lead.id}`)}
                    >
                      <td className="px-4 py-3 text-xs text-gray-300 font-mono">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-800 truncate max-w-[160px]">{lead.name || '—'}</p>
                        {lead.email && <p className="text-xs text-gray-400 truncate max-w-[160px]">{lead.email}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 font-mono whitespace-nowrap">
                        {lead.phone ? (
                          <span className="flex items-center gap-1">
                            <Phone size={10} className="text-gray-300" /> {lead.phone}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${si.badge}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${si.dot}`} />
                          {si.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {nextStage ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); quickStage(lead.id, nextStage.key); }}
                            className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg ${nextStage.badge} hover:opacity-80 transition-opacity whitespace-nowrap`}
                          >
                            → {nextStage.label}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${SOURCE_COLORS[lead.source] || 'bg-gray-100 text-gray-500'}`}>
                          {lead.source}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-emerald-700 whitespace-nowrap">
                        {lead.deal_value ? `₹${Number(lead.deal_value).toLocaleString()}` : <span className="text-gray-200">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(lead.created_at).toLocaleDateString('en-IN')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <ChevronRight size={14} className="text-gray-300" />
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteLead(lead.id); }}
                            className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add Lead Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900">Add New Lead</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Name</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Full name" className="input w-full text-sm" autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Phone</label>
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="919876543210" className="input w-full text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Email</label>
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="email@example.com" className="input w-full text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Source</label>
                  <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="input w-full text-sm">
                    <option value="manual">Manual</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="scraper">Scraper</option>
                    <option value="campaign">Campaign</option>
                    <option value="flow">Flow</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Stage</label>
                  <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} className="input w-full text-sm">
                    {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Deal Value (₹)</label>
                <input type="number" value={form.deal_value} onChange={(e) => setForm({ ...form, deal_value: e.target.value })}
                  placeholder="e.g. 50000" className="input w-full text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2} className="input w-full text-sm resize-none" placeholder="Notes..." />
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-5">
              <button onClick={() => setShowModal(false)} className="btn-secondary flex-1 text-sm">Cancel</button>
              <button onClick={createLead} disabled={saving} className="btn-primary flex-1 text-sm">
                {saving ? 'Creating...' : 'Create Lead'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
