/**
 * middleware.ts
 * - Page routes: sab allow karo — auth check client-side layouts mein hoti hai.
 * - API routes (/api/*): CORS handle karta hai. Sirf CORS_ALLOWED_ORIGIN me listed
 *   origin(s) ko allow karta hai aur OPTIONS preflight ka jawab deta hai.
 *   .env mein set karo, e.g.  CORS_ALLOWED_ORIGIN=https://app.mydomain.com
 *   (comma-separated multiple origins bhi allowed hain.)
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function withCors(res: NextResponse, origin: string | null) {
  // Sirf whitelisted origin ko reflect karo (credentials use nahi ho rahe)
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.headers.set('Access-Control-Max-Age', '86400');
  }
  return res;
}

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api')) {
    const origin = req.headers.get('origin');
    // Preflight request — body ke bina 204 lautao
    if (req.method === 'OPTIONS') {
      return withCors(new NextResponse(null, { status: 204 }), origin);
    }
    return withCors(NextResponse.next(), origin);
  }
  // Non-API page routes — sab allow
  return NextResponse.next();
}

export const config = {
  // API routes ke saath-saath baaki sab (static assets chhod kar) match karo
  matcher: ['/api/:path*', '/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
