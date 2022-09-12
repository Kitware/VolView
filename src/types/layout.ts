import { LPSAxisDir } from './lps';

export type ViewType = '2D' | '3D';

export enum LayoutDirection {
  V = 'V',
  H = 'H',
}

export interface ViewProps {
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
}

export type LayoutView = {
  objType: 'View';
  viewType: 'View2D' | 'View3D';
  id: string;
  props: ViewProps;
};

export type Layout = {
  objType: 'Layout';
  direction: LayoutDirection;
  items: Array<Layout | LayoutView>;
  name?: string;
};
