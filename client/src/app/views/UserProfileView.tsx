import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../auth/auth.store';
import { authDisabledClient, getCognitoDomain } from '../auth/cognito-config';
import { Card, CardContent, CardHeader, CardTitle } from '../shared/card';

type JwtPayload = Record<string, unknown>;
type UserInfoPayload = Record<string, unknown>;

function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  const payload = parts[1];
  if (!payload) {
    return null;
  }

  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (base64.length % 4)) % 4;
  const padded = `${base64}${'='.repeat(padding)}`;

  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

function renderValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return '-';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function FieldList({
  title,
  data,
}: {
  title: string;
  data: Record<string, unknown>;
}) {
  const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        No fields returned.
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="overflow-hidden rounded-md border">
        {entries.map(([key, value], idx) => (
          <div
            key={key}
            className={`grid grid-cols-1 gap-1 px-3 py-2 text-sm sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:gap-3 ${idx > 0 ? 'border-t' : ''}`}
          >
            <span className="font-medium text-foreground/90 break-words">{key}</span>
            <span className="text-muted-foreground break-words">{renderValue(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function UserProfileView() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [userInfo, setUserInfo] = useState<UserInfoPayload | null>(null);
  const [loadingUserInfo, setLoadingUserInfo] = useState(false);
  const [userInfoError, setUserInfoError] = useState<string | null>(null);

  const tokenClaims = useMemo(
    () => (accessToken ? decodeJwtPayload(accessToken) : null),
    [accessToken],
  );

  useEffect(() => {
    if (!accessToken) {
      setUserInfo(null);
      setUserInfoError(null);
      setLoadingUserInfo(false);
      return;
    }
    const domain = getCognitoDomain();
    if (!domain || authDisabledClient) {
      setUserInfo(null);
      setUserInfoError(null);
      setLoadingUserInfo(false);
      return;
    }

    let cancelled = false;
    setLoadingUserInfo(true);
    setUserInfoError(null);

    fetch(`${domain}/oauth2/userInfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(
            `Cognito user info request failed (${res.status}): ${text || 'No response body'}`,
          );
        }
        return res.json() as Promise<UserInfoPayload>;
      })
      .then((payload) => {
        if (!cancelled) {
          setUserInfo(payload);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setUserInfo(null);
          setUserInfoError(
            err instanceof Error
              ? err.message
              : 'Failed to fetch Cognito user info.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingUserInfo(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  if (!accessToken) {
    return (
      <div className="max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>User Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              You are not signed in. Sign in to view Cognito user details.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-4 max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle>User Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {loadingUserInfo ? (
            <p className="text-sm text-muted-foreground">
              Loading Cognito user details...
            </p>
          ) : null}

          {userInfoError ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {userInfoError}
            </p>
          ) : null}

          {userInfo ? <FieldList title="Cognito User Info" data={userInfo} /> : null}

          {tokenClaims ? (
            <FieldList title="Access Token Claims" data={tokenClaims} />
          ) : (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              Could not decode token claims from the current access token.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
