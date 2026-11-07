import type { LocationContactDto } from '@inventory/shared';
import { useTranslation } from 'react-i18next';
import { ContactButtons } from '@/components/contact-buttons';

/** Who a contact is, for the buttons' labels: "Správce Jan Novák". */
const whoOf = (contact: LocationContactDto) => [contact.role, contact.name].filter(Boolean).join(' ');

/** A location's contacts as the detail lists them: who, the number and the address, and the buttons to reach them. */
export function ContactList({ contacts }: { contacts: LocationContactDto[] }) {
  const { t } = useTranslation();
  return (
    // Narrow on a wide screen, so the buttons stay next to the number they call.
    <ul className="flex flex-col gap-3 sm:max-w-md">
      {contacts.map((contact, index) => {
        const who = whoOf(contact);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: contacts have no id and a save replaces the whole list
          <li key={index} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p>
                <span className="font-semibold">{contact.role}</span>
                {contact.name && <span> · {contact.name}</span>}
              </p>
              {contact.phone && <p className="tabular-nums">{contact.phone}</p>}
              {contact.email && <p className="break-all text-muted-foreground">{contact.email}</p>}
            </div>
            <ContactButtons
              phone={contact.phone}
              email={contact.email}
              labels={{ call: t('locationDetail.call', { who }), email: t('locationDetail.email', { who }) }}
            />
          </li>
        );
      })}
    </ul>
  );
}
