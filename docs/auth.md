# Authentication

This document compares auth options for the smart-home sample and describes
how to implement the recommended approach (AWS Cognito).

## What we need

- Protect `POST /api/chat` — every request proxies a paid OpenAI call
- Support the React SPA running in a browser (no server-side secret storage)
- Fit naturally with the App Runner deployment on AWS

A browser-based SPA cannot safely hold a client secret, so every option here
uses the **PKCE OAuth 2.0 flow**: the frontend obtains a short-lived JWT and
sends it as `Authorization: Bearer <token>` on every API request. Express
verifies the token on the server.

---

## Comparison

| | Cognito | Auth0 | Clerk | API key header |
|---|---|---|---|---|
| **Free tier** | 50,000 MAU | 7,500 MAU | 10,000 MAU | N/A |
| **Paid tier starts** | $0.0055/MAU after 50k | $23/mo (200 MAU) | $25/mo | N/A |
| **AWS-native** | Yes | No | No | N/A |
| **Setup complexity** | High | Low | Lowest | Trivial |
| **Console / DX** | Poor (AWS console) | Good | Excellent | N/A |
| **Hosted login UI** | Yes (customisable) | Yes | Yes (very polished) | No |
| **Custom login UI** | Yes (with SDK) | Yes | Yes (component library) | No |
| **Social login** | Yes (Google, Apple, etc.) | Yes | Yes | No |
| **MFA** | Yes | Yes (paid) | Yes | No |
| **React SDK** | `amazon-cognito-identity-js` / Amplify | `@auth0/auth0-react` | `@clerk/clerk-react` | None needed |
| **Per-user identity** | Yes | Yes | Yes | No |
| **JWT verification in Express** | JWKS endpoint (no library required) | JWKS endpoint | JWKS endpoint | `===` string compare |

### When to pick each option

**Cognito** — you are already on AWS, expect significant user growth, want MFA
and social login without paying a third party, and are willing to accept
rougher developer ergonomics.

**Auth0** — you want the best-documented, most battle-tested auth-as-a-service
with a smooth setup experience and don't mind the smaller free tier.

**Clerk** — you want the fastest time to a polished login UI and your user base
will fit within 10,000 MAU. Especially good if you plan to add per-user
billing or organisations later.

**API key header** — the app is internal or a demo, you don't need per-user
identity, and you just want to stop random public access. Implement in an
afternoon.

---

## Recommended: AWS Cognito

Cognito is the right long-term choice given the App Runner deployment: it
stays within AWS, has the most generous free tier, and token verification
requires no third-party service call at runtime — just a local JWKS cache.

### Cognito concepts

| Term | What it is |
|------|-----------|
| **User Pool** | The user directory (sign-up, sign-in, password policies) |
| **App Client** | A credential-less client config for the SPA (PKCE, no secret) |
| **Hosted UI** | Cognito's built-in login/signup page (optional) |
| **ID token** | JWT containing user identity claims (`email`, `sub`, etc.) |
| **Access token** | JWT for authorising API calls (send this as the Bearer token) |
| **Refresh token** | Long-lived token used to get new access tokens silently |
| **JWKS URL** | Public endpoint Express uses to verify token signatures |

### Architecture

```text
Browser (React SPA)
  │
  ├─ 1. Redirect to Cognito Hosted UI (or use SDK sign-in form)
  ├─ 2. User signs in → Cognito issues tokens (PKCE exchange)
  ├─ 3. Store access token in memory
  │
  └─ 4. POST /api/chat
         Authorization: Bearer <access-token>
              │
              ▼
         Express middleware
              │
              ├─ Fetch JWKS from Cognito (cached)
              ├─ Verify token signature + expiry
              └─ Pass to route handler (or return 401)
```

---

### Implementation plan

#### 1. Create the User Pool (AWS CLI)

```bash
aws cognito-idp create-user-pool \
  --pool-name smart-home \
  --policies '{"PasswordPolicy":{"MinimumLength":8,"RequireUppercase":true,"RequireLowercase":true,"RequireNumbers":true,"RequireSymbols":false}}' \
  --auto-verified-attributes email \
  --username-attributes email \
  --region us-east-1
```

Note the `Id` in the output — this is your `USER_POOL_ID`.

