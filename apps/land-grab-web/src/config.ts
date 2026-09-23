declare global {
  interface Window {
    __LAND_GRAB_CONFIG__?: {
      gameServerUrl?: string;
    };
  }
}

export function getGameServerUrl(): string | undefined {
  const value =
    window.__LAND_GRAB_CONFIG__?.gameServerUrl ??
    import.meta.env["VITE_LAND_GRAB_SERVER_URL"];
  const normalized = value?.trim();
  return normalized || undefined;
}
