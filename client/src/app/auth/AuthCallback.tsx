import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from './auth.store';
import { exchangeCodeForTokens } from './cognito-oauth';

export function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get('code');
    const oauthError = params.get('error');
    if (oauthError) {
      setError(params.get('error_description') ?? oauthError);
      return;
    }
    if (!code) {
      setError('Missing authorization code.');
      return;
    }

    let cancelled = false;
    exchangeCodeForTokens(code)
      .then((tokens) => {
        if (cancelled) {
          return;
        }
        setAccessToken(tokens.access_token);
        navigate('/', { replace: true });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Sign-in failed.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params, navigate, setAccessToken]);

  if (error) {
    return (
      <div className="p-6 text-red-600">
        <p className="font-medium">Sign-in failed</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  return <div className="p-6 text-muted-foreground">Completing sign-in…</div>;
}
