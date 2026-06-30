'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert, Loader2 } from 'lucide-react';

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      // 1) Normal login to get a token
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      const token = data.data?.token;
      if (!token) throw new Error('Login failed');

      // 2) Verify this account is a platform super-admin
      const meRes = await fetch('/api/admin/me', { headers: { Authorization: `Bearer ${token}` } });
      const me = await meRes.json();
      if (!me.data?.isSuperAdmin) throw new Error('This account is not a super-admin.');

      // 3) Store in a SEPARATE admin token + go to panel
      localStorage.setItem('admin_token', token);
      router.replace('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-red-500/20 flex items-center justify-center mx-auto mb-3">
            <ShieldAlert size={24} className="text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Super Admin</h1>
          <p className="text-xs text-gray-500 mt-1">Platform control panel — restricted access</p>
        </div>

        <form onSubmit={submit} className="bg-gray-800 rounded-2xl p-6 space-y-4 border border-gray-700">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">{error}</div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-400"
              placeholder="admin@example.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-400"
              placeholder="••••••••" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-50">
            {loading ? <><Loader2 size={15} className="animate-spin" /> Signing in…</> : 'Sign in'}
          </button>
        </form>
        <p className="text-center text-[11px] text-gray-600 mt-4">For platform super-admins only.</p>
      </div>
    </div>
  );
}
