import type { RankedProviderDto } from '@inventory/shared';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronUp, Globe, Mail, Phone } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchivedBadge } from '@/components/archived-badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  /** In contact order, first to call first. */
  providers: RankedProviderDto[];
  /** Given, the cards get up/down arrows; called with the whole new order of provider IDs and the card that moved. */
  onReorder?: (providerIds: string[], moved: { name: string; position: number }) => void;
  /** A save is under way: the arrows do nothing until it is done. */
  busy?: boolean;
};

const actionClass = 'rounded-full bg-muted text-foreground hover:bg-accent';

/** What a card offers to reach the provider; only what is known. */
function ContactActions({ provider }: { provider: RankedProviderDto }) {
  const { t } = useTranslation();
  const { name, phone, email, web } = provider;
  if (!phone && !email && !web) return null;
  return (
    <div className="flex gap-2">
      {phone && (
        <Button asChild variant="ghost" size="icon" className={actionClass}>
          <a href={`tel:${phone.replace(/\s+/g, '')}`} aria-label={t('manufacturer.call', { name })}>
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

/**
 * The service providers of a brand as numbered cards, in the order to contact them. With
 * `onReorder` each card has arrows that move it one place; the arrows keep the focus where it was
 * (they are `aria-disabled` rather than `disabled` at the ends and while saving, which would drop it).
 */
export function RankedProviders({ providers, onReorder, busy = false }: Props) {
  const { t } = useTranslation();
  const arrows = useRef(new Map<string, HTMLButtonElement>());
  // The arrow to focus once the new order is rendered: a moved card is a moved DOM node.
  const focusAfterMove = useRef<string | undefined>(undefined);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after every new order
  useEffect(() => {
    if (focusAfterMove.current) arrows.current.get(focusAfterMove.current)?.focus();
    focusAfterMove.current = undefined;
  }, [providers]);

  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (!onReorder || busy || target < 0 || target >= providers.length) return;
    const ids = providers.map((p) => p.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    focusAfterMove.current = `${providers[index]!.id}:${by}`;
    onReorder(ids, { name: providers[index]!.name, position: target + 1 });
  };

  const arrow = (provider: RankedProviderDto, index: number, by: -1 | 1) => {
    const atEnd = by === -1 ? index === 0 : index === providers.length - 1;
    const Icon = by === -1 ? ChevronUp : ChevronDown;
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        ref={(element) => {
          const key = `${provider.id}:${by}`;
          if (element) arrows.current.set(key, element);
          else arrows.current.delete(key);
        }}
        aria-label={t(by === -1 ? 'manufacturer.moveUp' : 'manufacturer.moveDown', { name: provider.name })}
        aria-disabled={atEnd || busy ? true : undefined}
        className={cn('text-muted-foreground', (atEnd || busy) && 'opacity-40')}
        onClick={() => move(index, by)}
      >
        <Icon aria-hidden />
      </Button>
    );
  };

  return (
    <ol className="grid gap-3 lg:grid-cols-3">
      {providers.map((provider, index) => (
        <li key={provider.id} className="flex items-center gap-2 rounded-lg border bg-card p-3">
          <div className="flex shrink-0 flex-col items-center">
            {onReorder && providers.length > 1 && arrow(provider, index, -1)}
            <span
              aria-hidden
              className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
            >
              {provider.priority}
            </span>
            {onReorder && providers.length > 1 && arrow(provider, index, 1)}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div>
              <Link
                to="/service-providers/$id"
                params={{ id: provider.id }}
                className="text-[15px] font-semibold break-words hover:underline"
              >
                {provider.name}
              </Link>
              {provider.archivedAt && <ArchivedBadge className="ml-2 align-middle" />}
            </div>
            <p className="text-sm break-words text-muted-foreground">
              {[provider.contactPerson, provider.phone].filter(Boolean).join(' · ') || t('common.empty')}
            </p>
            <ContactActions provider={provider} />
          </div>
        </li>
      ))}
    </ol>
  );
}
