import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from './auth.store';
import { authDisabledClient } from './cognito-config';

/**
 * Who counts as signed in for the UI (docs/xAPI/xapi-export-plan.md, "Users,
 * roles and permissions", Phase 1): a Cognito user, or anyone when auth is
 * disabled for local dev and e2e. In the prototype every signed-in user is
 * a referee. This only hides UI; the server checks the token itself.
 */
export function isSignedIn(accessToken: string | null): boolean {
  return authDisabledClient || Boolean(accessToken);
}

export function useIsSignedIn(): boolean {
  return isSignedIn(useAuthStore((s) => s.accessToken));
}

/** Sends a guest back to the dashboard. */
export function RequireSignIn({ children }: { children: ReactNode }) {
  return useIsSignedIn() ? <>{children}</> : <Navigate to="/" replace />;
}
