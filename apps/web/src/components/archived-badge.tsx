import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

/** "Archivováno", beside the name of an archived location or item. */
export function ArchivedBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant="warning" className={className}>
      {t('common.archived')}
    </Badge>
  );
}
