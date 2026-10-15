'use client';
/**
 * app/components/MetaConnect.tsx
 * Meta Embedded Signup — the whole "connect a WhatsApp number" flow in one
 * place: SDK loading, the popup, the token exchange, picking a WABA/number and
 * the setup report. Settings drives it through useMetaConnect() with its own
 * layout; the dashboard drops in <ConnectWhatsAppButton /> as-is.
 */
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/hooks/useApi';
import { CheckCircle, ChevronRight, Facebook, Loader2, Phone, X } from 'lucide-react';
import toast from 'react-hot-toast';

// ── FB SDK type shim ──────────────────────────────────────────
declare global {
  interface Window {
    FB: {
      init(opts: object): void;
      login(cb: (res: { authResponse?: { accessToken?: string; code?: string } }) => void, opts: object): void;
    };
    fbAsyncInit?: () => void;
  }
}

export interface WABAOption {
  id:            string;
  name:          string;
  business_name: string;
  phone_numbers: { id: string; display_phone_number: string; verified_name: string }[];
}

// ── Meta Connect Modal ────────────────────────────────────────
export function MetaConnectModal({
  wabas,
  onConnect,
  onClose,
}: {
  wabas: WABAOption[];
  onConnect: (waba_id: string, phone_number_id: string, business_name: string, display_phone_number?: string) => void;
  onClose: () => void;
}) {
  const [selectedWaba, setSelectedWaba] = useState<WABAOption | null>(
    wabas.length === 1 ? wabas[0] : null
  );
  const [selectedPhone, setSelectedPhone] = useState('');

  useEffect(() => {
    if (selectedWaba?.phone_numbers.length === 1) {
      setSelectedPhone(selectedWaba.phone_numbers[0].id);
    } else {
      setSelectedPhone('');
    }
  }, [selectedWaba]);

  function submit() {
    if (!selectedWaba || !selectedPhone) return;
    const phoneObj = selectedWaba.phone_numbers.find((p) => p.id === selectedPhone);
    onConnect(selectedWaba.id, selectedPhone, selectedWaba.business_name, phoneObj?.display_phone_number);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <p className="font-bold text-gray-900">Select WhatsApp Account</p>
            <p className="text-xs text-gray-400 mt-0.5">{wabas.length} business account{wabas.length > 1 ? 's' : ''} found</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* WABA selection */}
          {wabas.length > 1 && (
            <div>
              <label className="form-label">WhatsApp Business Account (WABA)</label>
              <div className="space-y-2 mt-1">
                {wabas.map((w) => (
                  <button key={w.id} onClick={() => setSelectedWaba(w)}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all flex items-center justify-between
                      ${selectedWaba?.id === w.id
                        ? 'border-whatsapp-green bg-green-50'
                        : 'border-gray-200 hover:border-gray-300'}`}>
                    <div>
                      <p className="font-semibold text-sm text-gray-800">{w.name || w.id}</p>
                      <p className="text-xs text-gray-400">{w.business_name} · WABA {w.id}</p>
                    </div>
                    {selectedWaba?.id === w.id && <CheckCircle size={16} className="text-whatsapp-green" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Phone number selection */}
          {selectedWaba && (
            <div>
              <label className="form-label">Phone Number</label>
              {selectedWaba.phone_numbers.length === 0 ? (
                <p className="text-sm text-red-500 mt-1">No verified phone numbers found on this WABA.</p>
              ) : (
                <div className="space-y-2 mt-1">
                  {selectedWaba.phone_numbers.map((p) => (
                    <button key={p.id} onClick={() => setSelectedPhone(p.id)}
                      className={`w-full text-left px-4 py-3 rounded-xl border transition-all flex items-center gap-3
                        ${selectedPhone === p.id
                          ? 'border-whatsapp-green bg-green-50'
                          : 'border-gray-200 hover:border-gray-300'}`}>
                      <Phone size={15} className="text-gray-400 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="font-semibold text-sm text-gray-800">{p.display_phone_number}</p>
                        <p className="text-xs text-gray-400">{p.verified_name}</p>
                      </div>
                      {selectedPhone === p.id && <CheckCircle size={16} className="text-whatsapp-green" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            onClick={submit}
            disabled={!selectedWaba || !selectedPhone}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-40">
            Connect &amp; Auto-Setup
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Connect Result Panel ──────────────────────────────────────
export function ConnectResults({ results, onClose }: {
  results: { step: string; status: string; detail?: string }[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <p className="font-bold text-gray-900">Setup Complete</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          {results.map((r, i) => (
            <div key={i} className={`flex items-start gap-3 p-3 rounded-lg
              ${r.status === 'ok' ? 'bg-green-50' : 'bg-yellow-50'}`}>
              <span className="text-lg leading-none mt-0.5">
                {r.status === 'ok' ? '✅' : '⚠️'}
              </span>
              <div>
                <p className={`text-sm font-semibold ${r.status === 'ok' ? 'text-green-800' : 'text-yellow-800'}`}>
                  {r.step}
                </p>
                {r.detail && <p className="text-xs text-gray-500 mt-0.5">{r.detail}</p>}
              </div>
            </div>
          ))}
          <button onClick={onClose} className="btn-primary w-full mt-2">Done</button>
        </div>
      </div>
    </div>
  );
}

// ── The flow itself ───────────────────────────────────────────
export function useMetaConnect(opts: { onConnected?: () => void } = {}) {
  const APP_ID    = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || '';
  const CONFIG_ID = process.env.NEXT_PUBLIC_FACEBOOK_CONFIG_ID || '';
  const BSP_READY = !!(APP_ID && CONFIG_ID);

  const [fbLoaded, setFbLoaded]       = useState(false);
  const [fbLoading, setFbLoading]     = useState(false);
  const [connecting, setConnecting]   = useState(false);
  const [coexistMode, setCoexistModeState] = useState(false);
  // Mirrored in a ref: the popup can be opened in the same tick the mode is
  // chosen, before React re-renders with the new state.
  const coexistRef = useRef(false);
  function setCoexistMode(v: boolean) { coexistRef.current = v; setCoexistModeState(v); }
  const [wabas, setWabas]             = useState<WABAOption[] | null>(null);
  const [fbToken, setFbToken]         = useState('');
  const [connectResults, setConnectResults] = useState<{ step: string; status: string; detail?: string }[] | null>(null);

  // Manual WABA id fallback (used when no BSP config is set)
  const [showWabaInput, setShowWabaInput]   = useState(false);
  const [wabaInputId, setWabaInputId]       = useState('');
  const [fetchingPhones, setFetchingPhones] = useState(false);

  const embeddedDataRef = useRef<{ waba_id: string; phone_number_id: string } | null>(null);
  const onConnectedRef  = useRef(opts.onConnected);
  onConnectedRef.current = opts.onConnected;

  // Load Facebook JS SDK + BSP postMessage listener
  useEffect(() => {
    // BSP Embedded Signup sends waba_id + phone_number_id via postMessage
    function handleMessage(e: MessageEvent) {
      if (e.origin !== 'https://www.facebook.com') return;
      try {
        const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (msg?.type === 'WA_EMBEDDED_SIGNUP') {
          // Event name varies by flow: 'FINISH' (new number), 'FINISH_ONLY_WABA'
          // (no phone picked), 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' (coexistence).
          if (String(msg?.event || '').startsWith('FINISH') && msg?.data?.waba_id) {
            embeddedDataRef.current = {
              waba_id:         String(msg.data.waba_id),
              phone_number_id: msg.data.phone_number_id ? String(msg.data.phone_number_id) : '',
            };
          } else if (msg?.event === 'CANCEL') {
            console.warn('[embedded-signup] abandoned at step:', msg?.data?.current_step || '(unknown)');
          }
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('message', handleMessage);

    if (APP_ID && !document.getElementById('facebook-jssdk')) {
      window.fbAsyncInit = () => {
        window.FB.init({ appId: APP_ID, version: 'v20.0', xfbml: false, cookie: true });
        setFbLoaded(true);
      };
      const s = document.createElement('script');
      s.id = 'facebook-jssdk';
      s.src = 'https://connect.facebook.net/en_US/sdk.js';
      s.async = true;
      document.body.appendChild(s);
    } else if (APP_ID) {
      // Another mount already loaded the SDK — wait for FB to exist
      if (window.FB) setFbLoaded(true);
      else {
        const t = setInterval(() => { if (window.FB) { setFbLoaded(true); clearInterval(t); } }, 300);
        setTimeout(() => clearInterval(t), 15000);
      }
    }

    return () => window.removeEventListener('message', handleMessage);
  }, [APP_ID]);

  async function handleConnect(
    waba_id: string,
    phone_number_id: string,
    business_name: string,
    display_phone_number?: string,
    token?: string,
  ) {
    setWabas(null);
    setConnecting(true);
    const useToken = token || fbToken;
    try {
      const r = await apiFetch('/api/auth/meta/connect', {
        method: 'POST',
        // coexistence: number already lives on the WhatsApp Business App — the
        // server must skip /register and instead subscribe the coexistence
        // webhook fields + trigger the contacts/history sync Meta requires.
        body: JSON.stringify({ access_token: useToken, waba_id, phone_number_id, business_name, display_phone_number, coexistence: coexistRef.current }),
      });
      setConnectResults(r.data?.results || []);
      onConnectedRef.current?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connect failed');
    } finally {
      setConnecting(false);
    }
  }

  // ── BSP Embedded Signup (when CONFIG_ID is set) ──────────────
  function loginWithFacebook() {
    if (!window.FB) { toast.error('Facebook SDK not loaded yet'); return; }
    embeddedDataRef.current = null;
    setFbLoading(true);

    if (BSP_READY) {
      window.FB.login((res) => {
        setFbLoading(false);
        const code = res.authResponse?.code;
        if (!code) { toast.error('Facebook login cancelled or failed'); return; }

        const embedded = embeddedDataRef.current;
        if (!embedded?.waba_id) {
          toast.error('WhatsApp setup not completed inside the popup. Please try again and complete all steps.');
          return;
        }

        setConnecting(true);
        apiFetch('/api/auth/meta/exchange', { method: 'POST', body: JSON.stringify({ code }) })
          .then((r) => {
            const token = r.data?.access_token;
            if (!token) { toast.error('Token exchange failed'); return; }
            setFbToken(token);
            if (embedded.phone_number_id) {
              return handleConnect(embedded.waba_id, embedded.phone_number_id, '', undefined, token);
            }
            // Coexistence / only-WABA finish: popup didn't return a phone id —
            // fetch the WABA's numbers ourselves and connect (or let the user pick).
            return fetch(
              `https://graph.facebook.com/v20.0/${embedded.waba_id}/phone_numbers?fields=id,display_phone_number,verified_name&access_token=${token}`
            )
              .then((res2) => res2.json())
              .then((data: { data?: WABAOption['phone_numbers']; error?: { message: string } }) => {
                const phones = data.data || [];
                if (data.error) { toast.error(`Meta: ${data.error.message}`); return; }
                if (phones.length === 0) { toast.error('No phone numbers found on the connected WhatsApp account yet. Wait a minute and try again.'); return; }
                if (phones.length === 1) {
                  return handleConnect(embedded.waba_id, phones[0].id, '', phones[0].display_phone_number, token);
                }
                setWabas([{ id: embedded.waba_id, name: embedded.waba_id, business_name: '', phone_numbers: phones }]);
              });
          })
          .catch((e) => toast.error(e?.message || 'Connect failed'))
          .finally(() => setConnecting(false));
      }, {
        config_id:                    CONFIG_ID,
        response_type:                'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: coexistRef.current ? 'whatsapp_business_app_onboarding' : '',
          sessionInfoVersion: '3',
        },
      });
    } else {
      window.FB.login((res) => {
        setFbLoading(false);
        if (!res.authResponse?.accessToken) { toast.error('Facebook login cancelled or failed'); return; }
        setFbToken(res.authResponse.accessToken);
        setWabaInputId('');
        setShowWabaInput(true);
      }, {
        scope: 'whatsapp_business_management,whatsapp_business_messaging',
      });
    }
  }

  async function fetchPhonesForWaba() {
    if (!wabaInputId.trim() || !fbToken) return;
    setFetchingPhones(true);
    try {
      const res  = await fetch(
        `https://graph.facebook.com/v20.0/${wabaInputId.trim()}/phone_numbers?fields=id,display_phone_number,verified_name&access_token=${fbToken}`
      );
      const data = await res.json();
      if (data.error) { toast.error(`Meta: ${data.error.message}`); return; }
      const phones = (data.data || []) as WABAOption['phone_numbers'];
      if (phones.length === 0) { toast.error('No verified phone numbers found on this WABA.'); return; }
      setShowWabaInput(false);
      setWabas([{ id: wabaInputId.trim(), name: wabaInputId.trim(), business_name: '', phone_numbers: phones }]);
    } finally {
      setFetchingPhones(false);
    }
  }

  return {
    APP_ID, CONFIG_ID, BSP_READY,
    fbLoaded, fbLoading, connecting,
    coexistMode, setCoexistMode,
    wabas, setWabas,
    connectResults, setConnectResults,
    showWabaInput, setShowWabaInput,
    wabaInputId, setWabaInputId,
    fetchingPhones, fetchPhonesForWaba,
    loginWithFacebook, handleConnect,
  };
}

