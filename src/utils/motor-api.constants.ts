import { environment } from '../environments/environment';

/**
 * Origin of the vehapiproxi app (no path). Used to build `/api/...`, `/auth/...`, etc.
 * - Dev / recommended prod: `environment.apiUrl` is `/api` → `''` (same-origin relative URLs).
 * - Optional absolute prod: `https://host/api` → `https://host` for cross-origin setups.
 */
export function getMotorProxyBaseUrl(): string {
  const api = environment.apiUrl.trim();
  if (!api.startsWith('http')) {
    return '';
  }
  const m = api.match(/^(https?:\/\/[^/?#]+)(?:\/api)?\/?$/i);
  if (m) {
    return m[1];
  }
  try {
    return new URL(api).origin;
  } catch {
    return '';
  }
}
