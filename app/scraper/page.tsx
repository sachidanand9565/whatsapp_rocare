'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, MapPin, Phone, Globe, Star, Users, ExternalLink,
  CheckSquare, Square, Loader2, X, Building2, Zap,
  Plus, ArrowLeft, Trash2, Send, Calendar, ChevronRight,
  Edit2, List, LayoutGrid, Save,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface ScrapedPlace {
  name:     string;
  address:  string;
  phone:    string;
  website:  string;
  rating:   number;
  reviews:  number;
  maps_url: string;
  place_id: string;
}

interface ScraperSession {
  id:          number;
  city:        string;
  category:    string;
  created_at:  string;
  total_count: number;
  phone_count: number;
  places?:     ScrapedPlace[];
}

interface Template {
  id:        number;
  name:      string;
  status:    string;
  body_text: string;
  language:  string;
}

const CATEGORIES = [
  'ro', 'water purifier', 'plumber', 'electrician', 'restaurant', 'hotel',
  'hospital', 'clinic', 'gym', 'salon', 'school', 'coaching', 'real estate',
  'ca firm', 'lawyer', 'interior designer', 'event planner', 'travel agent',
  'grocery', 'pharmacy', 'hardware', 'furniture', 'clothing', 'jewellery',
];

const CARD_GRADIENTS = [
  'from-green-500 to-emerald-600',
  'from-blue-500 to-indigo-600',
  'from-purple-500 to-violet-600',
  'from-orange-500 to-amber-600',
  'from-pink-500 to-rose-600',
  'from-teal-500 to-cyan-600',
];

function renderStars(rating: number) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} size={11} className={
          i < full ? 'fill-amber-400 text-amber-400'
          : i === full && half ? 'fill-amber-200 text-amber-400'
          : 'fill-gray-200 text-gray-200'
        } />
      ))}
      <span className="ml-1 text-xs font-semibold text-gray-700">{rating.toFixed(1)}</span>
    </span>
  );
}

