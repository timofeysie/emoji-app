import { useAuthStore } from '../auth/auth.store';
import { authDisabledClient } from '../auth/cognito-config';

/**
 * Who may see YALLA (docs/yalla/implementation-plan.md §1): a signed-in
 * Cognito user, or anyone when auth is disabled for local dev. The header
 * link and the route guard both use this. It only hides the UI; the
 * `/api/yalla/*` routes check the token themselves.
 */
export function canUseYalla(accessToken: string | null): boolean {
  return authDisabledClient || Boolean(accessToken);
}

export function useCanUseYalla(): boolean {
  return canUseYalla(useAuthStore((s) => s.accessToken));
}
