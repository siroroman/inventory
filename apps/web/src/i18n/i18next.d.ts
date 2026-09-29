import 'i18next';
import type cs from './cs.json';

// Types `t()` keys from cs.json: a typo, or an error code without Czech text, fails the typecheck.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof cs };
  }
}
