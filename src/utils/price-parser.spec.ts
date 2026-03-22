
import { describe, it, expect } from 'bun:test';
import { parsePrice } from './price-parser';

// The original logic to verify against
function originalParse(item: any) {
  return item.price ? parseFloat(item.price.toString().replace(/[^0-9.]/g, '')) : 0;
}

describe('parsePrice', () => {
  const testCases = [
    { input: 123.45, expected: 123.45, desc: 'Positive number' },
    { input: -123.45, expected: 123.45, desc: 'Negative number (stripped)' },
    { input: '123.45', expected: 123.45, desc: 'Clean string' },
    { input: '$123.45', expected: 123.45, desc: 'String with symbol' },
    { input: '1,234.56', expected: 1234.56, desc: 'String with comma' },
    { input: 'USD 123.45', expected: 123.45, desc: 'String with prefix text' },
    { input: '123.45 USD', expected: 123.45, desc: 'String with suffix text' },
    { input: '-123.45', expected: 123.45, desc: 'Negative string' },
    { input: ' -123.45 ', expected: 123.45, desc: 'Negative string with spaces' },
    { input: 'abc', expected: NaN, desc: 'Non-numeric string' }, // parseFloat("") -> NaN
    { input: '', expected: 0, desc: 'Empty string' },
    { input: null, expected: 0, desc: 'Null' },
    { input: undefined, expected: 0, desc: 'Undefined' },
    { input: 0, expected: 0, desc: 'Zero number' },
    { input: '0', expected: 0, desc: 'Zero string' },
  ];

  testCases.forEach(({ input, expected, desc }) => {
    it(`should handle ${desc}: ${JSON.stringify(input)} -> ${expected}`, () => {
      const result = parsePrice(input);
      if (Number.isNaN(expected)) {
        expect(result).toBeNaN();
      } else {
        expect(result).toBe(expected);
      }

      // Verify against original logic for inputs that are "item" objects
      const item = { price: input };
      const originalResult = originalParse(item);
       if (Number.isNaN(expected)) {
        expect(originalResult).toBeNaN();
      } else {
        expect(originalResult).toBe(expected);
      }
    });
  });
});
