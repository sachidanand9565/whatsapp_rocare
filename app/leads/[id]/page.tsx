'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { apiFetch } from '@/hooks/useApi';
import {
  ArrowLeft, Phone, Mail, IndianRupee, MessageSquare,
  StickyNote, PhoneCall, Calendar, ChevronDown, Save, Trash2,
  Send, X, User,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Lead {
  id: number; name: string; phone: string; email: string;
  source: string; stage: string; assigned_to: number | null;
  assigned_name: string | null; deal_value: number | null;
  notes: string; contact_id: number | null;
  created_at: string; updated_at: string;
}

interface Activity {
  id: number; type: string; description: string;
  done_by_name: string | null; scheduled_at: string | null; created_at: string;
}

interface Message {
  id: number; direction: 'inbound' | 'outbound'; type: string;
  content: string; status: string; sent_at: string; created_at: string;
}

// ── Message parsers ──────────────────────────────────────────
interface TplContent {
  __type: 'template'; template_name: string; header_type: string;
  header_content: string; body: string; footer: string;
  buttons: { type: string; text: string }[];
}
interface BtnContent { __type: 'buttons'; body: string; footer?: string; buttons: { id: string; title: string }[] }
interface MediaContent { __type: 'media'; media_id: string; mime_type?: string; caption?: string; workspace_id: number }

function parseTpl(c: string): TplContent | null {
  try { const p = JSON.parse(c); if (p.__type === 'template') return p; } catch { /**/ } return null;
}
function parseBtn(c: string): BtnContent | null {
  try { const p = JSON.parse(c); if (p.__type === 'buttons') return p; } catch { /**/ } return null;
}
function parseMedia(c: string): MediaContent | null {
  try { const p = JSON.parse(c); if (p.__type === 'media' && p.media_id) return p; } catch { /**/ } return null;
}

function renderWAText(text: string) {
  return text.split('\n').map((line, li, arr) => {
    const parts: React.ReactNode[] = [];
    const re = /(\*[^*\n]+\*|_[^_\n]+_)/g;
    let last = 0, k = 0, m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      const raw = m[0], inner = raw.slice(1, -1);
      parts.push(raw[0] === '*' ? <strong key={k++}>{inner}</strong> : <em key={k++}>{inner}</em>);
      last = m.index + raw.length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return <span key={li}>{parts}{li < arr.length - 1 && <br />}</span>;
  });
}

function TemplateBubble({ data, time, status }: { data: TplContent; time: string; status: string }) {
  return (
    <div className="w-72 rounded-2xl rounded-br-sm overflow-hidden shadow-sm border border-green-100">
      {data.header_type === 'IMAGE' && data.header_content?.startsWith('http') && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.header_content} alt="header" className="w-full max-h-48 object-cover" />
      )}
      {data.header_type === 'TEXT' && data.header_content && (
        <div className="bg-gray-100 px-3 py-2">
          <p className="font-bold text-gray-800 text-sm">{data.header_content}</p>
        </div>
      )}
      <div className="bg-[#dcf8c6] px-3 py-2.5">
        <p className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">
          {renderWAText(data.body)}
        </p>
        {data.footer && <p className="text-xs text-gray-400 mt-1">{data.footer}</p>}
        <p className="text-[10px] text-gray-400 text-right mt-1">
          {time} <span className={status === 'read' ? 'text-blue-500' : 'text-gray-400'}>{status === 'read' || status === 'delivered' ? '✓✓' : '✓'}</span>
        </p>
      </div>
      {data.buttons?.length > 0 && (
        <div className="divide-y divide-gray-200 border-t border-gray-200">
          {data.buttons.map((btn, i) => (
            <div key={i} className="bg-white px-3 py-2 text-center text-sm font-medium text-[#00a5f4]">{btn.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function MsgBubble({ msg }: { msg: Message }) {
  const isOut = msg.direction === 'outbound';
  const time  = toDate(msg.sent_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const tick  = <span className={msg.status === 'read' ? 'text-blue-400' : 'text-white/50'}>{msg.status === 'read' || msg.status === 'delivered' ? ' ✓✓' : ' ✓'}</span>;

  // System event (intervened / closed / reopened)
  const isSystem = msg.type === 'system' ||
    msg.content?.startsWith('Intervened by ') || msg.content?.startsWith('Closed by ') ||
    msg.content?.startsWith('Reopened by ')   || msg.content?.startsWith('Transferred to ');
  if (isSystem) {
    return (
      <div className="flex items-center justify-center my-2">
        <span className="bg-gray-200/80 text-gray-500 text-xs px-4 py-1.5 rounded-full shadow-sm">
          {msg.content}
        </span>
      </div>
    );
  }

  // Template
  const tpl = parseTpl(msg.content);
  if (tpl) return (
    <div className="flex justify-end"><TemplateBubble data={tpl} time={time} status={msg.status} /></div>
  );

  // Interactive buttons (inbound list/button reply)
  const btn = parseBtn(msg.content);
  if (btn) return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div className="w-64 rounded-2xl overflow-hidden shadow-sm border border-gray-200">
        <div className={`px-3 py-2.5 ${isOut ? 'bg-[#dcf8c6]' : 'bg-white'}`}>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{btn.body}</p>
          {btn.footer && <p className="text-xs text-gray-400 mt-1">{btn.footer}</p>}
          <p className="text-[10px] text-gray-400 text-right mt-1">{time}{isOut && tick}</p>
        </div>
        <div className="divide-y divide-gray-100 border-t border-gray-200">
          {btn.buttons.map((b, i) => (
            <div key={i} className="bg-white px-3 py-1.5 text-center text-sm font-medium text-[#00a5f4]">{b.title}</div>
          ))}
        </div>
      </div>
    </div>
  );

  // Button reply (inbound)
  if (msg.type === 'button') {
    const text = (() => { try { const p = JSON.parse(msg.content); return p.text || p.payload || msg.content; } catch { return msg.content; } })();
    return (
      <div className="flex justify-start">
        <div className="bg-white border border-[#00a5f4] rounded-2xl rounded-tl-sm px-3 py-2 max-w-[75%] shadow-sm">
          <p className="text-sm text-[#00a5f4] font-medium">{text}</p>
          <p className="text-[10px] text-gray-400 text-right mt-0.5">{time}</p>
        </div>
      </div>
    );
  }

  // Interactive reply
  if (msg.type === 'interactive') {
    const text = (() => { try { const p = JSON.parse(msg.content); return p.title || p.description || msg.content; } catch { return msg.content; } })();
    return (
      <div className="flex justify-start">
        <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-3 py-2 max-w-[75%] shadow-sm">
          <p className="text-sm text-gray-700">📋 {text}</p>
          <p className="text-[10px] text-gray-400 text-right mt-0.5">{time}</p>
        </div>
      </div>
    );
  }

  // Media
  const media = parseMedia(msg.content);
  if (media) {
    const src = `/api/media/${media.media_id}?workspaceId=${media.workspace_id}`;
    const mime = media.mime_type || '';
    return (
      <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[75%] rounded-2xl overflow-hidden shadow-sm ${isOut ? 'rounded-br-sm' : 'rounded-tl-sm'}`}>
          {mime.startsWith('image') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="img" className="max-w-[240px] max-h-56 object-cover" />
          ) : mime.startsWith('audio') ? (
            <div className={`px-3 py-2 ${isOut ? 'bg-[#dcf8c6]' : 'bg-white border border-gray-200'}`}>
              <audio src={src} controls className="w-48 h-8" />
              <p className="text-[10px] text-gray-400 text-right mt-1">{time}{isOut && tick}</p>
            </div>
          ) : (
            <div className={`px-3 py-2 ${isOut ? 'bg-[#dcf8c6]' : 'bg-white border border-gray-200'}`}>
              <a href={src} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                📎 {media.caption || 'File'}
              </a>
              <p className="text-[10px] text-gray-400 text-right mt-1">{time}{isOut && tick}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Plain text
  const text = (() => { try { const p = JSON.parse(msg.content); return p.body || p.text || msg.content; } catch { return msg.content; } })();
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] px-3 py-2 shadow-sm text-sm break-words whitespace-pre-wrap
        ${isOut
          ? 'bg-[#dcf8c6] text-gray-800 rounded-2xl rounded-br-sm'
          : 'bg-white text-gray-800 rounded-2xl rounded-tl-sm border border-gray-100'}`}>
        {renderWAText(text)}
        <p className={`text-[10px] text-right mt-0.5 ${isOut ? 'text-gray-400' : 'text-gray-400'}`}>
          {time}{isOut && tick}
        </p>
      </div>
    </div>
  );
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
  note:         <StickyNote size={13} className="text-gray-500" />,
  stage_change: <ChevronDown size={13} className="text-blue-500" />,
  call:         <PhoneCall size={13} className="text-green-500" />,
  followup:     <Calendar size={13} className="text-orange-500" />,
  assigned:     <User size={13} className="text-purple-500" />,
  message:      <MessageSquare size={13} className="text-whatsapp-teal" />,
};

function toDate(ts: string) {
  if (!ts) return new Date();
  return new Date(ts.includes('Z') || ts.includes('+') ? ts : ts.replace(' ', 'T') + 'Z');
}

export default function LeadDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [lead, setLead]             = useState<Lead | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [form, setForm]             = useState<Partial<Lead>>({});
  const [dirty, setDirty]           = useState(false);

  const [actType, setActType]   = useState('note');
  const [actDesc, setActDesc]   = useState('');
  const [actDate, setActDate]   = useState('');
  const [addingAct, setAddingAct] = useState(false);

  // ── Chat panel ──
  const [chatOpen, setChatOpen]     = useState(false);
  const [contactId, setContactId]   = useState<number | null>(null);
  const [messages, setMessages]     = useState<Message[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [msgText, setMsgText]       = useState('');
  const [sending, setSending]       = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const loadLead = useCallback(() => {
    apiFetch(`/api/leads/${id}`)
      .then((r) => { setLead(r.data); setForm(r.data); })
      .catch(() => toast.error('Failed to load lead'))
      .finally(() => setLoading(false));
  }, [id]);

  const loadActivities = useCallback(() => {
    apiFetch(`/api/leads/${id}/activities`)
      .then((r) => setActivities(r.data || []))
      .catch(() => {});
  }, [id]);

  useEffect(() => { loadLead(); loadActivities(); }, [loadLead, loadActivities]);

  // scroll chat to bottom on new messages
  useEffect(() => {
    if (chatOpen) chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatOpen]);

  async function openChat() {
    if (!lead?.phone) return;
    setChatOpen(true);
    setChatLoading(true);
    try {
      // find contact by phone
      const cr = await apiFetch(`/api/contacts?search=${lead.phone}&limit=1`);
      const contact = cr.data?.data?.[0];
      if (!contact) { toast.error('Contact not found in inbox'); setChatOpen(false); return; }
      setContactId(contact.id);
      // load messages
      const mr = await apiFetch(`/api/messages?contactId=${contact.id}&limit=80`);
      setMessages(mr.data || []);
    } catch (e: unknown) {
      toast.error((e as Error).message || 'Failed to load chat');
      setChatOpen(false);
    } finally {
      setChatLoading(false);
    }
  }

  async function sendMessage() {
    if (!msgText.trim() || !contactId || sending) return;
    setSending(true);
    const text = msgText.trim();
    setMsgText('');
    try {
      await apiFetch('/api/send-message', {
        method: 'POST',
        body: JSON.stringify({ contactId, type: 'text', text }),
      });
      // optimistic add
      setMessages((prev) => [...prev, {
        id: Date.now(), direction: 'outbound', type: 'text',
        content: text, status: 'sent',
        sent_at: new Date().toISOString(), created_at: new Date().toISOString(),
      }]);
    } catch (e: unknown) {
      toast.error((e as Error).message || 'Send failed');
      setMsgText(text);
    } finally {
      setSending(false);
    }
  }

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
    } catch { toast.error('Save failed'); }
    finally { setSaving(false); }
  }

  async function addActivity() {
    if (!actDesc.trim()) { toast.error('Description required'); return; }
    setAddingAct(true);
    try {
      await apiFetch(`/api/leads/${id}/activities`, {
        method: 'POST',
        body: JSON.stringify({ type: actType, description: actDesc, scheduled_at: actDate || null }),
      });
      toast.success('Added');
      setActDesc(''); setActDate('');
      loadActivities();
    } catch { toast.error('Failed'); }
    finally { setAddingAct(false); }
  }

  async function deleteLead() {
    if (!confirm('Delete this lead permanently?')) return;
    await apiFetch(`/api/leads/${id}`, { method: 'DELETE' });
    toast.success('Lead deleted');
    router.push('/leads');
  }

  const stageInfo = (key: string) => STAGES.find((s) => s.key === key) || STAGES[0];

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;
  if (!lead)   return <div className="flex items-center justify-center h-64 text-gray-400">Lead not found</div>;

  return (
    <div className="space-y-4 max-w-5xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/leads')} className="text-gray-400 hover:text-gray-700">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{lead.name || lead.phone || 'Unnamed Lead'}</h1>
            <p className="text-xs text-gray-400">
              Created {new Date(lead.created_at).toLocaleDateString('en-IN')}
              {lead.assigned_name && ` · ${lead.assigned_name}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lead.phone && (
            <button onClick={openChat} className="btn-secondary flex items-center gap-2 text-sm">
              <MessageSquare size={15} /> Open Chat
            </button>
          )}
          {dirty && (
            <button onClick={saveChanges} disabled={saving} className="btn-primary flex items-center gap-2 text-sm">
              <Save size={15} /> {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          <button onClick={deleteLead} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ─── Left ─── */}
        <div className="space-y-4">
          {/* Stage */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Pipeline Stage</p>
            <div className="flex flex-wrap gap-2">
              {STAGES.map((s) => (
                <button key={s.key} onClick={() => handleChange('stage', s.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border-2
                    ${form.stage === s.key ? `${s.color} border-current scale-105 shadow-sm` : 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200'}`}>
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
              <input value={form.name || ''} onChange={(e) => handleChange('name', e.target.value)}
                className="input w-full text-sm" placeholder="Full name" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Phone</label>
              <div className="relative">
                <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={form.phone || ''} onChange={(e) => handleChange('phone', e.target.value)}
                  className="input w-full text-sm pl-8" placeholder="919876543210" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Email</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={form.email || ''} onChange={(e) => handleChange('email', e.target.value)}
                  className="input w-full text-sm pl-8" placeholder="email@example.com" />
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
                <input type="number" value={form.deal_value ?? ''}
                  onChange={(e) => handleChange('deal_value', e.target.value ? Number(e.target.value) : null)}
                  className="input w-full text-sm pl-8" placeholder="e.g. 50000" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Source</label>
              <select value={form.source || 'manual'} onChange={(e) => handleChange('source', e.target.value)} className="input w-full text-sm">
                <option value="manual">Manual</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="scraper">Scraper</option>
                <option value="campaign">Campaign</option>
                <option value="flow">Flow</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Notes</label>
              <textarea value={form.notes || ''} onChange={(e) => handleChange('notes', e.target.value)}
                rows={3} className="input w-full text-sm resize-none" placeholder="Lead notes..." />
            </div>
          </div>
        </div>

        {/* ─── Right: Activities ─── */}
        <div className="flex flex-col gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add Activity</p>
            <div className="flex gap-2 flex-wrap">
              {[{ value:'note',label:'Note'},{ value:'call',label:'Call'},{ value:'followup',label:'Follow-up'},{ value:'message',label:'Message'}].map((t) => (
                <button key={t.value} onClick={() => setActType(t.value)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors
                    ${actType === t.value ? 'bg-whatsapp-teal text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <textarea value={actDesc} onChange={(e) => setActDesc(e.target.value)} rows={3}
              placeholder="Write a note..." className="input w-full text-sm resize-none" />
            {actType === 'followup' && (
              <input type="datetime-local" value={actDate} onChange={(e) => setActDate(e.target.value)} className="input w-full text-sm" />
            )}
            <button onClick={addActivity} disabled={addingAct || !actDesc.trim()} className="btn-primary w-full text-sm">
              {addingAct ? 'Adding...' : 'Add Activity'}
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 flex-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Activity Timeline ({activities.length})</p>
            {activities.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No activities yet</p>
            ) : (
              <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                {activities.map((act) => (
                  <div key={act.id} className="flex gap-3">
                    <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      {ACTIVITY_ICONS[act.type] || <StickyNote size={13} className="text-gray-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 leading-snug">{act.description}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-gray-400">
                          {toDate(act.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                        {act.done_by_name && <span className="text-[10px] text-gray-400">· {act.done_by_name}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Chat Slide Panel ── */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="flex-1 bg-black/30 backdrop-blur-sm" onClick={() => setChatOpen(false)} />

          {/* Panel */}
          <div className="w-full max-w-md bg-white flex flex-col shadow-2xl">
            {/* Panel header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-whatsapp-dark text-white">
              <div className="w-9 h-9 rounded-full bg-whatsapp-teal flex items-center justify-center font-bold text-sm flex-shrink-0">
                {(lead.name || lead.phone || '?')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{lead.name || 'Unknown'}</p>
                <p className="text-xs text-white/60">{lead.phone}</p>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-white/70 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5 bg-[#efeae2]"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4c9b8' fill-opacity='0.3'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}>
              {chatLoading ? (
                <div className="flex items-center justify-center h-full py-20">
                  <div className="w-7 h-7 border-2 border-whatsapp-teal border-t-transparent rounded-full animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full py-20 text-gray-400 text-sm">No messages yet</div>
              ) : (
                messages.map((msg) => <MsgBubble key={msg.id} msg={msg} />)
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Input */}
            <div className="px-3 py-3 border-t border-gray-200 bg-white flex gap-2 items-end">
              <textarea
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Type a message..."
                rows={1}
                className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-whatsapp-teal"
                style={{ maxHeight: 100 }}
              />
              <button
                onClick={sendMessage}
                disabled={!msgText.trim() || sending}
                className="w-9 h-9 rounded-full bg-whatsapp-teal flex items-center justify-center text-white disabled:opacity-40 hover:opacity-90 flex-shrink-0"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
