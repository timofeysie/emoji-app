/** Normalise hosted UI base URL (no trailing slash). */
export function getCognitoDomain(): string | undefined {
  const raw = import.meta.env.VITE_COGNITO_DOMAIN as string | undefined;
  return raw?.replace(/\/$/, '');
}

export function getCognitoClientId(): string | undefined {
  return import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined;
}

export function getCognitoScopes(): string {
  return (
    (import.meta.env.VITE_COGNITO_SCOPES as string | undefined) ??
    'openid email profile'
  );
}

export const authDisabledClient =
  import.meta.env.VITE_DISABLE_AUTH === 'true';

export function isCognitoConfigured(): boolean {
  return Boolean(getCognitoDomain() && getCognitoClientId());
}
