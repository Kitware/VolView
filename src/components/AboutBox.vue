<template>
  <v-card>
    <v-card-title class="d-flex flex-row justify-center">
      <vol-view-full-logo />
    </v-card-title>
    <v-card-text>
      <p align=center>
        <img src="../assets/KitwareHeadAndNeck.jpg" alt="Head and neck CT rendering" style="width:200px" align=center><br>
      </p>
      <p>
        <a
          rel="noopener noreferrer"
          target="_blank"
          href="https://volview.kitware.com/"
        >
          VolView
        </a>
        is an open-source web application developed at
        <a
          rel="noopener noreferrer"
          target="_blank"
          href="https://kitware.com/"
        >
          Kitware
        </a>
        for visualizing and annotating medical images.  It key features include:
<ul>
    <li>Drag-and-drop DICOM files for quick viewing</li>
    <li>Cinematic volume rendering: generate high-quality 3D visualizations</li>
    <li>Standard radiological image visualization and annotation tools</li>
    <li>Secure: your data stays on your machine. No cloud services or data servers are used.</li>
</ul>
<br>
        VolView is freely available for research and commercial applications, using the Apache 2.0 license.  It is built using a variety of open-source toolks created by Kitware, such as
        <a
          rel="noopener noreferrer"
          target="_blank"
          href="https://github.com/InsightSoftwareConsortium/itk-wasm/"
        >
          itk-wasm
        </a>
        for DICOM I/O and image processing, and
        <a
          rel="noopener noreferrer"
          target="_blank"
          href="https://github.com/Kitware/vtk-js"
        >
          vtk.js
        </a>
        for in-browser scientific visualization.
      </p>
      <!-- prettier-ignore -->
      <p>
        Want help customizing VolView for your products or processes or to create a branded application?
        <a
          rel-="noopener noreferrer"
          target="_blank"
          href="https://www.kitware.com/contact/project/"
        >Contact Kitware!</a>
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
          PROSTATEx Challenge Data: Geert Litjens, Oscar Debats, Jelle Barentsz, Nico Karssemeijer,
          and Henkjan Huisman. "ProstateX Challenge data", The Cancer Imaging
          Archive (2017). DOI: 10.7937/K9TCIA.2017.MURS5CL (<a
            rel="noopener noreferrer"
            target="_blank"
            href="https://wiki.cancerimagingarchive.net/pages/viewpage.action?pageId=23691656"
            >TCIA</a
          >)
        </li>
        <li>
          MRA Head and Neck: Test case 98890234 from the "Patient Contributed
          Image Repository" (<a
            rel="noopener noreferrer"
            target="_blank"
            href="http://www.pcir.org/researchers/98890234_20030505_MR.html"
            >PCIR.org</a
          >)
        </li>
        <li>
          3D ultrasound of a fetus: Sample data from <a
            rel="noopener noreferrer"
            target="_blank"
            href="http://tomovision.comi"
            >tomovision.com</a
          >
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
