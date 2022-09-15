export type ViewType = '2D' | '3D';

export interface ViewSpec {
  viewType: ViewType;
  props: Record<string, any>;
}
