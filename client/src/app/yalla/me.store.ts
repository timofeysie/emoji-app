import { create } from 'zustand';
import { authFetch } from '../auth/authFetch';
import { useAuthStore } from '../auth/auth.store';

/** `GET /api/me`: the signed-in user and the player they practise as. */
export type Me = {
  user: { id: string; displayName: string };
  player: { id: string; firstName: string; label: string } | null;
};

/** Body of `PUT /api/me/player`. */
export type SetPlayerRequest = { playerId: string | null } | { create: { firstName: string } };

type MeState = {
  me: Me | null;
  loading: boolean;
  error: string | null;
  /** Loads `/api/me` (once, unless `force`). */
  load: (force?: boolean) => Promise<void>;
  /** Links, unlinks or creates-and-links; returns an error message or null. */
  setPlayer: (request: SetPlayerRequest) => Promise<string | null>;
  clear: () => void;
};

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // Not JSON.
  }
  return `Server returned ${res.status}`;
}

/** Who is practising (docs/yalla/implementation-plan.md §4). */
export const useMeStore = create<MeState>((set, get) => ({
  me: null,
  loading: false,
  error: null,
  load: async (force = false) => {
    if (get().loading || (get().me && !force)) return;
    set({ loading: true, error: null });
    try {
      const res = await authFetch('/api/me');
      if (!res.ok) {
        set({ loading: false, error: await errorMessage(res) });
        return;
      }
      set({ me: (await res.json()) as Me, loading: false });
    } catch {
      set({ loading: false, error: 'Could not reach server.' });
    }
  },
  setPlayer: async (request) => {
    try {
      const res = await authFetch('/api/me/player', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) return await errorMessage(res);
      set({ me: (await res.json()) as Me, error: null });
      return null;
    } catch {
      return 'Could not reach server.';
    }
  },
  clear: () => set({ me: null, loading: false, error: null }),
}));

// A different sign-in (or sign-out) means a different user.
useAuthStore.subscribe((state, previous) => {
  if (state.accessToken !== previous.accessToken) {
    useMeStore.getState().clear();
  }
});
