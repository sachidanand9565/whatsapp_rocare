'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/hooks/useApi';
import { Plus, Play, Radio, Zap, GitBranch, ShoppingBag, ChevronRight, Trash2, UserPlus, X, Search, ChevronDown, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Campaign, Template, Contact, User } from '@/types';

const STATUS_COLORS: Record<string, string> = {
  draft:      'bg-gray-100 text-gray-600',
  scheduled:  'bg-blue-100 text-blue-700',
  running:    'bg-yellow-100 text-yellow-700',
  completed:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-700',
};

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode; desc: string }> = {
  broadcast:     { label: 'Broadcast',     color: 'text-purple-700', bg: 'bg-purple-100', icon: <Radio size={12} />,       desc: 'Bulk send to a list of contacts' },
  api:           { label: 'API',           color: 'text-blue-700',   bg: 'bg-blue-100',   icon: <Zap size={12} />,         desc: 'Triggered via external API calls' },
  drip:          { label: 'Drip',          color: 'text-orange-700', bg: 'bg-orange-100', icon: <GitBranch size={12} />,   desc: 'Automated sequence of messages' },
  transactional: { label: 'Transactional', color: 'text-teal-700',   bg: 'bg-teal-100',   icon: <ShoppingBag size={12} />, desc: 'Order & booking confirmations' },
};

const ALL_TYPES = ['all', 'broadcast', 'api'] as const;
type FilterType = typeof ALL_TYPES[number];

