import { describe, it, expect } from 'vitest';
import { pickLaborArticleFromCatalog } from './maintenance-labor-resolve.util';

describe('pickLaborArticleFromCatalog', () => {
    const catalog = [
        { id: 'L:111', title: 'Engine Oil Filter R&R', bucket: 'Labor', parentBucket: 'Labor & Estimating' },
        { id: 'L:222', title: 'Brake Pad R&R', bucket: 'Labor' },
        { id: 'P:999', title: 'Engine Oil Filter R&R', bucket: 'Procedures' },
        { id: 'L:333', title: 'Unrelated Operation', bucket: 'Labor' }
    ];

    it('matches exact taxonomy title to L:', () => {
        const r = pickLaborArticleFromCatalog(catalog, 'Engine Oil Filter R&R', 'Maintenance schedule 1 (ref 1)');
        expect(r?.id).toBe('L:111');
    });

    it('matches substring on taxonomy', () => {
        const r = pickLaborArticleFromCatalog(catalog, 'Brake Pad', 'x');
        expect(r?.id).toBe('L:222');
    });

    it('returns null when only generic description and no taxonomy', () => {
        const r = pickLaborArticleFromCatalog(
            catalog,
            '',
            'Maintenance schedule 1159 (ref 23189917)'
        );
        expect(r).toBeNull();
    });

    it('ignores non-L ids', () => {
        const onlyP = [{ id: 'P:1', title: 'Engine Oil Filter R&R', bucket: 'Procedures' }];
        expect(pickLaborArticleFromCatalog(onlyP, 'Engine Oil Filter R&R', '')).toBeNull();
    });
});
