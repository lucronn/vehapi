/** Normalize YMME year payloads from DB, Motor DaaS, or cached metadata into sorted unique years. */
export function normalizeYearList(body: unknown): number[] {
  if (body == null) return [];
  const arr = Array.isArray(body) ? body : [];
  const maxYear = new Date().getFullYear() + 2;

  const nums = arr
    .map((y) => {
      if (typeof y === 'number' && Number.isFinite(y)) return y;
      if (typeof y === 'string') {
        const n = parseInt(y, 10);
        return Number.isFinite(n) ? n : NaN;
      }
      if (y && typeof y === 'object') {
        const raw =
          (y as { Year?: unknown; year?: unknown }).Year ??
          (y as { year?: unknown }).year;
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
        if (typeof raw === 'string') {
          const n = parseInt(raw, 10);
          return Number.isFinite(n) ? n : NaN;
        }
      }
      return NaN;
    })
    .filter((n) => Number.isFinite(n) && n >= 1900 && n <= maxYear);

  return [...new Set(nums)].sort((a, b) => b - a);
}
