import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { LabelGraphic } from './label-graphic';
import { planLabel } from './label-plan';
import type { Size } from './layout';
import { previewMeasure } from './preview-measure';
import { qrModules } from './qr';
import type { LabelRow } from './selection';

type Props = {
  /** The label shown; every label of a label printer is a page of its own. */
  item: LabelRow;
  size: Size;
  /** From 1, for the screen reader. */
  number: number;
  /** Turns true once the label fonts are loaded, so the text is measured again with them. */
  fontsReady: boolean;
  className?: string;
};

/** One label of a label printer as it will print, from the same plan the PDF is drawn from. */
export function TapePreview({ item, size, number, fontsReady, className }: Props) {
  const { t } = useTranslation();
  const { width, height } = size;
  // Keyed on plain values: `size` is a new object on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fontsReady` only invalidates the text measure
  const { plan, modules } = useMemo(
    () => ({ plan: planLabel(previewMeasure, item, { width, height }), modules: qrModules(item.code) }),
    [item, width, height, fontsReady],
  );

  return (
    <svg
      role="img"
      aria-label={t('labels.layout.tapePreviewLabel', { number })}
      viewBox={`0 0 ${width} ${height}`}
      data-label={item.code}
      className={cn('h-auto w-full rounded-sm border bg-white text-black shadow-sm', className)}
    >
      <LabelGraphic plan={plan} modules={modules} size={size} />
    </svg>
  );
}
