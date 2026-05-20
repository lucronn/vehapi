import { describe, expect, test } from 'vitest';
import { normalizeYearList } from './year-list';

describe('normalizeYearList', () => {
  test('coerces string years and sorts desc', () => {
    expect(normalizeYearList(['2011', '2010', 2012])).toEqual([2012, 2011, 2010]);
  });

  test('reads Motor DaaS Year objects', () => {
    expect(normalizeYearList([{ Year: 2015 }, { year: 2014 }])).toEqual([2015, 2014]);
  });

  test('returns empty for invalid input', () => {
    expect(normalizeYearList(null)).toEqual([]);
    expect(normalizeYearList([{}, 'abc'])).toEqual([]);
  });
});