export default function ScraperPage() {
  const router = useRouter();
  type View = 'home' | 'scrape' | 'detail';
  const [view, setView]                   = useState<View>('home');
  const [sessions, setSessions]           = useState<ScraperSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [activeSession, setActiveSession] = useState<ScraperSession | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Scrape form
  const [city, setCity]       = useState('');
  const [category, setCategory] = useState('');
  const [limit, setLimit]     = useState(20);
  const [scraping, setScraping] = useState(false);
  const [results, setResults] = useState<ScrapedPlace[]>([]);
  const [scraped, setScraped] = useState(false);

  // Detail
  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [showCampaign, setShowCampaign] = useState(false);
  const [listMode, setListMode]         = useState<'cards' | 'list'>('cards');

  // Edit place modal
  const [editingPlace, setEditingPlace] = useState<ScrapedPlace | null>(null);
  const [editForm, setEditForm]         = useState<ScrapedPlace | null>(null);
  const [savingEdit, setSavingEdit]     = useState(false);

  // Campaign modal
  const [templates, setTemplates]             = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [campaignName, setCampaignName]       = useState('');
  const [templateId, setTemplateId]           = useState<number | null>(null);
  const [sending, setSending]                 = useState(false);
  // varMapping: { "1": "name", "2": "manual", ... } — var index → contact field key or "manual"
  const [varMapping, setVarMapping]           = useState<Record<string, string>>({});
  const [templateVars, setTemplateVars]       = useState<string[]>([]); // ["1","2","3"]
  const [manualValues, setManualValues]       = useState<Record<string, string>>({}); // manual text per var

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
  }

  // ── Load sessions list ───────────────────────────────────────
  async function loadSessions() {
    setSessionsLoading(true);
    try {
      const res  = await fetch('/api/scraper', { headers: authHeaders() });
      const data = await res.json();
      setSessions(data.data || []);
    } catch { toast.error('Failed to load sessions'); }
    finally { setSessionsLoading(false); }
  }

  useEffect(() => { loadSessions(); }, []);

  // ── Scrape & save ────────────────────────────────────────────
  async function scrape() {
    if (!city.trim() || !category.trim()) { toast.error('Please enter both City and Category'); return; }
    setScraping(true);
    setResults([]);
    setScraped(false);
    try {
      const res = await fetch('https://n8n.limbutech.in/webhook/data-gmb-scrapper', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ city: city.trim(), category: category.trim(), limit }),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      const list: ScrapedPlace[] = Array.isArray(data) ? data : data.data || data.results || [];
      if (list.length === 0) { toast.error('No results found'); setScraped(true); return; }

      // Save to DB
      const saveRes  = await fetch('/api/scraper', {
        method:  'POST',
        headers: authHeaders(),
        body:    JSON.stringify({ city: city.trim(), category: category.trim(), places: list }),
      });
      const saveData = await saveRes.json();

      setResults(list);
      setScraped(true);
      await loadSessions();
      toast.success(`${list.length} places found! List saved.`);

      // Open detail immediately
      if (saveData.data?.id) {
        setActiveSession({
          id:          saveData.data.id,
          city:        city.trim(),
          category:    category.trim(),
          created_at:  new Date().toISOString(),
          total_count: list.length,
          phone_count: list.filter((p) => p.phone).length,
          places:      list,
        });
        setSelected(new Set());
        setView('detail');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Scraping failed');
    } finally {
      setScraping(false);
    }
  }

  // ── Open detail (fetch places from DB) ──────────────────────
  async function openDetail(session: ScraperSession) {
    setActiveSession({ ...session, places: undefined });
    setSelected(new Set());
    setView('detail');
    setDetailLoading(true);
    try {
      const res  = await fetch(`/api/scraper/${session.id}`, { headers: authHeaders() });
      const data = await res.json();
      setActiveSession({ ...session, places: data.data?.places || [] });
    } catch { toast.error('Failed to load data'); }
    finally { setDetailLoading(false); }
  }

  // ── Delete session ───────────────────────────────────────────
  async function deleteSession(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this list?')) return;
    try {
      await fetch(`/api/scraper/${id}`, { method: 'DELETE', headers: authHeaders() });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      toast.success('List deleted');
    } catch { toast.error('Failed to delete'); }
  }

  // ── Place edit/delete helpers ────────────────────────────────
  async function persistPlaces(newPlaces: ScrapedPlace[]) {
    if (!activeSession?.id) return;
    await fetch(`/api/scraper/${activeSession.id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ places: newPlaces }),
    });
    setActiveSession((prev) => prev ? { ...prev, places: newPlaces, total_count: newPlaces.length, phone_count: newPlaces.filter((p) => p.phone).length } : prev);
    setSessions((prev) => prev.map((s) => s.id === activeSession.id ? { ...s, total_count: newPlaces.length, phone_count: newPlaces.filter((p) => p.phone).length } : s));
  }

  async function deletePlace(placeId: string) {
    if (!confirm('Delete this contact from the list?')) return;
    const newPlaces = (activeSession?.places || []).filter((p) => p.place_id !== placeId);
    await persistPlaces(newPlaces);
    setSelected((prev) => { const n = new Set(prev); n.delete(placeId); return n; });
    toast.success('Contact deleted');
  }

  function openEdit(place: ScrapedPlace) {
    setEditingPlace(place);
    setEditForm({ ...place });
  }

  async function saveEdit() {
    if (!editForm || !editingPlace) return;
    setSavingEdit(true);
    const newPlaces = (activeSession?.places || []).map((p) => p.place_id === editingPlace.place_id ? { ...editForm } : p);
    await persistPlaces(newPlaces);
    setEditingPlace(null);
    setEditForm(null);
    setSavingEdit(false);
    toast.success('Contact updated');
  }

  // ── Selection helpers ────────────────────────────────────────
  const detailPlaces = activeSession?.places || [];
  const withPhone    = detailPlaces.filter((p) => p.phone);
  const selectedList = detailPlaces.filter((p) => selected.has(p.place_id));

  function toggleSelect(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const selectAll       = () => setSelected(new Set(detailPlaces.map((p) => p.place_id)));
  const selectWithPhone = () => setSelected(new Set(withPhone.map((p) => p.place_id)));
  const clearSel        = () => setSelected(new Set());

  // ── Campaign modal ───────────────────────────────────────────
  function parseVars(bodyText: string): string[] {
    const matches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)];
    return [...new Set(matches.map((m) => m[1]))].sort((a, b) => Number(a) - Number(b));
  }

  function applyTemplate(tmpl: Template) {
    setTemplateId(tmpl.id);
    const vars = parseVars(tmpl.body_text || '');
    console.log('[Scraper] body_text:', tmpl.body_text);
    console.log('[Scraper] detected vars:', vars);
    setTemplateVars(vars);
    const defaults: Record<string, string> = {};
    vars.forEach((v, i) => { defaults[v] = i === 0 ? 'name' : i === 1 ? 'address' : ''; });
    setVarMapping(defaults);
  }

  async function openCampaignModal() {
    const toUse = selectedList.length > 0 ? selectedList : withPhone;
    if (toUse.length === 0) { toast.error('No contacts with phone numbers available'); return; }
    setShowCampaign(true);
    setTemplatesLoading(true);
    setCampaignName(`${activeSession?.city} ${activeSession?.category} - ${new Date().toLocaleDateString('en-IN')}`);
    try {
      const res  = await fetch('/api/templates', { headers: authHeaders() });
      const data = await res.json();
      const list: Template[] = (data.data || []).filter((t: Template) => t.status === 'APPROVED');
      setTemplates(list);
      if (list.length > 0) applyTemplate(list[0]);
    } catch { toast.error('Failed to load templates'); }
    finally { setTemplatesLoading(false); }
  }

  const FIELD_OPTIONS = [
    { value: 'name',    label: 'Business Name' },
    { value: 'address', label: 'Address' },
    { value: 'phone',   label: 'Phone' },
    { value: 'website', label: 'Website' },
    { value: 'rating',  label: 'Rating' },
    { value: 'reviews', label: 'Reviews Count' },
    { value: 'city',    label: 'City' },
    { value: 'manual',  label: '✏️ Manual (same for all)' },
    { value: '',        label: '— Leave blank —' },
  ];

  function getFieldValue(place: ScrapedPlace, field: string, varNum?: string): string {
    if (field === 'name')    return place.name    || '';
    if (field === 'address') return place.address || '';
    if (field === 'phone')   return place.phone   || '';
    if (field === 'website') return place.website || '';
    if (field === 'rating')  return place.rating  ? String(place.rating) : '';
    if (field === 'reviews') return place.reviews ? String(place.reviews) : '';
    if (field === 'city')    return activeSession?.city || '';
    if (field === 'manual')  return varNum ? (manualValues[varNum] || '') : '';
    return '';
  }

  async function sendCampaign() {
    if (!templateId || !campaignName.trim()) { toast.error('Please enter a campaign name and select a template'); return; }
    const toSend = selectedList.length > 0 ? selectedList : withPhone;
    setSending(true);

    // Build csv_contacts with per-contact variable values
    const csvContacts = toSend
      .filter((p) => p.phone)
      .map((place) => {
        const vars: Record<string, string> = {};
        for (const varNum of templateVars) {
          const field = varMapping[varNum] || '';
          vars[varNum] = getFieldValue(place, field, varNum);
        }
        return { phone: place.phone, name: place.name, vars };
      });

    if (csvContacts.length === 0) { toast.error('No contacts with phone numbers'); setSending(false); return; }

    console.log('[Scraper] templateVars:', templateVars);
    console.log('[Scraper] varMapping:', varMapping);
    console.log('[Scraper] first contact vars preview:', csvContacts[0]);

    try {
      const res  = await fetch('/api/campaigns', {
        method:  'POST',
        headers: authHeaders(),
        body:    JSON.stringify({
          name:          campaignName.trim(),
          template_id:   templateId,
          campaign_type: 'broadcast',
          csv_contacts:  csvContacts,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to create campaign'); return; }
      toast.success(`Campaign created! ${csvContacts.length} contacts added.`);
      setShowCampaign(false);
      router.push('/campaigns');
    } catch {
      toast.error('Error creating campaign');
    } finally {
      setSending(false);
    }
  }

  // ════════════════════════════════════════════════════════════
  // HOME VIEW
  // ════════════════════════════════════════════════════════════
  if (view === 'home') return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
            <Building2 size={20} className="text-green-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">GMB Scraper</h1>
            <p className="text-sm text-gray-500">Saved lists — click a card to view contacts</p>
          </div>
        </div>
        <button onClick={() => { setCity(''); setCategory(''); setLimit(20); setResults([]); setScraped(false); setView('scrape'); }}
          className="btn-primary flex items-center gap-2">
          <Plus size={16} /> New Scrape
        </button>
      </div>

      {sessionsLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-green-600" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
            <Building2 size={28} className="text-green-600" />
          </div>
          <p className="font-semibold text-gray-700">No lists yet</p>
          <p className="text-sm text-gray-400 mt-1">Click &quot;New Scrape&quot; to start scraping data</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sessions.map((s, idx) => {
            const grad = CARD_GRADIENTS[idx % CARD_GRADIENTS.length];
            const date = new Date(s.created_at);
            return (
              <div key={s.id}
                onClick={() => openDetail(s)}
                className="group relative bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden cursor-pointer">
                <div className={`h-2 bg-gradient-to-r ${grad}`} />
                <div className="p-4 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{s.city}</p>
                    <h3 className="text-lg font-bold text-gray-900 capitalize leading-tight mt-0.5">{s.category}</h3>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1 bg-gray-50 rounded-xl p-2.5 text-center">
                      <p className="text-xl font-bold text-gray-900">{s.total_count}</p>
                      <p className="text-[10px] text-gray-500 font-medium">Total</p>
                    </div>
                    <div className="flex-1 bg-green-50 rounded-xl p-2.5 text-center">
                      <p className="text-xl font-bold text-green-700">{s.phone_count}</p>
                      <p className="text-[10px] text-green-600 font-medium">With Phone</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                    <span className="flex items-center gap-1 text-[11px] text-gray-400">
                      <Calendar size={10} />
                      {date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                    </span>
                    <div className="flex items-center gap-1">
                      <button onClick={(e) => deleteSession(s.id, e)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600">
                        <Trash2 size={13} />
                      </button>
                      <ChevronRight size={14} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ════════════════════════════════════════════════════════════
  // SCRAPE VIEW
  // ════════════════════════════════════════════════════════════
  if (view === 'scrape') return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <button onClick={() => setView('home')} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Scrape</h1>
          <p className="text-sm text-gray-500">Enter city and category to scrape data</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
              <MapPin size={11} className="inline mr-1" />City
            </label>
            <input type="text" value={city} onChange={(e) => setCity(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && scrape()}
              placeholder="e.g. Gwalior, Bhopal, Delhi" className="input w-full" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
              <Search size={11} className="inline mr-1" />Category / Keyword
            </label>
            <input type="text" value={category} onChange={(e) => setCategory(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && scrape()}
              placeholder="e.g. ro, plumber, restaurant" list="cat-list" className="input w-full" />
            <datalist id="cat-list">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
              <Zap size={11} className="inline mr-1" />Limit
            </label>
            <div className="flex gap-2 items-center">
              <input type="number" min={1} max={200} value={limit}
                onChange={(e) => setLimit(Number(e.target.value))} className="input w-20" />
              <div className="flex gap-1.5">
                {[10, 20, 50, 100].map((n) => (
                  <button key={n} onClick={() => setLimit(n)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      limit === n ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 text-gray-500 hover:border-green-300 hover:text-green-700'
                    }`}>{n}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <button onClick={scrape} disabled={scraping} className="btn-primary flex items-center gap-2">
            {scraping ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            {scraping ? 'Scraping...' : 'Scrape Data'}
          </button>
          {scraped && (
            <button onClick={() => { setResults([]); setScraped(false); }} className="btn-secondary flex items-center gap-2">
              <X size={16} /> Clear
            </button>
          )}
        </div>
      </div>

      {scraping && (
        <div className="bg-white rounded-2xl border border-gray-200 p-16 flex flex-col items-center gap-3">
          <Loader2 size={36} className="animate-spin text-green-600" />
          <p className="text-gray-500 font-medium">Fetching data...</p>
          <p className="text-gray-400 text-sm">Searching &quot;{category}&quot; in {city}</p>
        </div>
      )}

      {!scraping && scraped && results.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center">
          <div className="text-5xl mb-3">🔍</div>
          <p className="font-semibold text-gray-700">No results found</p>
          <p className="text-sm text-gray-400 mt-1">Try changing the city or category</p>
        </div>
      )}
    </div>
  );

  // ════════════════════════════════════════════════════════════
  // DETAIL VIEW
  // ════════════════════════════════════════════════════════════
  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={() => setView('home')} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{activeSession?.city}</p>
            <h1 className="text-2xl font-bold text-gray-900 capitalize">{activeSession?.category}</h1>
          </div>
        </div>
        {!detailLoading && (
          <button onClick={openCampaignModal} className="btn-primary flex items-center gap-2">
            <Send size={15} />
            {selected.size > 0 ? `Send Campaign (${selected.size})` : `Send Campaign (${withPhone.length} with phone)`}
          </button>
        )}
      </div>

      {detailLoading ? (
        <div className="flex items-center justify-center py-20 gap-3 text-gray-400">
          <Loader2 size={24} className="animate-spin text-green-600" />
          <span>Loading data...</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total',      value: detailPlaces.length,                    color: 'bg-blue-50 text-blue-700',     border: 'border-blue-200' },
              { label: 'With Phone', value: withPhone.length,                        color: 'bg-green-50 text-green-700',   border: 'border-green-200' },
              { label: 'No Phone',   value: detailPlaces.length - withPhone.length,  color: 'bg-gray-50 text-gray-500',     border: 'border-gray-200' },
              { label: 'Selected',   value: selected.size,                           color: 'bg-purple-50 text-purple-700', border: 'border-purple-200' },
            ].map(({ label, value, color, border }) => (
              <div key={label} className={`rounded-xl border ${border} ${color} px-4 py-3`}>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs font-medium mt-0.5 opacity-80">{label}</p>
              </div>
            ))}
          </div>

          {/* Toolbar: select buttons + view toggle */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-gray-500 font-medium">Select:</span>
              <button onClick={selectAll} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-colors">
                All ({detailPlaces.length})
              </button>
              <button onClick={selectWithPhone} className="text-xs px-3 py-1.5 rounded-lg bg-green-100 hover:bg-green-200 text-green-700 font-medium transition-colors">
                With Phone ({withPhone.length})
              </button>
              <button onClick={clearSel} className="text-xs px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-medium transition-colors">
                Clear
              </button>
            </div>
            {/* View toggle */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
              <button onClick={() => setListMode('cards')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${listMode === 'cards' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
                <LayoutGrid size={13} /> Cards
              </button>
              <button onClick={() => setListMode('list')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${listMode === 'list' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
                <List size={13} /> List
              </button>
            </div>
          </div>

          {/* Cards view */}
          {listMode === 'cards' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {detailPlaces.map((place) => (
                <PlaceCard
                  key={place.place_id}
                  place={place}
                  selected={selected.has(place.place_id)}
                  onToggle={() => toggleSelect(place.place_id)}
                  onEdit={() => openEdit(place)}
                  onDelete={() => deletePlace(place.place_id)}
                />
              ))}
            </div>
          )}

          {/* List / Table view */}
          {listMode === 'list' && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-8">
                        <input type="checkbox"
                          checked={selected.size === detailPlaces.length && detailPlaces.length > 0}
                          onChange={(e) => e.target.checked ? selectAll() : clearSel()}
                          className="accent-green-600 w-4 h-4" />
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">#</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Business Name</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Phone</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Address</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Website</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Rating</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {detailPlaces.map((place, idx) => (
                      <tr key={place.place_id}
                        className={`hover:bg-gray-50 transition-colors ${selected.has(place.place_id) ? 'bg-green-50' : ''}`}>
                        <td className="px-4 py-3">
                          <input type="checkbox"
                            checked={selected.has(place.place_id)}
                            onChange={() => toggleSelect(place.place_id)}
                            className="accent-green-600 w-4 h-4" />
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{idx + 1}</td>
                        <td className="px-4 py-3 max-w-[200px]">
                          <p className="font-medium text-gray-900 line-clamp-2 text-sm leading-tight">{place.name}</p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {place.phone
                            ? <a href={`tel:${place.phone}`} className="text-green-700 font-medium hover:underline text-xs">{place.phone}</a>
                            : <span className="text-gray-400 text-xs italic">—</span>}
                        </td>
                        <td className="px-4 py-3 max-w-[180px]">
                          <p className="text-gray-500 text-xs line-clamp-2">{place.address || '—'}</p>
                        </td>
                        <td className="px-4 py-3 max-w-[120px]">
                          {place.website
                            ? <a href={place.website} target="_blank" rel="noopener noreferrer"
                                className="text-blue-600 text-xs hover:underline truncate block max-w-[110px]">
                                {place.website.replace(/^https?:\/\//, '')}
                              </a>
                            : <span className="text-gray-400 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {place.rating > 0
                            ? <span className="flex items-center gap-1 text-xs font-semibold text-amber-600">
                                <Star size={11} className="fill-amber-400 text-amber-400" /> {place.rating.toFixed(1)}
                                <span className="text-gray-400 font-normal">({place.reviews})</span>
                              </span>
                            : <span className="text-gray-400 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openEdit(place)}
                              className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors" title="Edit">
                              <Edit2 size={13} />
                            </button>
                            <button onClick={() => deletePlace(place.place_id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors" title="Delete">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detailPlaces.length === 0 && (
                  <div className="text-center py-12 text-gray-400 text-sm">No contacts found</div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Campaign Modal */}
      {showCampaign && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Send Campaign</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  WhatsApp message will be sent to {selected.size > 0 ? selected.size : withPhone.length} contacts
                </p>
              </div>
              <button onClick={() => setShowCampaign(false)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Campaign Name */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Campaign Name</label>
                <input type="text" value={campaignName} onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="e.g. Gwalior RO Campaign" className="input w-full" />
              </div>

              {/* Template Select */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Select Template</label>
                {templatesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400 py-3">
                    <Loader2 size={14} className="animate-spin" /> Loading templates...
                  </div>
                ) : templates.length === 0 ? (
                  <p className="text-sm text-red-500">No approved templates found. Please create a template first.</p>
                ) : (
                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {templates.map((t) => (
                      <label key={t.id}
                        className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                          templateId === t.id ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'
                        }`}>
                        <input type="radio" name="template" value={t.id}
                          checked={templateId === t.id} onChange={() => applyTemplate(t)}
                          className="mt-0.5 accent-green-600" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                          <p className="text-xs text-gray-400 line-clamp-2 mt-0.5">{t.body_text}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Variable Mapping */}
              {templateVars.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
                    Variable Mapping
                  </label>
                  <p className="text-xs text-gray-400 mb-3">
                    Map each template variable to a contact field. Each contact will get their own value.
                  </p>
                  <div className="space-y-3 bg-gray-50 rounded-xl p-3 border border-gray-200">
                    {templateVars.map((varNum) => {
                      const isManual   = varMapping[varNum] === 'manual';
                      const previewVal = isManual
                        ? manualValues[varNum] || ''
                        : getFieldValue(selectedList[0] || withPhone[0], varMapping[varNum] || '', varNum);
                      return (
                        <div key={varNum} className="space-y-1.5">
                          <div className="flex items-center gap-3">
                            <span className="w-12 flex-shrink-0 text-center text-xs font-bold text-white bg-green-600 rounded-lg py-1.5">
                              {`{{${varNum}}}`}
                            </span>
                            <span className="text-gray-400 text-xs flex-shrink-0">→</span>
                            <select
                              value={varMapping[varNum] || ''}
                              onChange={(e) => setVarMapping((prev) => ({ ...prev, [varNum]: e.target.value }))}
                              className="input flex-1 text-sm py-1.5"
                            >
                              {FIELD_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                            {/* Live preview */}
                            {varMapping[varNum] && !isManual && previewVal && (
                              <span className="text-xs text-gray-400 truncate max-w-[80px]" title={previewVal}>
                                e.g. &ldquo;{previewVal.slice(0, 15)}&rdquo;
                              </span>
                            )}
                          </div>
                          {/* Manual text input */}
                          {isManual && (
                            <div className="ml-[60px]">
                              <input
                                type="text"
                                placeholder="Enter value (same for all contacts)"
                                value={manualValues[varNum] || ''}
                                onChange={(e) => setManualValues((prev) => ({ ...prev, [varNum]: e.target.value }))}
                                className="input w-full text-sm py-1.5"
                                autoFocus
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* If vars detected = 0 but template likely has vars, show manual override */}
              {templateVars.length === 0 && templateId && (() => {
                const tmpl = templates.find((t) => t.id === templateId);
                const rawBody = tmpl?.body_text || '';
                const hasVarsInBody = /\{\{\d+\}\}/.test(rawBody);
                return hasVarsInBody ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-semibold text-amber-700">⚠️ Variables detected in template but auto-parse failed</p>
                    <p className="text-xs text-amber-600">Raw body_text: <code className="bg-amber-100 px-1 rounded">{rawBody.slice(0, 80)}...</code></p>
                    <p className="text-xs text-amber-600">Check browser console for details.</p>
                  </div>
                ) : (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5">
                    <p className="text-xs text-blue-600">This template has no variables — the same message will be sent to all contacts.</p>
                  </div>
                );
              })()}

              {/* Live Message Preview */}
              {templateId && (() => {
                const tmpl     = templates.find((t) => t.id === templateId);
                const place    = selectedList[0] || withPhone[0];
                if (!tmpl || !place) return null;
                let preview = tmpl.body_text || '';
                for (const varNum of templateVars) {
                  const field = varMapping[varNum] || '';
                  const val   = getFieldValue(place, field, varNum);
                  preview = preview.replace(new RegExp(`\\{\\{${varNum}\\}\\}`, 'g'), val || `[{{${varNum}}}]`);
                }
                return (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                      Message Preview <span className="text-gray-400 normal-case font-normal">(first contact)</span>
                    </label>
                    <div className="bg-[#dcf8c6] rounded-xl p-3 text-xs text-gray-800 whitespace-pre-wrap leading-relaxed border border-green-200 font-mono">
                      {preview}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">
                      {templateVars.length > 0
                        ? `${templateVars.length} variable(s) mapped for ${(selectedList.length || withPhone.length)} contacts`
                        : 'No variables — same message for all'}
                    </p>
                  </div>
                );
              })()}
            </div>
            <div className="flex gap-3 p-5 border-t border-gray-100">
              <button onClick={() => setShowCampaign(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={sendCampaign} disabled={sending || !templateId || !campaignName.trim()}
                className="btn-primary flex-1 flex items-center justify-center gap-2">
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {sending ? 'Creating...' : 'Create Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Place Modal */}
      {editingPlace && editForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">Edit Contact</h3>
              <button onClick={() => { setEditingPlace(null); setEditForm(null); }}
                className="p-2 rounded-xl hover:bg-gray-100 text-gray-400"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Business Name</label>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="input w-full" placeholder="Business name" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Phone</label>
                <input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  className="input w-full" placeholder="Phone number" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Address</label>
                <textarea value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  className="input w-full resize-none" rows={2} placeholder="Address" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Website</label>
                <input value={editForm.website} onChange={(e) => setEditForm({ ...editForm, website: e.target.value })}
                  className="input w-full" placeholder="https://..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Rating</label>
                  <input type="number" min={0} max={5} step={0.1}
                    value={editForm.rating} onChange={(e) => setEditForm({ ...editForm, rating: Number(e.target.value) })}
                    className="input w-full" placeholder="4.5" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Reviews Count</label>
                  <input type="number" min={0}
                    value={editForm.reviews} onChange={(e) => setEditForm({ ...editForm, reviews: Number(e.target.value) })}
                    className="input w-full" placeholder="120" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t border-gray-100">
              <button onClick={() => { setEditingPlace(null); setEditForm(null); }} className="btn-secondary flex-1">Cancel</button>
              <button onClick={saveEdit} disabled={savingEdit}
                className="btn-primary flex-1 flex items-center justify-center gap-2">
                {savingEdit ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Place Card ───────────────────────────────────────────────
function PlaceCard({ place, selected, onToggle, onEdit, onDelete }: {
  place: ScrapedPlace; selected: boolean; onToggle: () => void;
  onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div onClick={onToggle}
      className={`group relative bg-white rounded-xl border-2 cursor-pointer transition-all duration-150 hover:shadow-md ${
        selected ? 'border-green-500 shadow-md shadow-green-100' : 'border-gray-200 hover:border-gray-300'
      }`}>
      <div className="absolute top-3 right-3 flex items-center gap-1">
        {selected ? <CheckSquare size={17} className="text-green-600" /> : <Square size={17} className="text-gray-300" />}
      </div>
      {/* Edit/Delete actions — shown on hover */}
      <div className="absolute top-2 left-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="p-1.5 rounded-lg bg-white shadow-sm border border-gray-200 text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-colors">
          <Edit2 size={12} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1.5 rounded-lg bg-white shadow-sm border border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-300 transition-colors">
          <Trash2 size={12} />
        </button>
      </div>
      <div className="p-4 space-y-2.5">
        <div className="pr-6">
          <h3 className="font-semibold text-gray-900 text-sm leading-tight line-clamp-2">{place.name}</h3>
        </div>
        {place.address && (
          <div className="flex items-start gap-1.5">
            <MapPin size={11} className="text-gray-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{place.address}</p>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Phone size={11} className={place.phone ? 'text-green-600' : 'text-gray-300'} />
          {place.phone
            ? <a href={`tel:${place.phone}`} onClick={(e) => e.stopPropagation()} className="text-xs font-medium text-green-700 hover:underline">{place.phone}</a>
            : <span className="text-xs text-gray-400 italic">No phone number</span>}
        </div>
        {place.website && (
          <div className="flex items-center gap-1.5">
            <Globe size={11} className="text-blue-400 flex-shrink-0" />
            <a href={place.website} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
              className="text-xs text-blue-600 hover:underline truncate">{place.website.replace(/^https?:\/\//, '')}</a>
          </div>
        )}
        <div className="flex items-center justify-between pt-1 border-t border-gray-100">
          <div className="flex items-center gap-2">
            {place.rating > 0 ? renderStars(place.rating) : <span className="text-xs text-gray-400">No rating</span>}
            {place.reviews > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-gray-400">
                <Users size={10} /> {place.reviews}
              </span>
            )}
          </div>
          {place.maps_url && (
            <a href={place.maps_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 transition-colors">
              Maps <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
