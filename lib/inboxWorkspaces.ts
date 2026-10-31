/**
 * lib/inboxWorkspaces.ts
 * Combined inbox — kaun-kaun se projects ki chats aur calls ek saath aayein.
 * Selection localStorage me per user save hoti hai; inbox page aur global
 * CallManager dono yahi padhte hain. Inbox selection badalne pe INBOX_WS_EVENT
 * fire karta hai taaki CallManager apna live connection dobara jode.
 */

export const INBOX_WS_EVENT = 'wa:inbox-workspaces';

/** Chat/call-specific request us project ke naam pe — server x-workspace-id pe membership check karta hai. */
export function inWs(workspaceId: number | undefined, options: RequestInit = {}): RequestInit {
  if (!workspaceId) return options;
  return { ...options, headers: { ...(options.headers as Record<string, string> | undefined), 'x-workspace-id': String(workspaceId) } };
}

export function inboxWsKey(userId: number | null): string {
  return `inboxWorkspaces:${userId ?? ''}`;
}

/** Selected ids that are still in the user's project list. */
export function shownInboxWorkspaceIds(selected: number[], all: { id: number }[]): number[] {
  return selected.filter((id) => all.some((w) => w.id === id));
}

/** Combined mode = koi aur project bhi selected hai (sirf current project = normal inbox). */
export function isCombined(shown: number[], currentWsId: number): boolean {
  return shown.length > 0 && !(shown.length === 1 && shown[0] === currentWsId);
}

function readJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
}

/** Outside the inbox page (CallManager): combined ho to selected ids, warna [] (sirf current project). */
export function readInboxWorkspaceIds(): number[] {
  try {
    const token  = localStorage.getItem('token');
    const userId = token ? JSON.parse(atob(token.split('.')[1])).userId ?? null : null;
    const all    = readJson<{ id: number }[]>('workspaces', []);
    const shown  = shownInboxWorkspaceIds(readJson<number[]>(inboxWsKey(userId), []), all);
    return isCombined(shown, Number(localStorage.getItem('workspaceId')) || 0) ? shown : [];
  } catch { return []; }
}

export function workspaceName(id: number): string {
  return readJson<{ id: number; name: string }[]>('workspaces', []).find((w) => w.id === id)?.name || `Project ${id}`;
}
