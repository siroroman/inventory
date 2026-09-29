import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { problemMessage } from '@/lib/problem';
import { signIn } from './api';
import { safeRedirect } from './redirect';

// Messages are i18n keys; the form turns them into Czech. The password is only checked for being
// present: its rules are the server's business, and a wrong one gets the same answer as any other.
const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'auth.emailRequired')
    .pipe(z.email('auth.emailInvalid')),
  password: z.string().min(1, 'auth.passwordRequired'),
});
type Credentials = z.infer<typeof credentialsSchema>;
type FieldMessage = 'auth.emailRequired' | 'auth.emailInvalid' | 'auth.passwordRequired';

/** Email + password sign-in. On success it goes to `redirectTo` (already a `?redirect=` value). */
export function LoginForm({ redirectTo }: { redirectTo: string | undefined }) {
  const { t } = useTranslation();
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Credentials>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: '', password: '' },
  });

  const signInMutation = useMutation({
    mutationFn: signIn,
    // The form shows the failure itself, next to the button.
    meta: { silentError: true },
    // `replace`, so Back from the first screen does not return to the login form.
    onSuccess: () => router.history.replace(safeRedirect(redirectTo)),
  });
  const busy = signInMutation.isPending || signInMutation.isSuccess;

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) => signInMutation.mutate(values))}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{t('auth.email')}</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'email-error' : undefined}
          {...register('email')}
        />
        {errors.email && (
          <p id="email-error" className="text-sm text-destructive">
            {t(errors.email.message as FieldMessage)}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">{t('auth.password')}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? 'password-error' : undefined}
          {...register('password')}
        />
        {errors.password && (
          <p id="password-error" className="text-sm text-destructive">
            {t(errors.password.message as FieldMessage)}
          </p>
        )}
      </div>
      {signInMutation.isError && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-sm text-destructive">
          {problemMessage(signInMutation.error)}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? t('auth.submitting') : t('auth.submit')}
      </Button>
    </form>
  );
}
