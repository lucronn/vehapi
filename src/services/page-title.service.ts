import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';

const APP_NAME = 'TORQUE.AI';

@Injectable({ providedIn: 'root' })
export class PageTitleService {
    private title = inject(Title);

    set(pageTitle?: string): void {
        this.title.setTitle(pageTitle ? `${pageTitle} — ${APP_NAME}` : `${APP_NAME} — Vehicle Intelligence`);
    }

    setVehicle(vehicleName: string, section?: string): void {
        const parts = [vehicleName];
        if (section) parts.push(section);
        parts.push(APP_NAME);
        this.title.setTitle(parts.join(' — '));
    }
}
