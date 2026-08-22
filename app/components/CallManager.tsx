'use client';
/**
 * Global WhatsApp softphone — mounted once in the root layout so a live call
 * SURVIVES navigation between sections (Inbox → Calls → Settings …).
 * Previously this lived inside the Inbox page; leaving the page unmounted the
 * WebRTC session and cut the call.
 *
 * Owns: SSE call events, incoming-call popup + ringtone, in-call bar,
 * WebRTC session, recording upload.
 *
 * Talks to pages via window CustomEvents:
 *   'wa:start-call'  (in)  detail {contactId?, name?, phone} → place outbound call
 *   'wa:open-chat'   (out) detail {contactId?, phone} — inbox listens & opens the chat
 *   'wa:call-state'  (out) detail {active: boolean}   — pages can disable their Call buttons
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { apiFetch } from '@/hooks/useApi';
import { WhatsAppCallSession } from '@/lib/webrtcCall';
import { PhoneCall, PhoneMissed, Mic, MicOff, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface IncomingCall { callId: string; contactId?: number; name: string; phone: string; startedAt: number; sdp?: string }
interface ActiveCall {
  callId:    string;
  contactId?: number;
  name:      string;
  phone:     string;
  direction: 'inbound' | 'outbound';
  phase:     'connecting' | 'ringing' | 'active' | 'ending';
  startedAt: number;        // when the call became active (for the timer)
}

// Ringtone via Web Audio (no asset needed): classic double-ring, repeats every 3s.
// Browsers block audio until the user has interacted with the page once —
// we still try; a muted ring is better than a crash.
function startRingtone(): () => void {
  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    const beep = (at: number, freq: number, dur: number) => {
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.25, at + 0.02);
      gain.gain.setValueAtTime(0.25, at + dur - 0.04);
      gain.gain.linearRampToValueAtTime(0, at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at); osc.stop(at + dur);
    };
    const ring = () => {
      if (!ctx) return;
      const t = ctx.currentTime;
      beep(t, 880, 0.35); beep(t + 0.45, 880, 0.35);       // ring-ring
      beep(t + 0.0, 1320, 0.35); beep(t + 0.45, 1320, 0.35); // harmonic
    };
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    ring();
    timer = setInterval(ring, 3000);
  } catch { /* audio unsupported */ }
  return () => {
    if (timer) clearInterval(timer);
    try { ctx?.close(); } catch { /* ignore */ }
  };
}

function IncomingCallPopup({ call, onDecline, onAnswer, onOpenChat, busy }: {
  call: IncomingCall; onDecline: () => void; onAnswer: () => void; onOpenChat: () => void; busy: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const stop = startRingtone();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - call.startedAt) / 1000)), 1000);
    return () => { stop(); clearInterval(t); };
  }, [call.callId, call.startedAt]);

  const initials = (call.name || call.phone || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '#';

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-16 pointer-events-none">
      <div className="pointer-events-auto w-[340px] max-w-[calc(100vw-24px)] rounded-2xl shadow-2xl border border-emerald-700/40 overflow-hidden animate-[pulse_2s_ease-in-out_infinite]"
        style={{ background: 'linear-gradient(160deg,#064e3b 0%,#065f46 60%,#047857 100%)' }}>
        <div className="px-5 pt-5 pb-4 text-white">
          <p className="text-[11px] uppercase tracking-widest text-emerald-200 flex items-center gap-1.5">
            <PhoneCall size={12} className="animate-bounce" /> Incoming WhatsApp call
          </p>
          <div className="flex items-center gap-3 mt-3">
            <div className="w-14 h-14 rounded-full bg-white/15 flex items-center justify-center text-xl font-bold ring-4 ring-white/10">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-lg leading-tight truncate">{call.name || call.phone}</p>
              <p className="text-emerald-200 text-sm truncate">+{call.phone}</p>
              <p className="text-emerald-300/80 text-[11px] mt-0.5">Ringing… {elapsed}s</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 pb-4">
          <button onClick={onDecline} disabled={busy}
            className="flex items-center justify-center gap-2 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white font-semibold py-2.5 transition-colors">
            <PhoneMissed size={16} /> Decline
          </button>
          <button onClick={onAnswer} disabled={busy || !call.sdp}
            title={call.sdp ? 'Answer in browser' : 'No media offer received for this call'}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 disabled:opacity-60 disabled:cursor-not-allowed text-emerald-950 font-semibold py-2.5 transition-colors">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <PhoneCall size={16} />} Answer
          </button>
        </div>
        <button onClick={onOpenChat}
          className="w-full text-center text-[11px] text-emerald-200 hover:text-white bg-black/15 py-2 transition-colors">
          Open chat →
        </button>
      </div>
    </div>
  );
}

