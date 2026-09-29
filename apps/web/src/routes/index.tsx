import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  const { t } = useTranslation();
  return (
    <div className="p-4">
      <h1 className="text-xl font-semibold">{t('home.title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('home.placeholder')}</p>
    </div>
  );
}
