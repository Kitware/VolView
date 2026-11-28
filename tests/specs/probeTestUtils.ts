import { expect, type Locator, type Page } from '@playwright/test';

export type ProbeReadout = {
  position: number[];
  decimals: number;
  voxel: number[];
  samples: string[];
};

export type VoxelGeometry = {
  origin: readonly number[];
  spacing: readonly number[];
  // Column-major 3x3, as vtk image data stores it.
  direction?: readonly number[];
};

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const worldPosition = (geometry: VoxelGeometry, voxel: number[]) => {
  const direction = geometry.direction ?? IDENTITY;
  const scaled = voxel.map((index, axis) => index * geometry.spacing[axis]);
  return geometry.origin.map(
    (offset, row) =>
      offset +
      scaled.reduce(
        (sum, value, column) => sum + direction[column * 3 + row] * value,
        0
      )
  );
};

const parseReadout = (rows: string[][]) => {
  const valueOf = (label: string) => {
    const row = rows.find(([name]) => name === label);
    if (!row) throw new Error(`The probe shows no ${label} row`);
    return row[1];
  };
  const positionText = valueOf('Position')
    .split(',')
    .map((text) => text.trim());
  return {
    position: positionText.map(Number),
    decimals: positionText[0].split('.')[1]?.length ?? 0,
    voxel: valueOf('Voxel').split(',').map(Number),
    samples: rows
      .filter(([name]) => name !== 'Position' && name !== 'Voxel')
      .map(([, value]) => value),
  };
};

export const createProbeUtils = (page: Page) => {
  const card = page.locator('.probe-value-display');

  const readProbe = async () =>
    parseReadout(
      await card
        .locator('.v-card-text > div')
        .evaluateAll((rows) =>
          rows.map((row) =>
            Array.from(row.children).map(
              (cell) => cell.textContent?.trim() ?? ''
            )
          )
        )
    );

  // Leaving the view clears the readout, so the next one shown is fresh.
  const probeAt = async (view: Locator, fx: number, fy: number) => {
    const box = await view.locator('canvas').first().boundingBox();
    if (!box) throw new Error('The view has no canvas on screen');
    await page.mouse.move(0, 0);
    await expect(card).toBeHidden();
    const x = Math.round(box.x + box.width * fx);
    const y = Math.round(box.y + box.height * fy);
    await page.mouse.move(x + 2, y + 2);
    await page.mouse.move(x, y);
    await expect(card).toBeVisible();
    const readout = await readProbe();
    await page.mouse.move(0, 0);
    await expect(card).toBeHidden();
    return readout;
  };

  // A printed position is exact to half a unit in its last decimal.
  const expectProbedPositions = async (
    view: Locator,
    geometry: VoxelGeometry,
    points: readonly (readonly [number, number])[]
  ) => {
    for (const [fx, fy] of points) {
      const readout = await probeAt(view, fx, fy);
      const tolerance = 0.5 * 10 ** -readout.decimals + 1e-9;
      const expected = worldPosition(geometry, readout.voxel);
      readout.position.forEach((value, axis) =>
        expect(
          Math.abs(value - expected[axis]),
          `Probe position axis ${axis} at voxel ${readout.voxel}: shown ${value}, expected ${expected[axis]}`
        ).toBeLessThanOrEqual(tolerance)
      );
    }
  };

  // For an axis-aligned image whose origin the test does not know.
  const expectProbedStep = (
    before: ProbeReadout,
    after: ProbeReadout,
    spacing: readonly number[]
  ) => {
    expect(after.voxel).not.toEqual(before.voxel);
    const tolerance = 10 ** -before.decimals + 1e-9;
    after.position.forEach((value, axis) =>
      expect(
        Math.abs(
          value -
            before.position[axis] -
            (after.voxel[axis] - before.voxel[axis]) * spacing[axis]
        ),
        `Probe step axis ${axis} from voxel ${before.voxel} to ${after.voxel}`
      ).toBeLessThanOrEqual(tolerance)
    );
  };

  return { probeAt, expectProbedPositions, expectProbedStep };
};

export type ProbeUtils = ReturnType<typeof createProbeUtils>;
