import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataSyncService } from '../../../../../services/data-sync.service';
import { LucideAngularModule, Database, ShieldCheck } from 'lucide-angular';
import { animate, style, transition, trigger } from '@angular/animations';

@Component({
    selector: 'app-sync-progress-overlay',
    standalone: true,
    imports: [CommonModule, LucideAngularModule],
    template: `
    <div
      *ngIf="dataSync.isSyncing()"
      class="fixed bottom-4 right-4 z-50 w-80 p-4 rounded-2xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-700/60 space-y-3"
      @fadeInOut
    >
      <div class="flex items-center gap-3">
        <div class="relative w-8 h-8 flex-shrink-0 flex items-center justify-center">
          <div
            class="absolute inset-0 rounded-full border-2 border-blue-500 dark:border-blue-400 border-t-transparent animate-spin"
            *ngIf="dataSync.syncProgress().current < 100"
          ></div>
          <lucide-icon
            [img]="dataSync.syncProgress().current === 100 ? icons.ShieldCheck : icons.Database"
            class="w-4 h-4 text-blue-500 dark:text-blue-400"
          ></lucide-icon>
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">Syncing data</p>
          <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ dataSync.syncProgress().message }}</p>
        </div>
        <span class="text-xs font-bold text-blue-500 dark:text-blue-400">{{ dataSync.syncProgress().current }}%</span>
      </div>
      <div class="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div
          class="h-full bg-gradient-to-r from-blue-600 to-indigo-500 transition-all duration-500 ease-out"
          [style.width.%]="dataSync.syncProgress().current"
        ></div>
      </div>
    </div>
  `,
    animations: [
        trigger('fadeInOut', [
            transition(':enter', [
                style({ opacity: 0, scale: 0.95 }),
                animate('300ms ease-out', style({ opacity: 1, scale: 1 }))
            ]),
            transition(':leave', [
                animate('200ms ease-in', style({ opacity: 0, scale: 0.95 }))
            ])
        ])
    ]
})
export class SyncProgressOverlayComponent {
    public dataSync = inject(DataSyncService);
    readonly icons = { Database, ShieldCheck };
}
