'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { apiFetch } from '@/hooks/useApi';
import {
  Search, CheckCircle, MapPin, User, FileText, Download,
  Music, Send, LayoutTemplate, X, Loader2, File, FileVideo,
  Maximize2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Contact, Message } from '@/types';

// ── UTC → local date (same as inbox) ─────────────────────────
function toLocalDate(ts: string): Date {
  if (!ts) return new Date();
  if (ts.includes('Z') || ts.includes('+')) return new Date(ts);
  return new Date(ts.replace(' ', 'T') + 'Z');
}

function fmtTime(ts: string) {
  return toLocalDate(ts).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  });
}

function fmtDate(ts: string) {
  const d   = toLocalDate(ts);
  const now = new Date();
  const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const msgDay    = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDay.getTime() === today.getTime())     return 'Today';
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

// ── Template content parsers ──────────────────────────────────
interface TemplateContent {
  __type: 'template';
  template_name: string;
  header_type: string;
  header_content: string;
  body: string;
  footer: string;
  buttons: { type: string; text: string }[];
}
function parseTemplateContent(c: string): TemplateContent | null {
  try { const p = JSON.parse(c); if (p.__type === 'template') return p as TemplateContent; } catch { /**/ } return null;
}

interface MediaContent { __type: 'media'; media_id: string; mime_type?: string; filename?: string; caption?: string; workspace_id: number }
function parseMediaContent(c: string): MediaContent | null {
  try { const p = JSON.parse(c); if (p.__type === 'media' && p.media_id) return p as MediaContent; } catch { /**/ } return null;
}
interface LocationContent { __type: 'location'; latitude: number; longitude: number; name?: string; address?: string }
function parseLocationContent(c: string): LocationContent | null {
  try { const p = JSON.parse(c); if (p.__type === 'location') return p; } catch { /**/ } return null;
}
interface ContactsContent { __type: 'contacts'; contacts: { name?: { formatted_name?: string }; phones?: { phone?: string }[] }[] }
function parseContactsContent(c: string): ContactsContent | null {
  try { const p = JSON.parse(c); if (p.__type === 'contacts') return p; } catch { /**/ } return null;
}

