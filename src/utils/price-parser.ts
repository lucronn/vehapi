
const CLEAN_PRICE_REGEX = /^[0-9.]+$/;

/**
 * Optimizes price parsing logic to avoid regex replacement overhead for clean strings and numbers.
 * The original logic was: item.price ? parseFloat(item.price.toString().replace(/[^0-9.]/g, '')) : 0
 * This implementation aims to be functionally equivalent while faster.
 */
export function parsePrice(price: any): number {
  if (!price) return 0;

  if (typeof price === 'number') {
    // Original logic: toString() -> replace -> parseFloat.
    // replace(/[^0-9.]/g, '') removes negative sign.
    // So for numbers, we take absolute value.
    return Math.abs(price);
  }

  const s = String(price);

  // Fast path: if the string is already clean (only digits and dots), just parse it.
  // This avoids creating a new string via replace().
  if (CLEAN_PRICE_REGEX.test(s)) {
    return parseFloat(s);
  }

  // Slow path: use regex to strip invalid characters (like $, commas, letters, negative signs)
  // This allocates a new string.
  return parseFloat(s.replace(/[^0-9.]/g, ''));
}
