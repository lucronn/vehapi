import { Injectable } from '@angular/core';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class LoggerService {
    debug(...args: unknown[]): void {
        if (!environment.production) console.debug(...args);
    }

    info(...args: unknown[]): void {
        if (!environment.production) console.log(...args);
    }

    warn(...args: unknown[]): void {
        if (!environment.production) console.warn(...args);
    }

    error(...args: unknown[]): void {
        // Always log errors, even in production
        console.error(...args);
    }
}
