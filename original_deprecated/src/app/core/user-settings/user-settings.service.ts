import { ErrorHandler, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Observable, of } from 'rxjs';
import { catchError, map, retry, shareReplay, startWith } from 'rxjs/operators';
import { UiUserSettings } from '~/generated/api/models';
import { UiApi } from '~/generated/api/services';
import { readCookieValue } from '~/utilities';

@Injectable({ providedIn: 'root' })
export class UserSettingsService {
  readonly defaultRecentVehiclesCount = '10';

  readonly ymmeSelectorMode$: Observable<string | undefined>;
  readonly recentVehiclesMode$: Observable<string | undefined>;
  readonly recentVehiclesCount$: Observable<string>;
  readonly hamburgerMenuMode$: Observable<string | undefined>;
  readonly oemLicenseAgreement$: Observable<string | undefined>;
  readonly ymmeVinSearchMode$: Observable<string | undefined>;
  readonly loginType$: Observable<string | undefined>;
  readonly isCcc$: Observable<boolean | undefined>;
  readonly enableMotorVehicleModel$: Observable<boolean | undefined>;
  readonly splashUrl$: Observable<string | undefined>;
  readonly sessionExpiryRedirectUrl$: Observable<string | undefined>;
  readonly isMotorLogin$: Observable<boolean | undefined>;
  readonly enableApiUserLogout$: Observable<boolean | undefined>;
  readonly apiUserLogoutLabel$: Observable<string | undefined>;
  readonly apiUserLogoutURL$: Observable<string | undefined>;
  readonly feedbackMode$: Observable<string | undefined>;
  readonly feedbackLabel$: Observable<string | undefined>;
  readonly userId$: Observable<string | undefined>;
  readonly lhNavigationDefaultMode$: Observable<string | undefined>;
  readonly userSettingsPrintHeader$: Observable<UiUserSettings | undefined>;
  readonly showProcedureSilo$: Observable<boolean | undefined>;
  readonly navigateToDeltaReport$: Observable<boolean | undefined>;

