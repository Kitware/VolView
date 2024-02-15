import VtkObliqueThreeView from '@/src/components/VtkObliqueThreeView.vue';
import VtkObliqueView from '@/src/components/VtkObliqueView.vue';
import VtkThreeView from '@/src/components/VtkThreeView.vue';
import VtkTwoView from '@/src/components/VtkTwoView.vue';
import { Component } from 'vue';

export const ViewTypeToComponent: Record<string, Component> = {
  '2D': VtkTwoView,
  '3D': VtkThreeView,
  Oblique: VtkObliqueView,
  Oblique3D: VtkObliqueThreeView,
};
