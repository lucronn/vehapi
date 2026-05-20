import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';

interface AppConfig {
    demoMode: boolean;
}

@Injectable({ providedIn: 'root' })
export class AppConfigService {
    private http = inject(HttpClient);

    readonly demoMode = signal(false);

    /** Call once during app bootstrap (APP_INITIALIZER or constructor of AppComponent). */
    async load(): Promise<void> {
        try {
            const cfg = await this.http
                .get<AppConfig>(`${environment.apiUrl}/app-config`)
                .toPromise();
            this.demoMode.set(cfg?.demoMode ?? false);
        } catch {
            // Non-fatal — default false
        }
    }
}
