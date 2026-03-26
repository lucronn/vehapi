import { ErrorHandler, Injectable, isDevMode } from '@angular/core';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
    handleError(error: unknown): void {
        // Always suppress AbortError (intentional fetch cancellation)
        if (this.isAbortError(error)) return;

        // In dev, log full error for debugging
        if (isDevMode()) {
            console.error('[GlobalErrorHandler]', error);
            return;
        }

        // In production, log a concise message (no stack trace noise)
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Torque] ${message}`);
    }

    private isAbortError(error: unknown): boolean {
        if (error instanceof DOMException && error.name === 'AbortError') return true;
        if (error instanceof Error && error.message?.includes('user aborted')) return true;
        // Angular wraps errors — check the rejection property
        const inner = (error as { rejection?: unknown })?.rejection;
        if (inner instanceof DOMException && inner.name === 'AbortError') return true;
        return false;
    }
}
