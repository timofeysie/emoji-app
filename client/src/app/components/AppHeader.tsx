import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { AuthBar } from '../auth/AuthBar';
import { Button } from '../shared/button';
import { cn } from '../shared/utils';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from '../shared/navigation-menu';

const NAV_LINKS = [
  { to: '/lights', label: 'Lights' },
  { to: '/scenes', label: 'Scenes' },
  { to: '/scheduled-scenes', label: 'Scheduled Scenes' },
  { to: '/badges', label: 'Badges' },
] as const;

function viewTitleForPathname(pathname: string): string {
  switch (pathname) {
    case '/':
      return 'Dashboard';
    case '/lights':
      return 'Lights';
    case '/scenes':
      return 'Scenes';
    case '/scheduled-scenes':
      return 'Scheduled Scenes';
    case '/badges':
      return 'Badges';
    default:
      return 'Emoji App';
  }
}

export function AppHeader() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const viewTitle = viewTitleForPathname(location.pathname);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileNavOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileNavOpen]);

  useEffect(() => {
    if (mobileNavOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileNavOpen]);

  return (
    <>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b py-2 px-2">
        <p className="min-w-0 truncate text-xl font-bold">
          <span className="font-semibold">Emoji App</span>
          <span
            className="ml-1.5 align-baseline text-[0.65rem] font-normal leading-none text-muted-foreground tabular-nums"
            title={`App version ${__APP_VERSION__}`}
          >
            v{__APP_VERSION__}
          </span>
        </p>

        <p className="min-w-0 truncate text-center text-xl font-bold">{viewTitle}</p>

        <div className="flex min-w-0 items-center justify-end gap-2">
          <nav className="hidden min-w-0 lg:flex" aria-label="Main">
            <NavigationMenu>
              <NavigationMenuList>
                {NAV_LINKS.map(({ to, label }) => (
                  <NavigationMenuItem key={to}>
                    <NavigationMenuLink asChild>
                      <Link to={to} className={navigationMenuTriggerStyle()}>
                        {label}
                      </Link>
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                ))}
              </NavigationMenuList>
            </NavigationMenu>
          </nav>

          <div className="flex shrink-0 items-center gap-1">
            <div className="hidden lg:block">
              <AuthBar />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-nav-panel"
              aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              {mobileNavOpen ? (
                <X className="h-5 w-5" aria-hidden />
              ) : (
                <Menu className="h-5 w-5" aria-hidden />
              )}
            </Button>
          </div>
        </div>
      </div>

      {mobileNavOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            aria-label="Close menu"
            onClick={() => setMobileNavOpen(false)}
          />
          <div
            id="mobile-nav-panel"
            className="fixed inset-y-0 left-0 z-50 flex h-full w-[min(100vw,18rem)] flex-col border-r bg-background shadow-lg lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">Menu</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close menu"
                onClick={() => setMobileNavOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <nav
              className="min-h-0 flex-1 overflow-y-auto p-2"
              aria-label="Main"
            >
              {NAV_LINKS.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  className={cn(
                    'block rounded-md px-3 py-2.5 text-sm font-medium',
                    'hover:bg-accent hover:text-accent-foreground',
                    location.pathname === to && 'bg-accent text-accent-foreground',
                  )}
                  onClick={() => setMobileNavOpen(false)}
                >
                  {label}
                </Link>
              ))}
            </nav>
            <div className="shrink-0 border-t p-3">
              <AuthBar />
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
