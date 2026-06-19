'use client';
import { useEffect, useState, useRef } from 'react';
import { apiFetch } from '@/hooks/useApi';
import { Send, X } from 'lucide-react';
import toast from 'react-hot-toast';

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

function toDate(ts: string) {
  if (!ts) return new Date();
  return new Date(ts.includes('Z') || ts.includes('+') ? ts : ts.replace(' ', 'T') + 'Z');
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

  const tpl = parseTpl(msg.content);
  if (tpl) return (
    <div className="flex justify-end"><TemplateBubble data={tpl} time={time} status={msg.status} /></div>
  );

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

  const text = (() => { try { const p = JSON.parse(msg.content); return p.body || p.text || msg.content; } catch { return msg.content; } })();
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] px-3 py-2 shadow-sm text-sm break-words whitespace-pre-wrap
        ${isOut
          ? 'bg-[#dcf8c6] text-gray-800 rounded-2xl rounded-br-sm'
          : 'bg-white text-gray-800 rounded-2xl rounded-tl-sm border border-gray-100'}`}>
        {renderWAText(text)}
        <p className="text-[10px] text-right mt-0.5 text-gray-400">
          {time}{isOut && tick}
        </p>
      </div>
    </div>
  );
}

export default function LeadChatPanel({ name, phone, onClose }: { name: string; phone: string; onClose: () => void }) {
  const [contactId, setContactId]     = useState<number | null>(null);
  const [messages, setMessages]       = useState<Message[]>([]);
  const [chatLoading, setChatLoading] = useState(true);
  const [msgText, setMsgText]         = useState('');
  const [sending, setSending]         = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cr = await apiFetch(`/api/contacts?search=${phone}&limit=1`);
        const contact = cr.data?.data?.[0];
        if (!contact) { toast.error('Contact not found in inbox'); onClose(); return; }
        if (cancelled) return;
        setContactId(contact.id);
        const mr = await apiFetch(`/api/messages?contactId=${contact.id}&limit=80`);
        if (!cancelled) setMessages(mr.data || []);
      } catch (e: unknown) {
        toast.error((e as Error).message || 'Failed to load chat');
        onClose();
      } finally {
        if (!cancelled) setChatLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      <div className="w-full max-w-md bg-white flex flex-col shadow-2xl">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-whatsapp-dark text-white">
          <div className="w-9 h-9 rounded-full bg-whatsapp-teal flex items-center justify-center font-bold text-sm flex-shrink-0">
            {(name || phone || '?')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{name || 'Unknown'}</p>
            <p className="text-xs text-white/60">{phone}</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <X size={20} />
          </button>
        </div>

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
  );
}
