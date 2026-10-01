'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import LogoMark from '../components/LogoMark';
import { User, Mail, Lock, Building2, Eye, EyeOff, Loader2, ArrowRight, ArrowLeft, Check, KeyRound } from 'lucide-react';

const PERKS = [
  'Connect your number with Meta’s official Embedded Signup',
  'Send your first campaign the same day',
  'Invite unlimited team agents to the shared inbox',
  'Chatbot, calling, CRM and developer API included',
];

const RESEND_SECONDS = 45;

export default function SignupPage() {
  const [form, setForm]       = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  // Step 2: the emailed code must check out before the account is created
  const [otpStep, setOtpStep]   = useState(false);
  const [otp, setOtp]           = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function post(url: string, body: Record<string, string>) {
    const res  = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data.data;
  }

  // Step 1 -> email the code
  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (form.password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      await post('/api/auth/signup/send-otp', { email: form.email.trim() });
      toast.success(`Code sent to ${form.email.trim()}`);
      setOtpStep(true);
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setLoading(false);
    }
  }

  // Step 2 -> verify the code, then create the account with the token it returns
  async function verifyAndCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { verifyToken } = await post('/api/auth/signup/verify-otp', { email: form.email.trim(), otp });
      const data = await post('/api/auth/signup', {
        name:          form.name,
        password:      form.password,
        workspaceName: form.workspaceName,
        verifyToken,
      });
      localStorage.setItem('token', data.token);
      localStorage.setItem('workspaceId', String(data.workspaceId));
      toast.success('Account created! Welcome 🎉');
      // Hard redirect so the browser sends the auth cookie to middleware
      setTimeout(() => { window.location.href = '/dashboard'; }, 500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Signup failed');
      setLoading(false);
    }
  }

  const FIELDS = [
    { label: 'Full Name',     name: 'name',          type: 'text',  placeholder: 'John Doe',        icon: <User size={16} />,      autoComplete: 'name' },
    { label: 'Email',         name: 'email',         type: 'email', placeholder: 'you@company.com', icon: <Mail size={16} />,      autoComplete: 'email' },
    { label: 'Business Name', name: 'workspaceName', type: 'text',  placeholder: 'Acme Corp',       icon: <Building2 size={16} />, autoComplete: 'organization' },
  ];

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">

      {/* ── Left: brand panel (desktop) ─────────────────────── */}
      <div className="hidden lg:flex flex-col justify-between p-12 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg,#075E54 0%,#0b6e60 55%,#128C7E 100%)' }}>
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-whatsapp-green/20 rounded-full blur-3xl" aria-hidden />
        <div className="absolute -bottom-32 -left-16 w-96 h-96 bg-white/5 rounded-full blur-3xl" aria-hidden />

        <Link href="/" className="relative flex items-center gap-2.5 w-max">
          <LogoMark />
          <span className="font-bold text-lg tracking-tight">Limbu <span className="text-whatsapp-green">AI</span></span>
        </Link>

        <div className="relative">
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight">
            Start selling on WhatsApp<br />in minutes
          </h1>
          <p className="mt-4 text-green-100/90 leading-relaxed max-w-md">
            Create your workspace on the official WhatsApp Business API — no setup fees,
            no technical team needed.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-green-50/95">
            {PERKS.map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <span className="mt-0.5 w-5 h-5 rounded-full bg-whatsapp-green/25 flex items-center justify-center flex-shrink-0">
                  <Check size={12} className="text-whatsapp-green" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-green-200/60">
          © {new Date().getFullYear()} Limbu AI · WhatsApp Business Platform
        </p>
      </div>

      {/* ── Right: form ─────────────────────────────────────── */}
      <div className="flex flex-col p-6 sm:p-10 bg-gradient-to-b from-green-50/60 via-white to-white lg:bg-none">
        {/* mobile-only brand */}
        <Link href="/" className="lg:hidden flex items-center gap-2.5 w-max mb-10">
          <LogoMark />
          <span className="font-bold text-lg tracking-tight text-gray-900">Limbu <span className="text-whatsapp-teal">AI</span></span>
        </Link>

        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-md">
            <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">
              {otpStep ? 'Verify your email' : 'Create your account'}
            </h2>
            <p className="text-gray-500 mt-2">
              {otpStep
                ? <>We sent a 6-digit code to <span className="font-semibold text-gray-700">{form.email}</span>. It expires in 10 minutes.</>
                : 'Free to start — send WhatsApp campaigns today.'}
            </p>

            {otpStep ? (
              <>
                <form onSubmit={verifyAndCreate} className="mt-8 space-y-5">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Verification code</label>
                    <div className="relative">
                      <KeyRound size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        inputMode="numeric" autoFocus required value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        className="w-full border border-gray-300 rounded-xl pl-10 pr-3.5 py-3 font-mono text-lg tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-whatsapp-green focus:border-transparent transition-shadow"
                        placeholder="123456"
                      />
                    </div>
                  </div>
                  <button type="submit" disabled={loading || otp.length !== 6}
                    className="w-full inline-flex items-center justify-center gap-2 bg-whatsapp-green hover:bg-whatsapp-teal disabled:opacity-60 text-white font-bold py-3.5 rounded-xl transition-colors shadow-lg shadow-green-200">
                    {loading
                      ? <><Loader2 size={17} className="animate-spin" /> Creating account…</>
                      : <>Verify &amp; create account <ArrowRight size={17} /></>}
                  </button>
                </form>
                <div className="mt-5 flex items-center justify-between text-sm">
                  <button onClick={() => { setOtpStep(false); setOtp(''); }}
                    className="text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
                    <ArrowLeft size={14} /> Edit details
                  </button>
                  <button onClick={() => handleSubmit()} disabled={cooldown > 0 || loading}
                    className="text-whatsapp-teal font-semibold hover:underline disabled:text-gray-400 disabled:no-underline">
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                  </button>
                </div>
              </>
            ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              {FIELDS.map((f) => (
                <div key={f.name}>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">{f.label}</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">{f.icon}</span>
                    <input
                      type={f.type} name={f.name} required autoComplete={f.autoComplete}
                      value={form[f.name as keyof typeof form]}
                      onChange={onChange}
                      className="w-full border border-gray-300 rounded-xl pl-10 pr-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp-green focus:border-transparent transition-shadow"
                      placeholder={f.placeholder}
                    />
                  </div>
                </div>
              ))}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showPwd ? 'text' : 'password'} name="password" required autoComplete="new-password"
                    value={form.password} onChange={onChange} minLength={8}
                    className="w-full border border-gray-300 rounded-xl pl-10 pr-11 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp-green focus:border-transparent transition-shadow"
                    placeholder="Min 8 characters"
                  />
                  <button type="button" onClick={() => setShowPwd((p) => !p)} tabIndex={-1}
                    title={showPwd ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1">
                    {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 bg-whatsapp-green hover:bg-whatsapp-teal disabled:opacity-60 text-white font-bold py-3.5 rounded-xl transition-colors shadow-lg shadow-green-200 !mt-6">
                {loading
                  ? <><Loader2 size={17} className="animate-spin" /> Sending code…</>
                  : <>Continue <ArrowRight size={17} /></>}
              </button>
            </form>
            )}

            <p className="text-center text-sm text-gray-500 mt-8">
              Already have an account?{' '}
              <Link href="/login" className="text-whatsapp-teal font-semibold hover:underline">Sign in</Link>
            </p>
          </div>
        </div>

        <p className="lg:hidden text-center text-xs text-gray-400 mt-8">
          © {new Date().getFullYear()} Limbu AI
        </p>
      </div>
    </div>
  );
}
