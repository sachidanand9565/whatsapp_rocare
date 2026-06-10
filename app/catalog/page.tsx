'use client';
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '@/hooks/useApi';
import toast from 'react-hot-toast';
import { ShoppingCart, RefreshCw, Check, Package, Search, Loader2, ChevronRight, Link as LinkIcon } from 'lucide-react';

interface Catalog { id: string; name: string; business_name: string; }
interface Product { retailer_id: string; name: string; description?: string; price?: string; currency?: string; image_url?: string; }

export default function CatalogPage() {
  const [loadingCatalogs, setLoadingCatalogs] = useState(true);
  const [catalogs,        setCatalogs]        = useState<Catalog[]>([]);
  const [selectedId,      setSelectedId]      = useState('');
  const [saving,          setSaving]          = useState(false);
  const [products,        setProducts]        = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [search,          setSearch]          = useState('');
  const [error,           setError]           = useState('');

  const loadCatalogs = useCallback(async () => {
    setLoadingCatalogs(true);
    setError('');
    try {
      const r = await apiFetch('/api/catalog?action=catalogs');
      setCatalogs(r.data.catalogs || []);
      setSelectedId(r.data.selected_catalog_id || '');
      if (r.data.selected_catalog_id) loadProducts(r.data.selected_catalog_id);
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message || 'Failed to load catalogs';
      setError(msg);
    } finally {
      setLoadingCatalogs(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadCatalogs(); }, [loadCatalogs]);

  async function loadProducts(catalogId: string) {
    if (!catalogId) return;
    setLoadingProducts(true);
    try {
      const r = await apiFetch(`/api/catalog?action=products&id=${catalogId}`);
      setProducts(r.data.products || []);
    } catch {
      setProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  }

  async function saveCatalog(id: string) {
    setSaving(true);
    try {
      await apiFetch('/api/catalog', { method: 'POST', body: JSON.stringify({ catalog_id: id }) });
      setSelectedId(id);
      toast.success('Catalog connected!');
      if (id) loadProducts(id);
      else setProducts([]);
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const filtered = products.filter(p =>
    !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.retailer_id?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <ShoppingCart size={20} className="text-blue-600"/> Connect Catalogue
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Connect to your Meta Catalog and use products in your flows</p>
        </div>
        <button onClick={loadCatalogs} disabled={loadingCatalogs}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={13} className={loadingCatalogs ? 'animate-spin' : ''}/> Refresh
        </button>
      </div>

      {/* Quick Guide */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
        <p className="font-semibold text-blue-800 text-sm">Quick Guide</p>
        <p className="text-blue-700 text-xs">To use WhatsApp Catalog, you need to set up a catalog and products in Meta Commerce Manager.</p>
        <div className="flex flex-wrap gap-3 mt-2">
          <a href="https://www.facebook.com/business/help/1659498474098488" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 underline">
            <LinkIcon size={11}/> How to create a catalogue in Commerce Manager
          </a>
          <a href="https://www.facebook.com/business/help/1659498474098488" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 underline">
            <LinkIcon size={11}/> How to manage Meta catalogue with Shopify
          </a>
        </div>
      </div>

      {/* Connection Status */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <p className="font-semibold text-gray-800">Connect your Facebook account</p>
            <p className="text-xs text-gray-500 mt-0.5">Your WhatsApp access token will be used to fetch catalogs</p>
          </div>
          {loadingCatalogs ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={14} className="animate-spin"/> Loading…</div>
          ) : error ? (
            <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-3 py-1">Error</span>
          ) : (
            <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-3 py-1 flex items-center gap-1">
              <Check size={11}/> Connected
            </span>
          )}
        </div>

        {error && (
          <div className="px-5 py-3 bg-red-50 border-b border-red-100">
            <p className="text-sm text-red-700">{error}</p>
            <p className="text-xs text-red-500 mt-1">Connect WhatsApp in Settings first, then come back here.</p>
          </div>
        )}

        {/* Choose Catalog */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-gray-800">Choose your Facebook catalogue</p>
            <p className="text-xs text-gray-500 mt-0.5">Select the catalog you want to use in your flows</p>
          </div>
          <div className="flex items-center gap-2">
            {loadingCatalogs ? (
              <div className="w-52 h-9 bg-gray-100 rounded-lg animate-pulse"/>
            ) : catalogs.length === 0 ? (
              <div className="text-xs text-gray-400 italic">No catalogs found</div>
            ) : (
              <select value={selectedId}
                onChange={e => { setSelectedId(e.target.value); }}
                className="w-52 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
                <option value="">Choose your catalogue</option>
                {catalogs.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.business_name})</option>
                ))}
              </select>
            )}
            <button onClick={() => saveCatalog(selectedId)} disabled={saving || loadingCatalogs}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
              {saving ? <Loader2 size={13} className="animate-spin"/> : <Check size={13}/>}
              {saving ? 'Saving…' : 'Connect'}
            </button>
          </div>
        </div>

        {/* Display on Business Profile toggle */}
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-gray-800">Display catalogue on Business profile</p>
            <p className="text-xs text-gray-500 mt-0.5">Enable this in WhatsApp Manager to show your catalog to users on your Business profile</p>
          </div>
          <a href="https://business.facebook.com/wa/manage/phone-numbers/" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
            Open WhatsApp Manager <ChevronRight size={12}/>
          </a>
        </div>
      </div>

      {/* Products */}
      {selectedId && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <p className="font-semibold text-gray-800 flex items-center gap-2">
              <Package size={16} className="text-blue-600"/> Products in Catalogue
              {!loadingProducts && <span className="text-xs font-normal text-gray-400">({filtered.length} items)</span>}
            </p>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300"/>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search products…"
                className="pl-7 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 w-44"/>
            </div>
          </div>

          {loadingProducts ? (
            <div className="flex items-center justify-center py-12 gap-2 text-gray-400">
              <Loader2 size={18} className="animate-spin"/> Loading products…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Package size={32} className="mx-auto mb-2 opacity-30"/>
              <p className="text-sm">No products found</p>
              <p className="text-xs mt-1">Add products in Meta Commerce Manager</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {filtered.map((p, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors">
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt={p.name} className="w-12 h-12 rounded-lg object-cover border border-gray-100 flex-shrink-0"/>
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0">
                      <Package size={18} className="text-blue-300"/>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 text-sm truncate">{p.name}</p>
                    {p.description && <p className="text-xs text-gray-400 truncate mt-0.5">{p.description}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    {p.price && <p className="font-semibold text-gray-800 text-sm">{p.currency || '₹'}{p.price}</p>}
                    <p className="text-[10px] text-gray-400 font-mono mt-0.5">{p.retailer_id}</p>
                  </div>
                  <button onClick={() => { navigator.clipboard.writeText(p.retailer_id); toast.success('Retailer ID copied!'); }}
                    className="text-[10px] text-blue-500 hover:text-blue-700 border border-blue-200 rounded px-2 py-0.5 flex-shrink-0">
                    Copy ID
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
