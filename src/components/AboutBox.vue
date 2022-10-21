<template>
  <v-card>
    <v-card-title class="d-flex flex-row justify-center">
      <vol-view-full-logo />
    </v-card-title>
    <v-card-text>
      <p>
        VolView is an open-source web application developed at
        <a
          rel="noopener noreferrer"
          target="_blank"
          href="https://kitware.com/"
        >
          Kitware
        </a>
        for visualizing and annotating medical images stored in DICOM, NRRD,
        NIFTI, and other file formats. It is an application built on top of the
        <a
          rel="noopener noreferrer"
          target="_blank"
          href="https://github.com/InsightSoftwareConsortium/itk-wasm/"
        >
          itk-wasm
        </a>
        and
        <a
          rel="noopener noreferrer"
          target="_blank"
          href="https://github.com/Kitware/vtk-js"
        >
          vtk.js
        </a>
        toolkits.
      </p>
      <!-- prettier-ignore -->
      <p>
        Want help in customizing VolView for your next application?
        <a
          rel-="noopener noreferrer"
          target="_blank"
          href="https://www.kitware.com/contact/project/"
        >Contact us</a>!
      </p>
      <ul class="mt-3">
        <li>
          Source code:
          <a
            rel="noopener noreferrer"
            target="_blank"
            href="https://github.com/KitwareMedical/VolView"
          >
            https://github.com/KitwareMedical/VolView
          </a>
        </li>
        <li>
          Bug reports and feature requests:
          <a
            rel="noopener noreferrer"
            target="_blank"
            href="https://github.com/KitwareMedical/VolView/issues"
          >
            https://github.com/KitwareMedical/VolView/issues
          </a>
        </li>
      </ul>
      <!-- prettier-ignore -->
      <p> <br>
        Sample data provided by the following sources:
      </p>
      <ul class="mt-3">
        <li>
          PROSTATEx Challenge Data (<a
            rel="noopener noreferrer"
            target="_blank"
            href="https://wiki.cancerimagingarchive.net/pages/viewpage.action?pageId=23691656"
          >TCIA</a>)
: Geert Litjens, Oscar Debats, Jelle Barentsz, Nico Karssemeijer, and Henkjan Huisman. "ProstateX Challenge data", The Cancer Imaging Archive (2017). DOI: 10.7937/K9TCIA.2017.MURS5CL
        </li>
        <li>
          MRA Head and Neck: Test case 98890234 from the "Patient Contributed Image Repository" (<a
            rel="noopener noreferrer"
            target="_blank"
            href="http://www.pcir.org/researchers/98890234_20030505_MR.html"
          >PCIR.org</a>)
        </li>
      </ul>
    </v-card-text>
  </v-card>
</template>

<script>
import { defineComponent } from '@vue/composition-api';
import VolViewFullLogo from './icons/VolViewFullLogo.vue';

export default defineComponent({
  name: 'AboutBox',
  components: {
    VolViewFullLogo,
  },
});
</script>
