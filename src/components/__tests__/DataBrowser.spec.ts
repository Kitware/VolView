import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { enableAutoUnmount, shallowMount } from '@vue/test-utils';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import DataBrowser from '@/src/components/DataBrowser.vue';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useImageStore } from '@/src/store/datasets-images';

enableAutoUnmount(afterEach);

const mountPanels = () => {
  const wrapper = shallowMount(DataBrowser);
  const panels = wrapper.findComponent({ name: 'VExpansionPanels' });
  return {
    open: () => panels.props('modelValue'),
    collapse: async () => {
      panels.vm.$emit('update:modelValue', []);
      await nextTick();
    },
  };
};

describe('DataBrowser panels', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('reopens Anonymous for a new image, without duplicate keys or reopening on deletion', async () => {
    const panels = mountPanels();
    const images = useImageStore();
    const addImage = (id: string) =>
      images.addVTKImageData(id, vtkImageData.newInstance(), { id });

    addImage('first');
    await nextTick();
    expect(panels.open()).toEqual(['anonymousData']);
    await panels.collapse();

    addImage('second');
    await nextTick();
    expect(panels.open()).toEqual(['anonymousData']);
    addImage('third');
    await nextTick();
    expect(panels.open()).toEqual(['anonymousData']);

    await panels.collapse();
    images.deleteData('first');
    await nextTick();
    expect(panels.open()).toEqual([]);
  });

  it.each(['new study', 'existing study'])(
    'reopens only the patient receiving a volume in a %s',
    async (target) => {
      const dicom = useDICOMStore();
      const panels = mountPanels();
      for (const patient of ['patient', 'other']) {
        dicom.patientInfo[patient] = {
          PatientID: patient,
          PatientName: patient,
          PatientBirthDate: '',
          PatientSex: '',
        };
        dicom.patientStudies[patient] = [patient];
        dicom.studyVolumes[patient] = [`${patient}-volume`];
      }
      await nextTick();
      expect([...panels.open()].sort()).toEqual(['other', 'patient']);
      await panels.collapse();

      const study = target === 'new study' ? 'study-2' : 'patient';
      if (target === 'new study') {
        dicom.patientStudies.patient.push(study);
        dicom.studyVolumes[study] = [];
      }
      dicom.studyVolumes[study].push('volume-2');
      await nextTick();
      expect(panels.open()).toEqual(['patient']);

      dicom.studyVolumes[study].push('volume-3');
      await nextTick();
      expect(panels.open()).toEqual(['patient']);
      await panels.collapse();
      dicom.studyVolumes[study].pop();
      await nextTick();
      expect(panels.open()).toEqual([]);
    }
  );
});
