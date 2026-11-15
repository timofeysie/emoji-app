import { isSignedIn, useIsSignedIn } from '../auth/sign-in-access';

/**
 * Who may see YALLA (docs/yalla/implementation-plan.md §1): any signed-in
 * user (see `sign-in-access.tsx`). The header link and the route guard both
 * use this. It only hides the UI; the `/api/yalla/*` routes check the token
 * themselves.
 */
export function canUseYalla(accessToken: string | null): boolean {
  return isSignedIn(accessToken);
}

export function useCanUseYalla(): boolean {
  return useIsSignedIn();
}
