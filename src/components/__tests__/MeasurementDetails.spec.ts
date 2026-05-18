import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import MeasurementToolDetails from '@/src/components/MeasurementToolDetails.vue';
import MeasurementRulerDetails from '@/src/components/MeasurementRulerDetails.vue';
import { ToolID } from '@/src/types/annotation-tool';

vi.mock('@/src/store/tools/rulers', () => ({
  useRulerStore: () => ({
    lengthByID: { 'tool-1': 12.345 },
  }),
}));

const stubs = {
  'v-row': { template: '<div><slot /></div>' },
  'v-col': { template: '<div><slot /></div>' },
};

const baseTool = {
  id: 'tool-1' as ToolID,
  imageID: 'img-1',
  frameOfReference: {
    planeOrigin: [0, 0, 0] as [number, number, number],
    planeNormal: [0, 0, 1] as [number, number, number],
  },
  color: '#fff',
  name: 'Tool',
  axis: 'Axial',
};

describe('MeasurementToolDetails', () => {
  it('shows slice number for a volume annotation', () => {
    const wrapper = mount(MeasurementToolDetails, {
      props: { tool: { ...baseTool, slice: 4 } },
      global: { stubs },
    });
    expect(wrapper.text()).toContain('Slice: 5');
    expect(wrapper.text()).not.toContain('Frame:');
  });

  it('shows frame number for a cine annotation', () => {
    const wrapper = mount(MeasurementToolDetails, {
      props: { tool: { ...baseTool, slice: 0, frame: 7 } },
      global: { stubs },
    });
    expect(wrapper.text()).toContain('Frame: 8');
    expect(wrapper.text()).not.toContain('Slice:');
  });
});

describe('MeasurementRulerDetails', () => {
  it('shows slice number for a volume ruler', () => {
    const wrapper = mount(MeasurementRulerDetails, {
      props: { tool: { ...baseTool, slice: 9 } },
      global: { stubs },
    });
    expect(wrapper.text()).toContain('Slice: 10');
    expect(wrapper.text()).not.toContain('Frame:');
  });

  it('shows frame number for a cine ruler', () => {
    const wrapper = mount(MeasurementRulerDetails, {
      props: { tool: { ...baseTool, slice: 0, frame: 2 } },
      global: { stubs },
    });
    expect(wrapper.text()).toContain('Frame: 3');
    expect(wrapper.text()).not.toContain('Slice:');
  });
});
