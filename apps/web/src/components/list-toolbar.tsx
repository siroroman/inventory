import type { ComponentProps, ReactNode } from 'react';
import { SearchBox } from '@/components/search-box';

type Props = {
  title: string;
  /** "12 lokalit"; missing until the first page has loaded. */
  count?: string;
  search: ComponentProps<typeof SearchBox>;
  /** An "Add" button beside the heading, for the roles that may add. */
  action?: ReactNode;
  /** "Show archived": a switch under the search that swaps the list for the archived records. */
  archived?: { checked: boolean; onChange: (checked: boolean) => void; label: string };
};

/** Heading with the record count, and the search field below it. */
export function ListToolbar({ title, count, search, action, archived }: Props) {
  return (
    <div className="flex flex-col gap-3 px-4 pt-6 pb-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-semibold">{title}</h2>
          {count && (
            <span role="status" className="text-sm text-muted-foreground">
              {count}
            </span>
          )}
        </div>
        {action}
      </div>
      <SearchBox {...search} />
      {archived && (
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={archived.checked}
            onChange={(event) => archived.onChange(event.target.checked)}
            className="size-5 accent-primary"
          />
          {archived.label}
        </label>
      )}
    </div>
  );
}
