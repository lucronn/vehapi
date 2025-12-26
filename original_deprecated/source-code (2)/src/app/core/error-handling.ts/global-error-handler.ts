import { HttpErrorResponse } from '@angular/common/http';
import { ErrorHandler, Injectable, Injector } from '@angular/core';
import * as Bowser from 'bowser';
import { combineLatest, EMPTY } from 'rxjs';
import { catchError, map, take } from 'rxjs/operators';
import { fromError } from 'stacktrace-js';
import { ErrorLoggingApi } from '../../generated/api/services';
import { UserSettingsService } from '../user-settings/user-settings.service';

@Injectable({ providedIn: 'root' })
export class GlobalErrorHandler implements ErrorHandler {
  constructor(private errorLoggingApi: ErrorLoggingApi, private injector: Injector) {}

  lastErrorKey?: string;

  async handleError(error?: Error | { [key: string]: string } | null): Promise<void> {
    console.info(error);
    if (error instanceof HttpErrorResponse) {
      const userSettingsService = this.injector.get(UserSettingsService);
      if (error.status === 401 || error.status === 403) {
        let redirectUrl = `error?statusCode=${error.status}`;
        combineLatest([userSettingsService.sessionExpiryRedirectUrl$, userSettingsService.isMotorLogin$]).subscribe(([url, isMotorLogin]) => {
          if (!isMotorLogin && url && url !== '') {
            redirectUrl = url;
          }
        });
        document.location.href = redirectUrl;
      }
      return;
    }

    const name = error?.name ?? 'Malformed Javascript Error';
    const message = error?.message ?? JSON.stringify(error);
    const stack = error?.stack;

    const errorKey = `${name}${message}${stack}`;
    if (errorKey === this.lastErrorKey) {
      // Avoid spamming logs if there is an error loop
      return;
    }
    this.lastErrorKey = errorKey;

    let sourceMappedStackTrace;
    if (stack) {
      const stackFrames = await fromError(error as Error);
      sourceMappedStackTrace = stackFrames
        .map((frame) => `${frame.functionName} - ${frame.fileName?.replace('webpack:///', '')}:${frame.lineNumber}:${frame.columnNumber}`)
        .join('\n');
    }

    this.errorLoggingApi
      .logError({
        body: {
          body: sourceMappedStackTrace ?? 'No stack trace available.',
          level: 'Error',
          subject: `[(Javascript) ${name}] ${message}`,
          extendedProperties: [
            { name: 'Application Url', value: window.location.href },
            { name: 'Browser Info', value: JSON.stringify(Bowser.parse(window.navigator.userAgent), null, 2) },
          ],
        },
      })
      .pipe(catchError((_) => EMPTY))
      .subscribe();
  }
}
