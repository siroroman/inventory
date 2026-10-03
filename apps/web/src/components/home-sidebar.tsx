import { Link } from '@tanstack/react-router';
import { Building2, BriefcaseBusiness, Image, type LucideIcon, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppLogo } from '@/components/app-logo';
import { UserMenu } from '@/features/auth/user-menu';
import { cn } from '@/lib/utils';

export type HomeTab = 'locations' | 'items' | 'maintenance' | 'suppliers';

const entries: {
  tab: HomeTab;
  icon: LucideIcon;
  label: 'home.locations.tab' | 'home.items.tab' | 'home.maintenance.tab' | 'home.suppliers.tab';
}[] = [
  { tab: 'locations', icon: Building2, label: 'home.locations.tab' },
  { tab: 'items', icon: Image, label: 'home.items.tab' },
  { tab: 'maintenance', icon: Wrench, label: 'home.maintenance.tab' },
  { tab: 'suppliers', icon: BriefcaseBusiness, label: 'home.suppliers.tab' },
];

/**
 * Side menu of the Home screens on desktop (designed 240 px): the logo, the lists the tabs
 * switch between on a phone, and the signed-in user at the bottom. Another list starts without
 * search text, as with the tabs.
 */
export function HomeSidebar({ tab }: { tab: HomeTab }) {
  const { t } = useTranslation();
  return (
    <aside className="sticky top-0 flex h-dvh w-60 shrink-0 flex-col border-r bg-card py-5">
      <div className="flex items-center gap-2.5 px-5 pb-5">
        <AppLogo />
        <span className="text-[15px] font-bold">{t('app.name')}</span>
      </div>
      <nav aria-label={t('nav.main')} className="flex flex-col gap-0.5 px-3">
        {entries.map(({ tab: value, icon: Icon, label }) => {
          const active = value === tab;
          return (
            <Link
              key={value}
              to="/"
              search={{ tab: value === 'locations' ? undefined : value }}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-accent',
              )}
            >
              <Icon aria-hidden className="size-[18px]" />
              {t(label)}
            </Link>
          );
        })}
      </nav>
      <div className="flex-1" />
      <div className="mt-3 border-t px-3 pt-3">
        <UserMenu variant="sidebar" />
      </div>
    </aside>
  );
}
