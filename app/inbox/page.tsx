'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { apiFetch } from '@/hooks/useApi';
import MediaLibrary, { type MediaItem as MLItem } from '@/app/components/MediaLibrary';
import { Send, Search, FileText, Image, FileVideo, File, ChevronDown, ChevronUp, Download, Music, MapPin, User, UserCheck, CheckCircle, Loader2, LayoutTemplate, X, Clock, ArrowRightLeft, Zap, Plus, Trash2, Tag, Eye, Paperclip, Maximize2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Contact, Message } from '@/types';

// ── Template bubble types ─────────────────────────────────────
interface TemplateContent {
  __type: 'template';
  template_name: string;
  header_type: string;
  header_content: string;
  body: string;
  footer: string;
  buttons: { type: string; text: string }[];
}
// MySQL timestamps are stored in UTC via utcNow(). Append 'Z' so JS Date
// treats them as UTC and toLocaleTimeString/toLocaleDateString convert to IST correctly.
function toLocalDate(ts: string): Date {
  if (!ts) return new Date();
  if (ts.includes('Z') || ts.includes('+')) return new Date(ts);
  return new Date(ts.replace(' ', 'T') + 'Z');
}

function parseTemplateContent(content: string): TemplateContent | null {
  try {
    const p = JSON.parse(content);
    if (p.__type === 'template') return p as TemplateContent;
  } catch { /**/ }
  return null;
}

// ── Media message types ───────────────────────────────────────
interface MediaContent {
  __type: 'media';
  media_id: string;
  mime_type?: string;
  filename?: string;
  caption?: string;
  workspace_id: number;
}
function parseMediaContent(content: string): MediaContent | null {
  try {
    const p = JSON.parse(content);
    if (p.__type === 'media' && p.media_id) return p as MediaContent;
  } catch { /**/ }
  return null;
}

function MediaBubble({ data, msgType }: { data: MediaContent; msgType: string }) {
  const src = `/api/media/${data.media_id}?workspaceId=${data.workspace_id}`;
  const isImage = msgType === 'image';
  const isAudio = msgType === 'audio';
  const isVideo = msgType === 'video';
  const isDoc   = msgType === 'document';

  return (
    <div className="max-w-xs">
      {isImage && (
        <img
          src={src}
          alt={data.caption || 'Image'}
          className="rounded-xl max-w-full max-h-64 object-cover"
          loading="lazy"
        />
      )}
      {isVideo && (
        <video
          src={src}
          controls
          className="rounded-xl max-w-full max-h-64"
        />
      )}
      {isAudio && (
        <div className="flex items-center gap-2 px-3 py-2 bg-white/50 rounded-xl">
          <Music size={16} className="text-gray-500 flex-shrink-0" />
          <audio src={src} controls className="h-8 w-48" />
        </div>
      )}
      {isDoc && (
        <a
          href={src}
          download={data.filename || 'document'}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-3 py-2 bg-white/50 rounded-xl hover:bg-white/80 transition-colors"
        >
          <FileText size={16} className="text-gray-500 flex-shrink-0" />
          <span className="text-sm text-gray-700 truncate max-w-[180px]">{data.filename || 'Document'}</span>
          <Download size={14} className="text-gray-400 flex-shrink-0 ml-auto" />
        </a>
      )}
      {data.caption && (
        <p className="text-xs text-gray-600 mt-1 px-1 break-words">{data.caption}</p>
      )}
    </div>
  );
}

// ── Location message ─────────────────────────────────────────
interface LocationContent { __type: 'location'; latitude: number; longitude: number; name?: string; address?: string }
function parseLocationContent(c: string): LocationContent | null {
  try { const p = JSON.parse(c); if (p.__type === 'location') return p; } catch { /**/ } return null;
}
function LocationBubble({ data }: { data: LocationContent }) {
  const url = `https://www.google.com/maps?q=${data.latitude},${data.longitude}`;
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="flex items-start gap-2 hover:opacity-80 transition-opacity">
      <div className="w-24 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-gray-200 relative">
        <img
          src={`https://maps.googleapis.com/maps/api/staticmap?center=${data.latitude},${data.longitude}&zoom=15&size=96x80&markers=${data.latitude},${data.longitude}&key=`}
          alt="map"
          className="w-full h-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <MapPin size={20} className="absolute inset-0 m-auto text-red-500" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-800">{data.name || 'Location'}</p>
        {data.address && <p className="text-xs text-gray-500 mt-0.5 break-words">{data.address}</p>}
        <p className="text-xs text-blue-500 mt-1">Open in Maps ↗</p>
      </div>
    </a>
  );
}

