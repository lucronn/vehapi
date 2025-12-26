import { Injectable } from "@angular/core";
import { CanActivate } from "@angular/router";


interface LogoutData {
    apiUserLoggedOut: boolean;
  }
  
  @Injectable({
    providedIn: 'root',
  })
  export class APIUserLogoutGuard implements CanActivate {
    constructor() {}
  
    canActivate(): boolean {
      const logoutData = sessionStorage.getItem('apiUserLogOutData');
      if (logoutData) {
        const cookie = JSON.parse(logoutData) as LogoutData;
        if (cookie.apiUserLoggedOut === true) {
          document.location.href = `error?statusCode=401`;
          return false;
        }
      }
  
      return true;
    }
  }