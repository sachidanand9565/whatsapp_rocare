'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import LogoMark from '../components/LogoMark';
import { Mail, Lock, Eye, EyeOff, Loader2, ArrowRight, ArrowLeft, KeyRound, CheckCircle2 } from 'lucide-react';

type Step = 'email' | 'otp' | 'password' | 'done';

const RESEND_SECONDS = 45;

export default function ForgotPasswordPage() {
  const [step, setStep]         = useState<Step>('email');
  const [email, setEmail]       = useState('');
  const [otp, setOtp]           = useState('');
  const [resetToken, setToken]  = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Countdown so people don't hammer "resend" (the API rate-limits anyway)
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

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

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    try {
      await post('/api/auth/forgot-password', { email: email.trim() });
      toast.success('If that email is registered, a code is on its way');
      setStep('otp');
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await post('/api/auth/verify-otp', { email: email.trim(), otp });
      setToken(data.resetToken);
      setStep('password');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { toast.error('Both passwords must match'); return; }
    setLoading(true);
    try {
      await post('/api/auth/reset-password', { email: email.trim(), resetToken, password });
      setStep('done');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reset the password');
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'w-full border border-gray-300 rounded-xl pl-10 pr-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp-green focus:border-transparent transition-shadow';

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-green-50/60 via-white to-white p-6 sm:p-10">
      <Link href="/" className="flex items-center gap-2.5 w-max">
        <LogoMark />
        <span className="font-bold text-lg tracking-tight text-gray-900">Limbu <span className="text-whatsapp-teal">AI</span></span>
      </Link>

      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md">

          {step === 'email' && (
            <>
              <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Forgot password?</h1>
              <p className="text-gray-500 mt-2">Enter your account email and we&apos;ll send you a 6-digit code.</p>
              <form onSubmit={sendCode} className="mt-8 space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="email" required autoFocus autoComplete="email" value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputClass} placeholder="you@company.com" />
                  </div>
                </div>
                <button type="submit" disabled={loading}
                  className="w-full inline-flex items-center justify-center gap-2 bg-whatsapp-green hover:bg-whatsapp-teal disabled:opacity-60 text-white font-bold py-3.5 rounded-xl transition-colors shadow-lg shadow-green-200">
                  {loading ? <><Loader2 size={17} className="animate-spin" /> Sending…</> : <>Send code <ArrowRight size={17} /></>}
                </button>
              </form>
            </>
          )}

          {step === 'otp' && (
            <>
              <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Check your email</h1>
              <p className="text-gray-500 mt-2">
                We sent a 6-digit code to <span className="font-semibold text-gray-700">{email}</span>. It expires in 10 minutes.
              </p>
              <form onSubmit={verifyCode} className="mt-8 space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Verification code</label>
                  <div className="relative">
                    <KeyRound size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      inputMode="numeric" autoFocus required value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className={`${inputClass} font-mono text-lg tracking-[0.4em]`} placeholder="123456" />
                  </div>
                </div>
                <button type="submit" disabled={loading || otp.length !== 6}
                  className="w-full inline-flex items-center justify-center gap-2 bg-whatsapp-green hover:bg-whatsapp-teal disabled:opacity-60 text-white font-bold py-3.5 rounded-xl transition-colors shadow-lg shadow-green-200">
                  {loading ? <><Loader2 size={17} className="animate-spin" /> Verifying…</> : <>Verify code <ArrowRight size={17} /></>}
                </button>
              </form>
              <div className="mt-5 flex items-center justify-between text-sm">
                <button onClick={() => { setStep('email'); setOtp(''); }}
                  className="text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
                  <ArrowLeft size={14} /> Change email
                </button>
                <button onClick={() => sendCode()} disabled={cooldown > 0 || loading}
                  className="text-whatsapp-teal font-semibold hover:underline disabled:text-gray-400 disabled:no-underline">
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </button>
              </div>
            </>
          )}

          {step === 'password' && (
            <>
              <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Set a new password</h1>
              <p className="text-gray-500 mt-2">At least 8 characters. You&apos;ll be signed out everywhere else.</p>
              <form onSubmit={savePassword} className="mt-8 space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">New password</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type={showPwd ? 'text' : 'password'} required autoFocus minLength={8}
                      autoComplete="new-password" value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`${inputClass} pr-11`} placeholder="••••••••" />
                    <button type="button" onClick={() => setShowPwd((p) => !p)} tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1">
                      {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Confirm password</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type={showPwd ? 'text' : 'password'} required minLength={8}
                      autoComplete="new-password" value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className={inputClass} placeholder="••••••••" />
                  </div>
                </div>
                <button type="submit" disabled={loading}
                  className="w-full inline-flex items-center justify-center gap-2 bg-whatsapp-green hover:bg-whatsapp-teal disabled:opacity-60 text-white font-bold py-3.5 rounded-xl transition-colors shadow-lg shadow-green-200">
                  {loading ? <><Loader2 size={17} className="animate-spin" /> Saving…</> : <>Update password <ArrowRight size={17} /></>}
                </button>
              </form>
            </>
          )}

          {step === 'done' && (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <CheckCircle2 size={28} className="text-green-600" />
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 mt-5">Password updated</h1>
              <p className="text-gray-500 mt-2">Sign in with your new password to continue.</p>
              <Link href="/login"
                className="mt-8 w-full inline-flex items-center justify-center gap-2 bg-whatsapp-green hover:bg-whatsapp-teal text-white font-bold py-3.5 rounded-xl transition-colors shadow-lg shadow-green-200">
                Back to sign in <ArrowRight size={17} />
              </Link>
            </div>
          )}

          {step !== 'done' && (
            <p className="text-center text-sm text-gray-500 mt-8">
              Remembered it?{' '}
              <Link href="/login" className="text-whatsapp-teal font-semibold hover:underline">Sign in</Link>
            </p>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-gray-400 mt-8">
        © {new Date().getFullYear()} Limbu AI
      </p>
    </div>
  );
}
