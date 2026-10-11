import { Minus, Plus } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clamp } from './layout-choice';

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
};

/** A whole number with − and + buttons; typing is allowed and applied (clamped) on leaving the field. */
export function Stepper({ label, value, min, max, onChange }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const typed = Number(text.replace(',', '.'));
    if (text.trim() === '' || Number.isNaN(typed)) {
      setText(String(value));
      return;
    }
    const next = clamp(typed, min, max);
    setText(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t('labels.layout.decrease', { label })}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        >
          <Minus aria-hidden />
        </Button>
        <Input
          id={id}
          inputMode="numeric"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
          className="w-16 text-center"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t('labels.layout.increase', { label })}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        >
          <Plus aria-hidden />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('labels.layout.range', { min, max })}</p>
    </div>
  );
}