#### 2. Create the App Client (no secret — required for SPAs)

```bash
aws cognito-idp create-user-pool-client \
  --user-pool-id <USER_POOL_ID> \
  --client-name smart-home-spa \
  --no-generate-secret \
  --allowed-o-auth-flows code \
  --allowed-o-auth-flows-user-pool-client \
  --allowed-o-auth-scopes openid email profile \
  --callback-urls '["http://localhost:5200","https://<your-apprunner-url>"]' \
  --logout-urls '["http://localhost:5200","https://<your-apprunner-url>"]' \
  --supported-identity-providers COGNITO \
  --region us-east-1
```

Note the `ClientId` — this is your `USER_POOL_CLIENT_ID`.

#### 3. Configure a domain for the Hosted UI

```bash
aws cognito-idp create-user-pool-domain \
  --domain smart-home-<your-suffix> \
  --user-pool-id <USER_POOL_ID> \
  --region us-east-1
```

The Hosted UI will be available at:
`https://smart-home-<your-suffix>.auth.us-east-1.amazoncognito.com`

#### 4. Add token verification middleware to Express

Install a JWKS client:

```bash
npm install jwks-rsa jsonwebtoken
```

Add `samples/smart-home/server/src/auth.ts`:

```typescript
import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const REGION = process.env.AWS_REGION ?? 'us-east-1';

const client = jwksClient({
  jwksUri: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  client.getSigningKey(header.kid, (err, key) => {
    callback(err, key?.getPublicKey());
  });
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }
  const token = auth.slice(7);
  jwt.verify(token, getKey, { algorithms: ['RS256'] }, (err, decoded) => {
    if (err) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    (req as any).user = decoded;
    next();
  });
};
```

Apply the middleware to the API route in `main.ts`:

```typescript
import { requireAuth } from './auth';

app.post('/api/chat', requireAuth, async (req, res) => { ... });
```

Add the environment variables to the App Runner service:

```bash
COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
AWS_REGION=us-east-1
```

#### 5. Add sign-in to the React SPA

Install the Cognito SDK:

```bash
npm install amazon-cognito-identity-js
```

The minimal flow using the Hosted UI redirect (lowest implementation effort):

```typescript
// src/auth/cognito.ts
const DOMAIN = 'https://smart-home-<your-suffix>.auth.us-east-1.amazoncognito.com';
const CLIENT_ID = '<USER_POOL_CLIENT_ID>';
const REDIRECT_URI = window.location.origin;

export function signIn() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid email profile',
  });
  window.location.href = `${DOMAIN}/oauth2/authorize?${params}`;
}

export async function handleCallback(code: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code,
  });
  const res = await fetch(`${DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const tokens = await res.json();
  return tokens.access_token;
}
```

Store the access token in memory (a React context or Zustand store) and attach
it to every chat request:

```typescript
headers: { Authorization: `Bearer ${accessToken}` }
```

---

### Key decisions still to make

| Decision | Options | Notes |
|----------|---------|-------|
| **Login UI** | Hosted UI vs. custom form | Hosted UI is fastest; custom form gives full control over styling |
| **Social login** | Google, Apple, Facebook | Requires configuring identity provider in Cognito and the provider's OAuth app |
| **Token storage** | Memory (most secure) vs. `localStorage` | Memory tokens are lost on page refresh; combine with a refresh token in an `HttpOnly` cookie to avoid re-login |
| **Protect whole app or just API** | Full app gate vs. API-only guard | API-only guard lets unauthenticated users see the UI but blocks actual usage |
| **User self-registration** | Allow vs. admin-invite only | Controlled by User Pool settings |

---

## Alternative: API key header

For a quick internal deployment or demo where user identity is not needed:

```typescript
// Express middleware
const requireApiKey: RequestHandler = (req, res, next) => {
  if (req.headers['x-api-key'] !== process.env.API_KEY) {
    res.status(401).json({ error: 'Unauthorised' });
    return;
  }
  next();
};

app.post('/api/chat', requireApiKey, async (req, res) => { ... });
```

Set `API_KEY` as an App Runner environment variable. The React app reads it
from a build-time env var (`import.meta.env.VITE_API_KEY`) and attaches it as
a request header. This approach takes about 15 minutes to implement but
provides no per-user identity or audit trail.
