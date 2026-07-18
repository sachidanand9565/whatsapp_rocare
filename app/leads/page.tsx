'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/hooks/useApi';
import {
  Plus, Search, Phone, IndianRupee,
  Trash2, ChevronRight, Target, X,
  Users, CheckCircle2, Activity, Filter, MessageSquareReply, MessageCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import LeadChatPanel from '@/app/components/LeadChatPanel';

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
interface SourceCount { source: string; cnt: number; }
interface DayCount { day: string; cnt: number; }
interface Campaign { id: number; name: string; }

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

const SOURCE_DOTS: Record<string, string> = {
  whatsapp: 'bg-green-500',
  scraper:  'bg-indigo-500',
  manual:   'bg-gray-400',
  campaign: 'bg-orange-500',
  flow:     'bg-purple-500',
};

export default function LeadsPage() {
  const router = useRouter();
  const [leads, setLeads]               = useState<Lead[]>([]);
  const [stageCounts, setStageCounts]   = useState<StageCount[]>([]);
  const [sourceCounts, setSourceCounts] = useState<SourceCount[]>([]);
  const [dailyTrend, setDailyTrend]     = useState<DayCount[]>([]);
  const [totalValue, setTotalValue]     = useState(0);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [stageFilter, setStageFilter]       = useState('');
  const [sourceFilter, setSourceFilter]     = useState('');
  const [dateFrom, setDateFrom]             = useState('');
  const [dateTo, setDateTo]                 = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [campaigns, setCampaigns]           = useState<Campaign[]>([]);
  const [campaignReplies, setCampaignReplies] = useState<number | null>(null);
  const [chatLead, setChatLead]       = useState<{ name: string; phone: string } | null>(null);
  const [showModal, setShowModal]     = useState(false);
  const [form, setForm] = useState({
    name: '', phone: '', email: '', source: 'manual', stage: 'new', deal_value: '', notes: '',
  });
  const [saving, setSaving]   = useState(false);

  const totalCount = stageCounts.reduce((s, c) => s + Number(c.cnt), 0);

  function stageCount(key: string) {
    return Number(stageCounts.find((s) => s.stage === key)?.cnt || 0);
  }

  const stageInfo = (key: string) => STAGES.find((s) => s.key === key) || STAGES[0];

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '500' });
    if (search)         params.set('search', search);
    if (stageFilter)    params.set('stage', stageFilter);
    if (sourceFilter)   params.set('source', sourceFilter);
    if (dateFrom)       params.set('dateFrom', dateFrom);
    if (dateTo)         params.set('dateTo', dateTo);
    if (campaignFilter) params.set('campaignId', campaignFilter);
    apiFetch(`/api/leads?${params}`)
      .then((r) => {
        setLeads(r.data?.data || []);
        setStageCounts(r.data?.stageCounts || []);
        setSourceCounts(r.data?.sourceCounts || []);
        setDailyTrend(r.data?.dailyTrend || []);
        setTotalValue(Number(r.data?.totalValue || 0));
        setCampaignReplies(r.data?.campaignReplies ?? null);
      })
      .catch((e: Error) => toast.error(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [search, stageFilter, sourceFilter, dateFrom, dateTo, campaignFilter]);

  // Debounced so typing in the search box doesn't fire a full leads+aggregates
  // request (500-row list + stage/source/trend counts) per keystroke.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [load]);

  useEffect(() => {
    apiFetch('/api/campaigns')
      .then((r) => setCampaigns((r.data || []).map((c: { id: number; name: string }) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
  }, []);

  function clearFilters() {
    setSearch(''); setStageFilter(''); setSourceFilter(''); setDateFrom(''); setDateTo(''); setCampaignFilter('');
  }

  const hasActiveFilters = !!(search || stageFilter || sourceFilter || dateFrom || dateTo || campaignFilter);

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

  const wonCount  = stageCount('won');
  const lostCount = stageCount('lost');
  const maxStageCount  = Math.max(1, ...STAGES.map((s) => stageCount(s.key)));
  const totalSources   = sourceCounts.reduce((s, c) => s + Number(c.cnt), 0);
  const maxDayCount    = Math.max(1, ...dailyTrend.map((d) => Number(d.cnt)));

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
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5">
            <Plus size={14} /> Add Lead
          </button>
        </div>
      </div>

      {/* ── Stats cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total',    value: totalCount,                         sub: 'all leads',   icon: Users,        ring: 'bg-blue-50 text-blue-600' },
          { label: 'Pipeline', value: `₹${totalValue.toLocaleString()}`,  sub: 'deal value',  icon: IndianRupee,  ring: 'bg-violet-50 text-violet-600' },
          { label: 'Won',      value: wonCount,                           sub: 'closed',      icon: CheckCircle2, ring: 'bg-emerald-50 text-emerald-600' },
          { label: 'Active',   value: totalCount - wonCount - lostCount,  sub: 'in progress', icon: Activity,     ring: 'bg-amber-50 text-amber-600' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 px-4 py-3.5 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">{s.label}</p>
                <p className="text-2xl font-bold text-gray-800 mt-1 leading-none">{s.value}</p>
                <p className="text-[10px] text-gray-400 mt-1">{s.sub}</p>
              </div>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.ring}`}>
                <s.icon size={16} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Analytics row: stage funnel / source breakdown / 7-day trend ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Stage funnel */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3.5">
          <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide mb-3">Stage funnel</p>
          <div className="space-y-2">
            {STAGES.map((s) => {
              const cnt = stageCount(s.key);
              return (
                <button
                  key={s.key}
                  onClick={() => setStageFilter(stageFilter === s.key ? '' : s.key)}
                  className="w-full flex items-center gap-2 group"
                >
                  <span className="text-xs text-gray-500 w-20 text-left truncate">{s.label}</span>
                  <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${s.dot} transition-all ${stageFilter === s.key ? 'opacity-100' : 'opacity-80 group-hover:opacity-100'}`}
                      style={{ width: `${(cnt / maxStageCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-gray-700 w-12 text-right">{cnt}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Source breakdown */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3.5">
          <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide mb-3">Leads by source</p>
          {totalSources === 0 ? (
            <p className="text-xs text-gray-300 py-6 text-center">No data yet</p>
          ) : (
            <>
              <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 mb-3">
                {sourceCounts.map((sc) => (
                  <div
                    key={sc.source}
                    title={`${sc.source}: ${sc.cnt}`}
                    className={SOURCE_DOTS[sc.source] || 'bg-gray-400'}
                    style={{ width: `${(Number(sc.cnt) / totalSources) * 100}%` }}
                  />
                ))}
              </div>
              <div className="space-y-1.5">
                {sourceCounts
                  .slice()
                  .sort((a, b) => Number(b.cnt) - Number(a.cnt))
                  .map((sc) => (
                    <div key={sc.source} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-gray-500 capitalize">
                        <span className={`w-2 h-2 rounded-full ${SOURCE_DOTS[sc.source] || 'bg-gray-400'}`} />
                        {sc.source}
                      </span>
                      <span className="font-semibold text-gray-700">{sc.cnt}</span>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>

        {/* 7-day trend */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3.5">
          <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide mb-3">New leads (7 days)</p>
          {dailyTrend.length === 0 ? (
            <p className="text-xs text-gray-300 py-6 text-center">No recent activity</p>
          ) : (
            <div className="flex items-end justify-between gap-1.5 h-24">
              {dailyTrend.map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="w-full flex items-end justify-center" style={{ height: '72px' }}>
                    <div
                      title={`${d.cnt} leads`}
                      className="w-full max-w-[22px] rounded-t-md bg-whatsapp-teal/70 hover:bg-whatsapp-teal transition-colors"
                      style={{ height: `${Math.max((Number(d.cnt) / maxDayCount) * 100, 4)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400">
                    {new Date(d.day).toLocaleDateString('en-IN', { weekday: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Filter bar: date range / source / campaign ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1.5 text-gray-400 mr-1">
          <Filter size={14} />
          <span className="text-[11px] font-medium uppercase tracking-wide">Filters</span>
        </div>

        <div>
          <label className="block text-[10px] text-gray-400 mb-1">From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input text-xs py-1.5 px-2" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-400 mb-1">To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input text-xs py-1.5 px-2" />
        </div>

        <div>
          <label className="block text-[10px] text-gray-400 mb-1">Source</label>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="input text-xs py-1.5 px-2">
            <option value="">All sources</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="manual">Manual</option>
            <option value="scraper">Scraper</option>
            <option value="campaign">Campaign</option>
            <option value="flow">Flow</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] text-gray-400 mb-1">Campaign</label>
          <select value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)} className="input text-xs py-1.5 px-2 max-w-[200px]">
            <option value="">All campaigns</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {campaignFilter && campaignReplies !== null && (
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1.5 rounded-lg">
            <MessageSquareReply size={13} />
            {campaignReplies} replies from this campaign
          </div>
        )}

        {hasActiveFilters && (
          <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 ml-auto">
            <X size={12} /> Clear filters
          </button>
        )}
      </div>

      {/* ── Stage filter chips ── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setStageFilter('')}
          className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
            ${stageFilter === ''
              ? 'bg-whatsapp-teal text-white'
              : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}`}
        >
          All <span className="opacity-70">{totalCount}</span>
        </button>
        {STAGES.map((s) => {
          const cnt = stageCount(s.key);
          const active = stageFilter === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setStageFilter(active ? '' : s.key)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
                ${active
                  ? 'bg-gray-800 text-white'
                  : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
              {s.label} <span className="opacity-70">{cnt}</span>
            </button>
          );
        })}
      </div>

      {/* ── Compact list ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-7 h-7 border-2 border-whatsapp-teal border-t-transparent rounded-full animate-spin" />
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-300">
            <Target size={36} className="mb-2" />
            <p className="text-sm text-gray-400">No leads{stageFilter ? ` in ${stageInfo(stageFilter).label}` : ''}</p>
          </div>
        ) : (
          <div>
            <div
              className="hidden md:grid items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wide"
              style={{ gridTemplateColumns: '28px 28px minmax(0,1fr) 120px 96px 90px 80px 90px 100px 56px 44px' }}
            >
              <span>#</span>
              <span />
              <span>Name</span>
              <span>Phone</span>
              <span>Stage</span>
              <span>Source</span>
              <span>Date</span>
              <span className="text-right">Value</span>
              <span>Move to</span>
              <span>Chat</span>
              <span />
            </div>
            <div className="divide-y divide-gray-50">
            {leads.map((lead, idx) => {
              const si = stageInfo(lead.stage);
              const nextStage = STAGES[STAGES.findIndex((s) => s.key === lead.stage) + 1];
              return (
                <div
                  key={lead.id}
                  onClick={() => router.push(`/leads/${lead.id}`)}
                  className="grid items-center gap-3 px-4 py-2.5 hover:bg-blue-50/30 cursor-pointer transition-colors group"
                  style={{ gridTemplateColumns: '28px 28px minmax(0,1fr) 120px 96px 90px 80px 90px 100px 56px 44px' }}
                >
                  <span className="text-xs text-gray-300 font-mono">{idx + 1}</span>

                  <div className="w-8 h-8 rounded-full bg-whatsapp-teal/10 text-whatsapp-teal text-xs font-bold flex items-center justify-center">
                    {(lead.name || '?').trim().charAt(0).toUpperCase()}
                  </div>

                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800 text-sm truncate">{lead.name || '—'}</p>
                    {lead.email && <p className="text-xs text-gray-400 truncate">{lead.email}</p>}
                  </div>

                  <span className="text-xs text-gray-500 font-mono whitespace-nowrap">
                    {lead.phone ? (
                      <span className="flex items-center gap-1">
                        <Phone size={9} className="text-gray-300 flex-shrink-0" /> {lead.phone}
                      </span>
                    ) : '—'}
                  </span>

                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${si.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${si.dot}`} />
                    {si.label}
                  </span>

                  <span className={`hidden sm:inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full w-fit ${SOURCE_COLORS[lead.source] || 'bg-gray-100 text-gray-500'}`}>
                    {lead.source}
                  </span>

                  <span className="hidden md:inline text-xs text-gray-400 whitespace-nowrap">
                    {new Date(lead.created_at).toLocaleDateString('en-IN')}
                  </span>

                  <span className="hidden lg:inline text-sm font-semibold text-emerald-700 text-right">
                    {lead.deal_value ? `₹${Number(lead.deal_value).toLocaleString()}` : <span className="text-gray-200">—</span>}
                  </span>

                  <div className="flex justify-end">
                    {nextStage ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); quickStage(lead.id, nextStage.key); }}
                        className={`hidden sm:inline-flex text-[11px] font-semibold px-2 py-1 rounded-lg ${nextStage.badge} hover:opacity-80 transition-opacity whitespace-nowrap`}
                      >
                        → {nextStage.label}
                      </button>
                    ) : (
                      <span className="hidden sm:inline text-xs text-gray-200">—</span>
                    )}
                  </div>

                  <div className="flex justify-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); setChatLead({ name: lead.name, phone: lead.phone }); }}
                      disabled={!lead.phone}
                      title={lead.phone ? 'Show chat' : 'No phone number'}
                      className="p-1.5 text-whatsapp-teal hover:bg-whatsapp-teal/10 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <MessageCircle size={15} />
                    </button>
                  </div>

                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteLead(lead.id); }}
                      className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={13} />
                    </button>
                    <ChevronRight size={14} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              );
            })}
            </div>
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

      {chatLead && (
        <LeadChatPanel name={chatLead.name} phone={chatLead.phone} onClose={() => setChatLead(null)} />
      )}
    </div>
  );
}
