import { describe, it, expect } from 'vitest';

describe('Layout Migration (600 to 610)', () => {
  it('should migrate simple H direction to column', () => {
    const input = {
      version: '6.0.0',
      layout: {
        direction: 'H',
        items: [
          { type: 'slot', slotIndex: 0 },
          { type: 'slot', slotIndex: 1 },
        ],
      },
    };

    const migrated = JSON.parse(JSON.stringify(input));
    migrated.layout.direction = 'column';
    migrated.version = '6.1.0';

    expect(migrated.layout.direction).toBe('column');
    expect(migrated.version).toBe('6.1.0');
  });

  it('should migrate simple V direction to row', () => {
    const input = {
      version: '6.0.0',
      layout: {
        direction: 'V',
        items: [
          { type: 'slot', slotIndex: 0 },
          { type: 'slot', slotIndex: 1 },
        ],
      },
    };

    const migrated = JSON.parse(JSON.stringify(input));
    migrated.layout.direction = 'row';
    migrated.version = '6.1.0';

    expect(migrated.layout.direction).toBe('row');
    expect(migrated.version).toBe('6.1.0');
  });

  it('should migrate nested layouts recursively', () => {
    const input = {
      version: '6.0.0',
      layout: {
        direction: 'H',
        items: [
          {
            type: 'layout',
            direction: 'V',
            items: [
              { type: 'slot', slotIndex: 0 },
              { type: 'slot', slotIndex: 1 },
            ],
          },
          {
            type: 'layout',
            direction: 'V',
            items: [
              { type: 'slot', slotIndex: 2 },
              { type: 'slot', slotIndex: 3 },
            ],
          },
        ],
      },
    };

    const migrated = JSON.parse(JSON.stringify(input));
    migrated.layout.direction = 'column';
    migrated.layout.items[0].direction = 'row';
    migrated.layout.items[1].direction = 'row';
    migrated.version = '6.1.0';

    expect(migrated.layout.direction).toBe('column');
    expect(migrated.layout.items[0].direction).toBe('row');
    expect(migrated.layout.items[1].direction).toBe('row');
    expect(migrated.version).toBe('6.1.0');
  });

  it('should migrate deeply nested layouts', () => {
    const input = {
      version: '6.0.0',
      layout: {
        direction: 'H',
        items: [
          { type: 'slot', slotIndex: 0 },
          {
            type: 'layout',
            direction: 'V',
            items: [
              { type: 'slot', slotIndex: 1 },
              {
                type: 'layout',
                direction: 'H',
                items: [
                  { type: 'slot', slotIndex: 2 },
                  { type: 'slot', slotIndex: 3 },
                ],
              },
            ],
          },
        ],
      },
    };

    const migrated = JSON.parse(JSON.stringify(input));
    migrated.layout.direction = 'column';
    migrated.layout.items[1].direction = 'row';
    migrated.layout.items[1].items[1].direction = 'column';
    migrated.version = '6.1.0';

    expect(migrated.layout.direction).toBe('column');
    expect(migrated.layout.items[1].direction).toBe('row');
    expect(migrated.layout.items[1].items[1].direction).toBe('column');
    expect(migrated.version).toBe('6.1.0');
  });

  it('should preserve non-layout fields', () => {
    const input = {
      version: '6.0.0',
      layout: {
        direction: 'H',
        items: [{ type: 'slot', slotIndex: 0 }],
      },
      layoutSlots: ['view-1'],
      viewByID: {
        'view-1': { id: 'view-1', name: 'Axial', type: '2D' },
      },
      isActiveViewMaximized: false,
      activeView: 'view-1',
    };

    const migrated = JSON.parse(JSON.stringify(input));
    migrated.layout.direction = 'column';
    migrated.version = '6.1.0';

    expect(migrated.layoutSlots).toEqual(['view-1']);
    expect(migrated.viewByID).toEqual({
      'view-1': { id: 'view-1', name: 'Axial', type: '2D' },
    });
    expect(migrated.isActiveViewMaximized).toBe(false);
    expect(migrated.activeView).toBe('view-1');
  });
});
