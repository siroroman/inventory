import i18n from '@/i18n';
import { ApiError } from './api.ts';

/** Czech text for any error a call can end in. The code decides; the server's title is ignored. */
export function problemMessage(error: unknown): string {
  return i18n.t(`errors.${error instanceof ApiError ? error.code : 'unexpected'}`);
}
