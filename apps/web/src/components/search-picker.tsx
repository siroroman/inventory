import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { type FocusEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
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
  /** Adds a button that empties the choice; for optional fields. */
  clearable?: boolean;
  /** Offers to make a new record from the typed text; resolves to the option to select. */
  create?: { label: (text: string) => string; run: (text: string) => Promise<PickerOption> };
};

const debounceMs = 300;

/**
 * Pick one record by searching for it. Once chosen it shows as a field; tapping it opens the
 * search again (the choice stays until another one is picked), and `clearable` adds a button that
 * empties it. The search lists the matches live, 300 ms after the last keystroke.
 */
export function SearchPicker({ id, label, value, onChange, search, placeholder, emptyText, error, clearable, create }: Props) {
  const { t } = useTranslation();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const container = useRef<HTMLDivElement>(null);
  // The results are collapsed until the field is used, so the form stays short.
  const [open, setOpen] = useState(false);
  // Searching for a replacement while a value is chosen; without a value the search is always shown.
  const [editing, setEditing] = useState(false);
  const showSearch = value === null || editing;
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), debounceMs);
    return () => clearTimeout(timer);
  }, [text]);

  const query = useQuery({ ...search(q), enabled: showSearch && open, placeholderData: (previous) => previous });
  const typed = text.trim();
  const canCreate =
    create !== undefined &&
    typed !== '' &&
    query.data !== undefined &&
    q === typed &&
    !query.data.some((option) => option.label.toLowerCase() === typed.toLowerCase());

  const describedBy = error ? `${id}-error` : undefined;

  // The results close when focus leaves the field and its list, and on Escape.
  const closing = {
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (container.current?.contains(event.relatedTarget)) return;
      setOpen(false);
      setEditing(false);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      setEditing(false);
    },
  };

  const pick = (option: PickerOption) => {
    onChange(option);
    setOpen(false);
    setEditing(false);
    setText('');
    setQ('');
    setCreateError(undefined);
  };

  const chosen = value !== null && !editing;

  return (
    <div ref={container} className="flex flex-col gap-2">
      {chosen ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            id={id}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onClick={() => {
              setEditing(true);
              // The search field is mounted by the next render; focusing it opens the results.
              setTimeout(() => input.current?.focus());
            }}
            className="flex min-h-11 min-w-0 flex-1 items-center rounded-md border border-input bg-card px-3.5 text-left text-base break-words hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {value.label}
          </button>
          {clearable && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t('picker.clear', { label })}
              onClick={() => {
                onChange(null);
                setEditing(false);
              }}
            >
              <X aria-hidden />
            </Button>
          )}
        </div>
      ) : (
        <Input
          ref={input}
          id={id}
          type="search"
          placeholder={editing && value ? value.label : placeholder}
          value={text}
          maxLength={120}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onFocus={() => setOpen(true)}
          {...closing}
        />
      )}
      {!open || !showSearch ? null : query.isError ? (
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
          // Clicking a result must not blur the field first (Safari does not focus buttons on click).
          onMouseDown={(event) => event.preventDefault()}
        >
          {query.data.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => pick(option)}
                {...closing}
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
                {...closing}
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
