/**
 * lib/auth.ts
 * JWT authentication helpers + password hashing
 */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { query, execute } from './db';
import { RowDataPacket } from 'mysql2';

const JWT_SECRET  = process.env.JWT_SECRET  || 'change-me-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

export interface JWTPayload {
  userId:      number;
  email:       string;
  role:        string;
  workspaceId: number;
}

// ---- DB-backed token invalidation (serverless-safe force-logout) ----
// users.tokens_valid_from (unix secs): tokens issued BEFORE this are rejected.
// A short in-memory cache avoids a DB hit on every request (warm instances).
const CACHE_TTL_MS = 60_000;
const validFromCache = new Map<number, { validFrom: number; at: number }>();

async function getTokensValidFrom(userId: number): Promise<number> {
  const cached = validFromCache.get(userId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.validFrom;
  let validFrom = 0;
  try {
    const rows = await query<RowDataPacket[]>(
      'SELECT tokens_valid_from FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    validFrom = Number(rows[0]?.tokens_valid_from) || 0;
  } catch { validFrom = 0; /* column may not exist yet → treat as no invalidation */ }
  validFromCache.set(userId, { validFrom, at: Date.now() });
  return validFrom;
}

// Force-logout all of a user's existing sessions (password change / disable).
export async function invalidateUserTokens(userId: number): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    await execute('UPDATE users SET tokens_valid_from = ? WHERE id = ?', [nowSec, userId]);
  } catch { /* column may not exist yet */ }
  validFromCache.set(userId, { validFrom: nowSec, at: Date.now() });
}

// ---- Token generation ----
export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES } as jwt.SignOptions);
}

// ---- Token verification (throws if invalid) ----
export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload;
}

// ---- Super-admin bootstrap via env (comma-separated emails) ----
const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export function isSuperAdminEmail(email: string): boolean {
  return SUPER_ADMIN_EMAILS.includes((email || '').toLowerCase());
}

// ---- One-time SSO handoff code (short-lived) ----
// Cross-domain login redirect ke liye: limbu.ai signup/login karta hai, ye chhota
// code (60s) redirect URL me bhejta hai, aur whatsapp.limbu.ai/auth/sso ise asli
// session ke liye exchange karta hai. Long-lived token kabhi URL me nahi jaata.
const HANDOFF_EXPIRES = '60s';

export function signHandoffCode(payload: JWTPayload): string {
  return jwt.sign({ ...payload, purpose: 'handoff' }, JWT_SECRET, { expiresIn: HANDOFF_EXPIRES } as jwt.SignOptions);
}

export function verifyHandoffCode(code: string): JWTPayload {
  const decoded = jwt.verify(code, JWT_SECRET) as JWTPayload & { purpose?: string };
  if (decoded.purpose !== 'handoff') throw new Error('INVALID_HANDOFF');
  return { userId: decoded.userId, email: decoded.email, role: decoded.role, workspaceId: decoded.workspaceId };
}

// ---- Extract token from Authorization header or cookie ----
export function extractToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return req.cookies.get('token')?.value ?? null;
}

// ---- Authenticate request — returns payload or null ----
export async function authenticate(req: NextRequest): Promise<JWTPayload | null> {
  try {
    const token = extractToken(req);
    if (!token) return null;
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload & { iat: number };
    // Reject tokens issued before a password-change / disable invalidation
    const validFrom = await getTokensValidFrom(decoded.userId);
    if (validFrom && decoded.iat < validFrom) return null;
    return decoded;
  } catch {
    return null;
  }
}

// ---- Password helpers ----
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ---- Combined inbox: ek user ke kai projects (workspaces) ek saath ----
// Membership role per (user, workspace), same short cache as tokens_valid_from.
const memberCache = new Map<string, { role: string | null; at: number }>();

export async function getMemberRole(userId: number, workspaceId: number): Promise<string | null> {
  const key = `${userId}:${workspaceId}`;
  const cached = memberCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.role;
  const rows = await query<RowDataPacket[]>(
    'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ? LIMIT 1',
    [workspaceId, userId]
  );
  const role = rows.length > 0 ? (rows[0].role as string) : null;
  memberCache.set(key, { role, at: Date.now() });
  return role;
}

export interface WorkspaceScope { workspaceId: number; role: string; }

/**
 * `?workspaces=1,2,3` → sirf wahi projects jinka user member hai, har ek apne role ke saath.
 * Param na ho to token wala single workspace (purana behaviour).
 */
export async function resolveWorkspaceScopes(payload: JWTPayload, param: string | null): Promise<WorkspaceScope[]> {
  const ids = Array.from(new Set((param || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0)));
  if (ids.length === 0) return [{ workspaceId: payload.workspaceId, role: payload.role }];
  const rows = await query<RowDataPacket[]>(
    `SELECT workspace_id, role FROM workspace_members
     WHERE user_id = ? AND workspace_id IN (${ids.map(() => '?').join(',')})`,
    [payload.userId, ...ids]
  );
  return rows.map((r) => ({ workspaceId: Number(r.workspace_id), role: r.role as string }));
}

// ---- Middleware guard — use inside API routes (await it) ----
// `x-workspace-id` header: combined inbox me jo chat kisi aur project ki hai, uski
// request usi project ke naam pe chale — member ho tabhi, warna FORBIDDEN.
export async function requireAuth(req: NextRequest): Promise<JWTPayload> {
  const payload = await authenticate(req);
  if (!payload) throw new Error('UNAUTHORIZED');
  const wsId = Number(req.headers.get('x-workspace-id') || 0);
  if (wsId && wsId !== payload.workspaceId) {
    const role = await getMemberRole(payload.userId, wsId);
    if (!role) throw new Error('FORBIDDEN');
    return { ...payload, workspaceId: wsId, role };
  }
  return payload;
}
