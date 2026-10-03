import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { RankedProviderDto } from '@inventory/shared';
import { Link } from '@tanstack/react-router';
import { Globe, GripVertical, Mail, Phone } from 'lucide-react';
import { type ComponentProps, type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchivedBadge } from '@/components/archived-badge';
import { Button } from '@/components/ui/button';
import { telHref } from '@/lib/format';
import { cn } from '@/lib/utils';

type Props = {
  /** In contact order, first to call first. */
  providers: RankedProviderDto[];
  /** Given, writers drag the cards into a new order; called with the whole new order of provider IDs. */
  onReorder?: (providerIds: string[]) => void;
  /** A save is under way: the cards cannot be dragged until it is done. */
  busy?: boolean;
};

const actionClass = 'rounded-full bg-muted text-foreground hover:bg-accent';

/** What a card offers to reach the provider; only what is known. */
function ContactActions({ provider }: { provider: RankedProviderDto }) {
  const { t } = useTranslation();
  const { name, phone, email, web } = provider;
  if (!phone && !email && !web) return null;
  return (
    <div className="flex shrink-0 gap-2">
      {phone && (
        <Button asChild variant="ghost" size="icon" className={actionClass}>
          <a href={telHref(phone)} aria-label={t('manufacturer.call', { name })}>
            <Phone aria-hidden />
          </a>
        </Button>
      )}
      {email && (
        <Button asChild variant="ghost" size="icon" className={actionClass}>
          <a href={`mailto:${email}`} aria-label={t('manufacturer.email', { name })}>
            <Mail aria-hidden />
          </a>
        </Button>
      )}
      {web && (
        <Button asChild variant="ghost" size="icon" className={actionClass}>
          <a href={web} target="_blank" rel="noopener noreferrer" aria-label={t('manufacturer.web', { name })}>
            <Globe aria-hidden />
          </a>
        </Button>
      )}
    </div>
  );
}

/** One numbered card; `handle` is the drag handle of a list that can be reordered. */
function ProviderCard({
  provider,
  position,
  handle,
  className,
  ...props
}: { provider: RankedProviderDto; position: number; handle?: ReactNode } & ComponentProps<'li'>) {
  const { t } = useTranslation();
  return (
    <li className={cn('flex items-center gap-2 rounded-lg border bg-card p-3', className)} {...props}>
      {handle}
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
      >
        {position}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <Link
            to="/service-providers/$id"
            params={{ id: provider.id }}
            className="text-[15px] font-semibold break-words hover:underline"
          >
            {provider.name}
          </Link>
          {provider.archivedAt && <ArchivedBadge className="ml-2 align-middle" />}
          <p className="mt-0.5 text-sm break-words text-muted-foreground">
            {[provider.contactPerson, provider.phone].filter(Boolean).join(' · ') || t('common.empty')}
          </p>
        </div>
        <ContactActions provider={provider} />
      </div>
    </li>
  );
}

function SortableProviderCard({ provider, position, disabled }: { provider: RankedProviderDto; position: number; disabled: boolean }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: provider.id,
    disabled,
    attributes: { roleDescription: t('manufacturer.drag.role') },
  });
  return (
    <ProviderCard
      ref={setNodeRef}
      provider={provider}
      position={position}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && 'relative z-10 shadow-lg')}
      handle={
        <Button
          ref={setActivatorNodeRef}
          type="button"
          variant="ghost"
          size="icon"
          // No touch-action, so a finger on the handle drags the card instead of scrolling the page.
          className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
          aria-label={t('manufacturer.drag.handle', { name: provider.name })}
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden />
        </Button>
      }
    />
  );
}

// The cards are one column: a card follows the pointer up and down only.
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * The cards in a list that writers reorder by dragging a card by its handle, with a mouse, a
 * finger or the keyboard (Space to pick up, arrows to move, Space to drop, Escape to cancel).
 */
function SortableProviders({ providers, onReorder, busy }: Required<Props>) {
  const { t } = useTranslation();
  // The dropped order shows straight away, before the owner hands back the saved one.
  const [order, setOrder] = useState(providers);
  const [given, setGiven] = useState(providers);
  if (providers !== given) {
    setGiven(providers);
    setOrder(providers);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const place = (id: UniqueIdentifier) => {
    const index = order.findIndex((p) => p.id === id);
    return { name: order[index]?.name ?? '', position: index + 1, total: order.length };
  };
  // The place last read out: the library reports the card over its own place right after it is
  // picked up, which would drown out "picked up".
  const announcedOver = useRef<UniqueIdentifier | undefined>(undefined);
  // Read out in Czech; the library's own texts are English.
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      announcedOver.current = active.id;
      return t('manufacturer.drag.start', place(active.id));
    },
    onDragOver: ({ active, over }) => {
      if (!over || over.id === announcedOver.current) return undefined;
      announcedOver.current = over.id;
      return t('manufacturer.moved', { ...place(over.id), name: place(active.id).name });
    },
    onDragEnd: ({ active, over }) => (over ? t('manufacturer.moved', { ...place(over.id), name: place(active.id).name }) : undefined),
    onDragCancel: ({ active }) => t('manufacturer.drag.cancel', place(active.id)),
  };

  const drop = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, place(active.id).position - 1, place(over.id).position - 1);
    setOrder(next);
    onReorder(next.map((p) => p.id));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t('manufacturer.drag.instructions') } }}
      onDragEnd={drop}
    >
      <SortableContext items={order.map((p) => p.id)} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col gap-3">
          {order.map((provider, index) => (
            <SortableProviderCard key={provider.id} provider={provider} position={index + 1} disabled={busy} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

/**
 * The service providers of a brand as numbered cards in one column, in the order to contact them.
 * With `onReorder` (and two or more cards) each card has a handle to drag it to another place.
 */
export function RankedProviders({ providers, onReorder, busy = false }: Props) {
  if (onReorder && providers.length > 1) return <SortableProviders providers={providers} onReorder={onReorder} busy={busy} />;
  return (
    <ol className="flex flex-col gap-3">
      {providers.map((provider, index) => (
        <ProviderCard key={provider.id} provider={provider} position={index + 1} />
      ))}
    </ol>
  );
}
