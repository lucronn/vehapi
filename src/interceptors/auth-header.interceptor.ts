import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Attaches the Firebase ID token (Bearer) to outgoing API requests when the user is signed in.
 * Required for backend article access enforcement (vehapiproxi verifies Firebase tokens).
 * Always attempts to get a token for API requests (handles auth-hydration race).
 */
export const authHeaderInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  // Only attach Firebase Bearer token for endpoints that explicitly verify Firebase JWT.
  // Important: many `/api/source/*` routes are proxied to Motor.com using a *cookie jar*.
  // Forwarding a Firebase `Authorization` header to Motor-proxy endpoints can cause Motor to
  // reject the request with 401 when the user is logged in.
  //
  // We attach:
  // - `/api/credits/*` (secureAuthMiddleware)
  // - `/api/source/:source/vehicle/:vehicleId/article/:articleId` (articleAccessMiddleware)
  // - optional `/html`, `/metadata` under article content
  const urlNoQuery = req.url.split('?')[0];
  const path = (() => {
    try {
      // req.url may be absolute (https://vehapiproxi.../api/...) or relative (/api/...)
      return new URL(urlNoQuery).pathname;
    } catch {
      return urlNoQuery; // fallback for relative urls
    }
  })();

  const isCreditsEndpoint        = path.startsWith('/api/credits/');
  const isArticleContentEndpoint = /^\/api\/source\/[^/]+\/vehicle\/[^/]+\/article\/[^/]+(?:\/html|\/metadata)?$/.test(path);
  const isL2SearchEndpoint       = path === '/api/l2/search' || path.startsWith('/api/l2/') || /^\/api\/vehicle\/[^/]+\/l2\/search$/.test(path);
  const isMotorInformationEndpoint = path.startsWith('/api/motor-information/');
  const isTutorialEndpoint       = path.startsWith('/api/ai/');
  const isDataWriteEndpoint      = path.startsWith('/api/data/') && req.method !== 'GET';

  if (!isCreditsEndpoint && !isArticleContentEndpoint && !isL2SearchEndpoint && !isMotorInformationEndpoint && !isTutorialEndpoint && !isDataWriteEndpoint) {
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
