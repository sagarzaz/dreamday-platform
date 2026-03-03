import { NextResponse, NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { config } from './src/lib/config';

/**
 * Next.js middleware runs before every request and can modify the request/response.
 * Unlike Express, middleware is not a chain of functions called via `next()`;
 * you return a `NextResponse` (or `NextResponse.next()`) and control flow from there.
 *
 * Express middleware executes on the server during request handling and can
 * mutate `req`/`res` objects directly. Next.js middleware runs at the edge
 * (in Vercel's Edge Functions) before the route handler; it cannot access
 * Node APIs (unless running in a Node.js runtime) and is limited to modifying
 * headers and rewriting/redirecting requests.
 *
 * This file implements security headers, CORS allowlist, request ID
 * injection, and other global concerns that previously lived in Express
 * middleware. Policies are applied consistently across both static and
 * dynamic routes.
 */

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // generate or propagate request ID for tracing
  let id = req.headers.get('x-request-id') || randomUUID();
  res.headers.set('x-request-id', id);

  // standard security headers
  res.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none';");
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-no-referrer');

  if (config.nodeEnv === 'production') {
    res.headers.set(
      'Strict-Transport-Security',
      `max-age=${config.hstsMaxAge}; includeSubDomains; preload`
    );
  }

  // CORS handling
  const origin = req.headers.get('origin') || '';
  if (origin && config.corsOrigins.includes(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    res.headers.set('Access-Control-Max-Age', '86400');
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Request-ID');
    res.headers.set('Access-Control-Expose-Headers', 'X-RateLimit-Limit,X-RateLimit-Remaining,X-Request-ID');
  }

  // If this is a preflight request, return early with headers only
  if (req.method === 'OPTIONS') {
    return res;
  }

  return res;
}

// export a config object to indicate which paths the middleware should run on.
// Here we run it on all API routes; you can restrict if desired.
export const configMiddleware = {
  matcher: ['/api/:path*'],
};
