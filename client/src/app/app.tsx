import { useState } from 'react';
import { HashbrownProvider } from '@hashbrownai/react';
import { Route, Routes } from 'react-router-dom';
import { AuthCallback } from './auth/AuthCallback';
import { authFetchMiddleware } from './auth/authFetchMiddleware';
import { AppHeader } from './components/AppHeader';
import { StoreInitializer } from './components/StoreInitializer';
import { RichChatPanel } from './shared/RichChatPanel';
import { Toaster } from './shared/toaster';
import { cn } from './shared/utils';
import { LightsView } from './views/LightsView';
import { ScenesView } from './views/ScenesView';
import { ScheduledScenesView } from './views/ScheduledScenesView';
import { BadgesView } from './views/BadgesView';
import { GamesView } from './views/GamesView';
import { GameDetailView } from './views/GameDetailView';
import { GamePlayView } from './views/GamePlayView';
import { Dashboard } from './components/dashboard/Dashboard';
import { UserProfileView } from './views/UserProfileView';
import { PlayersView } from './views/PlayersView';
import { PlayerDetailView } from './views/PlayerDetailView';
import { yallaRoutes } from './yalla/yalla-routes';

const chatUrl = import.meta.env.VITE_CHAT_URL ?? '/api/chat';

function MainShell() {
  // Collapsed by default; the header's chat button opens it.
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <HashbrownProvider
      url={chatUrl}
      middleware={[authFetchMiddleware]}
    >
      <StoreInitializer />
      <div
        className={cn(
          'grid h-[100dvh] min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-rows-1 lg:h-screen',
          chatOpen && 'lg:grid-cols-7',
        )}
      >
        <div className={cn('flex min-h-0 flex-col overflow-hidden', chatOpen && 'lg:col-span-4')}>
          <AppHeader chatOpen={chatOpen} onToggleChat={() => setChatOpen((open) => !open)} />
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <Routes>
              <Route path="/games" element={<GamesView />} />
              <Route path="/games/:gameId/play" element={<GamePlayView />} />
              <Route path="/games/:gameId" element={<GameDetailView />} />
              <Route path="/players" element={<PlayersView />} />
              <Route path="/players/:playerId" element={<PlayerDetailView />} />
              <Route path="/badges" element={<BadgesView />} />
              <Route path="/lights" element={<LightsView />} />
              <Route path="/scenes" element={<ScenesView />} />
              <Route
                path="/scheduled-scenes"
                element={<ScheduledScenesView />}
              />
              <Route path="/profile" element={<UserProfileView />} />
              {yallaRoutes}
              <Route path="/" element={<Dashboard />} />
            </Routes>
          </div>
        </div>
        {/* Hidden rather than unmounted, so the conversation survives a collapse. */}
        <div
          className={cn(
            'min-h-0 flex-col border-t p-2 lg:col-span-3 lg:h-full lg:border-l lg:border-t-0',
            chatOpen ? 'flex' : 'hidden',
          )}
        >
          <RichChatPanel />
        </div>
      </div>
      <Toaster />
    </HashbrownProvider>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="*" element={<MainShell />} />
    </Routes>
  );
}

export default App;
