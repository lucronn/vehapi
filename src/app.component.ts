import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet, RouterModule, Router, NavigationEnd } from '@angular/router';
import { VehiclePersistenceService } from './services/vehicle-persistence.service';
import { PersistedVehicle } from './models/motor.models';
import { LucideAngularModule, Sparkles, Brain, Home, LayoutDashboard } from 'lucide-angular';
import { GeminiService } from './services/gemini.service';
import { CommonModule } from '@angular/common';
import { AuthLoadingComponent } from './components/auth-loading/auth-loading.component';

@Component({
  selector: 'app-root',
  template: `
    <app-auth-loading></app-auth-loading>
    <main class="min-h-screen bg-black pb-[calc(4rem+var(--safe-area-bottom))]">
      <router-outlet></router-outlet>
      
      <!-- Bottom Navigation Bar -->
      <nav class="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur-md border-t border-gray-800 pb-[env(safe-area-inset-bottom)] z-50">
        <div class="flex justify-around items-center h-16">
          <a routerLink="/" 
             routerLinkActive="text-cyan-400" 
             [routerLinkActiveOptions]="{exact: true}"
             class="flex flex-col items-center justify-center w-full h-full text-gray-400 hover:text-cyan-300 transition-colors">
            <lucide-icon [img]="icons.Home" class="w-6 h-6 mb-1"></lucide-icon>
            <span class="text-xs font-medium">Home</span>
          </a>

          <!-- Dashboard Link (Enabled only if vehicle persistent) -->
          <ng-container *ngIf="lastVehicle() as vehicle">
            <a [routerLink]="['/vehicle', vehicle.contentSource, vehicle.vehicleId]" 
               routerLinkActive="text-cyan-400"
               class="flex flex-col items-center justify-center w-full h-full text-gray-400 hover:text-cyan-300 transition-colors">
              <lucide-icon [img]="icons.LayoutDashboard" class="w-6 h-6 mb-1"></lucide-icon>
              <span class="text-xs font-medium">Dashboard</span>
            </a>
          </ng-container>

          <!-- AI Toggle (Re-enabled for bottom nav) -->
          <button 
            (click)="toggleAi()"
            [class.text-cyan-400]="aiEnabled()"
            class="flex flex-col items-center justify-center w-full h-full text-gray-400 hover:text-cyan-300 transition-colors">
            <lucide-icon [img]="aiEnabled() ? icons.Sparkles : icons.Brain" class="w-6 h-6 mb-1"></lucide-icon>
            <span class="text-xs font-medium">AI: {{ aiEnabled() ? 'ON' : 'OFF' }}</span>
          </button>
        </div>
      </nav>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, CommonModule, LucideAngularModule, RouterModule, AuthLoadingComponent],
})
export class AppComponent {
  private gemini = inject(GeminiService);
  private persistence = inject(VehiclePersistenceService);
  private router = inject(Router);

  readonly icons = { Sparkles, Brain, Home, LayoutDashboard };

  aiEnabled = this.gemini.aiEnabled;
  // Simple signal/getter for the last vehicle to link to dashboard
  lastVehicle = signal<PersistedVehicle | null>(this.persistence.getVehicle());

  constructor() {
    // Update last vehicle on route changes (simple way to keep it fresh)
    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.lastVehicle.set(this.persistence.getVehicle());
      }
    });
  }

  toggleAi() {
    this.gemini.toggleAi();
  }
}
