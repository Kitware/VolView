import { describe, expect, it } from 'vitest';

import { migrateManifest } from '@/src/io/state-file/migrations';
import { ManifestSchema } from '@/src/io/state-file/schema';

const view = (id: string, orientation: string) => ({
  id,
  name: orientation,
  type: '2D',
  dataID: null,
  options: { orientation },
});

const migrate = (overrides: Record<string, unknown>) =>
  ManifestSchema.parse(
    migrateManifest(
      JSON.stringify({ version: '8.0.0', dataSources: [], ...overrides })
    ).manifest
  );

describe('8.0.0 -> 9.0.0 migration', () => {
  it('names each layout view and drops views the layout hid', () => {
    const manifest = migrate({
      activeView: 'hidden',
      layout: {
        direction: 'column',
        items: [
          { type: 'slot', slotIndex: 1 },
          {
            type: 'layout',
            direction: 'row',
            items: [
              { type: 'slot', slotIndex: 0 },
              { type: 'slot', slotIndex: 3 },
            ],
          },
        ],
      },
      layoutSlots: ['a', 'b', 'hidden', 'c'],
      viewByID: {
        a: view('a', 'Axial'),
        b: view('b', 'Coronal'),
        hidden: view('hidden', 'Sagittal'),
        c: view('c', 'Axial'),
      },
    });

    expect(manifest.version).toBe('9.0.0');
    expect(manifest.layout).toEqual({
      direction: 'column',
      items: [
        { type: 'view', viewId: 'b' },
        {
          type: 'layout',
          direction: 'row',
          items: [
            { type: 'view', viewId: 'a' },
            { type: 'view', viewId: 'c' },
          ],
        },
      ],
    });
    expect(Object.keys(manifest.viewByID!)).toEqual(['a', 'b', 'c']);
    expect(manifest).not.toHaveProperty('activeView');
    expect(manifest).not.toHaveProperty('layoutSlots');
  });

  it('drops the maximized flag along with a hidden active view', () => {
    const manifest = migrate({
      activeView: 'hidden',
      isActiveViewMaximized: true,
      layout: { direction: 'column', items: [{ type: 'slot', slotIndex: 0 }] },
      layoutSlots: ['a', 'hidden'],
      viewByID: { a: view('a', 'Axial'), hidden: view('hidden', 'Coronal') },
    });
    expect(manifest).not.toHaveProperty('activeView');
    expect(manifest).not.toHaveProperty('isActiveViewMaximized');
  });

  it('drops a layout whose slot has no saved view', () => {
    const manifest = migrate({
      activeView: 'a',
      layout: { direction: 'row', items: [{ type: 'slot', slotIndex: 0 }] },
      viewByID: { a: view('a', 'Axial') },
    });
    expect(manifest).not.toHaveProperty('layout');
    expect(manifest).not.toHaveProperty('activeView');
  });

  it('keeps a shown maximized view', () => {
    const manifest = migrate({
      activeView: 'a',
      isActiveViewMaximized: true,
      layout: { direction: 'column', items: [{ type: 'slot', slotIndex: 0 }] },
      layoutSlots: ['a'],
      viewByID: { a: view('a', 'Axial') },
    });
    expect(manifest.activeView).toBe('a');
    expect(manifest.isActiveViewMaximized).toBe(true);
  });
});
