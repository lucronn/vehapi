import { Directive, HostListener } from '@angular/core';
import { Router } from '@angular/router';

@Directive({
  selector: '[mtrHrefRouting]',
})
export class HrefRoutingDirective {
  constructor(private router: Router) {}

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent) {
    let target = event.target as Element | null;
    let href = target?.getAttribute('href');
    while (!href && target) {
      // Do not use parentElement, it is undefined for SVG elements in Internet Explorer
      target = this.isElement(target.parentNode) ? target.parentNode : null;
      href = target?.getAttribute('href');
    }
    const queryParamsAttribute = target?.getAttribute('merge-query-params');
    if (href) {
      event.preventDefault();
      if (queryParamsAttribute) {
        const queryParams = JSON.parse(queryParamsAttribute) as { [key: string]: string };
        this.router.navigate([], { queryParams, queryParamsHandling: 'merge' });
      } else if (href !== '#') {
        this.router.navigateByUrl(href);
      }
    }
  }

  isElement(obj: any): obj is Element {
    return Boolean((obj as Element | null)?.getAttribute);
  }
}
