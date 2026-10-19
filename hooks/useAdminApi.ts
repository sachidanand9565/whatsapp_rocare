/**
 * hooks/useAdminApi.ts
 * Fetch wrapper for the SEPARATE admin panel — uses its own `admin_token`
 * (isolated from the user dashboard's `token`).
 */

/** Expired admin session → back to the admin login, not the user one. */
function handleExpiredAdminSession() {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem('admin_token'); } catch { /* private mode */ }
  if (window.location.pathname.startsWith('/admin/login')) return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/admin/login?expired=1&next=${next}`;
}

export async function adminFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    handleExpiredAdminSession();
    throw new Error('Session expired — please sign in again');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
