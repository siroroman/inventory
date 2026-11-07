import { emailAddress } from '@inventory/shared';

/**
 * The form rule for an email: the API's, plus a dot after the @ ("servis@novak" is a typo here;
 * no real address lacks one). The API stays the looser check.
 */
export const isFormEmail = (value: string) =>
  emailAddress.safeParse(value).success && value.split('@').at(-1)!.includes('.');
