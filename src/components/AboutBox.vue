<template>
  <v-card>
    <v-card-title>VolView</v-card-title>
    <v-card-text>
      VolView is an open-source web application developed at
      <a>Kitware</a> for visualizing and annotating medical images stored in
      DICOM, NRRD, NIFTI, and other file formats. It is built as a custom
      application on top of the <a>itk.js</a> and <a>vtk.js</a> toolkits.
    </v-card-text>
  </v-card>
</template>

<script>
import { defineComponent } from '@vue/composition-api';

export default defineComponent({
  name: 'AboutBox',
});
</script>