export default function CampaignsPage() {
  const router                              = useRouter();
  const [campaigns, setCampaigns]           = useState<Campaign[]>([]);
  const [loading, setLoading]               = useState(true);
  const [showModal, setShowModal]           = useState(false);
  const [filterType, setFilterType]         = useState<FilterType>('all');
  const [deletingId, setDeletingId]         = useState<number | null>(null);
  const [assignCampaign, setAssignCampaign] = useState<Campaign | null>(null);
  const [userRole, setUserRole]             = useState('admin');

  useEffect(() => {
    setUserRole(localStorage.getItem('userRole') || 'admin');
  }, []);

  function load() {
    setLoading(true);
    apiFetch('/api/campaigns').then((r) => setCampaigns(r.data || [])).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function deleteCampaign(id: number, name: string) {
    if (!confirm(`Delete campaign "${name}"? This action cannot be undone.`)) return;
    setDeletingId(id);
    try {
      const token = localStorage.getItem('token');
      const res   = await fetch(`/api/campaigns/${id}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Delete failed', { duration: 6000 }); return; }
      toast.success('Campaign deleted');
      load();
    } catch {
      toast.error('Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  async function launch(id: number) {
    try {
      const r = await apiFetch(`/api/campaigns/${id}/launch`, { method: 'POST' });
      toast.success(r.data?.message || 'Campaign launched!');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Launch failed');
    }
  }

  // Use accurate counts from campaign_contacts (cc_* fields); fall back to campaigns table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyC = (c: Campaign) => c as any;
  function ccSent(c: Campaign)      { return Number(anyC(c).cc_sent      ?? c.sent_count      ?? 0); }
  function ccDelivered(c: Campaign) { return Number(anyC(c).cc_delivered ?? c.delivered_count ?? 0); }
  function ccRead(c: Campaign)      { return Number(anyC(c).cc_read      ?? c.read_count      ?? 0); }
  function ccFailed(c: Campaign)    { return Number(anyC(c).cc_failed    ?? c.failed_count    ?? 0); }

  function deliveryRate(c: Campaign) {
    const total = c.total_contacts;
    if (!total) return '—';
    return `${Math.round((ccDelivered(c) / total) * 100)}%`;
  }
  function readRate(c: Campaign) {
    const total = c.total_contacts;
    if (!total) return '—';
    return `${Math.round((ccRead(c) / total) * 100)}%`;
  }

  const filtered = filterType === 'all'
    ? campaigns
    : campaigns.filter((c) => (c as Campaign & { campaign_type?: string }).campaign_type === filterType);

  // Count per type
  const counts = ALL_TYPES.reduce<Record<string, number>>((acc, t) => {
    acc[t] = t === 'all' ? campaigns.length : campaigns.filter((c) => (c as Campaign & { campaign_type?: string }).campaign_type === t).length;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
        {userRole !== 'agent' && (
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> New Campaign
          </button>
        )}
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {ALL_TYPES.map((t) => {
          const cfg = t === 'all' ? null : TYPE_CONFIG[t];
          const isActive = filterType === t;
          return (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                isActive ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {cfg && <span className={cfg.color}>{cfg.icon}</span>}
              <span className="capitalize">{t === 'all' ? 'All' : cfg?.label}</span>
              <span className={`text-xs rounded-full px-1.5 py-0.5 font-semibold ${
                isActive ? 'bg-gray-100 text-gray-600' : 'bg-white text-gray-400'
              }`}>{counts[t]}</span>
            </button>
          );
        })}
      </div>

      {/* Campaign cards */}
      {loading ? (
        <p className="text-gray-400 text-center py-10">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <div className="text-4xl mb-3">📣</div>
          <p className="text-gray-600 font-medium">No {filterType === 'all' ? '' : filterType + ' '}campaigns yet</p>
          <p className="text-gray-400 text-sm mt-1">
            {filterType === 'all'
              ? 'Create a campaign to send bulk WhatsApp messages'
              : `No ${TYPE_CONFIG[filterType]?.label} campaigns found`}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((c) => {
            const cType = (c as Campaign & { campaign_type?: string }).campaign_type || 'broadcast';
            const typeCfg = TYPE_CONFIG[cType] || TYPE_CONFIG.broadcast;
            return (
              <div key={c.id} className="card cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => router.push(`/campaigns/${c.id}`)}>
                <div className="flex flex-wrap items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-semibold text-gray-900">{c.name}</h3>
                      {/* Campaign type badge */}
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${typeCfg.bg} ${typeCfg.color}`}>
                        {typeCfg.icon}
                        {typeCfg.label}
                      </span>
                      {/* Status badge */}
                      <span className={`badge ${STATUS_COLORS[c.status] || 'bg-gray-100 text-gray-600'}`}>
                        {c.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-sm text-gray-500">Template: {c.template_name || c.template_id}</p>
                      {(c as Campaign & { template_status?: string }).template_status && (c as Campaign & { template_status?: string }).template_status !== 'APPROVED' && (() => {
                        const ts = (c as Campaign & { template_status?: string }).template_status!;
                        const cfg: Record<string, { bg: string; text: string; label: string }> = {
                          PAUSED:   { bg: 'bg-orange-100', text: 'text-orange-700', label: '⏸ Paused' },
                          PENDING:  { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '⏳ Pending' },
                          REJECTED: { bg: 'bg-red-100',    text: 'text-red-700',    label: '✗ Rejected' },
                        };
                        const c2 = cfg[ts];
                        return c2 ? (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c2.bg} ${c2.text}`}>
                            {c2.label}
                          </span>
                        ) : null;
                      })()}
                    </div>
                    {c.scheduled_at && (
                      <p className="text-sm text-gray-400 mt-0.5">
                        Scheduled: {new Date(c.scheduled_at).toLocaleString()}
                      </p>
                    )}
                  </div>

                  {/* Stats — counts from campaign_contacts (accurate) */}
                  <div className="flex gap-6 text-sm">
                    {[
                      { label: 'Total',     value: c.total_contacts,  color: 'text-gray-900'   },
                      { label: 'Sent',      value: ccSent(c),         color: 'text-blue-600'   },
                      { label: 'Delivered', value: deliveryRate(c),   color: 'text-green-600'  },
                      { label: 'Read',      value: readRate(c),       color: 'text-purple-600' },
                      { label: 'Failed',    value: ccFailed(c),       color: 'text-red-600'    },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="text-center">
                        <p className={`font-semibold ${color}`}>{value}</p>
                        <p className="text-gray-400 text-xs">{label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {cType === 'api' ? (
                      <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 flex items-center gap-1">
                        <Zap size={12} /> Call via API
                      </span>
                    ) : (c.status === 'draft' || c.status === 'scheduled') && (
                      <button onClick={() => launch(c.id)}
                        className="btn-primary flex items-center gap-1 text-sm px-3 py-1.5">
                        <Play size={14} /> Launch
                      </button>
                    )}
                    {/* Assign Agent — admin/manager only */}
                    {['admin','manager'].includes(userRole) && (
                      <button
                        onClick={() => setAssignCampaign(c)}
                        title="Assign to agent"
                        className="p-1.5 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                        <UserPlus size={15} />
                      </button>
                    )}
                    {userRole !== 'agent' && (
                      <button
                        onClick={() => deleteCampaign(c.id, c.name)}
                        disabled={deletingId === c.id || c.status === 'running'}
                        title={c.status === 'running' ? 'Cannot delete a running campaign' : 'Delete campaign'}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                        {deletingId === c.id
                          ? <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                          : <Trash2 size={15} />}
                      </button>
                    )}
                    <ChevronRight size={16} className="text-gray-300" />
                  </div>
                </div>

                {/* Progress bar for running campaign */}
                {c.status === 'running' && c.total_contacts > 0 && (
                  <div className="mt-4">
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-whatsapp-green rounded-full transition-all"
                        style={{ width: `${Math.round(((ccSent(c) + ccFailed(c)) / c.total_contacts) * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1 text-right">
                      {ccSent(c) + ccFailed(c)}/{c.total_contacts} processed
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <CampaignModal onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />
      )}

      {assignCampaign && (
        <AssignAgentModal
          campaign={assignCampaign}
          onClose={() => setAssignCampaign(null)}
        />
      )}
    </div>
  );
}

// ---- Assign Agent Modal ----
function AssignAgentModal({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const [agents, setAgents]         = useState<User[]>([]);
  const [assigned, setAssigned]     = useState<number[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState<number | null>(null);
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';

  useEffect(() => {
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch('/api/agents', { headers }).then((r) => r.json()),
      fetch(`/api/campaigns/${campaign.id}/assign`, { headers }).then((r) => r.json()),
    ]).then(([agentsRes, assignedRes]) => {
      setAgents(agentsRes.data || []);
      setAssigned((assignedRes.data || []).map((a: { id: number }) => a.id));
      setLoading(false);
    });
  }, [campaign.id, token]);

  async function toggle(agentId: number, isAssigned: boolean) {
    setSaving(agentId);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/assign`, {
        method: isAssigned ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ agent_id: agentId }),
      });
      if (res.ok) {
        setAssigned((prev) =>
          isAssigned ? prev.filter((id) => id !== agentId) : [...prev, agentId]
        );
        toast.success(isAssigned ? 'Agent removed' : 'Campaign assigned!');
      }
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Assign Agents</h2>
            <p className="text-xs text-gray-400 mt-0.5">{campaign.name}</p>
          </div>
          <button onClick={onClose}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
        </div>

        <div className="p-4">
          {loading ? (
            <p className="text-center text-gray-400 py-8 text-sm">Loading agents…</p>
          ) : agents.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-sm">
              No agents found. Create agents from the Agents page first.
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {agents.map((agent) => {
                const isAssigned = assigned.includes(agent.id);
                const isSaving   = saving === agent.id;
                return (
                  <div key={agent.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-colors ${
                      isAssigned ? 'border-whatsapp-green bg-green-50' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                    <div className="w-9 h-9 rounded-full bg-whatsapp-teal text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                      {agent.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{agent.name}</p>
                      <p className="text-xs text-gray-400 truncate">{agent.email}</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${
                      agent.role === 'manager' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                    }`}>{agent.role}</span>
                    <button
                      onClick={() => toggle(agent.id, isAssigned)}
                      disabled={isSaving}
                      className={`ml-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        isAssigned
                          ? 'bg-red-50 text-red-500 hover:bg-red-100'
                          : 'bg-whatsapp-green text-white hover:bg-green-600'
                      } disabled:opacity-50`}
                    >
                      {isSaving ? '…' : isAssigned ? 'Remove' : 'Assign'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 pb-4">
          <button onClick={onClose} className="w-full btn-secondary text-sm">Done</button>
        </div>
      </div>
    </div>
  );
}

// ── Simple CSV parser ─────────────────────────────────────────
function parseCsv(text: string): string[][] {
  return text.trim().split('\n').map((line) =>
    line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '').trim())
  );
}

// ---- Campaign Creation Modal ----
function CampaignModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [templates, setTemplates]       = useState<Template[]>([]);
  const [contacts, setContacts]         = useState<Contact[]>([]);
  const [selectedIds, setSelectedIds]   = useState<number[]>([]);
  const [createdId, setCreatedId]       = useState<number | null>(null);
  const [templateCategory, setTemplateCategory] = useState<string>('ALL');
  const [templateSearch, setTemplateSearch]     = useState<string>('');
  const [templateDropOpen, setTemplateDropOpen] = useState(false);
  const templateDropRef                         = useRef<HTMLDivElement>(null);
  const fileRef                                 = useRef<HTMLInputElement>(null);
  const [contactMode, setContactMode]   = useState<'select' | 'csv'>('select');
  const [contactSearch, setContactSearch] = useState('');
  const [contactSearchLoading, setContactSearchLoading] = useState(false);
  const contactDebounceRef              = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [csvRows, setCsvRows]           = useState<{ phone: string; name: string; vars: Record<string, string> }[]>([]);
  const [csvHeaders, setCsvHeaders]     = useState<string[]>([]);
  const [csvColMap, setCsvColMap]       = useState<Record<string, string>>({});
  const [csvError, setCsvError]         = useState('');
  const [form, setForm]                 = useState({
    name: '', template_id: '', scheduled_at: '', campaign_type: 'broadcast',
  });
  const [templateVars, setTemplateVars]   = useState<Record<string, string>>({});
  const [headerMedia, setHeaderMedia]     = useState('');   // URL entered by user
  const [headerMediaMode, setHeaderMediaMode] = useState<'url' | 'upload'>('url');
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const headerFileRef                     = useRef<HTMLInputElement>(null);
  const [saving, setSaving]               = useState(false);

  const isApi       = form.campaign_type === 'api';
  const isBroadcast = form.campaign_type === 'broadcast';
  const selTpl      = templates.find((t) => String(t.id) === form.template_id);
  const varNums     = selTpl ? [...new Set(
    (selTpl.body_text?.match(/\{\{(\d+)\}\}/g) || []).map((m) => m.replace(/\{\{|\}\}/g, ''))
  )].sort((a, b) => Number(a) - Number(b)) : [];
  const hasMediaHeader = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes((selTpl?.header_type || '').toUpperCase());

  // Close template dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (templateDropRef.current && !templateDropRef.current.contains(e.target as Node)) {
        setTemplateDropOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    apiFetch('/api/templates').then((r) => setTemplates(r.data?.filter((t: Template) => t.status === 'APPROVED') || []));
    if (!isApi) loadContacts('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.campaign_type]);

  function loadContacts(q: string) {
    setContactSearchLoading(true);
    const qs = q.trim() ? `&search=${encodeURIComponent(q.trim())}` : '';
    apiFetch(`/api/contacts?limit=500${qs}`)
      .then((r) => setContacts(r.data?.data || []))
      .finally(() => setContactSearchLoading(false));
  }

  useEffect(() => {
    if (contactDebounceRef.current) clearTimeout(contactDebounceRef.current);
    contactDebounceRef.current = setTimeout(() => loadContacts(contactSearch), 350);
    return () => { if (contactDebounceRef.current) clearTimeout(contactDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactSearch]);

  function toggleContact(id: number) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function handleCsvFile(file: File) {
    setCsvError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseCsv(text);
      if (rows.length < 2) { setCsvError('CSV must have a header row + at least one data row'); return; }
      const headers = rows[0];
      const phoneCol = headers.findIndex((h) => /phone|mobile|number|whatsapp/i.test(h));
      const nameCol  = headers.findIndex((h) => /name/i.test(h));
      if (phoneCol < 0) { setCsvError('CSV must have a column named "phone", "mobile", or "number"'); return; }
      setCsvHeaders(headers);
      // Default mapping: first non-phone/name column → {{1}}, next → {{2}}, etc.
      const extraCols = headers.map((h, i) => i).filter((i) => i !== phoneCol && i !== nameCol);
      const initMap: Record<string, string> = {};
      varNums.forEach((n, idx) => { if (extraCols[idx] !== undefined) initMap[n] = String(extraCols[idx]); });
      setCsvColMap(initMap);
      const parsed = rows.slice(1).filter((r) => r[phoneCol]?.trim()).map((r) => ({
        phone: r[phoneCol].replace(/\D/g, ''),
        name:  nameCol >= 0 ? r[nameCol] || '' : '',
        vars:  Object.fromEntries(headers.map((_, i) => [String(i), r[i] || ''])),
      }));
      setCsvRows(parsed);
    };
    reader.readAsText(file);
  }

  async function uploadHeaderFile(file: File) {
    setUploadingHeader(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = localStorage.getItem('token');
      const res = await fetch('/api/media', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      // Store as media_id reference
      setHeaderMedia(`media_id:${data.data.mediaId}`);
      toast.success('Media uploaded!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingHeader(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!isApi && contactMode === 'select' && selectedIds.length === 0) {
      toast.error('Select at least one contact');
      return;
    }
    if (!isApi && contactMode === 'csv' && csvRows.length === 0) {
      toast.error('Upload a CSV file with contacts');
      return;
    }
    setSaving(true);
    try {
      // Build contact_ids and per-row vars for CSV mode
      let contact_ids: number[] = [];
      let csv_contacts: { phone: string; name: string; vars: Record<string, string> }[] | undefined;

      if (isBroadcast && contactMode === 'csv') {
        csv_contacts = csvRows.map((row) => ({
          phone: row.phone,
          name:  row.name,
          vars:  Object.fromEntries(varNums.map((n) => [n, row.vars[csvColMap[n] || ''] || templateVars[n] || ''])),
        }));
      } else if (!isApi) {
        contact_ids = selectedIds;
      }

      const r = await apiFetch('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name:          form.name,
          template_id:   Number(form.template_id),
          scheduled_at:  form.scheduled_at || undefined,
          campaign_type: form.campaign_type,
          contact_ids,
          template_vars: templateVars,
          header_media:  headerMedia || undefined,
          csv_contacts,
        }),
      });
      if (isApi) {
        setCreatedId(r.data?.id);
      } else {
        toast.success('Campaign created!');
        onSaved();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  const apiEndpoint = typeof window !== 'undefined'
    ? `${window.location.origin}/api/campaigns/${createdId}/send`
    : `/api/campaigns/${createdId}/send`;

  // ── After API campaign created: show endpoint info ──────────
  if (createdId) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
          <div className="p-6 border-b border-gray-200 flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <h2 className="font-bold text-lg">API Campaign Created!</h2>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-600">
              Use this endpoint to send messages from your backend/system:
            </p>

            <div className="bg-gray-900 rounded-lg p-4 text-xs font-mono text-green-400 space-y-1 overflow-x-auto">
              <p className="text-gray-400">POST {apiEndpoint}</p>
              <p className="text-gray-400">Authorization: Bearer YOUR_JWT_TOKEN</p>
              <p className="text-gray-400">Content-Type: application/json</p>
              <br />
              <p>{'{'}</p>
              <p>&nbsp;&nbsp;&quot;phone&quot;: &quot;919876543210&quot;,</p>
              <p>&nbsp;&nbsp;&quot;variables&quot;: {'{'}&quot;1&quot;: &quot;John&quot;, &quot;2&quot;: &quot;Order#123&quot;{'}'}</p>
              <p>{'}'}</p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 space-y-1">
              <p><strong>phone</strong> — recipient number with country code (no +)</p>
              <p><strong>variables</strong> — template variables like {`{{1}}`}, {`{{2}}`}</p>
            </div>

            <div className="flex gap-3">
              <button onClick={() => { navigator.clipboard.writeText(`POST ${apiEndpoint}`); toast.success('Copied!'); }}
                className="btn-secondary flex-1 text-sm">Copy URL</button>
              <button onClick={onSaved} className="btn-primary flex-1 text-sm">Done</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h2 className="font-bold text-lg">New Campaign</h2>
        </div>
        <form onSubmit={save} className="p-6 space-y-4 overflow-y-auto flex-1">

          {/* Campaign Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input" placeholder="e.g. Diwali Offer 2024" required />
          </div>

          {/* Campaign Type — only Broadcast and API */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Type *</label>
            <div className="grid grid-cols-2 gap-2">
              {(['broadcast', 'api'] as const).map((key) => {
                const cfg = TYPE_CONFIG[key];
                return (
                  <label key={key} className={`flex items-start gap-2.5 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                    form.campaign_type === key ? 'border-whatsapp-green bg-green-50' : 'border-gray-200 hover:border-gray-300'
                  }`}>
                    <input type="radio" name="campaign_type" value={key}
                      checked={form.campaign_type === key}
                      onChange={() => { setForm({ ...form, campaign_type: key }); setContactMode('select'); }}
                      className="mt-0.5 accent-green-600" />
                    <div>
                      <div className={`flex items-center gap-1 text-sm font-medium ${cfg.color}`}>
                        {cfg.icon} {cfg.label}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{cfg.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Template picker (same as before — with category filter + search) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Template * (Approved only)</label>
            <div className="relative" ref={templateDropRef}>
              <button type="button" onClick={() => setTemplateDropOpen((v) => !v)}
                className="input w-full flex items-center justify-between text-left">
                <span className={form.template_id ? 'text-gray-900' : 'text-gray-400'}>
                  {selTpl ? selTpl.name : 'Select template…'}
                </span>
                <ChevronDown size={15} className={`text-gray-400 flex-shrink-0 transition-transform ${templateDropOpen ? 'rotate-180' : ''}`} />
              </button>
              {templateDropOpen && (
                <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                  <div className="p-2 border-b border-gray-100 flex items-center gap-2">
                    <Search size={14} className="text-gray-400 flex-shrink-0" />
                    <input autoFocus type="text" value={templateSearch}
                      onChange={(e) => setTemplateSearch(e.target.value)}
                      placeholder="Search template…" className="flex-1 text-sm outline-none bg-transparent" />
                    {templateSearch && <button type="button" onClick={() => setTemplateSearch('')}><X size={13} className="text-gray-400 hover:text-gray-600" /></button>}
                  </div>
                  <div className="flex gap-1.5 px-2 py-1.5 border-b border-gray-100 flex-wrap">
                    {(['ALL', 'UTILITY', 'MARKETING', 'AUTHENTICATION'] as const).map((cat) => (
                      <button key={cat} type="button" onClick={() => setTemplateCategory(cat)}
                        className={`px-2 py-0.5 rounded-md text-xs font-semibold border transition-colors
                          ${templateCategory === cat ? 'bg-whatsapp-green text-white border-whatsapp-green' : 'bg-white text-gray-500 border-gray-200 hover:border-whatsapp-green'}`}>
                        {cat === 'ALL' ? 'All' : cat.charAt(0) + cat.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                  <ul className="max-h-52 overflow-y-auto">
                    {templates.filter((t) =>
                      (templateCategory === 'ALL' || t.category === templateCategory) &&
                      t.name.toLowerCase().includes(templateSearch.toLowerCase())
                    ).map((t) => (
                      <li key={t.id}>
                        <button type="button"
                          onClick={() => { setForm({ ...form, template_id: String(t.id) }); setTemplateDropOpen(false); setTemplateSearch(''); setTemplateVars({}); setCsvColMap({}); setHeaderMedia(''); }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between gap-2
                            ${String(t.id) === form.template_id ? 'bg-green-50 text-whatsapp-green font-semibold' : 'text-gray-700'}`}>
                          <span className="truncate">{t.name}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0
                            ${t.category === 'MARKETING' ? 'bg-orange-100 text-orange-600' : t.category === 'AUTHENTICATION' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                            {t.category.charAt(0) + t.category.slice(1).toLowerCase()}
                          </span>
                        </button>
                      </li>
                    ))}
                    {templates.filter((t) =>
                      (templateCategory === 'ALL' || t.category === templateCategory) &&
                      t.name.toLowerCase().includes(templateSearch.toLowerCase())
                    ).length === 0 && (
                      <li className="px-3 py-4 text-sm text-gray-400 text-center">No templates found</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
            {templates.length === 0 && <p className="text-xs text-red-500 mt-1">No approved templates. Create and get a template approved first.</p>}
            <input type="text" required value={form.template_id} onChange={() => {}} className="sr-only" />
          </div>

          {/* Media Header Upload — shown for Broadcast only when template has IMAGE/VIDEO/DOCUMENT header */}
          {isBroadcast && hasMediaHeader && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-blue-800 flex items-center gap-1.5">
                  {(selTpl?.header_type || '').toUpperCase() === 'IMAGE' ? '🖼️' :
                   (selTpl?.header_type || '').toUpperCase() === 'VIDEO' ? '🎥' : '📄'}{' '}
                  {selTpl?.header_type?.charAt(0) + (selTpl?.header_type || '').slice(1).toLowerCase()} Header
                </p>
                {selTpl?.header_content && (
                  <p className="text-xs text-blue-600 mt-0.5">
                    Template default: <span className="font-mono">{selTpl.header_content.slice(0, 40)}{selTpl.header_content.length > 40 ? '…' : ''}</span>
                  </p>
                )}
              </div>

              {/* URL / Upload toggle */}
              <div className="flex gap-2">
                <button type="button" onClick={() => setHeaderMediaMode('url')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border-2 transition-colors
                    ${headerMediaMode === 'url' ? 'border-blue-400 bg-blue-100 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  Enter URL
                </button>
                <button type="button" onClick={() => setHeaderMediaMode('upload')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border-2 transition-colors
                    ${headerMediaMode === 'upload' ? 'border-blue-400 bg-blue-100 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  Upload File
                </button>
              </div>

              {headerMediaMode === 'url' && (
                <input
                  value={headerMedia.startsWith('media_id:') ? '' : headerMedia}
                  onChange={(e) => setHeaderMedia(e.target.value)}
                  placeholder={`Public ${selTpl?.header_type?.toLowerCase()} URL (https://...)`}
                  className="input text-sm w-full"
                />
              )}

              {headerMediaMode === 'upload' && (
                <div>
                  <input ref={headerFileRef} type="file"
                    accept={
                      (selTpl?.header_type || '').toUpperCase() === 'IMAGE' ? 'image/*' :
                      (selTpl?.header_type || '').toUpperCase() === 'VIDEO' ? 'video/*' : '*'
                    }
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadHeaderFile(f); }} />
                  <button type="button" onClick={() => headerFileRef.current?.click()}
                    disabled={uploadingHeader}
                    className="w-full py-2 border-2 border-dashed border-blue-300 hover:border-blue-400 rounded-lg text-sm text-blue-600 font-medium transition-colors disabled:opacity-50">
                    {uploadingHeader ? 'Uploading…' : headerMedia.startsWith('media_id:') ? '✓ File uploaded — click to replace' : 'Click to upload file'}
                  </button>
                  {headerMedia.startsWith('media_id:') && (
                    <p className="text-xs text-green-600 mt-1 text-center">Media ID: {headerMedia.replace('media_id:', '')}</p>
                  )}
                </div>
              )}

              {!headerMedia && selTpl?.header_content && (
                <p className="text-xs text-blue-500">Leave blank to use template&apos;s default media.</p>
              )}
            </div>
          )}

          {/* Template Variables — Broadcast only */}
          {isBroadcast && varNums.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-amber-800">Template Variables</p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Use <code className="bg-amber-100 px-1 rounded">{'{{contact_name}}'}</code> or{' '}
                  <code className="bg-amber-100 px-1 rounded">{'{{contact_phone}}'}</code> for per-contact values.
                  {contactMode === 'csv' && ' CSV columns will override these.'}
                </p>
              </div>
              <div className="bg-[#dcf8c6] rounded-xl px-3 py-2 text-xs text-gray-800 whitespace-pre-wrap break-words">
                {selTpl?.body_text?.replace(/\{\{(\d+)\}\}/g, (_, n) => templateVars[n] ? `[${templateVars[n]}]` : `{{${n}}}`)}
              </div>
              {varNums.map((n) => (
                <div key={n} className="flex items-center gap-2">
                  <span className="text-xs font-mono text-amber-700 w-8 shrink-0 text-right">{`{{${n}}}`}</span>
                  <input value={templateVars[n] || ''} onChange={(e) => setTemplateVars((p) => ({ ...p, [n]: e.target.value }))}
                    placeholder={`Value for {{${n}}} — e.g. "Dear Customer" or {{contact_name}}`} className="input text-sm flex-1" />
                </div>
              ))}
            </div>
          )}

          {/* API type */}
          {isApi && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold text-blue-800 flex items-center gap-2">
                <Zap size={14} /> API Campaign — No contacts needed
              </p>
              <p className="text-xs text-blue-600">
                After creating the campaign, an API endpoint will be provided. You can also use Bulk Send from the campaign detail page.
              </p>
            </div>
          )}

          {/* Broadcast: contacts section */}
          {isBroadcast && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Schedule (optional)</label>
                <input type="datetime-local" value={form.scheduled_at}
                  onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} className="input" />
              </div>

              {/* Toggle: Select Contacts / Upload CSV */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Contacts *</label>
                <div className="flex gap-2 mb-3">
                  <button type="button" onClick={() => setContactMode('select')}
                    className={`flex-1 py-2 text-sm font-semibold rounded-lg border-2 transition-colors
                      ${contactMode === 'select' ? 'border-whatsapp-green bg-green-50 text-whatsapp-green' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                    Select Contacts
                  </button>
                  <button type="button" onClick={() => setContactMode('csv')}
                    className={`flex-1 py-2 text-sm font-semibold rounded-lg border-2 transition-colors
                      ${contactMode === 'csv' ? 'border-whatsapp-green bg-green-50 text-whatsapp-green' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                    Upload CSV
                  </button>
                </div>

                {/* Select contacts list */}
                {contactMode === 'select' && (
                  <div className="space-y-2">
                    {/* Search box */}
                    <div className="relative">
                      {contactSearchLoading
                        ? <Loader2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
                        : <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />}
                      <input
                        value={contactSearch}
                        onChange={(e) => setContactSearch(e.target.value)}
                        placeholder="Search by name or phone…"
                        className="input pl-9 text-sm w-full" />
                    </div>

                    {/* Selected count + hint */}
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-500">{selectedIds.length} selected</p>
                      {!contactSearch && (
                        <p className="text-xs text-gray-400">Showing first 500 — search to find more</p>
                      )}
                    </div>

                    <div className="border border-gray-200 rounded-lg max-h-52 overflow-y-auto divide-y divide-gray-100">
                      {!contactSearch && (
                        <label className="flex items-center gap-3 px-3 py-2 bg-gray-50 cursor-pointer hover:bg-gray-100">
                          <input type="checkbox"
                            checked={contacts.length > 0 && contacts.every((c) => selectedIds.includes(c.id))}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedIds((prev) => [...new Set([...prev, ...contacts.map((c) => c.id)])]);
                              } else {
                                const shown = new Set(contacts.map((c) => c.id));
                                setSelectedIds((prev) => prev.filter((id) => !shown.has(id)));
                              }
                            }} />
                          <span className="text-sm font-medium">Select visible ({contacts.length})</span>
                        </label>
                      )}
                      {contacts.length === 0 && !contactSearchLoading && (
                        <p className="text-xs text-gray-400 px-3 py-4 text-center">No contacts found.</p>
                      )}
                      {contacts.map((c) => (
                        <label key={c.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50">
                          <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleContact(c.id)} />
                          <span className="text-sm">{c.name || c.phone} <span className="text-gray-400">+{c.phone}</span></span>
                        </label>
                      ))}
                    </div>

                    {/* Large list hint */}
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      💡 Have many contacts? Use the <strong>Upload CSV</strong> option — add all contacts at once.
                    </p>
                  </div>
                )}

                {/* CSV upload */}
                {contactMode === 'csv' && (
                  <div className="space-y-3">
                    <div
                      className="border-2 border-dashed border-gray-300 hover:border-whatsapp-green rounded-xl p-5 text-center cursor-pointer transition-colors"
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleCsvFile(f); }}>
                      <p className="text-sm font-semibold text-gray-700">Drop CSV here or click to upload</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Required: <code className="bg-gray-100 px-1 rounded">phone</code> column — Optional: <code className="bg-gray-100 px-1 rounded">name</code> + variable columns
                      </p>
                      <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); }} />
                    </div>
                    {csvError && <p className="text-xs text-red-500">{csvError}</p>}

                    {/* Column → variable mapping */}
                    {csvRows.length > 0 && varNums.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                        <p className="text-xs font-semibold text-amber-800">Map CSV Columns to Template Variables</p>
                        {varNums.map((n) => (
                          <div key={n} className="flex items-center gap-2">
                            <span className="text-xs font-mono text-amber-700 w-8 shrink-0 text-right">{`{{${n}}}`}</span>
                            <select value={csvColMap[n] ?? ''} onChange={(e) => setCsvColMap((p) => ({ ...p, [n]: e.target.value }))}
                              className="input text-sm flex-1">
                              <option value="">— use default value —</option>
                              {csvHeaders.map((h, i) => <option key={i} value={String(i)}>{h}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Preview */}
                    {csvRows.length > 0 && (
                      <div className="border border-gray-200 rounded-xl overflow-hidden">
                        <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                          <p className="text-xs font-semibold text-gray-600">{csvRows.length} contacts loaded</p>
                        </div>
                        <div className="max-h-32 overflow-y-auto divide-y divide-gray-50">
                          {csvRows.slice(0, 50).map((row, i) => (
                            <div key={i} className="px-3 py-2 flex items-center gap-3">
                              <p className="text-sm font-medium text-gray-800 w-28 shrink-0 truncate">{row.name || row.phone}</p>
                              <p className="text-xs text-gray-400">+{row.phone}</p>
                              {varNums.filter((n) => csvColMap[n]).map((n) => (
                                <span key={n} className="text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full truncate max-w-[80px]">
                                  {row.vars[csvColMap[n]] || '—'}
                                </span>
                              ))}
                            </div>
                          ))}
                          {csvRows.length > 50 && <p className="text-xs text-gray-400 text-center py-2">+{csvRows.length - 50} more</p>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Creating...' : isApi ? 'Create & Get API' : 'Create Campaign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
