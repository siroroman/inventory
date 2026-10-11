import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { problemMessage } from '@/lib/problem';
import { cn } from '@/lib/utils';
import { quickAddQueryOptions } from './api';
import type { LabelRow } from './selection';

const debounceMs = 300;
const flashMs = 1500;

type Props = {
  /** Items already on the list, chosen or not: they are offered as "V seznamu" and cannot be added twice. */
  inList: ReadonlySet<string>;
  onAdd: (row: LabelRow) => void;
};

/**
 * Adds items from anywhere to the list, built for a pile of them: one tap (or Enter on the
 * highlighted row) adds and chooses the item, the field keeps focus with its text selected so the
 * next query replaces it, and the results stay open. An ID typed in full and Enter adds that item
 * at once. What was added is read out through a live region.
 */
export function QuickAdd({ inList, onAdd }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(-1);
  const [notice, setNotice] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), debounceMs);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), flashMs);
    return () => clearTimeout(timer);
  }, [flash]);

  const query = useQuery({
    ...quickAddQueryOptions(q),
    enabled: q !== '',
    placeholderData: (previous) => previous,
  });
  const rows = q === '' ? [] : (query.data?.items ?? []);

  const add = (row: LabelRow) => {
    onAdd(row);
    setFlash(row.id);
    setNotice(t('labels.quickAdd.addedNotice', { name: row.name, code: row.code }));
    // The text stays selected, so typing the next query replaces it.
    input.current?.focus();
    input.current?.select();
  };

  const activate = async () => {
    const typed = text.trim();
    if (typed === '') return;
    setFailure(undefined);
    try {
      // The pause before the search may not be over yet, or its answer not in (the old results stay
      // up meanwhile): ask for exactly what is typed.
      const found =
        typed === q && query.data && !query.isPlaceholderData
          ? query.data
          : await queryClient.fetchQuery(quickAddQueryOptions(typed));
      const exact = found.items.find((row) => row.code.toLowerCase() === typed.toLowerCase());
      const highlighted = typed === q && active >= 0 ? rows[active] : undefined;
      const target = exact ?? highlighted;
      if (target && !inList.has(target.id)) add(target);
    } catch (error) {
      setFailure(problemMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="labels-quick-add" className="text-sm font-medium">
        {t('labels.quickAdd.label')}
      </label>
      <Input
        ref={input}
        id="labels-quick-add"
        type="search"
        role="combobox"
        aria-expanded={q !== ''}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 && rows[active] ? `${listId}-${rows[active].id}` : undefined}
        placeholder={t('labels.quickAdd.placeholder')}
        value={text}
        maxLength={100}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="done"
        onChange={(event) => {
          setText(event.target.value);
          setActive(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(rows.length - 1, index + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(-1, index - 1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            void activate();
          } else if (event.key === 'Escape') {
            setText('');
            setActive(-1);
          }
        }}
      />
      <p role="status" className="sr-only">
        {notice}
      </p>
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
      {q !== '' &&
        (query.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t('labels.quickAdd.error')} {problemMessage(query.error)}
          </p>
        ) : query.data === undefined ? (
          <Skeleton role="status" aria-label={t('states.loading')} className="h-11 w-full" />
        ) : (
          <div
            id={listId}
            role="listbox"
            aria-label={t('labels.quickAdd.results')}
            className="max-h-72 divide-y overflow-y-auto rounded-md border bg-card"
            // A tap on a result must not take the focus (and the keyboard) away from the field.
            onMouseDown={(event) => event.preventDefault()}
          >
            {rows.map((row, index) => {
              const listed = inList.has(row.id);
              return (
                <div
                  key={row.id}
                  id={`${listId}-${row.id}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === active}
                  aria-disabled={listed}
                  onClick={() => !listed && add(row)}
                  onKeyDown={(event) => {
                    if (!listed && (event.key === 'Enter' || event.key === ' ')) add(row);
                  }}
                  className={cn(
                    'flex min-h-11 items-center justify-between gap-3 px-3.5 py-2',
                    listed ? 'text-muted-foreground' : 'cursor-pointer hover:bg-accent',
                    index === active && 'bg-accent',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-[15px] break-words">{row.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {row.code}
                      {row.path && ` · ${row.path}`}
                    </span>
                  </span>
                  {listed && (
                    <span className="shrink-0 text-sm font-medium">
                      {flash === row.id ? t('labels.quickAdd.added') : t('labels.quickAdd.inList')}
                    </span>
                  )}
                </div>
              );
            })}
            {rows.length === 0 && (
              <p className="px-3.5 py-3 text-sm text-muted-foreground">{t('labels.quickAdd.nothingFound')}</p>
            )}
          </div>
        ))}
    </div>
  );
}
