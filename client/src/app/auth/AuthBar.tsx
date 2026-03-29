import { useAuthStore } from './auth.store';
import {
  authDisabledClient,
  isCognitoConfigured,
} from './cognito-config';
import { buildCognitoLogoutUrl, startHostedUiLogin } from './cognito-oauth';
import { Button } from '../shared/button';

export function AuthBar() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAccessToken = useAuthStore((s) => s.setAccessToken);

  if (authDisabledClient) {
    return (
      <span className="text-xs text-muted-foreground px-2">
        API auth off (dev)
      </span>
    );
  }

  if (!isCognitoConfigured()) {
    return (
      <span className="text-xs text-amber-700 dark:text-amber-400 px-2 max-w-xs text-right">
        Set VITE_COGNITO_* in .env to sign in
      </span>
    );
  }

  if (accessToken) {
    return (
      <div className="flex items-center gap-2 px-2">
        <span className="text-xs text-muted-foreground">Signed in</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setAccessToken(null);
            const logout = buildCognitoLogoutUrl();
            if (logout) {
              window.location.href = logout;
            }
          }}
        >
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className="px-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          void startHostedUiLogin().catch((e: unknown) => {
            console.error(e);
            alert(e instanceof Error ? e.message : 'Sign-in failed');
          });
        }}
      >
        Sign in
      </Button>
    </div>
  );
}
