import { Directive, OnDestroy, OnInit, inject } from '@angular/core';
import { FocusDepthService } from '../services/focus-depth.service';

/** Registers the host overlay with the global focus-depth backdrop while mounted. */
@Directive({
  selector: '[appFocusDepth]',
  standalone: true,
})
export class FocusDepthDirective implements OnInit, OnDestroy {
  private readonly depth = inject(FocusDepthService);
  private readonly id = `focus-depth-${crypto.randomUUID()}`;

  ngOnInit(): void {
    this.depth.activate(this.id);
  }

  ngOnDestroy(): void {
    this.depth.deactivate(this.id);
  }
}
