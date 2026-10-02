import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Label and value pairs of a detail screen; an empty value shows as "—". */
export function DetailFields({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  const { t } = useTranslation();
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(({ label, value }) => (
        <div key={label}>
          <dt className="text-sm font-semibold text-foreground">{label}</dt>
          <dd className="text-[15px] break-words">
            {value === null || value === undefined || value === '' ? t('common.empty') : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
