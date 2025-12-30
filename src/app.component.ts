import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { GeminiService } from './services/gemini.service';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Sparkles, Brain } from 'lucide-angular';

@Component({
  selector: 'app-root',
  template: `
    <main class="min-h-screen bg-black">
      <router-outlet></router-outlet>
      
      <!-- TEMPORARILY DISABLED: AI Toggle (AI features disabled) -->
      <!-- <button 
        (click)="toggleAi()"
        class="fixed bottom-4 left-4 z-50 flex items-center gap-2 px-4 py-2 rounded-full font-bold shadow-lg transition-all duration-300 transform hover:scale-105"
        [ngClass]="{
          'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-cyan-500/50': aiEnabled(),
          'bg-gray-800 text-gray-400 border border-gray-700': !aiEnabled()
        }">
        <lucide-icon [img]="aiEnabled() ? icons.Sparkles : icons.Brain" class="w-4 h-4"></lucide-icon>
        <span>AI: {{ aiEnabled() ? 'ON' : 'OFF' }}</span>
      </button> -->
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, CommonModule, LucideAngularModule],
})
export class AppComponent {
  private gemini = inject(GeminiService);
  readonly icons = { Sparkles, Brain };

  aiEnabled = this.gemini.aiEnabled;

  toggleAi() {
    this.gemini.toggleAi();
  }
}
