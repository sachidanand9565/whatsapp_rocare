'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/hooks/useApi';
import {
  Plus, Search, LayoutGrid, List, Phone,
  IndianRupee, Trash2, ChevronRight, Target, X,
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
  { key: 'new',         label: 'New',         color: 'bg-blue-50 text-blue-700',     headerBg: 'bg-blue-500',   dot: 'bg-blue-500' },
  { key: 'contacted',   label: 'Contacted',   color: 'bg-amber-50 text-amber-700',   headerBg: 'bg-amber-500',  dot: 'bg-amber-500' },
  { key: 'qualified',   label: 'Qualified',   color: 'bg-violet-50 text-violet-700', headerBg: 'bg-violet-500', dot: 'bg-violet-500' },
  { key: 'proposal',    label: 'Proposal',    color: 'bg-orange-50 text-orange-700', headerBg: 'bg-orange-500', dot: 'bg-orange-500' },
  { key: 'negotiation', label: 'Negotiation', color: 'bg-pink-50 text-pink-700',     headerBg: 'bg-pink-500',   dot: 'bg-pink-500' },
  { key: 'won',         label: 'Won',         color: 'bg-emerald-50 text-emerald-700', headerBg: 'bg-emerald-500', dot: 'bg-emerald-500' },
  { key: 'lost',        label: 'Lost',        color: 'bg-red-50 text-red-700',       headerBg: 'bg-red-400',    dot: 'bg-red-400' },
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
  const [view, setView]               = useState<'kanban' | 'list'>('kanban');
  const [search, setSearch]           = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [showModal, setShowModal]     = useState(false);
  const [form, setForm] = useState({
    name: '', phone: '', email: '', source: 'manual', stage: 'new', deal_value: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '200' });
    if (search)      params.set('search', search);
    if (stageFilter) params.set('stage', stageFilter);
    apiFetch(`/api/leads?${params}`)
      .then((r) => {
        setLeads(r.data?.data || []);
        setTotal(r.data?.total || 0);
        setStageCounts(r.data?.stageCounts || []);
      })
      .catch(() => toast.error('Failed to load leads'))
      .finally(() => setLoading(false));
  }, [search, stageFilter]);

  useEffect(() => { load(); }, [load]);

  async function deleteLead(id: number) {
    if (!confirm('Delete this lead?')) return;
    await apiFetch(`/api/leads/${id}`, { method: 'DELETE' });
    toast.success('Lead deleted');
    load();
  }

  async function quickStage(lead: Lead, stage: string) {
    await apiFetch(`/api/leads/${lead.id}`, { method: 'PATCH', body: JSON.stringify({ stage }) });
    setLeads((prev) => prev.map((l) => l.id === lead.id ? { ...l, stage } : l));
    toast.success(`Moved to ${stage}`);
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
    } catch {
      toast.error('Failed to create lead');
    } finally {
      setSaving(false);
    }
  }

  function stageCount(key: string) {
    return stageCounts.find((s) => s.stage === key)?.cnt || 0;
  }

  const stageInfo = (key: string) => STAGES.find((s) => s.key === key) || STAGES[0];

  const totalValue = leads.reduce((sum, l) => sum + (l.deal_value ? Number(l.deal_value) : 0), 0);
  const wonCount   = stageCounts.find((s) => s.stage === 'won')?.cnt || 0;

  return (
    <div className="flex flex-col h-full gap-4">

      {/* ── Top bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-whatsapp-teal/10 flex items-center justify-center">
            <Target size={18} className="text-whatsapp-teal" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-none">Leads CRM</h1>
            <p className="text-xs text-gray-400 mt-0.5">{total} leads · ₹{totalValue.toLocaleString()} pipeline</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="input pl-8 pr-3 py-1.5 text-sm w-44"
            />
          </div>

          {/* Stage filter pills */}
          <div className="hidden lg:flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setStageFilter('')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all
                ${stageFilter === '' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
            >
              All
            </button>
            {STAGES.map((s) => (
              <button
                key={s.key}
                onClick={() => setStageFilter(stageFilter === s.key ? '' : s.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all
                  ${stageFilter === s.key ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Stage filter mobile */}
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="lg:hidden input py-1.5 text-sm"
          >
            <option value="">All Stages</option>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>

          {/* View toggle */}
          <div className="flex bg-gray-100 rounded-lg p-1 gap-0.5">
            <button
              onClick={() => setView('kanban')}
              title="Kanban"
              className={`p-1.5 rounded-md transition-all ${view === 'kanban' ? 'bg-white shadow text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <LayoutGrid size={15} />
            </button>
            <button
              onClick={() => setView('list')}
              title="List"
              className={`p-1.5 rounded-md transition-all ${view === 'list' ? 'bg-white shadow text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <List size={15} />
            </button>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <Plus size={15} /> Add Lead
          </button>
        </div>
      </div>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Leads',    value: total,                               sub: 'all stages' },
          { label: 'Pipeline Value', value: `₹${totalValue.toLocaleString()}`,   sub: 'total deal value' },
          { label: 'Won',            value: wonCount,                             sub: 'closed deals' },
          { label: 'Active',         value: total - wonCount - (stageCounts.find((s) => s.stage === 'lost')?.cnt || 0), sub: 'in progress' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
            <p className="text-xs text-gray-400 font-medium">{stat.label}</p>
            <p className="text-xl font-bold text-gray-800 mt-0.5">{stat.value}</p>
            <p className="text-[10px] text-gray-400">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-whatsapp-teal border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-sm text-gray-400">Loading leads...</p>
          </div>
        </div>
      ) : view === 'kanban' ? (

        /* ─── Kanban ─── */
        <div className="flex gap-3 overflow-x-auto pb-2 flex-1" style={{ minHeight: 0 }}>
          {STAGES.map((stage) => {
            const stageLeads = leads.filter((l) => l.stage === stage.key);
            return (
              <div
                key={stage.key}
                className="flex-shrink-0 w-60 flex flex-col bg-gray-50 rounded-2xl overflow-hidden border border-gray-200"
              >
                {/* Column header */}
                <div className="px-3 pt-3 pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${stage.dot}`} />
                      <span className="text-sm font-semibold text-gray-700">{stage.label}</span>
                    </div>
                    <span className="text-xs font-bold text-gray-500 bg-white border border-gray-200 rounded-full px-2 py-0.5 min-w-[24px] text-center">
                      {stageLeads.length}
                    </span>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                  {stageLeads.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 text-gray-300">
                      <Target size={22} className="mb-1" />
                      <p className="text-xs">No leads</p>
                    </div>
                  )}
                  {stageLeads.map((lead) => (
                    <div
                      key={lead.id}
                      onClick={() => router.push(`/leads/${lead.id}`)}
                      className="bg-white rounded-xl border border-gray-200 p-3 cursor-pointer hover:shadow-md hover:border-gray-300 transition-all group"
                    >
                      {/* Name + delete */}
                      <div className="flex items-start justify-between gap-1 mb-2">
                        <p className="font-semibold text-gray-800 text-sm leading-tight truncate flex-1">
                          {lead.name || 'Unnamed'}
                        </p>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteLead(lead.id); }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-all flex-shrink-0"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>

                      {lead.phone && (
                        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1.5">
                          <Phone size={10} />
                          <span className="truncate">{lead.phone}</span>
                        </div>
                      )}

                      {lead.deal_value && (
                        <div className="flex items-center gap-1 text-xs font-bold text-emerald-600 mb-2">
                          <IndianRupee size={10} />
                          {Number(lead.deal_value).toLocaleString()}
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${SOURCE_COLORS[lead.source] || 'bg-gray-100 text-gray-500'}`}>
                          {lead.source}
                        </span>
                        {lead.assigned_name && (
                          <span className="text-[10px] text-gray-400 truncate max-w-[60px]">
                            {lead.assigned_name}
                          </span>
                        )}
                      </div>

                      {/* Quick move — next stage only */}
                      {(() => {
                        const idx = STAGES.findIndex((s) => s.key === stage.key);
                        const next = STAGES[idx + 1];
                        if (!next) return null;
                        return (
                          <button
                            onClick={(e) => { e.stopPropagation(); quickStage(lead, next.key); }}
                            className={`mt-2 w-full text-[10px] font-semibold py-1 rounded-lg ${next.color} hover:opacity-80 transition-opacity`}
                          >
                            → {next.label}
                          </button>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

      ) : (

        /* ─── List View ─── */
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden flex-1 shadow-sm">
          <div className="overflow-auto h-full">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Phone</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Stage</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Source</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Deal Value</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Assigned</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Created</th>
                  <th className="px-4 py-3 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {leads.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-16">
                      <Target size={32} className="mx-auto text-gray-200 mb-2" />
                      <p className="text-sm text-gray-400">No leads found</p>
                    </td>
                  </tr>
                )}
                {leads.map((lead) => {
                  const si = stageInfo(lead.stage);
                  return (
                    <tr
                      key={lead.id}
                      className="hover:bg-gray-50/80 cursor-pointer transition-colors group"
                      onClick={() => router.push(`/leads/${lead.id}`)}
                    >
                      <td className="px-4 py-3 font-semibold text-gray-800">{lead.name || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs font-mono">{lead.phone || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${si.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${si.dot}`} />
                          {si.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SOURCE_COLORS[lead.source] || 'bg-gray-100 text-gray-500'}`}>
                          {lead.source}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-emerald-700">
                        {lead.deal_value ? `₹${Number(lead.deal_value).toLocaleString()}` : <span className="text-gray-300 font-normal">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{lead.assigned_name || '—'}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {new Date(lead.created_at).toLocaleDateString('en-IN')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <ChevronRight size={14} className="text-gray-400" />
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteLead(lead.id); }}
                            className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
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
        </div>
      )}

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
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Full name"
                    className="input w-full text-sm"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Phone</label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="919876543210"
                    className="input w-full text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Email</label>
                <input
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="email@example.com"
                  className="input w-full text-sm"
                />
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
                <input
                  type="number"
                  value={form.deal_value}
                  onChange={(e) => setForm({ ...form, deal_value: e.target.value })}
                  placeholder="e.g. 50000"
                  className="input w-full text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Initial notes..."
                  rows={2}
                  className="input w-full text-sm resize-none"
                />
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