// Floating in-call bar: caller, live timer, mute, hang up
function ActiveCallBar({ call, muted, recording, onToggleMute, onHangup }: {
  call: ActiveCall; muted: boolean; recording: boolean; onToggleMute: () => void; onHangup: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const secs = call.phase === 'active' ? Math.max(0, Math.floor((now - call.startedAt) / 1000)) : 0;
  const mm = String(Math.floor(secs / 60)).padStart(2, '0'), ss = String(secs % 60).padStart(2, '0');
  const label = call.phase === 'connecting' ? 'Connecting…'
    : call.phase === 'ringing' ? 'Ringing…'
    : call.phase === 'ending' ? 'Ending…'
    : `${mm}:${ss}`;
  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full shadow-2xl border border-emerald-700/40 pl-4 pr-2 py-2 text-white"
        style={{ background: 'linear-gradient(90deg,#064e3b,#065f46)' }}>
        <span className={`w-2.5 h-2.5 rounded-full ${call.phase === 'active' ? 'bg-emerald-300 animate-pulse' : 'bg-amber-300 animate-pulse'}`} />
        <div className="min-w-0 max-w-[220px]">
          <p className="text-sm font-semibold truncate leading-tight">{call.name || call.phone}</p>
          <p className="text-[11px] text-emerald-200 leading-tight flex items-center gap-1.5">
            {call.direction === 'outbound' ? 'Outgoing' : 'Incoming'} · {label}
            {recording && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-200" title="This call is being recorded">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" /> REC
              </span>
            )}
          </p>
        </div>
        <button onClick={onToggleMute} title={muted ? 'Unmute' : 'Mute'}
          className={`ml-2 w-9 h-9 rounded-full flex items-center justify-center transition-colors ${muted ? 'bg-amber-400 text-emerald-950' : 'bg-white/15 hover:bg-white/25'}`}>
          {muted ? <MicOff size={15} /> : <Mic size={15} />}
        </button>
        <button onClick={onHangup} title="Hang up"
          className="w-9 h-9 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors">
          <PhoneMissed size={15} />
        </button>
      </div>
    </div>
  );
}

/** Register the SW and sync this browser's push subscription with the server.
 *  Requires Notification.permission === 'granted'. Shared with Settings → Calling. */
