/**
 * hooks/useApi.ts
 * Simple fetch wrapper that injects the JWT token
 */

/**
 * A 401 means the token is gone, expired, or was invalidated by a password
 * change. Clear it and send the user to the login page with the path they were
 * on, so they land back where they were after signing in.
 */
function handleExpiredSession() {
  if (typeof window === 'undefined') return;
  ['token', 'workspaceId', 'userRole', 'userName', 'workspaces'].forEach((k) => {
    try { localStorage.removeItem(k); } catch { /* private mode */ }
  });
  // Already on the login page (or mid-redirect) → don't bounce again
  if (window.location.pathname.startsWith('/login')) return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?expired=1&next=${next}`;
}

export async function apiFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    handleExpiredSession();
    throw new Error('Session expired — please sign in again');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
