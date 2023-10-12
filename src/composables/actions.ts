import { useToolStore } from '../store/tools';
import { Tools } from '../store/tools/types';
import { useRectangleStore } from '../store/tools/rectangles';
import { useRulerStore } from '../store/tools/rulers';
import { usePolygonStore } from '../store/tools/polygons';
import { Action } from '../constants';
import { useKeyboardShortcutsStore } from '../store/keyboard-shortcuts';

const applyLabelOffset = (offset: number) => () => {
  const toolToStore = {
    [Tools.Rectangle]: useRectangleStore(),
    [Tools.Ruler]: useRulerStore(),
    [Tools.Polygon]: usePolygonStore(),
  };
  const toolStore = useToolStore();

  // @ts-ignore - toolToStore may not have keys of all tools
  const activeToolStore = toolToStore[toolStore.currentTool];
  if (!activeToolStore) return;

  const labels = Object.entries(activeToolStore.labels);
  const activeLabelIndex = labels.findIndex(
    ([name]) => name === activeToolStore.activeLabel
  );

  const [nextLabel] = labels.at((activeLabelIndex + offset) % labels.length)!;
  activeToolStore.setActiveLabel(nextLabel);
};

const setTool = (tool: Tools) => () => {
  useToolStore().setCurrentTool(tool);
};

const showKeyboardShortcuts = () => {
  const keyboardStore = useKeyboardShortcutsStore();
  keyboardStore.settingsOpen = true;
};

export const ACTION_TO_FUNC = {
  windowLevel: setTool(Tools.WindowLevel),
  pan: setTool(Tools.Pan),
  zoom: setTool(Tools.Zoom),
  ruler: setTool(Tools.Ruler),
  paint: setTool(Tools.Paint),
  rectangle: setTool(Tools.Rectangle),
  crosshairs: setTool(Tools.Crosshairs),
  crop: setTool(Tools.Crop),
  polygon: setTool(Tools.Polygon),
  select: setTool(Tools.Select),

  decrementLabel: applyLabelOffset(-1),
  incrementLabel: applyLabelOffset(1),

  showKeyboardShortcuts,
} as const satisfies Record<Action, () => void>;
