import { BehaviorSubject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';

// TODO: Move to common

export const isNotUndefined = <T>(input: T | undefined): input is T => input !== undefined;
export const isNotNull = <T>(input: T | null): input is T => input !== null;
export const isNotNullish = <T>(input: T | null | undefined): input is T => input !== undefined && input !== null;

export const filterUndefined = () => filter(isNotUndefined);
export const filterNull = () => filter(isNotNull);
export const filterNullish = () => filter(isNotNullish);

declare module '@angular/core' {
  export interface InputDecorator {
    (bindingPropertyName?: string): PropertyDecorator;
    new (bindingPropertyName?: string): Input;
  }
  export interface HostBindingDecorator {
    (eventName: string, args?: Array<string>): PropertyDecorator;
    new (eventName: string, args?: Array<string>): HostBinding;
  }
  export interface HostListenerDecorator {
    (eventName: string, args?: Array<string>): PropertyDecorator;
    new (eventName: string, args?: Array<string>): HostListener;
  }
}

/** Provides typings to limit the argument of a behavior subject to that of an existing observable. Designed for usage in tests when creating mock observables that need to emit values. */
export function createTestObservable<T>(
  initialValue: T extends Observable<infer innerType> ? innerType : never
): BehaviorSubject<typeof initialValue> {
  return new BehaviorSubject(initialValue as any);
}

export const naturalSortCompare = new Intl.Collator(undefined, { numeric: true }).compare as (x: string | number, y: string | number) => number;

export const modelSelectorArticleIds = ['-999', '-998'];

export function readCookieValue(cookieName: string): string | undefined {
  const cookie = `; ${document.cookie}`;
  const nameSplit = cookie.split(`; ${cookieName}=`);
  if (nameSplit.length === 2) {
    const value = nameSplit.pop()!.split(';')[0];
    return decodeURIComponent(value);
  }
  return undefined;
}

export function isIE() {
  // @ts-ignore Using nonstandard documentMode to detect IE
  return document.documentMode;
}

export function detectMobile() {
  const toMatch = [/Android/i, /webOS/i, /iPhone/i, /iPad/i, /iPod/i, /BlackBerry/i, /Windows Phone/i];
  return toMatch.some((toMatchItem) => {
    return navigator.userAgent.match(toMatchItem);
  });
}
