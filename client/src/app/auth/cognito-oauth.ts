import {
  getCognitoClientId,
  getCognitoDomain,
  getCognitoScopes,
} from './cognito-config';
import { createCodeChallenge, createCodeVerifier } from './pkce';

const PKCE_VERIFIER_KEY = 'cognito_pkce_verifier';

/** One in-flight exchange per `code` so React Strict Mode's double effect does not consume the PKCE verifier twice. */
const exchangesByCode = new Map<
  string,
  Promise<{ access_token: string }>
>();

export async function startHostedUiLogin(): Promise<void> {
  const domain = getCognitoDomain();
  const clientId = getCognitoClientId();
  const scopes = getCognitoScopes();
  if (!domain || !clientId) {
    throw new Error('Cognito is not configured (VITE_COGNITO_DOMAIN, VITE_COGNITO_CLIENT_ID).');
  }

  const redirectUri = `${window.location.origin}/auth/callback`;
  const verifier = createCodeVerifier();
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  const challenge = await createCodeChallenge(verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });

  window.location.href = `${domain}/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
): Promise<{ access_token: string }> {
  const existing = exchangesByCode.get(code);
  if (existing) {
    return existing;
  }

  const promise = performTokenExchange(code);
  exchangesByCode.set(code, promise);
  promise.finally(() => {
    exchangesByCode.delete(code);
  });

  return promise;
}

async function performTokenExchange(
  code: string,
): Promise<{ access_token: string }> {
  const domain = getCognitoDomain();
  const clientId = getCognitoClientId();
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);

  if (!domain || !clientId || !verifier) {
    throw new Error('OAuth state is missing. Try signing in again.');
  }

  const redirectUri = `${window.location.origin}/auth/callback`;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier,
  });

  const res = await fetch(`${domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<{ access_token: string }>;
}

/** Cognito hosted UI logout; clears IdP session when user returns. */
export function buildCognitoLogoutUrl(): string | null {
  const domain = getCognitoDomain();
  const clientId = getCognitoClientId();
  if (!domain || !clientId) {
    return null;
  }
  const logoutUri = encodeURIComponent(`${window.location.origin}/`);
  return `${domain}/logout?client_id=${encodeURIComponent(clientId)}&logout_uri=${logoutUri}`;
}
