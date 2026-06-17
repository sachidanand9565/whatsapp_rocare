'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { apiFetch } from '@/hooks/useApi';
import {
  ArrowLeft, Phone, Mail, IndianRupee, User, MessageSquare,
  StickyNote, PhoneCall, Calendar, ChevronDown, Save, Trash2,
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
  contact_id: number | null;
  created_at: string;
  updated_at: string;
}

interface Activity {
  id: number;
  type: string;
  description: string;
  done_by_name: string | null;
  scheduled_at: string | null;
  created_at: string;
}

const STAGES = [
  { key: 'new',         label: 'New',         color: 'bg-blue-100 text-blue-700' },
  { key: 'contacted',   label: 'Contacted',   color: 'bg-yellow-100 text-yellow-700' },
  { key: 'qualified',   label: 'Qualified',   color: 'bg-purple-100 text-purple-700' },
  { key: 'proposal',    label: 'Proposal',    color: 'bg-orange-100 text-orange-700' },
  { key: 'negotiation', label: 'Negotiation', color: 'bg-pink-100 text-pink-700' },
  { key: 'won',         label: 'Won',         color: 'bg-green-100 text-green-700' },
  { key: 'lost',        label: 'Lost',        color: 'bg-red-100 text-red-700' },
];

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  note:         <StickyNote size={14} className="text-gray-500" />,
  stage_change: <ChevronDown size={14} className="text-blue-500" />,
  call:         <PhoneCall size={14} className="text-green-500" />,
  followup:     <Calendar size={14} className="text-orange-500" />,
  assigned:     <User size={14} className="text-purple-500" />,
  message:      <MessageSquare size={14} className="text-whatsapp-teal" />,
};

const ACTIVITY_TYPES = [
  { value: 'note',     label: 'Note' },
  { value: 'call',     label: 'Call' },
  { value: 'followup', label: 'Follow-up' },
  { value: 'message',  label: 'Message' },
];

