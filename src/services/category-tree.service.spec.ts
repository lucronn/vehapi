import { test, expect, mock } from 'bun:test';
import '@angular/compiler';

mock.module('@angular/core', () => {
    return {
        Injectable: () => (target: any) => target,
        computed: (fn: any) => fn, // Just return the function so we can evaluate it
        signal: (val: any) => {
            let current = val;
            return Object.assign(() => current, {
                set: (newVal: any) => { current = newVal; },
                update: (fn: any) => { current = fn(current); }
            });
        },
        inject: (token: any) => {
            if (token.name === 'SearchResultsState') {
                return {
                    articleDetails: () => [
                        { id: '1', title: 'Art1', bucket: 'Eng', parentBucket: 'Pow' },
                        { id: '2', title: 'Art2', bucket: 'Trans', parentBucket: 'Pow' },
                        { id: '3', title: 'Art3', bucket: 'Brk', parentBucket: 'Chs' }
                    ]
                };
            }
            if (token.name === 'SupabaseService') {
                return {
                    client: {
                        from: () => ({
                            select: () => ({
                                order: async () => ({ data: [], error: null })
                            })
                        })
                    }
                };
            }
            return {};
        }
    };
});

import { CategoryTreeService } from './category-tree.service';

test('CategoryTreeService should build a category tree based on state articles', async () => {
    const service = new CategoryTreeService();

    // In our mock, computed() returns the inner function directly.
    const getTree = service.categoryTree as unknown as () => any;
    const tree = getTree();

    expect(tree.length).toBe(2);

    const powNode = tree.find((n: any) => n.name === 'Pow');
    expect(powNode).toBeTruthy();
    expect(powNode?.children.length).toBe(2);
});
