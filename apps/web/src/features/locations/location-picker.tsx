import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchBox } from '@/components/search-box';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { locationPickerQueryOptions } from './api';
import { pathLabel } from './path';

/** A chosen parent: its id and the path to show for it. */
export type ParentChoice = { id: string; label: string };

type Props = {
  value: ParentChoice | null;
  onChange: (parent: ParentChoice | null) => void;
  /** The location being edited: it cannot be its own parent. */
  excludeId?: string;
};

const option =
  'flex min-h-11 w-full flex-col items-start justify-center px-3.5 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent';

/**
 * Picks the parent of a location. Shows the chosen one (or "none = top level") and a button that
 * opens a search; without a search text only top-level locations are offered, the rest is found by
 * name. Moving a location below its own sub-location is refused by the API, not filtered here.
 */
export function LocationPicker({ value, onChange, excludeId }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const query = useQuery({ ...locationPickerQueryOptions(q), enabled: open, placeholderData: keepPreviousData });
  const rows = query.data?.items.filter((row) => row.id !== excludeId) ?? [];

  const choose = (parent: ParentChoice | null) => {
    onChange(parent);
    setOpen(false);
    setQ('');
  };

  return (
    <fieldset
      className="flex min-w-0 flex-col gap-1.5"
      // Enter in the search field must not submit the surrounding form.
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
      }}
    >
      <legend className="mb-1.5 p-0 text-sm leading-none font-medium">{t('locationForm.parent')}</legend>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-sm">{value?.label ?? t('locationForm.parentNone')}</span>
        <Button type="button" variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t('locationForm.parentDone') : t('locationForm.parentChange')}
        </Button>
      </div>
      {open && (
        <div className="flex flex-col gap-2 rounded-md border p-2">
          <SearchBox
            value={q}
            onSearch={setQ}
            label={t('locationForm.parentSearchLabel')}
            placeholder={t('locationForm.parentSearchPlaceholder')}
          />
          {q === '' && <p className="px-1 text-xs text-muted-foreground">{t('locationForm.parentHint')}</p>}
          {query.isPending ? (
            <Skeleton className="h-11 w-full" />
          ) : query.isError ? (
            <Button type="button" variant="outline" onClick={() => void query.refetch()}>
              {t('common.retry')}
            </Button>
          ) : (
            <>
              <ul className="divide-y overflow-hidden rounded-md border">
                {q === '' && (
                  <li>
                    <button type="button" className={option} onClick={() => choose(null)}>
                      {t('locationForm.parentNone')}
                    </button>
                  </li>
                )}
                {rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={option}
                      onClick={() => choose({ id: row.id, label: pathLabel(row.path) })}
                    >
                      {pathLabel(row.path)}
                    </button>
                  </li>
                ))}
              </ul>
              {q !== '' && rows.length === 0 && (
                <p className="px-1 text-sm text-muted-foreground">{t('locationForm.parentNoResults')}</p>
              )}
              {query.data.total > query.data.items.length && (
                <p className="px-1 text-xs text-muted-foreground">
                  {t('locationForm.parentTooMany', { count: query.data.items.length })}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </fieldset>
  );
}