  constructor(public title: Title, uiService: UiApi, errorHandler: ErrorHandler) {
    let uiUserSettings$: Observable<UiUserSettings>;

    const cookie = readCookieValue('UIUserSettings');
    if (cookie) {
      const userSettings = JSON.parse(cookie) as UiUserSettings;
      const uiSettings: UiUserSettings = {
        pageTitle: userSettings.pageTitle,
        isCcc: userSettings.isCcc,
        enableMotorVehicleModel: userSettings.enableMotorVehicleModel,
        splashUrl: userSettings.splashUrl,
        ymmeSelectorMode: userSettings.ymmeSelectorMode,
        ymmeVinSearchMode: userSettings.ymmeVinSearchMode,
        hamburgerMenuMode: userSettings.hamburgerMenuMode,
        oemLicenseAgreement: userSettings.oemLicenseAgreement,
        recentVehiclesCount: userSettings.recentVehiclesCount,
        recentVehiclesMode: userSettings.recentVehiclesMode,
        loginType: 'SharedKey',
        sessionExpirationRedirectURL: userSettings.sessionExpirationRedirectURL,
        apiUserLogoutLabel: userSettings.apiUserLogoutLabel,
        apiUserLogoutMode: userSettings.apiUserLogoutMode,
        apiUserRedirectionURL: userSettings.apiUserRedirectionURL,
        feedbackMode: userSettings.feedbackMode,
        feedbackLabel: userSettings.feedbackLabel,
        userId: userSettings.userId,
        lhNavigationDefaultMode: userSettings.lhNavigationDefaultMode,
        printEnableHeader: userSettings.printEnableHeader,
        printBannerUrl: userSettings.printBannerUrl,
        printBannerColor: userSettings.printBannerColor,
        printDisplayVehicleDetails: userSettings.printDisplayVehicleDetails,
        lhNavigationSiloDisplayMode: userSettings.lhNavigationSiloDisplayMode,
        navigateToVehicleDeltaReport: userSettings.navigateToVehicleDeltaReport,
      };
      uiUserSettings$ = of(uiSettings);
    } else {
      // Make a best effort to retry a failed response but if that fails provide some sane defaults so the application does not need to handle the case where these observables never emit. Since the cookie wasn't set we know that this is username + password login.
      uiUserSettings$ = uiService.getUserSettings().pipe(
        map((response) => response.body!),
        retry(1),
        shareReplay(),
        catchError(
          (e): Observable<UiUserSettings> => {
            errorHandler.handleError(e);
            return of({ loginType: 'MotorLogin', isCcc: false });
          }
        )
      );
    }

    this.ymmeSelectorMode$ = uiUserSettings$.pipe(map((settings) => settings.ymmeSelectorMode));
    this.recentVehiclesMode$ = uiUserSettings$.pipe(map((settings) => settings.recentVehiclesMode));
    this.recentVehiclesCount$ = uiUserSettings$.pipe(
      map((settings) => settings.recentVehiclesCount ?? this.defaultRecentVehiclesCount),
      startWith(this.defaultRecentVehiclesCount)
    );
    this.hamburgerMenuMode$ = uiUserSettings$.pipe(
      map((settings) => {
        return settings.hamburgerMenuMode === 'Enabled' || settings.loginType === 'MotorLogin' ? 'Enabled' : 'Disabled';
      })
    );
    this.oemLicenseAgreement$ = uiUserSettings$.pipe(map((settings) => settings.oemLicenseAgreement));
    this.ymmeVinSearchMode$ = uiUserSettings$.pipe(map((settings) => settings.ymmeVinSearchMode));
    this.loginType$ = uiUserSettings$.pipe(map((settings) => settings.loginType));
    this.isCcc$ = uiUserSettings$.pipe(map((settings) => settings.isCcc));
    this.enableMotorVehicleModel$ = uiUserSettings$.pipe(map((settings) => settings.enableMotorVehicleModel)); 
    this.splashUrl$ = uiUserSettings$.pipe(map((settings) => settings.splashUrl));
    this.sessionExpiryRedirectUrl$ = uiUserSettings$.pipe(map((settings) => settings.sessionExpirationRedirectURL!));
    this.isMotorLogin$ = uiUserSettings$.pipe(map((settings) => settings.loginType === 'MotorLogin'));
    this.enableApiUserLogout$ = uiUserSettings$.pipe(
      map((settings) => settings.loginType !== 'MotorLogin' && settings.apiUserLogoutMode === 'Enabled')
    );
    this.apiUserLogoutLabel$ = uiUserSettings$.pipe(map((settings) => settings.apiUserLogoutLabel!));
    this.apiUserLogoutURL$ = uiUserSettings$.pipe(map((settings) => settings.apiUserRedirectionURL!));
    this.feedbackLabel$ = uiUserSettings$.pipe(map((settings) => settings.feedbackLabel));
    this.feedbackMode$ = uiUserSettings$.pipe(map((settings) => settings.feedbackMode));
    this.userId$ = uiUserSettings$.pipe(map((settings) => settings.userId));
    this.lhNavigationDefaultMode$ = uiUserSettings$.pipe(map((settings) => settings.lhNavigationDefaultMode));
    this.userSettingsPrintHeader$ = uiUserSettings$.pipe(
      map((settings) => {
        const { printEnableHeader, printBannerUrl, printBannerColor, printDisplayVehicleDetails } = settings;
        return { printEnableHeader, printBannerUrl, printBannerColor, printDisplayVehicleDetails };
      })
    );

    uiUserSettings$.pipe(map((settings) => settings.pageTitle)).subscribe((pageTitle) => {
      if (pageTitle) {
        this.title.setTitle(pageTitle);
      }
    });

    this.showProcedureSilo$ = uiUserSettings$.pipe(
      map((settings) => {
        return settings.lhNavigationSiloDisplayMode === 'Show';
      })
    );
    this.navigateToDeltaReport$ = uiUserSettings$.pipe(
      map((settings) => {
        return settings.navigateToVehicleDeltaReport === true;
      })
    );
  }
}