export default function LeadDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [lead, setLead]           = useState<Lead | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [form, setForm]           = useState<Partial<Lead>>({});
  const [dirty, setDirty]         = useState(false);

  const [actType, setActType]     = useState('note');
  const [actDesc, setActDesc]     = useState('');
  const [actDate, setActDate]     = useState('');
  const [addingAct, setAddingAct] = useState(false);

  const loadLead = useCallback(() => {
    apiFetch(`/api/leads/${id}`)
      .then((r) => {
        setLead(r.data);
        setForm(r.data);
      })
      .catch(() => toast.error('Failed to load lead'))
      .finally(() => setLoading(false));
  }, [id]);

  const loadActivities = useCallback(() => {
    apiFetch(`/api/leads/${id}/activities`)
      .then((r) => setActivities(r.data || []))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    loadLead();
    loadActivities();
  }, [loadLead, loadActivities]);

  function handleChange(key: keyof Lead, value: string | number | null) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  async function saveChanges() {
    setSaving(true);
    try {
      await apiFetch(`/api/leads/${id}`, { method: 'PATCH', body: JSON.stringify(form) });
      toast.success('Saved');
      setDirty(false);
      loadActivities();
    } catch {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function addActivity() {
    if (!actDesc.trim()) { toast.error('Description required'); return; }
    setAddingAct(true);
    try {
      await apiFetch(`/api/leads/${id}/activities`, {
        method: 'POST',
        body: JSON.stringify({ type: actType, description: actDesc, scheduled_at: actDate || null }),
      });
      toast.success('Activity added');
      setActDesc('');
      setActDate('');
      loadActivities();
    } catch {
      toast.error('Failed to add activity');
    } finally {
      setAddingAct(false);
    }
  }

  async function deleteLead() {
    if (!confirm('Delete this lead permanently?')) return;
    await apiFetch(`/api/leads/${id}`, { method: 'DELETE' });
    toast.success('Lead deleted');
    router.push('/leads');
  }

  const stageInfo = (key: string) => STAGES.find((s) => s.key === key) || STAGES[0];
  const currentStage = stageInfo(form.stage || 'new');

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;
  }
  if (!lead) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Lead not found</div>;
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/leads')} className="text-gray-400 hover:text-gray-700 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{lead.name || lead.phone || 'Unnamed Lead'}</h1>
            <p className="text-xs text-gray-400">
              Created {new Date(lead.created_at).toLocaleDateString('en-IN')}
              {lead.assigned_name && ` · Assigned to ${lead.assigned_name}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lead.phone && (
            <a
              href={`/inbox?phone=${lead.phone}`}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <MessageSquare size={15} /> Open Chat
            </a>
          )}
          {dirty && (
            <button onClick={saveChanges} disabled={saving} className="btn-primary flex items-center gap-2 text-sm">
              <Save size={15} /> {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
          <button onClick={deleteLead} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ─── Left: Lead Info ─── */}
        <div className="space-y-4">
          {/* Stage selector */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Pipeline Stage</p>
            <div className="flex flex-wrap gap-2">
              {STAGES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => handleChange('stage', s.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border-2
                    ${form.stage === s.key
                      ? `${s.color} border-current scale-105 shadow-sm`
                      : 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Contact Info */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact Info</p>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Full Name</label>
              <input
                value={form.name || ''}
                onChange={(e) => handleChange('name', e.target.value)}
                className="input w-full text-sm"
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Phone</label>
              <div className="relative">
                <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={form.phone || ''}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  className="input w-full text-sm pl-8"
                  placeholder="919876543210"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Email</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={form.email || ''}
                  onChange={(e) => handleChange('email', e.target.value)}
                  className="input w-full text-sm pl-8"
                  placeholder="email@example.com"
                />
              </div>
            </div>
          </div>

          {/* Deal Info */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Deal Info</p>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Deal Value (₹)</label>
              <div className="relative">
                <IndianRupee size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="number"
                  value={form.deal_value ?? ''}
                  onChange={(e) => handleChange('deal_value', e.target.value ? Number(e.target.value) : null)}
                  className="input w-full text-sm pl-8"
                  placeholder="e.g. 50000"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Source</label>
              <select
                value={form.source || 'manual'}
                onChange={(e) => handleChange('source', e.target.value)}
                className="input w-full text-sm"
              >
                <option value="manual">Manual</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="scraper">Scraper</option>
                <option value="campaign">Campaign</option>
                <option value="flow">Flow</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Notes</label>
              <textarea
                value={form.notes || ''}
                onChange={(e) => handleChange('notes', e.target.value)}
                rows={3}
                className="input w-full text-sm resize-none"
                placeholder="Lead notes..."
              />
            </div>
          </div>
        </div>

        {/* ─── Right: Activities ─── */}
        <div className="flex flex-col gap-4">
          {/* Add Activity */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add Activity</p>
            <div className="flex gap-2">
              {ACTIVITY_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setActType(t.value)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors
                    ${actType === t.value ? 'bg-whatsapp-teal text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              value={actDesc}
              onChange={(e) => setActDesc(e.target.value)}
              placeholder={actType === 'call' ? 'Call summary...' : actType === 'followup' ? 'Follow-up details...' : 'Write a note...'}
              rows={3}
              className="input w-full text-sm resize-none"
            />
            {actType === 'followup' && (
              <input
                type="datetime-local"
                value={actDate}
                onChange={(e) => setActDate(e.target.value)}
                className="input w-full text-sm"
              />
            )}
            <button
              onClick={addActivity}
              disabled={addingAct || !actDesc.trim()}
              className="btn-primary w-full text-sm"
            >
              {addingAct ? 'Adding...' : 'Add Activity'}
            </button>
          </div>

          {/* Activity Timeline */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Activity Timeline ({activities.length})
            </p>
            {activities.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No activities yet</p>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {activities.map((act) => (
                  <div key={act.id} className="flex gap-3">
                    <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      {ACTIVITY_ICONS[act.type] || <StickyNote size={14} className="text-gray-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 leading-snug">{act.description}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-gray-400">
                          {new Date(act.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                        {act.done_by_name && (
                          <span className="text-[10px] text-gray-400">· {act.done_by_name}</span>
                        )}
                        {act.scheduled_at && (
                          <span className="text-[10px] text-orange-500">· Due {new Date(act.scheduled_at).toLocaleDateString('en-IN')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
