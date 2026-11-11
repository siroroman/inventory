import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

/**
 * The scope of a run (SPEC §9.3 rule 18), "Jen s ID Účetnictví", beside its name wherever the run
 * is shown; nothing for a run of every item.
 */
export function ScopeBadge({ source }: { source: string | null }) {
  const { t } = useTranslation();
  if (!source) return null;
  return (
    <Badge variant="info" title={t('inventory.scopeHint', { source })}>
      {t('inventory.scope', { source })}
    </Badge>
  );
}
