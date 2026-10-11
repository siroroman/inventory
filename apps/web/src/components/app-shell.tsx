import { Link, Outlet, useMatch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AppLogo } from '@/components/app-logo';
import { HomeMenu } from '@/components/home-menu';
import { HomeSidebar } from '@/components/home-sidebar';
import { UserMenu } from '@/features/auth/user-menu';
import { desktopScreen, useMediaQuery } from '@/lib/use-media-query';

/**
 * Frame around every screen: skip link, the page content, and the navigation: a top bar (56 px, as
 * designed) everywhere, except on Home at desktop width, where the side menu replaces it. On Home
 * below that width the top bar carries the hamburger menu with the sections.
 */
export function AppShell() {
  const { t } = useTranslation();
  const desktop = useMediaQuery(desktopScreen);
  const home = useMatch({ from: '/_app/', shouldThrow: false });
  // The scanner is full screen: its own close button replaces the top bar, which would only sit under it.
  const scanner = useMatch({ from: '/_app/inventories/$id/scan', shouldThrow: false });
  const sidebar = desktop && home !== undefined;
  return (
    <div className={sidebar ? 'flex min-h-dvh' : 'flex min-h-dvh flex-col'}>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
      >
        {t('common.skipToContent')}
      </a>
      {sidebar ? (
        <HomeSidebar tab={home.search.tab ?? 'locations'} />
      ) : scanner ? null : (
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3">
          {home && <HomeMenu tab={home.search.tab ?? 'locations'} />}
          <Link
            to="/"
            className="-my-2 flex min-h-11 flex-1 items-center gap-2.5 truncate rounded-sm text-[17px] font-semibold focus-visible:ring-2 focus-visible:ring-ring"
          >
            <AppLogo />
            {t('app.name')}
          </Link>
          <UserMenu />
        </header>
      )}
      <main id="content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
        <Outlet />
      </main>
    </div>
  );
}
