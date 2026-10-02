import type { MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

// Photos and documents are read from and uploaded to the private bucket through signed URLs; a
// PDF is shown in a frame from it.
const STORAGE = 'https://storage.googleapis.com';

/**
 * CSP, HSTS, nosniff and Referrer-Policy for the API and the SPA it serves. The policy is strict
 * on purpose; loosen a directive only when the SPA needs it, and only that directive. HSTS is
 * sent in production only, so local HTTP development is not pinned to HTTPS.
 */
export function securityHeaders({ isProduction }: { isProduction: boolean }): MiddlewareHandler {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:', STORAGE],
      connectSrc: ["'self'", STORAGE],
      frameSrc: [STORAGE],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: isProduction ? 'max-age=31536000; includeSubDomains' : false,
    referrerPolicy: 'same-origin',
    xContentTypeOptions: 'nosniff',
  });
}
