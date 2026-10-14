import { createFileRoute, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { AppLogo } from '@/components/app-logo';
import { currentUser } from '@/features/auth/api';
import { LoginForm } from '@/features/auth/login-form';
import { safeRedirect } from '@/features/auth/redirect';

export const Route = createFileRoute('/login')({
  // `redirect` is where to go after signing in; a value that is not a string is ignored.
  validateSearch: z.object({ redirect: z.string().optional().catch(undefined) }),
  // Someone who is already signed in has no business here. If the check fails for any reason the
  // form is shown: signing in is what fixes it. Sent here by the route guard, the session was just
  // found missing, so there is nothing to ask again (one request less before the form shows).
  beforeLoad: async ({ context, search, location }) => {
    if ((location.state as { anonymous?: boolean }).anonymous) return;
    const user = await currentUser(context.queryClient).catch(() => undefined);
    if (user) throw redirect({ href: safeRedirect(search.redirect) });
  },
  component: LoginPage,
});

/**
 * One layout, two looks. On a phone the logo and name sit above the form. From 1024 px the brand
 * block becomes the dark panel on the right (it comes first in the DOM, `flex-row-reverse` moves
 * it) and the form fills the left side under its own "Přihlášení" heading.
 */
function LoginPage() {
  const { t } = useTranslation();
  const { redirect } = Route.useSearch();
  return (
    <div className="flex min-h-dvh flex-col justify-center gap-7 bg-background p-8 lg:flex-row-reverse lg:gap-0 lg:p-0">
      <div className="flex flex-col items-center gap-3 text-center lg:w-110 lg:shrink-0 lg:items-start lg:justify-center lg:gap-4 lg:bg-panel lg:p-14 lg:text-left lg:text-panel-foreground">
        <AppLogo className="size-14 rounded-[14px] lg:size-12 lg:rounded-xl" />
        <h1 className="text-xl font-semibold lg:text-[26px]">{t('app.name')}</h1>
        <p className="hidden text-[15px] leading-normal text-panel-muted lg:block">{t('auth.tagline')}</p>
      </div>
      <main className="flex w-full flex-col items-center lg:flex-1 lg:justify-center lg:p-12">
        <div className="flex w-full max-w-95 flex-col gap-5">
          <h2 className="hidden text-[22px] font-semibold lg:block">{t('auth.title')}</h2>
          <LoginForm redirectTo={redirect} />
        </div>
      </main>
    </div>
  );
}