// ── Bold/italic renderer ──────────────────────────────────────
function renderWaText(text: string): React.ReactNode {
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

// ── Image lightbox ────────────────────────────────────────────
function MediaBubble({ data, msgType }: { data: MediaContent; msgType: string }) {
  const src     = `/api/media/${data.media_id}?workspaceId=${data.workspace_id}`;
  const isImage = msgType === 'image' || msgType === 'sticker';
  const [lightbox, setLightbox] = useState(false);

  function handleDownload() {
    const a = document.createElement('a');
    a.href = src; a.download = data.filename || 'image'; a.target = '_blank'; a.click();
  }

  return (
    <div className="max-w-xs">
      {isImage && (
        <>
          <div className="relative group cursor-pointer rounded-xl overflow-hidden" onClick={() => setLightbox(true)}>
            <img src={src} alt={data.caption || 'Image'} className="rounded-xl max-w-full max-h-64 object-cover" loading="lazy" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 rounded-full p-1.5">
                <Maximize2 size={16} className="text-white" />
              </div>
            </div>
          </div>
          {lightbox && (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center" onClick={() => setLightbox(false)}>
              <div className="relative max-w-3xl max-h-[90vh] mx-4" onClick={(e) => e.stopPropagation()}>
                <img src={src} alt={data.caption || 'Image'} className="max-w-full max-h-[80vh] rounded-xl object-contain" />
                <div className="absolute top-3 right-3 flex gap-2">
                  <button onClick={handleDownload} className="bg-white/90 hover:bg-white text-gray-800 rounded-full p-2 shadow"><Download size={18} /></button>
                  <button onClick={() => setLightbox(false)} className="bg-white/90 hover:bg-white text-gray-800 rounded-full p-2 shadow"><X size={18} /></button>
                </div>
                {data.caption && <p className="text-white text-sm text-center mt-3 px-2">{data.caption}</p>}
              </div>
            </div>
          )}
        </>
      )}
      {msgType === 'video' && <video src={src} controls className="rounded-xl max-w-full max-h-64" />}
      {msgType === 'audio' && (
        <div className="flex items-center gap-2 px-3 py-2 bg-white/50 rounded-xl">
          <Music size={16} className="text-gray-500 flex-shrink-0" />
          <audio src={src} controls className="h-8 w-48" />
        </div>
      )}
      {msgType === 'document' && (
        <a href={src} download={data.filename || 'document'} target="_blank" rel="noreferrer"
          className="flex items-center gap-2 px-3 py-2 bg-white/50 rounded-xl hover:bg-white/80 transition-colors">
          <FileText size={16} className="text-gray-500 flex-shrink-0" />
          <span className="text-sm text-gray-700 truncate max-w-[180px]">{data.filename || 'Document'}</span>
          <Download size={14} className="text-gray-400 flex-shrink-0 ml-auto" />
        </a>
      )}
      {data.caption && !isImage && <p className="text-xs text-gray-600 mt-1 px-1 break-words">{data.caption}</p>}
    </div>
  );
}

// ── Status ticks helper ───────────────────────────────────────
function Ticks({ status }: { status: string }) {
  if (status === 'read')      return <span className="ml-1 text-blue-500">✓✓</span>;
  if (status === 'delivered') return <span className="ml-1 text-gray-400">✓✓</span>;
  return <span className="ml-1 text-gray-400">✓</span>;
}

// ── Full template bubble (same as inbox) ──────────────────────
function TemplateBubble({ data, timeStr, status }: { data: TemplateContent; timeStr: string; status: string }) {
  const hasMediaUrl = data.header_content?.startsWith('http');
  const ht = (data.header_type || '').toUpperCase();

  return (
    <div className="w-72 rounded-2xl rounded-br-sm overflow-hidden shadow-sm border border-green-100">
      {/* Header */}
      {ht && ht !== 'NONE' && (
        <>
          {ht === 'IMAGE' && hasMediaUrl && (
            <div className="bg-gray-100">
              <img src={data.header_content} alt="header" className="w-full max-h-48 object-cover" loading="lazy" />
            </div>
          )}
          {ht === 'VIDEO' && hasMediaUrl && (
            <div className="bg-gray-100">
              <video src={data.header_content} controls className="w-full max-h-48" />
            </div>
          )}
          {ht === 'DOCUMENT' && (
            <div className="bg-gray-100 px-4 py-2.5">
              {hasMediaUrl
                ? <a href={data.header_content} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 text-blue-600 text-sm font-medium">
                    <File size={16} className="flex-shrink-0" />
                    <span className="truncate">{data.header_content.split('/').pop()?.split('?')[0] || 'Document'}</span>
                    <Download size={13} className="ml-auto flex-shrink-0" />
                  </a>
                : <div className="flex items-center gap-2 text-gray-500 text-sm"><File size={15} /><span>Document</span></div>}
            </div>
          )}
          {ht === 'TEXT' && (
            <div className="bg-gray-100 px-4 py-2.5">
              <p className="font-bold text-gray-800 text-sm">{data.header_content}</p>
            </div>
          )}
          {!['IMAGE','VIDEO','DOCUMENT','TEXT'].includes(ht) && (
            <div className="bg-gray-100 px-4 py-2.5 flex items-center gap-2 text-gray-500 text-sm">
              <FileVideo size={15} /><span>{ht}</span>
            </div>
          )}
        </>
      )}
      {/* Body */}
      <div className="bg-[#dcf8c6] px-4 py-2.5">
        <p className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">
          {renderWaText(data.body)}
        </p>
        {data.footer && <p className="text-xs text-gray-400 mt-1.5">{data.footer}</p>}
        <p className="text-xs text-gray-400 text-right mt-1">
          {timeStr}<Ticks status={status} />
        </p>
      </div>
      {/* Buttons */}
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

// ── Main History Page ─────────────────────────────────────────
export default function HistoryPage() {
  const [contacts, setContacts]           = useState<Contact[]>([]);
  const [selected, setSelected]           = useState<Contact | null>(null);
  const [messages, setMessages]           = useState<Message[]>([]);
  const [search, setSearch]               = useState('');
  const [searching, setSearching]         = useState(false);
  const [templates, setTemplates]         = useState<{ id: number; name: string; language: string; body_text: string; status: string }[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [sendingTpl, setSendingTpl]       = useState<number | null>(null);
  const bottomRef                         = useRef<HTMLDivElement>(null);
  const debounceRef                       = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadContacts = useCallback((q = '') => {
    setSearching(true);
    const qs = q.trim() ? `&search=${encodeURIComponent(q.trim())}` : '';
    apiFetch(`/api/contacts?limit=500&chatStatus=history${qs}`)
      .then((r) => setContacts(r.data?.data || []))
      .finally(() => setSearching(false));
  }, []);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadContacts(search), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, loadContacts]);

  useEffect(() => {
    if (!selected) return;
    apiFetch(`/api/messages?contactId=${selected.id}&limit=80`).then((r) => setMessages(r.data || []));
  }, [selected]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const loadTemplates = useCallback(() => {
    if (templates.length > 0) return;
    apiFetch('/api/templates').then((r) => {
      setTemplates((r.data || []).filter((t: { status: string }) => t.status === 'APPROVED'));
    });
  }, [templates.length]);

  async function sendTemplate(templateName: string, language: string, tplId: number) {
    if (!selected) return;
    setSendingTpl(tplId);
    try {
      await apiFetch('/api/send-message', {
        method: 'POST',
        body: JSON.stringify({ contactId: selected.id, type: 'template', templateName, language }),
      });
      setShowTemplates(false);
      apiFetch(`/api/messages?contactId=${selected.id}&limit=80`).then((r) => setMessages(r.data || []));
      toast.success('Template sent!');
    } catch (err) {
      toast.error('Failed: ' + (err instanceof Error ? err.message : 'error'));
    } finally {
      setSendingTpl(null);
    }
  }

  const avatarColors = ['bg-orange-400', 'bg-purple-500', 'bg-blue-500', 'bg-green-500', 'bg-red-400'];
  const getColor = (ch: string) => avatarColors[ch.charCodeAt(0) % avatarColors.length];

  return (
    <div className="h-[calc(100vh-5rem)] flex border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">

      {/* ── Left: Contact list ───────────────────────────────── */}
      <div className="w-72 border-r border-gray-200 flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-gray-100">
          <div className="relative">
            {searching
              ? <Loader2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
              : <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />}
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone..." className="input pl-9 text-sm py-2 w-full" />
          </div>
        </div>
        <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2">
          <CheckCircle size={14} className="text-gray-400" />
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Resolved ({contacts.length})
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {contacts.length === 0 && !searching && (
            <p className="text-center text-gray-400 text-xs py-10">No resolved chats</p>
          )}
          {contacts.map((c) => {
            const initial = (c.name || c.phone).charAt(0).toUpperCase();
            return (
              <button key={c.id} onClick={() => setSelected(c)}
                className={`w-full text-left px-3 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors flex items-center gap-3
                  ${selected?.id === c.id ? 'bg-green-50 border-l-2 border-l-whatsapp-green' : ''}`}>
                <div className={`w-10 h-10 rounded-full ${getColor(initial)} text-white flex items-center justify-center font-bold text-sm flex-shrink-0`}>
                  {initial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-sm truncate font-medium text-gray-700">{c.name || c.phone}</p>
                    {c.last_message_at && (
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {toLocalDate(c.last_message_at).toLocaleTimeString('en-IN', {
                          hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
                        })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate mt-0.5">+{c.phone}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Middle: Chat ─────────────────────────────────────── */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3 bg-white">
            <div className={`w-9 h-9 rounded-full ${getColor((selected.name || selected.phone).charAt(0).toUpperCase())} text-white flex items-center justify-center font-bold text-sm flex-shrink-0`}>
              {(selected.name || selected.phone).charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-gray-900">{selected.name || selected.phone}</p>
              <p className="text-xs text-gray-400">+{selected.phone}</p>
            </div>
            <span className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full font-medium flex items-center gap-1 flex-shrink-0">
              <CheckCircle size={12} /> Resolved
            </span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-1 bg-[#f0f0f0]"
            style={{ backgroundImage: 'radial-gradient(circle, #d4d4d4 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
            {messages.map((m, idx) => {
              const tpl      = parseTemplateContent(m.content);
              const media    = !tpl ? parseMediaContent(m.content) : null;
              const location = !tpl && !media ? parseLocationContent(m.content) : null;
              const contacts = !tpl && !media && !location ? parseContactsContent(m.content) : null;
              const timeStr  = fmtTime(m.created_at);

              // Date separator
              const showDate = idx === 0 ||
                fmtDate(m.created_at) !== fmtDate(messages[idx - 1].created_at);

              // System message
              const isSystem = m.type === 'system' ||
                m.content?.startsWith('Intervened by ') ||
                m.content?.startsWith('Closed by ') ||
                m.content?.startsWith('Reopened by ');

              return (
                <div key={m.id}>
                  {/* Date separator */}
                  {showDate && (
                    <div className="flex items-center justify-center my-3">
                      <span className="bg-white/80 text-gray-500 text-xs px-3 py-1 rounded-full shadow-sm border border-gray-200">
                        {fmtDate(m.created_at)}
                      </span>
                    </div>
                  )}

                  {/* System badge */}
                  {isSystem ? (
                    <div className="flex items-center justify-center my-1">
                      <span className="bg-gray-200/80 text-gray-500 text-xs px-4 py-1.5 rounded-full shadow-sm">
                        {m.content}
                      </span>
                    </div>
                  ) : (
                    <div className={`flex mb-1 ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                      {/* Full template bubble */}
                      {tpl ? (
                        <TemplateBubble data={tpl} timeStr={timeStr} status={m.status || ''} />
                      ) : media ? (
                        <div className={`max-w-xs rounded-2xl text-sm shadow-sm overflow-hidden px-3 py-2
                          ${m.direction === 'outbound' ? 'bg-[#dcf8c6] rounded-br-sm' : 'bg-white rounded-bl-sm'}`}>
                          <MediaBubble data={media} msgType={m.type} />
                          <p className={`text-xs mt-1 ${m.direction === 'outbound' ? 'text-right text-gray-400' : 'text-gray-300'}`}>
                            {timeStr}{m.direction === 'outbound' && <Ticks status={m.status || ''} />}
                          </p>
                        </div>
                      ) : location ? (
                        <div className={`max-w-xs rounded-2xl text-sm shadow-sm overflow-hidden px-3 py-2
                          ${m.direction === 'outbound' ? 'bg-[#dcf8c6] rounded-br-sm' : 'bg-white rounded-bl-sm'}`}>
                          <a href={`https://www.google.com/maps?q=${location.latitude},${location.longitude}`}
                            target="_blank" rel="noreferrer" className="flex items-start gap-2 hover:opacity-80">
                            <div className="w-20 h-16 rounded-lg bg-gray-200 flex items-center justify-center flex-shrink-0">
                              <MapPin size={20} className="text-red-500" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold">{location.name || 'Location'}</p>
                              {location.address && <p className="text-xs text-gray-500 mt-0.5">{location.address}</p>}
                              <p className="text-xs text-blue-500 mt-1">Open in Maps ↗</p>
                            </div>
                          </a>
                          <p className={`text-xs mt-1 ${m.direction === 'outbound' ? 'text-right text-gray-400' : 'text-gray-300'}`}>
                            {timeStr}{m.direction === 'outbound' && <Ticks status={m.status || ''} />}
                          </p>
                        </div>
                      ) : contacts ? (
                        <div className={`max-w-xs rounded-2xl text-sm shadow-sm overflow-hidden px-3 py-2
                          ${m.direction === 'outbound' ? 'bg-[#dcf8c6] rounded-br-sm' : 'bg-white rounded-bl-sm'}`}>
                          <div className="space-y-1.5">
                            {contacts.contacts?.map((ct, i) => {
                              const name  = ct.name?.formatted_name || 'Contact';
                              const phone = ct.phones?.[0]?.phone || '';
                              return (
                                <div key={i} className="flex items-center gap-2 bg-white/50 rounded-xl px-3 py-2">
                                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                                    <User size={14} className="text-gray-500" />
                                  </div>
                                  <div>
                                    <p className="text-sm font-semibold">{name}</p>
                                    {phone && <p className="text-xs text-gray-500">{phone}</p>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <p className={`text-xs mt-1 ${m.direction === 'outbound' ? 'text-right text-gray-400' : 'text-gray-300'}`}>
                            {timeStr}{m.direction === 'outbound' && <Ticks status={m.status || ''} />}
                          </p>
                        </div>
                      ) : (
                        <div className={`max-w-xs lg:max-w-sm rounded-2xl text-sm shadow-sm overflow-hidden
                          ${m.direction === 'outbound' ? 'bg-[#dcf8c6] text-gray-800 rounded-br-sm' : 'bg-white text-gray-800 rounded-bl-sm'}`}>
                          <div className="px-3 py-2">
                            <p className="break-words whitespace-pre-wrap leading-relaxed">
                              {renderWaText(m.content)}
                            </p>
                            <p className={`text-xs mt-1 ${m.direction === 'outbound' ? 'text-right text-gray-400' : 'text-gray-300'}`}>
                              {timeStr}{m.direction === 'outbound' && <Ticks status={m.status || ''} />}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Template picker */}
          {showTemplates && (
            <div className="border-t border-gray-200 bg-white">
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-700">Select a Template</p>
                <button onClick={() => setShowTemplates(false)}><X size={16} className="text-gray-400 hover:text-gray-600" /></button>
              </div>
              <div className="max-h-52 overflow-y-auto divide-y divide-gray-50">
                {templates.length === 0
                  ? <p className="text-center text-xs text-gray-400 py-6">No approved templates</p>
                  : templates.map((t) => (
                    <button key={t.id} onClick={() => sendTemplate(t.name, t.language, t.id)}
                      disabled={sendingTpl === t.id}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors disabled:opacity-50">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-gray-800">{t.name}</p>
                        {sendingTpl === t.id
                          ? <Loader2 size={14} className="animate-spin text-gray-400" />
                          : <Send size={13} className="text-gray-300" />}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{t.body_text}</p>
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="p-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-400">24h session expired — send a template to re-engage</p>
            <button
              onClick={() => { loadTemplates(); setShowTemplates((v) => !v); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-whatsapp-green hover:bg-green-600 text-white text-xs font-semibold rounded-lg transition-colors flex-shrink-0">
              <LayoutTemplate size={13} /> Send Template
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <CheckCircle size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="font-medium text-gray-500">Select a resolved chat</p>
            <p className="text-sm text-gray-400 mt-1">View past conversation history</p>
          </div>
        </div>
      )}
    </div>
  );
}
