import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { environment } from '../environments/environment';

export interface StoredArticle {
    id: string; // The Article ID (e.g., P:12345)
    title: string;
    originalContent: string; // HTML
    enhancedContent: string; // HTML
    vehicleId: string;
    source: string;
    timestamp: number;
}

@Injectable({
    providedIn: 'root'
})
export class FirebaseService {
    private app: FirebaseApp;
    private db: Firestore;

    // Global circuit breaker: if we hit a timeout once, assume offline for the session
    // to avoid penalizing every subsequent request with a 2s delay.
    private static isOffline = false;

    constructor() {
        // Initialize Firebase if not already initialized
        if (getApps().length === 0) {
            this.app = initializeApp(environment.firebaseConfig);
        } else {
            this.app = getApp();
        }
        this.db = getFirestore(this.app);
    }

    async getArticle(articleId: string): Promise<StoredArticle | null> {
        try {
            const docRef = doc(this.db, 'articles', articleId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                return docSnap.data() as StoredArticle;
            } else {
                return null;
            }
        } catch (error) {
            console.warn('Error fetching article from Firebase:', error);
            return null;
        }
    }

    async saveArticle(article: StoredArticle): Promise<void> {
        try {
            const docRef = doc(this.db, 'articles', article.id);
            await setDoc(docRef, article);
        } catch (error) {
            console.error('Error saving article to Firebase:', error);
        }
    }

    // --- Common Issues Caching ---
    async getCommonIssues(contentSource: string, vehicleId: string): Promise<import('../models/motor.models').CommonIssue[] | null> {
        return this.getDataList(contentSource, vehicleId, 'common_issues');
    }

    async saveCommonIssues(contentSource: string, vehicleId: string, issues: import('../models/motor.models').CommonIssue[]): Promise<void> {
        return this.saveDataList(contentSource, vehicleId, 'common_issues', issues);
    }

    // --- List Caching (DTCs, TSBs, Procedures) ---
    async getDtcList(contentSource: string, vehicleId: string): Promise<import('../models/motor.models').Dtc[] | null> {
        return this.getDataList(contentSource, vehicleId, 'dtcs');
    }

    async saveDtcList(contentSource: string, vehicleId: string, dtcs: import('../models/motor.models').Dtc[]): Promise<void> {
        return this.saveDataList(contentSource, vehicleId, 'dtcs', dtcs);
    }

    async getTsbList(contentSource: string, vehicleId: string): Promise<import('../models/motor.models').Tsb[] | null> {
        return this.getDataList(contentSource, vehicleId, 'tsbs');
    }

    async saveTsbList(contentSource: string, vehicleId: string, tsbs: import('../models/motor.models').Tsb[]): Promise<void> {
        return this.saveDataList(contentSource, vehicleId, 'tsbs', tsbs);
    }

    async getProcedureList(contentSource: string, vehicleId: string): Promise<import('../models/motor.models').Procedure[] | null> {
        return this.getDataList(contentSource, vehicleId, 'procedures');
    }

    async saveProcedureList(contentSource: string, vehicleId: string, procedures: import('../models/motor.models').Procedure[]): Promise<void> {
        return this.saveDataList(contentSource, vehicleId, 'procedures', procedures);
    }

    // --- Diagram Caching ---
    async getWiringDiagramList(contentSource: string, vehicleId: string): Promise<import('../models/motor.models').WiringDiagram[] | null> {
        return this.getDataList(contentSource, vehicleId, 'wiring_diagrams');
    }

    async saveWiringDiagramList(contentSource: string, vehicleId: string, diagrams: import('../models/motor.models').WiringDiagram[]): Promise<void> {
        return this.saveDataList(contentSource, vehicleId, 'wiring_diagrams', diagrams);
    }

    async getComponentLocationList(contentSource: string, vehicleId: string): Promise<import('../models/motor.models').ComponentLocation[] | null> {
        return this.getDataList(contentSource, vehicleId, 'component_locations');
    }

    async saveComponentLocationList(contentSource: string, vehicleId: string, components: import('../models/motor.models').ComponentLocation[]): Promise<void> {
        return this.saveDataList(contentSource, vehicleId, 'component_locations', components);
    }

    async getAllDiagramList(contentSource: string, vehicleId: string): Promise<any[] | null> {
        return this.getDataList(contentSource, vehicleId, 'all_diagrams');
    }

    async saveAllDiagramList(contentSource: string, vehicleId: string, diagrams: any[]): Promise<void> {
        return this.saveDataList(contentSource, vehicleId, 'all_diagrams', diagrams);
    }

    // --- Full Sync Data Types ---
    async getFluidList(contentSource: string, vehicleId: string): Promise<import('../models/motor.models').Fluid[] | null> {
        return this.getDataList(contentSource, vehicleId, 'fluids');
    }

    async saveFluidList(contentSource: string, vehicleId: string, fluids: import('../models/motor.models').Fluid[]): Promise<void> {
        return this.saveDataList(contentSource, vehicleId, 'fluids', fluids);
    }

    async getSpecList(contentSource: string, vehicleId: string): Promise<import('../models/motor.models').Spec[] | null> {
        return this.getDataList(contentSource, vehicleId, 'specs');
    }

    async saveSpecList(contentSource: string, vehicleId: string, specs: import('../models/motor.models').Spec[]): Promise<void> {
        return this.saveDataList(contentSource, vehicleId, 'specs', specs);
    }

    async savePartList(contentSource: string, vehicleId: string, parts: import('../models/motor.models').Part[]): Promise<void> {
        return this.saveDataList(contentSource, vehicleId, 'parts', parts);
    }

    async saveLaborList(contentSource: string, vehicleId: string, labor: import('../models/motor.models').LaborOperation[]): Promise<void> {
        return this.saveDataList(contentSource, vehicleId, 'labor', labor);
    }

    // --- Generic Helpers ---
    private async getDataList<T>(contentSource: string, vehicleId: string, collectionName: string): Promise<T | null> {
        // Fast fail if we already know we're offline
        if (FirebaseService.isOffline) {
            console.log(`[Firebase] Skipping cache check for ${collectionName} (Circuit Breaker Open)`);
            return null;
        }

        try {
            const docId = `${contentSource}_${vehicleId}`;
            const docRef = doc(this.db, 'vehicles', docId, collectionName, 'list');

            // Timeout after 2 seconds to prevent hanging on offline/slow connections
            const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Firebase operation timed out')), 2000)
            );

            const docSnap = await Promise.race([getDoc(docRef), timeout]);

            if (docSnap.exists()) {
                return docSnap.data()['data'] as T;
            }
            return null;
        } catch (error) {
            // Only warn for non-timeout/offline errors to reduce noise
            if (error instanceof Error && (error.message.includes('timed out') || error.message.includes('offline'))) {
                console.log(`[Firebase] Skipping cache for ${collectionName} (Offline/Timeout)`);
                // Trip the circuit breaker
                FirebaseService.isOffline = true;
            } else {
                console.warn(`Error fetching ${collectionName} from Firebase:`, error);
            }
            return null;
        }
    }

    private async saveDataList<T>(contentSource: string, vehicleId: string, collectionName: string, data: T): Promise<void> {
        try {
            const docId = `${contentSource}_${vehicleId}`;
            const docRef = doc(this.db, 'vehicles', docId, collectionName, 'list');
            await setDoc(docRef, {
                data,
                timestamp: Date.now(),
                source: contentSource,
                vehicleId: vehicleId
            });
        } catch (error) {
            console.error(`Error saving ${collectionName} to Firebase:`, error);
        }
    }
}
