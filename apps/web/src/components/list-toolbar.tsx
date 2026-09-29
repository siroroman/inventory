import type { ComponentProps } from 'react';
import { SearchBox } from '@/components/search-box';

type Props = {
  title: string;
  /** "12 lokalit"; missing until the first page has loaded. */
  count?: string;
  search: ComponentProps<typeof SearchBox>;
};

/** Heading with the record count, and the search field below it. */
export function ListToolbar({ title, count, search }: Props) {
  return (
    <div className="flex flex-col gap-3 px-4 pt-6 pb-5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        {count && (
          <span role="status" className="text-sm text-muted-foreground">
            {count}
          </span>
        )}
      </div>
      <SearchBox {...search} />
    </div>
  );
}
