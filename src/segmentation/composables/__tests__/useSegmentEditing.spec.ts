import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { createSegmentRegistry } from '@/src/segmentation/segmentRegistry';
import { useSegmentEditing } from '@/src/segmentation/composables/useSegmentEditing';

// An appearance field a segment does not state follows the app default, so a
// commit writes back only the fields the edit changed.
describe('committing a segment edit', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const editSegment = () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment({ name: 'Tumor' });
    const editing = useSegmentEditing(registry);
    editing.startEditing(id);
    return { registry, id, editing };
  };

  it('leaves the fields a rename did not touch unstated', () => {
    const { registry, id, editing } = editSegment();
    const { color } = registry.getSegment(id)!;

    editing.editState.name = ' Lesion ';
    editing.stopEditing(true);

    expect(registry.getSegment(id)).toEqual({
      id,
      name: 'Lesion',
      color,
      visible: true,
      locked: false,
    });
  });

  it('states a changed field and keeps a field changed back unstated', () => {
    const { registry, id, editing } = editSegment();

    editing.editState.fillOpacity = 0.5;
    editing.editState.strokeWidth += 1;
    editing.editState.strokeWidth -= 1;
    editing.stopEditing(true);

    expect(registry.getSegment(id)).toMatchObject({ fillOpacity: 0.5 });
    expect(registry.getSegment(id)).not.toHaveProperty('strokeWidth');
    expect(registry.getSegment(id)).not.toHaveProperty('outlineOpacity');
  });
});
