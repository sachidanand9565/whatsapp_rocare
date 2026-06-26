/**
 * lib/auth.ts
 * JWT authentication helpers + password hashing
 */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';

const JWT_SECRET  = process.env.JWT_SECRET  || 'change-me-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

export interface JWTPayload {
  userId:      number;
  email:       string;
  role:        string;
  workspaceId: number;
}

// ---- In-memory token invalidation (password change force-logout) ----
// userId -> unix timestamp: tokens issued BEFORE this time are rejected
const invalidatedAt = new Map<number, number>();

export function invalidateUserTokens(userId: number): void {
  invalidatedAt.set(userId, Math.floor(Date.now() / 1000));
}

// ---- Token generation ----
export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES } as jwt.SignOptions);
}

// ---- Token verification (throws if invalid) ----
export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload;
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
export function authenticate(req: NextRequest): JWTPayload | null {
  try {
    const token = extractToken(req);
    if (!token) return null;
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload & { iat: number };
    // Check if token was issued before a password-change invalidation
    const minIat = invalidatedAt.get(decoded.userId);
    if (minIat && decoded.iat < minIat) return null;
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

// ---- Middleware guard — use inside API routes ----
export function requireAuth(req: NextRequest): JWTPayload {
  const payload = authenticate(req);
  if (!payload) throw new Error('UNAUTHORIZED');
  return payload;
}
