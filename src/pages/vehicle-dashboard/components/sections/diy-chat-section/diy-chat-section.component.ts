import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, inject, input, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Wrench, AlertTriangle, Send, Sparkles, X, ChevronRight, MessageSquare, History, Search } from 'lucide-angular';
import { DiyChatService, ChatMessage } from '../../../../../services/diy-chat.service';
import { L2SearchPanelComponent } from '../../layout/l2-search-panel/l2-search-panel.component';
import { TutorialComponent } from '../../../../../components/tutorial/tutorial.component';
import { TutorialStep } from '../../../../../models/motor.models';

@Component({
  selector: 'app-diy-chat-section',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    L2SearchPanelComponent,
    TutorialComponent
  ],
  templateUrl: './diy-chat-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DiyChatSectionComponent {
  private chatService = inject(DiyChatService);

  contentSource = input.required<string>();
  vehicleId = input.required<string>();

  @ViewChild('chatScrollContainer') private chatScrollContainer!: ElementRef;

  readonly icons = { Wrench, AlertTriangle, Send, Sparkles, X, ChevronRight, MessageSquare, History, Search };

  // Sub-tabs
  activeSubTab = signal<'chat' | 'search'>('chat');

  // Input text
  queryText = '';

  // Reactive state
  readonly messages = signal<ChatMessage[]>([
    {
      role: 'assistant',
      text: `Welcome to the Torque AI Advisor. I am grounded directly in this vehicle's database, meaning I have access to exact torque specs, diagnostic trouble codes (DTCs), fluid capacities, technical bulletins (TSBs), and repair procedures. \n\nHow can I help you service this vehicle today?`
    }
  ]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // Stepper state
  readonly showStepper = signal(false);
  readonly activeTutorialSteps = signal<TutorialStep[]>([]);

  // Suggestion chips
  readonly suggestions = [
    'Engine oil change procedure and capacity',
    'Spark plug torque specifications',
    'How do I diagnose fault code P0420?',
    'Front brake pad installation steps',
    'Check recent technical service bulletins (TSBs)'
  ];

  constructor() {
    // Automatically scroll to bottom when messages are appended
    effect(() => {
      if (this.messages().length) {
        this.scrollToBottom();
      }
    });
  }

  selectSuggestion(suggestion: string): void {
    if (this.loading()) return;
    this.queryText = suggestion;
    this.sendMessage();
  }

  sendMessage(): void {
    const query = this.queryText.trim();
    if (!query) return;

    if (query.length < 3) {
      this.error.set('Please enter at least 3 characters.');
      return;
    }

    this.error.set(null);
    this.queryText = '';
    this.loading.set(true);

    // Append User Message
    this.messages.update(prev => [...prev, { role: 'user', text: query }]);

    // Prepare Streaming Assistant Message
    const assistantIndex = this.messages().length;
    this.messages.update(prev => [...prev, { role: 'assistant', text: '', isStreaming: true }]);

    let streamedText = '';

    this.chatService.streamTutorial(this.vehicleId(), query).subscribe({
      next: (chunk) => {
        if (chunk.error) {
          this.error.set(chunk.error);
          this.loading.set(false);
          this.messages.update(prev => {
            const copy = [...prev];
            copy.splice(assistantIndex, 1); // remove loading assistant bubble
            return copy;
          });
          return;
        }

        if (chunk.text) {
          streamedText += chunk.text;
          this.messages.update(prev => {
            const copy = [...prev];
            copy[assistantIndex] = {
              role: 'assistant',
              text: streamedText,
              isStreaming: true
            };
            return copy;
          });
        }

        if (chunk.done) {
          this.loading.set(false);
          this.messages.update(prev => {
            const copy = [...prev];
            copy[assistantIndex] = {
              role: 'assistant',
              text: streamedText,
              isStreaming: false
            };
            return copy;
          });
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.message || 'Stream connection interrupted.');
        this.messages.update(prev => {
          const copy = [...prev];
          copy.splice(assistantIndex, 1);
          return copy;
        });
      }
    });
  }

  clearChat(): void {
    this.messages.set([
      {
        role: 'assistant',
        text: `Welcome to the Torque AI Advisor. I am grounded directly in this vehicle's database, meaning I have access to exact torque specs, diagnostic trouble codes (DTCs), fluid capacities, technical bulletins (TSBs), and repair procedures. \n\nHow can I help you service this vehicle today?`
      }
    ]);
    this.error.set(null);
    this.showStepper.set(false);
    this.activeTutorialSteps.set([]);
  }

  // Returns true if message contains what looks like a step-by-step tutorial
  hasProcedureSteps(text: string): boolean {
    if (!text) return false;
    // Simple heuristic: has a numbering list (1. or 2.) or header steps (### Step or ###)
    const hasNumbers = /\b\d+\.\s+\*\*/.test(text) || /\b\d+\.\s+[A-Z]/.test(text);
    const hasHeadings = /###\s*(?:Step|[\w\s]+)/i.test(text);
    return hasNumbers || hasHeadings;
  }

  openInteractiveStepper(text: string): void {
    const steps = this.chatService.parseMarkdownSteps(text);
    if (steps.length > 0) {
      this.activeTutorialSteps.set(steps);
      this.showStepper.set(true);
    } else {
      this.error.set('Could not extract distinct step protocols from this response.');
    }
  }

  formatMessage(text: string): string {
    if (!text) return '';
    
    let formatted = text
      .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-[var(--accent)]">$1</strong>')
      .replace(/^\s*-\s*([^\n]+)/gm, '<li class="ml-4 list-disc text-sm text-[var(--ink-soft)]">$1</li>')
      .replace(/\n\n/g, '<div class="h-3"></div>')
      .replace(/\n/g, '<br/>');

    // Grounded database facts highlighting
    formatted = formatted
      .replace(/(DTC\s+[PCBU]\d{4})/gi, '<span class="px-1.5 py-0.5 rounded text-xs font-mono bg-red-500/10 text-red-500 border border-red-500/20 font-bold">$1</span>')
      .replace(/(torque\s+spec(?:ification)?s?|torque\b)/gi, '<span class="px-1.5 py-0.5 rounded text-xs font-mono bg-accent-soft text-[var(--accent)] border border-accent/20 font-bold">$1</span>');

    return formatted;
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      try {
        if (this.chatScrollContainer) {
          const el = this.chatScrollContainer.nativeElement;
          el.scrollTop = el.scrollHeight;
        }
      } catch {}
    }, 50);
  }
}
