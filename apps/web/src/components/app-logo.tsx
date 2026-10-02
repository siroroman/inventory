import { useTranslation } from 'react-i18next';

/** The "SM" square shown before the app name in the top bar and the side menu. */
export function AppLogo() {
  const { t } = useTranslation();
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-[13px] font-bold text-primary-foreground"
    >
      {t('app.logo')}
    </span>
  );
}
