import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { UserMenu } from '@/features/auth/user-menu';

/** Frame around every screen: skip link, top bar (56 px, as designed) and the page content. */
export function AppShell() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
      >
        {t('common.skipToContent')}
      </a>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3">
        <Link
          to="/"
          className="-my-2 flex min-h-11 flex-1 items-center truncate rounded-sm text-[17px] font-semibold focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('app.name')}
        </Link>
        <UserMenu />
      </header>
      <main id="content" tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>
    </div>
  );
}
