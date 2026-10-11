import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export const STEP_COUNT = 4;
const keys = ['location', 'items', 'layout', 'download'] as const;

type Props = {
  step: number;
  /** The furthest step already visited: its number and the ones before it are buttons. */
  reached: number;
  onSelect: (step: number) => void;
};

/**
 * The four steps as a numbered list, the current one marked; a phone also gets "Krok 2 ze 4". A step
 * that was already set (the current one excepted) can be tapped to go back to it, or forward again.
 */
export function StepIndicator({ step, reached, onSelect }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <ol aria-label={t('labels.stepsLabel')} className="flex items-center gap-2 text-sm">
        {keys.map((key, index) => {
          const number = index + 1;
          const current = number === step;
          const done = number <= reached && !current;
          const content = (
            <>
              <span
                aria-hidden
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold',
                  current ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
                  done && 'border-primary text-primary',
                )}
              >
                {number}
              </span>
              <span className={cn('truncate', current ? 'font-semibold' : 'text-muted-foreground max-sm:sr-only')}>
                {t(`labels.steps.${key}`)}
              </span>
            </>
          );
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
              {done ? (
                <button
                  type="button"
                  onClick={() => onSelect(number)}
                  className="-mx-1 flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {content}
                </button>
              ) : (
                content
              )}
              {number < STEP_COUNT && <span aria-hidden className="h-px w-4 shrink-0 bg-border sm:w-8" />}
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-muted-foreground sm:sr-only">{t('labels.stepOf', { step, total: STEP_COUNT })}</p>
    </div>
  );
}
