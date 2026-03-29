import { useAuthStore } from './auth.store';
import { authDisabledClient } from './cognito-config';

export async function authFetchMiddleware(
  request: RequestInit,
): Promise<RequestInit> {
  if (authDisabledClient) {
    return request;
  }
  const token = useAuthStore.getState().accessToken;
  if (!token) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...request, headers };
}
