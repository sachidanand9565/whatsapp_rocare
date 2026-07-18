'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/hooks/useApi';
import {
  ArrowLeft, RefreshCw, Play, Radio, Zap, GitBranch, ShoppingBag,
  CheckCircle, Clock, XCircle, Send, Eye, Copy, X, Reply,
  ChevronDown, Download, Tag, Ban, LayoutTemplate, AlertCircle, Paperclip, Image as ImageIcon, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import MediaLibrary, { type MediaItem as MLItem } from '@/app/components/MediaLibrary';
import { decryptId } from '@/lib/idCrypt';

// Stored datetimes are UTC ("YYYY-MM-DD HH:mm:ss"). Parse as UTC, display in IST.
function toUtcDate(s: string): Date {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(s.replace(' ', 'T') + 'Z');
}
function fmtIST(s?: string | null): string {
  if (!s) return '—';
  return toUtcDate(s).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

// ── Types ─────────────────────────────────────────────────────
interface CampaignDetail {
  id: number;
  name: string;
  campaign_type: string;
  status: string;
  template_name: string;
  language: string;
  body_text: string;
  buttons: string;
  header_type?: string;        // TEXT | IMAGE | VIDEO | DOCUMENT | none
  header_content?: string;     // stored media id / url (campaign default)
  template_vars: string; // JSON object stored as string
  total_contacts: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  created_at: string;
  started_at: string;
  completed_at: string;
  scheduled_at: string;
}
interface ContactRow {
  id: number;
  name: string;
  phone: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  error: string | null;
  sent_at: string | null;
  wamid: string | null;
  has_replied: boolean;
}
interface Counts { pending: number; sent: number; delivered: number; read: number; failed: number; replied: number }
interface DailyRow { date: string; sent: number; delivered: number; read: number; failed: number }
type TabKey = 'all' | 'sent' | 'delivered' | 'read' | 'failed' | 'pending' | 'replied';

// ── Config ────────────────────────────────────────────────────
const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  broadcast:     { label: 'Broadcast',     color: 'text-purple-700', bg: 'bg-purple-100', icon: <Radio size={12} /> },
  api:           { label: 'API',           color: 'text-blue-700',   bg: 'bg-blue-100',   icon: <Zap size={12} /> },
  drip:          { label: 'Drip',          color: 'text-orange-700', bg: 'bg-orange-100', icon: <GitBranch size={12} /> },
  transactional: { label: 'Transactional', color: 'text-teal-700',   bg: 'bg-teal-100',   icon: <ShoppingBag size={12} /> },
};
const STATUS_COLOR: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-100 text-blue-700',
  running:   'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  failed:    'bg-red-100 text-red-700',
  paused:    'bg-orange-100 text-orange-700',
};
const MSG_STATUS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:   { label: 'Pending',   color: 'text-gray-400',   icon: <Clock size={13} /> },
  sent:      { label: 'Sent',      color: 'text-blue-500',   icon: <Send size={13} /> },
  delivered: { label: 'Delivered', color: 'text-green-500',  icon: <CheckCircle size={13} /> },
  read:      { label: 'Read',      color: 'text-purple-500', icon: <Eye size={13} /> },
  failed:    { label: 'Failed',    color: 'text-red-500',    icon: <XCircle size={13} /> },
};

// ── Helpers ───────────────────────────────────────────────────
function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}
function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}
function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

// ── WhatsApp text parser (bold, italic) ───────────────────────
function parseWaText(text: string): React.ReactNode {
  if (!text) return null;
  return text.split('\n').map((line, li) => {
    const parts: React.ReactNode[] = [];
    const re = /(\*[^*\n]+\*|_[^_\n]+_)/g;
    let last = 0, k = 0, m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      const raw = m[0], inner = raw.slice(1, -1);
      parts.push(raw[0] === '*'
        ? <strong key={k++}>{inner}</strong>
        : <em key={k++}>{inner}</em>);
      last = m.index + raw.length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return <span key={li}>{parts}{li < text.split('\n').length - 1 && <br />}</span>;
  });
}

