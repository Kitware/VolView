import { TOOL_COLORS } from '@/src/config';
import type { ConfiguredSegments } from '@/src/io/import/configSegments';
import { cssColorToRGBA, tryCssColorToRGBA } from '@/src/segmentation/color';
import { cleanUndefined } from '@/src/utils';

// An unparseable color is left out, so the segment keeps the color it has.
export const fromConfigured = (
  name: string,
  configured: ConfiguredSegments[string]
) => ({
  ...cleanUndefined({
    color: configured.color ? tryCssColorToRGBA(configured.color) : undefined,
    fillOpacity: configured.fillOpacity,
    outlineOpacity: configured.outlineOpacity,
    strokeWidth: configured.strokeWidth,
  }),
  name,
});

// Palette colors wrap when an image exhausts the available colors.
export const configuredColor = (index: number) =>
  cssColorToRGBA(TOOL_COLORS[index % TOOL_COLORS.length]);
