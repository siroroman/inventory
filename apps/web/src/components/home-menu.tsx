import { Link } from '@tanstack/react-router';
import { Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type HomeTab, homeSections } from '@/components/home-sections';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * Hamburger button of the Home top bar on a phone, which replaces the tabs: it opens the list of
 * sections with the current one marked. Radix closes it on a choice, on Escape and on a tap outside,
 * and puts the focus back on the button. Another section starts without search text.
 */
export function HomeMenu({ tab }: { tab: HomeTab }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('nav.menu')}
        className="-ml-1 flex size-11 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Menu aria-hidden className="size-6" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {homeSections.map(({ tab: value, icon: Icon, label }) => {
          const active = value === tab;
          return (
            <DropdownMenuItem key={value} asChild>
              <Link
                to="/"
                search={{ tab: value === 'locations' ? undefined : value }}
                aria-current={active ? 'page' : undefined}
                className={cn('gap-3 font-semibold', active && 'bg-primary text-primary-foreground focus:bg-primary focus:text-primary-foreground')}
              >
                <Icon aria-hidden className="size-[18px]" />
                {t(label)}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
