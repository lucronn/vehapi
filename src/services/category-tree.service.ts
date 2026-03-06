import { Injectable, computed, inject, signal } from '@angular/core';
import { SearchResultsState } from './search-results.state';
import { Article } from '../models/motor.models';
import { SupabaseService } from './supabase.service';

export interface TreeNode {
    id: string;
    name: string;
    type: 'system' | 'group' | 'subgroup' | 'article' | 'bucket';
    children: TreeNode[];
    article?: Article;
    isOpen?: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class CategoryTreeService {
    private searchState = inject(SearchResultsState);
    private supabaseService = inject(SupabaseService);

    // This will hold the DB taxonomy once we hook it up
    private dbCategories = signal<any[]>([]);

    constructor() {
        this.fetchDbCategories();
    }

    async fetchDbCategories() {
        try {
            const { data, error } = await this.supabaseService.client
                .from('categories')
                .select('*')
                .order('sort_order', { ascending: true });

            if (data && !error) {
                this.dbCategories.set(data);
            }
        } catch (e) {
            console.error('Error fetching categories from DB', e);
        }
    }

    // This converts the flat articles array into a hierarchical tree based on taxonomy
    readonly categoryTree = computed<TreeNode[]>(() => {
        const articles = this.searchState.articleDetails();
        const dbCats = this.dbCategories();

        // Strategy:
        // 1. If we have DB categories, we should ideally construct the tree from them,
        // and map the articles to the appropriate leaves.
        // However, since the AI worker is still populating it and the DB currently lacks
        // full relational mapping between "procedures" and "categories" tables, we fallback to
        // the synthesized tree from SearchResultsState.

        const root: TreeNode[] = [];
        const bucketNodes = new Map<string, TreeNode>();

        articles.forEach(article => {
            const parentBucket = article.parentBucket || 'Other';
            const bucket = article.bucket || 'Uncategorized';

            let parentNode = bucketNodes.get(parentBucket);
            if (!parentNode) {
                parentNode = {
                    id: parentBucket,
                    name: parentBucket,
                    type: 'system',
                    children: [],
                    isOpen: false
                };
                bucketNodes.set(parentBucket, parentNode);
                root.push(parentNode);
            }

            const bucketId = `${parentBucket}-${bucket}`;
            let bucketNode = bucketNodes.get(bucketId);
            if (!bucketNode) {
                bucketNode = {
                    id: bucketId,
                    name: bucket,
                    type: 'group',
                    children: [],
                    isOpen: false
                };
                bucketNodes.set(bucketId, bucketNode);
                parentNode.children.push(bucketNode);
            }

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
