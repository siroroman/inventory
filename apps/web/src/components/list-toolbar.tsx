import type { ComponentProps, ReactNode } from 'react';
import { SearchBox } from '@/components/search-box';
import { desktopScreen, useMediaQuery } from '@/lib/use-media-query';

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

/**
 * Heading with the record count, and the search field below it. On desktop (next to the side menu)
 * the search and the "Add" button share the heading's row, as designed.
 */
export function ListToolbar({ title, count, search, action, archived }: Props) {
  const desktop = useMediaQuery(desktopScreen);
  const heading = (
    <div className="flex shrink-0 items-baseline gap-2">
      <h2 className={desktop ? 'text-[22px] font-semibold' : 'text-xl font-semibold'}>{title}</h2>
      {count && (
        <span role="status" className="text-sm whitespace-nowrap text-muted-foreground">
          {count}
        </span>
      )}
    </div>
  );
  return (
    <div className={desktop ? 'flex flex-col gap-2 px-8 pt-7 pb-4' : 'flex flex-col gap-3 px-4 pt-6 pb-5'}>
      {desktop ? (
        <div className="flex items-center justify-between gap-4">
          {heading}
          {/* The search widens with the screen, up to where its whole placeholder fits. */}
          <div className="flex flex-1 items-center justify-end gap-3">
            <div className="w-full max-w-lg">
              <SearchBox {...search} />
            </div>
            {action}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            {heading}
            {action}
          </div>
          <SearchBox {...search} />
        </>
      )}
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

/** The list under a `ListToolbar`: a white card with a rounded border, as the design has it on desktop. */
export function ListFrame({ children }: { children: ReactNode }) {
  return <div className="mx-4 mb-6 overflow-hidden rounded-xl border border-line bg-card lg:mx-8 lg:mb-8">{children}</div>;
}
