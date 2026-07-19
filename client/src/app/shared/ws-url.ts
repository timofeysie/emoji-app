/** Resolve the emoji-app WebSocket URL for browser clients. */
export function getWsUrl(): string {
  const configuredWsUrl = import.meta.env['VITE_WS_URL'] as string | undefined;
  if (configuredWsUrl) {
    return configuredWsUrl;
  }

  if (import.meta.env.DEV) {
    return 'ws://localhost:3000/ws';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}