// ── Drop-in button: the whole flow without leaving the page ───
export function ConnectWhatsAppButton({
  className = '',
  label = 'Connect WhatsApp',
  onConnected,
}: {
  className?: string;
  label?: string;
  onConnected?: () => void;
}) {
  const c = useMetaConnect({ onConnected });
  const [askMode, setAskMode] = useState(false);

  // Without an app id the popup cannot open at all — send them to Settings,
  // where the missing configuration is spelled out.
  if (!c.APP_ID) {
    return (
      <a href="/settings" className={className}>
        <Facebook size={15} /> {label}
      </a>
    );
  }

  const busy = c.fbLoading || c.connecting;

  function start(coexist: boolean) {
    c.setCoexistMode(coexist);   // writes the ref synchronously
    setAskMode(false);
    c.loginWithFacebook();
  }

  return (
    <>
      <button
        onClick={() => (c.BSP_READY ? setAskMode(true) : c.loginWithFacebook())}
        disabled={!c.fbLoaded || busy}
        className={`${className} disabled:opacity-60`}>
        {busy
          ? <><Loader2 size={15} className="animate-spin" /> {c.connecting ? 'Setting up…' : 'Opening Meta…'}</>
          : <><Facebook size={15} /> {label}</>}
      </button>

      {/* New number vs. a number already on the WhatsApp Business app */}
      {askMode && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <p className="font-bold text-gray-900">Connect WhatsApp</p>
                <p className="text-xs text-gray-400 mt-0.5">Which number are you connecting?</p>
              </div>
              <button onClick={() => setAskMode(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <button onClick={() => start(false)}
                className="w-full text-left rounded-xl border border-gray-200 hover:border-whatsapp-green hover:bg-green-50 px-4 py-3 transition-colors">
                <p className="font-semibold text-sm text-gray-800">A new number</p>
                <p className="text-xs text-gray-500 mt-0.5">Not on WhatsApp yet, or only on a personal account</p>
              </button>
              <button onClick={() => start(true)}
                className="w-full text-left rounded-xl border border-gray-200 hover:border-whatsapp-green hover:bg-green-50 px-4 py-3 transition-colors">
                <p className="font-semibold text-sm text-gray-800 flex items-center gap-1.5">
                  A number already on the WhatsApp Business app
                  <span className="text-[9px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">Coexistence</span>
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Keep using the app — chats and contacts come across</p>
              </button>
              <p className="text-[11px] text-gray-400 pt-1">
                Meta opens a popup. Allow popups for this site if nothing appears.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Manual WABA id — only reachable when BSP config is missing */}
      {c.showWabaInput && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
            <p className="font-bold text-gray-900">Enter your WhatsApp Business Account ID</p>
            <p className="text-xs text-gray-500">Meta Business Manager → WhatsApp Accounts → WABA ID</p>
            <input value={c.wabaInputId} onChange={(e) => c.setWabaInputId(e.target.value)}
              className="input font-mono" placeholder="123456789012345" />
            <div className="flex gap-2">
              <button onClick={() => c.setShowWabaInput(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={c.fetchPhonesForWaba} disabled={!c.wabaInputId.trim() || c.fetchingPhones}
                className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50">
                {c.fetchingPhones
                  ? <><Loader2 size={16} className="animate-spin" /> Fetching…</>
                  : <>Fetch numbers <ChevronRight size={16} /></>}
              </button>
            </div>
          </div>
        </div>
      )}

      {c.wabas && <MetaConnectModal wabas={c.wabas} onConnect={c.handleConnect} onClose={() => c.setWabas(null)} />}
      {c.connectResults && <ConnectResults results={c.connectResults} onClose={() => c.setConnectResults(null)} />}
    </>
  );
}
