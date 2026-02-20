# Proxy Update Instructions

## Overview
This document outlines the updates needed for the Motor API proxy to work with the new OpenAPI specification and connect to the Motor.com connector.

## OpenAPI Specification
- **File**: `openapi.json` (updated)
- **Server URL**: `https://us-central1-vehapi-torque.cloudfunctions.net/motorApiAuthProxy`
- The OpenAPI spec has been updated with the motorproxy URL

## Proxy Configuration Updates Required

### Target URL Update
The proxy function needs to be updated to forward requests to:
```
https://sites.motor.com/m1/connector
```

### Current Setup
- **Proxy Function**: `motorApiAuthProxy` (Firebase Cloud Function)
- **Current Base URL in Service**: `https://us-central1-vehapi-torque.cloudfunctions.net/motorApiAuthProxy`
- **Target**: `sites.motor.com/m1/connector`

### Required Changes in Proxy Function

If the proxy is a Firebase Cloud Function, update it to:

1. **Forward requests to Motor.com connector**:
   ```javascript
   const targetUrl = 'https://sites.motor.com/m1/connector';
   ```

2. **Handle authentication**:
   - The proxy should handle authentication with Motor.com
   - Pass through necessary headers and cookies
   - Handle connector authentication as documented in the login flow

3. **Path forwarding**:
   - Forward `/api/*` paths to the Motor.com connector
   - Example: `/api/years` → `https://sites.motor.com/m1/connector/api/years`

4. **CORS configuration**:
   - Ensure CORS headers are properly set for the frontend

### Example Proxy Implementation (pseudo-code)

```javascript
exports.motorApiAuthProxy = functions.https.onRequest(async (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  // Construct target URL
  const targetUrl = `https://sites.motor.com/m1/connector${req.url}`;
  
  // Forward request to Motor.com connector
  // Include authentication headers/cookies as needed
  // Handle response and forward back to client
});
```

## API Service Configuration

The Angular service (`src/services/motor-api.service.ts`) is already configured to use:
```typescript
public readonly baseUrl = 'https://us-central1-vehapi-torque.cloudfunctions.net/motorApiAuthProxy';
```

No changes needed in the frontend service.

## Files Updated

1. ✅ `openapi.json` - Updated with motorproxy server URL
2. ✅ `swagger.json` - Copied from updated openapi.json

## Next Steps

1. Update the Firebase Cloud Function `motorApiAuthProxy` to forward to `sites.motor.com/m1/connector`
2. Ensure authentication is properly handled in the proxy
3. Test the proxy endpoints to verify connectivity
4. Deploy the updated proxy function
