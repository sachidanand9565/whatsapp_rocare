'use client';
import { useEffect, useState, useMemo } from 'react';
import { apiFetch } from '@/hooks/useApi';
import {
  Plus, CheckCircle, Clock, XCircle, X,
  Image, FileText, Video, AlignLeft,
  Link2, Phone, MessageSquare, Eye, RefreshCw, Copy, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Template } from '@/types';

// ─── Types ───────────────────────────────────────────────────
type ButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
interface Button {
  type:      ButtonType;
  text:      string;
  url?:      string;
  url_type?: 'static' | 'dynamic';
  phone?:    string;
}
interface TemplateForm {
  name:           string;
  language:       string;
  category:       string;
  header_type:    'NONE' | 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO';
  header_content: string;
  body_text:      string;
  footer_text:    string;
}

// ─── Safe JSON parse for DB columns (mysql2 returns JSON as string) ──
function parseJsonColumn<T>(val: unknown, fallback: T): T {
  if (Array.isArray(val)) return val as T;
  if (typeof val === 'string') {
    try { return JSON.parse(val) as T; } catch { return fallback; }
  }
  return fallback;
}

// ─── Constants ───────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string; border: string }> = {
  APPROVED: { icon: <CheckCircle size={13} />, color: 'text-green-700',  bg: 'bg-green-100',  border: 'border-green-200' },
  PENDING:  { icon: <Clock       size={13} />, color: 'text-yellow-700', bg: 'bg-yellow-100', border: 'border-yellow-200' },
  REJECTED: { icon: <XCircle     size={13} />, color: 'text-red-700',    bg: 'bg-red-100',    border: 'border-red-200' },
  PAUSED:   { icon: <Clock       size={13} />, color: 'text-gray-600',   bg: 'bg-gray-100',   border: 'border-gray-200' },
};

const TABS = [
  { key: 'ALL',      label: 'All',      color: 'text-gray-700' },
  { key: 'PENDING',  label: 'Pending',  color: 'text-yellow-700' },
  { key: 'APPROVED', label: 'Approved', color: 'text-green-700' },
  { key: 'REJECTED', label: 'Rejected', color: 'text-red-700' },
];

const HEADER_TYPE_OPTIONS = [
  { value: 'NONE',     label: 'None',     icon: <X size={15} /> },
  { value: 'TEXT',     label: 'Text',     icon: <AlignLeft size={15} /> },
  { value: 'IMAGE',    label: 'Image',    icon: <Image size={15} /> },
  { value: 'DOCUMENT', label: 'Document', icon: <FileText size={15} /> },
  { value: 'VIDEO',    label: 'Video',    icon: <Video size={15} /> },
];

const CATEGORY_COLORS: Record<string, string> = {
  MARKETING:      'bg-purple-100 text-purple-700',
  UTILITY:        'bg-blue-100 text-blue-700',
  AUTHENTICATION: 'bg-orange-100 text-orange-700',
};

function extractVariables(text: string): string[] {
  const matches = text.match(/\{\{(\d+)\}\}/g) || [];
  const nums = [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, '')))];
  return nums.sort((a, b) => Number(a) - Number(b)).map((n) => `{{${n}}}`);
}

