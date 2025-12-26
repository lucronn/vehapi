import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Observable } from 'rxjs';
import { defaultIfEmpty, map, take } from 'rxjs/operators';
import { UserSettingsService } from '~/core/user-settings/user-settings.service';

@Injectable({ providedIn: 'root' })
export class DeltaReportGuard implements CanActivate {
  constructor(private userSettingsService: UserSettingsService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean | UrlTree> {
    return this.userSettingsService.navigateToDeltaReport$.pipe(
      map((v): boolean => !!v),
      take(1),
      defaultIfEmpty(false),
      map((allowed) =>
        allowed
          ? true
          : this.router.createUrlTree(['/vehicles'], {
              queryParams: { redirectUrl: state.url },
            })
      )
    );
  }
}