// ── Contact message ───────────────────────────────────────────
interface ContactEntry { name?: { formatted_name?: string }; phones?: { phone?: string }[]; }
interface ContactsContent { __type: 'contacts'; contacts: ContactEntry[] }
function parseContactsContent(c: string): ContactsContent | null {
  try { const p = JSON.parse(c); if (p.__type === 'contacts') return p; } catch { /**/ } return null;
}
function ContactsBubble({ data }: { data: ContactsContent }) {
  return (
    <div className="space-y-1.5">
      {data.contacts?.map((ct, i) => {
        const name  = ct.name?.formatted_name || 'Contact';
        const phone = ct.phones?.[0]?.phone || '';
        return (
          <div key={i} className="flex items-center gap-2 bg-white/50 rounded-xl px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
              <User size={14} className="text-gray-500" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">{name}</p>
              {phone && <p className="text-xs text-gray-500">{phone}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── WhatsApp template bubble ──────────────────────────────────
function TemplateBubble({ data, status, time }: { data: TemplateContent; status: string; time: string }) {
  const HeaderIcon = data.header_type === 'IMAGE' ? Image
    : data.header_type === 'VIDEO'    ? FileVideo
    : data.header_type === 'DOCUMENT' ? File : FileText;

  return (
    <div className="w-72 rounded-2xl rounded-br-sm overflow-hidden shadow-sm border border-green-100">
      {data.header_type && data.header_type !== 'NONE' && (
        <div className="bg-gray-100 px-4 py-2.5">
          {data.header_type === 'TEXT'
            ? <p className="font-bold text-gray-800 text-sm">{data.header_content}</p>
            : <div className="flex items-center gap-2 text-gray-500 text-sm"><HeaderIcon size={15} /><span>{data.header_type}</span></div>}
        </div>
      )}
      <div className="bg-[#dcf8c6] px-4 py-2.5">
        <p className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">{data.body}</p>
        {data.footer && <p className="text-xs text-gray-400 mt-1.5">{data.footer}</p>}
        <p className="text-xs text-gray-400 text-right mt-1">
          {time}
          <span className={`ml-1 ${status === 'read' ? 'text-blue-500' : 'text-gray-400'}`}>
            {status === 'read' || status === 'delivered' ? '✓✓' : '✓'}
          </span>
        </p>
      </div>
      {data.buttons?.length > 0 && (
        <div className="divide-y divide-gray-200 border-t border-gray-200">
          {data.buttons.map((btn, i) => (
            <div key={i} className="bg-white px-4 py-2 text-center text-sm font-medium text-[#00a5f4]">{btn.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Contact Profile Panel ─────────────────────────────────────
function ProfilePanel({ contact, templateMsgCount, sessionMsgCount, onContactUpdate }: {
  contact: Contact;
  templateMsgCount: number;
  sessionMsgCount: number;
  onContactUpdate: (updated: Partial<Contact>) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ info: true });
  const toggle = (k: string) => setOpen(p => ({ ...p, [k]: !p[k] }));

  // Notes editing
  const [notesVal, setNotesVal]       = useState(contact.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);

  async function saveNotes() {
    setSavingNotes(true);
    try {
      await apiFetch(`/api/contacts/${contact.id}`, {
        method: 'PUT',
        body: JSON.stringify({ notes: notesVal }),
      });
      onContactUpdate({ notes: notesVal });
      toast.success('Notes saved');
    } catch { toast.error('Failed to save notes'); }
    finally { setSavingNotes(false); }
  }

  // Tags editing
  const parseTags = (t: unknown): string[] => {
    if (Array.isArray(t)) return t;
    try { return JSON.parse(t as string) || []; } catch { return []; }
  };
  const [tagList, setTagList]       = useState<string[]>(() => parseTags(contact.tags));
  const [tagInput, setTagInput]     = useState('');
  const [savingTags, setSavingTags] = useState(false);

  async function saveTags(newTags: string[]) {
    setSavingTags(true);
    try {
      await apiFetch(`/api/contacts/${contact.id}`, {
        method: 'PUT',
        body: JSON.stringify({ tags: newTags }),
      });
      onContactUpdate({ tags: newTags });
    } catch { toast.error('Failed to save tags'); }
    finally { setSavingTags(false); }
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t || tagList.includes(t)) return;
    const next = [...tagList, t];
    setTagList(next);
    setTagInput('');
    saveTags(next);
  }

  function removeTag(t: string) {
    const next = tagList.filter((x) => x !== t);
    setTagList(next);
    saveTags(next);
  }

  const initial = (contact.name || contact.phone || '?').charAt(0).toUpperCase();
  const avatarColors = ['bg-orange-400', 'bg-purple-500', 'bg-blue-500', 'bg-green-500', 'bg-red-400'];
  const color = avatarColors[initial.charCodeAt(0) % avatarColors.length];

  const chatStatusBadge = contact.chat_status === 'intervened'
    ? <span className="text-orange-600 font-semibold">Intervened</span>
    : contact.chat_status === 'resolved'
    ? <span className="text-green-600 font-semibold">Resolved</span>
    : <span className="text-gray-600 font-semibold">Open</span>;

  const infoRows = [
    { label: 'Status',            value: <span className={`font-semibold ${contact.status === 'converted' ? 'text-green-600' : 'text-gray-700'}`}>{contact.status || 'Active'}</span> },
    { label: 'Chat Status',       value: chatStatusBadge },
    ...(contact.chat_status === 'intervened' && contact.intervened_by
      ? [{
          label: contact.assigned_agent_id ? 'Transferred By' : 'Intervened By',
          value: <span className={`font-semibold ${contact.assigned_agent_id ? 'text-blue-600' : 'text-orange-600'}`}>{contact.intervened_by}</span>,
        }]
      : []),
    { label: 'Last Active',       value: contact.updated_at ? toLocalDate(contact.updated_at).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) : '—' },
    { label: 'Template Messages', value: templateMsgCount },
    { label: 'Session Messages',  value: sessionMsgCount },
    { label: 'Source',            value: contact.source || '—' },
    { label: 'Opted In',          value: contact.opted_in ? <span className="text-green-600 font-semibold">Yes</span> : <span className="text-red-400">No</span> },
  ];

  return (
    <div className="w-72 border-l border-gray-200 bg-white flex flex-col overflow-y-auto">
      {/* Avatar + name */}
      <div className="p-5 border-b border-gray-100 text-center">
        <div className={`w-14 h-14 rounded-full ${color} text-white text-2xl font-bold flex items-center justify-center mx-auto mb-3`}>
          {initial}
        </div>
        <p className="font-bold text-gray-900">{contact.name || contact.phone}</p>
        <p className="text-sm text-gray-400 mt-0.5">+{contact.phone}</p>
      </div>

      {/* Info section */}
      <div className="border-b border-gray-100">
        <button onClick={() => toggle('info')}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
          Chat Profile
          {open.info ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        {open.info && (
          <div className="px-4 pb-4 space-y-2.5">
            {infoRows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-gray-400">{label}</span>
                <span className="text-gray-700 text-right">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tags */}
      <div className="border-b border-gray-100">
        <button onClick={() => toggle('tags')}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
          <span className="flex items-center gap-1.5"><Tag size={13} /> Tags</span>
          {open.tags ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        {open.tags && (
          <div className="px-4 pb-4 space-y-2">
            <div className="flex flex-wrap gap-1 min-h-[24px]">
              {tagList.length > 0
                ? tagList.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 text-xs rounded-full px-2.5 py-0.5">
                      {t}
                      <button onClick={() => removeTag(t)} disabled={savingTags} className="hover:text-blue-900 leading-none">×</button>
                    </span>
                  ))
                : <p className="text-xs text-gray-400">No tags yet</p>}
            </div>
            <div className="flex gap-1.5">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTag()}
                placeholder="Add tag..."
                className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-whatsapp-green"
              />
              <button onClick={addTag} disabled={!tagInput.trim() || savingTags}
                className="px-2.5 py-1.5 bg-whatsapp-green text-white rounded-lg text-xs disabled:opacity-40">
                <Plus size={12} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="border-b border-gray-100">
        <button onClick={() => toggle('notes')}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
          Notes
          {open.notes ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        {open.notes && (
          <div className="px-4 pb-4 space-y-2">
            <textarea
              value={notesVal}
              onChange={(e) => setNotesVal(e.target.value)}
              rows={3}
              placeholder="Write internal notes about this contact..."
              className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-whatsapp-green resize-none"
            />
            <button
              onClick={saveNotes}
              disabled={savingNotes || notesVal === (contact.notes || '')}
              className="w-full py-1.5 bg-whatsapp-green text-white text-xs font-semibold rounded-lg disabled:opacity-40 flex items-center justify-center gap-1">
              {savingNotes ? <Loader2 size={12} className="animate-spin" /> : null}
              Save Notes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Common emojis for picker ──────────────────────────────────
const EMOJIS = ['😊','😂','🙏','👍','❤️','😍','🎉','👋','🤝','😅','🙂','😎','🔥','✅','⚡','💪','🌟','👌','🙌','😮','🎊','💯','🤔','😢','😃','✨','🎁','👏','💡','🫂'];

// ── Template variable helpers ─────────────────────────────────
function extractVarCount(body: string): number {
  const nums = (body?.match(/\{\{(\d+)\}\}/g) || []).map(m => parseInt(m.replace(/\{\{|\}\}/g, '')));
  return nums.length > 0 ? Math.max(...nums) : 0;
}
function applyTplParams(body: string, params: string[]): string {
  return (body || '').replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] || `{{${n}}}`);
}
// Simple bold/italic renderer for template preview
function renderTplPreview(text: string): React.ReactNode {
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

// ── Main Inbox Page ───────────────────────────────────────────
export default function InboxPage() {
  const [contacts, setContacts]     = useState<Contact[]>([]);
  const [selected, setSelected]     = useState<Contact | null>(null);
  const [messages, setMessages]     = useState<Message[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [text, setText]             = useState('');
  const [search, setSearch]         = useState('');
  const [sending, setSending]       = useState(false);
  const [actioning, setActioning]   = useState(false);
  const [tab, setTab]               = useState<'all' | 'requested' | 'intervened'>('requested');
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates]   = useState<{ id: number; name: string; language: string; body_text: string; status: string }[]>([]);
  const [sendingTpl, setSendingTpl] = useState<number | null>(null);
  const [tplForParams, setTplForParams] = useState<{ id: number; name: string; language: string; body_text: string } | null>(null);
  const [tplParamVals, setTplParamVals] = useState<string[]>([]);
  const [showEmoji, setShowEmoji]       = useState(false);
  const inputRef                        = useRef<HTMLTextAreaElement>(null);
  const emojiRef                        = useRef<HTMLDivElement>(null);
  const [showTransfer, setShowTransfer]     = useState(false);
  const [transferAgents, setTransferAgents] = useState<{ id: number; name: string; workspace_role: string }[]>([]);
  const [loadingAgents, setLoadingAgents]   = useState(false);
  const [transferring, setTransferring]     = useState(false);
  const transferRef                         = useRef<HTMLDivElement>(null);

  // Quick Replies
  const [quickReplies, setQuickReplies]       = useState<{ id: number; title: string; content: string }[]>([]);
  const [showQR, setShowQR]                   = useState(false);
  const [showQRManage, setShowQRManage]       = useState(false);
  const [qrForm, setQrForm]                   = useState({ title: '', content: '' });
  const [savingQR, setSavingQR]               = useState(false);
  const qrRef                                 = useRef<HTMLDivElement>(null);

  const loadQuickReplies = useCallback(() => {
    apiFetch('/api/quick-replies').then((r) => setQuickReplies(r.data || []));
  }, []);

  useEffect(() => { loadQuickReplies(); }, [loadQuickReplies]);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmoji) return;
    function h(e: MouseEvent) {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmoji(false);
    }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showEmoji]);

  function applyFormat(marker: string) {
    const ta = inputRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const sel = v.slice(s, e);
    const next = v.slice(0, s) + marker + sel + marker + v.slice(e);
    setText(next);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(s + marker.length, e + marker.length); }, 0);
  }

  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [showMediaLib, setShowMediaLib]     = useState(false);

  async function handleMediaLibSelect(item: MLItem) {
    if (!selected) return;
    const mediaType = item.mime_type.startsWith('image/') ? 'image'
      : item.mime_type.startsWith('video/') ? 'video'
      : item.mime_type.startsWith('audio/') ? 'audio'
      : 'document';
    try {
      await apiFetch('/api/send-message', {
        method: 'POST',
        body: JSON.stringify({ contactId: selected.id, type: mediaType, mediaId: item.media_id, filename: item.filename }),
      });
      toast.success('Media sent!');
      loadMessages(selected.id);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to send'); }
  }

  async function sendMediaFile(file: File) {
    if (!selected) return;
    setUploadingMedia(true);
    const toastId = toast.loading(`Uploading ${file.name}…`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = localStorage.getItem('token');
      const upRes = await fetch('/api/media', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const upData = await upRes.json();
      if (!upRes.ok) throw new Error(upData.error || 'Upload failed');

      const mediaType = file.type.startsWith('image/') ? 'image'
        : file.type.startsWith('video/') ? 'video'
        : file.type.startsWith('audio/') ? 'audio'
        : 'document';

      await apiFetch('/api/send-message', {
        method: 'POST',
        body: JSON.stringify({ contactId: selected.id, type: mediaType, mediaId: upData.data.mediaId, caption: '', filename: file.name }),
      });
      toast.success('Sent!', { id: toastId });
      loadMessages(selected.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed', { id: toastId });
    } finally {
      setUploadingMedia(false);
    }
  }

  useEffect(() => {
    if (!showQR) return;
    function handleOut(e: MouseEvent) {
      if (qrRef.current && !qrRef.current.contains(e.target as Node)) setShowQR(false);
    }
    document.addEventListener('mousedown', handleOut);
    return () => document.removeEventListener('mousedown', handleOut);
  }, [showQR]);

  async function saveQuickReply() {
    if (!qrForm.title.trim() || !qrForm.content.trim()) return;
    setSavingQR(true);
    try {
      await apiFetch('/api/quick-replies', { method: 'POST', body: JSON.stringify(qrForm) });
      setQrForm({ title: '', content: '' });
      loadQuickReplies();
      toast.success('Quick reply saved!');
    } catch { toast.error('Failed to save'); }
    finally { setSavingQR(false); }
  }

  async function deleteQuickReply(id: number) {
    await apiFetch(`/api/quick-replies/${id}`, { method: 'DELETE' });
    setQuickReplies((prev) => prev.filter((q) => q.id !== id));
  }
  const bottomRef                           = useRef<HTMLDivElement>(null);
  const chatRef                             = useRef<HTMLDivElement>(null);

  // Intervened filter state
  const [intervenedFilter, setIntervenedFilter]         = useState<'me' | 'any' | 'other' | number>('me');
  const [showIntervenedFilter, setShowIntervenedFilter] = useState(false);
  const [filterAgents, setFilterAgents]                 = useState<{ id: number; name: string; workspace_role: string }[]>([]);
  const [loadingFilterAgents, setLoadingFilterAgents]   = useState(false);
  const intervenedFilterRef                             = useRef<HTMLDivElement>(null);
  const currentUserName = typeof window !== 'undefined' ? (localStorage.getItem('userName') || '') : '';
  const currentUserRole = typeof window !== 'undefined' ? (localStorage.getItem('userRole') || '') : '';
  // Decode userId from JWT (needed to match assigned_agent_id for "By Me" filter)
  const currentUserId: number | null = (() => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      if (!token) return null;
      return JSON.parse(atob(token.split('.')[1])).userId ?? null;
    } catch { return null; }
  })();

  // Separate contacts list for admin/manager intervened tab (includes all agents' transferred chats)
  const [intervenedContacts, setIntervenedContacts] = useState<Contact[]>([]);

  // SSE-driven unread counts — persisted in localStorage, cleared on select
  const [unreadCounts, setUnreadCounts] = useState<Record<number, number>>(() => {
    try { return JSON.parse(localStorage.getItem('unreadCounts') || '{}'); } catch { return {}; }
  });
  const saveUnread = (counts: Record<number, number>) => {
    localStorage.setItem('unreadCounts', JSON.stringify(counts));
  };

  const loadContacts = useCallback(() => {
    setContactsLoading(true);
    apiFetch('/api/contacts?limit=200&chatStatus=inbox').then((r) => {
      const list: Contact[] = r.data?.data || [];
      setContacts(list);
      setUnreadCounts(prev => {
        const next = { ...prev };
        list.forEach((c) => {
          if (selectedRef.current?.id === c.id) {
            next[c.id] = 0; // Always 0 for the currently open chat
          } else {
            // dbCount is now server-authoritative (based on last_read_at in DB)
            // Use it directly — works across all devices and browsers
            const dbCount = Number(c.unread_count) || 0;
            const local   = prev[c.id] ?? 0;
            next[c.id] = Math.max(local, dbCount);
          }
        });
        saveUnread(next);
        return next;
      });
    }).finally(() => setContactsLoading(false));
  }, []);

  // Load intervened contacts — for admin/manager: all agents' chats; for agent: their own assigned
  const loadIntervenedContacts = useCallback(() => {
    apiFetch('/api/contacts?chatStatus=intervened&limit=500').then((r) => {
      setIntervenedContacts(r.data?.data || []);
    });
  }, []);

  useEffect(() => {
    loadContacts();
    loadIntervenedContacts();
    const iv = setInterval(() => { loadContacts(); loadIntervenedContacts(); }, 60_000);
    return () => clearInterval(iv);
  }, [loadContacts, loadIntervenedContacts]);

  const loadMessages = useCallback((contactId: number) => {
    setMessagesLoading(true);
    apiFetch(`/api/messages?contactId=${contactId}&limit=80`)
      .then((r) => setMessages(r.data || []))
      .finally(() => setMessagesLoading(false));
  }, []);

  // Track selected contact in a ref so the SSE handler always sees the latest value
  const selectedRef = useRef<Contact | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // SSE — real-time updates triggered by incoming webhook messages
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      es = new EventSource(`/api/events?token=${encodeURIComponent(token!)}`);

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as {
            type?: string;
            contactId?: number;
            direction?: string;
            wamid?: string;
            status?: string;
            chatStatus?: string;
          };

          if (data.type === 'new_message') {
            loadContacts();
            loadIntervenedContacts();
            if (selectedRef.current?.id === data.contactId) {
              loadMessages(data.contactId!);
            } else if (data.contactId && data.direction === 'inbound') {
              setUnreadCounts(prev => {
                const next = { ...prev, [data.contactId!]: (prev[data.contactId!] || 0) + 1 };
                saveUnread(next);
                return next;
              });
            }
          } else if (data.type === 'status_update' && data.contactId && data.wamid && data.status) {
            if (selectedRef.current?.id === data.contactId) {
              setMessages(prev => prev.map(m =>
                m.wamid === data.wamid ? { ...m, status: data.status as Message['status'] } : m
              ));
            }
          } else if (data.type === 'chat_status_update' && data.contactId && data.chatStatus) {
            loadContacts();
            loadIntervenedContacts();
            if (selectedRef.current?.id === data.contactId) {
              setSelected(prev => prev ? { ...prev, chat_status: data.chatStatus as Contact['chat_status'] } : prev);
              loadMessages(data.contactId);
            }
          }
        } catch { /* ignore malformed frames */ }
      };

      // On error: close and reconnect after 3 s (don't permanently close)
      es.onerror = () => {
        es?.close();
        es = null;
        if (!destroyed) retryTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [loadContacts, loadMessages, loadIntervenedContacts]);

  const loadTemplates = useCallback(() => {
    if (templates.length > 0) return;
    apiFetch('/api/templates').then((r) => {
      const approved = (r.data || []).filter((t: { status: string }) => t.status === 'APPROVED');
      setTemplates(approved);
    });
  }, [templates.length]);

  // 24h session: open if user messaged us OR we sent a template within 24h
  const isSessionOpen = messages.some((m) =>
    Date.now() - toLocalDate(m.created_at).getTime() < 24 * 60 * 60 * 1000 &&
    (m.direction === 'inbound' || (m.direction === 'outbound' && m.type === 'template'))
  );

  function selectContact(c: Contact) {
    setSelected(c);
    setUnreadCounts(prev => {
      const next = { ...prev, [c.id]: 0 };
      saveUnread(next);
      return next;
    });
    // Server-side read: updates last_read_at in DB (syncs across all devices)
    apiFetch(`/api/contacts/${c.id}`, { method: 'PUT', body: JSON.stringify({ reset_unread: true }) }).catch(() => {});
    // Send WhatsApp read receipts so user sees blue ticks on their end
    apiFetch('/api/messages/read', { method: 'POST', body: JSON.stringify({ contactId: c.id }) }).catch(() => {});
  }

  useEffect(() => {
    if (!selected) return;
    loadMessages(selected.id);
  }, [selected, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    if (!text.trim() || !selected) return;
    setSending(true);
    const msgText = text;
    setText('');

    // Optimistic update — show message immediately
    const optimistic = {
      id: Date.now(), workspace_id: selected.id, contact_id: selected.id,
      wamid: '', direction: 'outbound' as const, type: 'text',
      content: msgText, template_id: 0, campaign_id: 0,
      status: 'queued' as const, error_message: '',
      sent_at: new Date().toISOString(), delivered_at: '', read_at: '',
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      await apiFetch('/api/send-message', {
        method: 'POST',
        body: JSON.stringify({ contactId: selected.id, type: 'text', text: msgText }),
      });
      // Reload to get real wamid and status from server
      loadMessages(selected.id);
    } catch (err) {
      // Remove optimistic on failure
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setText(msgText);
      toast.error('Failed: ' + (err instanceof Error ? err.message : 'error'));
    } finally {
      setSending(false);
    }
  }

  async function sendTemplate(templateName: string, language: string, tplId: number, params: string[] = []) {
    if (!selected) return;
    setSendingTpl(tplId);
    try {
      await apiFetch('/api/send-message', {
        method: 'POST',
        body: JSON.stringify({ contactId: selected.id, type: 'template', templateName, language, templateParams: params }),
      });
      setShowTemplates(false);
      setTplForParams(null);
      setTplParamVals([]);
      loadMessages(selected.id);
      toast.success('Template sent!');
    } catch (err) {
      toast.error('Failed: ' + (err instanceof Error ? err.message : 'error'));
    } finally {
      setSendingTpl(null);
    }
  }

  async function intervene() {
    if (!selected || actioning) return;
    setActioning(true);
    const userName = localStorage.getItem('userName') || 'Agent';
    // Optimistically append "Intervened by" at the END so it appears below the last message
    const optimistic = {
      id: Date.now(), workspace_id: selected.id, contact_id: selected.id,
      wamid: '', direction: 'outbound' as const, type: 'system',
      content: `Intervened by ${userName}`, template_id: 0, campaign_id: 0,
      status: 'delivered' as const, error_message: '',
      sent_at: new Date().toISOString(), delivered_at: '', read_at: '',
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      await apiFetch(`/api/contacts/${selected.id}`, {
        method: 'PUT',
        body: JSON.stringify({ chat_status: 'intervened' }),
      });
      const updated = { ...selected, chat_status: 'intervened' as const, intervened_by: userName, assigned_agent_id: null as unknown as number };
      setSelected(updated);
      setContacts((prev) => prev.map((c) => c.id === selected.id ? updated : c));
      // Keep intervenedContacts in sync for admin/manager tab
      setIntervenedContacts((prev) => {
        const exists = prev.some((c) => c.id === selected.id);
        return exists ? prev.map((c) => c.id === selected.id ? updated : c) : [...prev, updated];
      });
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      toast.error('Failed to intervene');
    }
    finally { setActioning(false); }
  }

  async function resolve() {
    if (!selected || actioning) return;
    setActioning(true);
    const userName = localStorage.getItem('userName') || 'Agent';
    try {
      // Optimistically add "Closed by" at the BOTTOM before clearing
      const closedMsg = {
        id: Date.now(), workspace_id: selected.id, contact_id: selected.id,
        wamid: '', direction: 'outbound' as const, type: 'system',
        content: `Closed by ${userName}`, template_id: 0, campaign_id: 0,
        status: 'delivered' as const, error_message: '',
        sent_at: new Date().toISOString(), delivered_at: '', read_at: '',
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, closedMsg]);

      await apiFetch(`/api/contacts/${selected.id}`, {
        method: 'PUT',
        body: JSON.stringify({ chat_status: 'resolved' }),
      });

      // Mark resolved locally — contact stays in "All" for 24h, then auto-moves to History
      const resolved = { ...selected, chat_status: 'resolved' as const };
      setContacts((prev) => prev.map((c) => c.id === selected.id ? resolved : c));
      // Remove from intervened list immediately so tab updates without refresh
      setIntervenedContacts((prev) => prev.filter((c) => c.id !== selected.id));
      setSelected(null);
      setMessages([]);
      toast.success('Chat resolved — visible in All for 24 hours, then moves to History');
    } catch { toast.error('Failed to resolve'); }
    finally { setActioning(false); }
  }

  // Close transfer dropdown when clicking outside
  useEffect(() => {
    if (!showTransfer) return;
    function handleOutside(e: MouseEvent) {
      if (transferRef.current && !transferRef.current.contains(e.target as Node)) {
        setShowTransfer(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showTransfer]);

  // Close intervened filter dropdown when clicking outside
  useEffect(() => {
    if (!showIntervenedFilter) return;
    function handleOutside(e: MouseEvent) {
      if (intervenedFilterRef.current && !intervenedFilterRef.current.contains(e.target as Node)) {
        setShowIntervenedFilter(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showIntervenedFilter]);

  async function openIntervenedFilter() {
    if (filterAgents.length === 0 && !showIntervenedFilter) {
      setLoadingFilterAgents(true);
      try {
        const r = await apiFetch('/api/agents');
        setFilterAgents(r.data || []);
      } catch { /* ignore */ }
      finally { setLoadingFilterAgents(false); }
    }
    setShowIntervenedFilter((v) => !v);
  }

  async function openTransfer() {
    if (transferAgents.length === 0 && !showTransfer) {
      setLoadingAgents(true);
      try {
        const r = await apiFetch('/api/agents');
        setTransferAgents(r.data || []);
      } catch { toast.error('Failed to load agents'); }
      finally { setLoadingAgents(false); }
    }
    setShowTransfer((v) => !v);
  }

  async function transferChat(agent: { id: number; name: string }) {
    if (!selected || transferring) return;
    setTransferring(true);
    setShowTransfer(false);
    try {
      await apiFetch(`/api/contacts/${selected.id}`, {
        method: 'PUT',
        body: JSON.stringify({ transfer_to_id: agent.id }),
      });
      // Remove from current agent's view immediately
      setContacts((prev) => prev.filter((c) => c.id !== selected.id));
      setIntervenedContacts((prev) => prev.filter((c) => c.id !== selected.id));
      setSelected(null);
      setMessages([]);
      toast.success(`Chat transferred to ${agent.name}`);
    } catch { toast.error('Failed to transfer'); }
    finally { setTransferring(false); }
  }

  function scrollToReplied(wamid: string) {
    const el = document.getElementById(`msg-${wamid}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-whatsapp-green', 'ring-offset-1', 'rounded-xl');
      setTimeout(() => el.classList.remove('ring-2', 'ring-whatsapp-green', 'ring-offset-1', 'rounded-xl'), 1500);
    }
  }

  const filtered = contacts.filter((c) =>
    (c.name || c.phone).toLowerCase().includes(search.toLowerCase())
  );

  // Shared intervened sub-filter — used for badge count, dropdown count, and contact list
  function matchesIntervenedFilter(c: Contact, fil: typeof intervenedFilter): boolean {
    if (currentUserRole === 'agent') return true; // agents see only their own (API already filters)
    if (fil === 'any') return true;
    if (fil === 'me') return (
      (currentUserId != null && c.assigned_agent_id === currentUserId) ||
      (!c.assigned_agent_id && c.intervened_by === currentUserName)
    );
    if (fil === 'other') return !(
      (currentUserId != null && c.assigned_agent_id === currentUserId) ||
      (!c.assigned_agent_id && c.intervened_by === currentUserName)
    );
    // Agent ID
    const agentName = filterAgents.find((a) => a.id === fil)?.name;
    return c.assigned_agent_id === fil || (!c.assigned_agent_id && c.intervened_by === agentName);
  }

  const templateMsgCount = messages.filter((m) => m.type === 'template' && m.direction === 'outbound').length;
  const sessionMsgCount  = messages.filter((m) => m.direction === 'outbound' && m.type !== 'template').length;

  return (
    <div className="h-[calc(100vh-5rem)] flex border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">

      {/* ── Left: Contact List ──────────────────────────────── */}
      <div className="w-72 border-r border-gray-200 flex flex-col flex-shrink-0">
        {/* Search */}
        <div className="p-3 border-b border-gray-100">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts..." className="input pl-9 text-sm py-2" />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          {(['all', 'requested', 'intervened'] as const).map((t) => {
            const requestedCount   = filtered.filter((c) => (c.chat_status === 'open' || !c.chat_status) && Number(c.inbound_count) > 0).length;
            const isAdminOrManager = currentUserRole === 'admin' || currentUserRole === 'manager';
            const intervenedSource = intervenedContacts.filter((c) => (c.name || c.phone).toLowerCase().includes(search.toLowerCase()));
            // Badge shows count matching the current active sub-filter
            const intervenedCount  = intervenedSource.filter((c) => matchesIntervenedFilter(c, intervenedFilter)).length;
            const label =
              t === 'all' ? `All (${contacts.length})` :
              t === 'requested' ? (
                <span className="flex items-center gap-1">
                  Requested
                  {requestedCount > 0 && <span className="bg-whatsapp-green text-white text-xs rounded-full px-1.5 py-0.5 leading-none">{requestedCount}</span>}
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  Intervened
                  {intervenedCount > 0 && <span className="bg-orange-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">{intervenedCount}</span>}
                </span>
              );
            return (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-2 text-xs font-semibold transition-colors flex items-center justify-center gap-1 ${
                  tab === t ? 'border-b-2 border-whatsapp-green text-whatsapp-teal' : 'text-gray-400'}`}>
                {label}
              </button>
            );
          })}
        </div>

        {/* Intervened filter dropdown — visible for admin/manager on intervened tab */}
        {tab === 'intervened' && (currentUserRole === 'admin' || currentUserRole === 'manager') && (
          <div className="border-b border-gray-100 relative" ref={intervenedFilterRef}>
            {(() => {
              // For agent-specific filter, look up name by ID
              const selectedAgent = typeof intervenedFilter === 'number'
                ? filterAgents.find((a) => a.id === intervenedFilter)
                : null;
              const filterLabel =
                intervenedFilter === 'me'    ? 'Intervened By Me' :
                intervenedFilter === 'any'   ? 'Intervened By Any' :
                intervenedFilter === 'other' ? 'Intervened By Other' :
                selectedAgent ? `Intervened By ${selectedAgent.name}` : 'Intervened By Agent';

              // Count from intervenedContacts using the shared filter helper
              const filterCount = intervenedContacts
                .filter((c) => (c.name || c.phone).toLowerCase().includes(search.toLowerCase()))
                .filter((c) => matchesIntervenedFilter(c, intervenedFilter)).length;

              return (
                <button
                  onClick={openIntervenedFilter}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-orange-700 hover:bg-orange-50 transition-colors">
                  <span className="truncate">
                    {filterLabel}{' '}
                    <span className="text-orange-500 font-bold">({filterCount})</span>
                  </span>
                  {showIntervenedFilter ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              );
            })()}
            {showIntervenedFilter && (
              <div className="absolute left-0 right-0 top-full bg-white border border-gray-200 shadow-lg z-30 rounded-b-lg overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  {([
                    { key: 'me'    as const, label: 'Intervened By Me' },
                    { key: 'any'   as const, label: 'Intervened By Any' },
                    { key: 'other' as const, label: 'Intervened By Other' },
                  ]).map((opt) => {
                    const cnt = intervenedContacts.filter((c) => matchesIntervenedFilter(c, opt.key)).length;
                    return (
                      <button key={opt.key}
                        onClick={() => { setIntervenedFilter(opt.key); setShowIntervenedFilter(false); }}
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors flex items-center justify-between gap-2 ${intervenedFilter === opt.key ? 'text-orange-600 font-semibold bg-orange-50' : 'text-gray-700'}`}>
                        <span>{opt.label}</span>
                        {cnt > 0 && (
                          <span className={`text-xs font-bold rounded-full px-1.5 py-0.5 leading-none flex-shrink-0 ${intervenedFilter === opt.key ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600'}`}>
                            {cnt}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  <div className="border-t border-gray-100 mt-1" />
                  {loadingFilterAgents ? (
                    <div className="flex items-center justify-center py-3">
                      <Loader2 size={14} className="animate-spin text-gray-400" />
                    </div>
                  ) : filterAgents.map((a) => {
                    const agentCount = intervenedContacts.filter((c) =>
                      c.assigned_agent_id === a.id ||
                      (!c.assigned_agent_id && c.intervened_by === a.name)
                    ).length;
                    return (
                      <button key={a.id}
                        onClick={() => { setIntervenedFilter(a.id); setShowIntervenedFilter(false); }}
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors flex items-center gap-2 ${intervenedFilter === a.id ? 'text-orange-600 font-semibold bg-orange-50' : 'text-gray-700'}`}>
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${a.workspace_role === 'manager' ? 'bg-purple-500' : 'bg-blue-500'}`}>
                          {a.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="truncate">Intervened By {a.name}</span>
                        <span className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                          {a.workspace_role !== 'agent' && (
                            <span className="text-xs text-gray-400 capitalize">{a.workspace_role}</span>
                          )}
                          {agentCount > 0 && (
                            <span className={`text-xs font-bold rounded-full px-1.5 py-0.5 leading-none ${intervenedFilter === a.id ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600'}`}>
                              {agentCount}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Contact items */}
        <div className="flex-1 overflow-y-auto">
          {/* Skeleton while loading */}
          {contactsLoading && (
            <div className="divide-y divide-gray-50 animate-pulse">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-3">
                  <div className="w-10 h-10 rounded-full bg-gray-200 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-gray-200 rounded w-3/5" />
                    <div className="h-2.5 bg-gray-100 rounded w-4/5" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!contactsLoading && (() => {
            const source = (tab === 'intervened')
              ? intervenedContacts.filter((c) => (c.name || c.phone).toLowerCase().includes(search.toLowerCase()))
              : filtered;
            if (source.length === 0 && tab !== 'all' && tab !== 'requested') {
              return <p className="text-center text-gray-400 text-xs py-10">No contacts</p>;
            }
            return null;
          })()}
          {!contactsLoading && (() => {
            const source = (tab === 'intervened')
              ? intervenedContacts.filter((c) => (c.name || c.phone).toLowerCase().includes(search.toLowerCase()))
              : filtered;
            return source;
          })()
            .filter((c) => {
              if (tab === 'all') return true;
              if (tab === 'requested') return c.chat_status === 'open' && Number(c.inbound_count) > 0;
              if (c.chat_status !== 'intervened') return false;
              return matchesIntervenedFilter(c, intervenedFilter);
            })
            .map((c) => {
            // Local state is primary (SSE-driven); DB subquery is fallback for page-refresh
            const unread = unreadCounts[c.id] !== undefined ? unreadCounts[c.id] : (Number(c.unread_count) || 0);
            const isResolved = c.chat_status === 'resolved';
            const isIntervened = c.chat_status === 'intervened';
            const initial = (c.name || c.phone).charAt(0).toUpperCase();
            const avatarColors = ['bg-orange-400','bg-purple-500','bg-blue-500','bg-green-500','bg-red-400'];
            const color = avatarColors[initial.charCodeAt(0) % avatarColors.length];
            // assigned_agent_name comes from the API (subquery join on users)
            const transferredToAgent = c.assigned_agent_name ||
              filterAgents.find((a) => a.id === c.assigned_agent_id)?.name;
            const intervenedLabel = isIntervened && c.intervened_by
              ? (c.assigned_agent_id
                  ? `User Transferred to ${transferredToAgent || 'agent'} by ${c.intervened_by}`
                  : c.intervened_by === currentUserName
                    ? 'User Intervened by you'
                    : `User Intervened by ${c.intervened_by}`)
              : null;
            return (
              <button key={c.id} onClick={() => selectContact(c)}
                className={`w-full text-left px-3 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors flex items-center gap-3
                  ${selected?.id === c.id ? 'bg-green-50 border-l-2 border-l-whatsapp-green' : ''}
                  ${isResolved ? 'opacity-60' : ''}`}>
                <div className={`w-10 h-10 rounded-full ${color} text-white flex items-center justify-center font-bold text-sm flex-shrink-0`}>
                  {initial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <p className={`text-sm truncate ${unread > 0 ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>
                      {c.name || c.phone}
                    </p>
                    {c.last_message_at && (
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {toLocalDate(c.last_message_at!).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className={`text-xs truncate ${unread > 0 ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>
                      {isResolved
                        ? <span className="text-green-600 font-medium">Resolved</span>
                        : intervenedLabel
                          ? <span className="text-orange-600">{intervenedLabel}</span>
                          : `+${c.phone}`}
                    </p>
                    {unread > 0 && !isResolved && (
                      <span className="flex-shrink-0 bg-whatsapp-green text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Middle: Chat area ───────────────────────────────── */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat header */}
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3 bg-white">
            <div className="w-9 h-9 rounded-full bg-whatsapp-green text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
              {(selected.name || selected.phone).charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-gray-900">{selected.name || selected.phone}</p>
              <p className="text-xs text-gray-400">+{selected.phone}</p>
            </div>
            {selected.chat_status === 'intervened' && (
              <div className="flex items-center gap-2">
                {/* Transfer dropdown */}
                <div className="relative" ref={transferRef}>
                  <button onClick={openTransfer} disabled={actioning || transferring}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-400 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50">
                    {transferring ? <Loader2 size={12} className="animate-spin" /> : <ArrowRightLeft size={12} />}
                    Transfer
                    <ChevronDown size={11} className={`transition-transform duration-150 ${showTransfer ? 'rotate-180' : ''}`} />
                  </button>
                  {showTransfer && (
                    <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
                      <p className="px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-100">Transfer to</p>
                      {loadingAgents ? (
                        <div className="flex items-center justify-center py-5">
                          <Loader2 size={16} className="animate-spin text-gray-400" />
                        </div>
                      ) : transferAgents.length === 0 ? (
                        <p className="px-3 py-4 text-xs text-gray-400 text-center">No agents available</p>
                      ) : (
                        <div className="max-h-48 overflow-y-auto">
                          {transferAgents.map((a) => (
                            <button key={a.id} onClick={() => transferChat(a)}
                              className="w-full text-left px-3 py-2.5 hover:bg-gray-50 flex items-center gap-2.5 transition-colors border-b border-gray-50 last:border-0">
                              <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                {a.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-gray-800 truncate">{a.name}</p>
                                <p className="text-xs text-gray-400 capitalize">{a.workspace_role}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* Resolve button */}
                <button onClick={resolve} disabled={actioning}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50">
                  {actioning ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                  Resolve
                </button>
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#f0f0f0]" ref={chatRef}
            style={{ backgroundImage: 'radial-gradient(circle, #d4d4d4 1px, transparent 1px)', backgroundSize: '20px 20px' }}>

            {/* Messages loading skeleton */}
            {messagesLoading && messages.length === 0 && (
              <div className="space-y-3 animate-pulse">
                {[70, 50, 85, 45, 65].map((w, i) => (
                  <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
                    <div className={`h-10 bg-gray-300/60 rounded-2xl`} style={{ width: `${w}%` }} />
                  </div>
                ))}
              </div>
            )}

            {messages.map((m, idx) => {
              const tpl      = parseTemplateContent(m.content);
              const media    = parseMediaContent(m.content);
              const location = parseLocationContent(m.content);
              const contacts = parseContactsContent(m.content);
              const repliedMsg = m.replied_to_wamid ? messages.find((x) => x.wamid === m.replied_to_wamid) : null;
              const msgDate  = toLocalDate(m.created_at);
              const timeStr  = msgDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

              // Date separator logic — use en-CA locale for reliable YYYY-MM-DD strings
              const prevDate        = idx > 0 ? toLocalDate(messages[idx - 1].created_at) : null;
              const todayStr        = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
              const yesterdayStr    = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
              const msgDateStr      = msgDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
              const prevDateStr     = prevDate ? prevDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : null;
              const isNewDay        = !prevDateStr || msgDateStr !== prevDateStr;
              const dateLabel       = msgDateStr === todayStr     ? 'Today'
                                    : msgDateStr === yesterdayStr ? 'Yesterday'
                                    : msgDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

              // Session divider — shown when a new regular message follows a "Closed by" event
              const prevMsg       = idx > 0 ? messages[idx - 1] : null;
              const isNewSession  = !!(prevMsg?.content?.startsWith('Closed by '));

              // System message — centered badge
              const isSystemMsg = m.type === 'system' ||
                (m.content?.startsWith('Intervened by ') || m.content?.startsWith('Closed by ') ||
                 m.content?.startsWith('Reopened by ')   || m.content?.startsWith('Transferred to '));
              if (isSystemMsg) {
                return (
                  <div key={m.id}>
                    {isNewDay && (
                      <div className="flex items-center justify-center my-3">
                        <span className="bg-white/80 text-gray-500 text-xs font-medium px-3 py-1 rounded-full shadow-sm">
                          {dateLabel}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-center my-2">
                      <span className="bg-gray-200/80 text-gray-500 text-xs px-4 py-1.5 rounded-full shadow-sm">
                        {m.content}
                      </span>
                    </div>
                  </div>
                );
              }

              return (
                <div key={m.id}>
                  {isNewSession && (
                    <div className="flex items-center gap-2 my-4">
                      <div className="flex-1 h-px bg-gray-300" />
                      <span className="text-xs text-gray-400 font-medium px-2 whitespace-nowrap">New Conversation</span>
                      <div className="flex-1 h-px bg-gray-300" />
                    </div>
                  )}
                  {isNewDay && (
                    <div className="flex items-center justify-center my-3">
                      <span className="bg-white/80 text-gray-500 text-xs font-medium px-3 py-1 rounded-full shadow-sm">
                        {dateLabel}
                      </span>
                    </div>
                  )}
                <div id={`msg-${m.wamid}`}
                  className={`flex transition-all ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  {tpl ? (
                    <TemplateBubble data={tpl} status={m.status} time={timeStr} />
                  ) : (
                    <div className={`max-w-xs lg:max-w-sm rounded-2xl text-sm shadow-sm overflow-hidden
                      ${m.direction === 'outbound'
                        ? 'bg-[#dcf8c6] text-gray-800 rounded-br-sm'
                        : 'bg-white text-gray-800 rounded-bl-sm'}`}>

                      {/* Reply reference — with linked message or fallback to last template */}
                      {m.type === 'button' && (() => {
                        const quotedMsg = repliedMsg || messages.slice().reverse().find(
                          (x) => x.direction === 'outbound' && x.type === 'template' && x.id < m.id
                        );
                        const quotedTpl = quotedMsg ? parseTemplateContent(quotedMsg.content) : null;
                        return (
                          <button
                            onClick={() => quotedMsg?.wamid && scrollToReplied(quotedMsg.wamid)}
                            className="w-full text-left bg-black/10 border-l-4 border-whatsapp-green px-3 py-2 hover:bg-black/15 transition-colors">
                            <p className="text-whatsapp-teal font-semibold text-xs flex items-center gap-1 mb-0.5">
                              ↩ Replied to this message
                            </p>
                            <p className="text-gray-600 text-xs truncate">
                              {quotedTpl?.body?.slice(0, 55) || quotedMsg?.content?.slice(0, 55) || 'Template message'}
                              {((quotedTpl?.body?.length || 0) > 55) && '…'}
                            </p>
                          </button>
                        );
                      })()}

                      <div className="px-3 py-2">
                        {media ? (
                          <MediaBubble data={media} msgType={m.type} />
                        ) : location ? (
                          <LocationBubble data={location} />
                        ) : contacts ? (
                          <ContactsBubble data={contacts} />
                        ) : (
                          <p className="break-words whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        )}
                        <p className={`text-xs mt-1 flex items-center gap-0.5 ${m.direction === 'outbound' ? 'justify-end text-gray-400' : 'text-gray-300'}`}>
                          {timeStr}
                          {m.direction === 'outbound' && (
                            <span className={m.status === 'read' ? 'text-blue-500' : 'text-gray-400'}>
                              {m.status === 'read' || m.status === 'delivered' ? ' ✓✓' : ' ✓'}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Template picker panel */}
          {showTemplates && (
            <div className="border-t border-gray-200 bg-white">
              {tplForParams ? (
                /* ── Params form ── */
                <>
                  <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setTplForParams(null)} className="text-gray-400 hover:text-gray-600">
                        <ArrowRightLeft size={14} className="rotate-180" />
                      </button>
                      <p className="text-sm font-semibold text-gray-700">Parameters</p>
                    </div>
                    <button onClick={() => { setShowTemplates(false); setTplForParams(null); }}>
                      <X size={16} className="text-gray-400 hover:text-gray-600" />
                    </button>
                  </div>
                  <div className="overflow-y-auto max-h-72 p-4 space-y-3">
                    {/* Variable inputs */}
                    {tplParamVals.map((val, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-xs font-mono text-gray-500 w-12 shrink-0 text-right">{`{{${i + 1}}}`}</span>
                        <input
                          value={val}
                          onChange={e => {
                            const next = [...tplParamVals];
                            next[i] = e.target.value;
                            setTplParamVals(next);
                          }}
                          placeholder="value"
                          className="input text-sm py-1.5 flex-1"
                        />
                      </div>
                    ))}
                    {/* Preview */}
                    <div className="border-t pt-3 mt-1">
                      <p className="text-xs font-semibold text-gray-500 flex items-center gap-1 mb-2">
                        <Eye size={12} /> Preview
                      </p>
                      <div className="bg-[#dcf8c6] rounded-xl rounded-br-sm px-3 py-2 text-sm text-gray-800 leading-snug whitespace-pre-wrap shadow-sm">
                        {renderTplPreview(applyTplParams(tplForParams.body_text, tplParamVals))}
                      </div>
                    </div>
                  </div>
                  <div className="px-4 py-2.5 border-t flex gap-2">
                    <button onClick={() => setTplForParams(null)} className="btn-secondary flex-1 text-sm">Back</button>
                    <button
                      onClick={() => sendTemplate(tplForParams.name, tplForParams.language, tplForParams.id, tplParamVals)}
                      disabled={sendingTpl === tplForParams.id}
                      className="btn-primary flex-1 text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                      {sendingTpl === tplForParams.id
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Send size={14} />} Send
                    </button>
                  </div>
                </>
              ) : (
                /* ── Template list ── */
                <>
                  <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-700">Select a Template</p>
                    <button onClick={() => setShowTemplates(false)}><X size={16} className="text-gray-400 hover:text-gray-600" /></button>
                  </div>
                  <div className="max-h-52 overflow-y-auto divide-y divide-gray-50">
                    {templates.length === 0
                      ? <p className="text-center text-xs text-gray-400 py-6">No approved templates</p>
                      : templates.map((t) => {
                          const varCount = extractVarCount(t.body_text);
                          return (
                            <button key={t.id}
                              onClick={() => {
                                if (varCount > 0) {
                                  setTplForParams(t);
                                  setTplParamVals(Array(varCount).fill(''));
                                } else {
                                  sendTemplate(t.name, t.language, t.id);
                                }
                              }}
                              disabled={sendingTpl === t.id}
                              className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors disabled:opacity-50">
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-semibold text-gray-800">{t.name}</p>
                                {sendingTpl === t.id
                                  ? <Loader2 size={14} className="animate-spin text-gray-400" />
                                  : varCount > 0
                                    ? <span className="text-[10px] text-blue-400 font-medium">{varCount} vars</span>
                                    : <Send size={13} className="text-gray-300" />}
                              </div>
                              <p className="text-xs text-gray-400 mt-0.5 truncate">{t.body_text}</p>
                            </button>
                          );
                        })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Input / Intervene */}
          {selected.chat_status === 'intervened' ? (
            isSessionOpen ? (
              /* Session active — full text input */
              <div className="border-t border-gray-200 bg-white">
                {/* Quick Replies panel */}
                {showQR && (
                  <div ref={qrRef} className="border-b border-gray-100 bg-gray-50">
                    {/* Header */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                      <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                        <Zap size={12} className="text-yellow-500" /> Quick Replies
                      </p>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setShowQRManage((v) => !v)}
                          className="text-xs text-whatsapp-teal font-medium hover:underline">
                          {showQRManage ? 'Done' : 'Manage'}
                        </button>
                        <button onClick={() => setShowQR(false)} className="text-gray-400 hover:text-gray-600">
                          <X size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Manage form */}
                    {showQRManage && (
                      <div className="px-3 py-2 space-y-2 border-b border-gray-100">
                        <input value={qrForm.title} onChange={(e) => setQrForm({ ...qrForm, title: e.target.value })}
                          placeholder="Title (e.g. Greeting)" className="input text-xs py-1.5" />
                        <textarea value={qrForm.content} onChange={(e) => setQrForm({ ...qrForm, content: e.target.value })}
                          placeholder="Message content..." rows={2}
                          className="input text-xs py-1.5 resize-none" />
                        <button onClick={saveQuickReply} disabled={savingQR || !qrForm.title.trim() || !qrForm.content.trim()}
                          className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1 disabled:opacity-40">
                          <Plus size={12} /> {savingQR ? 'Saving...' : 'Add Quick Reply'}
                        </button>
                      </div>
                    )}

                    {/* List */}
                    <div className="max-h-40 overflow-y-auto divide-y divide-gray-50">
                      {quickReplies.length === 0
                        ? <p className="text-center text-xs text-gray-400 py-4">No quick replies yet. Click Manage to add.</p>
                        : quickReplies.map((qr) => (
                          <div key={qr.id} className="flex items-start gap-2 px-3 py-2 hover:bg-white transition-colors group">
                            <button onClick={() => { setText(qr.content); setShowQR(false); }}
                              className="flex-1 text-left min-w-0">
                              <p className="text-xs font-semibold text-gray-800">{qr.title}</p>
                              <p className="text-xs text-gray-400 truncate">{qr.content}</p>
                            </button>
                            {showQRManage && (
                              <button onClick={() => deleteQuickReply(qr.id)}
                                className="text-gray-300 hover:text-red-500 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Rich input */}
                <div className="relative">
                  {/* Emoji picker */}
                  {showEmoji && (
                    <div ref={emojiRef}
                      className="absolute bottom-full left-3 mb-1 bg-white border border-gray-200 rounded-xl shadow-xl p-2 grid grid-cols-8 gap-0.5 z-30 w-64">
                      {EMOJIS.map(em => (
                        <button key={em} onClick={() => { setText(t => t + em); setShowEmoji(false); inputRef.current?.focus(); }}
                          className="text-xl p-1 hover:bg-gray-100 rounded transition-colors">{em}</button>
                      ))}
                    </div>
                  )}
                  {/* Textarea */}
                  <div className="px-3 pt-2.5">
                    <textarea
                      ref={inputRef}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                      placeholder='Type "/" for quick replies…'
                      rows={2}
                      className="w-full resize-none text-sm bg-transparent outline-none text-gray-800 placeholder-gray-400 leading-snug"
                      style={{ maxHeight: 120 }}
                    />
                  </div>
                  {/* Toolbar */}
                  <div className="flex items-center justify-between px-3 pb-2.5">
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => applyFormat('*')} title="Bold"
                        className="px-2 py-1 rounded hover:bg-gray-100 font-bold text-sm text-gray-600 transition-colors">B</button>
                      <button onClick={() => applyFormat('_')} title="Italic"
                        className="px-2 py-1 rounded hover:bg-gray-100 italic text-sm text-gray-600 transition-colors">I</button>
                      <button onClick={() => applyFormat('~')} title="Strikethrough"
                        className="px-2 py-1 rounded hover:bg-gray-100 line-through text-sm text-gray-600 transition-colors">S</button>
                      <div className="w-px h-4 bg-gray-200 mx-1" />
                      <button onClick={() => setShowEmoji(v => !v)} title="Emoji"
                        className={`p-1.5 rounded text-base transition-colors ${showEmoji ? 'bg-yellow-50' : 'hover:bg-gray-100'}`}>😊</button>
                      <button onClick={() => setShowMediaLib(true)} title="Media Library"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 transition-colors">
                        <Image size={15} />
                      </button>
                      <label title="Upload & send file" className={`p-1.5 rounded hover:bg-gray-100 cursor-pointer transition-colors ${uploadingMedia ? 'text-gray-300 pointer-events-none' : 'text-gray-500'}`}>
                        <Paperclip size={15} />
                        <input type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) sendMediaFile(f); e.target.value = ''; }} />
                      </label>
                      <div className="w-px h-4 bg-gray-200 mx-1" />
                      <button onClick={() => setShowQR(v => !v)} title="Quick Replies"
                        className={`p-1.5 rounded transition-colors ${showQR ? 'bg-yellow-50 text-yellow-600' : 'hover:bg-gray-100 text-gray-500'}`}>
                        <Zap size={15} />
                      </button>
                      <button onClick={() => { loadTemplates(); setShowTemplates(v => !v); }} title="Send Template"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 transition-colors">
                        <LayoutTemplate size={15} />
                      </button>
                    </div>
                    <button onClick={sendMessage} disabled={sending || !text.trim()}
                      className="btn-primary px-4 py-1.5 text-sm flex items-center gap-1.5 disabled:opacity-50">
                      {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Session expired — disabled input + template button */
              <div className="border-t border-gray-200 bg-white">
                <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
                  <Clock size={12} className="text-amber-500 flex-shrink-0" />
                  <p className="text-xs text-amber-600">24h session expired — waiting for user reply, or send a template</p>
                </div>
                <div className="p-2 flex gap-2 items-center">
                  <input disabled value=""
                    placeholder="Waiting for user reply…"
                    className="input flex-1 text-sm bg-gray-50 cursor-not-allowed text-gray-400" />
                  <button onClick={() => { loadTemplates(); setShowTemplates((v) => !v); }}
                    title="Send template"
                    className="p-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 transition-colors flex-shrink-0">
                    <LayoutTemplate size={16} />
                  </button>
                </div>
              </div>
            )
          ) : selected.chat_status === 'resolved' ? (
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex flex-col items-center gap-2">
              <p className="text-xs text-gray-400">Chat resolved — moves to History in 24 hrs</p>
              <button onClick={intervene} disabled={actioning}
                className="flex items-center gap-2 px-6 py-2.5 bg-whatsapp-green hover:bg-green-600 text-white font-semibold rounded-full text-sm transition-colors disabled:opacity-50 shadow-sm">
                {actioning ? <Loader2 size={15} className="animate-spin" /> : <UserCheck size={15} />}
                Intervene Again
              </button>
            </div>
          ) : (
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-center">
              <button onClick={intervene} disabled={actioning}
                className="flex items-center gap-2 px-6 py-2.5 bg-whatsapp-green hover:bg-green-600 text-white font-semibold rounded-full text-sm transition-colors disabled:opacity-50 shadow-sm">
                {actioning ? <Loader2 size={15} className="animate-spin" /> : <UserCheck size={15} />}
                Intervene
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400 bg-gray-50">
          {contactsLoading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-4 border-whatsapp-green border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-400">Loading conversations…</p>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-5xl mb-3">💬</div>
              <p className="font-medium text-gray-500">Select a contact to start chatting</p>
              <p className="text-sm text-gray-400 mt-1">Choose from the contact list on the left</p>
            </div>
          )}
        </div>
      )}

      {/* ── Right: Profile Panel ────────────────────────────── */}
      {selected && (
        <ProfilePanel
          key={selected.id}
          contact={selected}
          templateMsgCount={templateMsgCount}
          sessionMsgCount={sessionMsgCount}
          onContactUpdate={(updated) => {
            setSelected((prev) => prev ? { ...prev, ...updated } : prev);
            setContacts((prev) => prev.map((c) => c.id === selected.id ? { ...c, ...updated } : c));
          }}
        />
      )}

      {/* Media Library modal */}
      {showMediaLib && (
        <MediaLibrary
          onSelect={handleMediaLibSelect}
          onClose={() => setShowMediaLib(false)}
        />
      )}
    </div>
  );
}
