import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { meQueryOptions, signOut } from './api';
import { initials } from './initials';

/** Avatar in the top bar; opens who is signed in and how to sign out. */
export function UserMenu() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: me } = useQuery(meQueryOptions);

  const signOutMutation = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      // Nothing fetched for this user may outlive the session, and the login page must not find
      // a cached user and send us straight back.
      queryClient.clear();
      await router.navigate({ to: '/login' });
    },
  });

  if (!me) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('auth.userMenu')}
        className="flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span
          aria-hidden
          className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
        >
          {initials(me.name, me.email)}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <p className="truncate text-[15px] font-semibold">{me.name}</p>
          <p className="truncate text-sm text-muted-foreground">{me.email}</p>
          <p className="text-sm text-muted-foreground">{t(`roles.${me.role}`)}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={signOutMutation.isPending} onSelect={() => signOutMutation.mutate()}>
          <LogOut aria-hidden />
          {t('auth.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
