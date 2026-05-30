'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { apiFetch } from '@/hooks/useApi';
import { Search, CheckCircle, MapPin, User, FileText, Download, Music, Send, LayoutTemplate, X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Contact, Message } from '@/types';

// ── Shared content parsers (same as inbox) ────────────────────
function parseTemplateContent(c: string) {
  try { const p = JSON.parse(c); if (p.__type === 'template') return p; } catch { /**/ } return null;
}
function parseMediaContent(c: string) {
  try { const p = JSON.parse(c); if (p.__type === 'media' && p.media_id) return p; } catch { /**/ } return null;
}
function parseLocationContent(c: string) {
  try { const p = JSON.parse(c); if (p.__type === 'location') return p; } catch { /**/ } return null;
}
function parseContactsContent(c: string) {
  try { const p = JSON.parse(c); if (p.__type === 'contacts') return p; } catch { /**/ } return null;
}

function renderMessageContent(m: Message) {
  const media    = parseMediaContent(m.content);
  const location = parseLocationContent(m.content);
  const contacts = parseContactsContent(m.content);

  if (media) {
    const src = `/api/media/${media.media_id}?workspaceId=${media.workspace_id}`;
    if (m.type === 'image' || m.type === 'sticker') return <img src={src} alt="Image" className="rounded-xl max-w-full max-h-64 object-cover" loading="lazy" />;
    if (m.type === 'video') return <video src={src} controls className="rounded-xl max-w-full max-h-64" />;
    if (m.type === 'audio') return <div className="flex items-center gap-2"><Music size={16} className="text-gray-500" /><audio src={src} controls className="h-8 w-48" /></div>;
    if (m.type === 'document') return (
      <a href={src} download={media.filename || 'document'} target="_blank" rel="noreferrer"
        className="flex items-center gap-2 bg-white/50 rounded-xl px-3 py-2 hover:bg-white/80">
        <FileText size={16} className="text-gray-500" />
        <span className="text-sm truncate max-w-[180px]">{media.filename || 'Document'}</span>
        <Download size={14} className="text-gray-400 ml-auto" />
      </a>
    );
  }
  if (location) {
    const url = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
    return (
      <a href={url} target="_blank" rel="noreferrer" className="flex items-start gap-2 hover:opacity-80">
        <div className="w-20 h-16 rounded-lg bg-gray-200 flex items-center justify-center flex-shrink-0">
          <MapPin size={20} className="text-red-500" />
        </div>
        <div><p className="text-sm font-semibold">{location.name || 'Location'}</p>
          {location.address && <p className="text-xs text-gray-500 mt-0.5">{location.address}</p>}
          <p className="text-xs text-blue-500 mt-1">Open in Maps ↗</p>
        </div>
      </a>
    );
  }
  if (contacts) {
    return (
      <div className="space-y-1.5">
        {contacts.contacts?.map((ct: Record<string, unknown>, i: number) => {
          const name  = (ct.name as Record<string, unknown>)?.formatted_name as string || 'Contact';
          const phone = ((ct.phones as Record<string, unknown>[])?.[0]?.phone as string) || '';
          return (
            <div key={i} className="flex items-center gap-2 bg-white/50 rounded-xl px-3 py-2">
              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                <User size={14} className="text-gray-500" />
              </div>
              <div><p className="text-sm font-semibold">{name}</p>{phone && <p className="text-xs text-gray-500">{phone}</p>}</div>
            </div>
          );
        })}
      </div>
    );
  }
  return <p className="break-words whitespace-pre-wrap leading-relaxed">{m.content}</p>;
}

