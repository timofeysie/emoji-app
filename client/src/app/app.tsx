import { HashbrownProvider } from '@hashbrownai/react';
import { Route, Routes } from 'react-router-dom';
import { AuthCallback } from './auth/AuthCallback';
import { authFetchMiddleware } from './auth/authFetchMiddleware';
import { AppHeader } from './components/AppHeader';
import { StoreInitializer } from './components/StoreInitializer';
import { RichChatPanel } from './shared/RichChatPanel';
import { Toaster } from './shared/toaster';
import { LightsView } from './views/LightsView';
import { ScenesView } from './views/ScenesView';
import { ScheduledScenesView } from './views/ScheduledScenesView';
import { BadgesView } from './views/BadgesView';
import { Dashboard } from './components/dashboard/Dashboard';
import { UserProfileView } from './views/UserProfileView';

const chatUrl = import.meta.env.VITE_CHAT_URL ?? '/api/chat';

function MainShell() {
  return (
    <HashbrownProvider
      url={chatUrl}
      middleware={[authFetchMiddleware]}
    >
      <StoreInitializer />
      <div className="grid h-[100dvh] min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-7 lg:grid-rows-1 lg:h-screen">
        <div className="flex min-h-0 flex-col overflow-hidden lg:col-span-4">
          <AppHeader />
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <Routes>
              <Route path="/lights" element={<LightsView />} />
              <Route path="/scenes" element={<ScenesView />} />
              <Route
                path="/scheduled-scenes"
                element={<ScheduledScenesView />}
              />
              <Route path="/badges" element={<BadgesView />} />
              <Route path="/profile" element={<UserProfileView />} />
              <Route path="/" element={<Dashboard />} />
            </Routes>
          </div>
        </div>
        <div className="flex min-h-0 flex-col border-t p-2 lg:col-span-3 lg:h-full lg:border-l lg:border-t-0">
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
