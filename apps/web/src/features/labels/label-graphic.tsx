import { MM_PER_PT } from './fit-text';
import { PREVIEW_FONT } from './fonts';
import type { LabelPlan } from './label-plan';
import { QUIET_MODULES, type Size } from './layout';
import { qrPath } from './qr';

type Props = {
  plan: LabelPlan;
  /** The QR code's modules (`qrModules`). */
  modules: boolean[][];
  size: Size;
};

/**
 * One label as SVG in millimetres from its top left corner: its outline, the QR code and the text
 * of its plan. The sheet preview places many of these on a page and the label printer preview
 * shows one, so both draw it the same way.
 */
export function LabelGraphic({ plan, modules, size }: Props) {
  const module = plan.qr.width / (modules.length + 2 * QUIET_MODULES);
  return (
    <>
      <rect width={size.width} height={size.height} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="0.15" />
      {plan.qr.width > 0 && (
        <path
          d={qrPath(modules, 1)}
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
    </>
  );
}
