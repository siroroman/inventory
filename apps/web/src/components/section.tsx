import { type ReactNode, useId } from 'react';

/** The title of a section: normal text above its box, never inside it. */
export const sectionTitleClass = 'text-lg font-semibold';

/** A white box with its title above it, aligned with the box. Without a title it is just the box. */
export function Section({ title, children }: { title?: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={title ? titleId : undefined} className="flex flex-col gap-2">
      {title && (
        <h2 id={titleId} className={sectionTitleClass}>
          {title}
        </h2>
      )}
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">{children}</div>
    </section>
  );
}
