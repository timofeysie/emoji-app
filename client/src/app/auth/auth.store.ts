import { create } from 'zustand';

type AuthState = {
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;
};

/** Kept for this tab only, so a reload doesn't sign you out (cleared with the tab). */
const STORAGE_KEY = 'emoji-app.accessToken';

/** Seconds since the epoch at which the token expires, or null if unreadable. */
function expiryOf(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

function readStoredToken(): string | null {
  try {
    const token = sessionStorage.getItem(STORAGE_KEY);
    if (!token) return null;
    const exp = expiryOf(token);
    if (exp === null || exp * 1000 <= Date.now()) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, token);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the token still lives in memory for this page.
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: readStoredToken(),
  setAccessToken: (token) => {
    storeToken(token);
    set({ accessToken: token });
  },
}));
