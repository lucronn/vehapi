# API Request/Response Logging

## Overview

Verbose logging has been added to track the flow between:
1. **Frontend** → `motorApiAuthProxy` (Firebase Cloud Function)
2. **Proxy** → `sites.motor.com/m1` (Motor API)

## Logging Format

### Request Logs
```
[API REQUEST] GET 2026-01-01T18:00:00.000Z
📍 Frontend → Proxy
   URL: https://us-central1-vehapi-torque.cloudfunctions.net/motorApiAuthProxy/api/years
   Method: GET
   Proxy: https://us-central1-vehapi-torque.cloudfunctions.net/motorApiAuthProxy
   Target: sites.motor.com/m1
```

### Response Logs
```
[API RESPONSE] 2026-01-01T18:00:00.500Z
📍 Proxy → Frontend
   URL: https://us-central1-vehapi-torque.cloudfunctions.net/motorApiAuthProxy/api/years
   Status: 200 OK
   Headers: {...}
   Response Size: 1234 bytes
   Duration: 500ms
```

### Error Logs
```
[API ERROR] 2026-01-01T18:00:00.500Z
❌ Request Failed
   URL: https://us-central1-vehapi-torque.cloudfunctions.net/motorApiAuthProxy/api/years
   Status: 401 Unauthorized
   Message: Unauthorized
   Error Body: {...}
   Duration: 150ms
   Flow: Frontend → Proxy → sites.motor.com/m1
```

## Methods with Logging

The following methods now include verbose logging:

- `getYears()` - Get available years
- `getMakes(year)` - Get makes for a year
- `getModels(year, make)` - Get models for a year/make
- `decodeVin(vin)` - Decode VIN
- `getMotorVehicles()` - Get motor vehicles
- `getVehicleName()` - Get vehicle name
- `searchArticles()` - Search articles (with cache logging)
- `getArticleContent()` - Get article content
- `getArticleTitle()` - Get article title
- `getFluids()` - Get fluids

## Cache Logging

Article search results are cached. Cache hits and misses are logged:

```
[API CACHE HIT] searchArticles: MITCHELL:12345:ALL
[API CACHE SET] searchArticles: MITCHELL:12345:ALL
```

## Viewing Logs

Open the browser's Developer Console (F12) to view all API request/response logs. Logs are grouped for easy navigation.

## Adding Logging to More Methods

To add logging to additional methods, use the `getWithLogging<T>()` helper method:

```typescript
const url = `${this.baseUrl}/api/endpoint`;
return this.getWithLogging<ResponseType>(url);
```

For methods with parameters:

```typescript
const url = `${this.baseUrl}/api/endpoint`;
const params = { param1: value1 };
const startTime = performance.now();
this.logRequest('GET', url, params);

return this.http.get<ResponseType>(url, { params, observe: 'response' }).pipe(
  tap(response => {
    const duration = Math.round(performance.now() - startTime);
    const bodySize = response.body ? JSON.stringify(response.body).length : 0;
    this.logResponse(url, response.status, response.statusText, 
                     Object.fromEntries(response.headers.keys().map(key => [key, response.headers.get(key)])),
                     bodySize, duration);
  }),
  map(response => response.body as ResponseType),
  catchError(error => {
    const duration = Math.round(performance.now() - startTime);
    this.logApiError(url, error, duration);
    throw error;
  })
);
```
