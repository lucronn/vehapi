import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataSyncService } from '../../../../../services/data-sync.service';
import { LucideAngularModule, Loader2, Database, ShieldCheck } from 'lucide-angular';
import { animate, style, transition, trigger } from '@angular/animations';

@Component({
    selector: 'app-sync-progress-overlay',
    standalone: true,
    imports: [CommonModule, LucideAngularModule],
    template: `
    <div 
      *ngIf="dataSync.isSyncing()" 
      class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-md"
      @fadeInOut
    >
      <div class="max-w-md w-full mx-4 p-8 rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-white/20 dark:border-slate-800 text-center space-y-6">
        
        <!-- Icon/Animation Layer -->
        <div class="relative w-24 h-24 mx-auto flex items-center justify-center">
            <div class="absolute inset-0 rounded-full border-4 border-blue-500/10 dark:border-blue-400/10"></div>
            <div 
                class="absolute inset-0 rounded-full border-4 border-blue-500 dark:border-blue-400 border-t-transparent animate-spin"
                [style.animation-duration]="'1.5s'"
            ></div>
            <i-lucide [name]="dataSync.syncProgress().current === 100 ? 'shield-check' : 'database'" 
                class="w-10 h-10 text-blue-500 dark:text-blue-400"
                [class.animate-pulse]="dataSync.syncProgress().current < 100"
            ></i-lucide>
        </div>

        <div class="space-y-2">
            <h2 class="text-2xl font-bold text-slate-900 dark:text-white">Normalizing Data</h2>
            <p class="text-slate-500 dark:text-slate-400">Optimizing vehicle data for faster access.</p>
        </div>

        <!-- Progress Bar -->
        <div class="space-y-2">
            <div class="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden shadow-inner">
                <div 
                    class="h-full bg-gradient-to-r from-blue-600 to-indigo-500 transition-all duration-500 ease-out shadow-[0_0_15px_rgba(59,130,246,0.5)]"
                    [style.width.%]="dataSync.syncProgress().current"
                ></div>
            </div>
            <div class="flex justify-between text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <span>{{ dataSync.syncProgress().message }}</span>
                <span class="text-blue-500 dark:text-blue-400">{{ dataSync.syncProgress().current }}%</span>
            </div>
        </div>

        <div class="pt-4 border-t border-slate-100 dark:border-slate-800">
            <p class="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-bold">
                A one-time process for lightning fast loading
            </p>
        </div>
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
}
