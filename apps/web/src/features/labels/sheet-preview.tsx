import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PREVIEW_FONT } from './fonts';
import { planLabel } from './label-plan';
import {
  cellOrigin,
  type Grid,
  labelSize,
  PAGE_HEIGHT_MM,
  PAGE_MARGIN_MM,
  PAGE_WIDTH_MM,
  placement,
  QUIET_MODULES,
  slotsPerPage,
} from './layout';
import { previewMeasure } from './preview-measure';
import { qrModules } from './qr';
import type { LabelRow } from './selection';

type Props = {
  items: LabelRow[];
  grid: Grid;
  startPosition: number;
  /** From 0. */
  page: number;
};

const MM_PER_PT = 25.4 / 72;

/** The dark modules of one QR code as a single path in module units. */
function modulesPath(modules: boolean[][]): string {
  const parts: string[] = [];
  for (const [r, row] of modules.entries()) {
    for (let c = 0; c < row.length; ) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < row.length && row[c]) c++;
      parts.push(`M${start} ${r}h${c - start}v1h${start - c}z`);
    }
  }
  return parts.join('');
}

/**
 * One whole A4 sheet as it will print: the margin, the places already used (hatched) and the
 * labels with their real QR codes and text, from the same plan the PDF is drawn from.
 */
export function SheetPreview({ items, grid, startPosition, page }: Props) {
  const { t } = useTranslation();
  const size = labelSize(grid);
  const perPage = slotsPerPage(grid);

  const labels = useMemo(() => {
    const onPage: { row: LabelRow; at: { row: number; column: number } }[] = [];
    items.forEach((row, index) => {
      const place = placement(grid, startPosition, index);
      if (place.page === page) onPage.push({ row, at: { row: place.row, column: place.column } });
    });
    return onPage.map(({ row, at }) => ({ row, at, plan: planLabel(previewMeasure, row, size), modules: qrModules(row.code) }));
  }, [items, grid, startPosition, page, size]);

  // The places before the start position, on the first sheet only.
  const used = page === 0 ? startPosition - 1 : 0;
  const usedCells = Array.from({ length: Math.min(used, perPage) }, (_, slot) => ({
    row: Math.floor(slot / grid.columns),
    column: slot % grid.columns,
  }));

  return (
    <svg
      role="img"
      aria-label={t('labels.layout.previewLabel', { page: page + 1 })}
      viewBox={`0 0 ${PAGE_WIDTH_MM} ${PAGE_HEIGHT_MM}`}
      className="w-full rounded-sm border bg-white text-black shadow-sm"
    >
      <defs>
        <pattern id="labels-used" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="3" stroke="#9aa0a6" strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect
        x={PAGE_MARGIN_MM}
        y={PAGE_MARGIN_MM}
        width={PAGE_WIDTH_MM - 2 * PAGE_MARGIN_MM}
        height={PAGE_HEIGHT_MM - 2 * PAGE_MARGIN_MM}
        fill="none"
        stroke="#c4c9d0"
        strokeWidth="0.2"
        strokeDasharray="1 1"
      />
      {usedCells.map(({ row, column }) => {
        const origin = cellOrigin(grid, row, column);
        return (
          <rect
            key={`${row}-${column}`}
            data-used
            x={origin.x}
            y={origin.y}
            width={size.width}
            height={size.height}
            fill="url(#labels-used)"
            stroke="#c4c9d0"
            strokeWidth="0.15"
          />
        );
      })}
      {labels.map(({ row, at, plan, modules }) => {
        const origin = cellOrigin(grid, at.row, at.column);
        const module = plan.qr.width / (modules.length + 2 * QUIET_MODULES);
        return (
          <g key={row.id} data-label={row.code} transform={`translate(${origin.x} ${origin.y})`}>
            <rect width={size.width} height={size.height} fill="none" stroke="#c4c9d0" strokeWidth="0.15" />
            {plan.qr.width > 0 && (
              <path
                d={modulesPath(modules)}
                fill="currentColor"
                transform={`translate(${plan.qr.x + QUIET_MODULES * module} ${plan.qr.y + QUIET_MODULES * module}) scale(${module})`}
              />
            )}
            {plan.lines.map((line, index) => (
              <text
                // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional and never reordered
                key={index}
                x={line.x}
                y={line.baseline}
                fontSize={line.size * MM_PER_PT}
                fontWeight={line.bold ? 700 : 400}
                fontFamily={`${PREVIEW_FONT}, Roboto, sans-serif`}
                fill="currentColor"
              >
                {line.text}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
