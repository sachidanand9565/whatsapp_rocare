'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function SSOHandoff() {
  const params = useSearchParams();
  const [error, setError] = useState('');

  useEffect(() => {
    const code = params.get('code');
    if (!code) { setError('Login code missing'); return; }

    (async () => {
      try {
        const res  = await fetch('/api/auth/sso-exchange', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ code }),
        });
        const data = await res.json();
        if (!res.ok || !data?.data?.token) {
          throw new Error(data?.error || 'Login failed');
        }
        const d = data.data;
        localStorage.setItem('token', d.token);
        localStorage.setItem('workspaceId', String(d.workspaceId));
        localStorage.setItem('userRole', d.user.role);
        localStorage.setItem('userName', d.user.name);
        localStorage.setItem('workspaces', JSON.stringify(d.workspaces || []));
        // Full reload taaki dashboard layout localStorage fresh padhe
        window.location.href = '/dashboard';
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Login failed');
      }
    })();
  }, [params]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-whatsapp-dark to-whatsapp-teal flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 text-center">
        <div className="text-4xl mb-3">💬</div>
        {error ? (
          <>
            <h1 className="text-xl font-bold text-gray-900">Login failed</h1>
            <p className="text-gray-500 text-sm mt-2">{error}</p>
            <a href="/login" className="inline-block mt-5 text-whatsapp-teal font-medium hover:underline">
              Go to login
            </a>
          </>
        ) : (
          <>
            <div className="w-8 h-8 mx-auto border-2 border-whatsapp-teal border-t-transparent rounded-full animate-spin" />
            <h1 className="text-lg font-semibold text-gray-900 mt-4">Signing you in…</h1>
            <p className="text-gray-500 text-sm mt-1">Please wait a moment.</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function SSOPage() {
  return (
    <Suspense fallback={null}>
      <SSOHandoff />
    </Suspense>
  );
}
