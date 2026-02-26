
import { Component, inject, computed, signal, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { CreditsService, Transaction } from '../../services/credits.service';
import { AuthService } from '../../services/auth.service';
import {
  LucideAngularModule,
  CreditCard, ArrowLeft, Plus, Car, Receipt, User,
  Check, Clock, ChevronRight, Sparkles, Home, Lock,
  LayoutDashboard
} from 'lucide-angular';

type Tab = 'overview' | 'vehicles' | 'receipts' | 'buy';

// Module display labels
const MODULE_LABELS: Record<string, string> = {
  specs: 'Specifications',
  fluids: 'Fluids',
  maintenance: 'Maintenance',
  dtcs: 'Diagnostic Codes',
  tsbs: 'TSBs',
  procedures: 'Procedures',
  diagrams: 'Wiring Diagrams',
  parts: 'Parts',
  full: 'Full Access',
};

@Component({
  selector: 'app-credits-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  template: `
    <div class="min-h-screen bg-[#0a0a0f] text-white font-sans">
      <!-- Ambient Background -->
      <div class="fixed inset-0 pointer-events-none">
        <div class="absolute top-0 left-0 w-full h-[600px] bg-gradient-to-b from-torque-cyan/4 to-transparent"></div>
        <div class="absolute bottom-0 right-0 w-[600px] h-[600px] bg-torque-purple/4 rounded-full blur-[120px]"></div>
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-torque-cyan/2 rounded-full blur-[200px]"></div>
      </div>

      <div class="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 py-10">

        <!-- Back Nav -->
        <a routerLink="/" class="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-torque-cyan transition-colors mb-8 group">
          <lucide-icon [img]="icons.ArrowLeft" class="w-4 h-4 group-hover:-translate-x-1 transition-transform"></lucide-icon>
          Back to Home
        </a>

        <!-- Header -->
        <header class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <p class="text-xs text-torque-cyan uppercase tracking-widest font-semibold mb-1">Account</p>
            <h1 class="text-3xl sm:text-4xl font-bold">
              {{ authService.user()?.email ?? 'My Account' }}
            </h1>
          </div>
          <!-- Credit Balance Pill -->
          <div class="flex items-center gap-3 bg-white/[0.04] border border-white/10 rounded-2xl px-5 py-3">
            <lucide-icon [img]="icons.CreditCard" class="w-5 h-5 text-torque-cyan"></lucide-icon>
            <div>
              <p class="text-xs text-gray-400">Credits</p>
              <p class="text-2xl font-mono font-bold text-white">{{ creditsService.balance() }}</p>
            </div>
          </div>
        </header>

        <!-- Purchase success banner -->
        @if (purchaseSuccess()) {
        <div class="mb-6 flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-5 py-4 text-emerald-400">
          <lucide-icon [img]="icons.Check" class="w-5 h-5 flex-shrink-0"></lucide-icon>
          <span class="font-medium">Payment successful! Your credits have been added.</span>
        </div>
        }

        <!-- Tabs -->
        <div class="flex gap-1 bg-white/[0.03] border border-white/[0.06] rounded-xl p-1 mb-8 overflow-x-auto">
          @for (tab of tabs; track tab.id) {
          <button
            (click)="activeTab.set(tab.id)"
            [class.bg-white]="activeTab() === tab.id"
            [class.text-black]="activeTab() === tab.id"
            [class.font-semibold]="activeTab() === tab.id"
            class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm whitespace-nowrap transition-all duration-200 text-gray-400 hover:text-white">
            <lucide-icon [img]="tab.icon" class="w-4 h-4"></lucide-icon>
            {{ tab.label }}
          </button>
          }
        </div>

        <!-- ══════════════════════ OVERVIEW TAB ══════════════════════ -->
        @if (activeTab() === 'overview') {
        <div class="space-y-6 animate-fade-in-up">

          <!-- Stats row -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
              <p class="text-xs text-gray-500 mb-1">Balance</p>
              <p class="text-2xl font-mono font-bold text-torque-cyan">{{ creditsService.balance() }}</p>
              <p class="text-xs text-gray-600 mt-1">credits</p>
            </div>
            <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
              <p class="text-xs text-gray-500 mb-1">Vehicles</p>
              <p class="text-2xl font-mono font-bold">{{ unlockedVehicleCount() }}</p>
              <p class="text-xs text-gray-600 mt-1">unlocked</p>
            </div>
            <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
              <p class="text-xs text-gray-500 mb-1">Purchases</p>
              <p class="text-2xl font-mono font-bold">{{ purchaseCount() }}</p>
              <p class="text-xs text-gray-600 mt-1">transactions</p>
            </div>
            <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
              <p class="text-xs text-gray-500 mb-1">Total Spent</p>
              <p class="text-2xl font-mono font-bold">\${{ totalSpent() }}</p>
              <p class="text-xs text-gray-600 mt-1">lifetime</p>
            </div>
          </div>

          <!-- Quick buy -->
          <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl p-6">
            <h2 class="font-semibold text-gray-300 mb-4">Top Up Credits</h2>
            <div class="grid grid-cols-3 gap-3">
              @for (pack of creditPacks; track pack.credits) {
              <button
                (click)="purchase(pack.credits)"
                [disabled]="creditsService.isLoading()"
                class="group relative overflow-hidden bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.08] hover:border-torque-cyan/40 rounded-xl p-4 transition-all duration-200 text-left">
                <p class="text-sm text-gray-400 mb-1">{{ pack.label }}</p>
                <p class="text-xl font-mono font-bold text-torque-cyan">{{ pack.credits | number }}</p>
                <p class="text-xs text-gray-500 mt-1">\${{ pack.price }}</p>
              </button>
              }
            </div>
          </div>

          <!-- Recent transactions preview -->
          @if (creditsService.transactions().length > 0) {
          <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl p-6">
            <div class="flex items-center justify-between mb-4">
              <h2 class="font-semibold text-gray-300">Recent Activity</h2>
              <button (click)="activeTab.set('receipts')" class="text-xs text-torque-cyan hover:underline">View All</button>
            </div>
            <div class="space-y-3">
              @for (txn of recentTransactions(); track txn.id) {
              <div class="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                <div class="flex items-center gap-3">
                  <div [class]="txn.amount > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-orange-500/10 text-orange-400'"
                    class="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold">
                    {{ txn.amount > 0 ? '+' : '−' }}
                  </div>
                  <div>
                    <p class="text-sm font-medium">{{ txnLabel(txn) }}</p>
                    <p class="text-xs text-gray-500">{{ txn.created_at | date:'MMM d, y' }}</p>
                  </div>
                </div>
                <span [class]="txn.amount > 0 ? 'text-emerald-400' : 'text-orange-400'" class="font-mono text-sm font-semibold">
                  {{ txn.amount > 0 ? '+' : '' }}{{ txn.amount }} CR
                </span>
              </div>
              }
            </div>
          </div>
          }
        </div>
        }

        <!-- ══════════════════════ MY VEHICLES TAB ══════════════════════ -->
        @if (activeTab() === 'vehicles') {
        <div class="animate-fade-in-up">
          @if (unlockedVehicles().length === 0) {
          <div class="flex flex-col items-center justify-center py-20 text-center">
            <div class="w-16 h-16 bg-white/[0.04] rounded-2xl flex items-center justify-center mb-4">
              <lucide-icon [img]="icons.Car" class="w-8 h-8 text-gray-500"></lucide-icon>
            </div>
            <h3 class="text-lg font-semibold mb-2">No vehicles unlocked yet</h3>
            <p class="text-gray-500 text-sm max-w-xs mb-6">
              When you unlock modules for a vehicle, it will appear here with a summary of your access.
            </p>
            <a routerLink="/" class="px-5 py-2 bg-torque-cyan text-black text-sm font-bold rounded-full hover:bg-torque-cyan/90 transition-colors">
              Search Vehicles
            </a>
          </div>
          } @else {
          <div class="space-y-4">
            @for (vehicle of unlockedVehicles(); track vehicle.vehicleId) {
            <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 hover:border-white/[0.12] transition-colors">
              <div class="flex items-start justify-between gap-4">
                <div class="flex items-center gap-4">
                  <div class="w-10 h-10 bg-torque-cyan/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <lucide-icon [img]="icons.Car" class="w-5 h-5 text-torque-cyan"></lucide-icon>
                  </div>
                  <div>
                    <p class="font-semibold">{{ vehicle.vehicleName || vehicle.vehicleId }}</p>
                    <p class="text-xs text-gray-500 mt-0.5">ID: {{ vehicle.vehicleId }}</p>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2 justify-end">
                  @for (mod of vehicle.modules; track mod) {
                  <span class="text-xs bg-torque-cyan/10 text-torque-cyan border border-torque-cyan/20 px-2.5 py-1 rounded-full font-medium">
                    {{ moduleLabel(mod) }}
                  </span>
                  }
                </div>
              </div>
            </div>
            }
          </div>
          }
        </div>
        }

        <!-- ══════════════════════ RECEIPTS TAB ══════════════════════ -->
        @if (activeTab() === 'receipts') {
        <div class="animate-fade-in-up">
          @if (creditsService.transactionsLoading()) {
          <div class="space-y-3">
            @for (i of [1,2,3,4,5]; track i) {
            <div class="h-16 bg-white/[0.03] rounded-xl animate-pulse"></div>
            }
          </div>
          } @else if (creditsService.transactions().length === 0) {
          <div class="flex flex-col items-center justify-center py-20 text-center">
            <div class="w-16 h-16 bg-white/[0.04] rounded-2xl flex items-center justify-center mb-4">
              <lucide-icon [img]="icons.Receipt" class="w-8 h-8 text-gray-500"></lucide-icon>
            </div>
            <h3 class="text-lg font-semibold mb-2">No transactions yet</h3>
            <p class="text-gray-500 text-sm">Your credit purchases and unlock history will appear here.</p>
          </div>
          } @else {
          <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-white/[0.06]">
                  <th class="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Date</th>
                  <th class="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Description</th>
                  <th class="text-right text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Amount</th>
                  <th class="text-right text-xs text-gray-500 uppercase tracking-wider px-5 py-3 hidden sm:table-cell">USD</th>
                </tr>
              </thead>
              <tbody>
                @for (txn of creditsService.transactions(); track txn.id) {
                <tr class="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
                  <td class="px-5 py-4 text-gray-400 whitespace-nowrap">{{ txn.created_at | date:'MMM d, y' }}</td>
                  <td class="px-5 py-4">
                    <p class="font-medium text-white">{{ txnLabel(txn) }}</p>
                    @if (txn.stripe_session_id) {
                    <p class="text-xs text-gray-600 mt-0.5 font-mono truncate max-w-[200px]">{{ txn.stripe_session_id }}</p>
                    }
                  </td>
                  <td class="px-5 py-4 text-right font-mono font-semibold whitespace-nowrap"
                    [class.text-emerald-400]="txn.amount > 0"
                    [class.text-orange-400]="txn.amount < 0">
                    {{ txn.amount > 0 ? '+' : '' }}{{ txn.amount }} CR
                  </td>
                  <td class="px-5 py-4 text-right text-gray-400 hidden sm:table-cell whitespace-nowrap">
                    {{ txn.usd_cents ? ('$' + (txn.usd_cents / 100 | number:'1.2-2')) : '—' }}
                  </td>
                </tr>
                }
              </tbody>
            </table>
          </div>
          }
        </div>
        }

        <!-- ══════════════════════ BUY CREDITS TAB ══════════════════════ -->
        @if (activeTab() === 'buy') {
        <div class="animate-fade-in-up">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">

            <!-- Starter -->
            <button (click)="purchase(1000)" [disabled]="creditsService.isLoading()"
              class="group relative overflow-hidden bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] hover:border-torque-cyan/40 rounded-2xl p-6 transition-all duration-300 text-left">
              <div class="absolute inset-0 bg-gradient-to-br from-torque-cyan/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div class="relative z-10">
                <p class="text-sm text-gray-400 mb-1">Starter</p>
                <p class="text-4xl font-mono font-bold text-torque-cyan mb-1">1,000</p>
                <p class="text-sm text-gray-500 mb-5">credits</p>
                <p class="text-xs text-gray-500 mb-6">Good for unlocking full specs on multiple vehicles.</p>
                <div class="flex items-center justify-between">
                  <span class="text-xl font-bold">$10.00</span>
                  <span class="text-xs uppercase tracking-wider font-bold bg-white/10 px-3 py-1.5 rounded-full group-hover:bg-torque-cyan group-hover:text-black transition-colors">Buy Now</span>
                </div>
              </div>
            </button>

            <!-- Standard — Popular badge -->
            <button (click)="purchase(2500)" [disabled]="creditsService.isLoading()"
              class="group relative overflow-hidden bg-white/[0.03] hover:bg-white/[0.06] border border-torque-cyan/30 hover:border-torque-cyan/60 rounded-2xl p-6 transition-all duration-300 text-left ring-1 ring-torque-cyan/10">
              <div class="absolute top-4 right-4 text-xs bg-torque-cyan text-black font-bold px-2.5 py-0.5 rounded-full">Popular</div>
              <div class="absolute inset-0 bg-gradient-to-br from-torque-cyan/8 to-transparent opacity-60 group-hover:opacity-100 transition-opacity"></div>
              <div class="relative z-10">
                <p class="text-sm text-gray-400 mb-1">Standard</p>
                <p class="text-4xl font-mono font-bold text-torque-cyan mb-1">2,500</p>
                <p class="text-sm text-gray-500 mb-5">credits</p>
                <p class="text-xs text-gray-500 mb-6">Best value for enthusiasts working on complex diagnostics.</p>
                <div class="flex items-center justify-between">
                  <span class="text-xl font-bold">$25.00</span>
                  <span class="text-xs uppercase tracking-wider font-bold bg-torque-cyan/20 text-torque-cyan px-3 py-1.5 rounded-full group-hover:bg-torque-cyan group-hover:text-black transition-colors">Buy Now</span>
                </div>
              </div>
            </button>

            <!-- Pro -->
            <button (click)="purchase(5000)" [disabled]="creditsService.isLoading()"
              class="group relative overflow-hidden bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] hover:border-torque-purple/50 rounded-2xl p-6 transition-all duration-300 text-left">
              <div class="absolute inset-0 bg-gradient-to-br from-torque-purple/8 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div class="relative z-10">
                <p class="text-sm text-gray-400 mb-1">Pro</p>
                <p class="text-4xl font-mono font-bold text-torque-purple mb-1">5,000</p>
                <p class="text-sm text-gray-500 mb-5">credits</p>
                <p class="text-xs text-gray-500 mb-6">For professionals who need full access across many vehicles.</p>
                <div class="flex items-center justify-between">
                  <span class="text-xl font-bold">$50.00</span>
                  <span class="text-xs uppercase tracking-wider font-bold bg-white/10 px-3 py-1.5 rounded-full group-hover:bg-torque-purple group-hover:text-white transition-colors">Buy Now</span>
                </div>
              </div>
            </button>
          </div>

          <!-- Cost breakdown -->
          <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl p-6">
            <h3 class="font-semibold text-gray-300 mb-4">Credit Usage</h3>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
              @for (item of costItems; track item.label) {
              <div class="text-center">
                <p class="text-lg font-mono font-bold text-torque-cyan">{{ item.cost }} CR</p>
                <p class="text-xs text-gray-500 mt-1">{{ item.label }}</p>
              </div>
              }
            </div>
            <p class="text-xs text-gray-600 mt-6 text-center">Secure payments via Stripe. All purchases are final.</p>
          </div>
        </div>
        }

      </div>
    </div>
  `
})
export class CreditsDashboardComponent implements OnInit {
  readonly creditsService = inject(CreditsService);
  readonly authService = inject(AuthService);
  readonly route = inject(ActivatedRoute);

  readonly icons = { CreditCard, ArrowLeft, Plus, Car, Receipt, User, Check, Clock, ChevronRight, Sparkles, Home, Lock, LayoutDashboard };

  activeTab = signal<Tab>('overview');
  purchaseSuccess = signal(false);

  readonly tabs = [
    { id: 'overview' as Tab, label: 'Overview', icon: LayoutDashboard },
    { id: 'vehicles' as Tab, label: 'My Vehicles', icon: Car },
    { id: 'receipts' as Tab, label: 'Receipts', icon: Receipt },
    { id: 'buy' as Tab, label: 'Buy Credits', icon: Plus },
  ];

  readonly creditPacks = [
    { credits: 1000, price: '10.00', label: 'Starter' },
    { credits: 2500, price: '25.00', label: 'Standard' },
    { credits: 5000, price: '50.00', label: 'Pro' },
  ];

  readonly costItems = [
    { cost: 5, label: 'Specs / Fluids' },
    { cost: 5, label: 'DTCs / TSBs' },
    { cost: 10, label: 'Procedures' },
    { cost: 10, label: 'Diagrams / Parts' },
    { cost: 25, label: 'Full Vehicle Access' },
  ];

  // Computed unlocked vehicles list
  unlockedVehicles = computed(() => {
    const txns = this.creditsService.transactions();
    const unlocks = this.creditsService.unlocks();
    // Build name lookup from transactions
    const vehicleNames: Record<string, string> = {};
    txns.forEach(t => {
      if (t.vehicle_id && t.vehicle_name) {
        vehicleNames[t.vehicle_id] = t.vehicle_name;
      }
    });
    return Object.entries(unlocks).map(([vehicleId, modules]) => ({
      vehicleId,
      vehicleName: vehicleNames[vehicleId] || '',
      modules: modules as string[]
    }));
  });

  unlockedVehicleCount = computed(() => this.unlockedVehicles().length);

  purchaseCount = computed(() =>
    this.creditsService.transactions().filter(t => t.type === 'purchase').length
  );

  totalSpent = computed(() => {
    const cents = this.creditsService.transactions()
      .filter(t => t.type === 'purchase' && t.usd_cents)
      .reduce((sum, t) => sum + (t.usd_cents ?? 0), 0);
    return (cents / 100).toFixed(2);
  });

  recentTransactions = computed(() => this.creditsService.transactions().slice(0, 5));

  ngOnInit() {
    // Handle Stripe redirect params
    this.route.queryParams.subscribe(params => {
      if (params['purchase'] === 'success') {
        this.purchaseSuccess.set(true);
        this.creditsService.refreshBalance();
        this.creditsService.fetchTransactions();
        // Auto-dismiss after 5s
        setTimeout(() => this.purchaseSuccess.set(false), 5000);
      }
    });

    // Start on receipts tab if coming from a purchase flow
    this.creditsService.fetchTransactions();
  }

  purchase(amount: number) {
    this.creditsService.startCheckout(amount);
  }

  moduleLabel(mod: string): string {
    return MODULE_LABELS[mod] ?? mod;
  }

  txnLabel(txn: Transaction): string {
    if (txn.type === 'purchase') {
      return `Purchased ${txn.amount.toLocaleString()} Credits`;
    }
    if (txn.type === 'unlock') {
      const mod = MODULE_LABELS[txn.module_type ?? ''] ?? txn.module_type ?? 'Module';
      const veh = txn.vehicle_name || txn.vehicle_id || 'Vehicle';
      return `Unlocked ${mod} — ${veh}`;
    }
    return txn.type.charAt(0).toUpperCase() + txn.type.slice(1);
  }
}
