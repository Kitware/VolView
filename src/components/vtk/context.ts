import { VtkViewApi } from '@/src/types/vtk-types';
import { InjectionKey } from 'vue';

export const VtkViewContext: InjectionKey<VtkViewApi> = Symbol('VtkView');
