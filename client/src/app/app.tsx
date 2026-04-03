import { HashbrownProvider } from '@hashbrownai/react';
import { Link, Route, Routes } from 'react-router-dom';
import { AuthBar } from './auth/AuthBar';
import { AuthCallback } from './auth/AuthCallback';
import { authFetchMiddleware } from './auth/authFetchMiddleware';
import { StoreInitializer } from './components/StoreInitializer';
import { RichChatPanel } from './shared/RichChatPanel';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from './shared/navigation-menu';
import { Toaster } from './shared/toaster';
import { LightsView } from './views/LightsView';
import { ScenesView } from './views/ScenesView';
import { ScheduledScenesView } from './views/ScheduledScenesView';
import { BadgesView } from './views/BadgesView';
import { Dashboard } from './components/dashboard/Dashboard';

const chatUrl = import.meta.env.VITE_CHAT_URL ?? '/api/chat';

function MainShell() {
  return (
    <HashbrownProvider
      url={chatUrl}
      middleware={[authFetchMiddleware]}
    >
      <StoreInitializer />
      <div className="grid grid-cols-7">
        <div className="col-span-4">
          <div className="flex justify-between py-2 items-center border-b gap-2">
            <p className="text-xl font-bold p-2">Emoji App</p>
            <div className="flex items-center gap-1 flex-1 justify-end min-w-0">
              <NavigationMenu>
                <NavigationMenuList>
                  <NavigationMenuItem>
                    <NavigationMenuLink asChild>
                      <Link
                        to="/lights"
                        className={navigationMenuTriggerStyle()}
                      >
                        Lights
                      </Link>
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <NavigationMenuLink asChild>
                      <Link
                        to="/scenes"
                        className={navigationMenuTriggerStyle()}
                      >
                        Scenes
                      </Link>
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <NavigationMenuLink asChild>
                      <Link
                        to="/scheduled-scenes"
                        className={navigationMenuTriggerStyle()}
                      >
                        Scheduled Scenes
                      </Link>
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <NavigationMenuLink asChild>
                      <Link
                        to="/badges"
                        className={navigationMenuTriggerStyle()}
                      >
                        Badges
                      </Link>
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                </NavigationMenuList>
              </NavigationMenu>
              <AuthBar />
            </div>
          </div>
          <div className="gap-4">
            <div className="col-span-3">
              <div className="p-2">
                <Routes>
                  <Route path="/lights" element={<LightsView />} />
                  <Route path="/scenes" element={<ScenesView />} />
                  <Route
                    path="/scheduled-scenes"
                    element={<ScheduledScenesView />}
                  />
                  <Route path="/badges" element={<BadgesView />} />
                  <Route path="/" element={<Dashboard />} />
                </Routes>
              </div>
            </div>
          </div>
        </div>
        <div className="col-span-3 border-l p-2 h-screen overflow-hidden">
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
