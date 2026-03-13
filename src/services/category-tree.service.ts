import { Injectable, computed, inject } from '@angular/core';
import { SearchResultsState } from './search-results.state';
import { Article } from '../models/motor.models';

export interface TreeNode {
    id: string;
    name: string;
    type: 'system' | 'group' | 'article';
    children: TreeNode[];
    article?: Article;
}

@Injectable({
    providedIn: 'root'
})
export class CategoryTreeService {
    private searchState = inject(SearchResultsState);

    // This converts the flat articles array into a hierarchical tree based on taxonomy
    readonly categoryTree = computed<TreeNode[]>(() => {
        const normalized = this.searchState.normalizedMenu();
        
        // If we have a normalized menu from the proxy, use it!
        if (normalized && normalized.categories) {
            return this.mapNormalizedToTree(normalized.categories);
        }

        // Fallback to legacy synthetic tree logic for other sources or non-normalized responses
        const articles = this.searchState.articleDetails();
        return this.buildSyntheticTree(articles);
    });

    private mapNormalizedToTree(categories: any[]): TreeNode[] {
        return categories.map(cat => ({
            id: cat.id,
            name: cat.name,
            type: cat.type,
            children: [
                ...(cat.children ? this.mapNormalizedToTree(cat.children) : []),
                ...(cat.articles ? cat.articles.map((a: Article) => ({
                    id: a.id,
                    name: a.title,
                    type: 'article' as const,
                    children: [],
                    article: a
                })) : [])
            ]
        }));
    }

    private buildSyntheticTree(articles: Article[]): TreeNode[] {
        const root: TreeNode[] = [];
        const bucketNodes = new Map<string, TreeNode>();

        articles.forEach(article => {
            const parentBucket = article.parentBucket || 'Other';
            const bucket = article.bucket || 'Uncategorized';

            const isOther = parentBucket === 'Other';
            const rootBucketName = isOther ? bucket : parentBucket;
            const subBucketName = isOther ? null : bucket;

            let rootNode = bucketNodes.get(rootBucketName);
            if (!rootNode) {
                rootNode = {
                    id: rootBucketName,
                    name: rootBucketName,
                    type: 'system',
                    children: []
                };
                bucketNodes.set(rootBucketName, rootNode);
                root.push(rootNode);
            }

            if (subBucketName) {
                const subBucketId = `${rootBucketName}-${subBucketName}`;
                let subNode = bucketNodes.get(subBucketId);
                if (!subNode) {
                    subNode = {
                        id: subBucketId,
                        name: subBucketName,
                        type: 'group',
                        children: []
                    };
                    bucketNodes.set(subBucketId, subNode);
                    rootNode.children.push(subNode);
                }
                
                subNode.children.push({
                    id: article.id,
                    name: article.title,
                    type: 'article',
                    children: [],
                    article: article
                });
            } else {
                rootNode.children.push({
                    id: article.id,
                    name: article.title,
                    type: 'article',
                    children: [],
                    article: article
                });
            }
        });

        // Sort alphabetically
        root.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        root.forEach(node => {
            node.children.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            node.children.forEach(child => {
                child.children.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            });
        });

        return root;
    }
}
