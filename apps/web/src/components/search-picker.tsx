import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { problemMessage } from '@/lib/problem';

export type PickerOption = { id: string; label: string };

type Props = {
  id: string;
  label: string;
  value: PickerOption | null;
  onChange: (value: PickerOption | null) => void;
  /** Query options for the options matching `q` (empty = the default list). */
  search: (q: string) => {
    queryKey: readonly unknown[];
    queryFn: () => Promise<PickerOption[]>;
  };
  placeholder: string;
  emptyText: string;
  error?: string;
  /** Offers to make a new record from the typed text; resolves to the option to select. */
  create?: { label: (text: string) => string; run: (text: string) => Promise<PickerOption> };
};

const debounceMs = 300;

/**
 * Pick one record by searching for it. Once chosen it shows as text with a button to change it;
 * until then a search field lists the matches (live, 300 ms after the last keystroke).
 */
export function SearchPicker({ id, label, value, onChange, search, placeholder, emptyText, error, create }: Props) {
  const { t } = useTranslation();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), debounceMs);
    return () => clearTimeout(timer);
  }, [text]);

  const query = useQuery({ ...search(q), enabled: value === null, placeholderData: (previous) => previous });
  const typed = text.trim();
  const canCreate =
    create !== undefined &&
    typed !== '' &&
    query.data !== undefined &&
    q === typed &&
    !query.data.some((option) => option.label.toLowerCase() === typed.toLowerCase());

  const describedBy = error ? `${id}-error` : undefined;

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <p
          id={id}
          className="flex min-h-11 min-w-0 flex-1 items-center rounded-md border border-input bg-card px-3.5 text-base break-words"
        >
          {value.label}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onChange(null);
            setText('');
            setQ('');
            // The input is mounted by the next render.
            setTimeout(() => input.current?.focus());
          }}
          aria-label={t('picker.change', { label })}
        >
          <X aria-hidden />
          {t('picker.changeShort')}
        </Button>
      </div>
    );
  }

  const pick = (option: PickerOption) => {
    onChange(option);
    setCreateError(undefined);
  };

  return (
    <div className="flex flex-col gap-2">
      <Input
        ref={input}
        id={id}
        type="search"
        placeholder={placeholder}
        value={text}
        maxLength={120}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => setText(event.target.value)}
      />
      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {problemMessage(query.error)}{' '}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            {t('common.retry')}
          </button>
        </p>
      ) : query.data === undefined ? (
        <Skeleton role="status" aria-label={t('states.loading')} className="h-11 w-full" />
      ) : (
        <ul
          id={listId}
          aria-label={t('picker.results', { label })}
          className="max-h-64 divide-y overflow-y-auto rounded-md border bg-card"
        >
          {query.data.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => pick(option)}
                className="min-h-11 w-full px-3.5 py-2 text-left text-[15px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                {option.label}
              </button>
            </li>
          ))}
          {canCreate && (
            <li>
              <button
                type="button"
                disabled={creating}
                onClick={() => {
                  setCreating(true);
                  setCreateError(undefined);
                  create
                    .run(typed)
                    .then(pick, (failure) => setCreateError(problemMessage(failure)))
                    .finally(() => setCreating(false));
                }}
                className="min-h-11 w-full px-3.5 py-2 text-left text-[15px] font-medium text-primary hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-40"
              >
                {create.label(typed)}
              </button>
            </li>
          )}
          {query.data.length === 0 && !canCreate && (
            <li className="px-3.5 py-3 text-sm text-muted-foreground">{emptyText}</li>
          )}
        </ul>
      )}
      {createError && (
        <p role="alert" className="text-sm text-destructive">
          {createError}
        </p>
      )}
    </div>
  );
}