// ── WhatsApp message bubble preview ──────────────────────────
function WaBubble({ bodyText, buttons }: { bodyText: string; buttons: string }) {
  let btns: { text: string }[] = [];
  try {
    const p = typeof buttons === 'string' ? JSON.parse(buttons || '[]') : (buttons || []);
    if (Array.isArray(p)) btns = p;
  } catch { /* ignore */ }

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Bubble */}
      <div className="bg-white rounded-lg rounded-tl-none shadow-sm border border-gray-100 p-3">
        <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">
          {parseWaText(bodyText)}
        </p>
        <p className="text-right text-[10px] text-gray-400 mt-2">12:00 PM ✓✓</p>
      </div>
      {/* Buttons */}
      {btns.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-100">
          {btns.map((btn, i) => (
            <p key={i} className="px-3 py-2 text-center text-sm text-blue-500 font-medium">
              {btn.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function CampaignDetailPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = decryptId(rawId) || rawId;
  const router = useRouter();

  const [campaign, setCampaign]     = useState<CampaignDetail | null>(null);
  const [counts, setCounts]         = useState<Counts>({ pending: 0, sent: 0, delivered: 0, read: 0, failed: 0, replied: 0 });
  const [daily, setDaily]           = useState<DailyRow[]>([]);
  const [contacts, setContacts]     = useState<ContactRow[]>([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 1 });
  const [activeTab, setActiveTab]   = useState<TabKey>('all');
  const [loading, setLoading]       = useState(true);
  const [showTest, setShowTest]     = useState(false);
  const [testPhone, setTestPhone]   = useState('');
  const [testVars, setTestVars]     = useState<Record<string, string>>({});
  const [sendingTest, setSendingTest] = useState(false);
  // Test header media override (when template has IMAGE/VIDEO/DOCUMENT header)
  const [testHeaderMediaId, setTestHeaderMediaId]   = useState('');
  const [testHeaderUrl, setTestHeaderUrl]           = useState('');
  const [testHeaderFileName, setTestHeaderFileName] = useState('');
  const [testHeaderUploading, setTestHeaderUploading] = useState(false);
  const [launching, setLaunching]   = useState(false);
  const [stopping, setStopping]     = useState(false);
  const [processing, setProcessing]       = useState(false);
  const [showBulk, setShowBulk]           = useState(false);
  const [bulkContacts, setBulkContacts]   = useState<{ id: number; name: string; phone: string }[]>([]);
  const [bulkSelected, setBulkSelected]   = useState<Set<number>>(new Set());
  const [bulkAll, setBulkAll]             = useState(true);
  const [bulkLoading, setBulkLoading]     = useState(false);
  const [bulkSending, setBulkSending]     = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [selected, setSelected]             = useState<Set<number>>(new Set());
  const [selectAllPages, setSelectAllPages] = useState(false);
  const [openChat, setOpenChat]             = useState<{ phone: string; name: string } | null>(null);
  const actionsRef                          = useRef<HTMLDivElement>(null);

  // Date filter state
  const [dateFrom, setDateFrom]     = useState(daysAgoStr(7));
  const [dateTo, setDateTo]         = useState(todayStr());
  const [datePreset, setDatePreset] = useState('7d');

  // Close actions dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const load = useCallback(async (tab: TabKey, page: number, from: string, to: string) => {
    setLoading(true);
    try {
      const r = await apiFetch(
        `/api/campaigns/${id}?status=${tab}&page=${page}&limit=50&dateFrom=${from}&dateTo=${to}`
      );
      if (r.data) {
        setCampaign(r.data.campaign);
        setCounts(r.data.counts);
        setDaily(r.data.daily);
        setContacts(r.data.contacts);
        setPagination(r.data.pagination);
        setSelected(new Set());
        setSelectAllPages(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Initial load
  useEffect(() => {
    load('all', 1, daysAgoStr(7), todayStr());
  }, [load]);

  // SSE — auto-refresh stats when webhook receives delivery/read receipts
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token || !id) return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      es = new EventSource(`/api/events?token=${encodeURIComponent(token!)}`);
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as { type?: string; campaignId?: number };
          if (data.type === 'campaign_update' && String(data.campaignId) === String(id)) {
            // Coalesce bursts of delivery/read receipts (common on active broadcasts)
            // into a single trailing refresh instead of one refetch per receipt.
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              load(activeTab, pagination.page, dateFrom, dateTo);
            }, 1500);
          }
        } catch { /**/ }
      };
      es.onerror = () => {
        es?.close(); es = null;
        if (!destroyed) retryTimer = setTimeout(connect, 3000);
      };
    }

    connect();
    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      es?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function switchTab(tab: TabKey) {
    setActiveTab(tab);
    load(tab, 1, dateFrom, dateTo);
  }

  function applyPreset(preset: string) {
    setDatePreset(preset);
    let from = dateFrom;
    let to   = todayStr();
    if      (preset === 'today')     { from = todayStr();      to = todayStr(); }
    else if (preset === 'yesterday') { from = daysAgoStr(1);   to = daysAgoStr(1); }
    else if (preset === '7d')        { from = daysAgoStr(7);   to = todayStr(); }
    else if (preset === '30d')       { from = daysAgoStr(30);  to = todayStr(); }
    else if (preset === '90d')       { from = daysAgoStr(90);  to = todayStr(); }
    else if (preset === 'all_time')  { from = '2020-01-01';    to = todayStr(); }
    if (preset !== 'custom') {
      setDateFrom(from);
      setDateTo(to);
      load(activeTab, 1, from, to);
    }
  }

  function applyCustomDates() {
    load(activeTab, 1, dateFrom, dateTo);
  }

  async function launch() {
    setLaunching(true);
    try {
      const r = await apiFetch(`/api/campaigns/${id}/launch`, { method: 'POST' });
      toast.success(r.data?.message || 'Launched!');
      load(activeTab, 1, dateFrom, dateTo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Launch failed');
    } finally {
      setLaunching(false);
    }
  }

  async function processNow() {
    setProcessing(true);
    try {
      const r = await apiFetch('/api/campaigns/process', { method: 'GET' });
      toast.success(`Batch processed — ${r.data?.batchSent ?? 0} sent, ${r.data?.batchFailed ?? 0} failed`);
      load(activeTab, 1, dateFrom, dateTo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Process failed');
    } finally {
      setProcessing(false);
    }
  }

  async function openBulkModal() {
    setShowBulk(true);
    setBulkAll(true);
    setBulkSelected(new Set());
    if (bulkContacts.length === 0) {
      setBulkLoading(true);
      try {
        const r = await apiFetch('/api/contacts?limit=1000&chatStatus=all');
        setBulkContacts((r.data?.data || []).map((c: { id: number; name: string; phone: string }) => ({ id: c.id, name: c.name, phone: c.phone })));
      } catch { /* ignore */ }
      finally { setBulkLoading(false); }
    }
  }

  async function sendBulkQueue() {
    setBulkSending(true);
    try {
      const body = bulkAll ? {} : { contact_ids: [...bulkSelected] };
      const r = await apiFetch(`/api/campaigns/${id}/bulk-queue`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      toast.success(`${r.data?.queued ?? 0} contacts queued — cron will process them`);
      setShowBulk(false);
      load(activeTab, 1, dateFrom, dateTo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to queue');
    } finally {
      setBulkSending(false);
    }
  }

  async function stopCampaign() {
    setStopping(true);
    try {
      await apiFetch(`/api/campaigns/${id}/stop`, { method: 'POST' });
      toast.success('Campaign paused — remaining messages will not be sent');
      load(activeTab, 1, dateFrom, dateTo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to stop');
    } finally {
      setStopping(false);
    }
  }

  async function uploadTestHeaderFile(file: File) {
    const ALLOWED: Record<string, number> = {
      'application/pdf': 10,
      'image/jpeg':       5,
      'image/png':        5,
      'video/mp4':       16,
    };
    const maxMB = ALLOWED[file.type];
    if (!maxMB) {
      toast.error(`Unsupported file type: ${file.type || 'unknown'}. Allowed: PDF, JPG, PNG, MP4`);
      return;
    }
    if (file.size > maxMB * 1024 * 1024) {
      toast.error(`File is ${(file.size / (1024 * 1024)).toFixed(1)} MB — must be under ${maxMB} MB`);
      return;
    }
    setTestHeaderUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = localStorage.getItem('token');
      const res  = await fetch('/api/media', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setTestHeaderMediaId(data.data.mediaId);
      setTestHeaderUrl('');
      setTestHeaderFileName(file.name);
      toast.success('Header media uploaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setTestHeaderUploading(false);
    }
  }

  async function sendTest() {
    if (!testPhone.trim()) { toast.error('Phone number required'); return; }
    setSendingTest(true);
    try {
      // Override media: uploaded media id, ya pasted URL (warna API stored header_content use karega)
      const headerMedia = testHeaderMediaId || testHeaderUrl.trim() || undefined;
      await apiFetch(`/api/campaigns/${id}/test`, {
        method: 'POST',
        body: JSON.stringify({ phone: testPhone.trim(), vars: testVars, headerMedia }),
      });
      toast.success('Test message sent!');
      setShowTest(false);
      setTestPhone('');
      setTestHeaderMediaId('');
      setTestHeaderUrl('');
      setTestHeaderFileName('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send test');
    } finally {
      setSendingTest(false);
    }
  }

  // Checkbox helpers
  function toggleRow(rowId: number) {
    setSelectAllPages(false);
    setSelected(prev => {
      const next = new Set(prev);
      next.has(rowId) ? next.delete(rowId) : next.add(rowId);
      return next;
    });
  }
  function toggleAll() {
    if (selectAllPages || selected.size === contacts.length) {
      // Deselect everything
      setSelected(new Set());
      setSelectAllPages(false);
    } else {
      // Select all on current page
      setSelected(new Set(contacts.map(c => c.id)));
      setSelectAllPages(false);
    }
  }
  function confirmSelectAllPages() {
    setSelectAllPages(true);
  }

  if (!campaign && loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-whatsapp-green border-t-transparent rounded-full" />
      </div>
    );
  }
  if (!campaign) return <p className="text-gray-500 p-8">Campaign not found.</p>;

  const typeCfg = TYPE_CONFIG[campaign.campaign_type] || TYPE_CONFIG.broadcast;
  const total   = campaign.total_contacts || 0;

  // Chart series config per tab
  const CHART_SERIES: Partial<Record<TabKey, { key: string; name: string; color: string }[]>> = {
    all:       [{ key: 'sent', name: 'Sent', color: '#3b82f6' }, { key: 'delivered', name: 'Delivered', color: '#22c55e' }, { key: 'read', name: 'Read', color: '#a855f7' }],
    sent:      [{ key: 'sent',      name: 'Sent',      color: '#3b82f6' }],
    delivered: [{ key: 'delivered', name: 'Delivered', color: '#22c55e' }],
    read:      [{ key: 'read',      name: 'Read',      color: '#25D366' }],
    failed:    [{ key: 'failed',    name: 'Failed',    color: '#ef4444' }],
    pending:   [{ key: 'sent',      name: 'Sent',      color: '#9ca3af' }],
    replied:   [{ key: 'sent',      name: 'Sent',      color: '#14b8a6' }],
  };
  const activeSeries = CHART_SERIES[activeTab] ?? CHART_SERIES.all!;
  const fmtChartDate = (d: string) => {
    try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
    catch { return d; }
  };

  // Stats tabs definition
  const STAT_TABS: { key: TabKey; label: string; count: number; color: string; icon: React.ReactNode }[] = [
    { key: 'all',       label: 'Overview',  count: total,           color: 'text-gray-800',   icon: null },
    { key: 'sent',      label: 'Sent',      count: counts.sent,     color: 'text-blue-600',   icon: <CheckCircle size={12} /> },
    { key: 'delivered', label: 'Delivered', count: counts.delivered, color: 'text-green-600', icon: <CheckCircle size={12} /> },
    { key: 'read',      label: 'Read',      count: counts.read,     color: 'text-purple-600', icon: <Eye size={12} /> },
    { key: 'replied',   label: 'Replied',   count: counts.replied,  color: 'text-teal-600',   icon: <Reply size={12} /> },
    { key: 'failed',    label: 'Failed',    count: counts.failed,   color: 'text-red-500',    icon: <XCircle size={12} /> },
    { key: 'pending',   label: 'Pending',   count: counts.pending,  color: 'text-gray-400',   icon: <Clock size={12} /> },
  ];

  const allChecked  = selectAllPages || (contacts.length > 0 && selected.size === contacts.length);
  const someChecked = !selectAllPages && selected.size > 0 && selected.size < contacts.length;
  const effectiveSelected = selectAllPages ? pagination.total : selected.size;
  // Show "select all pages" banner only when current page all selected but not yet extended to all pages
  const showSelectAllBanner = !selectAllPages && contacts.length > 0 && selected.size === contacts.length && pagination.pages > 1;

  return (
    <div className="space-y-4">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => router.push('/campaigns')}
          className="text-gray-400 hover:text-gray-700 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-gray-900 flex-1 min-w-0 truncate">{campaign.name}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${typeCfg.bg} ${typeCfg.color}`}>
            {typeCfg.icon} {typeCfg.label}
          </span>
          <span className={`badge ${STATUS_COLOR[campaign.status] || 'bg-gray-100 text-gray-600'}`}>
            {campaign.status}
          </span>
          {campaign.campaign_type === 'api' && (
            <button onClick={() => setShowTest(true)}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
              <Zap size={14} /> Test
            </button>
          )}
          {/* Draft / Scheduled — show Test + Launch */}
          {campaign.campaign_type !== 'api' && ['draft', 'scheduled'].includes(campaign.status) && (
            <>
              <button
                onClick={() => {
                  try {
                    const defaultVars = JSON.parse(campaign.template_vars || '{}') as Record<string, string>;
                    setTestVars(defaultVars);
                  } catch { setTestVars({}); }
                  setShowTest(true);
                }}
                className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
                <Send size={14} /> Send Test
              </button>
              <button onClick={launch} disabled={launching}
                className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-50">
                <Play size={14} /> {launching ? 'Launching...' : 'Launch'}
              </button>
            </>
          )}

          {/* Running — show Process Now + Stop buttons */}
          {campaign.campaign_type !== 'api' && campaign.status === 'running' && (
            <>
              <button onClick={processNow} disabled={processing}
                className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-50"
                title="Manually trigger next batch (use this in local dev — on Vercel cron runs automatically)">
                {processing
                  ? <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> Processing...</>
                  : <><Play size={14} /> Process Now</>}
              </button>
              <button onClick={stopCampaign} disabled={stopping}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 rounded-lg font-semibold transition-colors disabled:opacity-50">
                {stopping
                  ? <><span className="w-3 h-3 border border-red-400 border-t-transparent rounded-full animate-spin" /> Stopping...</>
                  : <><AlertCircle size={14} /> Stop</>}
              </button>
            </>
          )}

          {/* Paused — show Resume button */}
          {campaign.campaign_type !== 'api' && campaign.status === 'paused' && (
            <button onClick={launch} disabled={launching}
              className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-50">
              <Play size={14} /> {launching ? 'Resuming...' : 'Resume'}
            </button>
          )}
          <button onClick={() => load(activeTab, 1, dateFrom, dateTo)}
            className="btn-secondary p-2" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Aisensy-style Stats Bar ─────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        <div className="flex overflow-x-auto">
          {STAT_TABS.map((tab) => {
            const pct   = total > 0 ? Math.round((tab.count / total) * 100) : 0;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => switchTab(tab.key)}
                className={`flex flex-col items-center min-w-[110px] flex-1 px-3 py-4 border-b-2 transition-colors relative
                  ${isActive ? 'border-yellow-400 bg-yellow-50/40' : 'border-transparent hover:bg-gray-50'}`}
              >
                <span className={`text-2xl font-bold leading-none ${isActive ? tab.color : 'text-gray-700'}`}>
                  {pct}%
                </span>
                <span className="text-xs text-gray-400 mt-1">({fmt(tab.count)})</span>
                <span className={`flex items-center gap-1 text-xs font-medium mt-1
                  ${isActive ? tab.color : 'text-gray-500'}`}>
                  {tab.icon} {tab.label}
                </span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-yellow-400" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Template Preview + Campaign Info + Chart ────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Left: WhatsApp template preview — 1/3 width */}
        <div className="card p-0 overflow-hidden">
          <div className="px-3 py-2 bg-[#075e54] flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <span className="text-white text-[10px] font-bold">W</span>
            </div>
            <span className="text-white text-xs font-medium truncate">WhatsApp Preview</span>
          </div>
          <div className="bg-[#e5ddd5] p-3">
            <WaBubble bodyText={campaign.body_text || ''} buttons={campaign.buttons || '[]'} />
          </div>
        </div>

        {/* Right: Campaign info + Audience chart — 2/3 width */}
        <div className="md:col-span-2 flex flex-col gap-4">

          {/* Campaign info card */}
          <div className="card p-0 overflow-hidden">
            <div className="grid grid-cols-3 divide-x divide-gray-100">
              {[
                { label: 'Campaign Type', value: typeCfg.label },
                { label: 'Message Type',  value: 'TEMPLATE (TEXT)' },
                { label: 'Template Name', value: campaign.template_name },
              ].map(({ label, value }) => (
                <div key={label} className="px-4 py-3">
                  <p className="text-xs text-gray-400 mb-1">{label}</p>
                  <p className="text-sm font-medium text-gray-800 truncate" title={value}>{value || '—'}</p>
                </div>
              ))}
            </div>
            <div className="border-t px-4 py-3">
              <p className="text-xs text-gray-400 mb-1">Created At</p>
              <p className="text-sm font-medium text-gray-800">
                {fmtIST(campaign.created_at)}
              </p>
            </div>
          </div>

          {/* Audience chart */}
          <div className="card p-0 overflow-hidden flex-1">
            <div className="flex items-center justify-between px-4 py-2.5 border-b bg-gray-50/60">
              <h2 className="font-semibold text-gray-800 text-sm">
                Audience <span className="text-gray-400 font-normal text-xs">(per day)</span>
              </h2>
              <span className="text-xs text-gray-400">
                {fmtChartDate(dateFrom)} — {fmtChartDate(dateTo)}
              </span>
            </div>
            <div className="p-3">
              {daily.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-gray-300">
                  <Send size={24} className="mb-2 opacity-40" />
                  <p className="text-xs">No data for selected period</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={daily} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      {activeSeries.map(s => (
                        <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={s.color} stopOpacity={0.28} />
                          <stop offset="95%" stopColor={s.color} stopOpacity={0}    />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: '#9ca3af' }}
                      axisLine={false} tickLine={false}
                      tickFormatter={fmtChartDate}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#9ca3af' }}
                      axisLine={false} tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                      labelFormatter={fmtChartDate}
                    />
                    {activeSeries.map(s => (
                      <Area
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        name={s.name}
                        stroke={s.color}
                        strokeWidth={2}
                        fill={`url(#grad-${s.key})`}
                        dot={{ fill: s.color, r: 3, strokeWidth: 0 }}
                        activeDot={{ r: 5 }}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Audience + Contacts Table ───────────────────────── */}
      <div className="card p-0 overflow-hidden">

        {/* Audience header */}
        <div className="flex items-center justify-between px-4 py-3 border-b flex-wrap gap-2">
          <div>
            <h2 className="font-semibold text-gray-800">Audience</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {loading
                ? 'Loading…'
                : `Message sent to ${pagination.total.toLocaleString()} contacts`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {effectiveSelected > 0 && (
              <span className="text-xs text-gray-500 font-medium">
                {effectiveSelected.toLocaleString()} selected
              </span>
            )}
            <button
              disabled={effectiveSelected === 0}
              className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
              <Send size={14} /> Broadcast
            </button>
            <div className="relative" ref={actionsRef}>
              <button
                disabled={effectiveSelected === 0}
                onClick={() => setShowActions(v => !v)}
                className="btn-secondary flex items-center gap-1 text-sm px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                Actions <ChevronDown size={14} />
              </button>
              {showActions && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 w-44 py-1">
                  <button className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-gray-50 text-left text-gray-700">
                    <Download size={14} className="text-gray-400" /> Export
                  </button>
                  <button className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-gray-50 text-left text-gray-700">
                    <Tag size={14} className="text-gray-400" /> Manage Tag
                  </button>
                  <button className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-gray-50 text-left text-red-500">
                    <Ban size={14} /> Block &amp; opt out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Date filter */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-gray-50/60 flex-wrap">
          <select
            value={datePreset}
            onChange={(e) => applyPreset(e.target.value)}
            className="input text-sm py-1.5 pl-3 pr-8 w-36 shrink-0">
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all_time">All time</option>
            <option value="custom">Custom</option>
          </select>
          <div className="flex items-center gap-1 shrink-0">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDatePreset('custom'); setDateFrom(e.target.value); }}
              className="input text-sm py-1.5 w-36"
            />
            <span className="text-gray-400 text-sm">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDatePreset('custom'); setDateTo(e.target.value); }}
              className="input text-sm py-1.5 w-36"
            />
          </div>
          {datePreset === 'custom' && (
            <button
              onClick={applyCustomDates}
              className="btn-primary text-sm px-3 py-1.5 shrink-0">
              Apply
            </button>
          )}
        </div>

        {/* Select-all-pages banner */}
        {(showSelectAllBanner || selectAllPages) && (
          <div className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100 text-sm">
            {selectAllPages ? (
              <>
                <span className="text-blue-700 font-medium">
                  Saare {pagination.total.toLocaleString()} contacts select hain.
                </span>
                <button
                  onClick={() => { setSelected(new Set()); setSelectAllPages(false); }}
                  className="text-blue-600 underline hover:text-blue-800 font-medium">
                  Clear selection
                </button>
              </>
            ) : (
              <>
                <span className="text-blue-700">
                  {contacts.length} contacts on this page are selected.
                </span>
                <button
                  onClick={confirmSelectAllPages}
                  className="text-blue-600 underline hover:text-blue-800 font-medium">
                  Select all {pagination.total.toLocaleString()} contacts
                </button>
              </>
            )}
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={el => { if (el) el.indeterminate = someChecked; }}
                    onChange={toggleAll}
                    className="rounded border-gray-300 text-whatsapp-green focus:ring-whatsapp-green"
                  />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Mobile Number</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Replied</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Sent At</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && contacts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10">
                    <div className="inline-block animate-spin w-5 h-5 border-2 border-whatsapp-green border-t-transparent rounded-full" />
                  </td>
                </tr>
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-gray-400">No records found</td>
                </tr>
              ) : (
                contacts.map((c) => {
                  const st = MSG_STATUS[c.status] || MSG_STATUS.pending;
                  const isSelected = selected.has(c.id);
                  return (
                    <tr key={c.id}
                      onClick={() => setOpenChat({ phone: c.phone, name: c.name })}
                      className={`cursor-pointer transition-colors ${isSelected ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
                      <td data-checkbox className="px-4 py-3 w-10" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(c.id)}
                          className="rounded border-gray-300 text-whatsapp-green focus:ring-whatsapp-green"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{c.phone}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 font-medium ${st.color}`}>
                          {st.icon} {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {c.has_replied ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full">
                            <Reply size={11} /> Yes
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {fmtIST(c.sent_at)}
                      </td>
                      <td className="px-4 py-3 text-red-400 text-xs max-w-xs truncate">
                        {c.error || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm">
            <span className="text-gray-400 text-xs">
              {((pagination.page - 1) * 50) + 1}–{Math.min(pagination.page * 50, pagination.total)} of {pagination.total.toLocaleString()}
            </span>
            <div className="flex gap-2">
              <button disabled={pagination.page <= 1}
                onClick={() => load(activeTab, pagination.page - 1, dateFrom, dateTo)}
                className="btn-secondary px-3 py-1 text-xs disabled:opacity-40">Prev</button>
              <button disabled={pagination.page >= pagination.pages}
                onClick={() => load(activeTab, pagination.page + 1, dateFrom, dateTo)}
                className="btn-secondary px-3 py-1 text-xs disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Chat Drawer ─────────────────────────────────────── */}
      {openChat && (
        <ChatDrawer
          phone={openChat.phone}
          name={openChat.name}
          onClose={() => setOpenChat(null)}
        />
      )}

      {/* ── Test Campaign Panel ─────────────────────────────── */}
      {showTest && campaign.campaign_type === 'api' && (
        <TestPanel campaign={campaign} onClose={() => setShowTest(false)} />
      )}


      {/* ── Broadcast / Drip Test Send Modal ─────────────────── */}
      {showTest && campaign.campaign_type !== 'api' && (() => {
        // Extract {{1}}, {{2}} vars from body_text
        const varNums = [...new Set(
          (campaign.body_text?.match(/\{\{(\d+)\}\}/g) || []).map((m) => m.replace(/\{\{|\}\}/g, ''))
        )].sort((a, b) => Number(a) - Number(b));

        return (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => setShowTest(false)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md"
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <Send size={16} className="text-whatsapp-green" /> Send Test Message
                </h3>
                <button onClick={() => setShowTest(false)} className="text-gray-400 hover:text-gray-600">
                  <X size={18} />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4">
                {/* Phone */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Phone Number <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="919876543210 (with country code)"
                    className="input text-sm w-full"
                  />
                </div>

                {/* Header media (only when template header is IMAGE/VIDEO/DOCUMENT) */}
                {['IMAGE', 'VIDEO', 'DOCUMENT'].includes((campaign.header_type || '').toUpperCase()) && (() => {
                  const ht = (campaign.header_type || '').toUpperCase();
                  return (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                        <ImageIcon size={12} /> {ht} header
                        <span className="font-normal text-gray-400">(optional — override)</span>
                      </p>
                      <label className="flex items-center gap-2 border border-dashed border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 cursor-pointer">
                        {testHeaderUploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
                        <span className="truncate">{testHeaderFileName || `Upload ${ht.toLowerCase()}`}</span>
                        <input
                          type="file"
                          className="hidden"
                          accept={ht === 'IMAGE' ? 'image/*' : ht === 'VIDEO' ? 'video/*' : '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx'}
                          disabled={testHeaderUploading}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadTestHeaderFile(f); e.target.value = ''; }}
                        />
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-400">or</span>
                        <input
                          value={testHeaderUrl}
                          onChange={(e) => { setTestHeaderUrl(e.target.value); setTestHeaderMediaId(''); setTestHeaderFileName(''); }}
                          placeholder="paste a direct media URL"
                          className="input text-xs py-1.5 flex-1"
                        />
                      </div>
                      {!testHeaderMediaId && !testHeaderUrl.trim() && campaign.header_content && (
                        <p className="text-[10px] text-gray-400">Khaali chhoda to campaign ka saved media use hoga.</p>
                      )}
                    </div>
                  );
                })()}

                {/* Template variable inputs */}
                {varNums.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-600">Template Variables</p>
                    {varNums.map((n) => (
                      <div key={n} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-8 shrink-0 text-right">{`{{${n}}}`}</span>
                        <input
                          value={testVars[n] || ''}
                          onChange={(e) => setTestVars((p) => ({ ...p, [n]: e.target.value }))}
                          placeholder={`Variable ${n}`}
                          className="input text-sm flex-1"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Preview */}
                {campaign.body_text && (
                  <div className="bg-[#dcf8c6] rounded-xl px-4 py-3 text-sm text-gray-800 whitespace-pre-wrap break-words">
                    {campaign.body_text.replace(/\{\{(\d+)\}\}/g, (_, n) => testVars[n] || `{{${n}}}`)}
                  </div>
                )}
              </div>

              <div className="px-5 pb-5 flex justify-end gap-2">
                <button onClick={() => setShowTest(false)}
                  className="btn-secondary text-sm px-4 py-2">Cancel</button>
                <button onClick={sendTest} disabled={sendingTest || !testPhone.trim()}
                  className="btn-primary text-sm px-4 py-2 flex items-center gap-1.5 disabled:opacity-50">
                  {sendingTest
                    ? <><span className="animate-spin inline-block w-3 h-3 border border-white border-t-transparent rounded-full" /> Sending...</>
                    : <><Send size={13} /> Send Test</>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const DRAWER_EMOJIS = ['😊','😂','🙏','👍','❤️','😍','🎉','👋','🤝','😅','🙂','😎','🔥','✅','⚡','💪','🌟','👌','🙌','😮','🎊','💯','🤔','😢','😃','✨','🎁','👏','💡','🫂'];

// ── Chat Drawer ────────────────────────────────────────────────
interface DrawerMsg {
  id: number;
  direction: 'inbound' | 'outbound';
  content: string;
  type: string;
  status?: string;   // sent | delivered | read | failed
  created_at: string;
}
interface DrawerContact {
  id: number;
  name: string;
  phone: string;
  status?: string;
  chat_status?: string;
  assigned_agent_name?: string;
}

function fmtMsgTime(ts: string): string {
  try {
    const d = new Date(ts.includes('Z') || ts.includes('+') ? ts : ts.replace(' ', 'T') + 'Z');
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// Parse template/media content and return a renderable React node
function renderMsgNode(msg: DrawerMsg): React.ReactNode {
  if (!msg.content) return null;
  let text = msg.content;
  try {
    const p = JSON.parse(msg.content);
    // Inbox-style template object  { __type:'template', body:'..' }
    if (p.__type === 'template') text = p.body || '';
    // App-stored template  { templateName:'..', components:[..] }
    else if (p.templateName) {
      return (
        <span className="flex items-center gap-1.5 text-gray-500 italic text-xs">
          <LayoutTemplate size={12} className="shrink-0" />
          Template: <span className="font-medium not-italic text-gray-700">{p.templateName}</span>
        </span>
      );
    }
    // Media  { __type:'media' }
    else if (p.__type === 'media') {
      const label = p.caption ? `📎 ${p.caption}` : `📎 ${msg.type}`;
      return <span className="italic text-gray-500">{label}</span>;
    }
  } catch { /* plain text */ }
  return parseWaText(text);
}

// Message status ticks (outbound only)
function MsgTick({ status }: { status?: string }) {
  if (status === 'read')      return <span className="text-blue-500 text-[11px] font-bold ml-1">✓✓</span>;
  if (status === 'delivered') return <span className="text-gray-400 text-[11px] font-bold ml-1">✓✓</span>;
  if (status === 'sent')      return <span className="text-gray-400 text-[11px] ml-1">✓</span>;
  if (status === 'failed')    return <span className="text-red-500 text-[11px] ml-1">✗</span>;
  return <span className="text-gray-300 text-[11px] ml-1">✓</span>;
}

interface DrawerTemplate { id: number; name: string; language: string; body_text: string; status: string }

function ChatDrawer({ phone, name, onClose }: { phone: string; name: string; onClose: () => void }) {
  const [contact, setContact]       = useState<DrawerContact | null>(null);
  const [messages, setMessages]     = useState<DrawerMsg[]>([]);
  const [loading, setLoading]       = useState(true);
  const [text, setText]             = useState('');
  const [sending, setSending]       = useState(false);
  const [templates, setTemplates]     = useState<DrawerTemplate[]>([]);
  const [showTpl, setShowTpl]         = useState(false);
  const [loadingTpl, setLoadingTpl]   = useState(false);
  const [sendingTpl, setSendingTpl]     = useState<number | null>(null);
  const [tplForParams, setTplForParams] = useState<DrawerTemplate | null>(null);
  const [tplParamVals, setTplParamVals] = useState<string[]>([]);
  const [showEmoji, setShowEmoji]         = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [showMediaLib, setShowMediaLib]     = useState(false);
  const bottomRef                           = useRef<HTMLDivElement>(null);
  const inputRef                          = useRef<HTMLTextAreaElement>(null);
  const emojiRef                          = useRef<HTMLDivElement>(null);

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

  async function handleMediaLibSelect(item: MLItem) {
    if (!contact) return;
    const mediaType = item.mime_type.startsWith('image/') ? 'image'
      : item.mime_type.startsWith('video/') ? 'video'
      : item.mime_type.startsWith('audio/') ? 'audio'
      : 'document';
    try {
      await apiFetch('/api/send-message', {
        method: 'POST',
        body: JSON.stringify({ contactId: contact.id, type: mediaType, mediaId: item.media_id, filename: item.filename }),
      });
      toast.success('Media sent!');
      await loadMsgs(contact.id);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to send'); }
  }

  async function sendMediaFile(file: File) {
    if (!contact) return;
    setUploadingMedia(true);
    const tid = toast.loading(`Uploading ${file.name}…`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = localStorage.getItem('token');
      const up = await fetch('/api/media', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const upData = await up.json();
      if (!up.ok) throw new Error(upData.error || 'Upload failed');

      const mediaType = file.type.startsWith('image/') ? 'image'
        : file.type.startsWith('video/') ? 'video'
        : file.type.startsWith('audio/') ? 'audio'
        : 'document';

      await apiFetch('/api/send-message', {
        method: 'POST',
        body: JSON.stringify({ contactId: contact.id, type: mediaType, mediaId: upData.data.mediaId, caption: '', filename: file.name }),
      });
      toast.success('Sent!', { id: tid });
      await loadMsgs(contact.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed', { id: tid });
    } finally {
      setUploadingMedia(false);
    }
  }

  const loadMsgs = useCallback(async (contactId: number) => {
    const r = await apiFetch(`/api/messages?contactId=${contactId}&limit=80`);
    setMessages(r.data || []);
  }, []);

  const loadTemplates = useCallback(async () => {
    if (templates.length > 0) return;
    setLoadingTpl(true);
    try {
      const r = await apiFetch('/api/templates');
      setTemplates((r.data || []).filter((t: DrawerTemplate) => t.status === 'APPROVED'));
    } finally { setLoadingTpl(false); }
  }, [templates.length]);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/api/contacts?search=${encodeURIComponent(phone)}&limit=1`)
      .then(async (r) => {
        const c: DrawerContact | undefined = (r.data?.data || [])[0];
        if (c) { setContact(c); await loadMsgs(c.id); }
      })
      .catch(() => toast.error('Failed to load chat'))
      .finally(() => setLoading(false));
  }, [phone, loadMsgs]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Tracks the highest message id loaded, for incremental SSE-driven fetches
  const lastMsgIdRef = useRef(0);
  useEffect(() => {
    if (messages.length > 0) lastMsgIdRef.current = messages[messages.length - 1].id;
  }, [messages]);

  // Real-time updates via SSE — replaces the old 8s poll so no repeated
  // /api/messages calls hit the network while this drawer is idle.
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token || !contact) return;
    const contactId = contact.id;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      es = new EventSource(`/api/events?token=${encodeURIComponent(token!)}`);
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as { type?: string; contactId?: number };
          if (data.type === 'new_message' && data.contactId === contactId) {
            const lastId = lastMsgIdRef.current;
            if (lastId > 0) {
              apiFetch(`/api/messages?contactId=${contactId}&afterId=${lastId}&limit=20`)
                .then((r) => {
                  const newMsgs: DrawerMsg[] = r.data || [];
                  if (newMsgs.length > 0) {
                    setMessages(prev => {
                      const existingIds = new Set(prev.map((m) => m.id));
                      const toAdd = newMsgs.filter((m) => !existingIds.has(m.id));
                      return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
                    });
                  }
                }).catch(() => {});
            } else {
              loadMsgs(contactId);
            }
          }
        } catch { /* ignore malformed frames */ }
      };
      es.onerror = () => {
        es?.close(); es = null;
        if (!destroyed) retryTimer = setTimeout(connect, 3000);
      };
    }

    connect();
    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [contact, loadMsgs]);

  // 24-hour window: open only when customer sends an inbound message within 24h
  const isWindowOpen = messages.some((m) => {
    const ts = m.created_at;
    const d  = new Date(ts.includes('Z') || ts.includes('+') ? ts : ts.replace(' ', 'T') + 'Z');
    return m.direction === 'inbound' && Date.now() - d.getTime() < 24 * 60 * 60 * 1000;
  });

  async function sendMsg() {
    if (!text.trim() || !contact) return;
    setSending(true);
    try {
      await apiFetch('/api/send-message', {
        method: 'POST',
        body: JSON.stringify({ contactId: contact.id, type: 'text', text: text.trim() }),
      });
      setText('');
      await loadMsgs(contact.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  async function sendTemplate(tpl: DrawerTemplate, params: string[] = []) {
    if (!contact) return;
    setSendingTpl(tpl.id);
    try {
      await apiFetch('/api/send-message', {
        method: 'POST',
        body: JSON.stringify({ contactId: contact.id, type: 'template', templateName: tpl.name, language: tpl.language, templateParams: params }),
      });
      toast.success('Template sent!');
      setShowTpl(false);
      setTplForParams(null);
      setTplParamVals([]);
      await loadMsgs(contact.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send template');
    } finally {
      setSendingTpl(null);
    }
  }

  const initials = name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <>
      {/* Media Library (z-60 so it's above the drawer) */}
      {showMediaLib && (
        <MediaLibrary
          onSelect={(item) => { handleMediaLibSelect(item); setShowMediaLib(false); }}
          onClose={() => setShowMediaLib(false)}
        />
      )}

      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Drawer — wider: 720px total */}
      <div className="fixed inset-y-0 right-0 z-50 flex shadow-2xl" style={{ width: 'min(720px, 100vw)' }}>

        {/* ── Chat column ─────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0 bg-white">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 bg-[#075e54] text-white shrink-0">
            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center font-bold text-sm shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{name}</p>
              <p className="text-xs text-white/70">+{phone}</p>
            </div>
            {contact && (
              <button onClick={() => loadMsgs(contact.id)}
                className="p-1.5 hover:bg-white/10 rounded-full transition-colors" title="Refresh">
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-full transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto bg-[#e5ddd5] px-4 py-3 space-y-1.5">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin w-6 h-6 border-2 border-whatsapp-green border-t-transparent rounded-full" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
                <Send size={28} className="opacity-30" />
                <p className="text-sm">No messages yet</p>
              </div>
            ) : (
              messages.map((msg) => {
                const isOut = msg.direction === 'outbound';
                return (
                  <div key={msg.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[78%] rounded-xl px-3 py-2 text-sm shadow-sm
                      ${isOut ? 'bg-[#dcf8c6] rounded-br-sm' : 'bg-white rounded-bl-sm'}`}>
                      <div className="whitespace-pre-wrap break-words text-gray-800 leading-snug">
                        {renderMsgNode(msg)}
                      </div>
                      {/* Time + status tick */}
                      <div className="flex items-center justify-end gap-0.5 mt-1">
                        <span className="text-[10px] text-gray-400 leading-none">
                          {fmtMsgTime(msg.created_at)}
                        </span>
                        {isOut && <MsgTick status={msg.status} />}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input area — depends on 24hr window */}
          {!loading && (
            isWindowOpen ? (
              /* Window OPEN → rich text input */
              <div className="border-t bg-white shrink-0 relative">
                {/* Emoji picker */}
                {showEmoji && (
                  <div ref={emojiRef}
                    className="absolute bottom-full left-3 mb-1 bg-white border border-gray-200 rounded-xl shadow-xl p-2 grid grid-cols-8 gap-0.5 z-30 w-64">
                    {DRAWER_EMOJIS.map(em => (
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
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } }}
                    placeholder="Type a message…"
                    rows={2}
                    disabled={sending}
                    className="w-full resize-none text-sm bg-transparent outline-none text-gray-800 placeholder-gray-400 leading-snug disabled:opacity-50"
                    style={{ maxHeight: 110 }}
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
                      <ImageIcon size={15} />
                    </button>
                    <label title="Upload & send file" className={`p-1.5 rounded hover:bg-gray-100 cursor-pointer transition-colors ${uploadingMedia ? 'text-gray-300 pointer-events-none' : 'text-gray-500'}`}>
                      <Paperclip size={15} />
                      <input type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) sendMediaFile(f); e.target.value = ''; }} />
                    </label>
                  </div>
                  <button onClick={sendMsg} disabled={sending || !text.trim()}
                    className="btn-primary px-4 py-1.5 text-sm flex items-center gap-1.5 disabled:opacity-50">
                    {sending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />} Send
                  </button>
                </div>
              </div>
            ) : (
              /* Window CLOSED → template only */
              <div className="border-t bg-white shrink-0">
                {/* Notice bar */}
                <div className="flex items-center justify-center gap-1.5 px-4 py-2 bg-amber-50 border-b border-amber-100">
                  <AlertCircle size={13} className="text-amber-500 shrink-0" />
                  <p className="text-xs text-amber-700">24hr window closed — only templates can be sent</p>
                </div>

                {!showTpl ? (
                  /* Send Template button */
                  <div className="flex justify-center px-4 py-3">
                    <button onClick={() => { setShowTpl(true); loadTemplates(); }}
                      className="btn-primary flex items-center gap-2 text-sm px-5 py-2">
                      <LayoutTemplate size={15} /> Send Template
                    </button>
                  </div>
                ) : tplForParams ? (
                  /* ── Params form ── */
                  <>
                    <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setTplForParams(null)} className="text-gray-400 hover:text-gray-600">
                          <ArrowLeft size={14} />
                        </button>
                        <p className="text-xs font-semibold text-gray-700">Parameters</p>
                      </div>
                      <button onClick={() => { setShowTpl(false); setTplForParams(null); }}>
                        <X size={14} className="text-gray-400 hover:text-gray-600" />
                      </button>
                    </div>
                    <div className="overflow-y-auto max-h-64 p-3 space-y-2.5">
                      {tplParamVals.map((val, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs font-mono text-gray-400 w-10 shrink-0 text-right">{`{{${i+1}}}`}</span>
                          <input value={val}
                            onChange={e => { const n = [...tplParamVals]; n[i] = e.target.value; setTplParamVals(n); }}
                            placeholder="value"
                            className="input text-sm py-1.5 flex-1" />
                        </div>
                      ))}
                      {/* Preview */}
                      <div className="border-t pt-2.5 mt-1">
                        <p className="text-[11px] font-semibold text-gray-400 flex items-center gap-1 mb-1.5">
                          <Eye size={11} /> Preview
                        </p>
                        <div className="bg-[#dcf8c6] rounded-xl rounded-br-sm px-3 py-2 text-sm text-gray-800 leading-snug whitespace-pre-wrap shadow-sm">
                          {parseWaText(tplParamVals.reduce(
                            (t, v, i) => t.replace(new RegExp(`\\{\\{${i+1}\\}\\}`, 'g'), v || `{{${i+1}}}`),
                            tplForParams.body_text
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="px-3 py-2 border-t flex gap-2">
                      <button onClick={() => setTplForParams(null)} className="btn-secondary flex-1 text-sm">Back</button>
                      <button onClick={() => sendTemplate(tplForParams, tplParamVals)}
                        disabled={sendingTpl === tplForParams.id}
                        className="btn-primary flex-1 text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                        {sendingTpl === tplForParams.id
                          ? <RefreshCw size={13} className="animate-spin" />
                          : <Send size={13} />} Send
                      </button>
                    </div>
                  </>
                ) : (
                  /* ── Template list ── */
                  <div className="max-h-56 overflow-y-auto">
                    <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                      <p className="text-xs font-semibold text-gray-600">Select Template</p>
                      <button onClick={() => setShowTpl(false)}><X size={14} className="text-gray-400 hover:text-gray-600" /></button>
                    </div>
                    {loadingTpl ? (
                      <div className="flex justify-center py-4">
                        <RefreshCw size={16} className="animate-spin text-gray-400" />
                      </div>
                    ) : templates.length === 0 ? (
                      <p className="text-center text-gray-400 text-xs py-4">No approved templates</p>
                    ) : (
                      templates.map((tpl) => {
                        const vc = (tpl.body_text?.match(/\{\{(\d+)\}\}/g) || []).length;
                        return (
                          <button key={tpl.id}
                            onClick={() => {
                              if (vc > 0) { setTplForParams(tpl); setTplParamVals(Array(Math.max(...(tpl.body_text?.match(/\{\{(\d+)\}\}/g) || ['{{1}}']).map(m => parseInt(m.replace(/\{\{|\}\}/g, ''))))).fill('')); }
                              else sendTemplate(tpl);
                            }}
                            disabled={sendingTpl === tpl.id}
                            className="w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-gray-800 truncate">{tpl.name}</p>
                              {sendingTpl === tpl.id
                                ? <RefreshCw size={12} className="animate-spin text-gray-400" />
                                : vc > 0
                                  ? <span className="text-[10px] text-blue-400 font-medium shrink-0">{vc} vars</span>
                                  : <span className="text-[10px] text-gray-400 shrink-0 uppercase">{tpl.language}</span>}
                            </div>
                            <p className="text-xs text-gray-400 truncate mt-0.5">{tpl.body_text}</p>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )
          )}
        </div>

        {/* ── Profile column ──────────────────────────── */}
        {contact && (
          <div className="w-48 shrink-0 bg-white border-l border-gray-200 overflow-y-auto flex flex-col">
            {/* Avatar */}
            <div className="flex flex-col items-center py-5 px-3 border-b gap-2 bg-gray-50">
              <div className="w-14 h-14 rounded-full bg-orange-400 flex items-center justify-center text-white text-xl font-bold">
                {initials}
              </div>
              <p className="font-semibold text-gray-800 text-sm text-center leading-tight">{contact.name || name}</p>
              <p className="text-xs text-gray-500">+{contact.phone}</p>
            </div>
            {/* Info rows */}
            <div className="divide-y divide-gray-100 text-xs flex-1">
              {[
                { label: 'Status',  value: contact.status     || 'active' },
                { label: 'Chat',    value: contact.chat_status || 'open'   },
                { label: 'Agent',   value: contact.assigned_agent_name || '—' },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col px-3 py-2.5 gap-0.5">
                  <span className="text-gray-400">{label}</span>
                  <span className="font-medium text-gray-700 capitalize">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Test Campaign Panel ────────────────────────────────────────
const VAR_DEFAULTS = ['$FirstName', '$LastName', '$Phone', '$Email', '$CompanyName'];

function buildDefaultParams(bodyText: string): string {
  const matches = bodyText?.match(/\{\{(\d+)\}\}/g) || [];
  const count   = [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, '')))].length;
  if (count === 0) return '[]';
  const arr = Array.from({ length: count }, (_, i) => VAR_DEFAULTS[i] || `Value${i + 1}`);
  return JSON.stringify(arr, null, 2);
}

function buildFallback(params: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  params.forEach((v) => {
    const m = v.match(/^\$(\w+)$/);
    if (m) map[m[1]] = m[1].toLowerCase();
  });
  return map;
}

function TestPanel({ campaign, onClose }: { campaign: CampaignDetail; onClose: () => void }) {
  const defaultParams         = buildDefaultParams(campaign.body_text);
  const [phone, setPhone]     = useState('');
  const [vars, setVars]       = useState(defaultParams);
  const [sending, setSending] = useState(false);
  const [wsApiKey, setWsApiKey] = useState<string>('');
  // Header media override (when template has IMAGE/VIDEO/DOCUMENT header)
  const headerType = (campaign.header_type || '').toUpperCase();
  const hasMediaHeader = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType);
  const [mediaId, setMediaId]             = useState('');
  const [mediaUrl, setMediaUrl]           = useState('');
  const [mediaFileName, setMediaFileName] = useState('');
  const [uploadingMedia, setUploadingMedia] = useState(false);

  async function uploadHeaderFile(file: File) {
    const ALLOWED: Record<string, number> = {
      'application/pdf': 10, 'image/jpeg': 5, 'image/png': 5, 'video/mp4': 16,
    };
    const maxMB = ALLOWED[file.type];
    if (!maxMB) { toast.error(`Unsupported file type: ${file.type || 'unknown'}. Allowed: PDF, JPG, PNG, MP4`); return; }
    if (file.size > maxMB * 1024 * 1024) { toast.error(`File is ${(file.size / (1024 * 1024)).toFixed(1)} MB — must be under ${maxMB} MB`); return; }
    setUploadingMedia(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = localStorage.getItem('token');
      const res  = await fetch('/api/media', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setMediaId(data.data.mediaId);
      setMediaUrl('');
      setMediaFileName(file.name);
      toast.success('Header media uploaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingMedia(false);
    }
  }

  // Media object for request/cURL: uploaded id, ya pasted url, warna empty (saved media use hoga)
  const mediaPayload: Record<string, string> = mediaId ? { id: mediaId } : mediaUrl.trim() ? { url: mediaUrl.trim() } : {};

  useEffect(() => {
    apiFetch('/api/workspace/api-key').then((r) => {
      if (r.data?.api_key) setWsApiKey(r.data.api_key);
    }).catch(() => {});
  }, []);

  const endpoint = typeof window !== 'undefined'
    ? `${window.location.origin}/api/campaigns/send`
    : '/api/campaigns/send';

  let parsedParams: string[] = [];
  try { parsedParams = JSON.parse(vars); } catch { /* shown in UI */ }

  const bodyObj = {
    apiKey:              wsApiKey || 'YOUR_WORKSPACE_API_KEY',
    campaignName:        campaign.name,
    destination:         phone || '919876543210',
    userName:            'YOUR_BRAND_NAME',
    templateParams:      parsedParams,
    source:              'api',
    media:               mediaPayload,
    buttons:             [],
    carouselCards:       [],
    location:            {},
    attributes:          {},
    paramsFallbackValue: buildFallback(parsedParams),
  };

  const curlCmd = `curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(bodyObj, null, 2)}'`;

  async function sendTest() {
    if (!phone) { toast.error('Enter WhatsApp number'); return; }
    let templateParams: string[] = [];
    try { templateParams = JSON.parse(vars); } catch { toast.error('templateParams is not valid JSON array'); return; }
    if (!Array.isArray(templateParams)) { toast.error('templateParams must be a JSON array like ["John"]'); return; }
    setSending(true);
    try {
      await apiFetch('/api/campaigns/send', {
        method: 'POST',
        body:   JSON.stringify({
          campaignName:        campaign.name,
          destination:         phone,
          templateParams,
          paramsFallbackValue: buildFallback(templateParams),
          ...(Object.keys(mediaPayload).length > 0 ? { media: mediaPayload } : {}),
        }),
      });
      toast.success(`Message sent to ${phone}!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full sm:max-w-lg flex flex-col max-h-[92dvh] sm:max-h-[90vh]">
        <div className="flex items-center justify-between px-4 py-3 sm:p-5 border-b shrink-0">
          <h2 className="font-bold text-base sm:text-lg flex items-center gap-2">
            <Zap size={16} className="text-blue-500" /> Test API Campaign
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={20} /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="bg-gray-50 rounded-lg px-3 py-2 min-w-0">
              <p className="text-gray-400 text-xs mb-0.5">Campaign</p>
              <p className="font-medium text-gray-800 truncate text-xs sm:text-sm">{campaign.name}</p>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 min-w-0">
              <p className="text-gray-400 text-xs mb-0.5">Template</p>
              <p className="font-medium text-gray-800 truncate text-xs sm:text-sm">{campaign.template_name}</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              WhatsApp Number{' '}
              <span className="text-gray-400 font-normal text-xs">(with country code, no +)</span>
            </label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)}
              className="input font-mono text-sm w-full" placeholder="919876543210" />
          </div>

          {/* Header media (only when template header is IMAGE/VIDEO/DOCUMENT) */}
          {hasMediaHeader && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                <ImageIcon size={13} /> {headerType} header{' '}
                <span className="text-gray-400 font-normal text-xs">(optional — override)</span>
              </label>
              <label className="flex items-center gap-2 border border-dashed border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 cursor-pointer">
                {uploadingMedia ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
                <span className="truncate">{mediaFileName || `Upload ${headerType.toLowerCase()}`}</span>
                <input
                  type="file"
                  className="hidden"
                  accept={headerType === 'IMAGE' ? 'image/*' : headerType === 'VIDEO' ? 'video/*' : '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx'}
                  disabled={uploadingMedia}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadHeaderFile(f); e.target.value = ''; }}
                />
              </label>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] text-gray-400">or</span>
                <input
                  value={mediaUrl}
                  onChange={(e) => { setMediaUrl(e.target.value); setMediaId(''); setMediaFileName(''); }}
                  placeholder="paste a direct media URL"
                  className="input text-xs py-1.5 flex-1"
                />
              </div>
              {!mediaId && !mediaUrl.trim() && campaign.header_content && (
                <p className="text-[10px] text-gray-400 mt-1">Khaali chhoda to campaign ka saved media use hoga.</p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Template Params{' '}
              <span className="text-gray-400 font-normal text-xs">(JSON array — positional)</span>
            </label>
            <textarea value={vars} onChange={(e) => setVars(e.target.value)}
              className="input font-mono text-xs resize-none w-full" rows={3}
              placeholder={'["John", "Order#123"]'} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-gray-500">cURL</p>
              <button onClick={() => { navigator.clipboard.writeText(curlCmd); toast.success('cURL copied!'); }}
                className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 py-1 px-2 rounded">
                <Copy size={12} /> Copy cURL
              </button>
            </div>
            <pre className="bg-gray-900 text-green-400 text-[11px] p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
              {curlCmd}
            </pre>
          </div>
        </div>

        <div className="flex gap-3 px-4 py-3 sm:p-5 border-t shrink-0 bg-white">
          <button onClick={onClose} className="btn-secondary flex-1 text-sm">Cancel</button>
          <button onClick={sendTest} disabled={sending}
            className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50 text-sm">
            {sending ? <><RefreshCw size={14} className="animate-spin" /> Sending...</> : <><Send size={14} /> Send Test</>}
          </button>
        </div>
      </div>
    </div>
  );
}