// ════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════
export default function TemplatesPage() {
  const [templates, setTemplates]     = useState<Template[]>([]);
  const [loading, setLoading]         = useState(true);
  const [syncing, setSyncing]         = useState(false);
  const [activeTab, setActiveTab]     = useState('ALL');
  const [showCreate, setShowCreate]   = useState(false);
  const [previewTpl, setPreviewTpl]   = useState<Template | null>(null);
  const [copyTpl, setCopyTpl]         = useState<Template | null>(null);
  const [deletingId, setDeletingId]   = useState<number | null>(null);

  function load() {
    setLoading(true);
    apiFetch('/api/templates')
      .then((r) => setTemplates(r.data || []))
      .finally(() => setLoading(false));
  }

  async function syncFromMeta() {
    setSyncing(true);
    try {
      const token = localStorage.getItem('token');
      const res   = await fetch('/api/templates/sync', {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Sync failed');
        return;
      }

      const { updated, changes, message } = data.data;

      if (changes?.length > 0) {
        // Show each change
        changes.forEach((c: { name: string; old_status: string; new_status: string; old_category: string; new_category: string }) => {
          const parts: string[] = [];
          if (c.old_status   !== c.new_status)   parts.push(`Status: ${c.old_status} → ${c.new_status}`);
          if (c.old_category !== c.new_category) parts.push(`Category: ${c.old_category} → ${c.new_category}`);
          toast.success(`"${c.name}"\n${parts.join(' · ')}`, { duration: 5000 });
        });
      } else {
        toast.success(message || 'Synced successfully');
      }

      load(); // Refresh list
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync error');
    } finally {
      setSyncing(false);
    }
  }

  async function deleteTemplate(id: number, name: string) {
    if (!confirm(`Delete template "${name}"? This will also remove it from Meta.`)) return;
    setDeletingId(id);
    try {
      const token = localStorage.getItem('token');
      const res   = await fetch(`/api/templates/${id}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Delete failed', { duration: 6000 }); return; }
      toast.success('Template deleted');
      load();
    } catch {
      toast.error('Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => { load(); }, []);

  // Filter by tab
  const filtered = useMemo(() =>
    activeTab === 'ALL' ? templates : templates.filter((t) => t.status === activeTab),
    [templates, activeTab]
  );

  // Count per tab
  const counts = useMemo(() => ({
    ALL:      templates.length,
    PENDING:  templates.filter((t) => t.status === 'PENDING').length,
    APPROVED: templates.filter((t) => t.status === 'APPROVED').length,
    REJECTED: templates.filter((t) => t.status === 'REJECTED').length,
  }), [templates]);

  return (
    <div className="space-y-5">

      {/* ── Page header ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Message Templates</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Templates require Meta approval before use in campaigns.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Sync button */}
          <button
            onClick={syncFromMeta}
            disabled={syncing}
            title="Sync status & category from Meta"
            className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-60">
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing...' : 'Sync from Meta'}
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> New Template
          </button>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-gray-200">
          {TABS.map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors
                ${activeTab === tab.key
                  ? 'border-whatsapp-green text-whatsapp-dark bg-green-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
              {tab.label}
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold
                ${activeTab === tab.key ? 'bg-whatsapp-green text-white' : 'bg-gray-100 text-gray-500'}`}>
                {counts[tab.key as keyof typeof counts]}
              </span>
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-whatsapp-green border-t-transparent rounded-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📝</div>
            <p className="text-gray-600 font-medium">No {activeTab !== 'ALL' ? activeTab.toLowerCase() : ''} templates</p>
            {activeTab === 'ALL' && (
              <button onClick={() => setShowCreate(true)} className="btn-primary mt-4 text-sm">
                Create First Template
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-5 py-3 font-semibold text-gray-600 w-[220px]">Template Name</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Category</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Language</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Type</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Variables</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Buttons</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Created</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((t) => {
                  const sc      = STATUS_CONFIG[t.status] || STATUS_CONFIG.PENDING;
                  const buttons: Button[] = parseJsonColumn<Button[]>(t.buttons, []);
                  const vars:    string[] = parseJsonColumn<string[]>(t.variables, []);
                  return (
                    <tr key={t.id} className="hover:bg-gray-50 transition-colors group">

                      {/* Name */}
                      <td className="px-5 py-3.5">
                        <p className="font-semibold text-gray-900">{t.name}</p>
                        {t.meta_template_id && (
                          <p className="text-xs text-gray-400 font-mono mt-0.5">ID: {t.meta_template_id}</p>
                        )}
                      </td>

                      {/* Category */}
                      <td className="px-4 py-3.5">
                        <span className={`badge ${CATEGORY_COLORS[t.category] || 'bg-gray-100 text-gray-600'}`}>
                          {t.category}
                        </span>
                      </td>

                      {/* Language */}
                      <td className="px-4 py-3.5 text-gray-600 uppercase text-xs font-medium">
                        {t.language}
                      </td>

                      {/* Header type */}
                      <td className="px-4 py-3.5">
                        {t.header_type && t.header_type !== 'NONE' ? (
                          <span className={`badge flex items-center gap-1.5 w-fit
                            ${t.header_type === 'IMAGE'    ? 'bg-blue-100 text-blue-700' :
                              t.header_type === 'DOCUMENT' ? 'bg-orange-100 text-orange-700' :
                              t.header_type === 'VIDEO'    ? 'bg-purple-100 text-purple-700' :
                                                             'bg-gray-100 text-gray-600'}`}>
                            {t.header_type === 'IMAGE'    && <Image     size={11} />}
                            {t.header_type === 'DOCUMENT' && <FileText  size={11} />}
                            {t.header_type === 'VIDEO'    && <Video     size={11} />}
                            {t.header_type === 'TEXT'     && <AlignLeft size={11} />}
                            {t.header_type}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">None</span>
                        )}
                      </td>

                      {/* Variables */}
                      <td className="px-4 py-3.5">
                        {vars.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {vars.slice(0, 3).map((v, i) => (
                              <span key={i} className="badge bg-purple-100 text-purple-700 font-mono">{v}</span>
                            ))}
                            {vars.length > 3 && (
                              <span className="badge bg-gray-100 text-gray-500">+{vars.length - 3}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>

                      {/* Buttons */}
                      <td className="px-4 py-3.5">
                        {buttons.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {buttons.map((b, i) => (
                              <span key={i} className={`badge text-xs
                                ${b.type === 'QUICK_REPLY'  ? 'bg-teal-100 text-teal-700' :
                                  b.type === 'URL'           ? 'bg-blue-100 text-blue-700' :
                                                               'bg-green-100 text-green-700'}`}>
                                {b.type === 'URL'           && <Link2  size={10} className="mr-1 inline" />}
                                {b.type === 'PHONE_NUMBER'  && <Phone  size={10} className="mr-1 inline" />}
                                {b.type === 'QUICK_REPLY'   && <MessageSquare size={10} className="mr-1 inline" />}
                                {b.text}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">
                        <span className={`badge border flex items-center gap-1 w-fit ${sc.bg} ${sc.color} ${sc.border}`}>
                          {sc.icon}
                          {t.status}
                        </span>
                      </td>

                      {/* Created */}
                      <td className="px-4 py-3.5 text-gray-400 text-xs whitespace-nowrap">
                        {new Date(t.created_at).toLocaleDateString('en-IN', {
                          day: '2-digit', month: 'short', year: 'numeric',
                        })}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setPreviewTpl(t)}
                            title="Preview"
                            className="inline-flex items-center gap-1 text-xs font-medium bg-whatsapp-green hover:bg-whatsapp-teal text-white px-2.5 py-1.5 rounded-lg transition-colors">
                            <Eye size={13} /> Preview
                          </button>
                          <button
                            onClick={() => setCopyTpl(t)}
                            title="Copy template"
                            className="inline-flex items-center gap-1 text-xs font-medium bg-blue-100 hover:bg-blue-200 text-blue-700 px-2.5 py-1.5 rounded-lg transition-colors">
                            <Copy size={13} /> Copy
                          </button>
                          <button
                            onClick={() => deleteTemplate(t.id, t.name)}
                            disabled={deletingId === t.id}
                            title="Delete template"
                            className="inline-flex items-center gap-1 text-xs font-medium bg-red-100 hover:bg-red-200 text-red-700 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                            {deletingId === t.id
                              ? <div className="w-3 h-3 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                              : <Trash2 size={13} />}
                            Delete
                          </button>
                        </div>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────── */}
      {showCreate && (
        <TemplateModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load(); }}
        />
      )}
      {copyTpl && (
        <TemplateModal
          initialData={copyTpl}
          onClose={() => setCopyTpl(null)}
          onSaved={() => { setCopyTpl(null); load(); }}
        />
      )}
      {previewTpl && (
        <TemplatePreviewModal template={previewTpl} onClose={() => setPreviewTpl(null)} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// PREVIEW MODAL
// ════════════════════════════════════════════════════════════
function TemplatePreviewModal({ template: t, onClose }: { template: Template; onClose: () => void }) {
  const sc      = STATUS_CONFIG[t.status] || STATUS_CONFIG.PENDING;
  const buttons: Button[] = parseJsonColumn<Button[]>(t.buttons, []);
  const vars:    string[] = parseJsonColumn<string[]>(t.variables, []);

  const headerEmoji: Record<string, string> = {
    IMAGE: '🖼️', DOCUMENT: '📄', VIDEO: '🎬',
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:rounded-2xl sm:max-w-md shadow-2xl flex flex-col max-h-[92vh] rounded-t-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="min-w-0 mr-3">
            <h2 className="font-bold text-gray-900 truncate">{t.name}</h2>
            <p className="text-xs text-gray-400 mt-0.5 uppercase tracking-wide">{t.language} · {t.category}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`badge border flex items-center gap-1 ${sc.bg} ${sc.color} ${sc.border}`}>
              {sc.icon} {t.status}
            </span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Phone preview — scrollable */}
        <div className="overflow-y-auto flex-1 p-4 sm:p-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4 text-center">
            WhatsApp Preview
          </p>

          {/* WhatsApp background */}
          <div className="bg-[#ECE5DD] rounded-2xl p-4 min-h-[200px]">

            {/* Bubble */}
            <div className="bg-white rounded-xl rounded-tl-sm shadow-md max-w-[85%] overflow-hidden">

              {/* Header section */}
              {t.header_content && (
                <div>
                  {t.header_type === 'TEXT' && (
                    <div className="px-3 pt-3">
                      <p className="font-bold text-gray-900 text-sm">{t.header_content}</p>
                    </div>
                  )}
                  {t.header_type === 'IMAGE' && (
                    <div className="bg-gradient-to-br from-gray-200 to-gray-300 h-36 flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-3xl">🖼️</div>
                        <p className="text-xs text-gray-500 mt-1">Image</p>
                      </div>
                    </div>
                  )}
                  {t.header_type === 'DOCUMENT' && (
                    <div className="bg-gray-100 px-3 py-3 flex items-center gap-3 border-b border-gray-200">
                      <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <FileText size={20} className="text-red-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">document.pdf</p>
                        <p className="text-xs text-gray-400">PDF Document</p>
                      </div>
                    </div>
                  )}
                  {t.header_type === 'VIDEO' && (
                    <div className="bg-gray-900 h-36 flex items-center justify-center relative">
                      <div className="text-center">
                        <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto">
                          <div className="w-0 h-0 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent border-l-[14px] border-l-white ml-1" />
                        </div>
                        <p className="text-xs text-white/70 mt-2">Video</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Body */}
              <div className="px-3 py-2.5 space-y-1">
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{t.body_text}</p>

                {/* Footer */}
                {t.footer_text && (
                  <p className="text-xs text-gray-400 mt-1 pt-1 border-t border-gray-100">{t.footer_text}</p>
                )}

                {/* Timestamp */}
                <p className="text-xs text-gray-400 text-right mt-1">
                  12:00 PM <span className="text-blue-400">✓✓</span>
                </p>
              </div>
            </div>

            {/* Buttons — outside bubble, below */}
            {buttons.length > 0 && (
              <div className="mt-1 space-y-1 max-w-[85%]">
                {buttons.map((btn, i) => (
                  <div key={i}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold shadow-sm cursor-pointer hover:opacity-90 transition-opacity
                      ${btn.type === 'QUICK_REPLY'
                        ? 'bg-white text-whatsapp-teal'
                        : btn.type === 'URL'
                        ? 'bg-white text-blue-600'
                        : 'bg-white text-green-600'}`}>
                    {btn.type === 'URL'          && <Link2  size={14} />}
                    {btn.type === 'PHONE_NUMBER' && <Phone  size={14} />}
                    {btn.type === 'QUICK_REPLY'  && <MessageSquare size={14} />}
                    <span>{btn.text}</span>
                    {btn.type === 'URL' && btn.url && (
                      <span className="text-xs opacity-60 truncate max-w-[120px]">↗</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer close */}
        <div className="px-4 sm:px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} className="btn-secondary w-full">Close Preview</button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// CREATE TEMPLATE MODAL
// ════════════════════════════════════════════════════════════
function TemplateModal({
  onClose, onSaved, initialData,
}: {
  onClose: () => void;
  onSaved: () => void;
  initialData?: Template;
}) {
  const isCopy = !!initialData;
  const [form, setForm] = useState<TemplateForm>(() => {
    if (!initialData) return {
      name: '', language: 'en', category: 'UTILITY',
      header_type: 'NONE', header_content: '',
      body_text: '', footer_text: '',
    };
    return {
      name:           `copy_of_${initialData.name}`,
      language:       initialData.language       || 'en',
      category:       initialData.category       || 'UTILITY',
      header_type:    (initialData.header_type   || 'NONE') as TemplateForm['header_type'],
      header_content: initialData.header_content || '',
      body_text:      initialData.body_text       || '',
      footer_text:    initialData.footer_text     || '',
    };
  });
  const [varSamples, setVarSamples]   = useState<Record<string, string>>({});
  const [buttons, setButtons]         = useState<Button[]>(() =>
    initialData ? parseJsonColumn<Button[]>(initialData.buttons, []) : []
  );
  const [mediaHandle, setMediaHandle]     = useState('');
  const [mediaFileName, setMediaFileName] = useState('');
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [saving, setSaving]           = useState(false);

  const detectedVars = useMemo(() => extractVariables(form.body_text), [form.body_text]);

  useEffect(() => {
    setVarSamples((prev) => {
      const next: Record<string, string> = {};
      detectedVars.forEach((v) => { next[v] = prev[v] || ''; });
      return next;
    });
  }, [detectedVars]);

  const quickReplies = buttons.filter((b) => b.type === 'QUICK_REPLY');
  const ctaButtons   = buttons.filter((b) => b.type !== 'QUICK_REPLY');

  function addQuickReply() {
    if (quickReplies.length >= 3) { toast.error('Max 3 quick reply buttons'); return; }
    if (ctaButtons.length > 0) { toast.error('Cannot mix Quick Reply with URL/Phone buttons — Meta does not allow this'); return; }
    setButtons([...buttons, { type: 'QUICK_REPLY', text: '' }]);
  }
  function addCTA(type: 'URL' | 'PHONE_NUMBER') {
    if (ctaButtons.length >= 2) { toast.error('Max 2 CTA buttons'); return; }
    if (quickReplies.length > 0) { toast.error('Cannot mix URL/Phone with Quick Reply buttons — Meta does not allow this'); return; }
    setButtons([...buttons, { type, text: '', url: '', url_type: 'static', phone: '' }]);
  }
  function updateButton(i: number, patch: Partial<Button>) {
    setButtons((prev) => prev.map((b, idx) => idx === i ? { ...b, ...patch } : b));
  }
  function removeButton(i: number) {
    setButtons((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleMediaUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingMedia(true);
    setMediaHandle('');
    setMediaFileName('');
    try {
      const token = localStorage.getItem('token');
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/templates/upload-media', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Upload failed', { duration: 7000 }); return; }
      setMediaHandle(data.data.handle);
      setMediaFileName(file.name);
      toast.success('File uploaded to Meta successfully');
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploadingMedia(false);
    }
  }

  const previewBody = useMemo(() => {
    let text = form.body_text;
    detectedVars.forEach((v) => {
      text = text.replaceAll(v, varSamples[v] ? `[${varSamples[v]}]` : v);
    });
    return text;
  }, [form.body_text, detectedVars, varSamples]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name)      { toast.error('Template name required'); return; }
    if (!form.body_text) { toast.error('Body text required'); return; }
    if (form.header_type === 'TEXT' && !form.header_content) {
      toast.error('Header text is required'); return;
    }
    if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.header_type) && !mediaHandle) {
      const label = form.header_type === 'IMAGE' ? 'an image' : form.header_type === 'VIDEO' ? 'a video' : 'a PDF';
      toast.error(`Please upload ${label} for the ${form.header_type} header`); return;
    }
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/templates', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...form, media_handle: mediaHandle, buttons, variables: detectedVars, var_samples: varSamples }),
      });
      const data = await res.json();
      if (res.status === 422) {
        toast.error(data.error || 'Meta API error', { duration: 8000 });
        if (data.local_id) { toast('Saved locally.', { icon: '⚠️' }); onSaved(); }
        return;
      }
      if (!res.ok) { toast.error(data.error || 'Failed'); return; }
      if (data.data?.warning) {
        toast(data.data.warning, { icon: '⚠️', duration: 6000 });
      } else {
        toast.success('Template submitted for Meta approval!');
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">
            {isCopy ? `Copy Template — ${initialData?.name}` : 'Create WhatsApp Template'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={20} /></button>
        </div>

        <div className="flex flex-1 overflow-hidden">

          {/* ── Form (left) ─────────────────────────────────── */}
          <form onSubmit={save} className="flex-1 overflow-y-auto p-6 space-y-5">

            {/* Name + Language */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Template Name *</label>
                <input value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                  className="input" placeholder="order_confirmed" required />
                <p className="text-xs text-gray-400 mt-1">Lowercase + underscores only</p>
              </div>
              <div>
                <label className="form-label">Language *</label>
                <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} className="input">
                  <option value="en">🇺🇸 English</option>
                  <option value="en_IN">🇮🇳 English (India)</option>
                  <option value="hi">🇮🇳 Hindi</option>
                  <option value="mr">🇮🇳 Marathi</option>
                  <option value="gu">🇮🇳 Gujarati</option>
                  <option value="ta">🇮🇳 Tamil</option>
                  <option value="te">🇮🇳 Telugu</option>
                </select>
              </div>
            </div>

            {/* Category */}
            <div>
              <label className="form-label">Category *</label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: 'MARKETING',      emoji: '📣', label: 'Marketing',      desc: 'Offers & promotions' },
                  { value: 'UTILITY',        emoji: '⚙️', label: 'Utility',        desc: 'Order, alerts, updates' },
                  { value: 'AUTHENTICATION', emoji: '🔐', label: 'Authentication', desc: 'OTP, login codes' },
                ].map((c) => (
                  <label key={c.value} className={`border-2 rounded-xl p-3 cursor-pointer transition-all
                    ${form.category === c.value ? 'border-whatsapp-green bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <input type="radio" name="category" value={c.value}
                      checked={form.category === c.value}
                      onChange={() => setForm({ ...form, category: c.value })} className="sr-only" />
                    <div className="text-xl mb-1">{c.emoji}</div>
                    <p className="font-semibold text-sm text-gray-900">{c.label}</p>
                    <p className="text-xs text-gray-500">{c.desc}</p>
                  </label>
                ))}
              </div>
            </div>

            {/* Header */}
            <div className="border border-gray-200 rounded-xl p-4 space-y-3">
              <label className="text-sm font-semibold text-gray-800">Header <span className="text-gray-400 font-normal">(optional)</span></label>
              <div className="flex gap-2 flex-wrap">
                {HEADER_TYPE_OPTIONS.map((opt) => (
                  <button key={opt.value} type="button"
                    onClick={() => { setForm({ ...form, header_type: opt.value as TemplateForm['header_type'], header_content: '' }); setMediaHandle(''); setMediaFileName(''); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all
                      ${form.header_type === opt.value
                        ? 'bg-whatsapp-green text-white border-whatsapp-green'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
                    {opt.icon} {opt.label}
                  </button>
                ))}
              </div>
              {form.header_type === 'TEXT' && (
                <input value={form.header_content}
                  onChange={(e) => setForm({ ...form, header_content: e.target.value })}
                  className="input" placeholder="Header text (max 60 chars)" maxLength={60} required />
              )}
              {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.header_type) && (
                <div className="space-y-2">
                  <label className="block">
                    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed cursor-pointer transition-colors
                      ${mediaHandle ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-whatsapp-green hover:bg-green-50'}`}>
                      {form.header_type === 'IMAGE'    && <Image    size={20} className={mediaHandle ? 'text-green-600' : 'text-gray-400'} />}
                      {form.header_type === 'VIDEO'    && <Video    size={20} className={mediaHandle ? 'text-green-600' : 'text-gray-400'} />}
                      {form.header_type === 'DOCUMENT' && <FileText size={20} className={mediaHandle ? 'text-green-600' : 'text-gray-400'} />}
                      <div className="flex-1 min-w-0">
                        {uploadingMedia
                          ? <p className="text-sm text-gray-500">Uploading to Meta...</p>
                          : mediaHandle
                          ? <p className="text-sm font-medium text-green-700 truncate">{mediaFileName}</p>
                          : <p className="text-sm text-gray-500">
                              {form.header_type === 'IMAGE'    && 'Click to upload image (JPG/PNG, max 5 MB)'}
                              {form.header_type === 'VIDEO'    && 'Click to upload video (MP4, max 16 MB)'}
                              {form.header_type === 'DOCUMENT' && 'Click to upload PDF (max 10 MB)'}
                            </p>}
                      </div>
                      {uploadingMedia && (
                        <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      )}
                      {mediaHandle && <CheckCircle size={16} className="text-green-600 flex-shrink-0" />}
                    </div>
                    <input type="file" className="sr-only"
                      accept={
                        form.header_type === 'IMAGE'    ? '.jpg,.jpeg,.png,image/jpeg,image/png' :
                        form.header_type === 'VIDEO'    ? '.mp4,video/mp4' :
                        '.pdf,application/pdf'
                      }
                      onChange={handleMediaUpload}
                      disabled={uploadingMedia} />
                  </label>
                  <p className="text-xs text-gray-400">
                    File is uploaded to Meta for template review. Meta requires actual files (not URLs) for media headers.
                  </p>
                </div>
              )}
            </div>

            {/* Body */}
            <div className="border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-gray-800">Body Text *</label>
                <div className="flex gap-1.5">
                  {[1, 2, 3].map((n) => (
                    <button key={n} type="button"
                      onClick={() => setForm({ ...form, body_text: form.body_text + `{{${n}}}` })}
                      className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-mono hover:bg-purple-200">
                      +{`{{${n}}}`}
                    </button>
                  ))}
                </div>
              </div>
              <textarea value={form.body_text}
                onChange={(e) => setForm({ ...form, body_text: e.target.value })}
                className="input resize-none" rows={5}
                placeholder={'Hello {{1}},\n\nYour order *{{2}}* is confirmed! 🎉\n\nDelivery: {{3}}'} required />
              <p className="text-xs text-gray-400">*bold* _italic_ ~strikethrough~ · {form.body_text.length}/1024</p>
            </div>

            {/* Variable samples */}
            {detectedVars.length > 0 && (
              <div className="border border-purple-200 bg-purple-50 rounded-xl p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-purple-800">Sample Values for Variables</p>
                  <p className="text-xs text-purple-600 mt-0.5">Meta requires examples to review your template</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {detectedVars.map((v) => (
                    <div key={v}>
                      <label className="text-xs font-medium text-purple-700 mb-1 block">
                        Sample for <code className="bg-purple-200 px-1 rounded">{v}</code>
                      </label>
                      <input value={varSamples[v] || ''}
                        onChange={(e) => setVarSamples({ ...varSamples, [v]: e.target.value })}
                        className="input text-sm"
                        placeholder={v === '{{1}}' ? 'John' : v === '{{2}}' ? 'ORD-123' : 'sample'} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div>
              <label className="form-label">Footer <span className="text-gray-400 font-normal">(optional)</span></label>
              <input value={form.footer_text}
                onChange={(e) => setForm({ ...form, footer_text: e.target.value })}
                className="input" placeholder="Reply STOP to unsubscribe" maxLength={60} />
            </div>

            {/* Buttons */}
            <div className="border border-gray-200 rounded-xl p-4 space-y-4">
              <div>
                <label className="text-sm font-semibold text-gray-800">Buttons <span className="text-gray-400 font-normal">(optional)</span></label>
                <p className="text-xs text-gray-500 mt-0.5">Max 3 Quick Replies OR 2 CTA buttons</p>
              </div>
              {buttons.map((btn, i) => (
                <div key={i} className={`rounded-xl border p-3 space-y-2
                  ${btn.type === 'QUICK_REPLY' ? 'border-teal-200 bg-teal-50' :
                    btn.type === 'URL'          ? 'border-blue-200 bg-blue-50' :
                                                  'border-green-200 bg-green-50'}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold flex items-center gap-1.5
                      ${btn.type === 'QUICK_REPLY' ? 'text-teal-700' :
                        btn.type === 'URL'         ? 'text-blue-700' : 'text-green-700'}`}>
                      {btn.type === 'QUICK_REPLY'  && <><MessageSquare size={12} /> Quick Reply</>}
                      {btn.type === 'URL'           && <><Link2 size={12} /> Visit Website</>}
                      {btn.type === 'PHONE_NUMBER'  && <><Phone size={12} /> Call Number</>}
                    </span>
                    <button type="button" onClick={() => removeButton(i)} className="text-gray-400 hover:text-red-500">
                      <X size={15} />
                    </button>
                  </div>
                  <input value={btn.text} onChange={(e) => updateButton(i, { text: e.target.value })}
                    className="input text-sm" placeholder="Button label" maxLength={25} required />
                  {btn.type === 'URL' && (
                    <>
                      <div className="flex gap-2">
                        {['static', 'dynamic'].map((ut) => (
                          <button key={ut} type="button"
                            onClick={() => updateButton(i, { url_type: ut as 'static' | 'dynamic' })}
                            className={`flex-1 text-xs py-1.5 rounded-lg border font-medium transition-all
                              ${btn.url_type === ut ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                            {ut === 'static' ? 'Static URL' : 'Dynamic URL'}
                          </button>
                        ))}
                      </div>
                      <input value={btn.url || ''} onChange={(e) => updateButton(i, { url: e.target.value })}
                        className="input text-sm font-mono"
                        placeholder={btn.url_type === 'dynamic' ? 'https://site.com/track/{{1}}' : 'https://site.com/offers'} />
                    </>
                  )}
                  {btn.type === 'PHONE_NUMBER' && (
                    <input value={btn.phone || ''} onChange={(e) => updateButton(i, { phone: e.target.value })}
                      className="input text-sm" placeholder="+91 98765 43210" />
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={addQuickReply}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border-2 border-dashed border-teal-300 text-teal-600 hover:bg-teal-50 font-medium">
                  <MessageSquare size={13} /> + Quick Reply
                </button>
                <button type="button" onClick={() => addCTA('URL')}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border-2 border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 font-medium">
                  <Link2 size={13} /> + Visit Website
                </button>
                <button type="button" onClick={() => addCTA('PHONE_NUMBER')}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border-2 border-dashed border-green-300 text-green-600 hover:bg-green-50 font-medium">
                  <Phone size={13} /> + Call Number
                </button>
              </div>
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
                {saving
                  ? <><div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Submitting...</>
                  : 'Submit for Meta Approval'}
              </button>
            </div>
          </form>

          {/* ── Live preview (right) ─────────────────────────── */}
          <div className="w-72 border-l border-gray-200 bg-gray-50 p-5 overflow-y-auto hidden lg:flex lg:flex-col gap-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Live Preview</p>
            <div className="bg-[#ECE5DD] rounded-2xl p-3">
              <div className="bg-white rounded-xl rounded-tl-sm shadow-sm p-3 space-y-1.5">
                {form.header_type === 'TEXT' && form.header_content && (
                  <p className="font-bold text-gray-900 text-sm">{form.header_content}</p>
                )}
                {form.header_type === 'IMAGE' && (
                  <div className="bg-gray-200 rounded-lg h-24 flex items-center justify-center text-2xl">🖼️</div>
                )}
                {form.header_type === 'DOCUMENT' && (
                  <div className="bg-gray-100 rounded-lg p-2 flex items-center gap-2">
                    <FileText size={18} className="text-red-400" />
                    <span className="text-xs text-gray-500">Document</span>
                  </div>
                )}
                {form.header_type === 'VIDEO' && (
                  <div className="bg-gray-800 rounded-lg h-24 flex items-center justify-center text-2xl">▶️</div>
                )}
                {previewBody
                  ? <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{previewBody}</p>
                  : <p className="text-sm text-gray-300 italic">Body text will appear here...</p>}
                {form.footer_text && <p className="text-xs text-gray-400">{form.footer_text}</p>}
                <p className="text-xs text-gray-400 text-right">12:00 PM ✓✓</p>
              </div>
              {buttons.length > 0 && (
                <div className="mt-1 space-y-1">
                  {buttons.map((b, i) => (
                    <div key={i} className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold shadow-sm bg-white
                      ${b.type === 'QUICK_REPLY' ? 'text-whatsapp-teal' : b.type === 'URL' ? 'text-blue-600' : 'text-green-600'}`}>
                      {b.type === 'URL' && <Link2 size={11} />}
                      {b.type === 'PHONE_NUMBER' && <Phone size={11} />}
                      {b.type === 'QUICK_REPLY'  && <MessageSquare size={11} />}
                      {b.text || <span className="text-gray-300">Button label</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Checklist */}
            <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-600">Checklist</p>
              {[
                { label: 'Template name',     ok: form.name.length > 0 },
                { label: 'Body text',         ok: form.body_text.length > 0 },
                { label: 'Header content',    ok: form.header_type === 'NONE' || (['IMAGE','VIDEO','DOCUMENT'].includes(form.header_type) ? !!mediaHandle : form.header_content.length > 0) },
                { label: 'Variable samples',  ok: detectedVars.length === 0 || detectedVars.every((v) => varSamples[v]) },
                { label: 'Button labels',     ok: buttons.length === 0 || buttons.every((b) => b.text) },
              ].map(({ label, ok }) => (
                <div key={label} className={`flex items-center gap-2 text-xs ${ok ? 'text-green-700' : 'text-gray-400'}`}>
                  <span>{ok ? '✅' : '⬜'}</span> {label}
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
