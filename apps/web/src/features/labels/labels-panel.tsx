import { useTranslation } from 'react-i18next';
import { desktopScreen, useMediaQuery } from '@/lib/use-media-query';

/**
 * The Štítky section of Home. The wizard that makes the PDF of QR labels (SPEC §9.4.12) is built
 * in steps; until then the section only says so.
 */
export function LabelsPanel() {
  const { t } = useTranslation();
  const desktop = useMediaQuery(desktopScreen);
  return (
    <div className={desktop ? 'flex flex-col gap-2 px-8 pt-7 pb-4' : 'flex flex-col gap-3 px-4 pt-6 pb-5'}>
      <h2 className={desktop ? 'text-[28px] font-semibold' : 'text-2xl font-semibold'}>{t('home.labels.title')}</h2>
      <p className="text-muted-foreground">{t('home.labels.placeholder')}</p>
    </div>
  );
}
