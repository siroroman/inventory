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
  // form is shown: signing in is what fixes it.
  beforeLoad: async ({ context, search }) => {
    const user = await currentUser(context.queryClient).catch(() => undefined);
    if (user) throw redirect({ href: safeRedirect(search.redirect) });
  },
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation();
  const { redirect } = Route.useSearch();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <AppLogo className="size-12 rounded-xl" />
          <h1 className="text-xl font-semibold">{t('app.name')}</h1>
          <p className="hidden text-sm text-muted-foreground lg:block">{t('auth.tagline')}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 sm:p-6">
          <LoginForm redirectTo={redirect} />
        </div>
      </div>
    </div>
  );
}
