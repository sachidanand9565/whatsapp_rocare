'use client';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/hooks/useApi';
import {
  Save, Eye, EyeOff, Copy, CheckCircle, AlertTriangle,
  Webhook, RefreshCw, Plus, Trash2, ToggleLeft, ToggleRight,
  Facebook, ChevronRight, X, Loader2, Key, RotateCcw, Zap,
  MessageSquare, Image, FileText, Music, MapPin, MousePointerClick, PauseCircle,
  Database, Globe, User, Lock, Pencil, PhoneCall, Clock, Bell,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { callHoursProfileLine } from '@/lib/call-hours';
import { ensurePushSubscription } from '@/app/components/CallManager';
import { MetaConnectModal, ConnectResults, useMetaConnect } from '@/app/components/MetaConnect';

interface CWHook {
  id:        number;
  name:      string;
  url:       string;
  secret:    string | null;
  is_active: number;
}

interface CRMIntegration {
  id:            number;
  name:          string;
  template_name: string;
  api_url:       string;
  api_method:    'POST' | 'GET';
  api_headers:   string | null;
  is_active:     number;
}

interface FailedWebhook {
  id:            number;
  name:          string;
  campaign_ids:  number[];
  campaigns:     { id: number; name: string }[];
  api_url:       string;
  api_method:    'POST' | 'GET';
  api_headers:   string | null;
  is_active:     number;
}

interface Campaign {
  id:   number;
  name: string;
}

// ── Main Settings Page ────────────────────────────────────────
export default function SettingsPage() {
  const [form, setForm] = useState({
    name:            '',
    phone_number_id: '',
    waba_id:         '',
    access_token:    '',
    verify_token:    '',
  });
  const [saving, setSaving]         = useState(false);
  const [showToken, setShowToken]   = useState(false);
  const [credSource, setCredSource] = useState<'database' | 'env' | 'none'>('none');
  const [testing, setTesting]       = useState(false);

  // Meta OAuth state
  // Coexistence: connect an existing WhatsApp Business App number (vs. a brand-new Cloud API number)

  // WABA ID input modal (fallback when BSP not available)

  // BSP Embedded Signup — postMessage data from Meta popup

  // Custom webhooks
  const [hooks, setHooks]               = useState<CWHook[]>([]);
  const [addForm, setAddForm]           = useState({ name: '', url: '', secret: '' });
  const [showAddSecret, setShowAddSecret] = useState(false);
  const [adding, setAdding]             = useState(false);
  const [testingId, setTestingId]       = useState<number | null>(null);

  // External chatbot API key
  const [apiKey, setApiKey]           = useState('');
  const [showApiKey, setShowApiKey]   = useState(false);
  const [regenLoading, setRegenLoading] = useState(false);

  // Campaign settings
  const [autoPauseCampaigns, setAutoPauseCampaigns] = useState(true);
  const [savingPause, setSavingPause] = useState(false);

  // Payload preview
  const [payloadTab, setPayloadTab] = useState<'text' | 'image' | 'audio' | 'document' | 'location' | 'button'>('text');
  const [workspaceId, setWorkspaceId] = useState<number | null>(null);

  // Sidebar navigation
  const [activeSection, setActiveSection] = useState<'profile' | 'wa-profile' | 'alerts' | 'auth' | 'developer' | 'campaigns' | 'crm' | 'calling'>('profile');

  // ── My Profile state ─────────────────────────────────────────
  const [profileForm, setProfileForm] = useState({ name: '', email: '', phone: '' });

  // ── WhatsApp Business profile (what customers see in the chat header) ──
  const [waProfile, setWaProfile] = useState({
    about: '', description: '', address: '', email: '', vertical: 'UNDEFINED',
    website1: '', website2: '', profile_picture_url: '',
  });
  const [waVerticals, setWaVerticals]   = useState<string[]>([]);
  const [waLoaded, setWaLoaded]         = useState(false);
  const [waLoading, setWaLoading]       = useState(false);
  const [waSaving, setWaSaving]         = useState(false);
  const [waPhotoBusy, setWaPhotoBusy]   = useState(false);
  const waPhotoRef = useRef<HTMLInputElement>(null);

  // ── Account health alerts (payment / ban / token failures) ──
  interface AlertRow { alert_type: string; error_code: number | null; detail: string | null; sent_at: string }
  const [alertsOn, setAlertsOn]         = useState(true);
  const [alertEmails, setAlertEmails]   = useState('');
  const [alertOwner, setAlertOwner]     = useState('');
  const [alertRecent, setAlertRecent]   = useState<AlertRow[]>([]);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [alertsBusy, setAlertsBusy]     = useState(false);
  const [alertTesting, setAlertTesting] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: '', next: '', confirm: '' });
  const [savingPwd, setSavingPwd] = useState(false);
  const [showCurPwd, setShowCurPwd]   = useState(false);
  const [showNextPwd, setShowNextPwd] = useState(false);


  async function loadAlerts() {
    try {
      const r = await apiFetch('/api/workspace/alerts');
      setAlertsOn(r.data?.enabled !== false);
      setAlertEmails((r.data?.extra_emails || []).join(', '));
      setAlertOwner(r.data?.owner_email || '');
      setAlertRecent(r.data?.recent || []);
      setAlertsLoaded(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load alert settings', { duration: 7000 });
    }
  }

  async function saveAlerts() {
    setAlertsBusy(true);
    try {
      await apiFetch('/api/workspace/alerts', {
        method: 'POST',
        body: JSON.stringify({
          enabled: alertsOn,
          extraEmails: alertEmails.split(',').map((e) => e.trim()).filter(Boolean),
        }),
      });
      toast.success('Alert settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed', { duration: 7000 });
    } finally {
      setAlertsBusy(false);
    }
  }

  async function sendAlertTest() {
    setAlertTesting(true);
    try {
      const r = await apiFetch('/api/workspace/alerts/test', { method: 'POST' });
      toast.success(`Test email sent to ${(r.data?.recipients || []).join(', ')}`, { duration: 6000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the test email', { duration: 7000 });
    } finally {
      setAlertTesting(false);
    }
  }

  // Meta is the source of truth here — always read it fresh, never cache in our DB
  async function loadWaProfile() {
    setWaLoading(true);
    try {
      const r = await apiFetch('/api/workspace/wa-profile');
      const d = r.data || {};
      setWaProfile({
        about:       d.about       || '',
        description: d.description || '',
        address:     d.address     || '',
        email:       d.email       || '',
        vertical:    d.vertical    || 'UNDEFINED',
        website1:    d.websites?.[0] || '',
        website2:    d.websites?.[1] || '',
        profile_picture_url: d.profile_picture_url || '',
      });
      setWaVerticals(d.verticals || []);
      setWaLoaded(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load the WhatsApp profile');
    } finally {
      setWaLoading(false);
    }
  }

  async function saveWaProfile() {
    setWaSaving(true);
    try {
      await apiFetch('/api/workspace/wa-profile', {
        method: 'POST',
        body: JSON.stringify({
          about:       waProfile.about,
          description: waProfile.description,
          address:     waProfile.address,
          email:       waProfile.email,
          vertical:    waProfile.vertical,
          websites:    [waProfile.website1, waProfile.website2].filter(Boolean),
        }),
      });
      toast.success('WhatsApp profile updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed', { duration: 7000 });
    } finally {
      setWaSaving(false);
    }
  }

  async function uploadWaPhoto(file: File) {
    setWaPhotoBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = localStorage.getItem('token');
      const res   = await fetch('/api/workspace/wa-profile/photo', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
      });
      // A proxy rejecting the upload answers with HTML, not JSON
      const text = await res.text();
      let data: { error?: string; data?: { profile_picture_url?: string } } = {};
      try { data = JSON.parse(text); } catch { /* keep the status-based message */ }
      if (!res.ok) {
        throw new Error(
          res.status === 413
            ? `Server rejected the ${(file.size / (1024 * 1024)).toFixed(1)} MB image — upload limit is too low`
            : data.error || `Upload failed (HTTP ${res.status})`
        );
      }
      if (data.data?.profile_picture_url) {
        setWaProfile((p) => ({ ...p, profile_picture_url: data.data!.profile_picture_url as string }));
      }
      toast.success('Display picture updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed', { duration: 7000 });
    } finally {
      setWaPhotoBusy(false);
    }
  }

  useEffect(() => {
    if (activeSection !== 'profile' || profileLoaded) return;
    apiFetch('/api/profile').then((r) => {
      if (r.data) {
        setProfileForm({ name: r.data.name || '', email: r.data.email || '', phone: r.data.phone || '' });
        setProfileLoaded(true);
      }
    });
  }, [activeSection, profileLoaded]);

  useEffect(() => {
    if (activeSection === 'wa-profile' && !waLoaded && !waLoading) loadWaProfile();
    if (activeSection === 'alerts' && !alertsLoaded) loadAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  async function saveProfile() {
    setSavingProfile(true);
    try {
      await apiFetch('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ name: profileForm.name, email: profileForm.email, phone: profileForm.phone }),
      });
      toast.success('Profile updated!');
    } catch { toast.error('Failed to save'); }
    finally { setSavingProfile(false); }
  }

  async function changePassword() {
    if (!pwdForm.current) { toast.error('Enter current password'); return; }
    if (!pwdForm.next)    { toast.error('Enter new password'); return; }
    if (pwdForm.next !== pwdForm.confirm) { toast.error('Passwords do not match'); return; }
    setSavingPwd(true);
    try {
      const r = await apiFetch('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ current_password: pwdForm.current, new_password: pwdForm.next }),
      });
      // Replace token so current session stays logged in
      if (r.data?.token) {
        localStorage.setItem('token', r.data.token);
      }
      setPwdForm({ current: '', next: '', confirm: '' });
      toast.success('Password changed — all other sessions logged out');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setSavingPwd(false); }
  }

  // CRM integrations
  const [crmList, setCrmList]         = useState<CRMIntegration[]>([]);
  const [crmTemplates, setCrmTemplates] = useState<string[]>([]);
  const [crmForm, setCrmForm]         = useState({ name: '', template_name: '', api_url: '', api_method: 'POST', api_headers: '' });
  const [crmAdding, setCrmAdding]     = useState(false);
  const [crmEditId, setCrmEditId]     = useState<number | null>(null);
  const [showCrmHeaders, setShowCrmHeaders] = useState(false);

  // WhatsApp Business Calling
  interface CallHourSlot { day_of_week: string; open_time: string; close_time: string }
  interface CallHoliday  { date: string; start_time: string; end_time: string }
  interface CallHours {
    status: 'ENABLED' | 'DISABLED';
    timezone_id: string;
    weekly_operating_hours: CallHourSlot[];
    holiday_schedule: CallHoliday[];
  }
  interface CallingState {
    configured: boolean;
    calling: {
      status?: string; call_icon_visibility?: string; callback_permission_status?: string;
      call_hours?: Partial<CallHours> | null;
    } | null;
    phone: { display_phone_number?: string; verified_name?: string; messaging_limit_tier?: string; quality_rating?: string } | null;
    tier_ok?: boolean;
    meta_error?: string | null;
    missed_call_template: string | null;
    missed_call_template_lang: string;
    record_calls?: boolean;
    recording_retention_days?: number;
    recording_storage_ready?: boolean;
    hours_on_profile?: boolean;
    profile_hours_line?: string | null;
  }
  const [callingInfo, setCallingInfo]       = useState<CallingState | null>(null);
  const [retentionDays, setRetentionDays]   = useState(90);
  const [callingLoading, setCallingLoading] = useState(false);
  const [callingSaving, setCallingSaving]   = useState(false);
  const [missedTpl, setMissedTpl]           = useState('');
  const [approvedTemplates, setApprovedTemplates] = useState<{ name: string; language: string }[]>([]);

  // Call hours ("calling time") — stored on Meta; the call button is hidden
  // outside this window automatically. Times are HHMM (24h) on the wire.
  const CALL_DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
  const DEFAULT_CALL_HOURS: CallHours = {
    status: 'DISABLED',
    timezone_id: 'Asia/Kolkata',
    weekly_operating_hours: CALL_DAYS.slice(0, 6).map((d) => ({ day_of_week: d, open_time: '0900', close_time: '1800' })),
    holiday_schedule: [],
  };
  const [callHours, setCallHours]           = useState<CallHours>(DEFAULT_CALL_HOURS);
  const [callHoursDirty, setCallHoursDirty] = useState(false);
  const [hoursOnProfile, setHoursOnProfile] = useState(false);
  // Device push notifications (ring on mobile / closed tab)
  const [pushPerm, setPushPerm] = useState<'unsupported' | 'default' | 'granted' | 'denied'>('default');
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
      setPushPerm('unsupported');
    } else {
      setPushPerm(Notification.permission as 'default' | 'granted' | 'denied');
    }
  }, []);
  async function sendTestPush() {
    setPushBusy(true);
    try {
      const r = await apiFetch('/api/push/test', { method: 'POST', body: JSON.stringify({}) });
      const n = Number(r.data?.devices || 0);
      if (n === 0) toast.error('No subscribed device found — click "Enable on this device" first');
      else toast.success(`Test sent to ${n} device${n > 1 ? 's' : ''} — check your notification tray. Nothing shown? Check Windows/phone notification settings for your browser.`, { duration: 9000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test failed');
    } finally { setPushBusy(false); }
  }
  async function enableDevicePush() {
    setPushBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPushPerm(perm as 'granted' | 'denied' | 'default');
      if (perm !== 'granted') {
        toast.error('Notifications blocked — allow them in the browser site settings');
        return;
      }
      await ensurePushSubscription();
      toast.success('This device will now ring for incoming WhatsApp calls');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not enable notifications', { duration: 7000 });
    } finally { setPushBusy(false); }
  }
  const [newHoliday, setNewHoliday]         = useState('');
  const TIMEZONES: string[] = (() => {
    try {
      const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
      if (sv?.length) return sv;
    } catch { /* older browser */ }
    return ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'UTC'];
  })();
  // "HHMM" ⇄ "HH:MM" (for <input type="time">)
  const hhmmToInput = (t: string) => (t && t.length === 4 ? `${t.slice(0, 2)}:${t.slice(2)}` : '');
  const inputToHhmm = (t: string) => t.replace(':', '');
  const fmtHHMM = (t: string) => {
    if (!t || t.length !== 4) return t;
    const h = Number(t.slice(0, 2)), m = t.slice(2);
    return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'}`;
  };
  function callHoursFromMeta(raw?: Partial<CallHours> | null): CallHours {
    if (!raw) return DEFAULT_CALL_HOURS;
    const weekly = (raw.weekly_operating_hours || []).map((s) => ({
      day_of_week: String(s.day_of_week || '').toUpperCase(),
      open_time:   String(s.open_time  || '').replace(':', ''),
      close_time:  String(s.close_time || '').replace(':', ''),
    }));
    return {
      status:      raw.status === 'ENABLED' ? 'ENABLED' : 'DISABLED',
      timezone_id: raw.timezone_id || 'Asia/Kolkata',
      // Meta returns nothing until hours are set once — prefill a sensible week
      weekly_operating_hours: weekly.length ? weekly : DEFAULT_CALL_HOURS.weekly_operating_hours,
      holiday_schedule: (raw.holiday_schedule || []).map((h) => ({
        date: h.date || '', start_time: String(h.start_time || '0000').replace(':', ''), end_time: String(h.end_time || '2359').replace(':', ''),
      })),
    };
  }
  // Is the business open for calls right now (in the configured timezone)?
  function callHoursOpenNow(ch: CallHours): boolean | null {
    if (ch.status !== 'ENABLED') return null;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: ch.timezone_id, weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date());
      const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
      const day  = get('weekday').toUpperCase();
      const hour = get('hour') === '24' ? '00' : get('hour').padStart(2, '0'); // en-US 24h can render midnight as "24"
      const now  = `${hour}${get('minute').padStart(2, '0')}`;
      const date = `${get('year')}-${get('month')}-${get('day')}`;
      const hol  = ch.holiday_schedule.find((h) => h.date === date);
      if (hol && now >= hol.start_time && now <= hol.end_time) return false;
      return ch.weekly_operating_hours.some((s) => s.day_of_week === day && now >= s.open_time && now < s.close_time);
    } catch { return null; }
  }
  function updateCallHours(patch: Partial<CallHours>) {
    setCallHours((c) => ({ ...c, ...patch }));
    setCallHoursDirty(true);
  }
  function setDaySlots(day: string, slots: { open_time: string; close_time: string }[]) {
    const others = callHours.weekly_operating_hours.filter((s) => s.day_of_week !== day);
    updateCallHours({ weekly_operating_hours: [...others, ...slots.map((s) => ({ day_of_week: day, ...s }))] });
  }
  function copyDayToAll(day: string) {
    const src = callHours.weekly_operating_hours.filter((s) => s.day_of_week === day);
    if (!src.length) return;
    const activeDays = new Set(callHours.weekly_operating_hours.map((s) => s.day_of_week));
    const next: CallHourSlot[] = [];
    for (const d of CALL_DAYS) {
      if (d === day || activeDays.has(d)) src.forEach((s) => next.push({ ...s, day_of_week: d }));
    }
    updateCallHours({ weekly_operating_hours: next });
    toast.success(`Copied ${day.slice(0, 3)} hours to all active days`);
  }

  // Failed message webhooks
  const [fwList, setFwList]           = useState<FailedWebhook[]>([]);
  const [fwCampaigns, setFwCampaigns] = useState<Campaign[]>([]);
  const [fwForm, setFwForm]           = useState({ name: '', campaign_ids: [] as number[], api_url: '', api_method: 'POST', api_headers: '' });
  const [fwCampaignSearch, setFwCampaignSearch] = useState('');
  const [fwAdding, setFwAdding]       = useState(false);
  const [fwEditId, setFwEditId]       = useState<number | null>(null);
  const [showFwHeaders, setShowFwHeaders] = useState(false);

  // Meta Embedded Signup lives in one place — the dashboard uses the same flow
  const {
    APP_ID, BSP_READY,
    fbLoaded, fbLoading, connecting,
    coexistMode, setCoexistMode,
    wabas, setWabas,
    connectResults, setConnectResults,
    showWabaInput, setShowWabaInput,
    wabaInputId, setWabaInputId,
    fetchingPhones, fetchPhonesForWaba,
    loginWithFacebook, handleConnect,
  } = useMetaConnect({
    onConnected: () => {
      apiFetch('/api/workspace').then((wr) => {
        if (wr.data) {
          setForm({
            name:            wr.data.name            || '',
            phone_number_id: wr.data.phone_number_id || '',
            waba_id:         wr.data.waba_id         || '',
            access_token:    wr.data.access_token    || '',
            verify_token:    wr.data.verify_token    || '',
          });
          setCredSource('database');
        }
      });
    },
  });

  useEffect(() => {
    apiFetch('/api/workspace').then((r) => {
      if (r.data) {
        setForm({
          name:            r.data.name            || '',
          phone_number_id: r.data.phone_number_id || '',
          waba_id:         r.data.waba_id         || '',
          access_token:    r.data.access_token    || '',
          verify_token:    r.data.verify_token    || '',
        });
        setCredSource(r.data.credentials_source || 'none');
        if (r.data.id) setWorkspaceId(r.data.id);
      }
    });
    loadHooks();
    loadCrm();
    loadFw();
    loadCalling();
    apiFetch('/api/workspace/api-key').then((r) => setApiKey(r.data?.api_key || ''));
    apiFetch('/api/campaign-settings').then((r) => {
      if (r.data) setAutoPauseCampaigns(!!r.data.auto_pause_campaigns);
    });
    // Load template names for CRM dropdown
    apiFetch('/api/templates').then((r) => {
      const names: string[] = Array.from(new Set((r.data || []).map((t: { name: string }) => t.name)));
      setCrmTemplates(names);
    }).catch(() => {});
  }, []);

  function loadHooks() {
    apiFetch('/api/webhooks').then((r) => setHooks(r.data || []));
  }

  function loadCrm() {
    apiFetch('/api/crm').then((r) => setCrmList(r.data || [])).catch(() => {});
  }

  function loadCalling() {
    setCallingLoading(true);
    apiFetch('/api/calling/settings')
      .then((r) => {
        setCallingInfo(r.data || null);
        setMissedTpl(r.data?.missed_call_template || '');
        setRetentionDays(Number(r.data?.recording_retention_days ?? 90));
        setCallHours(callHoursFromMeta(r.data?.calling?.call_hours));
        setCallHoursDirty(false);
        setHoursOnProfile(!!r.data?.hours_on_profile);
      })
      .catch(() => {})
      .finally(() => setCallingLoading(false));
    apiFetch('/api/templates').then((r) => {
      const approved = (r.data || [])
        .filter((t: { status: string }) => t.status === 'APPROVED')
        .map((t: { name: string; language: string }) => ({ name: t.name, language: t.language }));
      setApprovedTemplates(approved);
    }).catch(() => {});
  }

  async function toggleCalling() {
    if (!callingInfo) return;
    const enabling = callingInfo.calling?.status !== 'ENABLED';
    setCallingSaving(true);
    try {
      await apiFetch('/api/calling/settings', { method: 'PUT', body: JSON.stringify({ enabled: enabling }) });
      toast.success(enabling ? 'Calling enabled — WhatsApp may take a few minutes to show the call button' : 'Calling disabled');
      loadCalling();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setCallingSaving(false); }
  }

  async function setCallIconVisibility(v: 'DEFAULT' | 'DISABLE_ALL') {
    setCallingSaving(true);
    try {
      await apiFetch('/api/calling/settings', { method: 'PUT', body: JSON.stringify({ call_icon_visibility: v }) });
      toast.success('Updated');
      loadCalling();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setCallingSaving(false); }
  }

  async function saveCallHours(next: CallHours = callHours, showOnProfile: boolean = hoursOnProfile) {
    if (next.status === 'ENABLED' && next.weekly_operating_hours.length === 0) {
      toast.error('Add at least one day with hours first');
      return;
    }
    for (const s of next.weekly_operating_hours) {
      if (!s.open_time || !s.close_time || s.open_time >= s.close_time) {
        toast.error(`${s.day_of_week.slice(0, 3)}: opening time must be before closing time`);
        return;
      }
    }
    setCallingSaving(true);
    try {
      await apiFetch('/api/calling/settings', {
        method: 'PUT',
        body: JSON.stringify({ call_hours: next, show_hours_on_profile: next.status === 'ENABLED' && showOnProfile }),
      });
      toast.success(next.status === 'ENABLED'
        ? (showOnProfile ? 'Calling hours saved & shown on your WhatsApp profile' : 'Calling hours saved — customers can call only within these hours')
        : 'Calling hours off — customers can call any time');
      loadCalling();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed', { duration: 7000 });
    } finally { setCallingSaving(false); }
  }
  function toggleHoursOnProfile() {
    const next = !hoursOnProfile;
    setHoursOnProfile(next);
    saveCallHours(callHours, next);
  }
  function toggleCallHours() {
    const next: CallHours = { ...callHours, status: callHours.status === 'ENABLED' ? 'DISABLED' : 'ENABLED' };
    setCallHours(next);
    saveCallHours(next);
  }

  async function toggleRecordCalls() {
    if (!callingInfo) return;
    const next = !callingInfo.record_calls;
    setCallingSaving(true);
    try {
      await apiFetch('/api/calling/settings', { method: 'PUT', body: JSON.stringify({ record_calls: next }) });
      toast.success(next ? 'Call recording ON — calls answered/placed from the Inbox will be recorded' : 'Call recording OFF');
      loadCalling();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed', { duration: 7000 });
    } finally { setCallingSaving(false); }
  }
  async function saveRetention() {
    setCallingSaving(true);
    try {
      await apiFetch('/api/calling/settings', { method: 'PUT', body: JSON.stringify({ recording_retention_days: retentionDays }) });
      toast.success('Retention saved');
      loadCalling();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setCallingSaving(false); }
  }

  async function saveMissedCallTemplate() {
    setCallingSaving(true);
    try {
      const tpl = approvedTemplates.find((t) => t.name === missedTpl);
      await apiFetch('/api/calling/settings', {
        method: 'PUT',
        body: JSON.stringify({ missed_call_template: missedTpl || null, missed_call_template_lang: tpl?.language || 'en' }),
      });
      toast.success(missedTpl ? 'Missed-call auto-reply saved' : 'Missed-call auto-reply turned off');
      loadCalling();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setCallingSaving(false); }
  }

  function loadFw() {
    apiFetch('/api/failed-webhooks').then((r) => setFwList(r.data || [])).catch(() => {});
    apiFetch('/api/campaigns').then((r) => setFwCampaigns((r.data || []).map((c: Campaign) => ({ id: c.id, name: c.name })))).catch(() => {});
  }

  async function addFw(e: React.FormEvent) {
    e.preventDefault();
    if (!fwForm.name || !fwForm.api_url) return;
    if (fwForm.campaign_ids.length === 0) { toast.error('Select at least one campaign'); return; }
    setFwAdding(true);
    try {
      const body = JSON.stringify({
        name:         fwForm.name,
        campaign_ids: fwForm.campaign_ids,
        api_url:     fwForm.api_url,
        api_method:  fwForm.api_method,
        api_headers: fwForm.api_headers || null,
      });
      if (fwEditId) {
        await apiFetch(`/api/failed-webhooks/${fwEditId}`, { method: 'PATCH', body });
      } else {
        await apiFetch('/api/failed-webhooks', { method: 'POST', body });
      }
      toast.success(fwEditId ? 'Webhook updated!' : 'Failed message webhook added!');
      cancelFwEdit();
      loadFw();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : fwEditId ? 'Failed to update webhook' : 'Failed to add webhook');
    }
    finally   { setFwAdding(false); }
  }

  function startFwEdit(item: FailedWebhook) {
    setFwEditId(item.id);
    setFwForm({
      name:         item.name,
      campaign_ids: item.campaign_ids || [],
      api_url:      item.api_url,
      api_method:   item.api_method,
      api_headers:  item.api_headers || '',
    });
    setFwCampaignSearch('');
    setShowFwHeaders(!!item.api_headers);
  }

  function cancelFwEdit() {
    setFwEditId(null);
    setFwForm({ name: '', campaign_ids: [], api_url: '', api_method: 'POST', api_headers: '' });
    setFwCampaignSearch('');
    setShowFwHeaders(false);
  }

  function toggleFwCampaign(id: number) {
    setFwForm((f) => ({
      ...f,
      campaign_ids: f.campaign_ids.includes(id)
        ? f.campaign_ids.filter((c) => c !== id)
        : [...f.campaign_ids, id],
    }));
  }

  async function toggleFw(item: FailedWebhook) {
    await apiFetch(`/api/failed-webhooks/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: item.is_active ? 0 : 1 }),
    }).catch(() => {});
    loadFw();
  }

  async function deleteFw(id: number) {
    if (!confirm('Delete this webhook?')) return;
    await apiFetch(`/api/failed-webhooks/${id}`, { method: 'DELETE' }).catch(() => {});
    if (id === fwEditId) cancelFwEdit();
    loadFw();
    toast.success('Webhook deleted');
  }

  async function addCrm(e: React.FormEvent) {
    e.preventDefault();
    if (!crmForm.name || !crmForm.template_name || !crmForm.api_url) return;
    setCrmAdding(true);
    try {
      const body = JSON.stringify({
        name:          crmForm.name,
        template_name: crmForm.template_name,
        api_url:       crmForm.api_url,
        api_method:    crmForm.api_method,
        api_headers:   crmForm.api_headers || null,
      });
      if (crmEditId) {
        await apiFetch(`/api/crm/${crmEditId}`, { method: 'PATCH', body });
      } else {
        await apiFetch('/api/crm', { method: 'POST', body });
      }
      toast.success(crmEditId ? 'CRM integration updated!' : 'CRM integration added successfully!');
      cancelCrmEdit();
      loadCrm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setCrmAdding(false); }
  }

  function startCrmEdit(item: CRMIntegration) {
    setCrmEditId(item.id);
    setCrmForm({
      name:          item.name,
      template_name: item.template_name,
      api_url:       item.api_url,
      api_method:    item.api_method,
      api_headers:   item.api_headers || '',
    });
    setShowCrmHeaders(!!item.api_headers);
  }

  function cancelCrmEdit() {
    setCrmEditId(null);
    setCrmForm({ name: '', template_name: '', api_url: '', api_method: 'POST', api_headers: '' });
    setShowCrmHeaders(false);
  }

  async function deleteCrm(id: number) {
    if (!confirm('Delete this CRM integration?')) return;
    await apiFetch(`/api/crm/${id}`, { method: 'DELETE' });
    setCrmList((l) => l.filter((x) => x.id !== id));
    if (id === crmEditId) cancelCrmEdit();
    toast.success('Deleted');
  }

  async function toggleCrm(item: CRMIntegration) {
    await apiFetch(`/api/crm/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: item.is_active ? 0 : 1 }),
    });
    setCrmList((l) => l.map((x) => x.id === item.id ? { ...x, is_active: item.is_active ? 0 : 1 } : x));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/workspace', {
        method: 'PUT',
        body: JSON.stringify({
          name:            form.name,
          phone_number_id: form.phone_number_id,
          waba_id:         form.waba_id,
          access_token:    form.access_token,
        }),
      });
      setCredSource('database');
      toast.success('Settings saved!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error saving');
    } finally {
      setSaving(false);
    }
  }

  async function toggleAutoPause() {
    const newVal = !autoPauseCampaigns;
    setAutoPauseCampaigns(newVal);
    setSavingPause(true);
    try {
      await apiFetch('/api/campaign-settings', {
        method: 'PUT',
        body: JSON.stringify({ auto_pause_campaigns: newVal ? 1 : 0 }),
      });
      toast.success(newVal ? 'Auto-pause enabled' : 'Auto-pause disabled');
    } catch {
      setAutoPauseCampaigns(!newVal);
      toast.error('Failed to save setting');
    } finally {
      setSavingPause(false);
    }
  }

  async function testConnection() {
    if (!form.access_token || !form.waba_id) { toast.error('Enter credentials first'); return; }
    setTesting(true);
    try {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${form.waba_id}?fields=id,name&access_token=${form.access_token}`
      );
      const data = await res.json();
      if (data.id) toast.success(`Connected! Business: ${data.name || data.id}`);
      else toast.error(`Error: ${data.error?.message || 'Invalid credentials'}`);
    } catch { toast.error('Connection test failed'); }
    finally { setTesting(false); }
  }

  async function addWebhook(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      await apiFetch('/api/webhooks', { method: 'POST', body: JSON.stringify(addForm) });
      setAddForm({ name: '', url: '', secret: '' });
      loadHooks();
      toast.success('Webhook added!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setAdding(false); }
  }

  async function deleteHook(id: number) {
    if (!confirm('Delete this webhook?')) return;
    await apiFetch(`/api/webhooks/${id}`, { method: 'DELETE' });
    setHooks((h) => h.filter((x) => x.id !== id));
    toast.success('Deleted');
  }

  async function toggleHook(hook: CWHook) {
    await apiFetch(`/api/webhooks/${hook.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: hook.is_active ? 0 : 1 }),
    });
    setHooks((h) => h.map((x) => x.id === hook.id ? { ...x, is_active: hook.is_active ? 0 : 1 } : x));
  }

  async function testHook(hook: CWHook) {
    setTestingId(hook.id);
    try {
      const res = await apiFetch('/api/webhooks/test', {
        method: 'POST',
        body: JSON.stringify({ url: hook.url, secret: hook.secret }),
      });
      toast.success(`Test sent → ${res.data?.status ?? '?'} ${res.data?.statusText ?? ''}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test failed');
    } finally { setTestingId(null); }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast.success('Copied!');
  }

  async function regenApiKey() {
    if (!confirm('Regenerate API key? The old key will stop working immediately.')) return;
    setRegenLoading(true);
    try {
      const r = await apiFetch('/api/workspace/api-key', { method: 'POST' });
      setApiKey(r.data?.api_key || '');
      toast.success('New API key generated!');
    } catch { toast.error('Failed to regenerate'); }
    finally { setRegenLoading(false); }
  }

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/webhook`
    : 'https://your-domain.com/api/webhook';

  const isConnected  = !!(form.access_token && form.phone_number_id && form.waba_id);
  const isConfigured = isConnected;

  const navBtn = (id: string) =>
    `w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
      activeSection === id
        ? 'bg-teal-50 text-whatsapp-teal'
        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
    }`;

  return (
    <div className="flex -mx-4 lg:-mx-6 -mt-4 lg:-mt-6" style={{ minHeight: 'calc(100vh - 57px)' }}>

      {/* ── Inner Settings Sidebar ── */}
      <aside className="w-52 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
        <div className="p-4 pt-5">
          <p className="text-xs font-bold text-gray-800 px-3 pb-4">Settings</p>

          <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider px-3 pb-1">Account</p>
          <button onClick={() => setActiveSection('profile')} className={navBtn('profile')}>
            <User size={14} /> My Profile
          </button>
          <button onClick={() => setActiveSection('wa-profile')} className={navBtn('wa-profile')}>
            <MessageSquare size={14} /> WhatsApp Profile
          </button>
          <button onClick={() => setActiveSection('alerts')} className={navBtn('alerts')}>
            <Bell size={14} /> Alerts
          </button>

          <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider px-3 pt-4 pb-1">General</p>
          <button onClick={() => setActiveSection('auth')} className={navBtn('auth')}>
            <Key size={14} /> Auth &amp; WhatsApp
          </button>

          <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider px-3 pt-4 pb-1">Developer</p>
          <button onClick={() => setActiveSection('developer')} className={navBtn('developer')}>
            <Webhook size={14} /> Webhooks &amp; API
          </button>

          <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider px-3 pt-4 pb-1">Manage</p>
          <button onClick={() => setActiveSection('campaigns')} className={navBtn('campaigns')}>
            <PauseCircle size={14} /> Campaigns
          </button>
          <button onClick={() => setActiveSection('crm')} className={navBtn('crm')}>
            <Database size={14} /> CRM
          </button>
          <button onClick={() => setActiveSection('calling')} className={navBtn('calling')}>
            <PhoneCall size={14} /> Calling
          </button>
        </div>
      </aside>

      {/* ── Content Area ── */}
      <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6">

        {/* ─── PROFILE SECTION ─── */}
        {activeSection === 'profile' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-gray-900">My Profile</h2>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">

            {/* Personal Details */}
            <div className="card space-y-4">
              <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                <User size={18} className="text-whatsapp-teal" />
                <p className="font-semibold text-gray-800">Personal Details</p>
              </div>
              <div>
                <label className="form-label">Full Name</label>
                <input
                  value={profileForm.name}
                  onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                  className="input" placeholder="Your name"
                />
              </div>
              <div>
                <label className="form-label">Email</label>
                <input
                  type="email"
                  value={profileForm.email}
                  readOnly
                  className="input bg-gray-50 text-gray-400 cursor-not-allowed"
                />
                <p className="text-xs text-gray-400 mt-1">Email cannot be changed</p>
              </div>
              <div>
                <label className="form-label">Phone (optional)</label>
                <input
                  value={profileForm.phone}
                  onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                  className="input" placeholder="+91 9876543210"
                />
              </div>
              <button
                onClick={saveProfile}
                disabled={savingProfile}
                className="btn-primary flex items-center gap-2 disabled:opacity-50">
                {savingProfile ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Details
              </button>
            </div>

            {/* Change password */}
            <div className="card space-y-4">
              <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                <Lock size={18} className="text-whatsapp-teal" />
                <div>
                  <p className="font-semibold text-gray-800">Change Password</p>
                  <p className="text-xs text-gray-400 mt-0.5">All other logged-in sessions will be signed out</p>
                </div>
              </div>
              <div>
                <label className="form-label">Current Password</label>
                <div className="relative">
                  <input
                    type={showCurPwd ? 'text' : 'password'}
                    value={pwdForm.current}
                    onChange={(e) => setPwdForm({ ...pwdForm, current: e.target.value })}
                    className="input pr-10" placeholder="Enter current password"
                  />
                  <button type="button" onClick={() => setShowCurPwd(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showCurPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="form-label">New Password</label>
                <div className="relative">
                  <input
                    type={showNextPwd ? 'text' : 'password'}
                    value={pwdForm.next}
                    onChange={(e) => setPwdForm({ ...pwdForm, next: e.target.value })}
                    className="input pr-10" placeholder="Min. 6 characters"
                  />
                  <button type="button" onClick={() => setShowNextPwd(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showNextPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="form-label">Confirm New Password</label>
                <input
                  type="password"
                  value={pwdForm.confirm}
                  onChange={(e) => setPwdForm({ ...pwdForm, confirm: e.target.value })}
                  className="input" placeholder="Re-enter new password"
                />
              </div>
              <button
                onClick={changePassword}
                disabled={savingPwd || !pwdForm.current || !pwdForm.next || !pwdForm.confirm}
                className="btn-primary flex items-center gap-2 disabled:opacity-50">
                {savingPwd ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                Change Password
              </button>
            </div>

            </div>{/* end grid */}
          </div>
        )}

        {/* ─── AUTH SECTION ─── */}
        {/* ─── WHATSAPP BUSINESS PROFILE ─── */}
        {activeSection === 'wa-profile' && (
          <div className="space-y-4 max-w-3xl">
            <div>
              <h2 className="text-lg font-bold text-gray-900">WhatsApp Profile</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                This is what customers see when they open your chat. Saved straight to Meta.
              </p>
            </div>

            {waLoading ? (
              <div className="card py-16 text-center text-gray-400">
                <Loader2 size={22} className="animate-spin mx-auto" />
              </div>
            ) : (
              <>
                {/* Display picture */}
                <div className="card space-y-4">
                  <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                    <Image size={18} className="text-whatsapp-teal" />
                    <p className="font-semibold text-gray-800">Display Picture</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0 border border-gray-200">
                      {waProfile.profile_picture_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={waProfile.profile_picture_url} alt="Display picture" className="w-full h-full object-cover" />
                      ) : (
                        <User size={28} className="text-gray-300" />
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <button onClick={() => waPhotoRef.current?.click()} disabled={waPhotoBusy}
                        className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-60">
                        {waPhotoBusy ? <Loader2 size={14} className="animate-spin" /> : <Image size={14} />}
                        {waPhotoBusy ? 'Uploading…' : 'Change picture'}
                      </button>
                      <p className="text-xs text-gray-400">JPG or PNG, square, at least 192×192 px, under 5 MB</p>
                    </div>
                    <input ref={waPhotoRef} type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadWaPhoto(f); e.target.value = ''; }} />
                  </div>
                </div>

                {/* Business details */}
                <div className="card space-y-4">
                  <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                    <Globe size={18} className="text-whatsapp-teal" />
                    <p className="font-semibold text-gray-800">Business Details</p>
                  </div>

                  <div>
                    <label className="form-label">About</label>
                    <input value={waProfile.about} maxLength={139}
                      onChange={(e) => setWaProfile({ ...waProfile, about: e.target.value })}
                      className="input" placeholder="Hi! We are here to help." />
                    <p className="text-xs text-gray-400 mt-1">{waProfile.about.length}/139 — the line under your name in the chat</p>
                  </div>

                  <div>
                    <label className="form-label">Description</label>
                    <textarea value={waProfile.description} maxLength={512} rows={3}
                      onChange={(e) => setWaProfile({ ...waProfile, description: e.target.value })}
                      className="input resize-none" placeholder="What your business does" />
                    <p className="text-xs text-gray-400 mt-1">{waProfile.description.length}/512</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">Business category</label>
                      <select value={waProfile.vertical}
                        onChange={(e) => setWaProfile({ ...waProfile, vertical: e.target.value })}
                        className="input">
                        {(waVerticals.length ? waVerticals : [waProfile.vertical]).map((v) => (
                          <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Contact email</label>
                      <input type="email" value={waProfile.email} maxLength={128}
                        onChange={(e) => setWaProfile({ ...waProfile, email: e.target.value })}
                        className="input" placeholder="support@company.com" />
                    </div>
                  </div>

                  <div>
                    <label className="form-label">Address</label>
                    <input value={waProfile.address} maxLength={256}
                      onChange={(e) => setWaProfile({ ...waProfile, address: e.target.value })}
                      className="input" placeholder="Shop 12, MG Road, Lucknow" />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">Website</label>
                      <input value={waProfile.website1} maxLength={256}
                        onChange={(e) => setWaProfile({ ...waProfile, website1: e.target.value })}
                        className="input" placeholder="https://company.com" />
                    </div>
                    <div>
                      <label className="form-label">Second website <span className="text-gray-400 font-normal">(optional)</span></label>
                      <input value={waProfile.website2} maxLength={256}
                        onChange={(e) => setWaProfile({ ...waProfile, website2: e.target.value })}
                        className="input" placeholder="https://company.com/support" />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={saveWaProfile} disabled={waSaving}
                      className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60">
                      {waSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                      {waSaving ? 'Saving…' : 'Save profile'}
                    </button>
                    <button onClick={loadWaProfile} disabled={waLoading}
                      className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-60">
                      <RefreshCw size={14} /> Reload from Meta
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ─── ACCOUNT HEALTH ALERTS ─── */}
        {activeSection === 'alerts' && (
          <div className="space-y-4 max-w-3xl">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Alerts</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Get an email the moment sending breaks — a billing problem, a restricted number or an expired token.
              </p>
            </div>

            <div className="card space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2">
                  <Bell size={18} className="text-whatsapp-teal" />
                  <p className="font-semibold text-gray-800">Email me when sending breaks</p>
                </div>
                <button onClick={() => setAlertsOn((v) => !v)} className="flex-shrink-0">
                  {alertsOn
                    ? <ToggleRight size={34} className="text-whatsapp-green" />
                    : <ToggleLeft  size={34} className="text-gray-300" />}
                </button>
              </div>

              <div>
                <label className="form-label">Sent to</label>
                <input value={alertOwner} readOnly className="input bg-gray-50 text-gray-500 cursor-not-allowed" />
                <p className="text-xs text-gray-400 mt-1">Your registration email — always included</p>
              </div>

              <div>
                <label className="form-label">Also notify <span className="text-gray-400 font-normal">(optional)</span></label>
                <input value={alertEmails} onChange={(e) => setAlertEmails(e.target.value)}
                  className="input" placeholder="accounts@company.com, manager@company.com" />
                <p className="text-xs text-gray-400 mt-1">Comma-separated, up to 5 addresses</p>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                One email per problem every 3 hours — a campaign that fails for 5,000 contacts still sends a single alert.
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button onClick={saveAlerts} disabled={alertsBusy}
                  className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60">
                  {alertsBusy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {alertsBusy ? 'Saving…' : 'Save'}
                </button>
                <button onClick={sendAlertTest} disabled={alertTesting}
                  className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-60">
                  {alertTesting ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}
                  Send test email
                </button>
              </div>
            </div>

            <div className="card space-y-3">
              <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                <AlertTriangle size={18} className="text-whatsapp-teal" />
                <p className="font-semibold text-gray-800">Recent alerts</p>
              </div>
              {alertRecent.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">No alerts sent yet — nothing has broken.</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {alertRecent.map((a, i) => (
                    <div key={i} className="py-2.5 flex items-start gap-3">
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-red-50 text-red-600 flex-shrink-0 mt-0.5">
                        {a.alert_type}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-gray-700 break-words">{a.detail || `Meta error ${a.error_code ?? ''}`}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{new Date(a.sent_at).toLocaleString('en-IN')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeSection === 'auth' && (<>
          <h2 className="text-lg font-bold text-gray-900">Auth &amp; WhatsApp</h2>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">

            {/* ── LEFT: Meta connect + webhook URL ── */}
            <div className="space-y-4">

              {/* Meta Facebook Connect */}
              <div className="card space-y-4">
                <div className="flex items-center gap-3 border-b border-gray-100 pb-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
                    <Facebook size={18} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">Connect via Facebook</h3>
                      {BSP_READY
                        ? <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1"><Zap size={10} />BSP</span>
                        : <span className="text-[10px] font-bold bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Pending BSP</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {BSP_READY ? 'One-click — user sets up business & WhatsApp inside Meta popup' : 'Full auto-setup will be enabled once BSP access is approved'}
                    </p>
                  </div>
                </div>

                {!APP_ID && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-700">
                    <p className="font-semibold">Set <code className="bg-yellow-100 px-1 rounded">NEXT_PUBLIC_FACEBOOK_APP_ID</code> in your .env to enable this.</p>
                  </div>
                )}
                {!BSP_READY && APP_ID && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 space-y-1">
                    <p className="font-semibold">Once BSP access is approved:</p>
                    <p>1. Go to Meta App Dashboard → WhatsApp → Embedded Signup → Create a Configuration</p>
                    <p>2. Set <code className="bg-blue-100 px-1 rounded">NEXT_PUBLIC_FACEBOOK_CONFIG_ID</code> = Configuration ID in your .env</p>
                    <p>3. Restart the server — full one-click setup will be ready</p>
                  </div>
                )}

                {isConnected ? (
                  <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-3">
                      <CheckCircle size={18} className="text-green-600" />
                      <div>
                        <p className="text-sm font-semibold text-green-800">WhatsApp Business Connected</p>
                        <p className="text-xs text-gray-500 font-mono mt-0.5">WABA: {form.waba_id} · Phone ID: {form.phone_number_id}</p>
                      </div>
                    </div>
                    {APP_ID && (
                      <button onClick={loginWithFacebook} disabled={!fbLoaded || fbLoading || connecting}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50 flex items-center gap-1">
                        {(fbLoading || connecting) && <Loader2 size={12} className="animate-spin" />}
                        Reconnect
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                  {BSP_READY && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setCoexistMode(false)}
                        className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${!coexistMode ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <p className={`text-xs font-semibold ${!coexistMode ? 'text-blue-700' : 'text-gray-700'}`}>New number</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">Create a fresh Cloud API number</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setCoexistMode(true)}
                        className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${coexistMode ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <p className={`text-xs font-semibold flex items-center gap-1 ${coexistMode ? 'text-blue-700' : 'text-gray-700'}`}>Existing app number <span className="text-[9px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">Coexistence</span></p>
                        <p className="text-[10px] text-gray-400 mt-0.5">Connect your WhatsApp Business App number</p>
                      </button>
                    </div>
                  )}
                  {BSP_READY && coexistMode && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-[11px] text-amber-700 space-y-0.5">
                      <p>• Business App v2.24.17+ chahiye, aur number 7+ din se app par active ho.</p>
                      <p>• Popup mein QR scan karke chat history sync hogi — app access bani rahegi.</p>
                    </div>
                  )}
                  <button onClick={loginWithFacebook} disabled={!APP_ID || !fbLoaded || fbLoading || connecting}
                    className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50">
                    {(fbLoading || connecting)
                      ? <><Loader2 size={18} className="animate-spin" /> Connecting...</>
                      : <><Facebook size={18} /> {BSP_READY ? 'Setup WhatsApp Business' : 'Connect via Facebook'}</>}
                  </button>
                  </>
                )}

                <div className="text-xs text-gray-400 space-y-1">
                  {BSP_READY ? (<>
                    <p>✓ User creates or selects their business inside the Meta popup</p>
                    <p>✓ Adds or selects a WhatsApp number — everything auto-detected</p>
                    <p>✓ Webhook subscribed & templates imported automatically</p>
                  </>) : (<>
                    <p>✓ Login with Facebook → enter your WABA ID → phone numbers auto-detected</p>
                    <p>✓ Webhook subscribed & templates imported automatically</p>
                  </>)}
                </div>
              </div>

              {/* Meta Webhook URL */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
                <p className="font-semibold text-blue-800 text-sm">Your Webhook URL — Add this in Meta App Dashboard</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white border border-blue-200 rounded-lg px-3 py-2 text-sm font-mono text-blue-900 break-all">{webhookUrl}</code>
                  <button onClick={() => copyToClipboard(webhookUrl)} className="text-blue-600 hover:text-blue-800 p-2 flex-shrink-0">
                    <Copy size={16} />
                  </button>
                </div>
                <p className="text-xs text-blue-600">Meta App Dashboard → WhatsApp → Configuration → Webhook URL &amp; Verify Token</p>
              </div>

            </div>

            {/* ── RIGHT: Manual credentials form ── */}
            <div className="space-y-4">

              {credSource === 'env' && (
                <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-4 flex items-start gap-3">
                  <AlertTriangle size={18} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-yellow-800">Credentials loaded from .env file</p>
                    <p className="text-yellow-700 mt-0.5">
                      Credentials are in <code className="bg-yellow-100 px-1 rounded">.env.local</code> but not saved to DB.
                      Click <strong>Save Settings</strong> below.
                    </p>
                  </div>
                </div>
              )}

              <form onSubmit={save} className="card space-y-5">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <h3 className="font-semibold text-gray-900">WhatsApp API Credentials <span className="text-xs font-normal text-gray-400">(manual)</span></h3>
                  {isConfigured && (
                    <button type="button" onClick={testConnection} disabled={testing}
                      className="text-sm text-whatsapp-teal hover:text-whatsapp-dark font-medium flex items-center gap-1.5 disabled:opacity-50">
                      {testing ? '⏳ Testing...' : '🔌 Test Connection'}
                    </button>
                  )}
                </div>
                <div>
                  <label className="form-label">Business Name</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" placeholder="Acme Corp" />
                </div>
                <div>
                  <label className="form-label">Phone Number ID *</label>
                  <input value={form.phone_number_id} onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })}
                    className="input font-mono" placeholder="930245630177351" required />
                </div>
                <div>
                  <label className="form-label">WABA ID *</label>
                  <input value={form.waba_id} onChange={(e) => setForm({ ...form, waba_id: e.target.value })}
                    className="input font-mono" placeholder="1736454720919400" required />
                </div>
                <div>
                  <label className="form-label">Permanent Access Token *</label>
                  <div className="relative">
                    <input type={showToken ? 'text' : 'password'} value={form.access_token}
                      onChange={(e) => setForm({ ...form, access_token: e.target.value })}
                      className="input pr-10 font-mono text-xs" placeholder="EAAxxxxx..." required />
                    <button type="button" onClick={() => setShowToken((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="form-label">Verify Token <span className="font-normal text-gray-400 text-xs">(copy to Meta webhook setup)</span></label>
                  <div className="flex gap-2">
                    <input value={form.verify_token} readOnly className="input font-mono bg-gray-50 flex-1" />
                    <button type="button" onClick={() => copyToClipboard(form.verify_token)} className="btn-secondary px-3 flex-shrink-0"><Copy size={16} /></button>
                  </div>
                </div>
                <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 w-full justify-center">
                  <Save size={16} />{saving ? 'Saving...' : 'Save Settings'}
                </button>
              </form>

            </div>
          </div>
        </>)}

        {/* ─── DEVELOPER SECTION ─── */}
        {activeSection === 'developer' && (<>
          <h2 className="text-lg font-bold text-gray-900">Webhooks &amp; API</h2>

          {/* Custom Chatbot Webhooks */}
          <div className="card space-y-5">
            <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
              <Webhook size={18} className="text-whatsapp-teal" />
              <div>
                <h3 className="font-semibold text-gray-900">Custom Chatbot Webhooks</h3>
                <p className="text-xs text-gray-400 mt-0.5">Every inbound message is forwarded to all active webhooks in parallel.</p>
              </div>
            </div>

            {/* Dynamic payload preview */}
            {(() => {
              const wsId = workspaceId ?? 1;
              const payloadTabs = [
                { key: 'text',     label: 'Text',     icon: <MessageSquare size={11} /> },
                { key: 'image',    label: 'Image',    icon: <Image size={11} /> },
                { key: 'audio',    label: 'Audio',    icon: <Music size={11} /> },
                { key: 'document', label: 'Document', icon: <FileText size={11} /> },
                { key: 'location', label: 'Location', icon: <MapPin size={11} /> },
                { key: 'button',   label: 'Button',   icon: <MousePointerClick size={11} /> },
              ] as const;
              const contentMap: Record<string, string> = {
                text:     `"Hello! I need help."`,
                image:    `"{\\"__type\\":\\"media\\",\\"media_id\\":\\"abc123\\",\\"mime_type\\":\\"image/jpeg\\",\\"caption\\":\\"Check this\\"}"`,
                audio:    `"{\\"__type\\":\\"media\\",\\"media_id\\":\\"def456\\",\\"mime_type\\":\\"audio/ogg\\"}"`,
                document: `"{\\"__type\\":\\"media\\",\\"media_id\\":\\"ghi789\\",\\"mime_type\\":\\"application/pdf\\",\\"filename\\":\\"invoice.pdf\\"}"`,
                location: `"{\\"__type\\":\\"location\\",\\"latitude\\":28.6139,\\"longitude\\":77.2090,\\"name\\":\\"New Delhi\\"}"`,
                button:   `"Confirm Order"`,
              };
              const buttonExtra = payloadTab === 'button'
                ? `,\n    "button_text": "Confirm Order",\n    "button_payload": "confirm_order",\n    "replied_to_wamid": "wamid.ABCxyz...",\n    "replied_template": {\n      "template_name": "order_update",\n      "header_type": "TEXT",\n      "header_content": "Order Ready",\n      "body": "Your order #1234 is ready!",\n      "footer": "Regards, Team",\n      "buttons": [{ "type": "QUICK_REPLY", "text": "Confirm Order" }]\n    }`
                : ``;
              // Media messages also carry top-level media fields + a ready
              // download link (media_url) — mirror the real forwarded payload
              const origin  = typeof window !== 'undefined' ? window.location.origin : '';
              const keyPart = apiKey || 'ws_xxxxxxxxxxxx';
              const mediaUrl = (id: string) => `${origin}/api/media/${id}?workspaceId=${wsId}&key=${keyPart}`;
              const mediaExtraMap: Record<string, string> = {
                image:    `\n    "media_id": "abc123",\n    "mime_type": "image/jpeg",\n    "caption": "Check this",\n    "media_url": "${mediaUrl('abc123')}",`,
                audio:    `\n    "media_id": "def456",\n    "mime_type": "audio/ogg",\n    "media_url": "${mediaUrl('def456')}",`,
                document: `\n    "media_id": "ghi789",\n    "mime_type": "application/pdf",\n    "filename": "invoice.pdf",\n    "media_url": "${mediaUrl('ghi789')}",`,
              };
              const mediaExtra = mediaExtraMap[payloadTab] || '';
              const payload = `{\n  "event": "message.received",\n  "workspace_id": ${wsId},\n  "contact": { "id": 42, "phone": "916386103750", "name": "Sachidanand Kushwahah" },\n  "message": {\n    "wamid": "wamid.HBgMOTE5...",\n    "type": "${payloadTab}",\n    "content": ${contentMap[payloadTab]},${mediaExtra}\n    "timestamp": "${Math.floor(Date.now() / 1000)}",\n    "replied_to_wamid": null${buttonExtra}\n  }\n}`;
              return (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-gray-700">Payload your server will receive:</p>
                    <button onClick={() => copyToClipboard(payload)}
                      className="flex items-center gap-1 text-gray-400 hover:text-whatsapp-teal transition-colors px-2 py-1 rounded-lg hover:bg-white" title="Copy payload">
                      <Copy size={12} /> Copy
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {payloadTabs.map((t) => (
                      <button key={t.key} onClick={() => setPayloadTab(t.key)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                          payloadTab === t.key ? 'bg-whatsapp-green text-white' : 'bg-white border border-gray-200 text-gray-500 hover:border-whatsapp-green hover:text-whatsapp-teal'
                        }`}>
                        {t.icon}{t.label}
                      </button>
                    ))}
                  </div>
                  <pre className="bg-gray-900 text-green-400 rounded p-2 overflow-x-auto leading-relaxed text-[11px]">{payload}</pre>
                  {mediaExtra && (
                    <p className="text-gray-500">
                      <code className="bg-gray-200 px-1 rounded">media_url</code> is a ready download link (your API key is included) —
                      GET it to receive the file. Meta keeps media ~30 days, so save the file on your server if you need it permanently.
                    </p>
                  )}
                  <p className="text-gray-500">
                    Reply: <code className="bg-gray-200 px-1 rounded">POST /api/send-message</code>
                    {' · '}Signature: <code className="bg-gray-200 px-1 rounded">X-Webhook-Signature: sha256=...</code>
                  </p>
                </div>
              );
            })()}

            {hooks.length > 0 && (
              <div className="space-y-2">
                {hooks.map((hook) => (
                  <div key={hook.id}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${hook.is_active ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{hook.name}</p>
                      <p className="text-xs text-gray-400 truncate font-mono">{hook.url}</p>
                      {hook.secret && <p className="text-xs text-gray-300 mt-0.5">🔒 Secret configured</p>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => testHook(hook)} disabled={testingId === hook.id} title="Send test"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-whatsapp-teal hover:bg-green-50 transition-colors disabled:opacity-40">
                        <RefreshCw size={15} className={testingId === hook.id ? 'animate-spin' : ''} />
                      </button>
                      <button onClick={() => toggleHook(hook)} title={hook.is_active ? 'Disable' : 'Enable'}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-whatsapp-teal hover:bg-green-50 transition-colors">
                        {hook.is_active ? <ToggleRight size={18} className="text-whatsapp-green" /> : <ToggleLeft size={18} />}
                      </button>
                      <button onClick={() => deleteHook(hook.id)} title="Delete"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {hooks.length === 0 && <p className="text-center text-gray-400 text-sm py-2">No webhooks added yet</p>}

            <form onSubmit={addWebhook} className="border border-dashed border-gray-300 rounded-lg p-4 space-y-3 bg-gray-50">
              <p className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><Plus size={15} /> Add New Webhook</p>
              <div className="grid grid-cols-2 gap-3">
                <input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  className="input text-sm" placeholder="Name (e.g. My Bot)" required />
                <div className="relative">
                  <input type={showAddSecret ? 'text' : 'password'} value={addForm.secret}
                    onChange={(e) => setAddForm({ ...addForm, secret: e.target.value })}
                    className="input text-sm pr-9 font-mono" placeholder="Secret (optional)" />
                  <button type="button" onClick={() => setShowAddSecret((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
                    {showAddSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <input value={addForm.url} onChange={(e) => setAddForm({ ...addForm, url: e.target.value })}
                className="input text-sm font-mono" placeholder="https://your-server.com/webhook" required />
              <button type="submit" disabled={adding} className="btn-primary text-sm flex items-center gap-2">
                <Plus size={15} />{adding ? 'Adding...' : 'Add Webhook'}
              </button>
            </form>
          </div>

          {/* Workspace API Key */}
          <div className="card space-y-4">
            <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
              <Key size={18} className="text-purple-500" />
              <div>
                <h3 className="font-semibold text-gray-900">Workspace API Key</h3>
                <p className="text-xs text-gray-400 mt-0.5">Permanent key — use in campaigns (PHP/n8n/Make), never expires</p>
              </div>
            </div>

            {apiKey ? (<>
              <div>
                <label className="form-label">API Key <span className="text-green-600 font-semibold text-xs ml-1">● Permanent — never expires</span></label>
                <div className="flex gap-2 mt-1">
                  <input type={showApiKey ? 'text' : 'password'} value={apiKey} readOnly className="input font-mono text-xs flex-1 bg-gray-50" />
                  <button onClick={() => setShowApiKey((s) => !s)} className="btn-secondary px-3 flex-shrink-0">
                    {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <button onClick={() => { copyToClipboard(apiKey); toast.success('API Key copied!'); }} className="btn-primary px-3 flex-shrink-0 text-sm flex items-center gap-1">
                    <Copy size={14} /> Copy
                  </button>
                  <button onClick={regenApiKey} disabled={regenLoading}
                    className="btn-secondary px-3 flex-shrink-0 text-red-500 hover:bg-red-50" title="Regenerate">
                    <RotateCcw size={15} className={regenLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              {/* Campaign usage */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs space-y-1.5">
                <p className="font-semibold text-blue-800">Campaign API usage (PHP / Python / cURL):</p>
                <pre className="bg-gray-900 text-green-400 rounded p-2 overflow-x-auto leading-relaxed whitespace-pre-wrap">{`POST ${typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'}/api/campaigns/send

{
  "apiKey": "${showApiKey ? apiKey : '•'.repeat(24)}",
  "campaignName": "your_campaign_name",
  "destination": "919876543210",
  "templateParams": ["John", "ORD-123"]
}`}</pre>
              </div>

              {/* External chatbot usage */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600 space-y-2">
                <p className="font-semibold text-gray-700">Direct message (n8n / Make / custom bot):</p>
                <pre className="bg-gray-900 text-green-400 rounded p-2 overflow-x-auto leading-relaxed whitespace-pre-wrap">{`POST ${typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'}/api/external/send
Headers:
  X-API-Key: ${showApiKey ? apiKey : '•'.repeat(24)}

Body: { "phone": "919876543210", "message": "Hello!" }`}</pre>
              </div>

              {/* Contact lookup */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600 space-y-2">
                <p className="font-semibold text-gray-700">Get contact + full chat history:</p>
                <pre className="bg-gray-900 text-green-400 rounded p-2 overflow-x-auto leading-relaxed whitespace-pre-wrap">{`GET ${typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'}/api/external/contact?phone=919876543210
Headers:
  X-API-Key: ${showApiKey ? apiKey : '•'.repeat(24)}

Response:
{
  "contact": { "id": 42, "phone": "919876543210", "name": "Rahul", ... },
  "messages": [ { "direction": "inbound", "content": "Hi!", ... }, ... ],
  "total_messages": 24
}`}</pre>
              </div>

              {/* Call recordings for CRM */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600 space-y-2">
                <p className="font-semibold text-gray-700">Get call recordings by phone (CRM):</p>
                <pre className="bg-gray-900 text-green-400 rounded p-2 overflow-x-auto leading-relaxed whitespace-pre-wrap">{`GET ${typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'}/api/external/call-recordings?phone=919876543210
Headers:
  X-API-Key: ${showApiKey ? apiKey : '•'.repeat(24)}

Response:
{
  "phone": "919876543210", "contact_name": "Rahul", "total": 2,
  "calls": [ { "call_id": "wacid...", "direction": "inbound",
    "status": "completed", "agent": "Priya",
    "started_at": "2026-08-21 14:03:11", "duration_sec": 184,
    "recording": { "url": "https://s3...", "seconds": 180 } } ]
}

Optional: &only_recorded=0 (include calls without recording),
&limit=50, &expires_in=3600 (recording link lifetime, sec).
Recording URLs expire — fetch fresh ones on each CRM view.`}</pre>
              </div>
            </>) : (
              <div className="flex flex-col items-center gap-3 py-4">
                <p className="text-sm text-gray-400 text-center">No API key yet.</p>
                <button
                  onClick={async () => {
                    setRegenLoading(true);
                    try {
                      const r = await apiFetch('/api/workspace/api-key', { method: 'POST' });
                      setApiKey(r.data?.api_key || '');
                      toast.success('API key generated!');
                    } catch { toast.error('Failed to generate'); }
                    finally { setRegenLoading(false); }
                  }}
                  disabled={regenLoading} className="btn-primary flex items-center gap-2 text-sm">
                  {regenLoading ? <><Loader2 size={14} className="animate-spin" /> Generating...</> : <><Key size={14} /> Generate API Key</>}
                </button>
              </div>
            )}
          </div>
        </>)}

        {/* ─── CAMPAIGNS SECTION ─── */}
        {activeSection === 'campaigns' && (<>
          <h2 className="text-lg font-bold text-gray-900">Campaign Settings</h2>

          <div className="card space-y-4">
            <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
              <PauseCircle size={18} className="text-whatsapp-teal" />
              <h3 className="font-semibold text-gray-900">Auto-Pause Settings</h3>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-800">
                  Auto-Pause Campaigns on Template Category Change from Utility to Marketing
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Disable this to keep campaigns running even when Meta changes their template category from Utility to Marketing.
                </p>
              </div>
              <button onClick={toggleAutoPause} disabled={savingPause}
                className="flex-shrink-0 mt-0.5 disabled:opacity-50 transition-opacity"
                title={autoPauseCampaigns ? 'Click to disable' : 'Click to enable'}>
                {autoPauseCampaigns
                  ? <ToggleRight size={36} className="text-whatsapp-teal" />
                  : <ToggleLeft  size={36} className="text-gray-300" />}
              </button>
            </div>
          </div>
        </>)}

        {/* ─── CALLING SECTION ─── */}
        {activeSection === 'calling' && (<>
          <h2 className="text-lg font-bold text-gray-900">WhatsApp Calling</h2>

          {callingLoading && !callingInfo && (
            <div className="card flex items-center gap-2 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin" /> Checking calling status with Meta…
            </div>
          )}

          {callingInfo && !callingInfo.configured && (
            <div className="card text-sm text-gray-600">
              Connect your WhatsApp number first (Auth &amp; WhatsApp) to manage calling.
            </div>
          )}

          {callingInfo?.configured && (() => {
            const enabled  = callingInfo.calling?.status === 'ENABLED';
            const tier     = callingInfo.phone?.messaging_limit_tier || '—';
            const tierOk   = !!callingInfo.tier_ok;
            const iconVis  = callingInfo.calling?.call_icon_visibility || 'DEFAULT';
            return (<>
              {/* Status + enable */}
              <div className="card space-y-4">
                <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                  <PhoneCall size={18} className="text-whatsapp-teal" />
                  <div>
                    <h3 className="font-semibold text-gray-900">Business Calling API</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Let customers call your WhatsApp number — calls show up in the Inbox as call events.
                    </p>
                  </div>
                  <button onClick={loadCalling} disabled={callingLoading} title="Refresh from Meta"
                    className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50">
                    <RefreshCw size={14} className={callingLoading ? 'animate-spin' : ''} />
                  </button>
                </div>

                {callingInfo.meta_error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
                    Meta error: {callingInfo.meta_error}
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-gray-400">Number</p>
                    <p className="font-semibold text-gray-800 mt-0.5">{callingInfo.phone?.display_phone_number || '—'}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-gray-400">Calling</p>
                    <p className={`font-semibold mt-0.5 ${enabled ? 'text-green-600' : 'text-gray-500'}`}>
                      {enabled ? 'Enabled' : 'Disabled'}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-gray-400">Messaging tier</p>
                    <p className={`font-semibold mt-0.5 ${tierOk ? 'text-green-600' : 'text-amber-600'}`}>
                      {tier.replace('TIER_', '')}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-gray-400">Quality</p>
                    <p className="font-semibold text-gray-800 mt-0.5">{callingInfo.phone?.quality_rating || '—'}</p>
                  </div>
                </div>

                {!tierOk && !enabled && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
                    Meta requires a messaging limit of <b>2,000+ / day</b> to enable calling. Your number is on tier <b>{tier.replace('TIER_', '')}</b> —
                    the tier grows automatically as you send more quality messages. You can still try enabling; Meta will reject if not eligible.
                  </div>
                )}

                <div className="flex items-start justify-between gap-4 pt-1">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">Enable calling on this number</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Shows a call button on your WhatsApp profile and chat. Agents answer and place calls right
                      from the Inbox (browser mic needed). Meta may take a few minutes to reflect changes.
                    </p>
                  </div>
                  <button onClick={toggleCalling} disabled={callingSaving}
                    className="flex-shrink-0 mt-0.5 disabled:opacity-50 transition-opacity"
                    title={enabled ? 'Click to disable' : 'Click to enable'}>
                    {enabled
                      ? <ToggleRight size={36} className="text-whatsapp-teal" />
                      : <ToggleLeft  size={36} className="text-gray-300" />}
                  </button>
                </div>

                {enabled && (
                  <div className="flex items-start justify-between gap-4 pt-1 border-t border-gray-100">
                    <div className="flex-1 pt-3">
                      <p className="text-sm font-medium text-gray-800">Show call button to customers</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Hide the button to stop new customer-initiated calls without fully disabling calling.
                      </p>
                    </div>
                    <button onClick={() => setCallIconVisibility(iconVis === 'DEFAULT' ? 'DISABLE_ALL' : 'DEFAULT')}
                      disabled={callingSaving} className="flex-shrink-0 mt-3 disabled:opacity-50">
                      {iconVis === 'DEFAULT'
                        ? <ToggleRight size={36} className="text-whatsapp-teal" />
                        : <ToggleLeft  size={36} className="text-gray-300" />}
                    </button>
                  </div>
                )}
              </div>

              {/* Calling hours (calling time) */}
              {(() => {
                const hoursOn = callHours.status === 'ENABLED';
                const openNow = callHoursOpenNow(callHours);
                return (
                  <div className="card space-y-3">
                    <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                      <Clock size={18} className="text-whatsapp-teal" />
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">Calling hours</h3>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Set the time window when customers can call you. Outside these hours WhatsApp blocks the
                          call and tells the customer you're closed. Turn on "Show on profile" below so customers
                          see the hours on your WhatsApp profile <b>before</b> they try to call.
                        </p>
                      </div>
                      {hoursOn && openNow !== null && (
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                          openNow ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {openNow ? '● Open now' : '● Closed now'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800">Restrict calls to business hours</p>
                        <p className="text-xs text-gray-400 mt-1">
                          Off = customers can call 24×7. On = only during the schedule below.
                        </p>
                      </div>
                      <button onClick={toggleCallHours} disabled={callingSaving || !enabled}
                        title={!enabled ? 'Enable calling first' : hoursOn ? 'Click to allow calls any time' : 'Click to restrict to business hours'}
                        className="flex-shrink-0 mt-0.5 disabled:opacity-50 transition-opacity">
                        {hoursOn
                          ? <ToggleRight size={36} className="text-whatsapp-teal" />
                          : <ToggleLeft  size={36} className="text-gray-300" />}
                      </button>
                    </div>

                    <div className={`space-y-3 pt-3 border-t border-gray-100 ${hoursOn ? '' : 'opacity-60'}`}>
                      {/* Timezone */}
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-700 flex-1">Timezone</label>
                        <select value={callHours.timezone_id}
                          onChange={(e) => updateCallHours({ timezone_id: e.target.value })}
                          className="input w-64 text-sm">
                          {!TIMEZONES.includes(callHours.timezone_id) && <option value={callHours.timezone_id}>{callHours.timezone_id}</option>}
                          {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>

                      {/* Weekly schedule */}
                      <div className="space-y-1.5">
                        {CALL_DAYS.map((day) => {
                          const slots = callHours.weekly_operating_hours.filter((s) => s.day_of_week === day);
                          const active = slots.length > 0;
                          return (
                            <div key={day} className="flex items-start gap-3 py-1.5 border-b border-gray-50 last:border-0">
                              <label className="flex items-center gap-2 w-28 flex-shrink-0 pt-1.5 cursor-pointer select-none">
                                <input type="checkbox" checked={active}
                                  onChange={(e) => setDaySlots(day, e.target.checked ? [{ open_time: '0900', close_time: '1800' }] : [])}
                                  className="accent-whatsapp-teal" />
                                <span className={`text-sm ${active ? 'text-gray-800 font-medium' : 'text-gray-400'}`}>
                                  {day.charAt(0) + day.slice(1).toLowerCase()}
                                </span>
                              </label>
                              <div className="flex-1 min-w-0">
                                {!active && <p className="text-xs text-gray-400 pt-2">Closed</p>}
                                {slots.map((s, i) => (
                                  <div key={i} className="flex items-center gap-2 mb-1.5 flex-wrap">
                                    <input type="time" value={hhmmToInput(s.open_time)}
                                      onChange={(e) => { const n = [...slots]; n[i] = { ...s, open_time: inputToHhmm(e.target.value) }; setDaySlots(day, n); }}
                                      className="input w-32 text-sm py-1" />
                                    <span className="text-xs text-gray-400">to</span>
                                    <input type="time" value={hhmmToInput(s.close_time)}
                                      onChange={(e) => { const n = [...slots]; n[i] = { ...s, close_time: inputToHhmm(e.target.value) }; setDaySlots(day, n); }}
                                      className="input w-32 text-sm py-1" />
                                    <span className="text-[11px] text-gray-400 hidden sm:inline">
                                      {fmtHHMM(s.open_time)} – {fmtHHMM(s.close_time)}
                                    </span>
                                    {slots.length > 1 && (
                                      <button type="button" onClick={() => setDaySlots(day, slots.filter((_, j) => j !== i))}
                                        className="p-1 text-gray-400 hover:text-red-500" title="Remove slot"><X size={13} /></button>
                                    )}
                                  </div>
                                ))}
                                {active && (
                                  <div className="flex items-center gap-3">
                                    {slots.length < 2 && (
                                      <button type="button"
                                        onClick={() => setDaySlots(day, [...slots, { open_time: '1900', close_time: '2100' }])}
                                        className="text-[11px] text-whatsapp-teal hover:underline flex items-center gap-0.5">
                                        <Plus size={11} /> Add a break / second slot
                                      </button>
                                    )}
                                    <button type="button" onClick={() => copyDayToAll(day)}
                                      className="text-[11px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5">
                                      <Copy size={11} /> Copy to all active days
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Holidays */}
                      <div className="pt-2 border-t border-gray-100">
                        <p className="text-sm font-medium text-gray-800">Holidays (closed all day)</p>
                        <p className="text-xs text-gray-400 mt-0.5 mb-2">Calls are blocked on these dates even if the weekday is normally open.</p>
                        {callHours.holiday_schedule.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {callHours.holiday_schedule.map((h) => (
                              <span key={h.date} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded-lg">
                                {new Date(h.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                {(h.start_time !== '0000' || h.end_time !== '2359') && (
                                  <span className="text-gray-400">({fmtHHMM(h.start_time)}–{fmtHHMM(h.end_time)})</span>
                                )}
                                <button type="button" title="Remove"
                                  onClick={() => updateCallHours({ holiday_schedule: callHours.holiday_schedule.filter((x) => x.date !== h.date) })}
                                  className="text-gray-400 hover:text-red-500"><X size={12} /></button>
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <input type="date" value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)}
                            className="input w-44 text-sm py-1" />
                          <button type="button" disabled={!newHoliday}
                            onClick={() => {
                              if (callHours.holiday_schedule.some((h) => h.date === newHoliday)) { toast.error('Already added'); return; }
                              updateCallHours({ holiday_schedule: [...callHours.holiday_schedule, { date: newHoliday, start_time: '0000', end_time: '2359' }].sort((a, b) => a.date.localeCompare(b.date)) });
                              setNewHoliday('');
                            }}
                            className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
                            <Plus size={13} /> Add holiday
                          </button>
                        </div>
                      </div>

                      {/* Show hours to customers on the WhatsApp profile */}
                      {(() => {
                        const preview = callHoursProfileLine({ ...callHours, status: 'ENABLED' });
                        return (
                          <div className="pt-2 border-t border-gray-100">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-800">Show calling hours on your WhatsApp profile</p>
                                <p className="text-xs text-gray-400 mt-1">
                                  Adds a line to your Business Profile description so customers know when they can call —
                                  <b> before</b> they tap the call button. Kept in sync automatically whenever you change the hours.
                                </p>
                              </div>
                              <button onClick={toggleHoursOnProfile} disabled={callingSaving || !enabled || !hoursOn}
                                title={!hoursOn ? 'Turn on calling hours first' : hoursOnProfile ? 'Remove from profile' : 'Show on profile'}
                                className="flex-shrink-0 mt-0.5 disabled:opacity-50 transition-opacity">
                                {hoursOnProfile && hoursOn
                                  ? <ToggleRight size={36} className="text-whatsapp-teal" />
                                  : <ToggleLeft  size={36} className="text-gray-300" />}
                              </button>
                            </div>
                            <div className="mt-2 bg-[#e7fbe6] border border-green-100 rounded-xl px-3 py-2 text-xs text-gray-800 leading-relaxed">
                              <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Customers will see</p>
                              {preview || <span className="text-gray-400">Add at least one day with hours to preview</span>}
                            </div>
                            {hoursOnProfile && hoursOn && callingInfo.profile_hours_line && callingInfo.profile_hours_line !== preview && (
                              <p className="text-[11px] text-amber-600 mt-1">Profile currently shows an older schedule — click <b>Save hours</b> to update it.</p>
                            )}
                          </div>
                        );
                      })()}

                      {/* Save */}
                      <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
                        <p className="text-[11px] text-gray-400">
                          {callHoursDirty ? 'Unsaved changes — click Save to push to WhatsApp.' : 'Saved on WhatsApp. Changes may take a few minutes to reflect for customers.'}
                        </p>
                        <button onClick={() => saveCallHours()} disabled={callingSaving || !enabled}
                          className="btn-primary flex items-center gap-1.5 text-sm">
                          {callingSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save hours
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Call recording */}
              <div className="card space-y-3">
                <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                  <Zap size={18} className="text-red-500" />
                  <div>
                    <h3 className="font-semibold text-gray-900">Call recording</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Record both sides of calls answered or placed from the Inbox. Files are stored privately in S3
                      and playable from the Calls page. Agents see a red REC badge during recorded calls.
                    </p>
                  </div>
                </div>
                {!callingInfo.recording_storage_ready && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
                    Storage not configured — set <code className="bg-amber-100 px-1 rounded">S3_BUCKET</code>, <code className="bg-amber-100 px-1 rounded">S3_REGION</code>
                    (and access keys) in the server env, then restart. Recording can be turned on after that.
                  </div>
                )}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">Record calls</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Make sure your customers are informed that calls may be recorded (add it to your business
                      profile / greeting) — recording laws vary by region.
                    </p>
                  </div>
                  <button onClick={toggleRecordCalls} disabled={callingSaving || !callingInfo.recording_storage_ready}
                    className="flex-shrink-0 mt-0.5 disabled:opacity-50 transition-opacity">
                    {callingInfo.record_calls
                      ? <ToggleRight size={36} className="text-red-500" />
                      : <ToggleLeft  size={36} className="text-gray-300" />}
                  </button>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                  <p className="text-sm text-gray-700 flex-1">Keep recordings for</p>
                  <input type="number" min={0} max={3650} value={retentionDays}
                    onChange={(e) => setRetentionDays(Number(e.target.value))}
                    className="input w-24 text-center" />
                  <span className="text-xs text-gray-500">days (0 = forever)</span>
                  <button onClick={saveRetention} disabled={callingSaving} className="btn-secondary text-sm">Save</button>
                </div>
              </div>

              {/* Missed-call auto reply */}
              <div className="card space-y-3">
                <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                  <MessageSquare size={18} className="text-whatsapp-teal" />
                  <div>
                    <h3 className="font-semibold text-gray-900">Missed-call auto reply</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      When a customer's call is missed, send this approved template automatically so your agent
                      can follow up — even if the 24h chat window is closed. Max one per contact per hour.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 items-center">
                  <select value={missedTpl} onChange={(e) => setMissedTpl(e.target.value)} className="input flex-1">
                    <option value="">Off — don't send anything</option>
                    {approvedTemplates.map((t) => (
                      <option key={`${t.name}:${t.language}`} value={t.name}>{t.name} ({t.language})</option>
                    ))}
                  </select>
                  <button onClick={saveMissedCallTemplate} disabled={callingSaving}
                    className="btn-primary flex items-center gap-1.5 text-sm">
                    {callingSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                  </button>
                </div>
                <p className="text-[11px] text-gray-400">
                  Tip: use a template without body variables (e.g. "We missed your call — reply here and our team will get back to you").
                </p>
              </div>

              {/* Device push notifications (mobile) */}
              <div className="card space-y-3">
                <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                  <Bell size={18} className="text-whatsapp-teal" />
                  <div>
                    <h3 className="font-semibold text-gray-900">Call alerts on this device</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Get a system notification when a customer calls — works even if this tab is in the background
                      or closed (mobile browsers included). Tap the notification to open the panel and answer.
                    </p>
                  </div>
                </div>
                {pushPerm === 'unsupported' ? (
                  <p className="text-xs text-amber-600">This browser doesn't support push notifications.</p>
                ) : pushPerm === 'denied' ? (
                  <p className="text-xs text-amber-600">
                    Notifications are blocked for this site — enable them from the browser's site settings (lock icon in the address bar), then retry.
                  </p>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs text-gray-500 flex-1">
                      {pushPerm === 'granted'
                        ? 'Enabled on this device. Each agent enables it once per device/browser they use.'
                        : 'Enable once per device — every agent does this on the phone/browser they answer calls from.'}
                    </p>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {pushPerm === 'granted' && (
                        <button onClick={sendTestPush} disabled={pushBusy} className="btn-secondary text-sm">
                          Send test
                        </button>
                      )}
                      <button onClick={enableDevicePush} disabled={pushBusy}
                        className="btn-primary flex items-center gap-1.5 text-sm">
                        {pushBusy ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}
                        {pushPerm === 'granted' ? 'Re-sync this device' : 'Enable on this device'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>);
          })()}
        </>)}

        {/* ─── CRM SECTION ─── */}
        {activeSection === 'crm' && (<>
          <h2 className="text-lg font-bold text-gray-900">CRM Integration</h2>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">

            {/* Add new form */}
            <div className="card space-y-4">
              <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                <Database size={18} className="text-whatsapp-teal" />
                <div>
                  <h3 className="font-semibold text-gray-900">{crmEditId ? 'Edit CRM Integration' : 'Add New CRM Integration'}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Automatically calls your CRM API when a template button is replied to</p>
                </div>
              </div>

              <form onSubmit={addCrm} className="space-y-3">
                <div>
                  <label className="form-label">Integration Name *</label>
                  <input value={crmForm.name}
                    onChange={(e) => setCrmForm({ ...crmForm, name: e.target.value })}
                    className="input" placeholder="e.g. Lead Assignment Action" required />
                </div>

                <div>
                  <label className="form-label">Template *</label>
                  {crmTemplates.length > 0 ? (
                    <select value={crmForm.template_name}
                      onChange={(e) => setCrmForm({ ...crmForm, template_name: e.target.value })}
                      className="input" required>
                      <option value="">-- Select a template --</option>
                      {crmTemplates.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={crmForm.template_name}
                      onChange={(e) => setCrmForm({ ...crmForm, template_name: e.target.value })}
                      className="input font-mono" placeholder="e.g. lead_assignment_action" required />
                  )}
                </div>

                <div>
                  <label className="form-label">CRM API URL *</label>
                  <div className="flex gap-2">
                    <select value={crmForm.api_method}
                      onChange={(e) => setCrmForm({ ...crmForm, api_method: e.target.value })}
                      className="input w-24 flex-shrink-0">
                      <option>POST</option>
                      <option>GET</option>
                    </select>
                    <input value={crmForm.api_url}
                      onChange={(e) => setCrmForm({ ...crmForm, api_url: e.target.value })}
                      className="input flex-1 font-mono text-xs min-w-0" placeholder="https://yourcrm.com/api/lead-action" required />
                  </div>
                </div>

                <div>
                  <button type="button" onClick={() => setShowCrmHeaders((s) => !s)}
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                    <Globe size={12} /> Custom Headers (optional) {showCrmHeaders ? '▲' : '▼'}
                  </button>
                  {showCrmHeaders && (
                    <textarea value={crmForm.api_headers}
                      onChange={(e) => setCrmForm({ ...crmForm, api_headers: e.target.value })}
                      className="input mt-2 font-mono text-xs h-20 resize-none"
                      placeholder={'{"X-API-Key": "abc", "Authorization": "Bearer token"}'} />
                  )}
                </div>

                {/* Data preview */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-hidden">
                  <p className="text-xs font-semibold text-gray-700 mb-1.5">Your CRM will receive this data:</p>
                  <pre className="bg-gray-900 text-green-400 rounded p-2 text-[10px] overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">{`{
  "event":          "template_button_reply",
  "template_name":  "${crmForm.template_name || 'lead_assignment_action'}",
  "button_text":    "Accept",
  "button_payload": "123",
  "contact":        { "id": 42, "phone": "919876543210", "name": "Sachidanand Kushwahah" },
  "workspace_id":   1
}`}</pre>
                </div>

                <div className="flex gap-2">
                  {crmEditId && (
                    <button type="button" onClick={cancelCrmEdit}
                      className="btn-secondary flex-1 text-sm">Cancel</button>
                  )}
                  <button type="submit" disabled={crmAdding}
                    className="btn-primary flex items-center gap-2 flex-1 justify-center">
                    {crmEditId
                      ? <><Save size={16} />{crmAdding ? 'Saving...' : 'Update Integration'}</>
                      : <><Plus size={16} />{crmAdding ? 'Adding...' : 'Add Integration'}</>}
                  </button>
                </div>
              </form>
            </div>

            {/* Active integrations list */}
            <div className="card space-y-3">
              <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                <Globe size={18} className="text-whatsapp-teal" />
                <div>
                  <h3 className="font-semibold text-gray-900">Active CRM Integrations</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{crmList.length} integration{crmList.length !== 1 ? 's' : ''} configured</p>
                </div>
              </div>

              {crmList.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-6">No CRM integrations configured yet</p>
              )}

              {crmList.map((item) => (
                <div key={item.id}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                    item.is_active ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'
                  }`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-800">{item.name}</p>
                      <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">{item.api_method}</span>
                      <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-mono">{item.template_name}</span>
                    </div>
                    <p className="text-xs text-gray-400 truncate font-mono mt-1">{item.api_url}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => toggleCrm(item)} title={item.is_active ? 'Disable' : 'Enable'}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-whatsapp-teal hover:bg-green-50 transition-colors">
                      {item.is_active
                        ? <ToggleRight size={20} className="text-whatsapp-green" />
                        : <ToggleLeft size={20} />}
                    </button>
                    <button onClick={() => startCrmEdit(item)} title="Edit"
                      className={`p-1.5 rounded-lg transition-colors ${
                        crmEditId === item.id
                          ? 'text-blue-600 bg-blue-50'
                          : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50'
                      }`}>
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => deleteCrm(item.id)} title="Delete"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

          </div>{/* end grid */}

          {/* ─── Failed Message Webhook ─── */}
          <h2 className="text-lg font-bold text-gray-900 mt-6">Failed Message Webhook</h2>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">

            {/* Add form */}
            <div className="card space-y-4">
              <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                <Zap size={18} className="text-red-500" />
                <div>
                  <h3 className="font-semibold text-gray-900">{fwEditId ? 'Edit Failed Message Webhook' : 'Add Failed Message Webhook'}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Fires an API call when a campaign message fails to deliver</p>
                </div>
              </div>

              <form onSubmit={addFw} className="space-y-3">
                <div>
                  <label className="form-label">Webhook Name *</label>
                  <input value={fwForm.name}
                    onChange={(e) => setFwForm({ ...fwForm, name: e.target.value })}
                    className="input" placeholder="e.g. Failed Orders Campaign" required />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="form-label">Campaigns *</label>
                    <span className="text-xs text-gray-400">{fwForm.campaign_ids.length} selected</span>
                  </div>
                  {fwCampaigns.length === 0 ? (
                    <p className="text-xs text-gray-400 mt-1">No campaigns found. Create a campaign first.</p>
                  ) : (() => {
                    const q = fwCampaignSearch.trim().toLowerCase();
                    const visible = q ? fwCampaigns.filter((c) => c.name.toLowerCase().includes(q)) : fwCampaigns;
                    const allVisibleSelected = visible.length > 0 && visible.every((c) => fwForm.campaign_ids.includes(c.id));
                    return (
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="flex items-center gap-2 p-2 border-b border-gray-100 bg-gray-50">
                          <input value={fwCampaignSearch}
                            onChange={(e) => setFwCampaignSearch(e.target.value)}
                            className="input py-1.5 text-xs flex-1 min-w-0" placeholder="Search campaigns..." />
                          <button type="button"
                            onClick={() => setFwForm((f) => ({
                              ...f,
                              campaign_ids: allVisibleSelected
                                ? f.campaign_ids.filter((id) => !visible.some((c) => c.id === id))
                                : Array.from(new Set([...f.campaign_ids, ...visible.map((c) => c.id)])),
                            }))}
                            disabled={visible.length === 0}
                            className="text-xs text-whatsapp-teal font-medium whitespace-nowrap hover:underline disabled:opacity-40">
                            {allVisibleSelected ? 'Unselect all' : 'Select all'}
                          </button>
                          {fwForm.campaign_ids.length > 0 && (
                            <button type="button" onClick={() => setFwForm((f) => ({ ...f, campaign_ids: [] }))}
                              className="text-xs text-gray-400 hover:text-red-500 whitespace-nowrap">Clear</button>
                          )}
                        </div>
                        <div className="max-h-52 overflow-y-auto divide-y divide-gray-50">
                          {visible.length === 0 && (
                            <p className="text-xs text-gray-400 text-center py-4">No campaigns match &quot;{fwCampaignSearch}&quot;</p>
                          )}
                          {visible.map((c) => {
                            const checked = fwForm.campaign_ids.includes(c.id);
                            return (
                              <label key={c.id}
                                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer text-sm transition-colors ${checked ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
                                <input type="checkbox" checked={checked} onChange={() => toggleFwCampaign(c.id)}
                                  className="w-4 h-4 accent-whatsapp-teal flex-shrink-0" />
                                <span className="truncate text-gray-700" title={c.name}>{c.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div>
                  <label className="form-label">Webhook URL *</label>
                  <div className="flex gap-2">
                    <select value={fwForm.api_method}
                      onChange={(e) => setFwForm({ ...fwForm, api_method: e.target.value })}
                      className="input w-24 flex-shrink-0">
                      <option>POST</option>
                      <option>GET</option>
                    </select>
                    <input value={fwForm.api_url}
                      onChange={(e) => setFwForm({ ...fwForm, api_url: e.target.value })}
                      className="input flex-1 font-mono text-xs min-w-0"
                      placeholder="https://yourapi.com/webhook/failed" required />
                  </div>
                </div>

                <div>
                  <button type="button" onClick={() => setShowFwHeaders((s) => !s)}
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                    <Globe size={12} /> Custom Headers (optional) {showFwHeaders ? '▲' : '▼'}
                  </button>
                  {showFwHeaders && (
                    <textarea value={fwForm.api_headers}
                      onChange={(e) => setFwForm({ ...fwForm, api_headers: e.target.value })}
                      className="input mt-2 font-mono text-xs h-20 resize-none"
                      placeholder={'{"X-API-Key": "abc", "Authorization": "Bearer token"}'} />
                  )}
                </div>

                {/* Data preview */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-hidden">
                  <p className="text-xs font-semibold text-gray-700 mb-1.5">Your API will receive this data:</p>
                  <pre className="bg-gray-900 text-green-400 rounded p-2 text-[10px] overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">{`{
  "event":         "campaign_message_failed",
  "campaign_id":   ${fwForm.campaign_ids[0] || 1},
  "campaign_name": "${fwCampaigns.find((c) => c.id === fwForm.campaign_ids[0])?.name || 'Summer Sale'}",
  "phone":         "919876543210",
  "contact_id":    42,
  "message_id":    101,
  "status":        "failed",
  "workspace_id":  1,
  "failed_at":     "2024-01-15T10:30:00.000Z"
}`}</pre>
                  {fwForm.campaign_ids.length > 1 && (
                    <p className="text-[11px] text-gray-500 mt-1.5">
                      campaign_id / campaign_name will be the campaign whose message actually failed.
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  {fwEditId && (
                    <button type="button" onClick={cancelFwEdit}
                      className="btn-secondary flex-1 text-sm">Cancel</button>
                  )}
                  <button type="submit" disabled={fwAdding}
                    className="btn-primary flex items-center gap-2 flex-1 justify-center">
                    {fwEditId
                      ? <><Save size={16} />{fwAdding ? 'Saving...' : 'Update Webhook'}</>
                      : <><Plus size={16} />{fwAdding ? 'Adding...' : 'Add Webhook'}</>}
                  </button>
                </div>
              </form>
            </div>

            {/* Active webhooks list */}
            <div className="card space-y-3">
              <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                <Globe size={18} className="text-red-400" />
                <div>
                  <h3 className="font-semibold text-gray-900">Active Failed Webhooks</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{fwList.length} webhook{fwList.length !== 1 ? 's' : ''} configured</p>
                </div>
              </div>

              {fwList.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-6">No failed message webhooks configured yet</p>
              )}

              {fwList.map((item) => (
                <div key={item.id}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                    item.is_active ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'
                  }`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-800">{item.name}</p>
                      <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">{item.api_method}</span>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap mt-1.5">
                      {(item.campaigns || []).slice(0, 3).map((c) => (
                        <span key={c.id} title={c.name}
                          className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium max-w-[180px] truncate">{c.name}</span>
                      ))}
                      {(item.campaigns || []).length > 3 && (
                        <span title={item.campaigns.slice(3).map((c) => c.name).join('\n')}
                          className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">
                          +{item.campaigns.length - 3} more
                        </span>
                      )}
                      {(item.campaigns || []).length === 0 && (
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">No campaign linked</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 truncate font-mono mt-1">{item.api_url}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => toggleFw(item)} title={item.is_active ? 'Disable' : 'Enable'}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-whatsapp-teal hover:bg-green-50 transition-colors">
                      {item.is_active
                        ? <ToggleRight size={20} className="text-whatsapp-green" />
                        : <ToggleLeft size={20} />}
                    </button>
                    <button onClick={() => startFwEdit(item)} title="Edit"
                      className={`p-1.5 rounded-lg transition-colors ${
                        fwEditId === item.id
                          ? 'text-blue-600 bg-blue-50'
                          : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50'
                      }`}>
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => deleteFw(item.id)} title="Delete"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

          </div>{/* end failed webhook grid */}

        </>)}

      </div>{/* ── END Content Area ── */}

      {/* Modals */}
      {showWabaInput && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-bold text-gray-900">Enter Your WABA ID</p>
                <p className="text-xs text-gray-400 mt-0.5">Find it in Meta Business Manager → WhatsApp Accounts</p>
              </div>
              <button onClick={() => setShowWabaInput(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <input value={wabaInputId} onChange={(e) => setWabaInputId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchPhonesForWaba()}
              className="input w-full font-mono mb-4" placeholder="e.g. 1736454720919400" autoFocus />
            <button onClick={fetchPhonesForWaba} disabled={!wabaInputId.trim() || fetchingPhones}
              className="btn-primary w-full flex items-center justify-center gap-2">
              {fetchingPhones ? <><Loader2 size={16} className="animate-spin" /> Fetching phones...</> : <>Fetch Phone Numbers <ChevronRight size={16} /></>}
            </button>
          </div>
        </div>
      )}
      {wabas && <MetaConnectModal wabas={wabas} onConnect={handleConnect} onClose={() => setWabas(null)} />}
      {connectResults && <ConnectResults results={connectResults} onClose={() => setConnectResults(null)} />}
    </div>
  );
}