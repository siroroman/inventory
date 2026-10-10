import type { PersonRef } from '@inventory/shared';
import { initials } from '@/features/auth/initials';

/** "RS": a person as the design writes them in a sentence. The full names are listed next to the avatars. */
export const shortName = (person: PersonRef) => initials(person.name, '');

const list = new Intl.ListFormat('cs', { style: 'long', type: 'conjunction' });

/** "RS, JN a PČ" */
export const shortNames = (people: PersonRef[]) => list.format(people.map(shortName));
