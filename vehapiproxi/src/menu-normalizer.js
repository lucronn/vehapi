/**
 * Builds normalized menu structure from article catalogs.
 * Normalize once on backend; frontend consumes as-is.
 */

import { normalizeCategoryParams } from './categorize.js';

/**
 * Builds normalized menu from raw Motor API articles (runs full normalization).
 * Use for responses from Motor API /articles/v2.
 */
export function normalizeMotorResponse(data) {
    if (!data || !data.body || !data.body.articleDetails) return data;

    const articles = data.body.articleDetails;
    data.body.normalizedMenu = buildMenuFromArticles(articles, (a) => {
        const parentBucketRaw = a.parentBucket || 'Other';
        const bucketRaw = a.bucket || 'Uncategorized';
        return normalizeCategoryParams(a.title, parentBucketRaw, bucketRaw);
    });
    sortMenu(data.body.normalizedMenu);
    return data;
}

/**
 * Builds normalized menu from pre-normalized articles (e.g. Supabase).
 * Uses bucket/parent_bucket directly — no re-normalization.
 */
export function buildMenuFromNormalizedArticles(articles) {
    return buildMenuFromArticles(articles, (a) => ({
        rootName: a.parent_bucket || a.parentBucket || 'Other',
        subName: a.bucket || 'Uncategorized'
    }));
}

function buildMenuFromArticles(articles, getCategory) {
    const categoriesMap = new Map();
    const result = { categories: [] };

    for (const article of articles) {
        const { rootName, subName } = getCategory(article);

        let rootCat = categoriesMap.get(rootName);
        if (!rootCat) {
            rootCat = {
                id: rootName.toLowerCase().replace(/\s+/g, '-'),
                name: rootName,
                count: 0,
                type: 'system',
                children: []
            };
            categoriesMap.set(rootName, rootCat);
            result.categories.push(rootCat);
        }

        if (subName && subName !== rootName) {
            const subId = `${rootCat.id}-${subName.toLowerCase().replace(/\s+/g, '-')}`;
            let subCat = categoriesMap.get(subId);
            if (!subCat) {
                subCat = {
                    id: subId,
                    name: subName,
                    count: 0,
                    type: 'group',
                    articles: []
                };
                categoriesMap.set(subId, subCat);
                rootCat.children.push(subCat);
            }
            subCat.articles.push(article);
            subCat.count++;
        } else {
            if (!rootCat.articles) rootCat.articles = [];
            rootCat.articles.push(article);
        }
        rootCat.count++;
    }

    sortMenu(result);
    return result;
}

function sortMenu(menu) {
    if (!menu?.categories) return;
    menu.categories.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    menu.categories.forEach(cat => {
        if (cat.children?.length) {
            cat.children.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        }
    });
}
