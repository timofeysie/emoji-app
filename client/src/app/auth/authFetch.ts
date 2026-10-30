import { authFetchMiddleware } from './authFetchMiddleware';

/** `fetch` with the signed-in user's Cognito token (none when auth is disabled for dev). */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, await authFetchMiddleware({ credentials: 'same-origin', ...init }));
}
