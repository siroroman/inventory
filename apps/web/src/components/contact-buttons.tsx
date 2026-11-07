import { Globe, Mail, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { telHref } from '@/lib/format';

const actionClass = 'rounded-full bg-muted text-foreground hover:bg-accent';

type Props = {
  phone?: string | null;
  email?: string | null;
  web?: string | null;
  /** Screen-reader names of the buttons, already translated and naming who they reach. */
  labels: { call: string; email: string; web?: string };
};

/**
 * Round 44 px buttons to reach someone: call (a `tel:` link, which a phone opens in its dialer),
 * write an email and open a web page. Only what is known is shown; nothing is rendered when
 * nothing is.
 */
export function ContactButtons({ phone, email, web, labels }: Props) {
  if (!phone && !email && !web) return null;
  return (
    <div className="flex shrink-0 gap-2">
      {phone && (
        <Button asChild variant="ghost" size="icon" className={actionClass}>
          <a href={telHref(phone)} aria-label={labels.call}>
            <Phone aria-hidden />
          </a>
        </Button>
      )}
      {email && (
        <Button asChild variant="ghost" size="icon" className={actionClass}>
          <a href={`mailto:${email}`} aria-label={labels.email}>
            <Mail aria-hidden />
          </a>
        </Button>
      )}
      {web && (
        <Button asChild variant="ghost" size="icon" className={actionClass}>
          <a href={web} target="_blank" rel="noopener noreferrer" aria-label={labels.web}>
            <Globe aria-hidden />
          </a>
        </Button>
      )}
    </div>
  );
}