export async function ensurePushSubscription(): Promise<void> {
  const reg = await navigator.serviceWorker.register('/sw.js');
  const keyRes = await apiFetch('/api/push/subscribe');
  const publicKey = keyRes.data?.public_key as string;
  if (!publicKey) throw new Error('Push not set up on the server');
  // base64url → Uint8Array (applicationServerKey format)
  const pad = '='.repeat((4 - (publicKey.length % 4)) % 4);
  const raw = atob((publicKey + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const appKey = new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
  }
  await apiFetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
}

export default function CallManager() {
  const pathname = usePathname();
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [callBusy, setCallBusy]     = useState(false);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [callMuted, setCallMuted]   = useState(false);
  const callSessionRef  = useRef<WhatsAppCallSession | null>(null);
  const activeCallRef   = useRef<ActiveCall | null>(null);
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const lastSdpRef      = useRef<string>('');   // our SDP answer, re-sent with 'accept'
  const recordCallsRef  = useRef(false);        // Settings → Calling → Record calls
  const settingsLoadedRef = useRef(false);

  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);
  useEffect(() => { incomingCallRef.current = incomingCall; }, [incomingCall]);

  // Let pages disable their Call buttons while a call is live
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('wa:call-state', { detail: { active: !!activeCall } }));
  }, [activeCall]);

  // ── Web Push: if this device already granted notifications, keep its
  // subscription registered so incoming calls ring even with the tab closed.
  // (First-time enabling is a button in Settings → Calling — permission
  // prompts need a user gesture, especially on mobile.)
  const pushSyncedRef = useRef(false);
  useEffect(() => {
    if (pushSyncedRef.current) return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!localStorage.getItem('token')) return;
    pushSyncedRef.current = true;
    ensurePushSubscription().catch(() => { pushSyncedRef.current = false; });
  }, [pathname]);

  // ── Wake Lock: keep the phone screen on during a live call so mobile
  // browsers don't throttle the WebRTC audio.
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  useEffect(() => {
    const live = activeCall && activeCall.phase !== 'ending';
    async function acquire() {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
        if (!nav.wakeLock) return;
        wakeLockRef.current = await nav.wakeLock.request('screen');
      } catch { /* unsupported / low battery — fine */ }
    }
    function onVisible() {
      // The lock is auto-released when the tab hides; re-grab it on return
      if (document.visibilityState === 'visible' && activeCallRef.current) acquire();
    }
    if (live) {
      acquire();
      document.addEventListener('visibilitychange', onVisible);
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [activeCall?.phase === 'active' || activeCall?.phase === 'connecting' || activeCall?.phase === 'ringing']);

  // ── SSE: call events only (messages are handled by the pages) ──
  // Connect once a token exists; re-check on every navigation (e.g. right
  // after login) without tearing down an existing connection.
  const esRef        = useRef<EventSource | null>(null);
  const retryRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destroyedRef = useRef(false);

  useEffect(() => {
    if (esRef.current) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) return;

    // First connect only — also load the record-calls pref once
    if (!settingsLoadedRef.current) {
      settingsLoadedRef.current = true;
      apiFetch('/api/calling/settings')
        .then((r) => { recordCallsRef.current = !!r.data?.record_calls && !!r.data?.recording_storage_ready; })
        .catch(() => {});
    }

    function connect() {
      if (destroyedRef.current) return;
      const t = localStorage.getItem('token');
      if (!t) return;
      const es = new EventSource(`/api/events?token=${encodeURIComponent(t)}`);
      esRef.current = es;

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as {
            type?: string; contactId?: number;
            callerName?: string; callerPhone?: string;
            callId?: string; sdp?: string; agentName?: string;
          };

          if (data.type === 'incoming_call' && data.callId) {
            // Already on a call → don't pop a second one (Meta will ring it out as missed)
            if (activeCallRef.current) return;
            setIncomingCall({
              callId:    data.callId,
              contactId: data.contactId,
              name:      data.callerName || '',
              phone:     data.callerPhone || '',
              startedAt: Date.now(),
              sdp:       data.sdp,
            });
            try {
              if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                // Same tag as the server push for this call → OS shows ONE
                // notification, not two, when both paths fire.
                const n = new Notification('📞 Incoming WhatsApp call', {
                  body: data.callerName || data.callerPhone || '',
                  tag:  `call-${data.callId}`,
                });
                n.onclick = () => { window.focus(); n.close(); };
              }
            } catch { /* notifications unsupported */ }
          } else if (data.type === 'call_answer' && data.callId && data.sdp) {
            // Outbound call: customer picked up — finish WebRTC with their answer
            const ac = activeCallRef.current;
            if (ac && ac.callId === data.callId && callSessionRef.current) {
              callSessionRef.current.applyAnswer(data.sdp)
                .then(() => setActiveCall(prev => prev ? { ...prev, phase: 'connecting' } : prev))
                .catch((err) => { toast.error('Could not connect audio: ' + (err?.message || err)); endActiveCall(true); });
            }
          } else if (data.type === 'call_taken' && data.callId) {
            // Another agent answered — stop ringing on this panel
            const cur = incomingCallRef.current;
            if (cur && cur.callId === data.callId) {
              setIncomingCall(null);
              toast(`Call answered by ${data.agentName || 'another agent'}`, { icon: '📞' });
            }
          } else if (data.type === 'call_ended') {
            // Customer hung up / rang out / declined — dismiss popup and tear down any live session
            setIncomingCall(prev => (prev && (!data.callId || prev.callId === data.callId)) ? null : prev);
            const ac = activeCallRef.current;
            if (ac && (!data.callId || ac.callId === data.callId)) endActiveCall(false);
          }
        } catch { /* bad payload */ }
      };

      es.onerror = () => {
        es.close();
        if (esRef.current === es) esRef.current = null;
        if (!destroyedRef.current) {
          if (retryRef.current) clearTimeout(retryRef.current);
          retryRef.current = setTimeout(connect, 4000);
        }
      };
    }
    connect();
    // No per-navigation cleanup — the connection must outlive route changes.
  }, [pathname]);

  useEffect(() => () => {
    destroyedRef.current = true;
    if (retryRef.current) clearTimeout(retryRef.current);
    esRef.current?.close();
    callSessionRef.current?.close();
  }, []);

  // ── Softphone: answer / call / hang up ─────────────────────
  async function declineIncomingCall() {
    if (!incomingCallRef.current) return;
    setCallBusy(true);
    try {
      await apiFetch('/api/calling/action', { method: 'POST', body: JSON.stringify({ call_id: incomingCallRef.current.callId, action: 'reject' }) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not decline');
    } finally {
      setCallBusy(false);
      setIncomingCall(null);
    }
  }

  // Answer: mic → SDP answer (ICE complete) → pre_accept → (WebRTC connected) → accept
  async function answerIncomingCall() {
    const call = incomingCallRef.current;
    if (!call?.sdp) return;
    setCallBusy(true);
    const session = new WhatsAppCallSession({
      onConnected: () => {
        // Media path is up → tell Meta to start the call
        apiFetch('/api/calling/action', {
          method: 'POST',
          body: JSON.stringify({ call_id: call.callId, action: 'accept', sdp: lastSdpRef.current }),
        }).then(() => {
          setActiveCall(prev => prev ? { ...prev, phase: 'active', startedAt: Date.now() } : prev);
          if (recordCallsRef.current) callSessionRef.current?.startRecording();
        }).catch((err) => { toast.error('Accept failed: ' + (err?.message || err)); endActiveCall(true); });
      },
      onDisconnected: (reason) => {
        if (reason === 'failed') { toast.error('Call connection failed'); endActiveCall(true); }
        // 'disconnected' can be transient — the terminate webhook will clean up
      },
    });
    callSessionRef.current = session;
    try {
      const sdpAnswer = await session.answerOffer(call.sdp);
      lastSdpRef.current = sdpAnswer;
      setIncomingCall(null);
      setActiveCall({
        callId: call.callId, contactId: call.contactId, name: call.name, phone: call.phone,
        direction: 'inbound', phase: 'connecting', startedAt: Date.now(),
      });
      setCallMuted(false);
      await apiFetch('/api/calling/action', {
        method: 'POST',
        body: JSON.stringify({ call_id: call.callId, action: 'pre_accept', sdp: sdpAnswer }),
      });
      // 'accept' fires from onConnected once ICE/DTLS is up
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(/NotAllowed|Permission|denied/i.test(msg) ? 'Microphone permission denied — allow mic access to answer calls' : `Could not answer: ${msg}`);
      session.close();
      callSessionRef.current = null;
      setActiveCall(null);
      setIncomingCall(null);
    } finally {
      setCallBusy(false);
    }
  }

  // Outbound: mic → SDP offer (ICE complete) → action=connect → wait for call_answer SSE
  async function startOutboundCall(contact: { contactId?: number; name?: string; phone: string }) {
    if (activeCallRef.current) { toast.error('Already on a call'); return; }
    const session = new WhatsAppCallSession({
      onConnected: () => {
        setActiveCall(prev => prev ? { ...prev, phase: 'active', startedAt: Date.now() } : prev);
        if (recordCallsRef.current) callSessionRef.current?.startRecording();
      },
      onDisconnected: (reason) => { if (reason === 'failed') { toast.error('Call connection failed'); endActiveCall(true); } },
    });
    callSessionRef.current = session;
    setActiveCall({
      callId: '', contactId: contact.contactId, name: contact.name || contact.phone, phone: contact.phone,
      direction: 'outbound', phase: 'ringing', startedAt: Date.now(),
    });
    setCallMuted(false);
    try {
      const sdpOffer = await session.createOffer();
      const r = await apiFetch('/api/calling/action', {
        method: 'POST',
        body: JSON.stringify({ action: 'connect', to: contact.phone, sdp: sdpOffer }),
      });
      const callId = r.data?.call_id as string;
      if (!callId) throw new Error('No call id from Meta');
      setActiveCall(prev => prev ? { ...prev, callId } : prev);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(/NotAllowed|Permission denied/i.test(msg) ? 'Microphone permission denied' : msg, { duration: 7000 });
      session.close();
      callSessionRef.current = null;
      setActiveCall(null);
    }
  }

  // Hang up / clean up. sendTerminate=true tells Meta to end it (agent pressed hang up
  // or a local failure); false when Meta already told us the call ended.
  function endActiveCall(sendTerminate: boolean) {
    const ac = activeCallRef.current;
    if (ac && sendTerminate && ac.callId) {
      setActiveCall(prev => prev ? { ...prev, phase: 'ending' } : prev);
      apiFetch('/api/calling/action', { method: 'POST', body: JSON.stringify({ call_id: ac.callId, action: 'terminate' }) })
        .catch(() => {});
    }
    const session = callSessionRef.current;
    callSessionRef.current = null;
    setActiveCall(null);
    setCallMuted(false);
    if (!session) return;
    // Finish the recording (if any) and upload it in the background, then close
    const callId = ac?.callId || '';
    session.stopRecording()
      .then((rec) => {
        if (!rec || !callId) return;
        const fd = new FormData();
        fd.append('call_id', callId);
        fd.append('seconds', String(rec.seconds));
        fd.append('file', rec.blob, `call_${callId}.webm`);
        // raw fetch: apiFetch forces a JSON content-type which breaks multipart
        const token = localStorage.getItem('token');
        return fetch('/api/calling/recording', {
          method: 'POST', body: fd,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
          .then(async (res) => {
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
            toast.success('Call recording saved', { duration: 2500 });
          })
          .catch((err) => toast.error('Recording upload failed: ' + (err?.message || err), { duration: 6000 }));
      })
      .catch(() => {})
      .finally(() => session.close());
  }

  function toggleCallMute() {
    const next = !callMuted;
    callSessionRef.current?.setMuted(next);
    setCallMuted(next);
  }

  function openIncomingCallChat() {
    const call = incomingCallRef.current;
    if (!call) return;
    if (window.location.pathname.startsWith('/inbox')) {
      // Inbox is mounted — let it select the contact in place
      window.dispatchEvent(new CustomEvent('wa:open-chat', { detail: { contactId: call.contactId, phone: call.phone } }));
    } else {
      window.location.href = call.contactId ? `/inbox?contact=${call.contactId}` : '/inbox';
    }
  }

  // Pages ask us to place a call (e.g. inbox chat header "Call now")
  useEffect(() => {
    function onStartCall(e: Event) {
      const d = (e as CustomEvent).detail as { contactId?: number; name?: string; phone?: string } | undefined;
      if (d?.phone) startOutboundCall({ contactId: d.contactId, name: d.name, phone: d.phone });
    }
    window.addEventListener('wa:start-call', onStartCall);
    return () => window.removeEventListener('wa:start-call', onStartCall);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ring-out safety: dismiss a popup nobody touched (Meta rings ~60–90s)
  useEffect(() => {
    if (!incomingCall) return;
    const t = setTimeout(() => setIncomingCall(null), 90_000);
    return () => clearTimeout(t);
  }, [incomingCall]);

  return (<>
    {incomingCall && !activeCall && (
      <IncomingCallPopup call={incomingCall} busy={callBusy}
        onDecline={declineIncomingCall} onAnswer={answerIncomingCall} onOpenChat={openIncomingCallChat} />
    )}
    {activeCall && (
      <ActiveCallBar call={activeCall} muted={callMuted}
        recording={activeCall.phase === 'active' && recordCallsRef.current}
        onToggleMute={toggleCallMute} onHangup={() => endActiveCall(true)} />
    )}
  </>);
}
