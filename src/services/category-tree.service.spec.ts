import { test, expect, mock } from 'bun:test';
import '@angular/compiler';

mock.module('@angular/core', () => {
    return {
        Injectable: () => (target: any) => target,
        computed: (fn: any) => fn, // Just return the function so we can evaluate it
        inject: () => {
            return {
                articleDetails: () => [
                    { id: '1', title: 'Art1', bucket: 'Eng', parentBucket: 'Pow' },
                    { id: '2', title: 'Art2', bucket: 'Trans', parentBucket: 'Pow' },
                    { id: '3', title: 'Art3', bucket: 'Brk', parentBucket: 'Chs' },
                    { id: '4', title: 'Art4', bucket: 'Elec' },           // missing parentBucket
                    { id: '5', title: 'Art5', parentBucket: 'Body' },     // missing bucket
                    { id: '6', title: 'Art6' }                            // both missing
                ]
            }
        }
    };
});

import { CategoryTreeService } from './category-tree.service';

test('CategoryTreeService should build a category tree based on state articles', () => {
    const service = new CategoryTreeService();

    // In our mock, computed() returns the inner function directly.
    const getTree = service.categoryTree as unknown as () => any;
    const tree = getTree();

    // Body, Chs, Elec, Pow, Uncategorized (sorted alphabetically)
    expect(tree.length).toBe(5);

    const powNode = tree.find((n: any) => n.name === 'Pow');
    expect(powNode).toBeTruthy();
    expect(powNode?.children.length).toBe(2);
});

test('CategoryTreeService should use bucket as parent when parentBucket is missing', () => {
    const service = new CategoryTreeService();

    const getTree = service.categoryTree as unknown as () => any;
    const tree = getTree();

    // Art4 has bucket='Elec' and no parentBucket, so the top-level node should be named 'Elec'
    const elecNode = tree.find((n: any) => n.name === 'Elec');
    expect(elecNode).toBeTruthy();
    expect(elecNode?.type).toBe('system');

    // The group under 'Elec' should also be named 'Elec' (bucket used as both parent and group)
    const elecGroup = elecNode?.children.find((n: any) => n.name === 'Elec');
    expect(elecGroup).toBeTruthy();
    expect(elecGroup?.type).toBe('group');
    expect(elecGroup?.children[0].id).toBe('4');
});

test('CategoryTreeService should fall back to Uncategorized when bucket is missing', () => {
    const service = new CategoryTreeService();

    const getTree = service.categoryTree as unknown as () => any;
    const tree = getTree();

    // Art5 has parentBucket='Body' and no bucket, so the group should be 'Uncategorized'
    const bodyNode = tree.find((n: any) => n.name === 'Body');
    expect(bodyNode).toBeTruthy();

    const uncategorizedGroup = bodyNode?.children.find((n: any) => n.name === 'Uncategorized');
    expect(uncategorizedGroup).toBeTruthy();
    expect(uncategorizedGroup?.type).toBe('group');
    expect(uncategorizedGroup?.children[0].id).toBe('5');
});

test('CategoryTreeService should group articles with no bucket and no parentBucket under Uncategorized', () => {
    const service = new CategoryTreeService();

    const getTree = service.categoryTree as unknown as () => any;
    const tree = getTree();

    // Art6 has neither bucket nor parentBucket, so it should appear under 'Uncategorized' > 'Uncategorized'
    const uncategorizedNode = tree.find((n: any) => n.name === 'Uncategorized');
    expect(uncategorizedNode).toBeTruthy();
    expect(uncategorizedNode?.type).toBe('system');

    const uncategorizedGroup = uncategorizedNode?.children.find((n: any) => n.name === 'Uncategorized');
    expect(uncategorizedGroup).toBeTruthy();
    expect(uncategorizedGroup?.children[0].id).toBe('6');
});
