import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import macro from '@kitware/vtk.js/macros';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkSelectionNode from '@kitware/vtk.js/Common/DataModel/SelectionNode';
import vtkRulerWidget from '@/src/vtk/RulerWidget';
import vtkRectangleWidget from '@/src/vtk/RectangleWidget';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import widgetBehavior, { InteractionState } from '../behavior';

const dispose: Array<() => void> = [];
afterEach(() => dispose.splice(0).forEach((cleanup) => cleanup()));
beforeEach(() => setActivePinia(createPinia()));

// Rectangle uses the ruler's interaction behavior with different representations.
describe.each([
  ['ruler', vtkRulerWidget, useRulerStore],
  ['rectangle', vtkRectangleWidget, useRectangleStore],
] as const)('%s handle presses', (_name, widgetFactory, useStore) => {
  const createWidget = (
    selectionKind: 'line' | 'handle' | 'empty' = 'line'
  ) => {
    const id = useStore().addTool({ imageID: 'image' });
    const factory = widgetFactory.newInstance({ id, isPlaced: true });
    const widgetState = factory.getWidgetState();
    const point = widgetState.getFirstPoint();
    point.setActive(true);
    const line = vtkActor.newInstance();
    const selection = vtkSelectionNode.newInstance();
    selection.setProperties(selectionKind === 'line' ? { prop: line } : {});
    const managerInitialValues = {
      pickingEnabled: false,
      selections: selectionKind === 'empty' ? [] : [selection],
    };
    const manager = vtkWidgetManager.newInstance(managerInitialValues);
    let animationRequests = 0;
    const model = {
      widgetState,
      activeState: point,
      representations: [{}, { getActors: () => [line] }],
      _widgetManager: manager,
      _apiSpecificRenderWindow: { setCursor: () => {} },
      _interactor: {
        requestAnimation: () => {
          animationRequests += 1;
        },
        cancelAnimation: () => {},
      },
      manipulator: { handleEvent: () => ({ worldCoords: [1, 2, 3] }) },
    };
    const widget: any = {};
    macro.obj(widget, model);
    vtkAbstractWidget.extend(widget, model);
    widgetBehavior(widget, model);
    dispose.push(() => {
      widget.delete();
      factory.delete();
      manager.delete();
      line.delete();
      selection.delete();
    });
    return { widget, manager, animationRequests: () => animationRequests };
  };

  it('does not drag a stale handle when a fresh pick has cleared the previous selection', async () => {
    const { widget, manager, animationRequests } = createWidget();
    expect(manager.getSelections()).toHaveLength(1);
    // The real manager clears selections synchronously before capture resolves.
    // With picking disabled it also leaves that valid no-selection state intact.
    const pick = manager.getSelectedDataForXY(12, 24);
    expect(manager.getSelections()).toBeNull();
    expect(() => widget.handleLeftButtonPress({})).not.toThrow();
    expect(widget.getInteractionState()).toBe(InteractionState.Select);
    expect(animationRequests()).toBe(0);
    await pick;
  });

  it('starts dragging a handle after the pick has resolved', () => {
    const { widget, animationRequests } = createWidget('handle');
    expect(widget.handleLeftButtonPress({})).toBe(macro.EVENT_ABORT);
    expect(widget.getInteractionState()).toBe(InteractionState.Dragging);
    expect(animationRequests()).toBe(1);
  });

  it.each(['line', 'empty'] as const)(
    'does not drag when the resolved pick is %s',
    (selectionKind) => {
      const { widget, animationRequests } = createWidget(selectionKind);
      expect(widget.handleLeftButtonPress({})).toBe(macro.VOID);
      expect(widget.getInteractionState()).toBe(InteractionState.Select);
      expect(animationRequests()).toBe(0);
    }
  );
});
