import { inject, type InjectionKey, type Ref } from 'vue';

export type ViewMove = {
  movingViewId: Ref<string | undefined>;
  start: (viewId: string, event: PointerEvent) => void;
};

export const ViewMoveKey: InjectionKey<ViewMove> = Symbol('ViewMove');

export const useViewMove = () => inject(ViewMoveKey, undefined);
