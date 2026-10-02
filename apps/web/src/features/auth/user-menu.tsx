import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { ChevronDown, LogOut } from 'lucide-react';
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

const avatarClass =
  'flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground';

/**
 * Who is signed in and how to sign out. The avatar in the top bar, or in `sidebar` form (Home on
 * desktop) the wider block at the foot of the side menu with the name and role beside it.
 */
export function UserMenu({ variant = 'avatar' }: { variant?: 'avatar' | 'sidebar' }) {
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
  const sidebar = variant === 'sidebar';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // The sidebar form names itself with the visible name and role; the bare avatar needs a label.
        aria-label={sidebar ? undefined : t('auth.userMenu')}
        className={
          sidebar
            ? 'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50'
            : 'flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
        }
      >
        <span aria-hidden className={avatarClass}>
          {initials(me.name, me.email)}
        </span>
        {sidebar && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{me.name}</span>
              <span className="block text-xs text-muted-foreground">{t(`roles.${me.role}`)}</span>
            </span>
            <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={sidebar ? 'start' : 'end'} side={sidebar ? 'top' : 'bottom'}>
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
