import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { MOTOR_API_BASE_URL } from '../utils/motor-api.constants';

/**
 * Attaches the Supabase Bearer token to outgoing API requests when the user is logged in.
 * Required for backend article access enforcement (vehapiproxi verifies unlocks).
 * Always attempts to get a token for API requests (handles auth-hydration race).
 */
export const authHeaderInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  // Only attach Supabase Bearer token for endpoints that explicitly verify Supabase JWT.
  // Important: many `/api/source/*` routes are proxied to Motor.com using a *cookie jar*.
  // Forwarding a Supabase `Authorization` header to Motor-proxy endpoints can cause Motor to
  // reject the request with 401 when the user is logged in.
  //
  // We attach:
  // - `/api/credits/*` (secureAuthMiddleware)
  // - `/api/source/:source/vehicle/:vehicleId/article/:articleId` (articleAccessMiddleware)
  // - optional `/api/source/:source/vehicle/:vehicleId/article/:articleId/html`
  const urlNoQuery = req.url.split('?')[0];
  const path = (() => {
    try {
      // req.url may be absolute (https://vehapiproxi.../api/...) or relative (/api/...)
      return new URL(urlNoQuery).pathname;
    } catch {
      return urlNoQuery; // fallback for relative urls
    }
  })();

  const isCreditsEndpoint = path.startsWith('/api/credits/');
  const isArticleContentEndpoint = /^\/api\/source\/[^/]+\/vehicle\/[^/]+\/article\/[^/]+(?:\/html|\/metadata)?$/.test(path);

  if (!isCreditsEndpoint && !isArticleContentEndpoint) {
    return next(req);
  }

  return from(auth.getIdToken()).pipe(
    switchMap((token) => {
      if (token) {
        req = req.clone({
          setHeaders: { Authorization: `Bearer ${token}` },
        });
      }
      return next(req);
    })
  );
};
