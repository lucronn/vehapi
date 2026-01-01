import { Component, Input, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ProcedureStep {
  number: number;
  content: string;
  completed: boolean;
}

@Component({
  selector: 'app-procedure-stepper',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './procedure-stepper.component.html',
  styleUrls: ['./procedure-stepper.component.css']
})
export class ProcedureStepperComponent {
  @Input() steps: ProcedureStep[] = [];
  @Input() title: string = 'Procedure Steps';
  
  currentStep = signal(0);
  
  currentStepData = computed(() => {
    const step = this.steps[this.currentStep()];
    return step || null;
  });
  
  totalSteps = computed(() => this.steps.length);
  
  progress = computed(() => {
    if (this.steps.length === 0) return 0;
    return ((this.currentStep() + 1) / this.steps.length) * 100;
  });
  
  canGoNext = computed(() => this.currentStep() < this.steps.length - 1);
  canGoPrevious = computed(() => this.currentStep() > 0);
  
  nextStep() {
    if (this.canGoNext()) {
      this.currentStep.update(step => step + 1);
      this.scrollToTop();
    }
  }
  
  previousStep() {
    if (this.canGoPrevious()) {
      this.currentStep.update(step => step - 1);
      this.scrollToTop();
    }
  }
  
  goToStep(index: number) {
    if (index >= 0 && index < this.steps.length) {
      this.currentStep.set(index);
      this.scrollToTop();
    }
  }
  
  toggleStepComplete(stepIndex: number) {
    if (this.steps[stepIndex]) {
      this.steps[stepIndex].completed = !this.steps[stepIndex].completed;
    }
  }
  
  private scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
