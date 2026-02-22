
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CreditsService } from '../../services/credits.service';
import { LucideAngularModule, CreditCard, ArrowLeft, Plus } from 'lucide-angular';

@Component({
  selector: 'app-credits-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  template: `
    <div class="min-h-screen bg-black/90 text-white font-sans selection:bg-torque-cyan/30">
      <!-- Background Effects -->
      <div class="fixed inset-0 pointer-events-none">
        <div class="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-torque-cyan/5 to-transparent"></div>
        <div class="absolute bottom-0 right-0 w-[500px] h-[500px] bg-torque-purple/5 rounded-full blur-[100px]"></div>
      </div>

      <div class="relative z-10 max-w-4xl mx-auto px-6 py-12">
        <!-- Header -->
        <header class="mb-12">
          <a routerLink="/" class="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-6 group">
            <lucide-icon [img]="ArrowLeft" class="w-4 h-4 group-hover:-translate-x-1 transition-transform"></lucide-icon>
            Back to Home
          </a>
          <h1 class="text-4xl font-bold mb-2">Credits Dashboard</h1>
          <p class="text-gray-400">Manage your credits and unlock premium vehicle data.</p>
        </header>

        <!-- Balance Card -->
        <div class="bg-white/[0.03] border border-white/10 rounded-2xl p-8 mb-12 backdrop-blur-sm">
          <div class="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div>
              <h2 class="text-sm font-medium text-gray-400 uppercase tracking-wider mb-1">Current Balance</h2>
              <div class="flex items-baseline gap-2">
                <span class="text-5xl font-mono font-bold text-white">{{ creditsService.balance() }}</span>
                <span class="text-xl text-torque-cyan font-mono">CR</span>
              </div>
            </div>
            <div class="p-4 bg-torque-cyan/10 rounded-xl border border-torque-cyan/20">
              <lucide-icon [img]="CreditCard" class="w-8 h-8 text-torque-cyan"></lucide-icon>
            </div>
          </div>
        </div>

        <!-- Purchase Options -->
        <h2 class="text-xl font-bold mb-6">Purchase Credits</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <!-- Starter Pack -->
          <button
            (click)="purchase(1000)"
            [disabled]="creditsService.isLoading()"
            class="group relative overflow-hidden bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 hover:border-torque-cyan/50 rounded-xl p-6 transition-all duration-300 text-left">
            <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <lucide-icon [img]="Plus" class="w-12 h-12"></lucide-icon>
            </div>
            <h3 class="text-lg font-bold mb-2">Starter Pack</h3>
            <div class="text-3xl font-mono font-bold text-torque-cyan mb-4">1,000 CR</div>
            <div class="text-sm text-gray-400 mb-6">Good for unlocking full specs on multiple vehicles.</div>
            <div class="flex items-center justify-between mt-auto">
              <span class="text-lg font-bold">$10.00</span>
              <span class="text-xs uppercase tracking-wider font-bold bg-white/10 px-3 py-1 rounded-full group-hover:bg-torque-cyan group-hover:text-black transition-colors">Buy Now</span>
            </div>
          </button>

          <!-- Standard Pack -->
          <button
            (click)="purchase(2500)"
            [disabled]="creditsService.isLoading()"
            class="group relative overflow-hidden bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 hover:border-torque-cyan/50 rounded-xl p-6 transition-all duration-300 text-left">
            <div class="absolute inset-0 bg-gradient-to-tr from-torque-cyan/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <lucide-icon [img]="Plus" class="w-12 h-12"></lucide-icon>
            </div>
            <div class="relative z-10">
              <h3 class="text-lg font-bold mb-2">Standard Pack</h3>
              <div class="text-3xl font-mono font-bold text-torque-cyan mb-4">2,500 CR</div>
              <div class="text-sm text-gray-400 mb-6">Best value for enthusiasts working on complex diagnostics.</div>
              <div class="flex items-center justify-between mt-auto">
                <span class="text-lg font-bold">$25.00</span>
                <span class="text-xs uppercase tracking-wider font-bold bg-white/10 px-3 py-1 rounded-full group-hover:bg-torque-cyan group-hover:text-black transition-colors">Buy Now</span>
              </div>
            </div>
          </button>

          <!-- Pro Pack -->
          <button
            (click)="purchase(5000)"
            [disabled]="creditsService.isLoading()"
            class="group relative overflow-hidden bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 hover:border-torque-purple/50 rounded-xl p-6 transition-all duration-300 text-left">
             <div class="absolute inset-0 bg-gradient-to-tr from-torque-purple/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <lucide-icon [img]="Plus" class="w-12 h-12"></lucide-icon>
            </div>
            <div class="relative z-10">
              <h3 class="text-lg font-bold mb-2">Pro Pack</h3>
              <div class="text-3xl font-mono font-bold text-torque-purple mb-4">5,000 CR</div>
              <div class="text-sm text-gray-400 mb-6">For professionals who need full access to many vehicles.</div>
              <div class="flex items-center justify-between mt-auto">
                <span class="text-lg font-bold">$50.00</span>
                <span class="text-xs uppercase tracking-wider font-bold bg-white/10 px-3 py-1 rounded-full group-hover:bg-torque-purple group-hover:text-white transition-colors">Buy Now</span>
              </div>
            </div>
          </button>
        </div>

        <!-- Usage Info -->
        <div class="mt-12 pt-12 border-t border-white/10 text-center text-gray-500 text-sm">
          <p>Secure payments processed via Stripe. All purchases are final.</p>
        </div>
      </div>
    </div>
  `
})
export class CreditsDashboardComponent {
  readonly creditsService = inject(CreditsService);
  readonly CreditCard = CreditCard;
  readonly ArrowLeft = ArrowLeft;
  readonly Plus = Plus;

  purchase(amount: number) {
    this.creditsService.startCheckout(amount);
  }
}
