import '@angular/compiler';

vi.mock('@angular/core', () => {
    return {
        Injectable: () => (target: any) => target,
        computed: (fn: any) => fn,
        inject: () => {
            return {
                normalizedMenu: () => null,
                articleDetails: () => [
                    { id: '1', title: 'Art1', bucket: 'Eng', parentBucket: 'Pow' },
                    { id: '2', title: 'Art2', bucket: 'Trans', parentBucket: 'Pow' },
                    { id: '3', title: 'Art3', bucket: 'Brk', parentBucket: 'Chs' },
                    { id: '4', title: 'Art4', bucket: 'Elec' },
                    { id: '5', title: 'Art5', parentBucket: 'Body' },
                    { id: '6', title: 'Art6' }
                ]
            }
        }
    };
});

import { CategoryTreeService } from './category-tree.service';

test('CategoryTreeService should build a category tree based on state articles', () => {
    const service = new CategoryTreeService();

    const getTree = service.categoryTree as unknown as () => any;
    const tree = getTree();

    expect(tree.length).toBe(5);

    const powNode = tree.find((n: any) => n.name === 'Pow');
    expect(powNode).toBeTruthy();
    expect(powNode?.children.length).toBe(2);
});

test('CategoryTreeService should use bucket as parent when parentBucket is missing', () => {
    const service = new CategoryTreeService();

    const getTree = service.categoryTree as unknown as () => any;
    const tree = getTree();

    const elecNode = tree.find((n: any) => n.name === 'Elec');
    expect(elecNode).toBeTruthy();
    expect(elecNode?.type).toBe('system');

    const elecGroup = elecNode?.children.find((n: any) => n.name === 'Elec');
    expect(elecGroup).toBeTruthy();
    expect(elecGroup?.type).toBe('group');
    expect(elecGroup?.children[0].id).toBe('4');
});

test('CategoryTreeService should fall back to Uncategorized when bucket is missing', () => {
    const service = new CategoryTreeService();

    const getTree = service.categoryTree as unknown as () => any;
    const tree = getTree();

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

    const uncategorizedNode = tree.find((n: any) => n.name === 'Uncategorized');
    expect(uncategorizedNode).toBeTruthy();
    expect(uncategorizedNode?.type).toBe('system');

    const uncategorizedGroup = uncategorizedNode?.children.find((n: any) => n.name === 'Uncategorized');
    expect(uncategorizedGroup).toBeTruthy();
    expect(uncategorizedGroup?.children[0].id).toBe('6');
});
