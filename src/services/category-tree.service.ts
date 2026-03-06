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
        const articles = this.searchState.articleDetails();

        // Since we don't have explicit taxonomy data on the articles in the current response,
        // we'll build a synthetic tree based on the existing buckets, but structured deeply
        // to support the reorganised view.

        const root: TreeNode[] = [];

        // Map to quickly find nodes
        const bucketNodes = new Map<string, TreeNode>();

        articles.forEach(article => {
            const bucket = article.bucket || 'Uncategorized';
            const parentBucket = article.parentBucket || bucket || 'Other';

            // 1. Ensure Parent Bucket Node exists
            let parentNode = bucketNodes.get(parentBucket);
            if (!parentNode) {
                parentNode = {
                    id: parentBucket,
                    name: parentBucket,
                    type: 'system',
                    children: []
                };
                bucketNodes.set(parentBucket, parentNode);
                root.push(parentNode);
            }

            // 2. Ensure Bucket Node exists
            const bucketId = `${parentBucket}-${bucket}`;
            let bucketNode = bucketNodes.get(bucketId);
            if (!bucketNode) {
                bucketNode = {
                    id: bucketId,
                    name: bucket,
                    type: 'group',
                    children: []
                };
                bucketNodes.set(bucketId, bucketNode);
                parentNode.children.push(bucketNode);
            }

            // 3. Add Article Node
            bucketNode.children.push({
                id: article.id,
                name: article.title,
                type: 'article',
                children: [],
                article: article
            });
        });

        // Sort alphabetically
        root.sort((a, b) => a.name.localeCompare(b.name));
        root.forEach(node => {
            node.children.sort((a, b) => a.name.localeCompare(b.name));
            node.children.forEach(child => {
                child.children.sort((a, b) => a.name.localeCompare(b.name));
            });
        });

        return root;
    });
}
