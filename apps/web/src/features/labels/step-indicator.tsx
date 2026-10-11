import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export const STEP_COUNT = 4;
const keys = ['location', 'items', 'layout', 'download'] as const;

/** The four steps as a numbered list, the current one marked; a phone also gets "Krok 2 ze 4". */
export function StepIndicator({ step }: { step: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <ol aria-label={t('labels.stepsLabel')} className="flex items-center gap-2 text-sm">
        {keys.map((key, index) => {
          const number = index + 1;
          const current = number === step;
          return (
            <li
              key={key}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'flex min-w-0 items-center gap-2',
                // On a phone only the current step shows its name; the rest are bare numbers.
                !current && 'max-sm:flex-none',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold',
                  current ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
                  number < step && 'border-primary text-primary',
                )}
              >
                {number}
              </span>
              <span className={cn('truncate', current ? 'font-semibold' : 'text-muted-foreground max-sm:sr-only')}>
                {t(`labels.steps.${key}`)}
              </span>
              {number < STEP_COUNT && <span aria-hidden className="h-px w-4 shrink-0 bg-border sm:w-8" />}
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-muted-foreground sm:sr-only">{t('labels.stepOf', { step, total: STEP_COUNT })}</p>
    </div>
  );
}