export default function HistoryPage() {
  const [contacts, setContacts]     = useState<Contact[]>([]);
  const [selected, setSelected]     = useState<Contact | null>(null);
  const [messages, setMessages]     = useState<Message[]>([]);
  const [search, setSearch]         = useState('');
  const [actioning, setActioning]   = useState(false);
  const [templates, setTemplates]   = useState<{ id: number; name: string; language: string; body_text: string; status: string }[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [sendingTpl, setSendingTpl] = useState<number | null>(null);
  const bottomRef                   = useRef<HTMLDivElement>(null);

  const loadContacts = useCallback(() => {
    apiFetch('/api/contacts?limit=200&chatStatus=history').then((r) => setContacts(r.data?.data || []));
  }, []);

  useEffect(() => { loadContacts(); }, [loadContacts]);

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

  const s = search.toLowerCase();
  const filtered = contacts.filter((c) =>
    (c.name || '').toLowerCase().includes(s) || (c.phone || '').toLowerCase().includes(s)
  );
  const avatarColors = ['bg-orange-400', 'bg-purple-500', 'bg-blue-500', 'bg-green-500', 'bg-red-400'];
  const getColor = (ch: string) => avatarColors[ch.charCodeAt(0) % avatarColors.length];

  return (
    <div className="h-[calc(100vh-5rem)] flex border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">

      {/* Left: Contact list */}
      <div className="w-72 border-r border-gray-200 flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-gray-100">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search history..." className="input pl-9 text-sm py-2" />
          </div>
        </div>
        <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2">
          <CheckCircle size={14} className="text-gray-400" />
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Resolved ({filtered.length})</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && <p className="text-center text-gray-400 text-xs py-10">No resolved chats</p>}
          {filtered.map((c) => {
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
                        {new Date(c.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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

      {/* Middle: Chat (read-only) */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3 bg-white">
            <div className={`w-9 h-9 rounded-full ${getColor((selected.name || selected.phone).charAt(0).toUpperCase())} text-white flex items-center justify-center font-bold text-sm`}>
              {(selected.name || selected.phone).charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm text-gray-900">{selected.name || selected.phone}</p>
              <p className="text-xs text-gray-400">+{selected.phone}</p>
            </div>
            <span className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full font-medium flex items-center gap-1">
              <CheckCircle size={12} /> Resolved
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#f0f0f0]"
            style={{ backgroundImage: 'radial-gradient(circle, #d4d4d4 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
            {messages.map((m) => {
              const tpl     = parseTemplateContent(m.content);
              const timeStr = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

              // System message — centered badge (intervene/resolve/reopen events)
              const isSystemMsg = m.type === 'system' ||
                (m.content?.startsWith('Intervened by ') || m.content?.startsWith('Closed by ') || m.content?.startsWith('Reopened by '));
              if (isSystemMsg) {
                return (
                  <div key={m.id} className="flex items-center justify-center my-1">
                    <span className="bg-gray-200/80 text-gray-500 text-xs px-4 py-1.5 rounded-full shadow-sm">
                      {m.content}
                    </span>
                  </div>
                );
              }

              return (
                <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  {tpl ? (
                    <div className="w-72 rounded-2xl rounded-br-sm overflow-hidden shadow-sm border border-green-100">
                      <div className="bg-[#dcf8c6] px-4 py-2.5">
                        <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{tpl.body}</p>
                        <p className="text-xs text-gray-400 text-right mt-1">{timeStr}</p>
                      </div>
                    </div>
                  ) : (
                    <div className={`max-w-xs lg:max-w-sm rounded-2xl text-sm shadow-sm overflow-hidden
                      ${m.direction === 'outbound' ? 'bg-[#dcf8c6] text-gray-800 rounded-br-sm' : 'bg-white text-gray-800 rounded-bl-sm'}`}>
                      <div className="px-3 py-2">
                        {renderMessageContent(m)}
                        <p className={`text-xs mt-1 ${m.direction === 'outbound' ? 'text-right text-gray-400' : 'text-gray-300'}`}>{timeStr}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Template picker panel */}
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
          <div className="p-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-400">24h session expired — send a template to re-engage</p>
            <button
              onClick={() => { loadTemplates(); setShowTemplates((v) => !v); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-whatsapp-green hover:bg-green-600 text-white text-xs font-semibold rounded-lg transition-colors flex-shrink-0">
              <LayoutTemplate size={13} />
              Send Template
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
